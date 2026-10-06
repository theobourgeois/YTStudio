import { describe, expect, it } from "vitest";
import { createPhotoProject } from "@shared/photo/project";
import type { AdjustmentLayer, GeneratorLayer, ImageLayer, PhotoProject } from "@shared/photo/types";
import type { MediaAsset } from "@shared/types";
import {
  addAdjustmentTool,
  addFilterTool,
  addGeneratorTool,
  addImageLayerTool,
  addPixelLayerTool,
  describePhoto,
  maskTool,
  mergeRequest,
  moveHandleTool,
  removeFilterTool,
  removeLayerTool,
  setCanvasTool,
  setEffectParamsTool,
  setFilterTool,
  setLayerTool,
  transformLayerTool,
} from "./tool-edits";

const placeOf = (doc: PhotoProject, i = 0) => (doc.layers[i] as ImageLayer).transform;
const effectOf = (doc: PhotoProject, i: number) => (doc.layers[i] as AdjustmentLayer).effect;

const asset = (id: string, name: string, width: number, height: number): MediaAsset =>
  ({ id, name, kind: "image", width, height, projectId: "p", duration: 5 }) as unknown as MediaAsset;
const env = { assets: [asset("media_sky", "sky.jpg", 4000, 2000), asset("media_cat", "cat.png", 500, 500)] };

describe("the photo assistant's edits", () => {
  const empty = createPhotoProject("Thumb", { width: 1280, height: 720 });

  it("places an image by id or name, fitted, and says where", () => {
    const { doc, text } = addImageLayerTool(empty, { media: "sky.JPG" }, env);
    expect(doc.layers).toHaveLength(1);
    expect(placeOf(doc)).toMatchObject({ x: 640, y: 360, scaleX: 0.32 });
    expect(text).toMatch(/Placed sky.jpg/);
    expect(() => addImageLayerTool(empty, { media: "dog" }, env)).toThrow(/media_sky \("sky.jpg"\)/);
  });

  it("transforms by absolute values, moves, scales and fits", () => {
    const placed = addImageLayerTool(empty, { media: "media_cat", name: "Cat" }, env).doc;
    const moved = transformLayerTool(placed, { layer: "Cat", x: 100, dy: 50, scale: 0.5, rotation: 30 }, env).doc;
    expect(placeOf(moved)).toEqual({ x: 100, y: 410, scaleX: 0.5, scaleY: 0.5, rotation: 30 });
    const covered = transformLayerTool(placed, { layer: "Cat", fit: "cover" }, env).doc;
    expect(placeOf(covered).scaleX).toBeCloseTo(1280 / 500);
    expect(() => transformLayerTool(placed, { layer: "Cat", scaleX: 0 }, env)).toThrow(/vanish/);
    expect(() => transformLayerTool(placed, { layer: "Dog" }, env)).toThrow(/The layers: .*Cat/);
  });

  it("renames, hides, reorders, removes; resizes the canvas", () => {
    let doc = addImageLayerTool(addImageLayerTool(empty, { media: "sky.jpg" }, env).doc, { media: "cat.png" }, env).doc;
    doc = setLayerTool(doc, { layer: "cat", visible: false, order: 0, name: "Kitty" }, env).doc;
    expect(doc.layers.map((l) => l.name)).toEqual(["Kitty", "sky"]);
    expect(doc.layers[0].visible).toBe(false);
    expect(describePhoto(doc, env.assets, [])).toMatch(/Layers, top first \(2\):\n1\. .* "sky"/);
    doc = removeLayerTool(doc, { layer: "Kitty" }, env).doc;
    expect(doc.layers).toHaveLength(1);
    const canvas = setCanvasTool(doc, { width: 1080, height: 1920, background: "none", anchor: "centre" }, env);
    expect(canvas.doc.canvas).toEqual({ width: 1080, height: 1920, background: null });
    expect(() => setCanvasTool(doc, { width: 0 }, env)).toThrow(/whole number/);
    expect(() => setCanvasTool(doc, { background: "blue" }, env)).toThrow(/#ffffff/);
  });

  it("adds adjustment layers above a layer, sets and resets their parameters, and says what's wrong", () => {
    let doc = addImageLayerTool(addImageLayerTool(empty, { media: "sky.jpg" }, env).doc, { media: "cat.png" }, env).doc;
    const added = addAdjustmentTool(doc, { type: "exposure", above: "sky", params: { exposure: 1.5 } }, env);
    doc = added.doc;
    expect(doc.layers.map((l) => l.kind)).toEqual(["image", "adjustment", "image"]);
    expect(effectOf(doc, 1).params).toEqual({ exposure: 1.5, offset: 0, gamma: 1 });
    expect(added.text).toMatch(/Exposure: exposure 1.5 stops, offset 0, gamma 1/);
    expect(describePhoto(doc, env.assets, [])).toMatch(/adjustment layer .*\n {3}Exposure: exposure 1.5 stops/);
    doc = setEffectParamsTool(doc, { layer: "Exposure", params: { gamma: 2 } }, env).doc;
    expect(effectOf(doc, 1).params).toMatchObject({ exposure: 1.5, gamma: 2 });
    doc = setEffectParamsTool(doc, { layer: "Exposure", reset: true }, env).doc;
    expect(effectOf(doc, 1).params).toEqual({ exposure: 0, offset: 0, gamma: 1 });
    expect(() => setEffectParamsTool(doc, { layer: "Exposure", params: { exposure: 40 } }, env)).toThrow(/from -20 to 20/);
    expect(() => setEffectParamsTool(doc, { layer: "Exposure", params: { brightness: 1 } }, env)).toThrow(/no parameter "brightness"/);
    expect(() => setEffectParamsTool(doc, { layer: "sky" }, env)).toThrow(/only adjustment and generator layers/);
    expect(() => addAdjustmentTool(doc, { type: "glow" }, env)).toThrow(/exposure, curves/);
    expect(() => transformLayerTool(doc, { layer: "Exposure", x: 1 }, env)).toThrow(/no place of its own/);

    // Curves: given at the top or under "curves"; a curve given replaces that curve only.
    const curves = addAdjustmentTool(doc, { type: "curves", params: { rgb: [[0, 0], [128, 160], [255, 255]] } }, env).doc;
    const top = curves.layers.length - 1;
    expect(effectOf(curves, top).params.curves).toMatchObject({ rgb: [[0, 0], [128, 160], [255, 255]], red: [[0, 0], [255, 255]] });
    const red = setEffectParamsTool(curves, { layer: "Curves", params: { curves: { red: [[0, 20], [255, 255]] } } }, env).doc;
    expect(effectOf(red, top).params.curves).toMatchObject({ rgb: [[0, 0], [128, 160], [255, 255]], red: [[0, 20], [255, 255]] });
    expect(() => setEffectParamsTool(curves, { layer: "Curves", params: { rgb: [[0, 0], [0, 255]] } }, env)).toThrow(/inputs increasing/);
  });

  it("says what merge_layers merges, and what to give when it can't", () => {
    let doc = addImageLayerTool(empty, { media: "media_sky", name: "Sky" }, env).doc;
    doc = addImageLayerTool(doc, { media: "media_cat", name: "Cat" }, env).doc;
    const [sky, cat] = doc.layers.map((l) => l.id);
    expect(mergeRequest(doc, { layers: ["Sky", "cat"] })).toEqual({ kind: "selected", ids: [sky, cat] });
    expect(mergeRequest(doc, { layers: ["Cat"], down: true })).toEqual({ kind: "down", ids: [cat] });
    expect(mergeRequest(doc, { visible: true })).toEqual({ kind: "visible", ids: [] });
    expect(() => mergeRequest(doc, { layers: ["Cat"] })).toThrow(/two or more/);
    expect(() => mergeRequest(doc, { layers: ["Cat", "Sky"], down: true })).toThrow(/exactly one/);
    expect(() => mergeRequest(doc, { layers: ["Dog", "Sky"] })).toThrow(/The layers: .*Cat/);
  });

  it("adds pixel layers and masks, and says what's painted and selected", () => {
    let doc = addImageLayerTool(empty, { media: "media_cat", name: "Cat" }, env).doc;
    const added = addPixelLayerTool(doc, { name: "Paint", above: "Cat" }, env);
    doc = added.doc;
    expect(doc.layers.map((l) => l.kind)).toEqual(["image", "pixel"]);
    expect(added.text).toMatch(/empty pixel layer .* "Paint"/);
    const masked = maskTool(doc, { layer: "Cat" }, env);
    expect(masked.doc.layers[0].mask).toEqual({ surface: null });
    expect(maskTool(masked.doc, { layer: "Cat" }, env).doc).toBe(masked.doc);
    expect(maskTool(masked.doc, { layer: "Cat", remove: true }, env).doc.layers[0].mask).toBeUndefined();
    expect(() => maskTool(doc, { layer: "Cat", remove: true }, env)).toThrow(/has no mask/);
    const text = describePhoto(masked.doc, env.assets, [masked.doc.layers[1].id], { kind: "rect", x: 10, y: 20, width: 30, height: 40 });
    expect(text).toMatch(/pixel layer 1280×720 \(empty: nothing painted yet\)/);
    expect(text).toMatch(/mask: reveals everything/);
    expect(text).toMatch(/Selection \(marching ants\): x 10..40, y 20..60/);
  });
});

describe("the assistant's light", () => {
  const empty = createPhotoProject("Night", { width: 1280, height: 720 });
  const withSky = () => addImageLayerTool(empty, { media: "sky.jpg" }, env).doc;
  const imageOf = (doc: PhotoProject) => doc.layers.find((l) => l.kind === "image") as ImageLayer;
  const flareOf = (doc: PhotoProject) => doc.layers.find((l) => l.kind === "generator") as GeneratorLayer;

  it("adds, changes, reorders, bypasses and removes filters, checked strictly", () => {
    let r = addFilterTool(withSky(), { layer: "sky", type: "glow", params: { radius: 300, tint: "#FF8800" } }, env);
    expect(imageOf(r.doc).filters![0].params).toMatchObject({ radius: 300, tint: "#ff8800", threshold: 75 });
    expect(r.text).toMatch(/filters, first applied first:\n {5}fx_\w+: Glow: radius 300 px/);
    r = addFilterTool(r.doc, { layer: "sky", type: "glow" }, env);
    const [first, second] = imageOf(r.doc).filters!.map((f) => f.id);
    let doc = setFilterTool(r.doc, { layer: "sky", filter: "2", params: { intensity: 1.5 }, order: 1 }, env).doc;
    expect(imageOf(doc).filters!.map((f) => f.id)).toEqual([second, first]);
    expect(imageOf(doc).filters![0].params.intensity).toBe(1.5);
    doc = setFilterTool(doc, { layer: "sky", filter: first, enabled: false }, env).doc;
    expect(describePhoto(doc, env.assets, [])).toMatch(/\(bypassed\): Glow/);
    doc = setFilterTool(doc, { layer: "sky", filter: 1, all_enabled: false }, env).doc;
    expect(imageOf(doc).filtersEnabled).toBe(false);
    doc = removeFilterTool(doc, { layer: "sky", filter: first }, env).doc;
    expect(imageOf(doc).filters!.map((f) => f.id)).toEqual([second]);
    expect(() => addFilterTool(doc, { layer: "sky", type: "exposure" }, env)).toThrow(/The filters: glow/);
    expect(() => setFilterTool(doc, { layer: "sky", filter: "9" }, env)).toThrow(/1\. fx_/);
    expect(() => setFilterTool(doc, { layer: "sky", filter: second, params: { radius: 9000 } }, env)).toThrow(/from 1 to 4000/);
    expect(() => setFilterTool(doc, { layer: "sky", filter: second, params: { tint: "orange" } }, env)).toThrow(/#ffb070/);
    const adjusted = addAdjustmentTool(doc, { type: "exposure" }, env).doc;
    expect(() => addFilterTool(adjusted, { layer: "Exposure", type: "glow" }, env)).toThrow(/adjustment layer: filters work on a layer's own pixels/);
  });

  it("adds a lens flare where it's told, moves its handles, changes it and its blend", () => {
    const r = addGeneratorTool(withSky(), { preset: "anamorphic", source: [900, 200], params: { intensity: 1 } }, env);
    let doc = r.doc;
    expect(flareOf(doc)).toMatchObject({ blend: "linear-dodge", blendSpace: "linear", effect: { params: { source: [900, 200], intensity: 1, centre: null } } });
    expect(r.text).toMatch(/source \(900, 200\), centre \(the canvas's centre\)/);
    expect(r.text).toMatch(/streak/);
    doc = moveHandleTool(doc, { layer: "Lens Flare", handle: "centre", x: 600, y: 400 }, env).doc;
    expect(flareOf(doc).effect.params.centre).toEqual([600, 400]);
    doc = moveHandleTool(doc, { layer: "Lens Flare", handle: "centre", follow_canvas: true }, env).doc;
    expect(flareOf(doc).effect.params.centre).toBeNull();
    expect(() => moveHandleTool(doc, { layer: "Lens Flare", handle: "source", follow_canvas: true }, env)).toThrow(/can't follow/);
    expect(() => moveHandleTool(doc, { layer: "sky", handle: "source", x: 1, y: 1 }, env)).toThrow(/transform_layer/);
    doc = setEffectParamsTool(doc, { layer: "Lens Flare", params: { colour: "#ffccaa", elements: [{ type: "ghost", size: 40, shape: "polygon" }] } }, env).doc;
    const elements = flareOf(doc).effect.params.elements as unknown as { type: string; size: number; shape: string; id: string }[];
    expect(elements).toHaveLength(1);
    expect(elements[0]).toMatchObject({ type: "ghost", size: 40, shape: "polygon" });
    expect(elements[0].id).toMatch(/\w+/);
    expect(() => setEffectParamsTool(doc, { layer: "Lens Flare", params: { elements: [{ type: "ghost", sides: 99 }] } }, env)).toThrow(/sides must be a number from 3 to 12/);
    expect(() => setEffectParamsTool(doc, { layer: "Lens Flare", params: { elements: [{ type: "sparkle" }] } }, env)).toThrow(/glow, halo, ghost, streak/);
    doc = setLayerTool(doc, { layer: "Lens Flare", blend: "normal" }, env).doc;
    expect("blend" in flareOf(doc)).toBe(false);
    expect(() => setLayerTool(doc, { layer: "sky", blend: "add" }, env)).toThrow(/generator layer's/);
    expect(() => addGeneratorTool(doc, { preset: "rainbow" }, env)).toThrow(/classic, anamorphic, subtle/);
  });

  it("sets the highlights with the canvas", () => {
    const doc = setCanvasTool(empty, { highlights: "clip" }, env).doc;
    expect(doc.output.highlights).toBe("clip");
    expect(() => setCanvasTool(empty, { highlights: "soft" }, env)).toThrow(/film/);
  });
});
