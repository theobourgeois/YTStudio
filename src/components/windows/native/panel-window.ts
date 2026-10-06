/**
 * Opening a panel: a window of the operating system, made with `window.open` (the desktop app makes it
 * frameless and floating: electron/panels.ts), dressed in the page's theme and styles and given an element
 * to draw into. Same origin and same renderer, so the page's React draws straight into it and moves it
 * with `moveTo`/`resizeTo`: one script, one set of stores, several documents.
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
  /** Close it. */
  close(): void;
}

let sequence = 0;
/** The page is going away: nothing more is opened for it (the windows would outlive what draws them). */
let unloading = false;
if (typeof window !== "undefined") window.addEventListener("pagehide", () => (unloading = true));

/** Open a panel's window, hidden: null where there are no native windows (a browser tab), or if it was refused. */
export function openPanelWindow(id: string, title: string, exactName?: string): PanelWindow | null {
  const panels = desktopPanels();
  if (!panels || unloading) return null;
  const name = exactName ?? `${PANEL_PREFIX}${id}:${++sequence}`;
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

  let closed = false;
  const dispose = () => {
    if (closed) return false;
    closed = true;
    root();
    styles.stop();
    stopClosed();
    unregister();
    return true;
  };
  const panel: PanelWindow = {
    name,
    win,
    container,
    ready: styles.ready,
    onGone: null,
    close() {
      if (!dispose()) return;
      panels.close(name);
      try {
        win.close();
      } catch {
        // gone already
      }
    },
  };
  const gone = () => {
    if (dispose()) panel.onGone?.();
  };
  // The system closed it (Cmd-W, the window menu), or the page under it went.
  const stopClosed = panels.onClosed((closedName) => closedName === name && gone());
  win.addEventListener("pagehide", gone);
  return panel;
}
