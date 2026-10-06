import { describe, expect, it } from "vitest";
import { createPhotoProject } from "@shared/photo/project";
import type { AdjustmentLayer, ImageLayer, PhotoProject } from "@shared/photo/types";
import type { MediaAsset } from "@shared/types";
import { addAdjustmentTool, addImageLayerTool, describePhoto, mergeRequest, removeLayerTool, setCanvasTool, setEffectParamsTool, setLayerTool, transformLayerTool } from "./tool-edits";

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
    expect(() => setEffectParamsTool(doc, { layer: "sky" }, env)).toThrow(/only adjustment layers/);
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
});
