/**
 * Which of the app's windows float. Panels (the music editor's windows, one native window each) and the
 * audio engine's plugin windows are at the floating level, so they stack among each other by use (a click
 * raises the one it lands on, whichever program it belongs to) and the main window, an ordinary one, never
 * covers them. That's only right while the app is the one in use: switching to another program puts them at
 * the ordinary level, behind it, in the order they were in; coming back lifts them as they were
 * (docs/windows.md).
 *
 * The app is in use while one of its windows has the focus or one of the engine's does. Going from one to
 * the other passes through a moment when neither does, so losing the focus only counts after `graceMs`.
 */
export interface FloatingState {
  /** At the floating level (the app is in use), else at the ordinary one. */
  floating: boolean;
  /** The main window isn't minimised or hidden; if it is, the other windows go with it. */
  visible: boolean;
}

export class FloatingGroup {
  private electronFocused = false;
  private engineForeground = false;
  private mainVisible = true;
  private floating = false;
  private told: FloatingState | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;

  /** `apply` is called with the state at first and whenever it changes. */
  constructor(
    private readonly apply: (state: FloatingState) => void,
    private readonly graceMs = 250,
  ) {
    this.update();
  }

  /** One of the app's own windows has the focus (or none does). */
  setAppFocused(focused: boolean) {
    this.electronFocused = focused;
    this.update();
  }

  /** One of the engine's plugin windows has the focus (or none does). */
  setEngineForeground(on: boolean) {
    this.engineForeground = on;
    this.update();
  }

  /** The main window is shown (not minimised, not hidden). */
  setMainVisible(visible: boolean) {
    this.mainVisible = visible;
    this.update();
  }

  dispose() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  private update() {
    const inUse = this.electronFocused || this.engineForeground;
    if (inUse) {
      if (this.timer) clearTimeout(this.timer);
      this.timer = null;
      this.floating = true;
    } else if (this.floating && !this.timer) {
      this.timer = setTimeout(() => {
        this.timer = null;
        this.floating = false;
        this.tell();
      }, this.graceMs);
    }
    this.tell();
  }

  private tell() {
    const next = { floating: this.floating, visible: this.mainVisible };
    if (this.told && this.told.floating === next.floating && this.told.visible === next.visible) return;
    this.told = next;
    this.apply(next);
  }
}
