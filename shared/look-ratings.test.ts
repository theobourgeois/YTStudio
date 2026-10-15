import { describe, expect, it } from "vitest";
import { LOVED, LOVED_ELSEWHERE, type LookRating, type RatingVerdict, SKIPPED_MOST, SKIP_FACTOR, normalizeLookRating, readLookRating, tasteOf } from "./look-ratings.ts";
import type { SongCharacter } from "./signals/mood.ts";

let clock = 0;
/** A rating of `look` on a song of `character` (null: its kind not known yet). */
const rated = (look: string, verdict: RatingVerdict, character: SongCharacter | null = null): LookRating => ({
  look,
  verdict,
  at: ++clock,
  seconds: 4,
  song: null,
  mood: { character, intensity: 0.5, slow: 0 },
});

describe("normalizeLookRating", () => {
  it("keeps a rating, its moment rounded and held in range", () => {
    expect(
      normalizeLookRating({
        look: "md-flexi-ghost",
        verdict: "love",
        rating: true,
        seconds: 3.14159,
        song: { id: "spotify:track:1", name: "Midnight Drive", artist: "Neon Avenue", extra: 1 },
        mood: { character: "hype", intensity: 1.7, slow: 0.123 },
      }),
    ).toEqual({
      look: "md-flexi-ghost",
      verdict: "love",
      rating: true,
      seconds: 3.1,
      song: { id: "spotify:track:1", name: "Midnight Drive", artist: "Neon Avenue" },
      mood: { character: "hype", intensity: 1, slow: 0.12 },
    });
  });

  it("refuses what isn't one", () => {
    expect(normalizeLookRating(null)).toBeNull();
    expect(normalizeLookRating({ look: "halo", verdict: "meh" })).toBeNull();
    expect(normalizeLookRating({ look: "../etc", verdict: "love" })).toBeNull();
    expect(normalizeLookRating({ look: "", verdict: "bin" })).toBeNull();
  });

  it("takes an unknown kind of song as not known, and no song as none", () => {
    expect(normalizeLookRating({ look: "halo", verdict: "bin", mood: { character: "polka" }, song: { name: "x" } })).toMatchObject({ song: null, mood: { character: null } });
  });

  it("reads one back only with its time", () => {
    expect(readLookRating({ look: "halo", verdict: "bin", at: 5 })).toMatchObject({ look: "halo", at: 5 });
    expect(readLookRating({ look: "halo", verdict: "bin" })).toBeNull();
  });
});

describe("tasteOf", () => {
  it("wants a look nobody's rated as much as any other", () => {
    const taste = tasteOf([]);
    expect(taste.appeal("halo", "hype")).toBe(1);
    expect(taste.verdict("halo", "hype")).toEqual({ verdict: null, here: false });
    expect(taste.judged("halo")).toBe(false);
  });

  it("never wants a binned look, and wants a loved one more", () => {
    const taste = tasteOf([rated("halo", "bin"), rated("nebula", "love")]);
    expect(taste.appeal("halo", "chill")).toBe(0);
    expect(taste.appeal("nebula", "chill")).toBe(LOVED);
    expect(taste.counts()).toEqual({ loved: 1, binned: 1, ratings: 2 });
  });

  it("takes the latest verdict, and L or B again takes it back", () => {
    expect(tasteOf([rated("halo", "bin"), rated("halo", "love")]).appeal("halo", null)).toBe(LOVED);
    expect(tasteOf([rated("halo", "love"), rated("halo", "clear")]).verdict("halo", null)).toEqual({ verdict: null, here: false });
  });

  it("keeps a look loved on one kind of song there only, once it's binned on another", () => {
    const taste = tasteOf([rated("nebula", "love", "chill"), rated("nebula", "bin", "hype")]);
    expect(taste.appeal("nebula", "chill")).toBe(LOVED);
    expect(taste.appeal("nebula", "hype")).toBe(0);
    // A kind it was never rated on: binned, since it was somewhere and loved only where it was.
    expect(taste.verdict("nebula", "groove")).toEqual({ verdict: "bin", here: false });
  });

  it("bins a look everywhere when it's binned on one kind and loved on none", () => {
    const taste = tasteOf([rated("halo", "bin", "hype")]);
    expect(taste.appeal("halo", "chill")).toBe(0);
    expect(taste.verdict("halo", "hype")).toEqual({ verdict: "bin", here: true });
  });

  it("likes a look loved on another kind of song, less than where it was loved", () => {
    const taste = tasteOf([rated("nebula", "love", "chill")]);
    expect(taste.appeal("nebula", "hype")).toBe(LOVED_ELSEWHERE);
    expect(taste.verdict("nebula", "hype")).toEqual({ verdict: "love", here: false });
  });

  it("takes a verdict given before the song's kind was known as the look's as a whole", () => {
    const taste = tasteOf([rated("nebula", "love", "chill"), rated("nebula", "bin")]);
    expect(taste.appeal("nebula", "chill")).toBe(0);
    expect(taste.appeal("nebula", "hype")).toBe(0);
  });

  it("takes back a kind's own verdict first, then the look's as a whole", () => {
    const taste = tasteOf([rated("nebula", "bin"), rated("nebula", "love", "chill"), rated("nebula", "clear", "chill")]);
    expect(taste.verdict("nebula", "chill")).toEqual({ verdict: "bin", here: true });
  });

  it("wants a look less each time it's skipped, down to a floor, until it's given a verdict", () => {
    expect(tasteOf([rated("halo", "skip")]).appeal("halo", "hype")).toBeCloseTo(SKIP_FACTOR);
    expect(tasteOf([rated("halo", "skip"), rated("halo", "skip")]).appeal("halo", "hype")).toBeCloseTo(SKIP_FACTOR ** 2);
    expect(tasteOf(Array.from({ length: 12 }, () => rated("halo", "skip"))).appeal("halo", "hype")).toBe(SKIPPED_MOST);
    expect(tasteOf([rated("halo", "skip"), rated("halo", "love")]).appeal("halo", null)).toBe(LOVED);
    expect(tasteOf([rated("halo", "skip")]).judged("halo")).toBe(false);
  });

  it("counts a pass in the rating mode as judged, and as nothing else", () => {
    const taste = tasteOf([rated("halo", "pass", "hype")]);
    expect(taste.judged("halo")).toBe(true);
    expect(taste.appeal("halo", "hype")).toBe(1);
  });
});
