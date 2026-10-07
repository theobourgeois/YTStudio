import { describe, expect, it } from "vitest";
import { cropCanvas } from "@shared/photo/crop";
import { createPhotoProject } from "@shared/photo/project";
import type { ImageLayer } from "@shared/photo/types";
import type { MediaAsset } from "@shared/types";
import { addImageLayerTool, canvasCropOf, cropLayerTool, describePhoto } from "../tool-edits";

const asset = (id: string, name: string, width: number, height: number): MediaAsset => ({ id, name, kind: "image", width, height, projectId: "p", duration: 5 }) as unknown as MediaAsset;
const env = { assets: [asset("media_cat", "cat.png", 500, 500)] };

describe("the assistant's crops", () => {
  const empty = createPhotoProject("Thumb", { width: 1280, height: 720 });
  const placed = addImageLayerTool(empty, { media: "media_cat", name: "Cat" }, env).doc;

  it("crops the canvas to a box, a ratio or the selection", () => {
    expect(canvasCropOf(placed, { x: 100, y: 20.4, width: 600, height: 400 }, null).box).toEqual({ x: 100, y: 20, width: 600, height: 400 });
    expect(canvasCropOf(placed, { ratio: "4:5" }, null).box).toEqual({ x: 352, y: 0, width: 576, height: 720 });
    const selection = { kind: "rect" as const, x: 10.5, y: 10, width: 100, height: 50 };
    expect(canvasCropOf(placed, { to_selection: true }, selection).box).toEqual({ x: 10, y: 10, width: 101, height: 50 });
    expect(() => canvasCropOf(placed, { to_selection: true }, null)).toThrow(/no selection/);
    expect(() => canvasCropOf(placed, { ratio: "wide" }, null)).toThrow(/4:5/);
    expect(() => canvasCropOf(placed, { x: 0 }, null)).toThrow(/1280×720/);
    expect(() => canvasCropOf(placed, { x: 0, y: 0, width: 1280, height: 720 }, null)).toThrow(/nothing to crop/);
    const { box, text } = canvasCropOf(placed, { x: -100, y: 0, width: 1480, height: 720 }, null);
    expect(text).toMatch(/1480×720 px now \(grown/);
    expect((cropCanvas({ doc: placed, selection: null }, box).doc.layers[0] as ImageLayer).transform.x).toBe(740);
  });

  it("crops a layer to a box of the canvas, says so, and clears it", () => {
    // The cat is 500 × 500 at its own size, centred: 390..890 × 110..610.
    const { doc, text } = cropLayerTool(placed, { layer: "Cat", x: 390, y: 110, width: 250, height: 1000 }, env);
    expect((doc.layers[0] as ImageLayer).crop).toEqual({ x: 0, y: 0, width: 250, height: 500 });
    expect(text).toMatch(/box on the canvas: x 390..640, y 110..610/);
    expect(describePhoto(doc, env.assets, [])).toMatch(/cropped \(crop_layer\): shows its pixels x 0..250, y 0..500 of 500×500/);
    expect(() => cropLayerTool(placed, { layer: "Cat", x: 0, y: 0, width: 10, height: 10 }, env)).toThrow(/misses/);
    expect(() => cropLayerTool(placed, { layer: "Cat" }, env)).toThrow(/clear: true/);
    const cleared = cropLayerTool(doc, { layer: "Cat", clear: true }, env);
    expect("crop" in cleared.doc.layers[0]).toBe(false);
    expect(cropLayerTool(cleared.doc, { layer: "Cat", clear: true }, env).text).toMatch(/isn't cropped/);
  });
});
