import { renderWeeklyChart, sparkline } from "../../lib/charts";
import { escapeHtml, fmt, fmtDate, fmtSigned, isNum, withUnit } from "../../lib/format";
import { ffmi, metricChange, summarize, toneOf, weeklyBreakdown, type MetricKey } from "../../lib/metrics";
import { state } from "../../lib/store";
import { $ } from "../../lib/ui";
import { unitLabel } from "./summary";

const ALL_METRICS: MetricKey[] = [
  "weight",
  "bodyFat",
  "fatMassKg",
  "leanMassKg",
  "skeletalMuscle",
  "muscleMass",
  "visceralFat",
  "subcutaneousFat",
  "bodyWater",
  "protein",
  "boneMass",
  "bmr",
  "metabolicAge",
  "bmi",
];

export function renderTrends(): void {
  const { records, profile } = state;
  const s = summarize(records, profile);
  const goalDirection = s?.goalDirection ?? -1;
  const weeks = weeklyBreakdown(records);

  $("weeks-count")!.textContent = weeks.length === 1 ? "1 semana" : `${weeks.length} semanas`;
  const hasChanges = weeks.some((w) => isNum(w.change));
  $("weekly-chart-wrap")!.hidden = !hasChanges;
  $("weekly-empty")!.hidden = hasChanges || !records.length;
  if (hasChanges) renderWeeklyChart($<HTMLCanvasElement>("weekly-chart")!, weeks, goalDirection);

  $("weekly-body")!.innerHTML = [...weeks]
    .reverse()
    .map((w) => {
      const tone = toneOf("weight", w.change, goalDirection);
      return `<tr>
        <td class="px-4 py-3 font-medium sm:pl-0">Semana ${w.index}</td>
        <td class="px-4 py-3 text-fg-2">${fmtDate(w.startTs)} – ${fmtDate(w.endTs)}</td>
        <td class="px-4 py-3 text-right">${fmt(w.avgWeight, 1)} kg</td>
        <td class="px-4 py-3 text-right">${isNum(w.change) ? `<span class="chip tone-${tone}">${fmtSigned(w.change, 1)} kg</span>` : '<span class="text-fg-3">–</span>'}</td>
        <td class="px-4 py-3 text-right text-fg-2">${isNum(w.avgFat) ? `${fmt(w.avgFat, 1)} %` : "–"}</td>
        <td class="px-4 py-3 text-right text-fg-2 sm:pr-0">${isNum(w.avgMuscle) ? `${fmt(w.avgMuscle, 1)} %` : "–"}</td>
      </tr>`;
    })
    .join("");

  const cards = ALL_METRICS.map((key) => {
    const m = metricChange(records, key, goalDirection);
    if (!isNum(m.current)) return "";
    const unit = unitLabel(key);
    return `<article class="card p-4 sm:p-5">
      <h3 class="text-sm font-medium text-fg-2">${m.def.label}</h3>
      <p class="mt-1.5 flex items-baseline gap-1.5">
        <span class="text-2xl font-semibold tracking-tight">${fmt(m.current, m.def.digits)}</span>
        <span class="text-sm text-fg-2">${unit}</span>
      </p>
      <p class="mt-0.5 text-sm font-medium text-tone-${m.tone}">${withUnit(fmtSigned(m.delta, m.def.digits), m.def.unit)}</p>
      <div class="mt-3 text-fg-3">${sparkline(m.series)}</div>
    </article>`;
  });

  const f = ffmi(records, profile.height);
  if (f) {
    cards.push(`<article class="card p-4 sm:p-5">
      <h3 class="text-sm font-medium text-fg-2">Índice de masa libre de grasa</h3>
      <p class="mt-1.5 flex items-baseline gap-1.5"><span class="text-2xl font-semibold tracking-tight">${fmt(f.normalized, 1)}</span><span class="text-sm text-fg-2">FFMI</span></p>
      <p class="mt-0.5 text-sm font-medium text-fg-2">${escapeHtml(f.label)}</p>
      <p class="mt-3 text-sm text-fg-3">Normalizado a 1,80 m · sin normalizar ${fmt(f.value, 1)}</p>
    </article>`);
  }
  $("all-metrics")!.innerHTML = cards.join("");
}
