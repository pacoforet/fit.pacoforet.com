import {
  clearSessionCookie,
  createSessionCookie,
  hasValidSession,
  isAuthConfigured,
  isSameOrigin,
  json,
  verifyPassword,
} from "./_auth.js";

export const config = {
  runtime: "edge",
};

// GET    /api/session -> { authenticated }
// POST   /api/session -> login with { user, pass }, sets HttpOnly session cookie
// DELETE /api/session -> logout
export default async function handler(request: Request) {
  if (request.method === "GET") {
    return json({ ok: true, authenticated: await hasValidSession(request) });
  }

  if (request.method === "POST") {
    if (!isSameOrigin(request)) return json({ ok: false, error: "Forbidden" }, 403);
    if (!isAuthConfigured()) {
      return json({ ok: false, error: "FIT_PASSWORD_HASH not configured" }, 503);
    }

    let user = "";
    let pass = "";
    try {
      const body = await request.json();
      user = typeof body?.user === "string" ? body.user.trim().slice(0, 200) : "";
      pass = typeof body?.pass === "string" ? body.pass.trim().slice(0, 500) : "";
    } catch {
      return json({ ok: false, error: "Invalid payload" }, 400);
    }

    if (user && pass && (await verifyPassword(user, pass))) {
      return json({ ok: true, authenticated: true }, 200, { "Set-Cookie": await createSessionCookie() });
    }

    // Slow down online guessing a little
    await new Promise((resolve) => setTimeout(resolve, 800));
    return json({ ok: false, error: "Invalid credentials" }, 401);
  }

  if (request.method === "DELETE") {
    if (!isSameOrigin(request)) return json({ ok: false, error: "Forbidden" }, 403);
    return json({ ok: true, authenticated: false }, 200, { "Set-Cookie": clearSessionCookie() });
  }

  return json({ ok: false, error: "Method not allowed" }, 405, { Allow: "GET, POST, DELETE" });
}
