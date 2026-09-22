// Pure calculations. No DOM access here so everything is easy to reason about and test.
import { fmt, fmtSigned, isNum } from "./format";
import type { FitRecord, Profile, RangeKey, Tone } from "./types";

export const DAY = 86_400_000;
const WEEK = 7 * DAY;
const TREND_WINDOW_DAYS = 7;

export type MetricKey =
  | "weight"
  | "bodyFat"
  | "fatMassKg"
  | "leanMassKg"
  | "skeletalMuscle"
  | "muscleMass"
  | "visceralFat"
  | "subcutaneousFat"
  | "bodyWater"
  | "protein"
  | "boneMass"
  | "bmr"
  | "metabolicAge"
  | "bmi";

export interface MetricDef {
  key: MetricKey;
  label: string;
  unit: string;
  digits: number;
  /** Which direction counts as progress. "goal" means towards the weight goal. */
  better: "up" | "down" | "goal" | "neutral";
}

export const METRICS: Record<MetricKey, MetricDef> = {
  weight: { key: "weight", label: "Peso", unit: "kg", digits: 1, better: "goal" },
  bodyFat: { key: "bodyFat", label: "Grasa corporal", unit: "%", digits: 1, better: "down" },
  fatMassKg: { key: "fatMassKg", label: "Masa grasa", unit: "kg", digits: 1, better: "down" },
  leanMassKg: { key: "leanMassKg", label: "Masa magra", unit: "kg", digits: 1, better: "up" },
  skeletalMuscle: { key: "skeletalMuscle", label: "Músculo esquelético", unit: "%", digits: 1, better: "up" },
  muscleMass: { key: "muscleMass", label: "Masa muscular", unit: "kg", digits: 1, better: "up" },
  visceralFat: { key: "visceralFat", label: "Grasa visceral", unit: "", digits: 0, better: "down" },
  subcutaneousFat: { key: "subcutaneousFat", label: "Grasa subcutánea", unit: "%", digits: 1, better: "down" },
  bodyWater: { key: "bodyWater", label: "Agua corporal", unit: "%", digits: 1, better: "up" },
  protein: { key: "protein", label: "Proteína", unit: "%", digits: 1, better: "up" },
  boneMass: { key: "boneMass", label: "Masa ósea", unit: "kg", digits: 1, better: "neutral" },
  bmr: { key: "bmr", label: "Metabolismo basal", unit: "kcal", digits: 0, better: "neutral" },
  metabolicAge: { key: "metabolicAge", label: "Edad metabólica", unit: "años", digits: 0, better: "down" },
  bmi: { key: "bmi", label: "IMC", unit: "", digits: 1, better: "neutral" },
};

/** Reads a metric, deriving fat and lean mass when the scale did not export them. */
export function valueOf(r: FitRecord, key: MetricKey): number | null {
  if (key === "fatMassKg") {
    if (isNum(r.fatMassKg)) return r.fatMassKg;
    return isNum(r.bodyFat) ? r.weight * (r.bodyFat / 100) : null;
  }
  if (key === "leanMassKg") {
    if (isNum(r.leanMassKg)) return r.leanMassKg;
    if (isNum(r.fatFreeWeight)) return r.fatFreeWeight;
    const fat = valueOf(r, "fatMassKg");
    return isNum(fat) ? r.weight - fat : null;
  }
  const v = r[key];
  return isNum(v) ? v : null;
}

export function firstWith(records: FitRecord[], key: MetricKey): FitRecord | undefined {
  return records.find((r) => isNum(valueOf(r, key)));
}

export function lastWith(records: FitRecord[], key: MetricKey): FitRecord | undefined {
  for (let i = records.length - 1; i >= 0; i--) if (isNum(valueOf(records[i], key))) return records[i];
  return undefined;
}

export function rangeDays(range: RangeKey): number | null {
  return range === "7d" ? 7 : range === "30d" ? 30 : range === "90d" ? 90 : null;
}

export function filterRange(records: FitRecord[], range: RangeKey): FitRecord[] {
  const days = rangeDays(range);
  if (!days || !records.length) return records;
  const cutoff = records[records.length - 1].timestamp - days * DAY;
  return records.filter((r) => r.timestamp >= cutoff);
}

/** Time-based moving average: mean of the valid values in the 7 days ending at each record. */
export function trendSeries(records: FitRecord[], key: MetricKey = "weight", windowDays = TREND_WINDOW_DAYS): (number | null)[] {
  const out: (number | null)[] = [];
  let start = 0;
  for (let i = 0; i < records.length; i++) {
    const t = records[i].timestamp;
    while (records[start].timestamp <= t - windowDays * DAY) start++;
    let sum = 0;
    let n = 0;
    for (let j = start; j <= i; j++) {
      const v = valueOf(records[j], key);
      if (isNum(v)) {
        sum += v;
        n++;
      }
    }
    out.push(n ? sum / n : null);
  }
  return out;
}

/** Trend value at (or right before) a timestamp. */
function trendAt(records: FitRecord[], trend: (number | null)[], ts: number): number | null {
  let value: number | null = null;
  for (let i = 0; i < records.length && records[i].timestamp <= ts; i++) {
    if (isNum(trend[i])) value = trend[i];
  }
  return value;
}

/** Least-squares slope in units per week over the last `days` days. */
export function slopePerWeek(records: FitRecord[], key: MetricKey, days = 14): number | null {
  if (records.length < 2) return null;
  const end = records[records.length - 1].timestamp;
  let pts = records.filter((r) => r.timestamp >= end - days * DAY && isNum(valueOf(r, key)));
  if (pts.length < 3 || end - pts[0].timestamp < 4 * DAY) pts = records.filter((r) => isNum(valueOf(r, key)));
  if (pts.length < 2 || end - pts[0].timestamp < DAY) return null;
  const xs = pts.map((r) => (r.timestamp - pts[0].timestamp) / WEEK);
  const ys = pts.map((r) => valueOf(r, key) as number);
  const mx = xs.reduce((a, b) => a + b, 0) / xs.length;
  const my = ys.reduce((a, b) => a + b, 0) / ys.length;
  let num = 0;
  let den = 0;
  for (let i = 0; i < xs.length; i++) {
    num += (xs[i] - mx) * (ys[i] - my);
    den += (xs[i] - mx) ** 2;
  }
  return den ? num / den : null;
}

/** Tone of a change for a metric: whether it is progress, a setback, or noise. */
export function toneOf(key: MetricKey, delta: number | null, goalDirection = -1): Tone {
  if (!isNum(delta)) return "neutral";
  const def = METRICS[key];
  const epsilon = def.digits === 0 ? 0.5 : 0.5 * 10 ** -def.digits;
  if (Math.abs(delta) < epsilon || def.better === "neutral") return "neutral";
  const good = def.better === "up" ? 1 : def.better === "down" ? -1 : goalDirection;
  return Math.sign(delta) === good ? "positive" : "negative";
}

export type Pace = "healthy" | "fast" | "slow" | "stable" | "against";

export interface Summary {
  first: FitRecord;
  latest: FitRecord;
  daysTracked: number;
  trend: (number | null)[];
  trendNow: number;
  changeTotal: number;
  change7d: number | null;
  ratePerWeek: number | null;
  pace: Pace;
  paceLabel: string;
  goalDirection: number; // -1 losing, +1 gaining
  goalProgress: number; // 0..1
  goalRemaining: number; // kg, >= 0
  goalReached: boolean;
  etaTs: number | null;
  plateau: boolean;
}

const PACE_LABEL: Record<Pace, string> = {
  healthy: "Ritmo saludable",
  fast: "Ritmo rápido",
  slow: "Ritmo lento",
  stable: "Peso estable",
  against: "Alejándote de la meta",
};

export function summarize(records: FitRecord[], profile: Profile): Summary | null {
  if (!records.length) return null;
  const first = records[0];
  const latest = records[records.length - 1];
  const trend = trendSeries(records, "weight");
  const trendNow = (trend[trend.length - 1] ?? latest.weight) as number;
  const daysTracked = Math.max(0, Math.round((latest.timestamp - first.timestamp) / DAY));

  const trend7 = daysTracked >= 7 ? trendAt(records, trend, latest.timestamp - 7 * DAY) : null;
  const trend14 = daysTracked >= 10 ? trendAt(records, trend, latest.timestamp - 14 * DAY) ?? trend[0] : null;

  const goalDirection = profile.targetWeight >= first.weight ? 1 : -1;
  const ratePerWeek = slopePerWeek(records, "weight");

  let pace: Pace = "stable";
  if (isNum(ratePerWeek)) {
    const pct = (Math.abs(ratePerWeek) / trendNow) * 100;
    if (pct < 0.2) pace = "stable";
    else if (Math.sign(ratePerWeek) !== goalDirection) pace = "against";
    else if (pct > 1) pace = "fast";
    else if (pct < 0.35) pace = "slow";
    else pace = "healthy";
  }

  const totalToGoal = profile.targetWeight - first.weight;
  const done = trendNow - first.weight;
  const goalReached = goalDirection < 0 ? trendNow <= profile.targetWeight : trendNow >= profile.targetWeight;
  const goalProgress = goalReached ? 1 : totalToGoal ? Math.min(1, Math.max(0, done / totalToGoal)) : 0;
  const goalRemaining = goalReached ? 0 : Math.abs(profile.targetWeight - trendNow);

  let etaTs: number | null = null;
  if (!goalReached && isNum(ratePerWeek) && Math.sign(ratePerWeek) === goalDirection && Math.abs(ratePerWeek) > 0.05) {
    const weeks = goalRemaining / Math.abs(ratePerWeek);
    if (weeks < 260) etaTs = latest.timestamp + weeks * WEEK;
  }

  return {
    first,
    latest,
    daysTracked,
    trend,
    trendNow,
    changeTotal: trendNow - first.weight,
    change7d: isNum(trend7) ? trendNow - trend7 : null,
    ratePerWeek,
    pace,
    paceLabel: PACE_LABEL[pace],
    goalDirection,
    goalProgress,
    goalRemaining,
    goalReached,
    etaTs,
    plateau: isNum(trend14) && Math.abs(trendNow - trend14) < 0.25,
  };
}

export interface MetricChange {
  def: MetricDef;
  start: number | null;
  current: number | null;
  delta: number | null;
  tone: Tone;
  series: (number | null)[];
}

export function metricChange(records: FitRecord[], key: MetricKey, goalDirection = -1): MetricChange {
  const def = METRICS[key];
  const firstR = firstWith(records, key);
  const lastR = lastWith(records, key);
  const start = firstR ? valueOf(firstR, key) : null;
  const current = lastR ? valueOf(lastR, key) : null;
  const delta = isNum(start) && isNum(current) ? current - start : null;
  return {
    def,
    start,
    current,
    delta,
    tone: toneOf(key, delta, goalDirection),
    series: records.map((r) => valueOf(r, key)),
  };
}

export interface WeekRow {
  index: number;
  startTs: number;
  endTs: number;
  count: number;
  avgWeight: number;
  change: number | null; // vs previous week's average
  avgFat: number | null;
  avgMuscle: number | null;
}

export function weeklyBreakdown(records: FitRecord[]): WeekRow[] {
  if (!records.length) return [];
  const origin = records[0].timestamp;
  const buckets = new Map<number, FitRecord[]>();
  for (const r of records) {
    const idx = Math.floor((r.timestamp - origin) / WEEK);
    if (!buckets.has(idx)) buckets.set(idx, []);
    buckets.get(idx)!.push(r);
  }
  const avg = (xs: (number | null | undefined)[]) => {
    const v = xs.filter(isNum);
    return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
  };
  const rows: WeekRow[] = [];
  let prev: number | null = null;
  for (const idx of [...buckets.keys()].sort((a, b) => a - b)) {
    const items = buckets.get(idx)!;
    const avgWeight = avg(items.map((r) => r.weight)) as number;
    rows.push({
      index: idx + 1,
      startTs: items[0].timestamp,
      endTs: items[items.length - 1].timestamp,
      count: items.length,
      avgWeight,
      change: prev === null ? null : avgWeight - prev,
      avgFat: avg(items.map((r) => r.bodyFat)),
      avgMuscle: avg(items.map((r) => r.skeletalMuscle)),
    });
    prev = avgWeight;
  }
  return rows;
}

export interface Recomposition {
  from: FitRecord;
  to: FitRecord;
  weightLost: number;
  fatLost: number;
  leanLost: number;
  fatShare: number | null; // 0..1 share of the weight change that was fat
  quality: { label: string; tone: Tone } | null;
  kcal: number;
}

export function recomposition(records: FitRecord[]): Recomposition | null {
  const from = records.find((r) => isNum(r.bodyFat));
  const to = lastWith(records, "bodyFat");
  if (!from || !to || from === to) return null;
  const fat0 = valueOf(from, "fatMassKg") as number;
  const fat1 = valueOf(to, "fatMassKg") as number;
  const lean0 = valueOf(from, "leanMassKg") as number;
  const lean1 = valueOf(to, "leanMassKg") as number;
  const weightLost = from.weight - to.weight;
  const fatLost = fat0 - fat1;
  const leanLost = lean0 - lean1;
  const fatShare = weightLost > 0.2 ? Math.min(1, Math.max(0, fatLost / weightLost)) : null;
  let quality: Recomposition["quality"] = null;
  if (fatShare !== null) {
    if (fatShare >= 0.75) quality = { label: "Pérdida de calidad alta", tone: "positive" };
    else if (fatShare >= 0.5) quality = { label: "Pérdida de calidad media", tone: "warning" };
    else quality = { label: "Pierdes más masa magra que grasa", tone: "negative" };
  }
  return { from, to, weightLost, fatLost, leanLost, fatShare, quality, kcal: Math.max(0, fatLost) * 7700 };
}

export interface Milestone {
  kind: "start" | "threshold" | "lowest" | "bestWeek" | "goal";
  title: string;
  detail: string;
  ts: number | null; // null = pending
  value?: number;
}

export function milestones(records: FitRecord[], profile: Profile, summary: Summary, weeks: WeekRow[]): Milestone[] {
  const out: Milestone[] = [];
  const { first, goalDirection } = summary;
  out.push({ kind: "start", title: "Inicio", detail: `${fmt(first.weight, 1)} kg`, ts: first.timestamp, value: first.weight });

  // Round numbers crossed on the way to the goal (every 5 kg)
  const thresholds: number[] = [];
  if (goalDirection < 0) {
    for (let t = Math.floor(first.weight / 5) * 5; t > profile.targetWeight; t -= 5) if (t < first.weight) thresholds.push(t);
  } else {
    for (let t = Math.ceil(first.weight / 5) * 5; t < profile.targetWeight; t += 5) if (t > first.weight) thresholds.push(t);
  }
  let nextPending: Milestone | null = null;
  for (const t of thresholds) {
    const hit = records.find((r) => (goalDirection < 0 ? r.weight < t : r.weight > t));
    if (hit) {
      out.push({ kind: "threshold", title: `${goalDirection < 0 ? "Por debajo de" : "Por encima de"} ${t} kg`, detail: "Primer pesaje", ts: hit.timestamp, value: t });
    } else if (!nextPending) {
      nextPending = { kind: "threshold", title: `${goalDirection < 0 ? "Bajar de" : "Superar"} ${t} kg`, detail: `Faltan ${fmt(Math.abs(summary.trendNow - t), 1)} kg`, ts: null, value: t };
    }
  }

  const extreme = records.reduce((best, r) => ((goalDirection < 0 ? r.weight < best.weight : r.weight > best.weight) ? r : best), records[0]);
  if (extreme !== first) {
    out.push({ kind: "lowest", title: goalDirection < 0 ? "Mínimo histórico" : "Máximo histórico", detail: `${fmt(extreme.weight, 1)} kg`, ts: extreme.timestamp, value: extreme.weight });
  }

  const best = weeks
    .filter((w) => isNum(w.change) && Math.sign(w.change as number) === goalDirection)
    .sort((a, b) => Math.abs(b.change as number) - Math.abs(a.change as number))[0];
  if (best) {
    out.push({ kind: "bestWeek", title: "Mejor semana", detail: `Semana ${best.index} · ${fmtSigned(best.change, 1)} kg`, ts: best.endTs });
  }

  out.sort((a, b) => (a.ts ?? 0) - (b.ts ?? 0));
  if (nextPending) out.push(nextPending);
  out.push({
    kind: "goal",
    title: `Meta: ${fmt(profile.targetWeight, 1)} kg`,
    detail: summary.goalReached ? "Conseguida" : summary.etaTs ? "Estimación según tu ritmo" : "Sigue registrando para estimar",
    ts: summary.goalReached ? summary.latest.timestamp : null,
  });
  return out;
}

export interface Ffmi {
  value: number;
  normalized: number;
  label: string;
}

export function ffmi(records: FitRecord[], heightM: number): Ffmi | null {
  const r = lastWith(records, "leanMassKg");
  if (!r || !heightM) return null;
  const lean = valueOf(r, "leanMassKg") as number;
  const value = lean / (heightM * heightM);
  const normalized = value + 6.1 * (1.8 - heightM);
  const label = normalized >= 22 ? "Muy alto" : normalized >= 20 ? "Excelente" : normalized >= 18 ? "Por encima de la media" : "Promedio";
  return { value, normalized, label };
}
