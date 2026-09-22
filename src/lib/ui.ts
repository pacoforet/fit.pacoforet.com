// Small accessible UI primitives: dialogs, confirm, toasts and dropdown menus.
import { escapeHtml } from "./format";
import { icon } from "./icons";

export const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T | null;

/* ---------------------------------- Dialogs ---------------------------------- */

export function openDialog(id: string): void {
  const dlg = $<HTMLDialogElement>(id);
  if (dlg && !dlg.open) dlg.showModal();
}

export function closeDialog(id: string): void {
  $<HTMLDialogElement>(id)?.close();
}

export function setupDialogs(): void {
  document.querySelectorAll<HTMLDialogElement>("dialog.sheet").forEach((dlg) => {
    dlg.addEventListener("click", (e) => {
      // Click on the backdrop (outside the dialog box) closes it
      if (e.target !== dlg) return;
      const r = dlg.getBoundingClientRect();
      const inside = e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
      if (!inside) dlg.close();
    });
    dlg.querySelectorAll("[data-close]").forEach((btn) => btn.addEventListener("click", () => dlg.close()));
  });
  document.querySelectorAll<HTMLElement>("[data-open]").forEach((btn) => {
    btn.addEventListener("click", () => openDialog(btn.dataset.open!));
  });
}

/** Promise-based confirmation using the shared #dlg-confirm dialog. */
export function confirmAction(opts: { title: string; body: string; confirm: string; danger?: boolean }): Promise<boolean> {
  const dlg = $<HTMLDialogElement>("dlg-confirm");
  if (!dlg) return Promise.resolve(window.confirm(opts.body));
  $("confirm-title")!.textContent = opts.title;
  $("confirm-body")!.textContent = opts.body;
  const ok = $<HTMLButtonElement>("confirm-ok")!;
  ok.textContent = opts.confirm;
  ok.className = `btn ${opts.danger ? "btn-danger" : "btn-primary"}`;

  return new Promise((resolve) => {
    const onClose = () => {
      dlg.removeEventListener("close", onClose);
      resolve(dlg.returnValue === "ok");
    };
    dlg.returnValue = "";
    dlg.addEventListener("close", onClose);
    dlg.showModal();
    ok.focus();
  });
}

/* ---------------------------------- Toasts ----------------------------------- */

export function toast(message: string, action?: { label: string; run: () => void }, timeout = 5000): void {
  const region = $("toasts");
  if (!region) return;
  const el = document.createElement("div");
  el.className = "toast";
  el.innerHTML = `<span class="flex-1">${escapeHtml(message)}</span>`;
  if (action) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "h-9 px-3 rounded-xl font-semibold underline underline-offset-4 hover:bg-bg/15 cursor-pointer";
    btn.textContent = action.label;
    btn.addEventListener("click", () => {
      action.run();
      el.remove();
    });
    el.appendChild(btn);
  }
  const close = document.createElement("button");
  close.type = "button";
  close.className = "size-9 inline-flex items-center justify-center rounded-xl opacity-70 hover:opacity-100 cursor-pointer";
  close.setAttribute("aria-label", "Cerrar aviso");
  close.innerHTML = icon("x");
  close.addEventListener("click", () => el.remove());
  el.appendChild(close);

  region.appendChild(el);
  while (region.children.length > 3) region.firstElementChild?.remove();
  setTimeout(() => el.remove(), timeout);
}

/* ----------------------------------- Menus ----------------------------------- */

export function setupMenus(): void {
  document.querySelectorAll<HTMLButtonElement>("[data-menu]").forEach((trigger) => {
    const menu = $(trigger.dataset.menu!);
    if (!menu) return;
    const items = () => [...menu.querySelectorAll<HTMLElement>("[role=menuitem], [role=menuitemcheckbox]")];

    const close = (focusTrigger = false) => {
      menu.hidden = true;
      trigger.setAttribute("aria-expanded", "false");
      if (focusTrigger) trigger.focus();
    };
    const open = () => {
      document.querySelectorAll<HTMLElement>(".menu").forEach((m) => (m.hidden = true));
      menu.hidden = false;
      trigger.setAttribute("aria-expanded", "true");
      items()[0]?.focus();
    };

    trigger.addEventListener("click", (e) => {
      e.stopPropagation();
      menu.hidden ? open() : close();
    });
    menu.addEventListener("click", (e) => {
      const item = (e.target as HTMLElement).closest("[role=menuitem]");
      if (item) close();
    });
    menu.addEventListener("keydown", (e) => {
      const list = items();
      const idx = list.indexOf(document.activeElement as HTMLElement);
      if (e.key === "Escape") close(true);
      else if (e.key === "ArrowDown") {
        e.preventDefault();
        list[(idx + 1) % list.length]?.focus();
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        list[(idx - 1 + list.length) % list.length]?.focus();
      } else if (e.key === "Tab") close();
    });
    document.addEventListener("click", (e) => {
      // composedPath survives items being re-rendered during the click
      const path = e.composedPath();
      if (!menu.hidden && !path.includes(menu) && !path.includes(trigger)) close();
    });
  });
}

/* ----------------------------------- Theme ----------------------------------- */

export function isDark(): boolean {
  return document.documentElement.classList.contains("dark");
}

export function setTheme(dark: boolean): void {
  document.documentElement.classList.toggle("dark", dark);
  try {
    localStorage.theme = dark ? "dark" : "light";
  } catch {
    // ignore
  }
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", dark ? "#09090b" : "#f7f7f8");
}

export function cssVar(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}
