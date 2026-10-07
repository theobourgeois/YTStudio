import { describe, expect, it } from "vitest";
import { addAdjustmentLayer, addImageLayer, addPixelLayer, setMask } from "@shared/photo/edits";
import { createPhotoProject } from "@shared/photo/project";
import { bucketInput, eraseInput, floodResult } from "./flood-input";

const colours = { foreground: "#112233", background: "#ffffff" };

function photo() {
  let doc = createPhotoProject("Test", { width: 400, height: 300 });
  doc = addImageLayer(doc, { id: "img", mediaId: "media_1", name: "Photo", size: { width: 400, height: 300 } });
  doc = addPixelLayer(doc, { id: "px", name: "Paint" }, null);
  return doc;
}

describe("bucketInput", () => {
  it("reads a click with Photoshop's defaults, on the selected layer", () => {
    expect(bucketInput(photo(), { x: 10, y: 20 }, "px", colours)).toEqual({
      at: { x: 10, y: 20 },
      layerId: "px",
      target: "content",
      colour: "#112233",
      options: { source: "foreground", pattern: "", mode: "normal", opacity: 1, tolerance: 32, contiguous: true, antiAlias: true, allLayers: false },
    });
  });

  it("takes a colour, a pattern by name, a mode and the rest", () => {
    const r = bucketInput(photo(), { x: 1, y: 1, layer: "Paint", with: "pattern", pattern: "Checkerboard", mode: "behind", opacity: 0.5, tolerance: 0, contiguous: false, anti_alias: false, all_layers: true }, null, colours);
    expect(r.options).toEqual({ source: "pattern", pattern: "builtin:checkerboard", mode: "behind", opacity: 0.5, tolerance: 0, contiguous: false, antiAlias: false, allLayers: true });
    expect(bucketInput(photo(), { x: 1, y: 1, with: "#FF8800" }, "px", colours).colour).toBe("#ff8800");
    expect(bucketInput(photo(), { x: 1, y: 1, with: "background" }, "px", colours).colour).toBe("#ffffff");
  });

  it("says what's wrong", () => {
    expect(() => bucketInput(photo(), { x: 500, y: 1 }, "px", colours)).toThrow(/off the canvas \(400×300/);
    expect(() => bucketInput(photo(), { x: 1, y: 1 }, null, colours)).toThrow(/none is selected.*px \("Paint"\)/);
    expect(() => bucketInput(photo(), { x: 1, y: 1 }, "img", colours)).toThrow(/placed image.*add_pixel_layer/);
    expect(() => bucketInput(photo(), { x: 1, y: 1, with: "red" }, "px", colours)).toThrow(/with must be/);
    expect(() => bucketInput(photo(), { x: 1, y: 1, mode: "glow" }, "px", colours)).toThrow(/mode must be/);
    expect(() => bucketInput(photo(), { x: 1, y: 1, opacity: 50 }, "px", colours)).toThrow(/at most 1/);
    expect(() => bucketInput(photo(), { x: 1, y: 1, with: "pattern", pattern: "nope" }, "px", colours)).toThrow(/No pattern "nope"/);
    expect(() => bucketInput(photo(), { x: 1, y: 1, target: "mask" }, "px", colours)).toThrow(/has no mask/);
  });

  it("fills an image's mask, and an adjustment's", () => {
    expect(bucketInput(setMask(photo(), "img", null), { x: 1, y: 1, target: "mask" }, "img", colours).target).toBe("mask");
    const adjusted = addAdjustmentLayer(photo(), { id: "adj", type: "exposure" }, null);
    expect(bucketInput(adjusted, { x: 1, y: 1, target: "mask" }, "adj", colours).layerId).toBe("adj");
  });
});

describe("eraseInput", () => {
  it("reads a click with Photoshop's defaults and Defringe on; an image is fine (its mask)", () => {
    expect(eraseInput(photo(), { x: 3, y: 4, layer: "img" }, null)).toEqual({
      at: { x: 3, y: 4 },
      layerId: "img",
      target: "content",
      options: { tolerance: 32, contiguous: true, antiAlias: true, sampleAll: false, opacity: 1, defringe: true },
    });
    expect(eraseInput(photo(), { x: 3, y: 4, tolerance: 80.4, defringe: false, sample_all_layers: true, opacity: 0.25 }, "px").options).toEqual({ tolerance: 80, contiguous: true, antiAlias: true, sampleAll: true, opacity: 0.25, defringe: false });
    expect(() => eraseInput(photo(), { x: 3, y: 4, tolerance: 300 }, "px")).toThrow(/0..255/);
  });
});

describe("floodResult", () => {
  it("tells the model what changed, and throws what didn't work", () => {
    const doc = photo();
    const text = (r: { content: { type: string; text?: string }[] }) => r.content[0].text;
    expect(text(floodResult({ kind: "done", layerId: "img", part: "mask", changed: true, addedMask: true }, doc, "Erased", { x: 5, y: 6 }))).toMatch(/Erased the area around \(5, 6\) on "Photo"'s mask \(added/);
    expect(text(floodResult({ kind: "done", layerId: "px", part: "content", changed: false, addedMask: false }, doc, "Filled", { x: 5, y: 6 }))).toMatch(/Nothing changed/);
    expect(() => floodResult({ kind: "error", message: "No photo is open." }, doc, "Filled", { x: 0, y: 0 })).toThrow("No photo is open.");
    expect(() => floodResult({ kind: "choice", layerId: "img" }, doc, "Filled", { x: 0, y: 0 })).toThrow(/placed image/);
  });
});
