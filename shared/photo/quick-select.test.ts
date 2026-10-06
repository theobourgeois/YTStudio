import { describe, expect, it } from "vitest";
import type { PixelSample } from "./pixel-sample.ts";
import { QuickSelection, dabsAlong, quickLevel } from "./quick-select.ts";

/** A 120 × 90 photo: an orange disc on a noisy grey-green ground, and a second disc apart. */
function photo(): PixelSample {
  const width = 120;
  const height = 90;
  const data = new Uint8ClampedArray(width * height * 4);
  let s = 3;
  const noise = () => ((s = (s * 1103515245 + 12345) >>> 0) / 2 ** 32 - 0.5) * 30;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const disc = Math.hypot(x + 0.5 - 40, y + 0.5 - 45) < 25;
      const other = Math.hypot(x + 0.5 - 100, y + 0.5 - 45) < 12;
      const c = disc || other ? [230, 140, 40] : [90, 120, 90];
      data.set([c[0] + noise(), c[1] + noise(), c[2] + noise(), 255], (y * width + x) * 4);
    }
  }
  return { width, height, data, scale: 1 };
}

const inDisc = (x: number, y: number) => Math.hypot(x + 0.5 - 40, y + 0.5 - 45) < 25;

describe("Quick Selection", () => {
  it("grows from a small stroke to the disc's edge, and no further", () => {
    const sample = photo();
    const q = new QuickSelection(sample, new Uint8Array(sample.width * sample.height), false);
    expect(q.paint(dabsAlong([{ x: 35, y: 45 }, { x: 45, y: 45 }], 4))).toBe(true);
    const s = q.selected;
    let wrong = 0;
    for (let y = 0; y < sample.height; y++) for (let x = 0; x < 90; x++) if (!!s[y * sample.width + x] !== inDisc(x, y)) wrong++;
    // The disc is ~1,960 pixels: all but its rim.
    expect(wrong).toBeLessThan(60);
    // The other disc, the same colour but not joined to the stroke, stays out (fluctuation removal).
    expect(s[45 * sample.width + 100]).toBe(0);
  });

  it("subtracts what's painted with Alt, growing to its edges too", () => {
    const sample = photo();
    const all = new Uint8Array(sample.width * sample.height).fill(1);
    const q = new QuickSelection(sample, all, true);
    q.paint(dabsAlong([{ x: 40, y: 45 }], 4));
    const s = q.selected;
    expect(s[45 * sample.width + 40]).toBe(0);
    expect(s[45 * sample.width + 58]).toBe(0);
    expect(s[10 * sample.width + 10]).toBe(1);
  });

  it("changes nothing where the brush is all selected already", () => {
    const sample = photo();
    const q = new QuickSelection(sample, new Uint8Array(sample.width * sample.height).fill(1), false);
    expect(q.paint(dabsAlong([{ x: 40, y: 45 }], 4))).toBe(false);
  });

  it("fills a big shape from one short stroke, over the whole photo, quickly", () => {
    // 1600 × 1200 with a disc of radius 250 (196,350 pixels): the first cut runs reduced, then a band at full detail.
    const width = 1600;
    const height = 1200;
    const data = new Uint8ClampedArray(width * height * 4);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const disc = Math.hypot(x + 0.5 - 500, y + 0.5 - 600) < 250;
        data.set(disc ? [235, 140, 40, 255] : [40, 70, 200, 255], (y * width + x) * 4);
      }
    }
    const sample = { width, height, data, scale: 1 };
    const started = performance.now();
    const q = new QuickSelection(sample, new Uint8Array(width * height), false);
    expect(q.paint(dabsAlong([{ x: 460, y: 600 }, { x: 540, y: 600 }], 15))).toBe(true);
    const ms = performance.now() - started;
    let count = 0;
    let wrong = 0;
    const s = q.selected;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const v = s[y * width + x];
        count += v;
        if (!!v !== Math.hypot(x + 0.5 - 500, y + 0.5 - 600) < 250) wrong++;
      }
    }
    expect(Math.abs(count - Math.PI * 250 * 250) / (Math.PI * 250 * 250)).toBeLessThan(0.01);
    // Edges exact to the pixel, near enough: a rim's worth at most.
    expect(wrong).toBeLessThan(2 * Math.PI * 250 * 0.5);
    expect(ms).toBeLessThan(3000);
  });

  it("works reduced for big brushes", () => {
    expect(quickLevel(20, 1)).toBe(0);
    expect(quickLevel(100, 1)).toBe(2);
    expect(quickLevel(100, 0.5)).toBe(1);
  });
});
