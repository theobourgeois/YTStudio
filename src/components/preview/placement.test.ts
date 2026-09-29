import { describe, expect, it } from "vitest";
import type { Clip, MediaAsset, Project } from "@shared/types";
import { defaultEffects, setParams } from "@shared/effects";
import { MAIN_TRACK_ID, createDefaultProject } from "@shared/timeline";
import { type Placement, placeClip } from "@shared/transform";
import { clipAtPoint, clipsOnCanvas, snapMove } from "./placement";

const canvas = { width: 100, height: 200 };
const square = { width: 100, height: 100 } as MediaAsset;
const assets = [{ ...square, id: "a" }];
const clip = (id: string, trackId: string, start: number, dur: number): Clip => ({
  id, assetId: "a", trackId, start, in: 0, out: dur, effects: defaultEffects(),
});

function stacked(): Project {
  return {
    ...createDefaultProject(),
    tracks: [{ id: "top", kind: "video", name: "Video 2", muted: false }, ...createDefaultProject().tracks],
    clips: [clip("under", MAIN_TRACK_ID, 0, 4), clip("over", "top", 1, 1)],
  };
}

describe("clipsOnCanvas", () => {
  it("lists what each video track shows, top layer first", () => {
    expect(clipsOnCanvas(stacked(), assets, canvas, 1.5).map((c) => c.clip.id)).toEqual(["over", "under"]);
    expect(clipsOnCanvas(stacked(), assets, canvas, 3).map((c) => c.clip.id)).toEqual(["under"]);
    // Square media fitted to the canvas's width: 100x100, centred.
    expect(clipsOnCanvas(stacked(), assets, canvas, 3)[0].placement).toMatchObject({ width: 100, height: 100, x: 50, y: 100 });
  });

  it("picks the topmost visible clip under a point", () => {
    let p = setParams(stacked(), "over", "motion", { scale: 0.2, position: [0.1, 0.1] });
    const on = (q: Project) => clipsOnCanvas(q, assets, canvas, 1.5);
    expect(clipAtPoint(on(p), [10, 20])?.clip.id).toBe("over");
    expect(clipAtPoint(on(p), [50, 100])?.clip.id).toBe("under");
    expect(clipAtPoint(on(p), [50, 10])).toBeUndefined();
    // A fully transparent clip can't be clicked.
    p = setParams(p, "over", "opacity", { opacity: 0 });
    expect(clipAtPoint(on(p), [10, 20])).toBeUndefined();
  });
});

describe("snapMove", () => {
  const p: Placement = placeClip(canvas, { width: 100, height: 100 }, {
    fit: "contain", position: [0.3, 0.5], scaleX: 0.5, scaleY: 0.5, rotation: 0, anchor: [0.5, 0.5],
  }); // 50x50 box at x 5..55, y 75..125

  it("lines the box's edges or centre up with the canvas edges or centre", () => {
    // Left edge 5 + (-3.5) = 1.5 -> snaps to 0.
    expect(snapMove(p, [-3.5, 0], canvas, 4)).toEqual({ delta: [-5, 0], guides: { x: 0, y: 100 } });
    // Centre x 30 + 18 = 48 -> 50.
    expect(snapMove(p, [18, 7], canvas, 4)).toEqual({ delta: [20, 7], guides: { x: 50, y: null } });
  });

  it("leaves the move alone out of range", () => {
    expect(snapMove(p, [10, 10], canvas, 4)).toEqual({ delta: [10, 10], guides: { x: null, y: null } });
  });
});
