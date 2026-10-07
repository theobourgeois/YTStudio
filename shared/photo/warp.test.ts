import { describe, expect, it } from "vitest";
import { WARP_STYLES, identityPoints, moveWarpPoint, isIdentityWarp, normalizeWarp, styleFunction, stylePoints, unwarp, warpArea, warpPoint } from "./warp.ts";

describe("a warp's patch", () => {
  it("warps nothing at its identity points", () => {
    const id = identityPoints();
    for (const [u, v] of [[0, 0], [0.3, 0.7], [1, 1]]) expect(warpPoint(id, u, v).map((c) => Math.round(c * 1e12) / 1e12)).toEqual([u, v]);
    expect(isIdentityWarp({ points: id, style: null })).toBe(true);
  });

  it("is undone point for point by unwarp, for every style at a strong bend", () => {
    for (const style of WARP_STYLES) {
      const points = stylePoints({ style, bend: 60, horizontal: 10, vertical: -10, orientation: "horizontal" });
      for (const [u, v] of [[0.1, 0.1], [0.5, 0.5], [0.9, 0.3], [0.25, 0.95]]) {
        if (warpArea(points, u, v) <= 0) continue;
        const p = warpPoint(points, u, v);
        const back = unwarp(points, p[0], p[1]);
        expect(back, style).not.toBeNull();
        expect(back![0]).toBeCloseTo(u, 6);
        expect(back![1]).toBeCloseTo(v, 6);
      }
      // Outside the patch, nothing.
      expect(unwarp(points, -2, -2)).toBeNull();
    }
  });

  it("fits each style closely: the patch follows the style's own map", () => {
    for (const style of WARP_STYLES) {
      const settings = { style, bend: 50, horizontal: 0, vertical: 0, orientation: "horizontal" as const };
      const f = styleFunction(settings);
      const points = stylePoints(settings);
      let worst = 0;
      for (let j = 0; j <= 10; j++) for (let i = 0; i <= 10; i++) {
        const want = f(i / 10, j / 10);
        const got = warpPoint(points, i / 10, j / 10);
        worst = Math.max(worst, Math.hypot(want[0] - got[0], want[1] - got[1]));
      }
      expect(worst, style).toBeLessThan(0.05);
    }
  });

  it("bends nothing at bend 0, and bends the other way when vertical", () => {
    expect(stylePoints({ style: "arc", bend: 0, horizontal: 0, vertical: 0, orientation: "horizontal" }).every((p, k) => Math.abs(p[0] - (k % 4) / 3) < 1e-9 && Math.abs(p[1] - Math.floor(k / 4) / 3) < 1e-9)).toBe(true);
    const across = styleFunction({ style: "arch", bend: 50, horizontal: 0, vertical: 0, orientation: "horizontal" })(0.5, 0);
    const down = styleFunction({ style: "arch", bend: 50, horizontal: 0, vertical: 0, orientation: "vertical" })(0, 0.5);
    // Arch: the top edge's middle rises across; the left edge's middle moves sideways when vertical.
    expect(across[1]).toBeLessThan(0);
    expect(Math.abs(down[0])).toBeGreaterThan(0.1);
  });

  it("checks an untrusted one: 16 finite points within reach, a known style's own points", () => {
    expect(normalizeWarp({ points: identityPoints() })).toBeNull();
    expect(normalizeWarp({ points: [[0, 0]] })).toBeNull();
    expect(normalizeWarp({ points: identityPoints().map(() => [NaN, 0]) })).toBeNull();
    const styled = normalizeWarp({ style: { style: "flag", bend: 500 }, points: "ignored" })!;
    expect(styled.style).toEqual({ style: "flag", bend: 100, horizontal: 0, vertical: 0, orientation: "horizontal" });
    expect(styled.points).toEqual(stylePoints(styled.style!));
    const custom = identityPoints();
    custom[5] = [0.5, 0.2];
    expect(normalizeWarp({ points: custom, style: null })).toEqual({ points: custom, style: null });
  });

  it("moves a point: a corner takes its tangents and inside point with it, others move alone", () => {
    const id = identityPoints();
    const moved = moveWarpPoint(id, 0, [0.1, 0.05]);
    expect(moved[0]).toEqual([0.1, 0.05]);
    expect(moved[1][0]).toBeCloseTo(1 / 3 + 0.1, 12);
    expect(moved[5][1]).toBeCloseTo(1 / 3 + 0.05, 12);
    expect(moved[2]).toEqual(id[2]);
    const edge = moveWarpPoint(id, 2, [0.7, -0.2]);
    expect(edge.filter((p, i) => p !== id[i] && (p[0] !== id[i][0] || p[1] !== id[i][1]))).toHaveLength(1);
  });
});
