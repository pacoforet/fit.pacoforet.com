import { hasValidSession, isSameOrigin, json } from "./_auth.js";

export const config = {
  runtime: "edge",
};

declare const process: any;

const GITHUB_TOKEN = process.env.FIT_GITHUB_TOKEN || process.env.GITHUB_TOKEN || "";
const GIST_ID = process.env.FIT_GIST_ID || "";
const GIST_FILENAME = process.env.FIT_GIST_FILENAME || "fit-data.json";

const MAX_BODY_BYTES = 2_000_000;
const MAX_RECORDS = 20_000;
const DEFAULT_GOALS = { targetWeight: 77.0, targetBodyFat: 17.5 };

// Numeric record fields and their accepted range. Anything else is dropped.
const NUMERIC_FIELDS: Record<string, [number, number]> = {
  weight: [20, 400],
  bmi: [5, 100],
  bodyFat: [0, 80],
  skeletalMuscle: [0, 100],
  fatFreeWeight: [0, 400],
  subcutaneousFat: [0, 80],
  visceralFat: [0, 60],
  bodyWater: [0, 100],
  muscleMass: [0, 400],
  boneMass: [0, 20],
  protein: [0, 100],
  bmr: [0, 10_000],
  metabolicAge: [0, 150],
  fatMassKg: [0, 400],
  leanMassKg: [0, 400],
};

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^\d{2}:\d{2}(:\d{2})?$/;
const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/;
const ID_RE = /^[0-9A-Za-z_:.\-]{1,64}$/;

function numberInRange(value: unknown, [min, max]: [number, number]): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= min && value <= max ? value : null;
}

function sanitizeRecord(raw: any): Record<string, unknown> | null {
  if (!raw || typeof raw !== "object") return null;
  const { id, date, time, iso, timestamp } = raw;
  if (typeof id !== "string" || !ID_RE.test(id)) return null;
  if (typeof date !== "string" || !DATE_RE.test(date)) return null;
  if (typeof time !== "string" || !TIME_RE.test(time)) return null;
  if (typeof iso !== "string" || !ISO_RE.test(iso)) return null;

  const record: Record<string, unknown> = {
    id,
    date,
    time,
    iso,
    timestamp: typeof timestamp === "number" && Number.isFinite(timestamp) ? timestamp : null,
  };
  for (const [field, range] of Object.entries(NUMERIC_FIELDS)) {
    record[field] = numberInRange(raw[field], range);
  }
  if (record.weight === null) return null;
  return record;
}

function sanitizeGoals(raw: any) {
  return {
    targetWeight: numberInRange(raw?.targetWeight, [20, 400]) ?? DEFAULT_GOALS.targetWeight,
    targetBodyFat: numberInRange(raw?.targetBodyFat, [1, 80]) ?? DEFAULT_GOALS.targetBodyFat,
  };
}

function sanitizeProfile(raw: any) {
  if (!raw || typeof raw !== "object") return null;
  return {
    name: typeof raw.name === "string" ? raw.name.slice(0, 60) : "",
    height: numberInRange(raw.height, [1, 2.5]) ?? 1.8,
    ...sanitizeGoals(raw),
  };
}

function gistHeaders(extra: Record<string, string> = {}) {
  return {
    Authorization: `Bearer ${GITHUB_TOKEN}`,
    Accept: "application/vnd.github+json",
    "User-Agent": "Fit-Sync-Client",
    ...extra,
  };
}

export default async function handler(request: Request) {
  if (!(await hasValidSession(request))) {
    return json({ ok: false, error: "Unauthorized" }, 401);
  }

  if (!GITHUB_TOKEN || !GIST_ID) {
    return json({
      ok: false,
      configured: false,
      message: "FIT_GITHUB_TOKEN or FIT_GIST_ID not configured",
    });
  }

  // GET: Retrieve latest synchronized health records from GitHub Gist
  if (request.method === "GET") {
    try {
      const gistRes = await fetch(`https://api.github.com/gists/${GIST_ID}`, {
        headers: gistHeaders(),
        cache: "no-store",
      });

      if (!gistRes.ok) {
        return json({ ok: false, error: "Failed to fetch from GitHub Gist" }, 502);
      }

      const gistData = await gistRes.json();
      const file = gistData.files?.[GIST_FILENAME] || (gistData.files ? Object.values(gistData.files)[0] : null);
      if (!file || !file.content) {
        return json({ ok: true, configured: true, records: [], updatedAt: null });
      }

      const parsed = JSON.parse(file.content);
      const records = Array.isArray(parsed.records)
        ? parsed.records.map(sanitizeRecord).filter(Boolean)
        : [];
      return json({
        ok: true,
        configured: true,
        updatedAt: parsed.updatedAt || gistData.updated_at,
        records,
        goals: sanitizeGoals(parsed.goals),
        profile: sanitizeProfile(parsed.profile),
      });
    } catch {
      return json({ ok: false, error: "Error reading cloud data" }, 500);
    }
  }

  // POST: Push updated records to GitHub Gist
  if (request.method === "POST") {
    if (!isSameOrigin(request)) return json({ ok: false, error: "Forbidden" }, 403);
    if (!(request.headers.get("content-type") || "").includes("application/json")) {
      return json({ ok: false, error: "Expected application/json" }, 415);
    }

    try {
      const text = await request.text();
      if (text.length > MAX_BODY_BYTES) {
        return json({ ok: false, error: "Payload too large" }, 413);
      }
      const body = JSON.parse(text);

      if (!Array.isArray(body?.records) || body.records.length > MAX_RECORDS) {
        return json({ ok: false, error: "Invalid payload: 'records' must be an array" }, 400);
      }

      const records = body.records.map(sanitizeRecord).filter(Boolean);
      const rejected = body.records.length - records.length;

      const payload = {
        updatedAt: new Date().toISOString(),
        totalRecords: records.length,
        goals: sanitizeGoals(body.goals),
        profile: sanitizeProfile(body.profile),
        records,
      };

      const updateRes = await fetch(`https://api.github.com/gists/${GIST_ID}`, {
        method: "PATCH",
        headers: gistHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({
          files: {
            [GIST_FILENAME]: {
              content: JSON.stringify(payload, null, 2),
            },
          },
        }),
      });

      if (!updateRes.ok) {
        return json({ ok: false, error: `GitHub update failed (${updateRes.status})` }, 502);
      }

      return json({
        ok: true,
        syncedCount: records.length,
        rejected,
        updatedAt: payload.updatedAt,
      });
    } catch {
      return json({ ok: false, error: "Error saving cloud data" }, 500);
    }
  }

  return json({ ok: false, error: "Method not allowed" }, 405, { Allow: "GET, POST" });
}
