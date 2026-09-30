import { describe, expect, it } from "vitest";
import { defaultEffects, shapeEffects, textEffects } from "@shared/effects";
import { MAIN_TRACK_ID } from "@shared/timeline";
import type { Clip, MediaAsset } from "@shared/types";
import type { OnCanvas } from "@/components/preview/placement";
import { boundsOf, clipBoxes, describeLayout } from "./layout";

const CANVAS = { width: 1080, height: 1920 };
const clip = (id: string, effects = defaultEffects(), assetId = ""): Clip => ({ id, assetId, trackId: MAIN_TRACK_ID, start: 0, in: 0, out: 5, effects });
const placed = (width: number, height: number, over: Partial<OnCanvas["placement"]> = {}): OnCanvas["placement"] => ({
  width, height, anchorX: width / 2, anchorY: height / 2, x: 540, y: 960, scaleX: 1, scaleY: 1, rotation: 0, ...over,
});

// A text whose frame is 600 x 200 with a 50 / 40 px margin around its letters.
const text: OnCanvas = {
  clip: clip("t", textEffects({ text: "Hello\nworld" })),
  time: 0,
  placement: placed(600, 200),
  text: {
    width: 600, height: 200, x: 50, y: 40, blockWidth: 500, blockHeight: 120, lines: [], lineHeight: 60, baseline: 45, padX: 10, padY: 5,
    font: "", stretch: "normal", fontPx: 50, letterSpacing: 0,
  },
};
const video: OnCanvas = { clip: clip("v", defaultEffects(), "a"), time: 0, placement: placed(1080, 1920, { scaleX: 0.5, scaleY: 0.5, x: 270, y: 480 }), text: null };
const asset = { id: "a", name: "beach.mp4", kind: "video" } as MediaAsset;

describe("measuring the canvas for the assistant", () => {
  it("gives a text's frame and the box around its letters alone", () => {
    expect(clipBoxes(text)).toEqual({ box: { x: 240, y: 860, width: 600, height: 200 }, letters: { x: 290, y: 900, width: 500, height: 120 } });
    // Scaled and turned a quarter: the letters' box is the upright one around them.
    const turned = clipBoxes({ ...text, placement: placed(600, 200, { scaleX: 2, scaleY: 2, rotation: 90 }) });
    expect(Object.values(turned.letters!).map(Math.round)).toEqual([420, 460, 240, 1000]);
    expect(boundsOf([[3, 9], [-1, 4], [5, 5]])).toEqual({ x: -1, y: 4, width: 6, height: 5 });
  });

  it("uses what a shape layer draws, not its canvas-sized frame", () => {
    const shape: OnCanvas = {
      clip: clip("s", shapeEffects()),
      time: 0,
      placement: placed(1080, 1920),
      text: null,
      shape: { reference: CANVAS, box: { x: 0.25, y: 0.4, width: 0.5, height: 0.2 } },
    };
    expect(Object.values(clipBoxes(shape).box).map(Math.round)).toEqual([270, 768, 540, 384]);
  });

  it("lists what's on the canvas, top first, with centres as position fractions", () => {
    const out = describeLayout([text, video], { a: asset }, CANVAS, 2.5).split("\n");
    expect(out[0]).toMatch(/^Canvas 1080×1920 px at 2\.5s\./);
    expect(out[1]).toBe('t  text "Hello"  box x 240 y 860 w 600 h 200 · centre (540, 960) = [0.5, 0.5] · letters x 290 y 900 w 500 h 120 · anchor at (540, 960)');
    expect(out[2]).toBe('v  video "beach.mp4"  box x 0 y 0 w 540 h 960 · centre (270, 480) = [0.25, 0.25] · anchor at (270, 480) · scale 50%');
    expect(out[3]).toMatch(/To put a shape behind a text/);
    // Only some clips; ones that aren't showing.
    expect(describeLayout([text, video], { a: asset }, CANVAS, 0, ["v"]).split("\n")).toHaveLength(3);
    expect(describeLayout([text], {}, CANVAS, 9, ["v"])).toMatch(/None of those clips is on the canvas/);
    expect(describeLayout([], {}, CANVAS, 9)).toMatch(/Nothing is on the canvas/);
  });
});
