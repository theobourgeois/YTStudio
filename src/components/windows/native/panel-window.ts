/**
 * Opening a panel: a window of the operating system, made with `window.open` (the desktop app makes it
 * frameless and floating: electron/panels.ts), dressed in the page's theme and styles and given an element
 * to draw into. Same origin and same renderer, so the page's React draws straight into it and moves it
 * with `moveTo`/`resizeTo`: one script, one set of stores, several documents.
 *
 * A window of the system is slow to make (its document, the page's styles copied and parsed, the fonts), so
 * one closed is kept hidden and opened again for the next panel, and a few are made ahead while the app
 * is idle (`prewarmPanelWindows`): opening a panel is then only drawing it.
 */
import { PANEL_PREFIX } from "@shared/panels";
import { desktopPanels } from "@/lib/desktop";
import { registerWindow } from "@/lib/window-events";
import { mirrorRoot, mirrorStyles } from "./styles";

export interface PanelWindow {
  /** The name `window.open` gave it (what the main process knows it by). */
  readonly name: string;
  readonly win: Window;
  /** Where the panel's content is drawn. */
  readonly container: HTMLElement;
  /** Settles once its styles are in. */
  readonly ready: Promise<void>;
  /** Called when the window is gone (closed by the system, not by `close`). */
  onGone: (() => void) | null;
  /** Close it (or keep it hidden for the next panel). */
  close(): void;
}

/** A window of the system made for panels: lent to one panel at a time. */
interface Slot {
  readonly name: string;
  readonly win: Window;
  readonly container: HTMLElement;
  readonly ready: Promise<void>;
  /** The panel it's lent to, if any. */
  lent: PanelWindow | null;
  dead: boolean;
  destroy(): void;
}

let sequence = 0;
/** The page is going away: nothing more is opened for it (the windows would outlive what draws them). */
let unloading = false;
if (typeof window !== "undefined") window.addEventListener("pagehide", () => (unloading = true));

/** Windows kept hidden, ready to be lent to the next panel opened. */
const spares: Slot[] = [];
/** How many are kept: enough for a song's usual windows to open at once. */
const MAX_SPARES = 4;

/** Make a window for panels, hidden: null where there are no native windows (a browser tab), or if it was refused. */
function makeSlot(name: string, title: string): Slot | null {
  const panels = desktopPanels();
  if (!panels || unloading) return null;
  const win = window.open("about:blank", name, "popup=yes,width=480,height=320");
  if (!win) return null;
  const doc = win.document;
  doc.title = title;

  const root = mirrorRoot(document, doc);
  const styles = mirrorStyles(document, doc);
  // What pops up in a window of the system appears at once, as the system's own menus do: no fade, zoom or
  // slide on open or close (a menu, a popover, a select, a tooltip, a dialog: Radix's layers, by their state).
  // (In the body: the head is the page's styles, mirrored.)
  const instant = doc.createElement("style");
  instant.textContent = '[data-state="open"], [data-state="closed"], [data-state="delayed-open"], [data-state="instant-open"] { animation: none !important; }';
  const container = doc.createElement("div");
  container.id = "panel-root";
  doc.body.append(instant, container);
  const unregister = registerWindow(win);

  const slot: Slot = {
    name,
    win,
    container,
    // Its fonts too (they're the page's, but a new document loads its own): shown before they're in, the text
    // swapped font and the window changed size in front of the user.
    ready: styles.ready.then(() => settleWithin(doc.fonts?.ready, 800)),
    lent: null,
    dead: false,
    destroy() {
      if (!dispose()) return;
      panels.close(name);
      try {
        win.close();
      } catch {
        // gone already
      }
    },
  };
  const dispose = () => {
    if (slot.dead) return false;
    slot.dead = true;
    root();
    styles.stop();
    stopClosed();
    unregister();
    const spare = spares.indexOf(slot);
    if (spare >= 0) spares.splice(spare, 1);
    return true;
  };
  const gone = () => {
    if (!dispose()) return;
    const lent = slot.lent;
    slot.lent = null;
    lent?.onGone?.();
  };
  // The system closed it (Cmd-W, the window menu), or the page under it went.
  const stopClosed = panels.onClosed((closedName) => closedName === name && gone());
  win.addEventListener("pagehide", gone);
  return slot;
}

/** Lend a window to a panel: what the panel sees of it, and its `close` giving it back. */
function lend(slot: Slot, title: string, recycle: boolean): PanelWindow {
  slot.win.document.title = title;
  const panel: PanelWindow = {
    name: slot.name,
    win: slot.win,
    container: slot.container,
    ready: slot.ready,
    onGone: null,
    close() {
      if (slot.lent !== panel) return;
      slot.lent = null;
      if (!recycle || slot.dead || unloading || spares.length >= MAX_SPARES) return slot.destroy();
      // Hidden and kept for the next panel. (What the panel drew goes as React lets go of it.)
      desktopPanels()?.hide(slot.name);
      spares.push(slot);
    },
  };
  slot.lent = panel;
  return panel;
}

/**
 * Open a panel's window, hidden: a spare one if there is one, else a new one. Null where there are no native
 * windows (a browser tab), or if it was refused. A window given an `exactName` (the menus' window) is its own,
 * never a spare.
 */
export function openPanelWindow(id: string, title: string, exactName?: string): PanelWindow | null {
  if (!exactName) {
    while (spares.length) {
      const slot = spares.pop()!;
      if (slot.dead || slot.win.closed) {
        slot.destroy();
        continue;
      }
      // A panel's own look starts afresh: what the last one set on the container goes.
      slot.container.removeAttribute("style");
      slot.container.replaceChildren();
      return lend(slot, title, true);
    }
  }
  const slot = makeSlot(exactName ?? `${PANEL_PREFIX}${id}:${++sequence}`, title);
  return slot && lend(slot, title, !exactName);
}

/**
 * Make windows ahead for the panels to come (hidden, styled), one at a time while the app is idle, up to
 * `count` spares: the first Piano roll or mixer opened then shows as fast as the next.
 */
export function prewarmPanelWindows(count = 2): () => void {
  let cancelled = false;
  let handle = 0;
  const idle = (f: () => void) => (typeof requestIdleCallback === "function" ? requestIdleCallback(f, { timeout: 3000 }) : window.setTimeout(f, 200));
  const step = () => {
    if (cancelled || unloading || spares.length >= Math.min(count, MAX_SPARES) || !desktopPanels()) return;
    const slot = makeSlot(`${PANEL_PREFIX}spare:${++sequence}`, "");
    if (!slot) return;
    void slot.ready.then(() => {
      if (slot.dead) return;
      if (cancelled || spares.length >= MAX_SPARES) return slot.destroy();
      spares.push(slot);
      handle = idle(step);
    });
  };
  handle = idle(step);
  return () => {
    cancelled = true;
    if (typeof cancelIdleCallback === "function") cancelIdleCallback(handle);
    else clearTimeout(handle);
  };
}

/** `promise`, or `ms` if that's sooner (never rejects). */
function settleWithin(promise: Promise<unknown> | undefined, ms: number): Promise<void> {
  return Promise.race([Promise.resolve(promise).then(() => undefined, () => undefined), new Promise<void>((resolve) => setTimeout(resolve, ms))]);
}
