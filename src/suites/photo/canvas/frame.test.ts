import { describe, expect, it } from "vitest";
import { addImageLayer } from "@shared/photo/edits";
import { bounds } from "@shared/photo/layers";
import { createPhotoProject } from "@shared/photo/project";
import type { ImageLayer, PhotoProject } from "@shared/photo/types";
import { frameOf, touches } from "./frame";
import { rotated, scaled } from "./handles";

const size = { width: 100, height: 50 };
const sized = () => size;

function doc(...places: [string, number, number, number?][]): PhotoProject {
  let d = createPhotoProject("Frame", { width: 1000, height: 1000 });
  for (const [id, x, y, rotation = 0] of places) d = addImageLayer(d, { id, mediaId: `m_${id}`, name: id, size }, { transform: { x, y, scaleX: 1, scaleY: 1, rotation } });
  return d;
}
const boxOf = (d: PhotoProject, i: number) => bounds((d.layers[i] as ImageLayer).transform, size);

describe("the Move tool's frame", () => {
  it("is one layer's own transform, or the box around several", () => {
    const d = doc(["a", 100, 100], ["b", 400, 300]);
    expect(frameOf(d.layers, ["a"], sized)!.t).toBe((d.layers[0] as ImageLayer).transform);
    const f = frameOf(d.layers, ["b", "a"], sized)!;
    expect(f.ids).toEqual(["a", "b"]);
    expect(f.t).toEqual({ x: 250, y: 200, scaleX: 1, scaleY: 1, rotation: 0 });
    expect(f.size).toEqual({ width: 400, height: 250 });
    expect(frameOf(d.layers, ["nope"], sized)).toBeNull();
  });

  it("carries several layers by its handles: scaled from a corner, and turned about its centre", () => {
    const d = doc(["a", 100, 100], ["b", 400, 300]);
    const f = frameOf(d.layers, ["a", "b"], sized)!;
    // The bottom-right corner dragged out to twice the box: the top-left (50, 75) stays.
    const twice = f.place(d, scaled(f.t, f.size, { u: 1, v: 1 }, { x: 850, y: 575 }));
    expect(boxOf(twice, 0)).toEqual({ x0: 50, y0: 75, x1: 250, y1: 175 });
    expect(boxOf(twice, 1).x1).toBeCloseTo(850);
    expect(boxOf(twice, 1).y1).toBeCloseTo(575);
    // A half turn about the box's centre swaps them.
    const turned = f.place(d, rotated(f.t, { x: 450, y: 200 }, { x: 50, y: 200 }));
    expect((turned.layers[0] as ImageLayer).transform.x).toBeCloseTo(400);
    expect((turned.layers[0] as ImageLayer).transform.rotation).toBeCloseTo(180);
  });

  it("stretches one way whatever the layers' angles: a turned one is skewed, every pixel carried", () => {
    expect(frameOf(doc(["a", 100, 100, 90], ["b", 400, 300]).layers, ["a", "b"], sized)!.stretches).toBe(true);
    const turned = doc(["a", 100, 100, 30], ["b", 400, 300]);
    const frame = frameOf(turned.layers, ["a", "b"], sized)!;
    expect(frame.stretches).toBe(true);
    const stretched = frame.place(turned, { ...frame.t, scaleX: 2 });
    const a = stretched.layers.find((l) => l.id === "a") as ImageLayer;
    expect(a.transform.skew).toBeDefined();
    expect(touches({ x0: 0, y0: 0, x1: 10, y1: 10 }, { x0: 10, y0: 5, x1: 20, y1: 20 })).toBe(true);
    expect(touches({ x0: 0, y0: 0, x1: 10, y1: 10 }, { x0: 11, y0: 5, x1: 20, y1: 20 })).toBe(false);
  });
});
