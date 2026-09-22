// Application state and local persistence. Storage keys are kept from v1 so existing data survives.
import initialData from "../data/renpho-data.json";
import type { ChartMetric, FitRecord, Profile, RangeKey, SyncState, ViewKey } from "./types";

export const KEYS = {
  auth: "pacoforet_fit_auth_session",
  records: "pacoforet_fit_data_records",
  goals: "pacoforet_fit_user_goals",
  profile: "pacoforet_fit_user_profile",
  prefs: "pacoforet_fit_ui_prefs",
} as const;

export const DEMO_SESSION = "demo_session";
// Marker only: the real credential is the HttpOnly cookie set by /api/session
export const SERVER_SESSION = "server_session";

export const DEMO_RECORDS = initialData as FitRecord[];
export const DEMO_IDS = new Set(DEMO_RECORDS.map((r) => r.id));
export const DEFAULT_NAME: string = import.meta.env.PUBLIC_USER_NAME || "Usuario demo";
const DEFAULT_PROFILE: Profile = { name: DEFAULT_NAME, height: 1.8, targetWeight: 75, targetBodyFat: 18 };

interface Prefs {
  range: RangeKey;
  metric: ChartMetric;
  historyColumns?: string[];
}

export interface AppState {
  records: FitRecord[];
  profile: Profile;
  view: ViewKey;
  range: RangeKey;
  metric: ChartMetric;
  historyColumns: string[] | null;
  sync: { state: SyncState; at: number | null };
  loading: boolean;
}

function readJson<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function writeJson(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage full or blocked: the in-memory state still works
  }
}

const prefs = readJson<Prefs>(KEYS.prefs);

export const state: AppState = {
  records: [],
  profile: { ...DEFAULT_PROFILE },
  view: "resumen",
  range: prefs?.range ?? "all",
  metric: prefs?.metric ?? "weight",
  historyColumns: prefs?.historyColumns ?? null,
  sync: { state: "idle", at: null },
  loading: false,
};

/** data: records or profile changed (re-render views) · sync: only the sync badge changed */
export type ChangeReason = "data" | "sync";
type Listener = (reason: ChangeReason) => void;
const listeners = new Set<Listener>();

export function subscribe(fn: Listener): void {
  listeners.add(fn);
}

export function notify(reason: ChangeReason = "data"): void {
  listeners.forEach((fn) => fn(reason));
}

/* ---------------------------------- Session ---------------------------------- */

export function sessionKind(): "demo" | "server" | null {
  const v = localStorage.getItem(KEYS.auth);
  return v === DEMO_SESSION ? "demo" : v === SERVER_SESSION ? "server" : null;
}

export const isDemo = () => sessionKind() === "demo";

/* ---------------------------------- Records ---------------------------------- */

export function sortRecords(records: FitRecord[]): FitRecord[] {
  return records.sort((a, b) => a.timestamp - b.timestamp);
}

export function loadRecords(): void {
  if (isDemo()) {
    state.records = sortRecords(DEMO_RECORDS.map((r) => ({ ...r })));
    return;
  }
  const stored = readJson<FitRecord[]>(KEYS.records);
  let records = Array.isArray(stored) ? stored : [];
  // Real sessions never keep demo samples mixed with real weigh-ins
  const clean = records.filter((r) => !DEMO_IDS.has(r.id));
  if (clean.length !== records.length) writeJson(KEYS.records, clean);
  records = clean.filter((r) => r && typeof r.weight === "number" && typeof r.timestamp === "number");
  state.records = sortRecords(records);
}

type PersistHook = () => void;
let onPersist: PersistHook = () => {};
export function setPersistHook(fn: PersistHook): void {
  onPersist = fn;
}

/** Saves records locally, re-renders and pushes to the cloud. */
export function commitRecords(records: FitRecord[], { sync = true } = {}): void {
  state.records = sortRecords(records);
  if (!isDemo()) writeJson(KEYS.records, state.records);
  notify();
  if (sync) onPersist();
}

/* ---------------------------------- Profile ---------------------------------- */

export function loadProfile(): void {
  const goals = readJson<Partial<Profile>>(KEYS.goals);
  const stored = readJson<Partial<Profile>>(KEYS.profile);
  state.profile = { ...DEFAULT_PROFILE, ...(goals ?? {}), ...(stored ?? {}) };
}

export function applyProfile(p: Partial<Profile>): void {
  state.profile = { ...state.profile, ...p };
  if (isDemo()) return;
  writeJson(KEYS.profile, state.profile);
  writeJson(KEYS.goals, { targetWeight: state.profile.targetWeight, targetBodyFat: state.profile.targetBodyFat });
}

export function saveProfile(p: Partial<Profile>): void {
  applyProfile(p);
  notify();
  onPersist();
}

export function resetLocalData(): void {
  [KEYS.records, KEYS.goals, KEYS.profile].forEach((k) => localStorage.removeItem(k));
  state.profile = { ...DEFAULT_PROFILE };
}

/* ---------------------------------- UI prefs --------------------------------- */

export function savePrefs(): void {
  writeJson(KEYS.prefs, {
    range: state.range,
    metric: state.metric,
    historyColumns: state.historyColumns ?? undefined,
  } satisfies Prefs);
}

export function displayName(): string {
  return isDemo() ? "Usuario demo" : state.profile.name || DEFAULT_NAME;
}
