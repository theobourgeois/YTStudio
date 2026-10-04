/**
 * Hover in the windows that aren't the one in use. On macOS a window without the keyboard focus gets no
 * mouse-moved events, so with a panel (the Piano roll...) in use the main window's toolbar, or another
 * panel, shows no hover at all, though a click on it still works (`acceptFirstMouse`). The main process
 * knows where the pointer is, so it tells the window under it: a moved pointer is sent to the topmost
 * window of ours there, if it doesn't have the focus (the focused one gets the real events), and a
 * leave to the one it was in before. The page can't do this: it never hears of the pointer.
 */

export interface HoverWindow<W> {
  window: W;
  bounds: { x: number; y: number; width: number; height: number };
}

/** The window the point is in. `windows` are from the back to the front. */
export function windowAt<W>(point: { x: number; y: number }, windows: readonly HoverWindow<W>[]): W | null {
  for (let i = windows.length - 1; i >= 0; i--) {
    const { x, y, width, height } = windows[i].bounds;
    if (point.x >= x && point.x < x + width && point.y >= y && point.y < y + height) return windows[i].window;
  }
  return null;
}

/** What the relay needs of a window (Electron's BrowserWindow has it all). */
export interface HoverSurface {
  isDestroyed(): boolean;
  isFocused(): boolean;
  getContentBounds(): { x: number; y: number; width: number; height: number };
  webContents: { sendInputEvent(event: { type: "mouseMove" | "mouseLeave"; x: number; y: number }): void };
}

export class HoverRelay<W extends HoverSurface> {
  /** The window that was last told the pointer is in it (and not one that heard it itself). */
  private told: W | null = null;
  private last = { x: NaN, y: NaN };

  constructor(
    /** Every window of ours that's shown, from the back to the front. */
    private readonly windows: () => readonly W[],
    /** Whether the app is in use: otherwise another program is, and its windows over ours are none of our business. */
    private readonly inUse: () => boolean,
  ) {}

  /** Call with the pointer's place on the screen, often (a timer). */
  update(point: { x: number; y: number }) {
    const shown = this.windows().filter((w) => !w.isDestroyed());
    const under = this.inUse() ? windowAt(point, shown.map((window) => ({ window, bounds: window.getContentBounds() }))) : null;
    // The focused window has the real events.
    const target = under && !under.isFocused() ? under : null;
    const still = point.x === this.last.x && point.y === this.last.y;
    this.last = point;
    if (this.told && this.told !== target) this.leave(this.told, point);
    // (A pointer that hasn't moved tells nothing new, unless it's another window's now.)
    if (target === this.told && still) return;
    this.told = target;
    if (!target) return;
    const bounds = target.getContentBounds();
    target.webContents.sendInputEvent({ type: "mouseMove", x: Math.round(point.x - bounds.x), y: Math.round(point.y - bounds.y) });
  }

  /** Forget where the pointer was (a window was closed, the app was left). */
  reset() {
    if (this.told) this.leave(this.told, this.last);
    this.told = null;
    this.last = { x: NaN, y: NaN };
  }

  private leave(window: W, point: { x: number; y: number }) {
    if (window.isDestroyed()) return;
    const bounds = window.getContentBounds();
    window.webContents.sendInputEvent({ type: "mouseLeave", x: Math.round(point.x - bounds.x), y: Math.round(point.y - bounds.y) });
  }
}
