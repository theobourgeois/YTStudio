import { describe, expect, it } from "vitest";
import {
  canvasCropRect,
  containsCropped,
  cropCanvas,
  cropFromDocBox,
  cropOf,
  croppedPlace,
  documentMasks,
  parseRatio,
  ratioBox,
  setLayerCrop,
  shiftSelection,
  uncroppedTransform,
  visiblePlace,
} from "./crop.ts";
import { addAdjustmentLayer, addGeneratorLayer, addImageLayer, addPixelLayer, setMask } from "./edits.ts";
import { apply, corners, layerMatrix } from "./layers.ts";
import { createPhotoProject, normalizePhotoProject } from "./project.ts";
import { type ImageNode, type SourceFacts, compileRender, inputRegion } from "./render-plan.ts";
import type { ImageLayer, LayerTransform, MaskSelection, PhotoProject, PixelLayer } from "./types.ts";

const H = "a".repeat(64);
const H2 = "b".repeat(64);

function photo(): PhotoProject {
  let d = createPhotoProject("Crop", { width: 1000, height: 800 });
  d = addImageLayer(d, { id: "img", mediaId: "m1", name: "Image", size: { width: 400, height: 200 } });
  d = addPixelLayer(d, { id: "px" });
  d = addAdjustmentLayer(d, { id: "adj", type: "exposure", params: { exposure: 1 } });
  d = setMask(d, "adj", H);
  d = addGeneratorLayer(d, { id: "gen", type: "lens-flare" });
  return d;
}

const place = (d: PhotoProject, id: string) => (d.layers.find((l) => l.id === id) as ImageLayer).transform;

describe("a layer's crop", () => {
  const t: LayerTransform = { x: 500, y: 400, scaleX: 2, scaleY: -1.5, rotation: 30 };
  const size = { width: 400, height: 200 };
  const crop = { x: 40, y: 20, width: 100, height: 60 };

  it("places what shows of it where it is on the layer, and back", () => {
    const shown = croppedPlace(t, size, crop);
    // The cropped place's corners are the crop's corners on the layer.
    const m = layerMatrix(t, size);
    const expected = [apply(m, 40, 20), apply(m, 140, 20), apply(m, 140, 80), apply(m, 40, 80)];
    corners(shown.t, shown.size).forEach((p, i) => {
      expect(p.x).toBeCloseTo(expected[i].x, 9);
      expect(p.y).toBeCloseTo(expected[i].y, 9);
    });
    expect(uncroppedTransform(shown.t, size, crop)).toMatchObject({ x: expect.closeTo(500, 9), y: expect.closeTo(400, 9) });
    // Moved, scaled and turned as a frame, the layer carries its crop along.
    const moved = { ...shown.t, x: shown.t.x + 10, scaleX: 3, rotation: -45 };
    const back = uncroppedTransform(moved, size, crop);
    const after = croppedPlace(back, size, crop);
    expect(after.t.x).toBeCloseTo(moved.x, 9);
    expect(after.t.y).toBeCloseTo(moved.y, 9);
  });

  it("is kept inside the layer, and the whole layer is none", () => {
    let d = photo();
    d = setLayerCrop(d, "img", { x: -10, y: 50, width: 100, height: 400 }, size);
    expect((d.layers[0] as ImageLayer).crop).toEqual({ x: 0, y: 50, width: 90, height: 150 });
    expect(setLayerCrop(d, "img", { x: 0, y: 50, width: 90, height: 150 }, size)).toBe(d);
    const cleared = setLayerCrop(d, "img", { x: 0, y: 0, width: 400, height: 200 }, size);
    expect("crop" in cleared.layers[0]).toBe(false);
    expect(setLayerCrop(cleared, "img", null, size)).toBe(cleared);
    expect(setLayerCrop(d, "adj", crop, size)).toBe(d);
    expect(cropOf(cleared.layers[0], size)).toEqual({ x: 0, y: 0, width: 400, height: 200 });
  });

  it("hides what's outside it from picking", () => {
    const layer: ImageLayer = { id: "i", kind: "image", name: "I", visible: true, opacity: 1, mediaId: "m", transform: { x: 200, y: 100, scaleX: 1, scaleY: 1, rotation: 0 }, crop: { x: 100, y: 0, width: 100, height: 200 } };
    expect(containsCropped(layer, size, 150, 100)).toBe(true);
    expect(containsCropped(layer, size, 50, 100)).toBe(false);
    expect(visiblePlace(layer, size)).toEqual({ t: { ...layer.transform, x: 150 }, size: { width: 100, height: 200 } });
  });

  it("takes a box of the canvas into the layer's pixels", () => {
    const flat = { x: 200, y: 100, scaleX: 0.5, scaleY: 0.5, rotation: 0 };
    // The layer covers 100..300 × 50..150 on the canvas.
    expect(cropFromDocBox(flat, size, { x: 150, y: 50, width: 100, height: 200 })).toEqual({ x: 100, y: 0, width: 200, height: 200 });
    expect(cropFromDocBox(flat, size, { x: 900, y: 900, width: 10, height: 10 })).toBeNull();
  });

  it("is validated when a photo is opened", () => {
    const problems: string[] = [];
    const d = normalizePhotoProject(
      {
        version: 7,
        layers: [
          { kind: "image", id: "a", mediaId: "m", crop: { x: 10, y: 5, width: 20, height: 30 } },
          { kind: "image", id: "b", mediaId: "m", crop: { x: 0, y: 0, width: -2, height: 3 } },
          { kind: "pixel", id: "c", size: { width: 100, height: 100 }, crop: { x: 50, y: 50, width: 100, height: 100 } },
          { kind: "pixel", id: "d", size: { width: 100, height: 100 }, crop: { x: 0, y: 0, width: 100, height: 100 } },
          { kind: "pixel", id: "e", size: { width: 100, height: 100 }, crop: "half" },
        ],
      },
      (p) => problems.push(p),
    );
    expect((d.layers[0] as ImageLayer).crop).toEqual({ x: 10, y: 5, width: 20, height: 30 });
    expect("crop" in d.layers[1]).toBe(false);
    expect((d.layers[2] as PixelLayer).crop).toEqual({ x: 50, y: 50, width: 50, height: 50 });
    expect("crop" in d.layers[3]).toBe(false);
    expect("crop" in d.layers[4]).toBe(false);
    expect(problems).toHaveLength(3);
    expect(normalizePhotoProject(d)).toEqual(d);
  });
});

describe("cropping the canvas", () => {
  it("rounds to whole pixels and refuses an empty box", () => {
    expect(canvasCropRect({ x: 10.4, y: -3.6, width: 99.3, height: 50 })).toEqual({ x: 10, y: -4, width: 100, height: 50 });
    expect(canvasCropRect({ x: 0, y: 0, width: 0.2, height: 50 })).toBeNull();
  });

  it("moves everything placed in document pixels by the box's corner, in one edit", () => {
    const d = photo();
    const masks = new Map([[H, H2]]);
    const state = { doc: d, selection: { kind: "rect" as const, x: 100, y: 100, width: 300, height: 300 } };
    const next = cropCanvas(state, { x: 200, y: 150, width: 500, height: 400 }, masks);
    expect(next.doc.canvas).toMatchObject({ width: 500, height: 400, background: "#ffffff" });
    expect(place(next.doc, "img")).toMatchObject({ x: place(d, "img").x - 200, y: place(d, "img").y - 150 });
    expect(place(next.doc, "px")).toMatchObject({ x: place(d, "px").x - 200, y: place(d, "px").y - 150 });
    const gen = (doc: PhotoProject) => doc.layers.find((l) => l.id === "gen")!;
    const source = (doc: PhotoProject) => (gen(doc) as { effect: { params: Record<string, unknown> } }).effect.params.source as number[];
    expect(source(next.doc)).toEqual([source(d)[0] - 200, source(d)[1] - 150]);
    // The optical centre that follows the canvas follows the new one.
    expect((gen(next.doc) as { effect: { params: Record<string, unknown> } }).effect.params.centre).toBeNull();
    expect(next.doc.layers.find((l) => l.id === "adj")!.mask).toEqual({ surface: H2 });
    expect(next.selection).toEqual({ kind: "rect", x: 0, y: 0, width: 200, height: 250 });
    expect(documentMasks(d)).toEqual([H]);
  });

  it("needs a document mask moved unless only the size changes", () => {
    const d = photo();
    expect(() => cropCanvas({ doc: d, selection: null }, { x: 10, y: 0, width: 500, height: 400 })).toThrow(/mask/);
    const grown = cropCanvas({ doc: d, selection: null }, { x: 0, y: 0, width: 1200, height: 900 });
    expect(grown.doc.canvas).toMatchObject({ width: 1200, height: 900 });
    expect(grown.doc.layers).toBe(d.layers);
    const same = { doc: d, selection: null };
    expect(cropCanvas(same, { x: 0, y: 0, width: 1000, height: 800 })).toBe(same);
  });

  it("keeps a moved mask selection to the new canvas", () => {
    const data = new Uint8Array(16).map((_, i) => i * 10);
    const s: MaskSelection = { kind: "mask", x: 2, y: 2, width: 4, height: 4, data };
    const moved = shiftSelection(s, -3, -1, { width: 10, height: 10 }) as MaskSelection;
    expect(moved).toMatchObject({ x: 0, y: 1, width: 3, height: 4 });
    expect([...moved.data]).toEqual([10, 20, 30, 50, 60, 70, 90, 100, 110, 130, 140, 150]);
    expect(shiftSelection(s, 20, 0, { width: 10, height: 10 })).toBeNull();
    expect(shiftSelection(s, 1, 1, { width: 10, height: 10 })).toMatchObject({ x: 3, y: 3, data });
  });

  it("reads ratios and fits them", () => {
    expect(parseRatio("4:5")).toBeCloseTo(0.8);
    expect(parseRatio("16 x 9")).toBeCloseTo(16 / 9);
    expect(parseRatio("1.5")).toBe(1.5);
    expect(parseRatio("square")).toBeNull();
    expect(ratioBox({ x: 0, y: 0, width: 1000, height: 800 }, 1)).toEqual({ x: 100, y: 0, width: 800, height: 800 });
  });
});

describe("a cropped layer in the render plan", () => {
  const sources = new Map<string, SourceFacts>([["m1", { width: 400, height: 200, bits: 8 }]]);
  const size = { width: 400, height: 200 };
  const doc = () => addImageLayer(createPhotoProject("P", { width: 800, height: 600 }), { id: "img", mediaId: "m1", name: "Image", size });

  it("carries the crop, keyed, and reads only the pixels under it", () => {
    const plain = compileRender(doc(), sources);
    const cropped = compileRender(setLayerCrop(doc(), "img", { x: 100, y: 50, width: 200, height: 100 }, size), sources);
    const node = cropped.nodes[0] as ImageNode;
    expect((plain.nodes[0] as ImageNode).crop).toBeNull();
    expect(node.crop).toEqual({ x0: 100, y0: 50, x1: 300, y1: 150 });
    expect(cropped.key).not.toBe(plain.key);
    expect(node.contentKey).not.toBe((plain.nodes[0] as ImageNode).contentKey);
    // The layer covers 200..600 × 200..400: the whole canvas reads its crop and the few pixels resampling needs.
    expect(inputRegion(node, { x0: 0, y0: 0, x1: 800, y1: 600 })).toEqual({ x0: 96, y0: 46, x1: 304, y1: 154 });
    expect(inputRegion(plain.nodes[0], { x0: 0, y0: 0, x1: 800, y1: 600 })).toEqual({ x0: 0, y0: 0, x1: 400, y1: 200 });
    // An uncropped layer's keys are what they were before crops existed.
    expect(compileRender(setLayerCrop(setLayerCrop(doc(), "img", { x: 1, y: 1, width: 5, height: 5 }, size), "img", null, size), sources).key).toBe(plain.key);
  });
});
