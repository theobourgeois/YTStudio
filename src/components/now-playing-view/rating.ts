/**
 * The rating mode (docs/now-playing.md, "Your taste"): the looks one after another, each for `RATE_SECONDS`, for the
 * user to love (L) or bin (B) as they pass, moving on at once (→ with nothing said, ← back to the one before). Looks
 * nobody has judged come first, then those only passed over; each is one that suits what's playing, so it's judged
 * where it would be shown. Pure, and tested.
 */
import type { LiveLook } from "@shared/live-looks";
import type { Taste } from "@shared/look-ratings";
import type { Mood } from "@shared/signals/mood";
import { pickLook } from "./chooser";

/** Seconds each look shows before the next, if nothing's said. */
export const RATE_SECONDS = 10;
/** Seconds a look the visualizer put up may be left within to count as skipped (a small thumbs-down). */
export const SKIP_SECONDS = 8;

export class RatingRound {
  /** The looks shown this round, in order, and which of them is showing (← goes back through them). */
  private shown: string[] = [];
  private at = -1;

  constructor(
    private readonly looks: readonly LiveLook[],
    private readonly random: () => number = Math.random,
  ) {}

  /** The look showing, if any. */
  get current(): string | null {
    return this.shown[this.at] ?? null;
  }

  /**
   * The next look to rate (after going back, the one that came after it): one not shown this round that nobody has
   * judged, else one only passed over, suiting the music (`mood`, if it's heard). Null: there's none left.
   */
  next(taste: Taste, mood: Mood | null): string | null {
    if (this.at < this.shown.length - 1) return this.shown[++this.at];
    const left = this.looks.filter((l) => !this.shown.includes(l.id));
    const fresh = left.filter((l) => !taste.judged(l.id));
    const pool = fresh.length ? fresh : left.filter((l) => taste.verdict(l.id, null).verdict === null);
    if (!pool.length) return null;
    const look = mood ? pickLook(pool, mood, [], this.random) : pool[Math.floor(this.random() * pool.length)];
    this.shown.push(look.id);
    this.at = this.shown.length - 1;
    return look.id;
  }

  /** The look before the one showing, again (null: it's the first). */
  back(): string | null {
    if (this.at <= 0) return null;
    return this.shown[--this.at];
  }

  /** Looks nobody has judged yet. */
  left(taste: Taste): number {
    return this.looks.filter((l) => !taste.judged(l.id)).length;
  }
}
