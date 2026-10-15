/**
 * Opening a stage (`STAGE_PREFIX`): a window of its own for a picture to fill, the Now Playing visualizer popped out
 * of the app. As with a panel (`panel-window.ts`), the page draws into it (same origin, same renderer: one script, one
 * set of stores), dressed in the page's theme and styles. Unlike a panel it's an ordinary window, in a browser too (a
 * popup); in the desktop app it goes full screen on whichever screen it's on, and can be pinned over other programs
 * (electron/stage.ts).
 */
import { STAGE_PREFIX } from "@shared/panels";
import { type ScreenRect, desktopStage } from "@/lib/desktop";
import { mirrorRoot, mirrorStyles } from "./styles";

export interface StageWindow {
  readonly win: Window;
  /** Where the picture is drawn: fills the window. */
  readonly container: HTMLElement;
  /** Settles once its styles are in. */
  readonly ready: Promise<void>;
  /** Keep it over other programs' windows, or not: undefined where that can't be done (a browser). */
  readonly pin: ((on: boolean) => void) | undefined;
  /** Called when the window is gone (closed by the user or the system, not by `close`). */
  onGone: (() => void) | null;
  /** Where it is on the screen now (its content), or was when it closed: to open it there again. */
  bounds(): ScreenRect;
  close(): void;
}

/** How often a stage's window is looked at, in case it closed without saying so. */
const CLOSED_CHECK_MS = 500;
/** A new stage's size, when there's no place it was. */
const DEFAULT = { width: 960, height: 540 };

let sequence = 0;
/** The page is going away: nothing more is opened for it, and what's open goes too. */
let unloading = false;
const open = new Set<StageWindow>();
if (typeof window !== "undefined") {
  window.addEventListener("pagehide", () => {
    unloading = true;
    for (const stage of [...open]) stage.close();
  });
}

/** Open a stage at `at` (its content's place on the screen; else the system's choice): null if it was refused (a blocker). */
export function openStageWindow(title: string, at?: ScreenRect | null): StageWindow | null {
  if (unloading) return null;
  const name = `${STAGE_PREFIX}${++sequence}`;
  const size = at ? `width=${Math.round(at.width)},height=${Math.round(at.height)},left=${Math.round(at.x)},top=${Math.round(at.y)}` : `width=${DEFAULT.width},height=${DEFAULT.height}`;
  const win = window.open("about:blank", name, `popup=yes,${size}`);
  if (!win) return null;
  const doc = win.document;
  doc.title = title;
  const root = mirrorRoot(document, doc);
  const styles = mirrorStyles(document, doc);
  doc.body.style.cssText = "margin:0;background:#000;overflow:hidden";
  const container = doc.createElement("div");
  container.id = "stage-root";
  doc.body.append(container);

  let closed = false;
  const dispose = () => {
    if (closed) return false;
    closed = true;
    root();
    styles.stop();
    clearInterval(check);
    open.delete(stage);
    return true;
  };
  const gone = () => {
    if (dispose()) stage.onGone?.();
  };
  const pin = desktopStage()?.pin;
  // Where it is, as last seen: a closed window can't say.
  let last: ScreenRect = { x: win.screenX, y: win.screenY, width: win.innerWidth, height: win.innerHeight };
  const bounds = () => {
    if (!win.closed) last = { x: win.screenX, y: win.screenY, width: win.innerWidth, height: win.innerHeight };
    return last;
  };
  const stage: StageWindow = {
    win,
    container,
    ready: styles.ready,
    pin: pin && ((on) => pin(name, on)),
    onGone: null,
    bounds,
    close() {
      if (!dispose()) return;
      try {
        win.close();
      } catch {
        // gone already
      }
    },
  };
  open.add(stage);
  win.addEventListener("pagehide", gone);
  const check = setInterval(() => (win.closed ? gone() : bounds()), CLOSED_CHECK_MS);
  win.focus();
  return stage;
}
