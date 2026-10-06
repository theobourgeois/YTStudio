import { describe, expect, it } from "vitest";
import { addAdjustmentLayer, addFilter, addImageLayer, filtersOf, setFilter } from "@shared/photo/edits";
import { createPhotoProject } from "@shared/photo/project";
import type { PhotoProject } from "@shared/photo/types";
import { developEdit, developOf } from "./develop";

const withImage = (): PhotoProject => addImageLayer(createPhotoProject("Develop", { width: 400, height: 300 }), { id: "img", mediaId: "m1", name: "Photo", size: { width: 400, height: 300 } });
const image = (doc: PhotoProject) => doc.layers.find((l) => l.id === "img")!;

describe("Develop", () => {
  it("adds its Camera Raw filter first on the first touch, then sets that one", () => {
    const glowed = addFilter(withImage(), "img", { id: "g1", type: "glow" });
    expect(developOf(image(glowed))).toBeNull();
    const added = developEdit("img", "cr", { exposure: 0.5 })(glowed);
    expect(filtersOf(image(added)).map((f) => f.id)).toEqual(["cr", "g1"]);
    expect(developOf(image(added))).toMatchObject({ id: "cr", params: { exposure: 0.5 } });
    const set = developEdit("img", "cr", { exposure: 1, contrast: 20 })(added);
    expect(filtersOf(image(set)).map((f) => f.id)).toEqual(["cr", "g1"]);
    expect(developOf(image(set))?.params).toMatchObject({ exposure: 1, contrast: 20 });
    // The same values: the same document.
    expect(developEdit("img", "cr", { exposure: 1, contrast: 20 })(set)).toBe(set);
  });

  it("shows the first Camera Raw filter, whether it's on or not, and touches nothing on an adjustment layer", () => {
    let doc = addFilter(withImage(), "img", { id: "a", type: "camera-raw", params: { exposure: 1 } });
    doc = addFilter(doc, "img", { id: "b", type: "camera-raw" });
    doc = setFilter(doc, "img", "a", { enabled: false });
    expect(developOf(image(doc))?.id).toBe("a");
    const adjusted = addAdjustmentLayer(doc, { id: "adj", type: "exposure" }, null);
    expect(developOf(adjusted.layers.find((l) => l.id === "adj"))).toBeNull();
    expect(developEdit("adj", "cr", { exposure: 1 })(adjusted)).toBe(adjusted);
  });
});
