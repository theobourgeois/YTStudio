import { describe, expect, it } from "vitest";
import { addAdjustmentLayer, addImageLayer, addPixelLayer, setMask, updateLayer } from "@shared/photo/edits";
import { createPhotoProject } from "@shared/photo/project";
import { effectTargetOf } from "./effect-target";

let doc = createPhotoProject("Tone", { width: 400, height: 300 });
doc = addImageLayer(doc, { id: "img", mediaId: "m", name: "Photo", size: { width: 400, height: 300 } });
doc = addPixelLayer(doc, { id: "px" });
doc = addAdjustmentLayer(doc, { id: "adj", type: "exposure" });

describe("what Dodge, Burn and Sponge change", () => {
  it("tone a pixel layer's pixels, or its mask when that's targeted", () => {
    expect(effectTargetOf(doc, "px", "content", "toning")).toEqual({ layerId: "px", part: "content" });
    expect(effectTargetOf(setMask(doc, "px", null), "px", "mask", "toning")).toEqual({ layerId: "px", part: "mask" });
  });

  it("ask to convert a placed image to pixels (never a new empty layer), but tone its mask", () => {
    expect(effectTargetOf(doc, "img", "content", "toning")).toEqual({ convert: "img" });
    expect(effectTargetOf(setMask(doc, "img", null), "img", "mask", "toning")).toEqual({ layerId: "img", part: "mask" });
  });

  it("tone an adjustment's mask, giving it one", () => {
    expect(effectTargetOf(doc, "adj", "content", "toning")).toEqual({ layerId: "adj", part: "mask", addMask: true });
  });

  it("say why they can't", () => {
    expect(effectTargetOf(doc, null, "content", "toning")).toMatchObject({ error: expect.stringMatching(/Select a layer to tone/) });
    expect(effectTargetOf(updateLayer(doc, "px", { visible: false }), "px", "content", "toning")).toMatchObject({ error: expect.stringMatching(/hidden/) });
  });
});

describe("what the Background Eraser erases", () => {
  it("erases a pixel layer's pixels, and asks to convert a placed image", () => {
    expect(effectTargetOf(doc, "px", "content", "eraser")).toEqual({ layerId: "px", part: "content" });
    expect(effectTargetOf(doc, "img", "content", "eraser")).toEqual({ convert: "img" });
  });

  it("refuses masks and adjustment layers, saying what to do", () => {
    expect(effectTargetOf(setMask(doc, "px", null), "px", "mask", "eraser")).toMatchObject({ error: expect.stringMatching(/not its mask/) });
    expect(effectTargetOf(doc, "adj", "content", "eraser")).toMatchObject({ error: expect.stringMatching(/no pixels to erase/) });
  });
});
