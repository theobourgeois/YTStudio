/**
 * What pops up over a native panel (menus, selects, popovers) is drawn in a window shared by all the panels,
 * because a window can't draw outside itself and a small panel's menu would be cut off. It's transparent and
 * hidden until something is in it. Its top-left corner is kept at the corner of the panel in use, so a
 * menu's place against the control that opened it (worked out in the control's window) is its place in
 * this one; it reaches to the display's right and bottom edges.
 */
import { useSyncExternalStore } from "react";
import { POPUP_WINDOW } from "@shared/panels";
import { desktopPanels } from "@/lib/desktop";
import { addWindowListener, isElement, ownerWindow } from "@/lib/window-events";
import { workAreas } from "./bridge";
import { areaFor } from "./geometry";
import { type PanelWindow, openPanelWindow } from "./panel-window";

interface Popups {
  panel: PanelWindow;
  observer: MutationObserver;
  shown: boolean;
  /** The panel it lies over, and where that was (so a move is noticed). */
  over: { name: string; x: number; y: number; width: number; height: number } | null;
  placed: string;
  /** Closes what's in it when the user presses anywhere else (`watchOutside`), while something is. */
  unwatch: (() => void) | null;
}

let popups: Popups | null = null;
let users = 0;
let release: ReturnType<typeof setTimeout> | null = null;
const listeners = new Set<() => void>();
const tell = () => {
  for (const listener of listeners) listener();
};

/** The element menus and the like are drawn in (once the window exists). */
export function popupContainer(): HTMLElement | undefined {
  return popups?.panel.container;
}

/** Re-renders when the popup window comes or goes. */
export function usePopupContainerElement(): HTMLElement | undefined {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    popupContainer,
  );
}

function create() {
  const panel = openPanelWindow("popups", "Menus", POPUP_WINDOW);
  if (!panel) return;
  const doc = panel.win.document;
  // See-through: the page shows through everywhere but the menus.
  const style = doc.createElement("style");
  style.textContent = "html, body { background: transparent !important; } #panel-root { position: fixed; inset: 0; pointer-events: none; } #panel-root > * { pointer-events: auto; }";
  doc.head.append(style);
  const next: Popups = { panel, shown: false, over: null, placed: "", unwatch: null, observer: new MutationObserver(() => update()) };
  next.observer.observe(panel.container, { childList: true });
  popups = next;
  panel.onGone = () => {
    if (popups === next) {
      next.unwatch?.();
      next.observer.disconnect();
      popups = null;
      tell();
    }
  };
  void panel.ready.then(() => {
    if (popups !== next) return;
    desktopPanels()?.configure(panel.name, { resizable: false, backgroundColor: "#00000000" });
    tell();
  });
}

/** Show the window while there's something in it, and hand the keyboard back to the panel when there isn't. */
function update() {
  const p = popups;
  const panels = desktopPanels();
  if (!p || !panels) return;
  const something = p.panel.container.childElementCount > 0;
  if (something === p.shown) return;
  p.shown = something;
  p.unwatch?.();
  p.unwatch = null;
  if (something) {
    panels.show(p.panel.name, true);
    p.unwatch = watchOutside(p.panel.win);
  } else {
    panels.hide(p.panel.name);
    if (p.over) panels.raise(p.over.name);
  }
}

/**
 * A menu here closes when it's clicked away from, as in the page. Radix hears presses only in the menu's own
 * document, this window's; a press in a panel, the main window, a plugin's window or another program never
 * reaches it, so it took Esc. So: a press in any of the page's other windows dismisses it (not one on the
 * control that opened it, which closes it itself), and so does this window losing the keyboard to something
 * that isn't one of ours (a plugin's window, another program).
 */
function watchOutside(win: Window): () => void {
  const opener = '[aria-haspopup][data-state="open"], [aria-expanded="true"]';
  const stopPress = addWindowListener(
    "pointerdown",
    (e) => {
      if (ownerWindow(e.target) === win) return;
      if (isElement(e.target) && e.target.closest(opener)) return;
      dismiss(win);
    },
    true,
  );
  const onBlur = () => {
    // Focus moving to another of the page's windows is a press there, handled above (it comes first).
    setTimeout(() => {
      if (!win.document.hasFocus()) dismiss(win);
    }, 0);
  };
  win.addEventListener("blur", onBlur);
  return () => {
    stopPress();
    win.removeEventListener("blur", onBlur);
  };
}

/** What Radix does with a press outside its layers: every open menu, popover and submenu in `win` closes. */
function dismiss(win: Window) {
  const body = win.document.body;
  const Pointer = (win as unknown as typeof globalThis).PointerEvent;
  body.dispatchEvent(new Pointer("pointerdown", { bubbles: true, cancelable: true, button: 0, pointerType: "mouse", isPrimary: true }));
  // Anything a press outside didn't close (a layer that ignores them) goes as Esc would have it, once React has
  // had its turn (Esc gives the focus back to the menu's control, which a press elsewhere shouldn't).
  setTimeout(() => {
    if (popups?.panel.win !== win || popups.panel.container.childElementCount === 0) return;
    const Keyboard = (win as unknown as typeof globalThis).KeyboardEvent;
    win.document.dispatchEvent(new Keyboard("keydown", { key: "Escape", code: "Escape", bubbles: true, cancelable: true }));
  }, 50);
}

/** Lie over `panel` from its corner to the display's edges: call as the pointer comes to a panel, before a menu is opened in it. */
export function alignPopups(panel: PanelWindow) {
  const p = popups;
  if (!p || p.shown) return;
  const win = panel.win;
  const x = win.screenX;
  const y = win.screenY;
  const here = { x, y, width: win.outerWidth, height: win.outerHeight };
  const area = areaFor(here, workAreas());
  const width = Math.max(here.width, area ? area.x + area.width - x : here.width);
  const height = Math.max(here.height, area ? area.y + area.height - y : here.height);
  p.over = { name: panel.name, ...here };
  const key = `${x},${y},${width},${height}`;
  if (key === p.placed) return;
  p.placed = key;
  desktopPanels()?.place(p.panel.name, { x, y, width, height });
}

/** A panel wants the popup window. Returns how to say it doesn't any more. */
export function acquirePopups(): () => void {
  users++;
  if (release) clearTimeout(release);
  release = null;
  if (!popups) {
    create();
    tell();
  }
  return () => {
    users--;
    if (users > 0) return;
    // Later: a panel replaced by another (a project switch) keeps the window.
    release = setTimeout(() => {
      if (users > 0 || !popups) return;
      const closing = popups;
      popups = null;
      closing.observer.disconnect();
      closing.panel.close();
      tell();
    }, 500);
  };
}
