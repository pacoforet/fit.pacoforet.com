export const config = {
  runtime: "edge",
};

declare const process: any;

const AUTH_HASH = process.env.FIT_AUTH_HASH || "22610a297f0af193879f19dc56f88a7ab2434d7bcfe8f3ad75dc96d3e2f2a994";
const GITHUB_TOKEN = process.env.FIT_GITHUB_TOKEN || process.env.GITHUB_TOKEN || "";
const GIST_ID = process.env.FIT_GIST_ID || "";
const GIST_FILENAME = process.env.FIT_GIST_FILENAME || "fit-data.json";

function isAuthorized(request: Request): boolean {
  // If no auth hash is defined or configured as empty/disabled, allow access
  if (process.env.FIT_ENABLE_AUTH === "false") return true;
  const authHeader = request.headers.get("x-fit-auth") || request.headers.get("authorization");
  if (!authHeader) return false;
  const token = authHeader.replace(/^Bearer\s+/i, "").trim();
  return token === AUTH_HASH;
}

export default async function handler(request: Request) {
  // CORS Headers
  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, x-fit-auth",
    "Content-Type": "application/json",
  };

  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  // Security Auth Gate
  if (!isAuthorized(request)) {
    return new Response(
      JSON.stringify({ ok: false, error: "Unauthorized" }),
      { status: 401, headers: corsHeaders }
    );
  }

  // Check if GitHub token and Gist ID are configured
  if (!GITHUB_TOKEN || !GIST_ID) {
    return new Response(
      JSON.stringify({
        ok: false,
        configured: false,
        message: "FIT_GITHUB_TOKEN or FIT_GIST_ID not configured",
      }),
      { status: 200, headers: corsHeaders }
    );
  }

  // GET: Retrieve latest synchronized health records from GitHub Gist
  if (request.method === "GET") {
    try {
      const gistRes = await fetch(`https://api.github.com/gists/${GIST_ID}`, {
        headers: {
          Authorization: `Bearer ${GITHUB_TOKEN}`,
          Accept: "application/vnd.github+json",
          "User-Agent": "Fit-Sync-Client",
        },
        cache: "no-store",
      });

      if (!gistRes.ok) {
        return new Response(
          JSON.stringify({ ok: false, error: "Failed to fetch from GitHub Gist" }),
          { status: gistRes.status, headers: corsHeaders }
        );
      }

      const gistData = await gistRes.json();
      const file = gistData.files?.[GIST_FILENAME] || (gistData.files ? Object.values(gistData.files)[0] : null);
      if (!file || !file.content) {
        return new Response(
          JSON.stringify({ ok: true, records: [], updatedAt: null }),
          { status: 200, headers: corsHeaders }
        );
      }

      const parsed = JSON.parse(file.content);
      return new Response(
        JSON.stringify({
          ok: true,
          configured: true,
          gistId: GIST_ID,
          updatedAt: parsed.updatedAt || gistData.updated_at,
          records: parsed.records || [],
          goals: parsed.goals || { targetWeight: 77.0, targetBodyFat: 17.5 },
          profile: parsed.profile || null,
        }),
        {
          status: 200,
          headers: {
            ...corsHeaders,
            "Cache-Control": "no-cache, no-store, must-revalidate",
          },
        }
      );
    } catch (err: any) {
      return new Response(
        JSON.stringify({ ok: false, error: err.message || "Error reading cloud data" }),
        { status: 500, headers: corsHeaders }
      );
    }
  }

  // POST: Push updated records to GitHub Gist
  if (request.method === "POST") {
    try {
      const body = await request.json();
      const { records, goals, profile } = body;

      if (!Array.isArray(records)) {
        return new Response(
          JSON.stringify({ ok: false, error: "Invalid payload: 'records' must be an array" }),
          { status: 400, headers: corsHeaders }
        );
      }

      const payload = {
        updatedAt: new Date().toISOString(),
        totalRecords: records.length,
        goals: goals || { targetWeight: 77.0, targetBodyFat: 17.5 },
        profile: profile || null,
        records: records,
      };

      const updateRes = await fetch(`https://api.github.com/gists/${GIST_ID}`, {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${GITHUB_TOKEN}`,
          Accept: "application/vnd.github+json",
          "Content-Type": "application/json",
          "User-Agent": "Fit-Sync-Client",
        },
        body: JSON.stringify({
          files: {
            [GIST_FILENAME]: {
              content: JSON.stringify(payload, null, 2),
            },
          },
        }),
      });

      if (!updateRes.ok) {
        const errorText = await updateRes.text();
        return new Response(
          JSON.stringify({ ok: false, error: `GitHub update failed: ${errorText}` }),
          { status: updateRes.status, headers: corsHeaders }
        );
      }

      return new Response(
        JSON.stringify({
          ok: true,
          syncedCount: records.length,
          updatedAt: payload.updatedAt,
          gistId: GIST_ID,
        }),
        { status: 200, headers: corsHeaders }
      );
    } catch (err: any) {
      return new Response(
        JSON.stringify({ ok: false, error: err.message || "Error saving cloud data" }),
        { status: 500, headers: corsHeaders }
      );
    }
  }

  return new Response(
    JSON.stringify({ ok: false, error: "Method not allowed" }),
    { status: 405, headers: corsHeaders }
  );
}
