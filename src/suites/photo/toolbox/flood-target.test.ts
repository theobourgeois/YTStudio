import { describe, expect, it } from "vitest";
import { addAdjustmentLayer, addImageLayer, addPixelLayer, setMask } from "@shared/photo/edits";
import { createPhotoProject } from "@shared/photo/project";
import type { MediaAsset } from "@shared/types";
import { bucketWhere, eraserWhere, floodSurface, shownSurface } from "./flood-target";
import { BUCKET_DEFAULTS, ERASER_DEFAULTS, sanitizeBucket, sanitizeEraser } from "./fill-options";

const asset = { id: "media_1", kind: "image", width: 400, height: 200 } as MediaAsset;

function photo() {
  let doc = createPhotoProject("Test", { width: 800, height: 600 });
  doc = addImageLayer(doc, { id: "img", mediaId: "media_1", name: "Photo", size: { width: 400, height: 200 } }, { transform: { x: 400, y: 300, scaleX: 2, scaleY: 2, rotation: 0 } });
  doc = addPixelLayer(doc, { id: "px", size: { width: 800, height: 600 }, transform: { x: 400, y: 300, scaleX: 1, scaleY: 1, rotation: 0 } }, null);
  return doc;
}

describe("bucketWhere", () => {
  it("fills a pixel layer's pixels, asks over an image, refuses a hidden layer", () => {
    const doc = photo();
    expect(bucketWhere(doc, "px", "content")).toEqual({ layerId: "px", part: "content", own: "px", addsMask: false });
    expect(bucketWhere(doc, "img", "content")).toEqual({ choice: "img" });
    expect(bucketWhere(doc, null, "content")).toHaveProperty("error");
    const hidden = { ...doc, layers: doc.layers.map((l) => ({ ...l, visible: false })) };
    expect(bucketWhere(hidden, "px", "content")).toEqual({ error: expect.stringMatching(/hidden/) });
  });

  it("fills a targeted mask, and an adjustment's (given one), reading the photo for an adjustment", () => {
    const masked = setMask(photo(), "img", null);
    expect(bucketWhere(masked, "img", "mask")).toEqual({ layerId: "img", part: "mask", own: "img", addsMask: false });
    const adjusted = addAdjustmentLayer(photo(), { id: "adj", type: "exposure" }, null);
    expect(bucketWhere(adjusted, "adj", "content")).toEqual({ layerId: "adj", part: "mask", own: null, addsMask: true });
  });
});

describe("eraserWhere", () => {
  it("erases a pixel layer's pixels, and a placed image through its mask (never rasterised)", () => {
    const doc = photo();
    expect(eraserWhere(doc, "px", "content")).toEqual({ layerId: "px", part: "content", own: "px", addsMask: false });
    expect(eraserWhere(doc, "img", "content")).toEqual({ layerId: "img", part: "mask", own: "img", addsMask: true });
    const masked = setMask(doc, "img", null);
    expect(eraserWhere(masked, "img", "content")).toEqual({ layerId: "img", part: "mask", own: "img", addsMask: false });
    const pixelMask = setMask(doc, "px", null);
    expect(eraserWhere(pixelMask, "px", "mask")).toEqual({ layerId: "px", part: "mask", own: "px", addsMask: false });
    expect(eraserWhere(doc, "nope", "content")).toHaveProperty("error");
  });
});

describe("floodSurface", () => {
  it("places a pixel layer's pixels and an image's mask in their own pixels; an adjustment's mask is the canvas", () => {
    const doc = addAdjustmentLayer(setMask(photo(), "img", "maskid"), { id: "adj", type: "exposure" }, null);
    expect(floodSurface(doc, "px", "content", [asset])).toMatchObject({ surface: null, kind: "pixels", size: { width: 800, height: 600 }, matrix: [1, 0, -0, 1, 0, 0] });
    // The image is 400 × 200 at 200%, centred: its pixel (0, 0) is the canvas's.
    expect(floodSurface(doc, "img", "mask", [asset])).toMatchObject({ surface: "maskid", kind: "mask", size: { width: 400, height: 200 }, matrix: [2, 0, -0, 2, 0, 100] });
    expect(floodSurface(doc, "img", "mask", [])).toBeNull();
    expect(floodSurface(doc, "img", "content", [asset])).toBeNull();
    expect(floodSurface(doc, "adj", "mask", [asset])).toMatchObject({ surface: null, size: { width: 800, height: 600 } });
    expect(shownSurface(doc, "img", "mask")).toBe("maskid");
    expect(shownSurface(doc, "px", "mask")).toBeNull();
    expect(shownSurface(doc, "gone", "mask")).toBeUndefined();
  });
});

describe("options", () => {
  it("start as Photoshop's and keep to their ranges", () => {
    expect(sanitizeBucket({})).toEqual(BUCKET_DEFAULTS);
    expect(sanitizeEraser({})).toEqual(ERASER_DEFAULTS);
    expect(sanitizeBucket({ mode: "behind", tolerance: 300.4, opacity: 0, source: "pattern", allLayers: true })).toMatchObject({ mode: "behind", tolerance: 255, opacity: 0.01, source: "pattern", allLayers: true });
    expect(sanitizeBucket({ mode: "nonsense" }).mode).toBe("normal");
    expect(sanitizeEraser({ tolerance: -4, defringe: false, sampleAll: "yes" })).toMatchObject({ tolerance: 0, defringe: false, sampleAll: false });
  });
});
