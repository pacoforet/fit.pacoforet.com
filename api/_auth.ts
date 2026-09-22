// Shared auth helpers for the Edge functions. Files prefixed with "_" are not exposed as routes.
//
// FIT_PASSWORD_HASH format (generated with `npm run auth:hash <user> <password>`):
//   pbkdf2-sha256:<iterations>:<salt base64url>:<derived key base64url>
// The derived key is PBKDF2-SHA256 over "user:password".
//
// Sessions are a stateless cookie "<expiresAtMs>.<hmac>" signed with a key derived from
// FIT_PASSWORD_HASH, so changing the password invalidates every existing session.

declare const process: any;

export const SESSION_COOKIE = "fit_session";
export const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30; // 30 days

const encoder = new TextEncoder();

function getPasswordHash(): string {
  return (process.env.FIT_PASSWORD_HASH || "").trim();
}

export function isAuthConfigured(): boolean {
  return getPasswordHash().split(":").length === 4;
}

function b64urlToBytes(value: string): Uint8Array {
  const b64 = value.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((value.length + 3) % 4);
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function bytesToB64url(bytes: ArrayBuffer): string {
  let bin = "";
  for (const b of new Uint8Array(bytes)) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

export async function verifyPassword(user: string, pass: string): Promise<boolean> {
  const parts = getPasswordHash().split(":");
  if (parts.length !== 4 || parts[0] !== "pbkdf2-sha256") return false;
  const iterations = Number(parts[1]);
  if (!Number.isInteger(iterations) || iterations < 100_000) return false;

  const salt = b64urlToBytes(parts[2]);
  const expected = b64urlToBytes(parts[3]);
  const baseKey = await crypto.subtle.importKey(
    "raw",
    encoder.encode(`${user}:${pass}`),
    "PBKDF2",
    false,
    ["deriveBits"]
  );
  const derived = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations },
    baseKey,
    expected.length * 8
  );
  return timingSafeEqual(new Uint8Array(derived), expected);
}

async function getSessionKey(): Promise<CryptoKey> {
  const material = await crypto.subtle.digest("SHA-256", encoder.encode(`fit-session-v1:${getPasswordHash()}`));
  return crypto.subtle.importKey("raw", material, { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}

export async function createSessionCookie(): Promise<string> {
  const expiresAt = Date.now() + SESSION_TTL_SECONDS * 1000;
  const key = await getSessionKey();
  const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(`v1.${expiresAt}`));
  const value = `${expiresAt}.${bytesToB64url(sig)}`;
  return `${SESSION_COOKIE}=${value}; Path=/; Max-Age=${SESSION_TTL_SECONDS}; HttpOnly; Secure; SameSite=Strict`;
}

export function clearSessionCookie(): string {
  return `${SESSION_COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Strict`;
}

function readCookie(request: Request, name: string): string | null {
  const header = request.headers.get("cookie") || "";
  for (const part of header.split(";")) {
    const [k, ...rest] = part.trim().split("=");
    if (k === name) return rest.join("=");
  }
  return null;
}

export async function hasValidSession(request: Request): Promise<boolean> {
  if (!isAuthConfigured()) return false;
  const raw = readCookie(request, SESSION_COOKIE);
  if (!raw) return false;
  const [expiresAtStr, sigStr] = raw.split(".");
  const expiresAt = Number(expiresAtStr);
  if (!Number.isFinite(expiresAt) || expiresAt < Date.now() || !sigStr) return false;
  try {
    const key = await getSessionKey();
    return await crypto.subtle.verify("HMAC", key, b64urlToBytes(sigStr), encoder.encode(`v1.${expiresAt}`));
  } catch {
    return false;
  }
}

// Rejects cross-site state-changing requests. Browsers always send Origin on POST/DELETE.
export function isSameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  try {
    return new URL(origin).host === new URL(request.url).host;
  } catch {
    return false;
  }
}

export function json(body: unknown, status = 200, extraHeaders: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      ...extraHeaders,
    },
  });
}
