import { describe, expect, it } from "vitest";
import { addAdjustmentLayer, addImageLayer, arrangeLayers, duplicateLayers, moveLayersBy, moveLayersTo, removeLayers, shiftLayers, updateLayer } from "./edits.ts";
import { apply, bounds, compose, layerMatrix, transformedBy } from "./layers.ts";
import { mergeKindOf, mergedLayer, planMerge, replaceWithMerged } from "./merge.ts";
import { createPhotoProject } from "./project.ts";
import type { ImageLayer, PhotoProject } from "./types.ts";

const image = (id: string, width = 400, height = 200) => ({ id, mediaId: `media_${id}`, name: `Image ${id}`, size: { width, height } });

/** Images a, b, c (bottom to top) on a 1000 × 800 canvas, each 400 × 200 at its own size, placed where asked. */
function stack(...places: [string, number, number][]): PhotoProject {
  let doc = createPhotoProject("Merge", { width: 1000, height: 800 });
  for (const [id, x, y] of places) doc = addImageLayer(doc, image(id), { transform: { x, y, scaleX: 1, scaleY: 1, rotation: 0 } });
  return doc;
}

const ids = (doc: PhotoProject) => doc.layers.map((l) => l.id);
const sizeOf = () => ({ width: 400, height: 200 });

describe("several layers at once", () => {
  const doc = stack(["a", 200, 100], ["b", 500, 400], ["c", 800, 700], ["d", 100, 100]);

  it("deletes, moves as a block, shifts and arranges them, keeping their order", () => {
    expect(ids(removeLayers(doc, ["b", "d"]))).toEqual(["a", "c"]);
    expect(removeLayers(doc, ["nope"])).toBe(doc);
    // Dropped with one layer under them (the Layers panel's gap), wherever they were.
    expect(ids(moveLayersTo(doc, ["d", "b"], 1))).toEqual(["a", "b", "d", "c"]);
    expect(ids(moveLayersTo(doc, ["a", "c"], 4))).toEqual(["b", "d", "a", "c"]);
    expect(moveLayersTo(doc, ["a", "b"], 2)).toBe(doc);
    // A run moves one place as one; one at the end stays.
    expect(ids(shiftLayers(doc, ["a", "b"], 1))).toEqual(["c", "a", "b", "d"]);
    expect(ids(shiftLayers(doc, ["b", "d"], 1))).toEqual(["a", "c", "b", "d"]);
    expect(ids(shiftLayers(doc, ["b", "d"], -1))).toEqual(["b", "a", "d", "c"]);
    expect(shiftLayers(doc, ["a"], -1)).toBe(doc);
    expect(ids(arrangeLayers(doc, ["a", "c"], "top"))).toEqual(["b", "d", "a", "c"]);
    expect(ids(arrangeLayers(doc, ["d", "c"], "bottom"))).toEqual(["c", "d", "a", "b"]);
  });

  it("duplicates each above itself and moves images together", () => {
    expect(ids(duplicateLayers(doc, ["a", "c"], (id) => `${id}2`))).toEqual(["a", "a2", "b", "c", "c2", "d"]);
    const moved = moveLayersBy(doc, ["a", "c"], 10, -5);
    expect((moved.layers[0] as ImageLayer).transform).toMatchObject({ x: 210, y: 95 });
    expect((moved.layers[2] as ImageLayer).transform).toMatchObject({ x: 810, y: 695 });
    expect(moved.layers[1]).toBe(doc.layers[1]);
    expect(moveLayersBy(doc, ["a"], 0, 0)).toBe(doc);
  });

  it("carries a layer by a map as one of several: turned and scaled exactly, refused when it would skew", () => {
    const t = { x: 300, y: 200, scaleX: 0.5, scaleY: -0.5, rotation: 30 };
    const size = { width: 400, height: 200 };
    // About (500, 400): scaled 2× and turned 90°.
    const m = compose([1, 0, 0, 1, 500, 400], compose([0, 2, -2, 0, 0, 0], [1, 0, 0, 1, -500, -400]));
    const next = transformedBy(t, size, m)!;
    expect(next.scaleX).toBeCloseTo(1);
    expect(next.scaleY).toBeCloseTo(-1);
    expect(next.rotation).toBeCloseTo(120);
    // Every pixel lands where the map takes it.
    const before = layerMatrix(t, size);
    const after = layerMatrix(next, size);
    for (const [u, v] of [[0, 0], [400, 0], [123, 77]]) {
      const want = apply(m, apply(before, u, v).x, apply(before, u, v).y);
      expect(apply(after, u, v).x).toBeCloseTo(want.x, 6);
      expect(apply(after, u, v).y).toBeCloseTo(want.y, 6);
    }
    // Stretching one way: fine for a layer at a right angle, a skew for one at 30°.
    expect(transformedBy({ ...t, rotation: 90 }, size, [2, 0, 0, 1, 0, 0])).not.toBeNull();
    expect(transformedBy(t, size, [2, 0, 0, 1, 0, 0])).toBeNull();
  });
});

describe("merging", () => {
  const doc = stack(["a", 200, 100], ["b", 500, 400], ["c", 800, 700]);

  it("merges one layer down into the one below it, named after that one", () => {
    expect(mergeKindOf(["c"])).toBe("down");
    expect(mergeKindOf(["a", "c"])).toBe("selected");
    const plan = planMerge(doc, "down", ["b"], sizeOf);
    if ("error" in plan) throw new Error(plan.error);
    expect(plan.ids).toEqual(["a", "b"]);
    expect(plan.name).toBe("Image a");
    // The box around both: a's top-left (0, 0) to b's bottom-right (700, 500).
    expect(plan.box).toEqual({ x: 0, y: 0, width: 700, height: 500 });
    expect(plan.doc.canvas).toEqual({ width: 700, height: 500, background: null });
    expect(ids(plan.doc)).toEqual(["a", "b"]);
  });

  it("keeps what's past the canvas, rendering the layers where they are from the box's corner", () => {
    const plan = planMerge(doc, "selected", ["b", "c"], sizeOf);
    if ("error" in plan) throw new Error(plan.error);
    expect(plan.box).toEqual({ x: 300, y: 300, width: 700, height: 500 });
    expect(plan.doc.canvas).toMatchObject({ width: 700, height: 500 });
    expect((plan.doc.layers[1] as ImageLayer).transform).toMatchObject({ x: 800, y: 700 });
    expect(plan.name).toBe("Image c");
    // The result goes where the merged images were, at 100%.
    const layer = mergedLayer(plan, "m", "media_m");
    expect(bounds(layer.transform, plan.box)).toEqual({ x0: 300, y0: 300, x1: 1000, y1: 800 });
  });

  it("says why it can't merge", () => {
    const err = (r: ReturnType<typeof planMerge>) => ("error" in r ? r.error : null);
    expect(err(planMerge(doc, "down", ["a"], sizeOf))).toMatch(/no layer below/);
    expect(err(planMerge(doc, "selected", ["a"], sizeOf))).toMatch(/two or more/);
    expect(err(planMerge(updateLayer(doc, "a", { visible: false }), "down", ["b"], sizeOf))).toMatch(/hidden/);
    expect(err(planMerge(doc, "selected", ["a", "b"], () => null))).toMatch(/no image/);
    const adjusted = addAdjustmentLayer(addAdjustmentLayer(doc, { id: "x", type: "exposure" }, "a"), { id: "y", type: "curves" }, "x");
    expect(err(planMerge(adjusted, "selected", ["x", "y"], sizeOf))).toMatch(/needs an image, pixel or generator layer/);
    expect(err(planMerge(adjusted, "down", ["b"], sizeOf))).toMatch(/adjustment layer/);
  });

  it("leaves hidden layers alone and drops adjustments with nothing merged below them", () => {
    // a, x (exposure), b, y (curves), c: merging x, b, y and a hidden c.
    let d = addAdjustmentLayer(doc, { id: "x", type: "exposure" }, "a");
    d = addAdjustmentLayer(d, { id: "y", type: "curves" }, "b");
    d = updateLayer(d, "c", { visible: false });
    const plan = planMerge(d, "selected", ["x", "b", "y", "c"], sizeOf);
    if ("error" in plan) throw new Error(plan.error);
    expect(plan.ids).toEqual(["x", "b", "y"]);
    expect(ids(plan.doc)).toEqual(["b", "y"]);
    // Merge Visible takes everything shown.
    const visible = planMerge(d, "visible", [], sizeOf);
    if ("error" in visible) throw new Error(visible.error);
    expect(visible.ids).toEqual(["a", "x", "b", "y"]);
  });

  it("puts the result in the topmost merged layer's place, unless they've changed meanwhile", () => {
    const plan = planMerge(doc, "selected", ["a", "c"], sizeOf);
    if ("error" in plan) throw new Error(plan.error);
    const layer = mergedLayer(plan, "m", "media_m");
    expect(ids(replaceWithMerged(doc, doc, plan.ids, layer)!)).toEqual(["b", "m"]);
    const merged = replaceWithMerged(doc, doc, ["a", "b"], layer)!;
    expect(ids(merged)).toEqual(["m", "c"]);
    expect(replaceWithMerged(updateLayer(doc, "a", { name: "Renamed" }), doc, plan.ids, layer)).toBeNull();
    expect(replaceWithMerged(removeLayers(doc, ["c"]), doc, plan.ids, layer)).toBeNull();
  });
});
