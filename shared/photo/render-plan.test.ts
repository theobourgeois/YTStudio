import { describe, expect, it } from "vitest";
import { addAdjustmentLayer, addFilter, addGeneratorLayer, addImageLayer, moveLayersBy, setEffectParams, setFilter, setFiltersEnabled, updateLayer } from "./edits.ts";
import { GLOW_CACHED_FROM, glowReach } from "./effects/glow.ts";
import { identityCurveSet } from "./effects/params.ts";
import { fitView } from "./geometry.ts";
import { createPhotoProject } from "./project.ts";
import { boxReduce, sampleMitchell } from "./reference/reduce.ts";
import { type SourceFacts, compileRender, inputRegion, isContentNode, isIsolated, keyBelow, needsRefinement, refinePlan } from "./render-plan.ts";

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

describe("filters and generators in the plan (version 5)", () => {
  const glowing = () => addFilter(doc(), "a", { id: "g", type: "glow", params: { radius: 100 } });

  it("keys a filtered layer by its filters, and its content apart from them, its opacity and its mask", () => {
    const plain = compileRender(doc(), sources).nodes[0];
    const glow = compileRender(glowing(), sources).nodes[0];
    if (!isContentNode(plain) || !isContentNode(glow)) throw new Error("not content");
    expect(glow.key).not.toBe(plain.key);
    expect(glow.contentKey).toBe(plain.contentKey);
    expect(glow.filters.map((f) => [f.id, f.type])).toEqual([["g", "glow"]]);
    expect(glow.filters[0].reach).toBe(glowReach(100));
    expect(isIsolated(glow)).toBe(true);
    expect(isIsolated(plain)).toBe(false);
    const faded = compileRender(updateLayer(glowing(), "a", { opacity: 0.5 }), sources).nodes[0];
    expect(isContentNode(faded) && faded.contentKey).toBe(glow.contentKey);
    // Bypassed (or the Filters eye off), or a glow that adds nothing: the layer draws plainly again.
    expect(compileRender(setFilter(glowing(), "a", "g", { enabled: false }), sources).nodes[0].key).toBe(plain.key);
    expect(compileRender(setFiltersEnabled(glowing(), "a", false), sources).nodes[0].key).toBe(plain.key);
    expect(compileRender(setFilter(glowing(), "a", "g", { params: { mix: 0 } }), sources).nodes[0].key).toBe(plain.key);
  });

  it("refines a glow only between its cached levels and 100%", () => {
    const plan = compileRender(glowing(), sources);
    expect(plan.commutes).toBe(false);
    expect(plan.commutesFrom).toBe(GLOW_CACHED_FROM);
    expect(needsRefinement(plan, 0.6)).toBe(true);
    expect(needsRefinement(plan, 0.3)).toBe(true);
    expect(needsRefinement(plan, 0.2)).toBe(false);
    expect(needsRefinement(plan, 1)).toBe(false);
    // Curves never commutes, whatever the level.
    const curves = addAdjustmentLayer(glowing(), { id: "cu", type: "curves", params: { curves: { ...identityCurveSet(), rgb: [[0, 0], [128, 150], [255, 255]] } } });
    expect(needsRefinement(compileRender(curves, sources), 0.05)).toBe(true);
  });

  it("grows a filtered layer's input region by its reach", () => {
    const node = compileRender(glowing(), sources).nodes[0];
    const reach = glowReach(100);
    // Image a covers document x 200..600 (centred on 800 × 600 at its own size): a region just past its right edge still reads it.
    expect(inputRegion(node, { x0: 600 + reach - 1, y0: 250, x1: 620 + reach, y1: 260 })).not.toBeNull();
    expect(inputRegion(compileRender(doc(), sources).nodes[0], { x0: 600 + reach - 1, y0: 250, x1: 620 + reach, y1: 260 })).toBeNull();
  });

  it("compiles a flare as a generator node that commutes, adding in linear light", () => {
    const d = addGeneratorLayer(doc(), { id: "fl", type: "lens-flare" });
    const plan = compileRender(d, sources);
    const node = plan.nodes[2];
    expect(node.kind).toBe("generator");
    if (node.kind !== "generator") return;
    expect(node).toMatchObject({ type: "lens-flare", blend: "linear-dodge", space: "linear", canvas: { width: 800, height: 600 }, commutes: true });
    expect(plan.commutes).toBe(true);
    expect(isIsolated(node)).toBe(true);
    expect(inputRegion(node, { x0: 0, y0: 0, x1: 10, y1: 10 })).toEqual({ x0: 0, y0: 0, x1: 10, y1: 10 });
    // Its key follows its handle and the canvas (its centre follows the canvas's).
    const moved = compileRender(moveLayersBy(d, ["fl"], 5, 0), sources).nodes[2];
    expect(moved.key).not.toBe(node.key);
    const unknown = { ...d, layers: d.layers.map((l) => (l.kind === "generator" ? { ...l, effect: { ...l.effect, version: 9 } } : l)) };
    expect(compileRender(unknown, sources).skipped).toEqual([{ layerId: "fl", reason: "unavailable" }]);
  });
});
