import {
  BarController,
  BarElement,
  CategoryScale,
  Chart,
  Filler,
  LinearScale,
  LineController,
  LineElement,
  PointElement,
  Tooltip,
  type ChartDataset,
  type Plugin,
  type ScriptableContext,
  type TooltipItem,
} from "chart.js";
import { escapeHtml, fmt, fmtDate, fmtSigned, isNum, withUnit } from "./format";
import { DAY, METRICS, trendSeries, valueOf, type MetricKey, type WeekRow } from "./metrics";
import type { ChartMetric, FitRecord, Profile } from "./types";
import { cssVar } from "./ui";

Chart.register(LineController, LineElement, PointElement, LinearScale, CategoryScale, BarController, BarElement, Filler, Tooltip);

const instances = new Map<string, Chart>();

function release(key: string): void {
  instances.get(key)?.destroy();
  instances.delete(key);
}

/**
 * Replaces the chart stored under `key` with a new one drawn on a fresh copy of `canvas`.
 * WebKit (notably iOS home-screen apps) can leave a canvas blank when a chart is destroyed and
 * recreated on the same element, so each chart gets its own canvas. Charts are also drawn
 * without animation (see baseOptions): the first frame is then painted synchronously instead of
 * waiting for requestAnimationFrame, which iOS may delay or drop.
 */
function mount(key: string, canvas: HTMLCanvasElement, create: (canvas: HTMLCanvasElement) => Chart): void {
  release(key);
  const fresh = canvas.cloneNode(false) as HTMLCanvasElement;
  canvas.replaceWith(fresh);
  // Free the old backing store now: iOS caps the total memory used by canvases
  canvas.width = 0;
  canvas.height = 0;
  instances.set(key, create(fresh));
}

function palette() {
  return {
    fg: cssVar("--fg"),
    fg2: cssVar("--fg-2"),
    fg3: cssVar("--fg-3"),
    border: cssVar("--border"),
    surface: cssVar("--surface"),
    accent: cssVar("--accent"),
    positive: cssVar("--positive"),
    negative: cssVar("--negative"),
    s1: cssVar("--series-1"),
    s2: cssVar("--series-2"),
    s3: cssVar("--series-3"),
    muted: cssVar("--series-muted"),
  };
}

function withAlpha(color: string, alpha: number): string {
  if (color.startsWith("#") && color.length === 7) {
    const n = parseInt(color.slice(1), 16);
    return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
  }
  return color;
}

const isMobile = () => window.matchMedia("(max-width: 639px)").matches;

/** Vertical guide line under the tooltip. */
const crosshair: Plugin = {
  id: "crosshair",
  afterDatasetsDraw(chart) {
    const active = chart.tooltip?.getActiveElements?.();
    if (!active?.length) return;
    const x = active[0].element.x;
    const { top, bottom } = chart.chartArea;
    const ctx = chart.ctx;
    ctx.save();
    ctx.strokeStyle = cssVar("--border-strong");
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x, top);
    ctx.lineTo(x, bottom);
    ctx.stroke();
    ctx.restore();
  },
};

/** Labels the goal line at its right end. Off-scale goals are explained in the legend instead. */
function goalLabelPlugin(goal: number | null, unit: string, digits: number): Plugin {
  return {
    id: "goalLabel",
    afterDatasetsDraw(chart) {
      if (goal === null) return;
      const { ctx, chartArea, scales } = chart;
      const text = `Meta ${withUnit(fmt(goal, digits), unit)}`;
      ctx.save();
      ctx.font = '500 12px "Inter Variable", sans-serif';
      const w = ctx.measureText(text).width + 12;
      const x = chartArea.right - w;
      const y = scales.y.getPixelForValue(goal) - 24;
      ctx.fillStyle = cssVar("--surface");
      ctx.globalAlpha = 0.9;
      ctx.beginPath();
      ctx.roundRect(x, y, w, 20, 6);
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.fillStyle = cssVar("--accent");
      ctx.textBaseline = "middle";
      ctx.fillText(text, x + 6, y + 10.5);
      ctx.restore();
    },
  };
}

function dayStep(spanDays: number): number {
  const target = spanDays / (isMobile() ? 4 : 8);
  return [1, 2, 3, 7, 14, 30, 60, 90].find((s) => s >= target) ?? 180;
}

function baseOptions(p: ReturnType<typeof palette>) {
  return {
    responsive: true,
    maintainAspectRatio: false,
    animation: false as const,
    interaction: { mode: "nearest" as const, axis: "x" as const, intersect: false },
    plugins: {
      legend: { display: false },
      tooltip: {
        backgroundColor: p.surface,
        borderColor: p.border,
        borderWidth: 1,
        titleColor: p.fg,
        bodyColor: p.fg2,
        footerColor: p.fg,
        padding: 12,
        cornerRadius: 12,
        boxPadding: 6,
        usePointStyle: true,
        titleFont: { weight: 600 as const, size: 13 },
        bodyFont: { size: 13 },
        footerFont: { weight: 600 as const, size: 13 },
      },
    },
  };
}

export interface LegendItem {
  label: string;
  color: string;
  style: "line" | "dot" | "dash" | "area";
}

export function legendHtml(items: LegendItem[]): string {
  return items
    .map((it) => {
      const swatch =
        it.style === "dot"
          ? `<span class="size-2 rounded-full" style="background:${it.color}"></span>`
          : it.style === "area"
            ? `<span class="size-2.5 rounded-sm" style="background:${it.color}"></span>`
            : `<span class="w-4 h-0 border-t-2 ${it.style === "dash" ? "border-dashed" : ""}" style="border-color:${it.color}"></span>`;
      return `<span class="inline-flex items-center gap-2">${swatch}${escapeHtml(it.label)}</span>`;
    })
    .join("");
}

/* -------------------------------- Main chart --------------------------------- */

export function renderMainChart(
  canvas: HTMLCanvasElement,
  allRecords: FitRecord[],
  visible: FitRecord[],
  metric: ChartMetric,
  profile: Profile
): LegendItem[] {
  release("main");
  if (!visible.length) return [];
  const p = palette();
  const offset = allRecords.length - visible.length;
  const xMin = visible[0].timestamp - DAY / 2;
  const xMax = visible[visible.length - 1].timestamp + DAY / 2;
  const spanDays = Math.max(1, (xMax - xMin) / DAY);
  const opts = baseOptions(p);
  const mobile = isMobile();

  const xScale = {
    type: "linear" as const,
    min: xMin,
    max: xMax,
    grid: { display: false },
    border: { color: p.border },
    ticks: {
      color: p.fg3,
      font: { size: 12 },
      maxRotation: 0,
      stepSize: dayStep(spanDays) * DAY,
      callback: (v: number | string) => fmtDate(Number(v)),
    },
  };

  if (metric === "composition") {
    const lean = visible.map((r) => ({ x: r.timestamp, y: valueOf(r, "leanMassKg") }));
    const fat = visible.map((r) => ({ x: r.timestamp, y: valueOf(r, "fatMassKg") }));
    const datasets: ChartDataset<"line", { x: number; y: number | null }[]>[] = [
      { label: "Masa magra", data: lean, borderColor: p.s3, backgroundColor: withAlpha(p.s3, 0.18), fill: "origin", borderWidth: 2, pointRadius: 0, tension: 0.3, stack: "c" },
      { label: "Masa grasa", data: fat, borderColor: p.s2, backgroundColor: withAlpha(p.s2, 0.22), fill: "-1", borderWidth: 2, pointRadius: 0, tension: 0.3, stack: "c" },
    ];
    mount("main", canvas, (c) =>
      new Chart(c, {
        type: "line",
        data: { datasets },
        plugins: [crosshair],
        options: {
          ...opts,
          plugins: {
            ...opts.plugins,
            tooltip: {
              ...opts.plugins.tooltip,
              callbacks: {
                title: (items: TooltipItem<"line">[]) => fmtDate(items[0].parsed.x as number, { weekday: "short", day: "numeric", month: "short" }),
                label: (it: TooltipItem<"line">) => ` ${it.dataset.label}: ${fmt(it.parsed.y, 1)} kg`,
                footer: (items: TooltipItem<"line">[]) => `Total: ${fmt(items.reduce((a, it) => a + (it.parsed.y ?? 0), 0), 1)} kg`,
              },
            },
          },
          scales: {
            x: xScale,
            y: {
              stacked: true,
              beginAtZero: true,
              grid: { color: p.border },
              border: { display: false },
              ticks: { color: p.fg3, font: { size: 12 }, maxTicksLimit: 5, callback: (v: number | string) => `${v} kg` },
            },
          },
        },
      })
    );
    return [
      { label: "Masa magra", color: p.s3, style: "area" },
      { label: "Masa grasa", color: p.s2, style: "area" },
    ];
  }

  const key = metric as MetricKey;
  const def = METRICS[key];
  const trendAll = trendSeries(allRecords, key);
  const raw = visible.map((r) => ({ x: r.timestamp, y: valueOf(r, key) })).filter((d) => isNum(d.y));
  const trend = visible.map((r, i) => ({ x: r.timestamp, y: trendAll[offset + i] })).filter((d) => isNum(d.y));
  if (!raw.length) return [];

  const ys = raw.map((d) => d.y as number);
  let yMin = Math.min(...ys);
  let yMax = Math.max(...ys);
  const spread = Math.max(yMax - yMin, key === "weight" ? 1 : 0.8);
  yMin -= spread * 0.15;
  yMax += spread * 0.15;

  const goal = key === "weight" ? profile.targetWeight : key === "bodyFat" ? profile.targetBodyFat : null;
  let offScale: "above" | "below" | null = null;
  if (goal !== null) {
    const reach = spread * 1.5 + 1;
    if (goal < yMin && yMin - goal <= reach) yMin = goal - spread * 0.1;
    else if (goal > yMax && goal - yMax <= reach) yMax = goal + spread * 0.1;
    else if (goal < yMin) offScale = "below";
    else if (goal > yMax) offScale = "above";
  }
  // Round bounds to a readable step so the axis starts and ends on clean numbers
  const yStep = yMax - yMin <= 2 ? 0.5 : yMax - yMin <= 5 ? 1 : yMax - yMin <= 12 ? 2 : 5;
  yMin = Math.floor(yMin / yStep) * yStep;
  yMax = Math.ceil(yMax / yStep) * yStep;

  const trendColor = p.s1;
  const datasets: ChartDataset<"line", { x: number; y: number | null }[]>[] = [
    {
      label: "Tendencia (7 días)",
      data: trend,
      borderColor: trendColor,
      borderWidth: 2.5,
      pointRadius: 0,
      pointHoverRadius: 4,
      pointHoverBackgroundColor: trendColor,
      tension: 0.35,
      fill: "start",
      backgroundColor: (ctx: ScriptableContext<"line">) => {
        const area = ctx.chart.chartArea;
        if (!area) return "transparent";
        const g = ctx.chart.ctx.createLinearGradient(0, area.top, 0, area.bottom);
        g.addColorStop(0, withAlpha(p.accent, 0.14));
        g.addColorStop(1, withAlpha(p.accent, 0));
        return g;
      },
      order: 1,
    },
    {
      label: "Pesaje",
      data: raw,
      showLine: false,
      pointRadius: raw.length > 90 ? 1.5 : mobile ? 2.5 : 3,
      pointHoverRadius: 5,
      pointBackgroundColor: p.muted,
      pointBorderWidth: 0,
      order: 2,
    },
  ];
  if (goal !== null && !offScale) {
    datasets.push({
      label: "Meta",
      data: [
        { x: xMin, y: goal },
        { x: xMax, y: goal },
      ],
      borderColor: p.accent,
      borderWidth: 1.5,
      borderDash: [5, 5],
      pointRadius: 0,
      pointHitRadius: 0,
      order: 3,
    });
  }

  const unit = def.unit;
  mount("main", canvas, (c) =>
    new Chart(c, {
      type: "line",
      data: { datasets },
      plugins: offScale ? [crosshair] : [crosshair, goalLabelPlugin(goal, unit, 1)],
      options: {
        ...opts,
        plugins: {
          ...opts.plugins,
          tooltip: {
            ...opts.plugins.tooltip,
            filter: (it: TooltipItem<"line">) => it.dataset.label !== "Meta",
            callbacks: {
              title: (items: TooltipItem<"line">[]) => fmtDate(items[0].parsed.x as number, { weekday: "short", day: "numeric", month: "short" }),
              label: (it: TooltipItem<"line">) => ` ${it.dataset.label}: ${withUnit(fmt(it.parsed.y, key === "weight" ? 2 : 1), unit)}`,
            },
          },
        },
        scales: {
          x: xScale,
          y: {
            min: yMin,
            max: yMax,
            grid: { color: p.border },
            border: { display: false },
            ticks: {
              color: p.fg3,
              font: { size: 12 },
              stepSize: yStep,
              callback: (v: number | string) => withUnit(fmt(Number(v), yStep < 1 ? 1 : 0), unit),
            },
          },
        },
      },
    })
  );

  const legend: LegendItem[] = [
    { label: "Tendencia (media 7 días)", color: trendColor, style: "line" },
    { label: "Pesajes", color: p.muted, style: "dot" },
  ];
  if (goal !== null) {
    const goalText = withUnit(fmt(goal, 1), unit);
    legend.push({
      label: offScale ? `Meta ${goalText} (${offScale === "below" ? "por debajo" : "por encima"} de la escala)` : `Meta ${goalText}`,
      color: p.accent,
      style: "dash",
    });
  }
  return legend;
}

/* ------------------------------- Weekly chart -------------------------------- */

export function renderWeeklyChart(canvas: HTMLCanvasElement, weeks: WeekRow[], goalDirection: number): void {
  release("weekly");
  const rows = weeks.filter((w) => isNum(w.change));
  if (!rows.length) return;
  const p = palette();
  const opts = baseOptions(p);
  mount("weekly", canvas, (c) =>
    new Chart(c, {
      type: "bar",
      data: {
        labels: rows.map((w) => `S${w.index}`),
        datasets: [
          {
            data: rows.map((w) => w.change as number),
            backgroundColor: rows.map((w) => (Math.sign(w.change as number) === goalDirection ? p.positive : p.negative)),
            borderRadius: 6,
            maxBarThickness: 36,
          },
        ],
      },
      options: {
        ...opts,
        interaction: { mode: "index", intersect: false },
        plugins: {
          ...opts.plugins,
          tooltip: {
            ...opts.plugins.tooltip,
            displayColors: false,
            callbacks: {
              title: (items: TooltipItem<"bar">[]) => {
                const w = rows[items[0].dataIndex];
                return `Semana ${w.index} · ${fmtDate(w.startTs)} – ${fmtDate(w.endTs)}`;
              },
              label: (it: TooltipItem<"bar">) => {
                const w = rows[it.dataIndex];
                return `Media ${fmt(w.avgWeight, 1)} kg · ${fmtSigned(w.change, 1)} kg vs semana anterior`;
              },
            },
          },
        },
        scales: {
          x: { grid: { display: false }, border: { color: p.border }, ticks: { color: p.fg3, font: { size: 12 } } },
          y: {
            grid: { color: p.border },
            border: { display: false },
            ticks: { color: p.fg3, font: { size: 12 }, maxTicksLimit: 5, callback: (v: number | string) => `${fmtSigned(Number(v), 1)} kg` },
          },
        },
      },
    })
  );
}

export function destroyCharts(): void {
  instances.forEach((c) => c.destroy());
  instances.clear();
}

/* -------------------------------- Sparklines --------------------------------- */

export function sparkline(values: (number | null)[], width = 120, height = 36): string {
  const pts = values.map((v, i) => [i, v] as const).filter((d): d is readonly [number, number] => isNum(d[1]));
  if (pts.length < 2) return "";
  const xs = pts.map((d) => d[0]);
  const ys = pts.map((d) => d[1]);
  const x0 = Math.min(...xs);
  const x1 = Math.max(...xs);
  const y0 = Math.min(...ys);
  const y1 = Math.max(...ys);
  const pad = 3;
  const sx = (x: number) => pad + ((x - x0) / (x1 - x0 || 1)) * (width - pad * 2);
  const sy = (y: number) => height - pad - ((y - y0) / (y1 - y0 || 1)) * (height - pad * 2);
  const d = pts.map(([x, y], i) => `${i ? "L" : "M"}${sx(x).toFixed(1)} ${sy(y).toFixed(1)}`).join(" ");
  return `<svg class="w-full h-9" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" aria-hidden="true"><path d="${d}" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" vector-effect="non-scaling-stroke"/></svg>`;
}
