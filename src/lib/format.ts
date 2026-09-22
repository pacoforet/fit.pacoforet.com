const DAY = 86_400_000;
const numberFormats = new Map<number, Intl.NumberFormat>();

function nf(digits: number): Intl.NumberFormat {
  let f = numberFormats.get(digits);
  if (!f) {
    f = new Intl.NumberFormat("es-ES", { minimumFractionDigits: digits, maximumFractionDigits: digits });
    numberFormats.set(digits, f);
  }
  return f;
}

export function isNum(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

/** 80,20 — Spanish decimals, en dash for missing values */
export function fmt(v: number | null | undefined, digits = 1): string {
  return isNum(v) ? nf(digits).format(v) : "–";
}

/** Signed value with a true minus sign: −2,30 / +0,4 / ±0,0 */
export function fmtSigned(v: number | null | undefined, digits = 1): string {
  if (!isNum(v)) return "–";
  const rounded = Number(v.toFixed(digits));
  if (rounded === 0) return `±${nf(digits).format(0)}`;
  return `${rounded > 0 ? "+" : "−"}${nf(digits).format(Math.abs(rounded))}`;
}

export function withUnit(value: string, unit: string): string {
  if (!unit) return value;
  return unit === "%" ? `${value} %` : `${value} ${unit}`;
}

export function fmtDate(ts: number, opts: Intl.DateTimeFormatOptions = { day: "numeric", month: "short" }): string {
  return new Date(ts).toLocaleDateString("es-ES", opts).replace(".", "");
}

export function fmtDateLong(ts: number): string {
  return fmtDate(ts, { day: "numeric", month: "short", year: "numeric" });
}

export function fmtTime(time: string): string {
  return time.slice(0, 5);
}

export function fmtRelativeDay(ts: number, now = Date.now()): string {
  const startOf = (t: number) => new Date(new Date(t).toDateString()).getTime();
  const days = Math.round((startOf(now) - startOf(ts)) / DAY);
  if (days === 0) return "hoy";
  if (days === 1) return "ayer";
  if (days > 1 && days < 7) return `hace ${days} días`;
  return fmtDate(ts);
}

export function fmtRelativeTime(ts: number, now = Date.now()): string {
  const minutes = Math.round((now - ts) / 60_000);
  if (minutes < 1) return "ahora";
  if (minutes < 60) return `hace ${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `hace ${hours} h`;
  return fmtRelativeDay(ts, now);
}

export function pluralize(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

export function escapeHtml(value: unknown): string {
  return String(value ?? "").replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string
  );
}
