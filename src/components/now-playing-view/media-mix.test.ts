import { describe, expect, it } from "vitest";
import { seededRandom } from "@shared/live-looks";
import { FLAT_SHARE, KickHit, PALE, STILL_FLAT, type MediaMode, amountOver, backdropOf, floatSize, mixFor, nextVisit, pickMedia, pickSeveral, placementOf, seatsFor, shownAt, togetherFor, visitFade } from "./media-mix";

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
  it("shows all of a clip most when it's calm, its light and edges more as it gets intense", () => {
    expect(modes(0.2).get("edges") ?? 0).toBe(0);
    expect(modes(0.2).get("whole")!).toBeGreaterThan(240);
    expect(modes(0.9).get("whole")!).toBeLessThan(200);
    expect(modes(0.9).get("edges")!).toBeGreaterThan(100);
    // A slow song is calm however loud it's mastered.
    expect(modes(0.9, 1).get("edges") ?? 0).toBe(0);
  });

  it("shows the clip plainly on top, more on a kick, most of all on an intense one", () => {
    const calm = mixFor({ intensity: 0.2, slow: 0 }, () => 0.1);
    const intense = mixFor({ intensity: 0.9, slow: 0 }, () => 0.1);
    expect(shownAt(calm, 0)).toBeGreaterThanOrEqual(0.5);
    expect(shownAt(intense, 1) - shownAt(intense, 0)).toBeGreaterThan(shownAt(calm, 1) - shownAt(calm, 0));
    expect(shownAt(intense, 1)).toBeLessThanOrEqual(1);
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

  it("shows a screen whole, mostly as itself, less on top than a clip and flashing up more on the kicks", () => {
    const random = seededRandom("screen");
    for (const intensity of [0.2, 0.5, 0.9]) {
      const clip = mixFor({ intensity, slow: 0 }, () => 0.1);
      const screen = mixFor({ intensity, slow: 0 }, random, "screen");
      expect(screen.zoom).toBe(1);
      expect(screen.size).toBe(1);
      expect(screen.show).toBeLessThan(clip.show);
      expect(screen.showKick).toBeGreaterThan(clip.showKick);
    }
    const whole = Array.from({ length: 200 }, () => mixFor({ intensity: 0.5, slow: 0 }, random, "screen").mode).filter((m) => m === "whole").length;
    expect(whole).toBeGreaterThan(100);
  });

  it("follows a kick's hit up at once and lets it fall away", () => {
    const kick = new KickHit();
    expect(kick.step(0.8, 1 / 60)).toBe(0.8);
    const later = kick.step(0, 0.25);
    expect(later).toBeCloseTo(0.08, 2);
    expect(kick.step(0.5, 1 / 60)).toBe(0.5);
  });
});

/** A small frame (RGBA) of `width` × `height` in `background`, with `figure` drawn where `inside` says. */
function frame(width: number, height: number, background: number[], figure: number[], inside: (x: number, y: number) => boolean): Uint8ClampedArray {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const c = inside(x, y) ? figure : background;
      data.set([...c, 255], (y * width + x) * 4);
    }
  }
  return data;
}

describe("a clip's background", () => {
  it("takes a flat background as one, even with dancers crossing its edge", () => {
    // Pale, dancers across the bottom and up the left.
    const data = frame(32, 32, [200, 196, 200], [40, 30, 90], (x, y) => y > 24 || (x < 3 && y > 10));
    const backdrop = backdropOf(data, 32, 32);
    expect(backdrop.flat).toBe(true);
    expect(backdrop.light).toBeGreaterThan(PALE);
    expect(backdrop.color.map((v) => Math.round(v * 255))).toEqual([200, 196, 200]);
    // Black, a face in the middle.
    expect(backdropOf(frame(32, 32, [3, 3, 3], [200, 200, 210], (x, y) => Math.hypot(x - 16, y - 16) < 9), 32, 32).flat).toBe(true);
  });

  it("doesn't take footage's edge as a background", () => {
    // A gradient every way, as footage's edge is.
    const data = new Uint8ClampedArray(32 * 18 * 4);
    for (let y = 0; y < 18; y++) for (let x = 0; x < 32; x++) data.set([x * 8, y * 14, (x * y) % 255, 255], (y * 32 + x) * 4);
    expect(backdropOf(data, 32, 18).flat).toBe(false);
  });

  it("keeps a background taken as flat unless it's clearly not any more (no flicker as the clip moves)", () => {
    // Under half its edge the background (grey, between a dark and a light figure): not enough to start, enough to stay.
    const half = new Uint8ClampedArray(32 * 32 * 4);
    for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) half.set([...(y > 14 ? (x < 16 ? [20, 20, 30] : [235, 230, 240]) : [128, 128, 128]), 255], (y * 32 + x) * 4);
    const { share, color } = backdropOf(half, 32, 32);
    expect(color.map((v) => Math.round(v * 255))).toEqual([128, 128, 128]);
    expect(share).toBeLessThan(FLAT_SHARE);
    expect(share).toBeGreaterThan(STILL_FLAT);
    expect(backdropOf(half, 32, 32).flat).toBe(false);
    expect(backdropOf(half, 32, 32, { color: [0.5, 0.5, 0.5], share: 0.9, flat: true, light: 0.5 }).flat).toBe(true);
  });

  it("fills the frame with a clip of its shape, background or not (no box in the middle), and floats one of another", () => {
    expect(placementOf(16 / 9, 16 / 9)).toBe("fill");
    expect(placementOf(1920 / 1080, 16 / 9)).toBe("fill");
    expect(placementOf(1, 16 / 9)).toBe("float");
    expect(placementOf(9 / 16, 16 / 9)).toBe("float");
  });

  it("floats a clip at its own shape, no wider than the frame lets it", () => {
    const [w, h] = floatSize(1, 16 / 9, 0.8);
    expect(h).toBeCloseTo(0.8);
    expect(w).toBeCloseTo(0.45);
    expect(floatSize(3, 16 / 9, 0.8)[0]).toBeCloseTo(0.92);
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

describe("the clips over a screen shared", () => {
  it("come in for a few bars, a while after the last, on the bar", () => {
    const random = seededRandom("visits");
    for (let i = 0; i < 50; i++) {
      const v = nextVisit(10, 2, 0.5, random);
      expect(v.from).toBeGreaterThan(10);
      expect(((v.from - 10) / 2) % 1).toBe(0);
      expect((v.until - v.from) / 2).toBeGreaterThanOrEqual(2);
      expect((v.until - v.from) / 2).toBeLessThanOrEqual(4);
    }
  });

  it("come back sooner as the music gets intense", () => {
    const away = (intensity: number) => {
      const random = seededRandom(`away${intensity}`);
      let sum = 0;
      for (let i = 0; i < 100; i++) sum += nextVisit(0, 1, intensity, random).from;
      return sum / 100;
    };
    expect(away(0.9)).toBeLessThan(away(0.2));
  });

  it("fade in and out rather than cutting over the screen", () => {
    const v = { from: 10, until: 20 };
    expect(visitFade(v, 9)).toBe(0);
    expect(visitFade(v, 10.2)).toBeGreaterThan(0);
    expect(visitFade(v, 10.2)).toBeLessThan(1);
    expect(visitFade(v, 15)).toBe(1);
    expect(visitFade(v, 19.9)).toBeLessThan(1);
    expect(visitFade(v, 21)).toBe(0);
  });
});

describe("several at once", () => {
  const LOOKS = Array.from({ length: 200 }, (_, i) => `md-look-${i}`);

  it("is each look's own way: some show one, some two, some three", () => {
    const most = LOOKS.map((look) => togetherFor(look, 10, 1, () => 0));
    expect(new Set(most)).toEqual(new Set([1, 2, 3]));
    const ones = most.filter((n) => n === 1).length / most.length;
    expect(ones).toBeGreaterThan(0.3);
    expect(ones).toBeLessThan(0.6);
    // The same look leans the same way every time.
    expect(LOOKS.map((look) => togetherFor(look, 10, 1, () => 0))).toEqual(most);
  });

  it("never shows more than there are, and fewer more often when it's calm", () => {
    for (const look of LOOKS) expect(togetherFor(look, 1, 1, Math.random)).toBe(1);
    for (const look of LOOKS) expect(togetherFor(look, 2, 1, Math.random)).toBeLessThanOrEqual(2);
    const count = (intensity: number) => {
      const random = seededRandom("calm");
      return LOOKS.reduce((sum, look) => sum + togetherFor(look, 10, intensity, random), 0);
    };
    expect(count(1)).toBeGreaterThan(count(0));
  });

  it("seats them side by side in the frame, smaller, not overlapping", () => {
    expect(seatsFor(1, Math.random)).toEqual([{ x: 0, y: 0, scale: 1 }]);
    for (const n of [2, 3]) {
      const seats = seatsFor(n, Math.random);
      expect(seats).toHaveLength(n);
      for (let i = 1; i < n; i++) expect(seats[i].x - seats[i - 1].x).toBeGreaterThan(seats[i].scale);
      for (const seat of seats) {
        expect(Math.abs(seat.x) + seat.scale / 2).toBeLessThan(0.5);
        expect(seat.scale).toBeLessThan(1);
      }
    }
  });

  it("picks different ones", () => {
    const media = ["a", "b", "c"].map((id) => ({ id, kind: "image" as const, duration: 0 }));
    const picked = pickSeveral(media, [], 3, seededRandom("three")).map((p) => p.id);
    expect(new Set(picked).size).toBe(3);
    expect(pickSeveral(media, [], 5, Math.random)).toHaveLength(3);
    expect(pickSeveral([], [], 2, Math.random)).toEqual([]);
  });
});
