import { describe, expect, it } from "vitest";
import { setLayerCrop } from "@shared/photo/crop";
import { addImageLayer } from "@shared/photo/edits";
import { layerUnder } from "@shared/photo/layers";
import { createPhotoProject } from "@shared/photo/project";
import type { ImageLayer } from "@shared/photo/types";
import { contentBox, hitsContent } from "../canvas/content";
import { frameOf } from "../canvas/frame";
import { scaled } from "../canvas/handles";

const size = { width: 400, height: 200 };
const sized = () => size;
const doc = () => {
  const d = addImageLayer(createPhotoProject("P", { width: 1000, height: 1000 }), { id: "a", mediaId: "m", name: "A", size }, { transform: { x: 500, y: 500, scaleX: 1, scaleY: 1, rotation: 0 } });
  return setLayerCrop(d, "a", { x: 200, y: 0, width: 200, height: 100 }, size);
};
const none = () => null;

describe("a cropped layer on the canvas", () => {
  it("is moved and scaled by what shows of it, the crop staying where it is on it", () => {
    const d = doc();
    const f = frameOf(d.layers, ["a"], sized)!;
    // The layer covers 300..700 × 400..600; its crop shows 500..700 × 400..500.
    expect(f.t).toMatchObject({ x: 600, y: 450 });
    expect(f.size).toEqual({ width: 200, height: 100 });
    // Its bottom-right handle dragged out to 900, 600: twice the size, the top-left of the crop staying at 500, 400.
    const next = scaled(f.t, f.size, { u: 1, v: 1 }, { x: 900, y: 600 });
    const t = (f.place(d, next).layers[0] as ImageLayer).transform;
    expect(t).toMatchObject({ scaleX: 2, scaleY: 2 });
    // The layer's own top-left is 200 layer pixels (400 now) left of the crop's: 100, 400.
    expect(t.x - 400).toBeCloseTo(100);
    expect(t.y - 200).toBeCloseTo(400);
  });

  it("is picked, boxed and found only where it shows", () => {
    const layer = doc().layers[0] as ImageLayer;
    expect(hitsContent(layer, size, 600, 450, none)).toBe(true);
    expect(hitsContent(layer, size, 400, 450, none)).toBe(false);
    expect(contentBox(layer, size, none)).toEqual({ x0: 500, y0: 400, x1: 700, y1: 500 });
    expect(layerUnder(doc().layers, { x0: 300, y0: 520, x1: 480, y1: 600 }, sized)).toBeNull();
    expect(layerUnder(doc().layers, { x0: 600, y0: 420, x1: 610, y1: 430 }, sized)).toBe("a");
  });
});
