/**
 * What pops up over a native panel (menus, selects, popovers) is drawn in a window shared by all the panels,
 * because a window can't draw outside itself and a small panel's menu would be cut off. It's transparent and
 * hidden until something is in it. Its top-left corner is kept at the corner of the panel in use, so a
 * menu's place against the control that opened it (worked out in the control's window) is its place in
 * this one; it reaches to the display's right and bottom edges.
 */
import { useEffect, useLayoutEffect, useState, useSyncExternalStore } from "react";
import { POPUP_WINDOW } from "@shared/panels";
import { desktopPanels } from "@/lib/desktop";
import { addWindowListener, allWindows, isElement, ownerWindow } from "@/lib/window-events";
import { pageScale, workAreas } from "./bridge";
import { areaFor } from "./geometry";
import { type PanelWindow, openPanelWindow } from "./panel-window";
import { windowsRaised } from "./raised";

export { noteWindowRaised } from "./raised";

interface Popups {
  panel: PanelWindow;
  observer: MutationObserver;
  shown: boolean;
  /** The window it lies over (a panel's name, or null for the main window), and where that was (so a move is noticed). */
  over: { name: string | null; x: number; y: number; width: number; height: number } | null;
  placed: string;
  /** Closes what's in it when the user presses anywhere else (`watchOutside`), while something is. */
  unwatch: (() => void) | null;
  /** `windowsRaised()` when the menu opened: a window opened or raised since (by an item chosen in it) keeps the keyboard. */
  raisedAtOpen: number;
}

/** How long after a menu closes the keyboard goes back to the window it was opened from: a window opened by its item shows first. */
const GIVE_BACK_MS = 120;

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
  const next: Popups = { panel, shown: false, over: null, placed: "", unwatch: null, raisedAtOpen: 0, observer: new MutationObserver(() => update()) };
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
    p.raisedAtOpen = windowsRaised();
    panels.show(p.panel.name, true);
    p.unwatch = watchOutside(p.panel.win);
  } else {
    panels.hide(p.panel.name);
    // The keyboard back to the window the menu was opened from, unless it went somewhere else meanwhile: a window
    // its item opened or raised, or a window pressed to close it.
    const over = p.over;
    const since = p.raisedAtOpen;
    setTimeout(() => {
      if (!over || windowsRaised() !== since || popups?.shown) return;
      if (allWindows().some((win) => win !== p.panel.win && !win.closed && win.document.hasFocus())) return;
      if (over.name) panels.raise(over.name);
      else window.focus();
    }, GIVE_BACK_MS);
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

/**
 * Lie over a window from its content's corner to the display's edges: call as the pointer comes to a panel (or
 * to the main window, `name` null), before a menu is opened in it. A menu is placed in the window it was opened
 * from's own coordinates, so the popup window's corner has to be that window's content's: on Windows a frameless
 * window has invisible borders to its left, right and bottom (7 points at 125%), which `screenX` counts (menus
 * opened 7 points to the left of their control); this window has none.
 */
export function alignPopups(target: { name: string | null; win: Window }) {
  const p = popups;
  if (!p || p.shown) return;
  const win = target.win;
  const border = Math.max(0, Math.round((win.outerWidth - win.innerWidth * pageScale()) / 2));
  const x = win.screenX + border;
  const y = win.screenY;
  const here = { x, y, width: win.outerWidth - 2 * border, height: win.outerHeight };
  const area = areaFor(here, workAreas());
  const width = Math.max(here.width, area ? area.x + area.width - x : here.width);
  const height = Math.max(here.height, area ? area.y + area.height - y : here.height);
  p.over = { name: target.name, ...here };
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

/**
 * The main window's menus, while the editor's windows are windows of the system: drawn in the popup window
 * too, which floats over the panels (an owned window is always above the main window, so a menu drawn in the
 * main page opened under them) and closes when clicked away from anywhere (`watchOutside`). The element to
 * draw them in, once there is one (until then, the page itself).
 */
export function useMainWindowPopups(enabled: boolean): HTMLElement | undefined {
  const container = usePopupContainerElement();
  useEffect(() => {
    if (!enabled || !desktopPanels()) return;
    const release = acquirePopups();
    const align = () => alignPopups({ name: null, win: window });
    window.addEventListener("pointermove", align, { passive: true });
    window.addEventListener("focus", align);
    align();
    return () => {
      window.removeEventListener("pointermove", align);
      window.removeEventListener("focus", align);
      release();
    };
  }, [enabled]);
  return enabled ? container : undefined;
}

/**
 * A dialog of the main window's (the command palette, ⌘P's search) while the editor's windows are windows of
 * the system: drawn in the popup window too (in the page, it opened under them), laid over the main window
 * first, in a box the main window's size that it's centred in (the popup window reaches to the display's
 * edges). `container` is that box; `ready` is false until it's there, so the dialog isn't first drawn in the
 * page. There the dialog isn't modal (`modal={!container}`) and its input focuses itself (`autoFocus`,
 * `onOpenAutoFocus` prevented): Radix's focus trap looks for the focus in the main page's document, doesn't find
 * it, and takes it back to the dialog itself on every change to the list. The box dims what's under it, as the
 * overlay would, and a press on it closes the dialog. Elsewhere (no panels, or no popup window yet), the page:
 * `container` undefined and `ready` true.
 */
export function useMainWindowDialog(open: boolean): { container: HTMLElement | undefined; ready: boolean } {
  const popups = usePopupContainerElement();
  const native = open && popups !== undefined && desktopPanels() !== undefined;
  const [frame, setFrame] = useState<HTMLElement>();
  useLayoutEffect(() => {
    if (!native || !popups) return;
    // Before the box goes in: the window shows as something is in it, where it was last laid (a panel, maybe).
    alignPopups({ name: null, win: window });
    const box = popups.ownerDocument.createElement("div");
    box.className = "bg-black/45 dark:bg-black/55";
    // A transform makes it what the dialog's fixed layers are placed in.
    const fit = () => Object.assign(box.style, { position: "fixed", left: "0", top: "0", width: `${window.innerWidth}px`, height: `${window.innerHeight}px`, transform: "translateZ(0)" });
    fit();
    popups.append(box);
    window.addEventListener("resize", fit);
    setFrame(box);
    return () => {
      window.removeEventListener("resize", fit);
      box.remove();
      setFrame(undefined);
    };
  }, [native, popups]);
  return native ? { container: frame, ready: frame !== undefined } : { container: undefined, ready: true };
}
