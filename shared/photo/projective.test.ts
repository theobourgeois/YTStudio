import { describe, expect, it } from "vitest";
import { composeHomography, cosSin, invertHomography, isConvexQuad, layerProjection, maxLayerScale, project, quadOf, rectToQuad, transformFromQuad } from "./projective.ts";
import type { LayerTransform } from "./types.ts";

const size = { width: 400, height: 200 };

const close = (a: { x: number; y: number } | null, b: { x: number; y: number }, digits = 6) => {
  expect(a).not.toBeNull();
  expect(a!.x).toBeCloseTo(b.x, digits);
  expect(a!.y).toBeCloseTo(b.y, digits);
};

describe("a layer's projective place", () => {
  it("is the plain place when there's no skew or perspective", () => {
    const t: LayerTransform = { x: 500, y: 300, scaleX: 2, scaleY: -1, rotation: 30 };
    const m = layerProjection(t, size);
    const [cos, sin] = cosSin(30);
    // The centre lands on (x, y); the right edge's middle 200·2 px along the rotation.
    close(project(m, 200, 100), { x: 500, y: 300 });
    close(project(m, 400, 100), { x: 500 + 400 * cos, y: 300 + 400 * sin });
    expect(m.slice(6)).toEqual([0, 0, 1]);
  });

  it("leans its vertical edges by the skew, the centre where it was", () => {
    const m = layerProjection({ x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0, skew: 45 }, size);
    // The bottom edge (100 px below the centre) moves 100 px right; the top 100 px left.
    close(project(m, 200, 200), { x: 100, y: 100 });
    close(project(m, 200, 0), { x: -100, y: -100 });
  });

  it("shrinks the far side by its perspective, the centre where it was", () => {
    const t: LayerTransform = { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0, perspective: [0.5, 0] };
    const [tl, tr, br, bl] = quadOf(t, size);
    close(project(layerProjection(t, size), 200, 100), { x: 0, y: 0 });
    // w = 1.5 at the right edge, 0.5 at the left: the right side is a third of the left's height.
    expect(tr.y - br.y).toBeCloseTo((tl.y - bl.y) / 3, 9);
    expect(maxLayerScale(t)).toBeCloseTo(Math.sqrt(1 / 0.5 ** 3), 9);
  });

  it("comes back from its four corners exactly: centre, scale, rotation, skew and perspective", () => {
    const places: LayerTransform[] = [
      { x: 500, y: 300, scaleX: 1, scaleY: 1, rotation: 0 },
      { x: 120.5, y: -40, scaleX: 0.5, scaleY: 2, rotation: 30, skew: 12 },
      { x: 800, y: 600, scaleX: 1.5, scaleY: 1.25, rotation: -60, skew: -20, perspective: [0.3, -0.2] },
      { x: 10, y: 20, scaleX: -1, scaleY: 1, rotation: 90, perspective: [0, 0.4] },
    ];
    for (const t of places) {
      const back = transformFromQuad(quadOf(t, size), size, t)!;
      expect(back.x).toBeCloseTo(t.x, 6);
      expect(back.y).toBeCloseTo(t.y, 6);
      expect(back.scaleX).toBeCloseTo(t.scaleX, 6);
      expect(back.scaleY).toBeCloseTo(t.scaleY, 6);
      expect(back.rotation).toBeCloseTo(t.rotation, 6);
      expect(back.skew ?? 0).toBeCloseTo(t.skew ?? 0, 6);
      expect(back.perspective?.[0] ?? 0).toBeCloseTo(t.perspective?.[0] ?? 0, 6);
      expect(back.perspective?.[1] ?? 0).toBeCloseTo(t.perspective?.[1] ?? 0, 6);
    }
    // A plain place gives back exactly its numbers (no skew or perspective field).
    expect(transformFromQuad(quadOf(places[0], size), size)).toEqual(places[0]);
  });

  it("puts the layer's corners on any convex quad, and refuses others", () => {
    const quad = [{ x: 100, y: 120 }, { x: 520, y: 80 }, { x: 600, y: 400 }, { x: 60, y: 360 }] as const;
    const t = transformFromQuad(quad, size)!;
    quadOf(t, size).forEach((p, i) => close(p, quad[i]));
    const m = rectToQuad(size, quad);
    close(project(m, 0, 0), quad[0]);
    close(project(m, 400, 200), quad[2]);
    // A bow tie, a line, a dent.
    expect(transformFromQuad([quad[0], quad[2], quad[1], quad[3]], size)).toBeNull();
    expect(isConvexQuad([{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 }, { x: 3, y: 0 }])).toBe(false);
    expect(isConvexQuad([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 2, y: 2 }, { x: 0, y: 10 }])).toBe(false);
  });

  it("inverts and composes", () => {
    const m = layerProjection({ x: 300, y: 200, scaleX: 1.2, scaleY: 0.8, rotation: 15, skew: 10, perspective: [0.2, 0.1] }, size);
    const id = composeHomography(invertHomography(m), m);
    close(project(id, 37, 91), { x: 37, y: 91 }, 9);
    const p = project(m, 50, 60)!;
    close(project(invertHomography(m), p.x, p.y), { x: 50, y: 60 }, 6);
  });
});
