import { describe, expect, it } from "vitest";
import { layerPoint } from "@shared/photo/layers";
import { quadOf } from "@shared/photo/projective";
import type { LayerTransform } from "@shared/photo/types";
import { dragMode, handlePoint, reshaped, scaled } from "./handles";

const size = { width: 400, height: 200 };
const upright: LayerTransform = { x: 500, y: 400, scaleX: 1, scaleY: 1, rotation: 0 };

const close = (a: { x: number; y: number }, b: { x: number; y: number }, digits = 6) => {
  expect(a.x).toBeCloseTo(b.x, digits);
  expect(a.y).toBeCloseTo(b.y, digits);
};

describe("skew, distort and perspective by the handles", () => {
  it("distorts: a corner goes where it's dragged, the others stay", () => {
    const next = reshaped(upright, size, { u: 1, v: 0 }, { x: 760, y: 260 }, "distort");
    const [tl, tr, br, bl] = quadOf(next, size);
    close(tr, { x: 760, y: 260 });
    close(tl, { x: 300, y: 300 });
    close(br, { x: 700, y: 500 });
    close(bl, { x: 300, y: 500 });
    expect(next.perspective).toBeDefined();
  });

  it("puts a corner in perspective: it and its neighbour move apart along their edge, symmetrically", () => {
    // The top-right corner pulled up: the right edge grows about its middle.
    const next = reshaped(upright, size, { u: 1, v: 0 }, { x: 702, y: 260 }, "perspective");
    const [tl, tr, br, bl] = quadOf(next, size);
    close(tr, { x: 700, y: 260 });
    close(br, { x: 700, y: 540 });
    close(tl, { x: 300, y: 300 });
    close(bl, { x: 300, y: 500 });
  });

  it("skews: an edge slides along itself, and the layer stays affine", () => {
    const next = reshaped(upright, size, { u: 0.5, v: 0 }, { x: 560, y: 250 }, "skew");
    expect(next.perspective).toBeUndefined();
    expect(next.skew).toBeCloseTo(-Math.atan(60 / 200) * (180 / Math.PI), 6);
    // The bottom edge stayed; the top one moved 60 px right.
    close(layerPoint(next, size, 0, 200), { x: 300, y: 500 });
    close(layerPoint(next, size, 0, 0), { x: 360, y: 300 });
  });

  it("keeps text and shapes affine: distorting them skews, a corner slides its edge", () => {
    const next = reshaped(upright, size, { u: 1, v: 0 }, { x: 740, y: 302 }, "distort", false);
    expect(next.perspective).toBeUndefined();
    close(layerPoint(next, size, 400, 0), { x: 740, y: 300 });
    close(layerPoint(next, size, 0, 0), { x: 340, y: 300 });
  });

  it("refuses a quad that can't hold the picture", () => {
    expect(reshaped(upright, size, { u: 1, v: 0 }, { x: 250, y: 600 }, "distort")).toBe(upright);
  });

  it("scales a skewed layer along its own axes, its anchor kept", () => {
    const skewed: LayerTransform = { ...upright, rotation: 20, skew: 15 };
    const anchor = handlePoint(skewed, size, { u: 0, v: 0.5 });
    const right = handlePoint(skewed, size, { u: 1, v: 0.5 });
    const target = { x: anchor.x + (right.x - anchor.x) * 1.5, y: anchor.y + (right.y - anchor.y) * 1.5 };
    const next = scaled(skewed, size, { u: 1, v: 0.5 }, target);
    close(handlePoint(next, size, { u: 0, v: 0.5 }), anchor);
    close(handlePoint(next, size, { u: 1, v: 0.5 }), target);
    expect(next.scaleX).toBeCloseTo(1.5, 6);
    expect(next.skew).toBeCloseTo(15, 6);
  });

  it("picks the mode by Photoshop's modifiers, else Free Transform's", () => {
    const corner = { u: 1, v: 0 } as const;
    const edge = { u: 0.5, v: 1 } as const;
    const keys = (mod = false, alt = false, shift = false) => ({ mod, alt, shift });
    expect(dragMode(corner, keys(), null)).toBe("scale");
    expect(dragMode(corner, keys(true), null)).toBe("distort");
    expect(dragMode(edge, keys(true), null)).toBe("skew");
    expect(dragMode(corner, keys(true, true, true), null)).toBe("perspective");
    expect(dragMode(corner, keys(), "perspective")).toBe("perspective");
    expect(dragMode(edge, keys(false, true), "skew")).toBe("skew");
  });
});
