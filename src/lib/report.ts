// Shareable progress image (1080×1350, 4:5). Every figure comes from the same calculations as the dashboard.
import { fmt, fmtDateLong, fmtSigned, isNum, withUnit } from "./format";
import { metricChange, recomposition, summarize, type MetricKey } from "./metrics";
import type { FitRecord, Profile, Tone } from "./types";

const W = 1080;
const H = 1350;
const FONT = '"Inter Variable", system-ui, sans-serif';
const C = {
  bg: "#09090b",
  card: "#131316",
  border: "#26262b",
  fg: "#fafafa",
  fg2: "#a1a1aa",
  fg3: "#71717a",
  accent: "#34d399",
  negative: "#fb7185",
  warning: "#fbbf24",
};

const toneColor = (t: Tone) => (t === "positive" ? C.accent : t === "negative" ? C.negative : t === "warning" ? C.warning : C.fg2);

function font(weight: number, size: number) {
  return `${weight} ${size}px ${FONT}`;
}

function card(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number) {
  ctx.fillStyle = C.card;
  ctx.strokeStyle = C.border;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, 32);
  ctx.fill();
  ctx.stroke();
}

export async function drawReport(canvas: HTMLCanvasElement, records: FitRecord[], profile: Profile, name: string): Promise<void> {
  const s = summarize(records, profile);
  if (!s) return;
  try {
    await document.fonts.load(font(700, 40));
  } catch {
    // Fallback font is fine
  }

  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = C.bg;
  ctx.fillRect(0, 0, W, H);

  const glow = ctx.createRadialGradient(W - 120, 80, 20, W - 120, 80, 700);
  glow.addColorStop(0, "rgba(52, 211, 153, 0.16)");
  glow.addColorStop(1, "rgba(52, 211, 153, 0)");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, W, H);

  const M = 72;
  ctx.textBaseline = "alphabetic";

  // Header
  ctx.fillStyle = C.accent;
  ctx.font = font(600, 26);
  ctx.fillText("Informe de progreso", M, 120);
  ctx.fillStyle = C.fg;
  ctx.font = font(700, 56);
  ctx.fillText(name, M, 190);
  ctx.fillStyle = C.fg2;
  ctx.font = font(500, 28);
  ctx.fillText(`${fmtDateLong(s.first.timestamp)} – ${fmtDateLong(s.latest.timestamp)} · ${s.daysTracked} días`, M, 236);

  // Hero
  card(ctx, M, 290, W - M * 2, 330);
  ctx.fillStyle = C.fg2;
  ctx.font = font(500, 28);
  ctx.fillText("Cambio de peso (tendencia)", M + 48, 360);
  ctx.fillStyle = C.fg;
  ctx.font = font(700, 104);
  const big = `${fmtSigned(s.changeTotal, 1)} kg`;
  ctx.fillText(big, M + 44, 490);
  ctx.fillStyle = C.fg2;
  ctx.font = font(500, 28);
  ctx.fillText(`${fmt(s.first.weight, 1)} kg → ${fmt(s.trendNow, 1)} kg`, M + 48, 548);
  if (isNum(s.ratePerWeek)) {
    ctx.fillStyle = s.pace === "healthy" ? C.accent : s.pace === "fast" ? C.warning : C.fg2;
    ctx.fillText(`${fmtSigned(s.ratePerWeek, 2)} kg/sem · ${s.paceLabel.toLowerCase()}`, M + 48, 590);
  }

  // Sparkline of the trend inside the hero card
  const trend = s.trend.filter(isNum);
  if (trend.length > 1) {
    const x0 = W - M - 48 - 340;
    const y0 = 380;
    const w = 340;
    const h = 150;
    const min = Math.min(...trend);
    const max = Math.max(...trend);
    ctx.strokeStyle = C.accent;
    ctx.lineWidth = 5;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.beginPath();
    trend.forEach((v, i) => {
      const x = x0 + (i / (trend.length - 1)) * w;
      const y = y0 + h - ((v - min) / (max - min || 1)) * h;
      if (i) ctx.lineTo(x, y);
      else ctx.moveTo(x, y);
    });
    ctx.stroke();
  }

  // Metric tiles
  const tiles: MetricKey[] = ["bodyFat", "fatMassKg", "leanMassKg", "visceralFat"];
  const tileW = (W - M * 2 - 24) / 2;
  const tileH = 190;
  tiles.forEach((key, i) => {
    const m = metricChange(records, key, s.goalDirection);
    const x = M + (i % 2) * (tileW + 24);
    const y = 650 + Math.floor(i / 2) * (tileH + 24);
    card(ctx, x, y, tileW, tileH);
    ctx.fillStyle = C.fg2;
    ctx.font = font(500, 26);
    ctx.fillText(m.def.label, x + 36, y + 58);
    ctx.fillStyle = C.fg;
    ctx.font = font(700, 54);
    ctx.fillText(withUnit(fmt(m.current, m.def.digits), m.def.unit), x + 36, y + 126);
    ctx.fillStyle = toneColor(m.tone);
    ctx.font = font(600, 26);
    ctx.fillText(`${withUnit(fmtSigned(m.delta, m.def.digits), m.def.unit)} desde el inicio`, x + 36, y + 166);
  });

  // Goal progress
  const gy = 1082;
  card(ctx, M, gy, W - M * 2, 150);
  ctx.fillStyle = C.fg;
  ctx.font = font(600, 28);
  ctx.fillText(`Meta ${fmt(profile.targetWeight, 1)} kg`, M + 48, gy + 56);
  ctx.fillStyle = C.fg2;
  ctx.font = font(500, 26);
  const right = s.goalReached ? "Conseguida" : `${Math.round(s.goalProgress * 100)} % · faltan ${fmt(s.goalRemaining, 1)} kg`;
  const rw = ctx.measureText(right).width;
  ctx.fillText(right, W - M - 48 - rw, gy + 56);
  const bx = M + 48;
  const bw = W - M * 2 - 96;
  ctx.fillStyle = C.border;
  ctx.beginPath();
  ctx.roundRect(bx, gy + 88, bw, 16, 8);
  ctx.fill();
  ctx.fillStyle = C.accent;
  ctx.beginPath();
  ctx.roundRect(bx, gy + 88, Math.max(16, bw * s.goalProgress), 16, 8);
  ctx.fill();

  // Footer
  const rc = recomposition(records);
  ctx.fillStyle = C.fg3;
  ctx.font = font(500, 24);
  const foot = rc?.fatShare != null ? `${Math.round(rc.fatShare * 100)} % del peso perdido fue grasa · Báscula RENPHO` : "Báscula RENPHO";
  ctx.fillText(foot, M, H - 64);
}

export function reportFileName(name: string): string {
  const safe = (name || "fit").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-");
  return `${safe}-progreso-${new Date().toISOString().split("T")[0]}.png`;
}
