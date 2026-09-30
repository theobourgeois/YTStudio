/** The editor window's size and place, remembered across launches (in the app's user data). */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { type BrowserWindow, type Rectangle, app, screen } from "electron";

export interface WindowState {
  bounds: Partial<Rectangle> & { width: number; height: number };
  maximized: boolean;
}

const DEFAULT: WindowState = { bounds: { width: 1440, height: 900 }, maximized: false };
const SAVE_DELAY_MS = 500;

const file = () => path.join(app.getPath("userData"), "window-state.json");

function isRect(value: unknown): value is Rectangle {
  const r = value as Rectangle | null;
  return !!r && [r.x, r.y, r.width, r.height].every((n) => Number.isFinite(n)) && r.width > 0 && r.height > 0;
}

/** The saved state, if it's still on a connected display; otherwise the default size, centred. */
export function loadWindowState(): WindowState {
  try {
    const saved = JSON.parse(readFileSync(file(), "utf8")) as { bounds?: unknown; maximized?: unknown };
    if (!isRect(saved.bounds)) return DEFAULT;
    const { workArea } = screen.getDisplayMatching(saved.bounds);
    const b = saved.bounds;
    const visible = b.x < workArea.x + workArea.width && b.x + b.width > workArea.x && b.y < workArea.y + workArea.height && b.y + b.height > workArea.y;
    return visible ? { bounds: b, maximized: saved.maximized === true } : DEFAULT;
  } catch {
    return DEFAULT;
  }
}

/** Save the window's state whenever it moves or resizes (debounced) and when it closes. */
export function trackWindowState(win: BrowserWindow) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const save = () => {
    clearTimeout(timer);
    if (win.isDestroyed() || win.isMinimized() || win.isFullScreen()) return;
    const state: WindowState = { bounds: win.getNormalBounds(), maximized: win.isMaximized() };
    try {
      writeFileSync(file(), JSON.stringify(state));
    } catch {
      // Not worth bothering anyone about.
    }
  };
  const later = () => {
    clearTimeout(timer);
    timer = setTimeout(save, SAVE_DELAY_MS);
  };
  win.on("resize", later);
  win.on("move", later);
  win.on("close", save);
}
