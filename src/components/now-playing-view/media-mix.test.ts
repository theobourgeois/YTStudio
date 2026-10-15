import { describe, expect, it } from "vitest";
import { seededRandom } from "@shared/live-looks";
import { KickHit, type MediaMode, amountOver, mixFor, pickMedia } from "./media-mix";

const modes = (intensity: number, slow = 0) => {
  const random = seededRandom(`modes${intensity}${slow}`);
  const seen = new Map<MediaMode, number>();
  for (let i = 0; i < 400; i++) {
    const m = mixFor({ intensity, slow }, random).mode;
    seen.set(m, (seen.get(m) ?? 0) + 1);
  }
  return seen;
};

describe("how the user's clips go into the feedback", () => {
  it("lets more of a clip in when it's calm, only its light and edges when it's intense", () => {
    expect(modes(0.2).get("edges") ?? 0).toBe(0);
    expect(modes(0.2).get("whole")!).toBeGreaterThan(40);
    expect(modes(0.9).get("whole") ?? 0).toBe(0);
    expect(modes(0.9).get("edges")!).toBeGreaterThan(100);
    // A slow song is calm however loud it's mastered.
    expect(modes(0.9, 1).get("edges") ?? 0).toBe(0);
  });

  it("paints in a little all the time and more on a kick: steadier when calm, mostly on the kicks when intense", () => {
    const calm = mixFor({ intensity: 0.2, slow: 0 }, () => 0.9);
    const intense = mixFor({ intensity: 0.9, slow: 0 }, () => 0.1);
    expect(amountOver(calm, 0, 1 / 60)).toBeGreaterThan(amountOver(intense, 0, 1 / 60));
    expect(amountOver(intense, 1, 1 / 60) / amountOver(intense, 0, 1 / 60)).toBeGreaterThan(amountOver(calm, 1, 1 / 60) / amountOver(calm, 0, 1 / 60));
  });

  it("paints in as much a second at any frame rate", () => {
    const mix = mixFor({ intensity: 0.5, slow: 0 }, seededRandom("rate"));
    const at60 = 1 - (1 - amountOver(mix, 0.3, 1 / 60)) ** 60;
    const at30 = 1 - (1 - amountOver(mix, 0.3, 1 / 30)) ** 30;
    expect(at30).toBeCloseTo(at60, 6);
  });

  it("follows a kick's hit up at once and lets it fall away", () => {
    const kick = new KickHit();
    expect(kick.step(0.8, 1 / 60)).toBe(0.8);
    const later = kick.step(0, 0.25);
    expect(later).toBeCloseTo(0.08, 2);
    expect(kick.step(0.5, 1 / 60)).toBe(0.5);
  });
});

describe("which clip", () => {
  const media = [
    { id: "a", kind: "video" as const, duration: 30 },
    { id: "b", kind: "image" as const, duration: 0 },
    { id: "c", kind: "video" as const, duration: 3 },
  ];

  it("picks one not shown lately while there's another", () => {
    const random = seededRandom("pick");
    for (let i = 0; i < 20; i++) expect(pickMedia(media, ["a", "b"], random)!.id).toBe("c");
    expect(pickMedia([], [], random)).toBeNull();
    expect(pickMedia([media[0]], ["a"], random)!.id).toBe("a");
  });

  it("starts a clip somewhere in it, not at its first second or its last, and a picture or a short clip at 0", () => {
    const random = seededRandom("from");
    for (let i = 0; i < 50; i++) {
      const { from } = pickMedia([media[0]], [], random)!;
      expect(from).toBeGreaterThanOrEqual(1);
      expect(from).toBeLessThanOrEqual(28);
    }
    expect(pickMedia([media[1]], [], random)!.from).toBe(0);
    expect(pickMedia([media[2]], [], random)!.from).toBe(0);
  });
});
