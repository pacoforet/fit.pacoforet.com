import { afterEach, describe, expect, it } from "vitest";
import { createSessionCookie, hasValidSession, isAuthConfigured, isSameOrigin, verifyPassword } from "../api/_auth";

declare const process: { env: Record<string, string | undefined> };

const encoder = new TextEncoder();

function bytesToB64url(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function makeHash(user: string, pass: string, iterations = 100_000): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const baseKey = await crypto.subtle.importKey("raw", encoder.encode(`${user}:${pass}`), "PBKDF2", false, ["deriveBits"]);
  const derived = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations }, baseKey, 256);
  return `pbkdf2-sha256:${iterations}:${bytesToB64url(salt)}:${bytesToB64url(new Uint8Array(derived))}`;
}

const originalHash = process.env.FIT_PASSWORD_HASH;
afterEach(() => {
  if (originalHash === undefined) delete process.env.FIT_PASSWORD_HASH;
  else process.env.FIT_PASSWORD_HASH = originalHash;
});

describe("api/_auth", () => {
  it("validates FIT_PASSWORD_HASH format strictly", async () => {
    delete process.env.FIT_PASSWORD_HASH;
    expect(isAuthConfigured()).toBe(false);

    process.env.FIT_PASSWORD_HASH = "a:b:c:d";
    expect(isAuthConfigured()).toBe(false);

    process.env.FIT_PASSWORD_HASH = "pbkdf2-sha256:50000:abc:def";
    expect(isAuthConfigured()).toBe(false);

    process.env.FIT_PASSWORD_HASH = await makeHash("paco", "super-secret-pass");
    expect(isAuthConfigured()).toBe(true);
  });

  it("verifies passwords and rejects invalid credentials", async () => {
    process.env.FIT_PASSWORD_HASH = await makeHash("paco", "super-secret-pass");
    expect(await verifyPassword("paco", "super-secret-pass")).toBe(true);
    expect(await verifyPassword("paco", "wrong-password")).toBe(false);
    expect(await verifyPassword("Paco", "super-secret-pass")).toBe(false);
  });

  it("creates and verifies signed session cookies and invalidates on password rotation", async () => {
    process.env.FIT_PASSWORD_HASH = await makeHash("paco", "super-secret-pass");
    const setCookie = await createSessionCookie();
    const cookiePair = setCookie.split(";")[0];

    const validReq = new Request("https://fit.pacoforet.com/api/fit-sync", {
      headers: { cookie: cookiePair },
    });
    expect(await hasValidSession(validReq)).toBe(true);

    const tamperedReq = new Request("https://fit.pacoforet.com/api/fit-sync", {
      headers: { cookie: `${cookiePair}x` },
    });
    expect(await hasValidSession(tamperedReq)).toBe(false);

    // Rotating the password invalidates existing cookies
    process.env.FIT_PASSWORD_HASH = await makeHash("paco", "new-secret-password");
    expect(await hasValidSession(validReq)).toBe(false);
  });

  it("enforces exact origin match in isSameOrigin", () => {
    expect(
      isSameOrigin(
        new Request("https://fit.pacoforet.com/api/session", {
          method: "POST",
          headers: { origin: "https://fit.pacoforet.com" },
        })
      )
    ).toBe(true);

    // Scheme mismatch must be rejected
    expect(
      isSameOrigin(
        new Request("https://fit.pacoforet.com/api/session", {
          method: "POST",
          headers: { origin: "http://fit.pacoforet.com" },
        })
      )
    ).toBe(false);

    // Missing or cross-site origin must be rejected
    expect(isSameOrigin(new Request("https://fit.pacoforet.com/api/session", { method: "POST" }))).toBe(false);
    expect(
      isSameOrigin(
        new Request("https://fit.pacoforet.com/api/session", {
          method: "POST",
          headers: { origin: "https://evil.example" },
        })
      )
    ).toBe(false);
  });
});
