import { describe, expect, it } from "vitest";
import { addImageLayer, duplicateLayer, fromImage, moveLayer, placement, removeLayer, setCanvas, setTransform, updateLayer } from "./edits.ts";
import { apply, bounds, contains, corners, invert, layerMatrix } from "./layers.ts";
import { MIN_SCALE, createPhotoProject, normalizePhotoProject, withPhotoOptions } from "./project.ts";
import { type ImageLayer, PHOTO_VERSION, type PhotoProject } from "./types.ts";

/** An image layer's transform (the layers these tests make are images). */
const placeOf = (d: PhotoProject, i = 0) => (d.layers[i] as ImageLayer).transform;

const image = (id: string, width = 400, height = 200) => ({ id, mediaId: `media_${id}`, name: `Image ${id}`, size: { width, height } });

describe("photo documents", () => {
  it("starts as a white 9:16 canvas with no layers, or with the tab's choices", () => {
    const doc = createPhotoProject("Cover");
    expect(doc).toMatchObject({ version: PHOTO_VERSION, name: "Cover", canvas: { width: 1080, height: 1920, background: "#ffffff" }, compositing: "photoshop", layers: [] });
    expect(withPhotoOptions(doc, { width: 1280, height: 720, background: null }).canvas).toEqual({ width: 1280, height: 720, background: null });
    expect(withPhotoOptions(doc, { width: -3, height: "big", background: "red" })).toEqual(doc);
  });

  it("repairs what it can and keeps the user's layers", () => {
    const doc = normalizePhotoProject({
      name: "  ",
      canvas: { width: 0, height: 500.5, background: "#ABCDEF" },
      output: { highlights: "sideways" },
      layers: [
        { kind: "image", id: "a", mediaId: "m1", name: "Kept", opacity: 4, transform: { x: "x", scaleX: 0, scaleY: -2, rotation: 540 } },
        { kind: "image", id: "a", mediaId: "m2" },
        { kind: "text", id: "t" },
        { kind: "image", id: "c" },
        null,
      ],
    });
    expect(doc.name).toBe("Untitled");
    expect(doc.canvas).toEqual({ width: 1080, height: 1920, background: "#abcdef" });
    expect(doc.output.highlights).toBe("clip"); // no version: drawn clipped, as photos before version 5 were
    expect(doc.layers).toHaveLength(2);
    expect(doc.layers[0]).toMatchObject({ id: "a", name: "Kept", opacity: 1, visible: true, transform: { x: 540, y: 960, scaleX: MIN_SCALE, scaleY: -2, rotation: 180 } });
    expect(doc.layers[1].id).not.toBe("a");
    expect(normalizePhotoProject(doc)).toEqual(doc);
  });

  it("refuses what isn't a photo, or a newer one", () => {
    expect(() => normalizePhotoProject("nope")).toThrow(/Not a photo/);
    expect(() => normalizePhotoProject({ version: PHOTO_VERSION + 1 })).toThrow(/newer version/);
  });
});

describe("edits", () => {
  const doc = createPhotoProject("Doc", { width: 1000, height: 500 });

  it("places an image centred, fitted when it's bigger than the canvas", () => {
    expect(placement({ width: 1000, height: 500 }, { width: 400, height: 200 })).toEqual({ x: 500, y: 250, scaleX: 1, scaleY: 1, rotation: 0 });
    expect(placement({ width: 1000, height: 500 }, { width: 4000, height: 1000 }).scaleX).toBe(0.25);
    const one = addImageLayer(doc, image("a"));
    const two = addImageLayer(one, image("b"), { below: "a" });
    expect(two.layers.map((l) => l.id)).toEqual(["b", "a"]);
    expect(addImageLayer(two, image("a"))).toBe(two);
  });

  it("opens an image as the canvas", () => {
    const opened = fromImage(doc, image("p", 6000, 4000));
    expect(opened.canvas).toEqual({ width: 6000, height: 4000, background: null });
    expect(placeOf(opened, 0)).toEqual({ x: 3000, y: 2000, scaleX: 1, scaleY: 1, rotation: 0 });
  });

  it("transforms, and does nothing when nothing changes", () => {
    const one = addImageLayer(doc, image("a"));
    expect(setTransform(one, "a", { x: 500 })).toBe(one);
    expect(setTransform(one, "missing", { x: 1 })).toBe(one);
    const moved = setTransform(one, "a", { x: 10, scaleX: 0, rotation: 190 });
    expect(placeOf(moved, 0)).toMatchObject({ x: 10, scaleX: MIN_SCALE, rotation: -170 });
    expect(setTransform(one, "a", { y: Number.NaN })).toBe(one);
    // Down to 10% and back: exactly where it was (the source is what's resampled).
    const back = setTransform(setTransform(one, "a", { scaleX: 0.1, scaleY: 0.1 }), "a", { scaleX: 1, scaleY: 1 });
    expect(placeOf(back, 0)).toEqual(placeOf(one, 0));
  });

  it("renames, hides, fades, orders, duplicates and removes layers", () => {
    let d = addImageLayer(addImageLayer(addImageLayer(doc, image("a")), image("b")), image("c"));
    expect(updateLayer(d, "a", { name: "  " })).toBe(d);
    d = updateLayer(d, "a", { name: "Sky", visible: false, opacity: 2 });
    expect(d.layers[0]).toMatchObject({ name: "Sky", visible: false, opacity: 1 });
    expect(moveLayer(d, "a", 9).layers.map((l) => l.id)).toEqual(["b", "c", "a"]);
    expect(moveLayer(d, "a", 0)).toBe(d);
    expect(duplicateLayer(d, "b", "b2").layers.map((l) => l.name)).toEqual(["Sky", "Image b", "Image b copy", "Image c"]);
    expect(removeLayer(d, "b").layers.map((l) => l.id)).toEqual(["a", "c"]);
    expect(removeLayer(d, "zzz")).toBe(d);
  });

  it("resizes the canvas, keeping layers where they were from the top-left, or the centre", () => {
    const d = addImageLayer(doc, image("a"));
    expect(setCanvas(d, { width: 1000 })).toBe(d);
    expect(placeOf(setCanvas(d, { width: 2000 }), 0).x).toBe(500);
    expect(placeOf(setCanvas(d, { width: 2000, height: 1000 }, "centre"), 0)).toMatchObject({ x: 1000, y: 500 });
    expect(setCanvas(d, { background: "#FF0000" }).canvas.background).toBe("#ff0000");
    expect(setCanvas(d, { width: 0, background: "red" })).toBe(d);
  });
});

describe("layer geometry", () => {
  const size = { width: 400, height: 200 };

  it("maps a layer's pixels around its centre, and back", () => {
    const t = { x: 500, y: 300, scaleX: 2, scaleY: 2, rotation: 90 };
    const m = layerMatrix(t, size);
    // The source's centre lands on the transform's centre; its top-left corner turns clockwise.
    expect(apply(m, 200, 100)).toEqual({ x: 500, y: 300 });
    const tl = apply(m, 0, 0);
    expect(tl.x).toBeCloseTo(700);
    expect(tl.y).toBeCloseTo(-100);
    const back = apply(invert(m), tl.x, tl.y);
    expect(back.x).toBeCloseTo(0);
    expect(back.y).toBeCloseTo(0);
  });

  it("knows its corners, bounds and what's on it, mirrored too", () => {
    const t = { x: 200, y: 100, scaleX: -1, scaleY: 1, rotation: 0 };
    expect(corners(t, size)[0]).toEqual({ x: 400, y: 0 });
    expect(bounds(t, size)).toEqual({ x0: 0, y0: 0, x1: 400, y1: 200 });
    expect(contains(t, size, 10, 10)).toBe(true);
    expect(contains(t, size, 410, 10)).toBe(false);
  });
});

describe("highlights (version 5)", () => {
  it("keeps older photos clipped, as they were drawn, and new ones film", () => {
    expect(createPhotoProject("New").output.highlights).toBe("film");
    expect(normalizePhotoProject({ version: 3, output: { highlights: "film" } }).output.highlights).toBe("clip");
    expect(normalizePhotoProject({ layers: [] }).output.highlights).toBe("clip");
    expect(normalizePhotoProject({ version: 5, output: { highlights: "film" } }).output.highlights).toBe("film");
    expect(normalizePhotoProject({ version: 5, output: { highlights: "clip" } }).output.highlights).toBe("clip");
    expect(normalizePhotoProject({ version: 5, output: {} }).output.highlights).toBe("film");
  });
});
