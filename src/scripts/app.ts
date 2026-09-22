// Entry point: authentication, routing between views and all user actions.
import { destroyCharts } from "../lib/charts";
import { downloadBlob, parseRenphoCsv, toCsv, today } from "../lib/csv";
import { fmt, fmtDate } from "../lib/format";
import { drawReport, reportFileName } from "../lib/report";
import {
  DEMO_IDS,
  DEMO_RECORDS,
  DEMO_SESSION,
  KEYS,
  SERVER_SESSION,
  commitRecords,
  displayName,
  isDemo,
  loadProfile,
  loadRecords,
  resetLocalData,
  saveProfile,
  savePrefs,
  sessionKind,
  setPersistHook,
  state,
  subscribe,
} from "../lib/store";
import { pushToCloud, setSessionExpiredHandler, syncFromCloud } from "../lib/sync";
import type { ChartMetric, FitRecord, RangeKey, ViewKey } from "../lib/types";
import { $, closeDialog, confirmAction, isDark, openDialog, setTheme, setupDialogs, setupMenus, toast } from "../lib/ui";
import { renderChrome, renderView } from "./render/chrome";
import { renderHistory, setupHistory } from "./render/history";
import { renderChart, renderSummary } from "./render/summary";
import { renderTrends } from "./render/trends";

const VIEWS: ViewKey[] = ["resumen", "tendencias", "historial"];
let started = false;

/* --------------------------------- Rendering --------------------------------- */

function renderActive(): void {
  renderChrome();
  if (state.view === "resumen") renderSummary();
  else if (state.view === "tendencias") renderTrends();
  else renderHistory();
}

subscribe((reason) => {
  if (!started) return;
  if (reason === "sync") renderChrome();
  else renderActive();
});

function viewFromHash(): ViewKey {
  const v = location.hash.replace("#", "") as ViewKey;
  return VIEWS.includes(v) ? v : "resumen";
}

function setView(view: ViewKey, { scroll = true } = {}): void {
  state.view = view;
  renderView(view);
  if (started) renderActive();
  if (scroll) window.scrollTo({ top: 0 });
}

/* ---------------------------------- Session ---------------------------------- */

function showGate(): void {
  document.documentElement.removeAttribute("data-session");
  started = false;
  destroyCharts();
  $<HTMLInputElement>("login-user")?.focus();
}

function startApp(): void {
  document.documentElement.setAttribute("data-session", "");
  loadProfile();
  loadRecords();
  state.loading = sessionKind() === "server" && !state.records.length;
  state.view = viewFromHash();
  started = true;
  renderView(state.view);
  renderActive();
  void syncFromCloud();
}

setSessionExpiredHandler(() => {
  localStorage.removeItem(KEYS.auth);
  showGate();
  const err = $("login-error");
  if (err) {
    err.textContent = "Tu sesión ha caducado. Vuelve a entrar.";
    err.hidden = false;
  }
});

setPersistHook(() => void pushToCloud());

$("login-form")?.addEventListener("submit", async (e) => {
  e.preventDefault();
  const user = $<HTMLInputElement>("login-user")!.value.trim();
  const pass = $<HTMLInputElement>("login-pass")!.value.trim();
  const error = $("login-error")!;
  const submit = $<HTMLButtonElement>("login-submit")!;
  error.hidden = true;

  if (!user || !pass) {
    error.textContent = "Escribe tu usuario y tu contraseña.";
    error.hidden = false;
    return;
  }
  if (user.toLowerCase() === "demo" && pass.toLowerCase() === "demo") {
    localStorage.setItem(KEYS.auth, DEMO_SESSION);
    return startApp();
  }

  submit.disabled = true;
  submit.textContent = "Entrando…";
  let ok = false;
  try {
    const res = await fetch("/api/session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ user, pass }),
    });
    ok = res.ok;
  } catch (err) {
    console.error("Login error:", err);
  }
  submit.disabled = false;
  submit.textContent = "Entrar";

  if (ok) {
    $<HTMLInputElement>("login-pass")!.value = "";
    localStorage.setItem(KEYS.auth, SERVER_SESSION);
    startApp();
  } else {
    error.textContent = "El usuario o la contraseña no son correctos.";
    error.hidden = false;
  }
});

$("btn-demo")?.addEventListener("click", () => {
  localStorage.setItem(KEYS.auth, DEMO_SESSION);
  startApp();
});

$("menu-logout")?.addEventListener("click", async () => {
  const wasServer = sessionKind() === "server";
  localStorage.removeItem(KEYS.auth);
  if (wasServer) {
    try {
      await fetch("/api/session", { method: "DELETE" });
    } catch {
      // The cookie expires on its own
    }
  }
  location.hash = "";
  location.reload();
});

/* -------------------------------- Navigation --------------------------------- */

window.addEventListener("hashchange", () => setView(viewFromHash()));
document.querySelectorAll<HTMLElement>("[data-view-link]").forEach((el) =>
  el.addEventListener("click", () => {
    const view = el.dataset.viewLink as ViewKey;
    if (location.hash !== `#${view}`) location.hash = view;
    else setView(view);
  })
);

$("metric-switch")?.addEventListener("click", (e) => {
  const btn = (e.target as HTMLElement).closest<HTMLElement>("[data-metric]");
  if (!btn) return;
  state.metric = btn.dataset.metric as ChartMetric;
  savePrefs();
  renderChart();
});

$("range-switch")?.addEventListener("click", (e) => {
  const btn = (e.target as HTMLElement).closest<HTMLElement>("[data-range]");
  if (!btn) return;
  state.range = btn.dataset.range as RangeKey;
  savePrefs();
  renderChart();
});

$("menu-theme")?.addEventListener("click", () => {
  setTheme(!isDark());
  if (started) renderActive();
});

$("sync-btn")?.addEventListener("click", () => {
  if (isDemo()) return toast("La demo usa datos de ejemplo y no se sincroniza.");
  void syncFromCloud();
});

let lastAutoSync = 0;
const autoSync = () => {
  if (!started || document.visibilityState !== "visible" || Date.now() - lastAutoSync < 30_000) return;
  lastAutoSync = Date.now();
  void syncFromCloud({ silent: true });
};
document.addEventListener("visibilitychange", autoSync);
window.addEventListener("focus", autoSync);
// Keeps "Sincronizado hace X min" fresh
setInterval(() => started && renderChrome(), 60_000);

/* ------------------------------- Add weigh-in -------------------------------- */

document.querySelectorAll('[data-open="dlg-entry"]').forEach((btn) =>
  btn.addEventListener("click", () => {
    const now = new Date();
    $<HTMLInputElement>("m-date")!.value = today();
    $<HTMLInputElement>("m-time")!.value = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
    setTimeout(() => $<HTMLInputElement>("m-weight")?.focus(), 50);
  })
);

$("entry-form")?.addEventListener("submit", (e) => {
  e.preventDefault();
  const num = (id: string) => {
    const v = parseFloat($<HTMLInputElement>(id)!.value.replace(",", "."));
    return Number.isFinite(v) ? v : null;
  };
  const weight = num("m-weight");
  const date = $<HTMLInputElement>("m-date")!.value;
  let time = $<HTMLInputElement>("m-time")!.value || "08:00";
  if (time.length === 5) time += ":00";
  if (!weight || weight < 20 || weight > 400 || !date) {
    $<HTMLInputElement>("m-weight")!.reportValidity();
    return;
  }

  const bodyFat = num("m-fat");
  const iso = `${date}T${time}`;
  const fatMassKg = bodyFat ? +(weight * (bodyFat / 100)).toFixed(2) : null;
  const h = state.profile.height;
  const record: FitRecord = {
    id: `${date}_${time}`,
    date,
    time,
    iso,
    timestamp: new Date(iso).getTime(),
    weight,
    bmi: h ? +(weight / (h * h)).toFixed(1) : null,
    bodyFat,
    skeletalMuscle: num("m-muscle"),
    visceralFat: num("m-visceral"),
    bodyWater: num("m-water"),
    metabolicAge: num("m-age"),
    fatMassKg,
    leanMassKg: fatMassKg ? +(weight - fatMassKg).toFixed(2) : null,
    fatFreeWeight: fatMassKg ? +(weight - fatMassKg).toFixed(2) : null,
  };

  commitRecords([...state.records.filter((r) => r.id !== record.id), record]);
  closeDialog("dlg-entry");
  $<HTMLFormElement>("entry-form")!.reset();
  toast(`Pesaje guardado: ${fmt(weight, 2)} kg`);
});

/* ---------------------------------- Import ----------------------------------- */

function importCsv(text: string): void {
  const feedback = $("import-feedback")!;
  const { items, error } = parseRenphoCsv(text);
  feedback.hidden = false;
  if (error) {
    feedback.className = "rounded-xl p-3 text-sm tone-negative";
    feedback.textContent = error;
    return;
  }
  const map = new Map(state.records.map((r) => [r.id, r]));
  let added = 0;
  items.forEach((it) => {
    if (!map.has(it.id)) added++;
    map.set(it.id, it);
  });
  let merged = [...map.values()];
  if (!isDemo()) merged = merged.filter((r) => !DEMO_IDS.has(r.id));
  commitRecords(merged);

  feedback.className = "rounded-xl p-3 text-sm tone-positive";
  feedback.textContent = `${items.length} pesajes leídos, ${added} nuevos.`;
  setTimeout(() => {
    closeDialog("dlg-import");
    feedback.hidden = true;
    $<HTMLTextAreaElement>("csv-text")!.value = "";
    $<HTMLInputElement>("file-input")!.value = "";
    toast(added ? `Importados ${added} pesajes nuevos` : "Importación completada: no había pesajes nuevos");
  }, 900);
}

function readFile(file: File): void {
  const reader = new FileReader();
  reader.onload = () => importCsv(String(reader.result ?? ""));
  reader.readAsText(file);
}

const dropzone = $("dropzone");
dropzone?.addEventListener("dragover", (e) => {
  e.preventDefault();
  dropzone.dataset.drag = "true";
});
dropzone?.addEventListener("dragleave", () => delete dropzone.dataset.drag);
dropzone?.addEventListener("drop", (e) => {
  e.preventDefault();
  delete dropzone.dataset.drag;
  const file = e.dataTransfer?.files[0];
  if (file) readFile(file);
});
$<HTMLInputElement>("file-input")?.addEventListener("change", (e) => {
  const file = (e.target as HTMLInputElement).files?.[0];
  if (file) readFile(file);
});
$("btn-import-text")?.addEventListener("click", () => {
  const text = $<HTMLTextAreaElement>("csv-text")!.value;
  if (text.trim()) importCsv(text);
});

/* ------------------------------ Goals & profile ------------------------------ */

document.querySelectorAll('[data-open="dlg-goals"]').forEach((btn) =>
  btn.addEventListener("click", () => {
    const p = state.profile;
    $<HTMLInputElement>("g-name")!.value = isDemo() ? "Usuario demo" : p.name;
    $<HTMLInputElement>("g-height")!.value = String(Math.round(p.height * 100));
    $<HTMLInputElement>("g-weight")!.value = String(p.targetWeight);
    $<HTMLInputElement>("g-fat")!.value = String(p.targetBodyFat);
  })
);

$("goals-form")?.addEventListener("submit", (e) => {
  e.preventDefault();
  const form = e.target as HTMLFormElement;
  if (!form.reportValidity()) return;
  const val = (id: string) => parseFloat($<HTMLInputElement>(id)!.value.replace(",", "."));
  saveProfile({
    name: $<HTMLInputElement>("g-name")!.value.trim() || displayName(),
    height: Math.min(2.5, Math.max(1, val("g-height") / 100)),
    targetWeight: val("g-weight"),
    targetBodyFat: val("g-fat"),
  });
  closeDialog("dlg-goals");
  toast("Metas y perfil guardados");
});

/* ------------------------------- Data & backup ------------------------------- */

$("btn-export-csv")?.addEventListener("click", () => {
  downloadBlob(new Blob([toCsv(state.records)], { type: "text/csv;charset=utf-8" }), `fit-pesajes-${today()}.csv`);
});
$("btn-export-json")?.addEventListener("click", () => {
  downloadBlob(new Blob([JSON.stringify(state.records, null, 2)], { type: "application/json" }), `fit-copia-${today()}.json`);
});

document.querySelectorAll('[data-open="dlg-data"]').forEach((btn) =>
  btn.addEventListener("click", () => {
    // Demo-only and real-only actions
    $("btn-purge-demo")!.hidden = isDemo();
    $("btn-reset-demo")!.hidden = !isDemo();
  })
);

$("btn-purge-demo")?.addEventListener("click", () => {
  const before = state.records.length;
  const clean = state.records.filter((r) => !DEMO_IDS.has(r.id));
  closeDialog("dlg-data");
  if (clean.length === before) return toast("No hay pesajes de ejemplo mezclados con los tuyos.");
  commitRecords(clean);
  toast(`Eliminados ${before - clean.length} pesajes de ejemplo`);
});

$("btn-reset-demo")?.addEventListener("click", async () => {
  closeDialog("dlg-data");
  const ok = await confirmAction({
    title: "¿Restablecer los datos de ejemplo?",
    body: "Se descartarán los cambios que hayas hecho en la demo.",
    confirm: "Restablecer",
  });
  if (!ok) return;
  resetLocalData();
  commitRecords(DEMO_RECORDS.map((r) => ({ ...r })), { sync: false });
  toast("Datos de ejemplo restablecidos");
});

$("btn-clear-all")?.addEventListener("click", async () => {
  closeDialog("dlg-data");
  const count = state.records.length;
  if (!count) return toast("No hay pesajes que borrar.");
  const ok = await confirmAction({
    title: `¿Borrar ${count === 1 ? "el pesaje" : `los ${fmt(count, 0)} pesajes`}?`,
    body: isDemo()
      ? "Se vaciará la demo. Puedes restablecer los datos de ejemplo cuando quieras."
      : "Se borrarán en este dispositivo y en tu Gist. Descarga antes una copia si quieres conservarlos.",
    confirm: "Borrar todo",
    danger: true,
  });
  if (!ok) return;
  const backup = state.records;
  commitRecords([]);
  toast("Todos los pesajes borrados", { label: "Deshacer", run: () => commitRecords(backup) }, 8000);
});

/* ---------------------------------- Delete ----------------------------------- */

setupHistory((id) => {
  const record = state.records.find((r) => r.id === id);
  if (!record) return;
  commitRecords(state.records.filter((r) => r.id !== id));
  toast(`Pesaje del ${fmtDate(record.timestamp, { day: "numeric", month: "long" })} eliminado`, {
    label: "Deshacer",
    run: () => commitRecords([...state.records, record]),
  });
});

/* ---------------------------------- Report ----------------------------------- */

$("menu-report")?.addEventListener("click", async () => {
  if (!state.records.length) return toast("Añade algún pesaje para generar el informe.");
  openDialog("dlg-report");
  await drawReport($<HTMLCanvasElement>("report-canvas")!, state.records, state.profile, displayName());
});

$("btn-report-download")?.addEventListener("click", () => {
  $<HTMLCanvasElement>("report-canvas")!.toBlob((blob) => blob && downloadBlob(blob, reportFileName(displayName())), "image/png");
});

$("btn-report-share")?.addEventListener("click", () => {
  $<HTMLCanvasElement>("report-canvas")!.toBlob(async (blob) => {
    if (!blob) return;
    const file = new File([blob], reportFileName(displayName()), { type: "image/png" });
    if (navigator.canShare?.({ files: [file] })) {
      try {
        await navigator.share({ title: "Mi progreso", files: [file] });
      } catch {
        // Share sheet dismissed
      }
    } else {
      downloadBlob(blob, file.name);
    }
  }, "image/png");
});

/* ----------------------------------- Boot ------------------------------------ */

setupDialogs();
setupMenus();

if (sessionKind()) {
  startApp();
} else {
  showGate();
  // A valid cookie can outlive local storage (e.g. after clearing site data)
  fetch("/api/session", { cache: "no-store" })
    .then((res) => (res.ok ? res.json() : null))
    .then((data) => {
      if (data?.authenticated && !sessionKind()) {
        localStorage.setItem(KEYS.auth, SERVER_SESSION);
        startApp();
      }
    })
    .catch(() => {});
}
