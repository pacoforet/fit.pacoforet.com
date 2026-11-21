// Cloud sync with the Gist-backed API.
// Merge rules: union by record id, local wins on conflicts, tombstones (deletedIds)
// propagate deletions across devices without resurrecting deleted weigh-ins, and demo
// samples are never uploaded.
import {
  DEMO_IDS,
  applyProfile,
  commitRecords,
  isDemo,
  notify,
  pruneDeletedIds,
  sessionKind,
  setDeletedIds,
  state,
} from "./store";
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
let pushQueue: Promise<void> = Promise.resolve();

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
      await pushQueue;
      const res = await fetch("/api/fit-sync", { method: "GET", cache: "no-store" });
      if (res.status === 401) return onSessionExpired();
      if (!res.ok) return setSync("error");

      const data = await res.json();
      if (!data.ok) return setSync(data.configured === false ? "local" : "error");

      const rawCloud: FitRecord[] = Array.isArray(data.records) ? data.records : [];
      const hadDemoInCloud = rawCloud.some((r) => DEMO_IDS.has(r.id));

      const cloudDeleted: Record<string, number> =
        data.deletedIds && typeof data.deletedIds === "object" && !Array.isArray(data.deletedIds)
          ? data.deletedIds
          : {};
      const localDeleted = state.deletedIds;
      const mergedDeletedRaw: Record<string, number> = { ...cloudDeleted };
      for (const [id, ts] of Object.entries(localDeleted)) {
        if (typeof ts === "number" && Number.isFinite(ts)) {
          mergedDeletedRaw[id] = Math.max(mergedDeletedRaw[id] ?? 0, ts);
        }
      }
      const mergedDeleted = pruneDeletedIds(mergedDeletedRaw);
      setDeletedIds(mergedDeleted);

      const cloud = rawCloud.filter((r) => !DEMO_IDS.has(r.id) && !(r.id in mergedDeleted));
      const local = state.records.filter((r) => !DEMO_IDS.has(r.id) && !(r.id in mergedDeleted));

      if (data.profile) applyProfile(data.profile);
      else if (data.goals) applyProfile(data.goals);

      const merged = new Map<string, FitRecord>();
      local.forEach((r) => merged.set(r.id, r));
      cloud.forEach((r) => {
        if (!merged.has(r.id)) merged.set(r.id, r);
      });
      const cloudIds = new Set(cloud.map((r) => r.id));
      const hasNewFromLocal = local.some((r) => !cloudIds.has(r.id));
      const cloudHasDeletedRecords = rawCloud.some((r) => r.id in mergedDeleted);
      const hasNewDeletedFromLocal = Object.keys(mergedDeleted).some((id) => !(id in cloudDeleted));

      state.loading = false;
      commitRecords([...merged.values()], { sync: false });
      setSync("synced", true);

      if (hasNewFromLocal || hadDemoInCloud || cloudHasDeletedRecords || hasNewDeletedFromLocal) {
        await runPush({ silent: true });
      }
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

async function runPush({ silent = false } = {}): Promise<void> {
  if (isDemo()) return setSync("demo");
  if (sessionKind() !== "server") return;
  if (!silent) setSync("syncing");
  try {
    const res = await fetch("/api/fit-sync", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        records: state.records.filter((r) => !DEMO_IDS.has(r.id)),
        deletedIds: state.deletedIds,
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

export function pushToCloud({ silent = false } = {}): Promise<void> {
  if (isDemo()) {
    setSync("demo");
    return Promise.resolve();
  }
  if (sessionKind() !== "server") return Promise.resolve();
  const next = pushQueue.then(() => runPush({ silent }));
  pushQueue = next.catch(() => {});
  return next;
}
