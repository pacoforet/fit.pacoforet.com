import { escapeHtml, fmt, fmtDate, fmtSigned, fmtTime, isNum } from "../../lib/format";
import { icon } from "../../lib/icons";
import { METRICS, summarize, toneOf, valueOf, type MetricKey } from "../../lib/metrics";
import { savePrefs, state } from "../../lib/store";
import type { FitRecord } from "../../lib/types";
import { $ } from "../../lib/ui";

interface Column {
  key: "date" | "change" | MetricKey;
  label: string;
  fixed?: boolean;
  default?: boolean;
}

const COLUMNS: Column[] = [
  { key: "date", label: "Fecha", fixed: true },
  { key: "weight", label: "Peso", fixed: true },
  { key: "change", label: "Cambio", default: true },
  { key: "bodyFat", label: "Grasa", default: true },
  { key: "skeletalMuscle", label: "Músculo", default: true },
  { key: "visceralFat", label: "Visceral", default: true },
  { key: "fatMassKg", label: "Masa grasa" },
  { key: "leanMassKg", label: "Masa magra" },
  { key: "muscleMass", label: "Masa muscular" },
  { key: "subcutaneousFat", label: "Subcutánea" },
  { key: "bodyWater", label: "Agua" },
  { key: "protein", label: "Proteína" },
  { key: "boneMass", label: "Masa ósea" },
  { key: "bmr", label: "Metab. basal" },
  { key: "metabolicAge", label: "Edad metab." },
  { key: "bmi", label: "IMC" },
];

const PAGE = 50;
let limit = PAGE;
let lastQuery = "";

const visibleColumns = () => {
  const chosen = state.historyColumns ?? COLUMNS.filter((c) => c.default).map((c) => c.key);
  return COLUMNS.filter((c) => c.fixed || chosen.includes(c.key));
};

function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function searchable(r: FitRecord): string {
  const [y, m, d] = r.date.split("-");
  return normalize(`${r.date} ${fmtDate(r.timestamp, { day: "numeric", month: "long", year: "numeric" })} ${fmtDate(r.timestamp)} ${Number(d)}/${Number(m)}/${y}`);
}

function cell(r: FitRecord, key: MetricKey): string {
  const def = METRICS[key];
  const v = valueOf(r, key);
  if (!isNum(v)) return '<span class="text-fg-3">–</span>';
  return `${fmt(v, key === "weight" ? 2 : def.digits)}${def.unit === "%" ? " %" : ""}`;
}

export function renderHistory(): void {
  const { records } = state;
  const s = summarize(records, state.profile);
  const goalDirection = s?.goalDirection ?? -1;
  const query = normalize(($<HTMLInputElement>("history-search")?.value ?? "").trim());
  if (query !== lastQuery) {
    limit = PAGE;
    lastQuery = query;
  }

  // Change vs the previous weigh-in, computed on the full chronological list
  const changes = new Map<string, number>();
  records.forEach((r, i) => i > 0 && changes.set(r.id, r.weight - records[i - 1].weight));

  const matches = [...records].reverse().filter((r) => !query || searchable(r).includes(query));
  const shown = matches.slice(0, limit);
  $("history-count")!.textContent =
    records.length === 1 ? "1 pesaje registrado" : `${fmt(records.length, 0)} pesajes registrados`;
  $("history-empty")!.hidden = shown.length > 0 || !records.length;
  $("history-more-wrap")!.hidden = matches.length <= limit;

  const cols = visibleColumns();
  $("history-head")!.innerHTML = `<tr class="text-left text-fg-2">${cols
    .map((c) => `<th scope="col" class="whitespace-nowrap px-4 py-3 font-medium ${c.key === "date" ? "" : "text-right"}">${c.label}${c.key !== "date" && c.key !== "change" && METRICS[c.key as MetricKey].unit && METRICS[c.key as MetricKey].unit !== "%" ? ` <span class="font-normal text-fg-3">(${METRICS[c.key as MetricKey].unit})</span>` : ""}</th>`)
    .join("")}<th scope="col" class="w-12"><span class="sr-only">Acciones</span></th></tr>`;

  $("history-body")!.innerHTML = shown
    .map((r) => {
      const tds = cols.map((c) => {
        if (c.key === "date")
          return `<td class="whitespace-nowrap px-4 py-3"><span class="font-medium">${fmtDate(r.timestamp, { day: "numeric", month: "short", year: "numeric" })}</span> <span class="text-fg-3">${fmtTime(r.time)}</span></td>`;
        if (c.key === "change") {
          const ch = changes.get(r.id);
          return `<td class="px-4 py-3 text-right">${isNum(ch) ? `<span class="font-medium text-tone-${toneOf("weight", ch, goalDirection)}">${fmtSigned(ch, 2)}</span>` : '<span class="text-fg-3">–</span>'}</td>`;
        }
        return `<td class="whitespace-nowrap px-4 py-3 text-right ${c.key === "weight" ? "font-semibold" : "text-fg-2"}">${cell(r, c.key)}</td>`;
      });
      return `<tr class="group hover:bg-surface-2/60">${tds.join("")}<td class="px-2 py-1.5 text-right">
        <button type="button" class="btn-icon size-9 text-fg-3 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 hover:text-negative" data-delete="${escapeHtml(r.id)}" aria-label="Eliminar el pesaje del ${fmtDate(r.timestamp, { day: "numeric", month: "long" })}">${icon("trash")}</button>
      </td></tr>`;
    })
    .join("");

  // Phone list grouped by month
  let currentMonth = "";
  $("history-list")!.innerHTML = shown
    .map((r) => {
      const month = fmtDate(r.timestamp, { month: "long", year: "numeric" });
      const header =
        month !== currentMonth
          ? `<h3 class="border-b border-border bg-surface-2 px-4 py-2 text-sm font-medium text-fg-2">${escapeHtml(month.charAt(0).toUpperCase() + month.slice(1))}</h3>`
          : "";
      currentMonth = month;
      const ch = changes.get(r.id);
      const parts = [
        isNum(r.bodyFat) ? `Grasa ${fmt(r.bodyFat, 1)} %` : null,
        isNum(r.skeletalMuscle) ? `Músculo ${fmt(r.skeletalMuscle, 1)} %` : null,
      ].filter(Boolean);
      return `${header}<div class="flex items-center gap-3 border-b border-border px-4 py-3 last:border-b-0">
        <div class="min-w-0 flex-1">
          <p class="font-medium">${fmtDate(r.timestamp, { weekday: "short", day: "numeric", month: "short" })} <span class="font-normal text-fg-3">· ${fmtTime(r.time)}</span></p>
          ${parts.length ? `<p class="text-sm text-fg-2">${parts.join(" · ")}</p>` : ""}
        </div>
        <div class="text-right">
          <p class="font-semibold">${fmt(r.weight, 2)} kg</p>
          ${isNum(ch) ? `<p class="text-sm font-medium text-tone-${toneOf("weight", ch, goalDirection)}">${fmtSigned(ch, 2)}</p>` : ""}
        </div>
        <button type="button" class="btn-icon -mr-2 text-fg-3 hover:text-negative" data-delete="${escapeHtml(r.id)}" aria-label="Eliminar el pesaje del ${fmtDate(r.timestamp, { day: "numeric", month: "long" })}">${icon("trash")}</button>
      </div>`;
    })
    .join("");

  renderColumnsMenu();
}

function renderColumnsMenu(): void {
  const menu = $("columns-menu");
  if (!menu) return;
  const visible = new Set(visibleColumns().map((c) => c.key));
  menu.innerHTML = COLUMNS.filter((c) => !c.fixed)
    .map(
      (c) => `<button type="button" class="menu-item" role="menuitemcheckbox" aria-checked="${visible.has(c.key)}" data-col="${c.key}">
        <span class="grid size-4 place-items-center rounded border ${visible.has(c.key) ? "border-fg bg-fg text-bg" : "border-border-strong"}">${visible.has(c.key) ? icon("check", "size-3") : ""}</span>
        ${c.label}
      </button>`
    )
    .join("");
}

export function setupHistory(onDelete: (id: string) => void): void {
  $("history-search")?.addEventListener("input", () => renderHistory());
  $("history-more")?.addEventListener("click", () => {
    limit += PAGE;
    renderHistory();
  });
  [$("history-body"), $("history-list")].forEach((el) =>
    el?.addEventListener("click", (e) => {
      const btn = (e.target as HTMLElement).closest<HTMLElement>("[data-delete]");
      if (btn) onDelete(btn.dataset.delete!);
    })
  );
  $("columns-menu")?.addEventListener("click", (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLElement>("[data-col]");
    if (!btn) return;
    const current = new Set(visibleColumns().filter((c) => !c.fixed).map((c) => c.key as string));
    const key = btn.dataset.col!;
    current.has(key) ? current.delete(key) : current.add(key);
    state.historyColumns = [...current];
    savePrefs();
    renderHistory();
    $("columns-menu")?.querySelector<HTMLElement>(`[data-col="${key}"]`)?.focus();
  });
}
