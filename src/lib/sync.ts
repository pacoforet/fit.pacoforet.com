// Cloud sync with the Gist-backed API. Merge rules are unchanged from v1:
// union by record id, local wins on conflicts, demo samples are never uploaded.
import { DEMO_IDS, applyProfile, commitRecords, isDemo, notify, sessionKind, state } from "./store";
import type { FitRecord, SyncState } from "./types";

type SessionExpiredHandler = () => void;
let onSessionExpired: SessionExpiredHandler = () => {};
export function setSessionExpiredHandler(fn: SessionExpiredHandler): void {
  onSessionExpired = fn;
}

function setSync(s: SyncState, touch = false): void {
  state.sync = { state: s, at: touch ? Date.now() : state.sync.at };
  notify("sync");
}

let inFlight: Promise<void> | null = null;

export function syncFromCloud({ silent = false } = {}): Promise<void> {
  if (isDemo()) {
    setSync("demo");
    return Promise.resolve();
  }
  if (sessionKind() !== "server") return Promise.resolve();
  if (inFlight) return inFlight;

  if (!silent) setSync("syncing");
  inFlight = (async () => {
    try {
      const res = await fetch("/api/fit-sync", { method: "GET", cache: "no-store" });
      if (res.status === 401) return onSessionExpired();
      if (!res.ok) return setSync("error");

      const data = await res.json();
      if (!data.ok) return setSync(data.configured === false ? "local" : "error");

      let cloud: FitRecord[] = Array.isArray(data.records) ? data.records : [];
      const hadDemoInCloud = cloud.some((r) => DEMO_IDS.has(r.id));
      cloud = cloud.filter((r) => !DEMO_IDS.has(r.id));
      const local = state.records.filter((r) => !DEMO_IDS.has(r.id));

      if (data.profile) applyProfile(data.profile);
      else if (data.goals) applyProfile(data.goals);

      const merged = new Map<string, FitRecord>();
      local.forEach((r) => merged.set(r.id, r));
      cloud.forEach((r) => {
        if (!merged.has(r.id)) merged.set(r.id, r);
      });
      const cloudIds = new Set(cloud.map((r) => r.id));
      const hasNewFromLocal = local.some((r) => !cloudIds.has(r.id));

      state.loading = false;
      commitRecords([...merged.values()], { sync: false });
      setSync("synced", true);

      if (hasNewFromLocal || hadDemoInCloud) await pushToCloud({ silent: true });
    } catch (err) {
      console.error("Sync error:", err);
      setSync(silent ? state.sync.state : "local");
    } finally {
      inFlight = null;
      if (state.loading) {
        state.loading = false;
        notify("data");
      }
    }
  })();
  return inFlight;
}

export async function pushToCloud({ silent = false } = {}): Promise<void> {
  if (isDemo()) return setSync("demo");
  if (sessionKind() !== "server") return;
  if (!silent) setSync("syncing");
  try {
    const res = await fetch("/api/fit-sync", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        records: state.records.filter((r) => !DEMO_IDS.has(r.id)),
        goals: { targetWeight: state.profile.targetWeight, targetBodyFat: state.profile.targetBodyFat },
        profile: state.profile,
      }),
    });
    if (res.status === 401) return onSessionExpired();
    const data = res.ok ? await res.json() : null;
    if (data?.ok) setSync("synced", true);
    else setSync(data?.configured === false ? "local" : "error");
  } catch (err) {
    console.error("Cloud save error:", err);
    setSync("error");
  }
}
