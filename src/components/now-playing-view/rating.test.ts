import { describe, expect, it } from "vitest";
import { LIVE_LOOKS, seededRandom } from "@shared/live-looks";
import { type LookRating, tasteOf } from "@shared/look-ratings";
import type { Mood } from "@shared/signals/mood";
import { suits } from "./chooser";
import { RatingRound } from "./rating";

const said = (look: string, verdict: LookRating["verdict"]): LookRating => ({ look, verdict, at: 0, seconds: 2, song: null, mood: null });

const MOOD: Mood = {
  intensity: 0.8,
  presence: { low: 0, mid: 0, high: 0 },
  section: "steady",
  sectionSince: 0,
  character: "hype",
  sure: 0.8,
  scores: { chill: 0, groove: 0, hype: 1, heavy: 0 },
  slow: 0,
  vibe: null,
  events: [],
  heard: { loudness: -10, hits: 6, kicks: 2, sub: 0.3, brightness: 3000 },
};

describe("the rating mode", () => {
  it("goes through every look once, those nobody has judged first, then those only passed over", () => {
    const looks = LIVE_LOOKS.slice(0, 12);
    const taste = tasteOf([said(looks[0].id, "love"), said(looks[1].id, "pass"), said(looks[2].id, "skip")]);
    const round = new RatingRound(looks, seededRandom("round"));
    const order: string[] = [];
    for (let look = round.next(taste, null); look; look = round.next(taste, null)) order.push(look);
    // Loved already: not again. Passed over: last. Only skipped: as any other not judged.
    expect(order).not.toContain(looks[0].id);
    expect(order.at(-1)).toBe(looks[1].id);
    expect(order).toContain(looks[2].id);
    expect(new Set(order).size).toBe(order.length);
    expect(order).toHaveLength(11);
    expect(round.left(taste)).toBe(10);
  });

  it("shows a look that suits what's playing", () => {
    const round = new RatingRound(LIVE_LOOKS, seededRandom("suits"));
    const taste = tasteOf([]);
    for (let i = 0; i < 10; i++) {
      const id = round.next(taste, MOOD);
      expect(suits(LIVE_LOOKS.find((l) => l.id === id)!, MOOD), id!).toBe(true);
    }
  });

  it("goes back through what it showed, and on again to where it was", () => {
    const round = new RatingRound(LIVE_LOOKS.slice(0, 5), seededRandom("back"));
    const taste = tasteOf([]);
    const a = round.next(taste, null);
    const b = round.next(taste, null);
    expect(round.back()).toBe(a);
    expect(round.back()).toBeNull();
    expect(round.current).toBe(a);
    expect(round.next(taste, null)).toBe(b);
    expect(round.next(taste, null)).not.toBe(a);
  });
});
