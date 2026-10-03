/**
 * The order the app's floating windows and the engine's plugin windows are stacked in, kept by the main
 * process (the system keeps it too, but when the app is switched away from and back, the windows' levels
 * change and the system doesn't put them back as they were): every use of a window moves it to the top,
 * and `restack` puts the windows back in that order, from the back to the front.
 */
export class WindowStack {
  private keys: string[] = [];

  /** `key` was used: it's in front. */
  raise(key: string) {
    this.drop(key);
    this.keys.push(key);
  }

  /** `key` is new and not in use: behind the others (unless it's already in the stack). */
  lower(key: string) {
    if (!this.keys.includes(key)) this.keys.unshift(key);
  }

  drop(key: string) {
    const at = this.keys.indexOf(key);
    if (at >= 0) this.keys.splice(at, 1);
  }

  /** From the back to the front. */
  order(): readonly string[] {
    return this.keys;
  }
}

/**
 * Puts windows back in the stack's order. `raise` brings one to the front (without the keyboard) and says
 * whether it could: false means the window is gone, so it leaves the stack. Calls while one is running
 * make it run once more afterwards, so the order that counts is the latest.
 */
export class Restacker {
  private running = false;
  private again = false;

  constructor(
    private readonly stack: WindowStack,
    private readonly raise: (key: string) => Promise<boolean> | boolean,
    /** Between one window and the next: two programs ask the window server for their windows' places without waiting for each other. */
    private readonly pauseMs = 0,
  ) {}

  async run(): Promise<void> {
    if (this.running) {
      this.again = true;
      return;
    }
    this.running = true;
    try {
      do {
        this.again = false;
        for (const key of [...this.stack.order()]) {
          const ok = await this.raise(key);
          if (!ok) this.stack.drop(key);
          else if (this.pauseMs > 0) await new Promise((resolve) => setTimeout(resolve, this.pauseMs));
        }
      } while (this.again);
    } finally {
      this.running = false;
    }
  }
}
