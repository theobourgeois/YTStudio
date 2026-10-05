import { describe, expect, it } from "vitest";
import { createPhotoProject } from "@shared/photo/project";
import type { MediaAsset } from "@shared/types";
import { addImageLayerTool, describePhoto, removeLayerTool, setCanvasTool, transformLayerTool, updateLayerTool } from "./tool-edits";

const asset = (id: string, name: string, width: number, height: number): MediaAsset =>
  ({ id, name, kind: "image", width, height, projectId: "p", duration: 5 }) as unknown as MediaAsset;
const env = { assets: [asset("media_sky", "sky.jpg", 4000, 2000), asset("media_cat", "cat.png", 500, 500)] };

describe("the photo assistant's edits", () => {
  const empty = createPhotoProject("Thumb", { width: 1280, height: 720 });

  it("places an image by id or name, fitted, and says where", () => {
    const { doc, text } = addImageLayerTool(empty, { media: "sky.JPG" }, env);
    expect(doc.layers).toHaveLength(1);
    expect(doc.layers[0].transform).toMatchObject({ x: 640, y: 360, scaleX: 0.32 });
    expect(text).toMatch(/Placed sky.jpg/);
    expect(() => addImageLayerTool(empty, { media: "dog" }, env)).toThrow(/media_sky \("sky.jpg"\)/);
  });

  it("transforms by absolute values, moves, scales and fits", () => {
    const placed = addImageLayerTool(empty, { media: "media_cat", name: "Cat" }, env).doc;
    const moved = transformLayerTool(placed, { layer: "Cat", x: 100, dy: 50, scale: 0.5, rotation: 30 }, env).doc;
    expect(moved.layers[0].transform).toEqual({ x: 100, y: 410, scaleX: 0.5, scaleY: 0.5, rotation: 30 });
    const covered = transformLayerTool(placed, { layer: "Cat", fit: "cover" }, env).doc;
    expect(covered.layers[0].transform.scaleX).toBeCloseTo(1280 / 500);
    expect(() => transformLayerTool(placed, { layer: "Cat", scaleX: 0 }, env)).toThrow(/vanish/);
    expect(() => transformLayerTool(placed, { layer: "Dog" }, env)).toThrow(/The layers: .*Cat/);
  });

  it("renames, hides, reorders, removes; resizes the canvas", () => {
    let doc = addImageLayerTool(addImageLayerTool(empty, { media: "sky.jpg" }, env).doc, { media: "cat.png" }, env).doc;
    doc = updateLayerTool(doc, { layer: "cat", visible: false, order: 0, name: "Kitty" }, env).doc;
    expect(doc.layers.map((l) => l.name)).toEqual(["Kitty", "sky"]);
    expect(doc.layers[0].visible).toBe(false);
    expect(describePhoto(doc, env.assets, null)).toMatch(/Layers, top first \(2\):\n1\. .* "sky"/);
    doc = removeLayerTool(doc, { layer: "Kitty" }, env).doc;
    expect(doc.layers).toHaveLength(1);
    const canvas = setCanvasTool(doc, { width: 1080, height: 1920, background: "none", anchor: "centre" }, env);
    expect(canvas.doc.canvas).toEqual({ width: 1080, height: 1920, background: null });
    expect(() => setCanvasTool(doc, { width: 0 }, env)).toThrow(/whole number/);
    expect(() => setCanvasTool(doc, { background: "blue" }, env)).toThrow(/#ffffff/);
  });
});
