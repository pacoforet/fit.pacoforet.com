import { fmtRelativeTime } from "../../lib/format";
import { displayName, isDemo, state } from "../../lib/store";
import type { SyncState, ViewKey } from "../../lib/types";
import { $ } from "../../lib/ui";

const SYNC: Record<SyncState, { dot: string; label: string }> = {
  idle: { dot: "bg-fg-3", label: "Conectando…" },
  syncing: { dot: "bg-fg-3 animate-pulse", label: "Sincronizando…" },
  synced: { dot: "bg-positive", label: "Sincronizado" },
  local: { dot: "bg-fg-3", label: "Solo en este dispositivo" },
  error: { dot: "bg-negative", label: "Error al sincronizar" },
  demo: { dot: "bg-warning", label: "Modo demo" },
};

export function renderChrome(): void {
  const name = displayName();
  $("header-name")!.textContent = name;
  document.title = isDemo() ? "Fit · Demo" : `Fit · ${name}`;

  const s = isDemo() ? "demo" : state.sync.state;
  const info = SYNC[s];
  $("sync-dot")!.className = `size-2 rounded-full ${info.dot}`;
  const when = s === "synced" && state.sync.at ? ` ${fmtRelativeTime(state.sync.at)}` : "";
  $("sync-label")!.textContent = info.label + when;
  const btn = $("sync-btn")!;
  const action = isDemo() ? "La demo no se sincroniza con la nube" : "Pulsa para sincronizar ahora";
  btn.setAttribute("aria-label", `${info.label}${when}. ${action}`);
  btn.title = action;
}

export function renderView(view: ViewKey): void {
  document.querySelectorAll<HTMLElement>("[data-view]").forEach((el) => (el.hidden = el.dataset.view !== view));
  document.querySelectorAll<HTMLElement>("[data-view-link]").forEach((el) => {
    if (el.dataset.viewLink === view) el.setAttribute("aria-current", "page");
    else el.removeAttribute("aria-current");
  });
}
