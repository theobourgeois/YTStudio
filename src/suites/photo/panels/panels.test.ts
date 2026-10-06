import { describe, expect, it } from "vitest";
import { addImageLayer, addAdjustmentLayer, setEffectParams, setTransform, updateLayer } from "@shared/photo/edits";
import { createPhotoProject } from "@shared/photo/project";
import type { CurvePoints } from "@shared/photo/types";
import { layersMoved } from "../canvas/handles";
import { addPoint, movePoint, removePoint } from "./curve-points";
import { dropIndex } from "./stack";

const curve: CurvePoints = [
  [0, 0],
  [64, 80],
  [192, 200],
  [255, 255],
];

describe("Curves' point edits", () => {
  it("move a point between its neighbours, in whole levels", () => {
    expect(movePoint(curve, 1, 150.4, 300)).toEqual([[0, 0], [150, 255], [192, 200], [255, 255]]);
    // Never onto or past a neighbour.
    expect(movePoint(curve, 1, 250, 10)[1]).toEqual([191, 10]);
    expect(movePoint(curve, 0, 90, 5)[0]).toEqual([63, 5]);
    expect(movePoint(curve, 3, -4, 240)[3]).toEqual([193, 240]);
  });

  it("add a point in order (not on another's input, nor past 16), and remove one (keeping two)", () => {
    expect(addPoint(curve, 128.2, 140)).toEqual({ points: [[0, 0], [64, 80], [128, 140], [192, 200], [255, 255]], index: 2 });
    expect(addPoint(curve, 64, 10)).toBeNull();
    const full = Array.from({ length: 16 }, (_, i) => [i * 17, i * 17] as [number, number]);
    expect(addPoint(full, 3, 3)).toBeNull();
    expect(removePoint(curve, 1)).toEqual([[0, 0], [192, 200], [255, 255]]);
    expect(removePoint([[0, 0], [255, 255]], 0)).toEqual([[0, 0], [255, 255]]);
  });
});

describe("the Layers panel's stack", () => {
  it("drops a row where it's let go, its own place left out", () => {
    // Three layers (document indices 0..2; the panel shows 2, 1, 0). The top one (2) dropped below the bottom row.
    expect(dropIndex(3, 2, 3)).toBe(0);
    // Dropped where it was (just above or below itself): it stays.
    expect(dropIndex(3, 2, 0)).toBe(2);
    expect(dropIndex(3, 2, 1)).toBe(2);
    // The bottom one dropped above the top row.
    expect(dropIndex(3, 0, 0)).toBe(2);
    // The middle one dropped between the bottom two... is where it was; above the top, on top.
    expect(dropIndex(3, 1, 2)).toBe(1);
    expect(dropIndex(3, 1, 0)).toBe(2);
  });
});

describe("the canvas's quality", () => {
  it("is interactive only while an image layer moves", () => {
    let doc = addImageLayer(createPhotoProject("P"), { id: "a", mediaId: "m", name: "a", size: { width: 10, height: 10 } });
    doc = addAdjustmentLayer(doc, { id: "e", type: "exposure" });
    expect(layersMoved(doc, setTransform(doc, "a", { x: 3 }))).toBe(true);
    expect(layersMoved(doc, setEffectParams(doc, "e", { exposure: 1 }))).toBe(false);
    expect(layersMoved(doc, updateLayer(doc, "a", { opacity: 0.5 }))).toBe(false);
  });
});
