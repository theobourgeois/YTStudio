import { describe, expect, it } from "vitest";
import { addAdjustmentLayer, addImageLayer, addPixelLayer, setMask, updateLayer } from "@shared/photo/edits";
import { createPhotoProject } from "@shared/photo/project";
import { paintTargetOf } from "./paint-target";

describe("what the brush paints", () => {
  let doc = createPhotoProject("Paint", { width: 400, height: 300 });
  doc = addImageLayer(doc, { id: "img", mediaId: "m", name: "Photo", size: { width: 400, height: 300 } });
  doc = addPixelLayer(doc, { id: "px" });
  doc = addAdjustmentLayer(doc, { id: "adj", type: "exposure" });

  it("paints a pixel layer's pixels, or its mask when that's targeted", () => {
    expect(paintTargetOf(doc, "px", "content")).toEqual({ layerId: "px", part: "content" });
    expect(paintTargetOf(doc, "px", "mask")).toEqual({ layerId: "px", part: "content" });
    expect(paintTargetOf(setMask(doc, "px", null), "px", "mask")).toEqual({ layerId: "px", part: "mask" });
  });

  it("asks before painting an image, never rasterising it silently, but paints its mask", () => {
    expect(paintTargetOf(doc, "img", "content")).toEqual({ choice: "img" });
    expect(paintTargetOf(setMask(doc, "img", null), "img", "mask")).toEqual({ layerId: "img", part: "mask" });
  });

  it("paints an adjustment's mask, giving it one when it has none", () => {
    expect(paintTargetOf(doc, "adj", "content")).toEqual({ layerId: "adj", part: "mask", addMask: true });
    expect(paintTargetOf(setMask(doc, "adj", null), "adj", "content")).toEqual({ layerId: "adj", part: "mask" });
  });

  it("says why it can't paint", () => {
    expect(paintTargetOf(doc, null, "content")).toMatchObject({ error: expect.stringMatching(/Select a layer/) });
    expect(paintTargetOf(updateLayer(doc, "px", { visible: false }), "px", "content")).toMatchObject({ error: expect.stringMatching(/hidden/) });
  });
});
