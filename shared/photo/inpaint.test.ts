import { describe, expect, it } from "vitest";
import { FILL_SIDE, type PixelBox, fillAlpha, fillBox, fillReach, gaussian, grainToAdd, growHole, holeAt, noiseSigma, planFill, reflect, sampleCubic, standInFill } from "./inpaint.ts";

/** A box's hole with these rectangles (document pixels) set. */
function holeWith(box: PixelBox, rects: PixelBox[]): Uint8Array {
  const w = box.x1 - box.x0;
  const out = new Uint8Array(w * (box.y1 - box.y0));
  for (const r of rects) for (let y = r.y0; y < r.y1; y++) for (let x = r.x0; x < r.x1; x++) out[(y - box.y0) * w + (x - box.x0)] = 1;
  return out;
}

describe("the hole and its edge", () => {
  it("grows with the photo and keeps grow ≥ 2 × feather", () => {
    expect(fillReach({ width: 800, height: 600 })).toEqual({ grow: 4, feather: 2 });
    const big = fillReach({ width: 6000, height: 4000 });
    expect(big.grow).toBe(18);
    expect(big.grow).toBeGreaterThanOrEqual(2 * big.feather);
  });

  it("works in the selection's box grown, inside the canvas", () => {
    const canvas = { width: 100, height: 80 };
    expect(fillBox({ x0: 10, y0: 10, x1: 20, y1: 30 }, 5, canvas)).toEqual({ x0: 5, y0: 5, x1: 25, y1: 35 });
    expect(fillBox({ x0: 0, y0: 70, x1: 100, y1: 80 }, 5, canvas)).toEqual({ x0: 0, y0: 65, x1: 100, y1: 80 });
    expect(fillBox({ x0: 200, y0: 0, x1: 300, y1: 10 }, 5, canvas)).toBeNull();
  });

  it("grows what's selected by a square, and the edge is 0 outside the hole and 255 over the selection", () => {
    const canvas = { width: 200, height: 200 };
    const box = { x0: 40, y0: 40, x1: 80, y1: 80 };
    const coverage = new Uint8Array(40 * 40);
    // One soft pixel and a solid block.
    coverage[20 * 40 + 20] = 30;
    for (let y = 10; y < 14; y++) for (let x = 5; x < 9; x++) coverage[y * 40 + x] = 255;
    const hole = growHole(coverage, box, 6, canvas);
    const at = (a: Uint8Array, x: number, y: number) => a[(y - 40) * 40 + (x - 40)];
    expect(at(hole, 60 + 6, 60)).toBe(1);
    expect(at(hole, 60 + 7, 60)).toBe(0);
    expect(at(hole, 60 + 6, 60 - 6)).toBe(1);
    const alpha = fillAlpha(hole, box, 2, canvas);
    for (let y = 40; y < 80; y++)
      for (let x = 40; x < 80; x++) {
        if (!at(hole, x, y)) expect(at(alpha, x, y)).toBe(0);
        if (coverage[(y - 40) * 40 + (x - 40)]) expect(at(alpha, x, y)).toBe(255);
      }
    // Soft between.
    expect(at(alpha, 60 + 5, 60)).toBeGreaterThan(0);
    expect(at(alpha, 60 + 5, 60)).toBeLessThan(255);
  });

  it("runs on past a canvas side: a hole there stays whole up to the edge", () => {
    const canvas = { width: 50, height: 50 };
    const box = { x0: 0, y0: 0, x1: 20, y1: 20 };
    const hole = growHole(holeWith(box, [{ x0: 0, y0: 0, x1: 6, y1: 6 }]), box, 4, canvas);
    const alpha = fillAlpha(hole, box, 2, canvas);
    expect(alpha[0]).toBe(255);
    expect(alpha[5]).toBe(255);
  });
});

describe("planFill", () => {
  it("fills a small hole in a 512 crop around it, at the photo's own resolution", () => {
    const canvas = { width: 4000, height: 3000 };
    const box = { x0: 1000, y0: 1000, x1: 1100, y1: 1200 };
    const plan = planFill(holeWith(box, [{ x0: 1020, y0: 1010, x1: 1080, y1: 1190 }]), box, canvas);
    expect(plan.crops).toHaveLength(1);
    const [c] = plan.crops;
    expect(c.side).toBe(FILL_SIDE);
    expect(c.scale).toBe(1);
    // Around the hole.
    expect(c.x).toBeLessThanOrEqual(c.hole.x0);
    expect(c.x + c.side).toBeGreaterThanOrEqual(c.hole.x1);
    expect(c.y).toBeLessThanOrEqual(c.hole.y0);
    expect(c.y + c.side).toBeGreaterThanOrEqual(c.hole.y1);
    expect(holeAt(plan, 1050, 1100)).toBe(c.members[0]);
    expect(holeAt(plan, 1001, 1001)).toBe(-1);
  });

  it("gives a big hole a crop about twice its size, scaled to the model, inside the canvas", () => {
    const canvas = { width: 4000, height: 3000 };
    const box = { x0: 0, y0: 0, x1: 4000, y1: 3000 };
    const plan = planFill(holeWith(box, [{ x0: 3000, y0: 2000, x1: 3600, y1: 2800 }]), box, canvas);
    const [c] = plan.crops;
    expect(c.side).toBe(Math.ceil(2.2 * 800));
    expect(c.scale).toBeCloseTo(FILL_SIDE / c.side);
    expect(c.x + c.side).toBeLessThanOrEqual(4000);
    expect(c.y + c.side).toBeLessThanOrEqual(3000);
  });

  it("never makes a crop longer than the canvas: past its short side it's reflected", () => {
    const canvas = { width: 3000, height: 1000 };
    const box = { x0: 0, y0: 0, x1: 3000, y1: 1000 };
    const [c] = planFill(holeWith(box, [{ x0: 500, y0: 100, x1: 2000, y1: 900 }]), box, canvas).crops;
    expect(c.side).toBe(3000);
    expect(c.x).toBe(0);
    expect(c.y).toBe(-1000);
  });

  it("keeps a big hole and a small one apart when one crop for both would be much bigger: the small one at full resolution, after", () => {
    const canvas = { width: 5000, height: 3000 };
    const box = { x0: 0, y0: 0, x1: 5000, y1: 3000 };
    const plan = planFill(holeWith(box, [{ x0: 3000, y0: 1000, x1: 3300, y1: 2000 }, { x0: 4600, y0: 1900, x1: 4640, y1: 1930 }]), box, canvas);
    // The big hole's blocks run 992..2000: 1008 tall.
    expect(plan.crops.map((c) => c.side)).toEqual([Math.ceil(2.2 * 1008), FILL_SIDE]);
    expect(new Set(plan.crops.flatMap((c) => c.members)).size).toBe(2);
  });

  it("fills holes together when one crop holds them hardly bigger (a tree and the sheep at its foot)", () => {
    const canvas = { width: 5000, height: 3000 };
    const box = { x0: 0, y0: 0, x1: 5000, y1: 3000 };
    const near = planFill(holeWith(box, [{ x0: 3000, y0: 1000, x1: 3300, y1: 2000 }, { x0: 3500, y0: 1900, x1: 3540, y1: 1930 }]), box, canvas);
    expect(near.crops).toHaveLength(1);
  });

  it("fills nearby small holes together when one crop holds them as well", () => {
    const canvas = { width: 2000, height: 2000 };
    const box = { x0: 0, y0: 0, x1: 2000, y1: 2000 };
    const plan = planFill(holeWith(box, [{ x0: 1000, y0: 1000, x1: 1030, y1: 1030 }, { x0: 1080, y0: 1000, x1: 1110, y1: 1030 }]), box, canvas);
    expect(plan.crops).toHaveLength(1);
    expect(plan.crops[0].members.sort()).toEqual([0, 1]);
    expect(plan.crops[0].scale).toBe(1);
  });
});

describe("the way back", () => {
  it("reflects indices past either edge", () => {
    expect([-2, -1, 0, 4, 5, 6].map((v) => reflect(v, 5))).toEqual([1, 0, 0, 4, 4, 3]);
    expect(reflect(-13, 5)).toBe(reflect(-13 + 10, 5));
  });

  it("reads the model's answer bicubic: exact at its pixels, even on a ramp", () => {
    const side = 8;
    const rgb = new Float32Array(side * side * 3);
    for (let y = 0; y < side; y++) for (let x = 0; x < side; x++) rgb.set([x * 10, y * 10, 100], (y * side + x) * 3);
    const out = [0, 0, 0];
    sampleCubic(rgb, side, 3, 4, out);
    expect(out).toEqual([30, 40, 100]);
    sampleCubic(rgb, side, 3.5, 4.25, out);
    expect(out[0]).toBeCloseTo(35);
    expect(out[1]).toBeCloseTo(42.5);
  });

  it("measures grain by the median, and adds what's missing", () => {
    const next = gaussian(7);
    const values = Array.from({ length: 20000 }, () => Math.abs(next() * 4));
    expect(noiseSigma(values)).toBeCloseTo(4, 0);
    expect(noiseSigma([1, 2, 3])).toBe(0);
    expect(grainToAdd(3, 4)).toBe(0);
    expect(grainToAdd(5, 3)).toBeCloseTo(4 / Math.sqrt(8 / 9));
    // Repeatable.
    expect(gaussian(3)()).toBe(gaussian(3)());
  });

  it("stands in for the model with the mean of what's around the hole", () => {
    const rgb = new Uint8Array([10, 20, 30, 30, 40, 50, 200, 200, 200]);
    const out = standInFill(rgb, new Uint8Array([0, 0, 1]));
    expect(Array.from(out)).toEqual([10, 20, 30, 30, 40, 50, 20, 30, 40]);
  });
});
