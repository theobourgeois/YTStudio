import { describe, expect, it } from "vitest";
import type { Motion } from "./effects.ts";
import {
  anchorAt,
  containsPoint,
  cssMatrix,
  fittedSize,
  frameCorners,
  placeClip,
  scaleFromHandle,
  toCanvas,
  toFrame,
  wrapDegrees,
} from "./transform.ts";

const canvas = { width: 1080, height: 1920 };
const landscape = { width: 1920, height: 1080 };
const identity: Motion = { fit: "contain", position: [0.5, 0.5], scaleX: 1, scaleY: 1, rotation: 0, anchor: [0.5, 0.5] };
const place = (m: Partial<Motion> = {}, media = landscape) => placeClip(canvas, media, { ...identity, ...m });
const close = (a: number[], b: number[]) => a.forEach((v, i) => expect(v).toBeCloseTo(b[i], 6));

describe("placement", () => {
  it("fits the whole frame or fills the canvas at 100%", () => {
    expect(fittedSize(canvas, landscape, "contain")).toEqual({ width: 1080, height: 607.5 });
    const cover = fittedSize(canvas, landscape, "cover");
    expect(cover.height).toBe(1920);
    expect(cover.width).toBeCloseTo(3413.333, 3);
    // Unknown media size: the canvas.
    expect(fittedSize(canvas, { width: 0, height: 0 }, "contain")).toEqual(canvas);
  });

  it("centres the frame by default", () => {
    close(frameCorners(place()).flat(), [0, 656.25, 1080, 656.25, 1080, 1263.75, 0, 1263.75]);
    expect(cssMatrix(place())).toBe("matrix(1, 0, 0, 1, 0, 656.25)");
  });

  it("scales and rotates around the anchor point, which sits at the position", () => {
    // Anchor at the top-left corner, placed at the canvas centre, turned a quarter clockwise.
    const p = place({ anchor: [0, 0], rotation: 90, scaleX: 0.5, scaleY: 0.5 });
    close(toCanvas(p, [0, 0]), [540, 960]);
    // The frame's top edge now points down; its left edge points left.
    close(toCanvas(p, [1080, 0]), [540, 960 + 540]);
    close(toCanvas(p, [0, 607.5]), [540 - 303.75, 960]);
  });

  it("maps canvas points back into the frame", () => {
    const p = place({ rotation: 33, scaleX: 1.7, scaleY: 0.4, position: [0.2, 0.7], anchor: [0.1, 0.9] });
    close(toFrame(p, toCanvas(p, [123, 45]))!, [123, 45]);
    expect(toFrame(place({ scaleX: 0 }), [0, 0])).toBeNull();
  });

  it("hit-tests the rotated frame, not its bounding box", () => {
    const p = placeClip({ width: 100, height: 100 }, { width: 100, height: 100 }, { ...identity, scaleX: 0.5, scaleY: 0.5, rotation: 45 });
    expect(containsPoint(p, [50, 50])).toBe(true);
    expect(containsPoint(p, [50, 16])).toBe(true); // top corner of the diamond
    expect(containsPoint(p, [27, 27])).toBe(false); // inside the box, outside the diamond
    expect(containsPoint(place({ scaleX: 0 }), [540, 960])).toBe(false);
  });
});

describe("direct manipulation", () => {
  it("stretches one axis from an edge handle", () => {
    const p = place();
    // Right edge (x 1080) pulled to x 810: half the width from the centre anchor.
    expect(scaleFromHandle(p, [1, 0.5], [810, 960], false)).toEqual({ scaleX: 0.5, scaleY: 1 });
    // Bottom edge pulled down by 303.75 (half the height): 2x tall.
    const s = scaleFromHandle(p, [0.5, 1], [540, 1263.75 + 303.75], false);
    expect(s.scaleX).toBe(1);
    expect(s.scaleY).toBeCloseTo(2, 9);
  });

  it("scales proportionally from a corner, along the handle's direction", () => {
    const p = place();
    const s = scaleFromHandle(p, [1, 1], [540 + 1080, 960 + 607.5], true);
    expect(s.scaleX).toBeCloseTo(2, 9);
    expect(s.scaleY).toBeCloseTo(2, 9);
    // Pulled past the anchor: nothing (never flipped).
    expect(scaleFromHandle(p, [1, 1], [0, 0], true)).toEqual({ scaleX: 0, scaleY: 0 });
  });

  it("follows the frame's rotation", () => {
    const p = place({ rotation: 90 });
    // After a quarter turn the frame's right edge faces down.
    const s = scaleFromHandle(p, [1, 0.5], [540, 960 + 1080], false);
    expect(s.scaleX).toBeCloseTo(2, 9);
    expect(s.scaleY).toBe(1);
  });

  it("moves the anchor point without moving the picture", () => {
    const p = place({ rotation: 20, scaleX: 1.5, scaleY: 0.8 });
    const moved = anchorAt(p, canvas, [300, 700])!;
    const q = place({ rotation: 20, scaleX: 1.5, scaleY: 0.8, ...moved });
    close(frameCorners(q).flat(), frameCorners(p).flat());
    close([q.x, q.y], [300, 700]);
  });

  it("wraps angle differences", () => {
    expect(wrapDegrees(350)).toBe(-10);
    expect(wrapDegrees(-190)).toBe(170);
    expect(wrapDegrees(180)).toBe(180);
  });
});
