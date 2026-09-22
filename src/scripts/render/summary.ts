import { legendHtml, renderMainChart, sparkline } from "../../lib/charts";
import { escapeHtml, fmt, fmtDate, fmtRelativeDay, fmtSigned, fmtTime, isNum, withUnit } from "../../lib/format";
import { icon, type IconName } from "../../lib/icons";
import {
  filterRange,
  lastWith,
  METRICS,
  metricChange,
  milestones,
  recomposition,
  summarize,
  toneOf,
  trendSeries,
  valueOf,
  weeklyBreakdown,
  type MetricKey,
  type Milestone,
  type Pace,
  type Summary,
} from "../../lib/metrics";
import { state } from "../../lib/store";
import type { ChartMetric, Tone } from "../../lib/types";
import { $ } from "../../lib/ui";

const PACE_TONE: Record<Pace, Tone> = { healthy: "positive", fast: "warning", slow: "neutral", stable: "neutral", against: "negative" };
const RANGE_LABEL = { "7d": "los últimos 7 días", "30d": "los últimos 30 días", "90d": "los últimos 90 días", all: "todo el periodo" };
const CHART_TITLE: Record<ChartMetric, string> = {
  weight: "Peso",
  bodyFat: "Grasa corporal",
  skeletalMuscle: "Músculo esquelético",
  composition: "Masa magra y masa grasa",
};

export const unitLabel = (key: MetricKey) => METRICS[key].unit || (key === "visceralFat" ? "nivel" : "");

function chip(text: string, tone: Tone): string {
  return `<span class="chip tone-${tone}">${escapeHtml(text)}</span>`;
}

function setText(id: string, text: string): void {
  const el = $(id);
  if (el) el.textContent = text;
}

export function renderSummary(): void {
  const { records, profile } = state;
  const empty = !records.length;
  $("empty-state")!.hidden = !empty || state.loading;
  $("summary-skeleton")!.hidden = !(empty && state.loading);
  $("summary-content")!.hidden = empty;
  if (empty) return;

  const s = summarize(records, profile)!;
  renderHero(s);
  renderGoal(s);
  renderKpis(s);
  renderChart();
  renderRecomposition(s);
  renderMilestones(s);
}

function insight(s: Summary): string {
  const goal = withUnit(fmt(state.profile.targetWeight, 1), "kg");
  if (s.daysTracked < 3) return "Registra unos días más para ver tu tendencia real, sin el ruido del agua y la comida.";
  const change = Math.abs(s.changeTotal);
  let text =
    change < 0.1
      ? `En ${s.daysTracked} días tu peso se ha mantenido estable.`
      : `En ${s.daysTracked} días has ${s.changeTotal < 0 ? "bajado" : "subido"} ${fmt(change, 1)} kg.`;
  if (s.goalReached) return `${text} Has alcanzado tu meta de ${goal}.`;
  if (s.plateau) return `${text} Llevas dos semanas estable: es normal, pero si continúa revisa calorías o actividad.`;
  if (s.pace === "against") return `${text} Tu tendencia actual se aleja de la meta de ${goal}.`;
  if (s.etaTs) text += ` A este ritmo llegarás a ${goal} hacia el ${fmtDate(s.etaTs, { day: "numeric", month: "long" })}.`;
  if (s.pace === "fast") text += " Es un ritmo rápido: prioriza proteína y entrenamiento de fuerza para conservar músculo.";
  return text;
}

function renderHero(s: Summary): void {
  setText("hero-weight", fmt(s.trendNow, 1));

  const pace = $("hero-pace")!;
  pace.hidden = !isNum(s.ratePerWeek);
  pace.className = `chip tone-${PACE_TONE[s.pace]}`;
  pace.textContent = s.paceLabel;

  const chips = [chip(`${fmtSigned(s.changeTotal, 1)} kg desde el inicio`, toneOf("weight", s.changeTotal, s.goalDirection))];
  if (isNum(s.change7d)) chips.push(chip(`${fmtSigned(s.change7d, 1)} kg en 7 días`, toneOf("weight", s.change7d, s.goalDirection)));
  if (isNum(s.ratePerWeek)) chips.push(chip(`${fmtSigned(s.ratePerWeek, 2)} kg/semana`, "neutral"));
  $("hero-deltas")!.innerHTML = chips.join("");

  setText("hero-insight", insight(s));
  setText("hero-last", `Último pesaje: ${fmt(s.latest.weight, 2)} kg · ${fmtRelativeDay(s.latest.timestamp)}, ${fmtTime(s.latest.time)}`);
}

function renderGoal(s: Summary): void {
  const { profile } = state;
  const pct = Math.round(s.goalProgress * 100);
  setText("goal-target", fmt(profile.targetWeight, 1));
  $("goal-bar")!.style.width = `${pct}%`;
  $("goal-bar-wrap")!.setAttribute("aria-valuenow", String(pct));
  setText("goal-start", `Inicio ${withUnit(fmt(s.first.weight, 1), "kg")}`);
  setText("goal-pct", `${pct} %`);
  setText("goal-remaining", s.goalReached ? "Conseguida" : withUnit(fmt(s.goalRemaining, 1), "kg"));

  const eta = $("goal-eta")!;
  const sameYear = s.etaTs && new Date(s.etaTs).getFullYear() === new Date().getFullYear();
  eta.textContent = s.goalReached ? "–" : s.etaTs ? fmtDate(s.etaTs, sameYear ? { day: "numeric", month: "short" } : { month: "short", year: "numeric" }) : "Sin estimar";
  eta.classList.toggle("text-fg-3", !s.etaTs && !s.goalReached);

  const fatR = lastWith(state.records, "bodyFat");
  const fat = fatR ? valueOf(fatR, "bodyFat") : null;
  setText("goal-fat", isNum(fat) ? `${fmt(fat, 1)} % → ${fmt(profile.targetBodyFat, 1)} %` : `${fmt(profile.targetBodyFat, 1)} %`);
}

function renderKpis(s: Summary): void {
  const keys: MetricKey[] = ["bodyFat", "leanMassKg", "visceralFat"];
  if (!lastWith(state.records, "visceralFat")) keys[2] = "skeletalMuscle";
  $("kpis")!.innerHTML = keys
    .map((key) => {
      const m = metricChange(state.records, key, s.goalDirection);
      if (!isNum(m.current)) return "";
      const unit = unitLabel(key);
      return `<article class="card p-5">
        <div class="flex items-center justify-between gap-2">
          <h3 class="text-sm font-medium text-fg-2">${m.def.label}</h3>
          ${chip(withUnit(fmtSigned(m.delta, m.def.digits), m.def.unit), m.tone)}
        </div>
        <p class="mt-2 flex items-baseline gap-1.5">
          <span class="text-3xl font-semibold tracking-tight">${fmt(m.current, m.def.digits)}</span>
          <span class="text-fg-2">${unit}</span>
        </p>
        <div class="mt-3 text-fg-3">${sparkline(trendSeries(state.records, key))}</div>
        <p class="mt-2 text-sm text-fg-3">Inicio: ${withUnit(fmt(m.start, m.def.digits), unit)}</p>
      </article>`;
    })
    .join("");
}

export function renderChart(): void {
  const { records, profile, metric, range } = state;
  document.querySelectorAll<HTMLButtonElement>("#metric-switch [data-metric]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.metric === metric)));
  document.querySelectorAll<HTMLButtonElement>("#range-switch [data-range]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.range === range)));

  const visible = filterRange(records, range);
  setText("chart-title", CHART_TITLE[metric]);

  let caption = "";
  if (metric === "composition") {
    const fat = metricChange(visible, "fatMassKg");
    const lean = metricChange(visible, "leanMassKg");
    if (isNum(fat.delta) && isNum(lean.delta)) caption = `Grasa ${fmtSigned(fat.delta, 1)} kg · Magra ${fmtSigned(lean.delta, 1)} kg en ${RANGE_LABEL[range]}`;
  } else {
    const key = metric as MetricKey;
    const trend = trendSeries(records, key).slice(records.length - visible.length).filter(isNum);
    if (trend.length > 1) {
      const delta = trend[trend.length - 1] - trend[0];
      caption = `${withUnit(fmtSigned(delta, 1), METRICS[key].unit)} en ${RANGE_LABEL[range]}`;
    }
  }
  setText("chart-caption", caption);

  const canvas = $<HTMLCanvasElement>("main-chart")!;
  canvas.setAttribute("aria-label", `${CHART_TITLE[metric]}: ${caption || "sin datos suficientes"}`);
  const legend = renderMainChart(canvas, records, visible, metric, profile);
  $("chart-legend")!.innerHTML = legendHtml(legend);
}

function renderRecomposition(s: Summary): void {
  const rc = recomposition(state.records);
  const split = $("recomp-split")!;
  const quality = $("recomp-quality")!;
  const list = $("recomp-list")!;
  const kcal = $("recomp-kcal")!;

  if (!rc) {
    setText("recomp-sub", "Tu báscula aún no ha registrado composición corporal.");
    split.hidden = true;
    quality.hidden = true;
    list.innerHTML = "";
    kcal.hidden = true;
    return;
  }

  const lost = rc.weightLost > 0.2;
  setText(
    "recomp-sub",
    lost
      ? `Desde el ${fmtDate(rc.from.timestamp)}: ${fmt(rc.weightLost, 1)} kg menos en la báscula`
      : `Desde el ${fmtDate(rc.from.timestamp)} tu peso apenas ha bajado`
  );

  quality.hidden = !rc.quality;
  if (rc.quality) {
    quality.className = `chip self-start tone-${rc.quality.tone}`;
    quality.textContent = rc.quality.label;
  }

  split.hidden = !lost || rc.fatShare === null;
  if (lost && rc.fatShare !== null) {
    const fatPct = Math.round(rc.fatShare * 100);
    $("recomp-bar")!.innerHTML =
      `<span class="h-full bg-accent transition-[width] duration-700" style="width:${fatPct}%"></span>` +
      (fatPct < 100 ? `<span class="h-full flex-1 bg-fg-3/40"></span>` : "");
    const leanText = rc.leanLost >= 0 ? `${fmt(rc.leanLost, 1)} kg de masa magra y agua` : `+${fmt(-rc.leanLost, 1)} kg de masa magra`;
    $("recomp-legend")!.innerHTML = `
      <span class="inline-flex items-center gap-2"><span class="size-2.5 rounded-full bg-accent"></span><span><strong class="font-semibold">${fmt(rc.fatLost, 1)} kg de grasa</strong> <span class="text-fg-2">(${fatPct} %)</span></span></span>
      <span class="inline-flex items-center gap-2 text-fg-2"><span class="size-2.5 rounded-full bg-fg-3/40"></span>${leanText}</span>`;
  }

  const rows: MetricKey[] = ["fatMassKg", "bodyFat", "leanMassKg", "visceralFat", "metabolicAge"];
  list.innerHTML = rows
    .map((key) => {
      const m = metricChange(state.records, key, s.goalDirection);
      if (!isNum(m.start) || !isNum(m.current)) return "";
      const unit = unitLabel(key);
      return `<div class="flex items-center justify-between gap-3 py-2.5">
        <dt class="text-sm text-fg-2">${m.def.label}</dt>
        <dd class="flex items-center gap-4 text-sm">
          <span class="text-fg-2">${fmt(m.start, m.def.digits)} → <span class="font-medium text-fg">${withUnit(fmt(m.current, m.def.digits), unit)}</span></span>
          <span class="w-14 text-right font-medium text-tone-${m.tone}">${fmtSigned(m.delta, m.def.digits)}</span>
        </dd>
      </div>`;
    })
    .join("");

  kcal.hidden = rc.fatLost <= 0.1;
  kcal.innerHTML = `${icon("flame", "size-4 text-fg-3")}<span>Equivale a unas ${fmt(Math.round(rc.kcal / 100) * 100, 0)} kcal de déficit acumulado</span>`;
}

const MILESTONE_ICON: Record<Milestone["kind"], IconName> = {
  start: "flag",
  threshold: "check",
  lowest: "award",
  bestWeek: "trendingDown",
  goal: "target",
};

function renderMilestones(s: Summary): void {
  const weeks = weeklyBreakdown(state.records);
  const items = milestones(state.records, state.profile, s, weeks);
  $("milestones")!.innerHTML = items
    .map((m, i) => {
      const done = m.ts !== null;
      const last = i === items.length - 1;
      let detail = m.detail;
      if (m.kind === "goal" && !done && s.etaTs) detail = `Estimación: ${fmtDate(s.etaTs, { day: "numeric", month: "long" })}`;
      const when = done ? ` · ${fmtDate(m.ts as number)}` : "";
      const iconName = !done && m.kind === "threshold" ? "target" : MILESTONE_ICON[m.kind];
      return `<li class="relative flex gap-4 ${last ? "" : "pb-5"}">
        ${last ? "" : `<span class="absolute left-4 top-9 bottom-1 w-px ${done ? "bg-border-strong" : "bg-border"}" aria-hidden="true"></span>`}
        <span class="relative grid size-8 shrink-0 place-items-center rounded-full ${done ? "bg-accent-soft text-accent" : "border border-dashed border-border-strong text-fg-3"}">${icon(iconName)}</span>
        <div class="min-w-0 pt-1">
          <p class="text-sm font-medium ${done ? "" : "text-fg-2"}">${escapeHtml(m.title)}</p>
          <p class="text-sm text-fg-2">${escapeHtml(detail)}${when}</p>
        </div>
      </li>`;
    })
    .join("");
}
