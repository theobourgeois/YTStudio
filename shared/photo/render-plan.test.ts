import { describe, expect, it } from "vitest";
import { addAdjustmentLayer, addImageLayer, setEffectParams, updateLayer } from "./edits.ts";
import { identityCurveSet } from "./effects/params.ts";
import { fitView } from "./geometry.ts";
import { createPhotoProject } from "./project.ts";
import { boxReduce, sampleMitchell } from "./reference/reduce.ts";
import { type SourceFacts, compileRender, inputRegion, keyBelow, needsRefinement, refinePlan } from "./render-plan.ts";

const image = (id: string, width = 400, height = 200) => ({ id, mediaId: `m_${id}`, name: id, size: { width, height } });
const sources = new Map<string, SourceFacts>([
  ["m_a", { width: 400, height: 200, bits: 8 }],
  ["m_b", { width: 400, height: 200, bits: 8 }],
  ["m_deep", { width: 400, height: 200, bits: 16 }],
]);

const doc = () => addImageLayer(addImageLayer(createPhotoProject("P", { width: 800, height: 600 }), image("a")), image("b"));

describe("compileRender", () => {
  it("lists what draws, bottom to top, and leaves out what changes nothing", () => {
    let d = addAdjustmentLayer(doc(), { id: "ex", type: "exposure" });
    d = addAdjustmentLayer(d, { id: "cu", type: "curves" });
    // Identity adjustments are left out: identity is exact by construction.
    expect(compileRender(d, sources).nodes.map((n) => n.layerId)).toEqual(["a", "b"]);
    d = setEffectParams(d, "ex", { exposure: 1 });
    d = updateLayer(d, "b", { visible: false });
    const plan = compileRender(d, sources);
    expect(plan.nodes.map((n) => n.layerId)).toEqual(["a", "ex"]);
    expect(plan.background).toEqual([1, 1, 1, 1]);
    expect(plan.commutes).toBe(true);
    expect(plan.format).toBe("rgba16float");
  });

  it("skips layers it can't draw, and says why", () => {
    let d = addImageLayer(doc(), image("gone"));
    d = { ...d, layers: [...d.layers, { id: "z", kind: "adjustment", name: "Z", visible: true, opacity: 1, effect: { id: "z_fx", type: "sparkle", version: 1, enabled: true, params: {} } }] };
    expect(compileRender(d, sources).skipped).toEqual([
      { layerId: "gone", reason: "missing" },
      { layerId: "z", reason: "unavailable" },
    ]);
  });

  it("composites in f32 once any source is 16-bit, if the GPU can", () => {
    const d = addImageLayer(doc(), image("deep"));
    expect(compileRender(d, sources).format).toBe("rgba32float");
    expect(compileRender(d, sources, { float32: false }).format).toBe("rgba16float");
  });

  it("keys each prefix, so an edit above leaves the keys below alone", () => {
    let d = addAdjustmentLayer(doc(), { id: "cu", type: "curves", params: { curves: { ...identityCurveSet(), rgb: [[0, 0], [128, 150], [255, 255]] } } });
    const before = compileRender(d, sources);
    expect(before.commutes).toBe(false);
    d = setEffectParams(d, "cu", { curves: { ...identityCurveSet(), rgb: [[0, 0], [128, 170], [255, 255]] } });
    const after = compileRender(d, sources);
    expect(after.prefixKeys.slice(0, 2)).toEqual(before.prefixKeys.slice(0, 2));
    expect(after.key).not.toBe(before.key);
    expect(keyBelow(after, 2)).toBe(before.prefixKeys[1]);
    expect(keyBelow(after, 0)).toBe(after.baseKey);
    // The same document compiles to the same keys.
    expect(compileRender(d, sources).key).toBe(after.key);
  });

  it("says which region each node needs", () => {
    const plan = compileRender(doc(), sources);
    // Image a is centred on the 800 × 600 canvas: its pixels are document pixels minus (200, 200).
    expect(inputRegion(plan.nodes[0], { x0: 250, y0: 250, x1: 300, y1: 260 })).toEqual({ x0: 50, y0: 50, x1: 100, y1: 60 });
    expect(inputRegion(plan.nodes[0], { x0: 0, y0: 0, x1: 10, y1: 10 })).toBeNull();
  });

  it("needs refining below 100% only when something doesn't commute", () => {
    const curves = compileRender(addAdjustmentLayer(doc(), { id: "cu", type: "curves", params: { curves: { ...identityCurveSet(), red: [[0, 9], [255, 255]] } } }), sources);
    expect(needsRefinement(curves, 0.5)).toBe(true);
    expect(needsRefinement(curves, 1)).toBe(false);
    expect(needsRefinement(compileRender(doc(), sources), 0.25)).toBe(false);
  });
});

describe("refinePlan", () => {
  it("covers the canvas's part of the view with tiles aligned to their level, within the region size", () => {
    const canvas = { width: 6000, height: 4000 };
    const view = fitView(canvas, 1600, 1000);
    const plan = refinePlan(view, canvas, 2048);
    expect(plan.level).toBe(2);
    expect(plan.stretch).toBeGreaterThanOrEqual(1);
    expect(plan.stretch).toBeLessThan(2);
    for (const t of plan.tiles) {
      expect(Math.abs(t.doc.x0 % 4)).toBe(0);
      expect(Math.abs(t.doc.y0 % 4)).toBe(0);
      expect(t.doc.x1 - t.doc.x0).toBeLessThanOrEqual(2048 + 8);
    }
    // Every view pixel over the canvas is in some tile.
    const x0 = Math.ceil(-view.x * view.zoom);
    const y0 = Math.ceil(-view.y * view.zoom);
    for (const [x, y] of [[x0 + 3, y0 + 3], [800, 500], [1600 - x0 - 4, 1000 - y0 - 4]]) {
      expect(plan.tiles.some((t) => x >= t.view.x0 && x < t.view.x1 && y >= t.view.y0 && y < t.view.y1)).toBe(true);
    }
  });
});

describe("the reduction references", () => {
  it("box-reduce in 2 × 2 means, and Mitchell reproduces a flat image", () => {
    const flat = { width: 5, height: 3, data: new Float64Array(5 * 3 * 4).fill(0.5) };
    const half = boxReduce(flat);
    expect(half.width).toBe(3);
    expect(half.height).toBe(2);
    expect(half.data[0]).toBe(0.5);
    // The odd edge's pixel covers half: transparent beyond.
    expect(half.data[(0 * 3 + 2) * 4]).toBe(0.25);
    const big = { width: 16, height: 16, data: new Float64Array(16 * 16 * 4).fill(0.25) };
    const s = sampleMitchell(big, 8, 8, 1.5);
    expect(s[0]).toBeCloseTo(0.25, 12);
  });
});
