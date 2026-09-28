import { describe, expect, it } from "vitest";
import type { Clip, Project } from "@shared/types";
import { MAIN_TRACK_ID, appendToMain, createDefaultProject, addClip } from "@shared/timeline";
import {
  anchoredScrollLeft,
  contentWidth,
  edgeScrollSpeed,
  filmstripTiles,
  fitZoom,
  formatRulerLabel,
  laneAt,
  layoutLanes,
  mainSlotTime,
  moveSnapPoints,
  pageScrollTarget,
  peakInRange,
  rulerTicks,
  sliderToZoom,
  snapClipStart,
  tickSpacing,
  trimSnapPoints,
  visibleWindow,
  wheelZoomFactor,
  zoomToSlider,
} from "./geometry";
import { AUDIO_LANE_HEIGHT, VIDEO_LANE_HEIGHT } from "./constants";

const AUDIO = "audio_1";
function clip(id: string, trackId: string, start: number, dur: number): Clip {
  return { id, assetId: "a", trackId, start, in: 0, out: dur, volume: 1, fit: "contain" };
}
/** main: a[0,2) b[2,5) c[5,6); audio: m[1,4) */
function sample(): Project {
  let p = createDefaultProject();
  p = appendToMain(p, clip("a", MAIN_TRACK_ID, 0, 2));
  p = appendToMain(p, clip("b", MAIN_TRACK_ID, 0, 3));
  p = appendToMain(p, clip("c", MAIN_TRACK_ID, 0, 1));
  p = addClip(p, clip("m", AUDIO, 1, 3));
  return p;
}

describe("lanes", () => {
  it("stacks lanes by kind and finds the lane under y", () => {
    const { lanes, height } = layoutLanes(createDefaultProject().tracks);
    expect(lanes.map((l) => l.top)).toEqual([0, VIDEO_LANE_HEIGHT]);
    expect(height).toBe(VIDEO_LANE_HEIGHT + AUDIO_LANE_HEIGHT);
    expect(laneAt(lanes, 0)?.trackId).toBe(MAIN_TRACK_ID);
    expect(laneAt(lanes, VIDEO_LANE_HEIGHT - 0.5)?.trackId).toBe(MAIN_TRACK_ID);
    expect(laneAt(lanes, VIDEO_LANE_HEIGHT)?.trackId).toBe(AUDIO);
    expect(laneAt(lanes, height)).toBeNull();
    expect(laneAt(lanes, -1)).toBeNull();
  });
});

describe("zoom + scrolling", () => {
  it("content width covers the project plus trailing room and at least the viewport", () => {
    expect(contentWidth(0, 60, 800)).toBe(800);
    expect(contentWidth(100, 60, 800)).toBe(6000 + 400);
  });

  it("fit zoom fits the duration and clamps", () => {
    expect(fitZoom(0, 800, 5, 400)).toBeNull();
    expect(fitZoom(10, 1000, 5, 400)).toBeCloseTo(94);
    expect(fitZoom(0.01, 1000, 5, 400)).toBe(400);
    expect(fitZoom(10000, 1000, 5, 400)).toBe(5);
  });

  it("slider mapping round-trips on a log scale", () => {
    for (const z of [5, 20, 60, 400]) expect(sliderToZoom(zoomToSlider(z, 5, 400), 5, 400)).toBeCloseTo(z);
    expect(zoomToSlider(5, 5, 400)).toBe(0);
    expect(zoomToSlider(400, 5, 400)).toBe(1);
  });

  it("wheel zoom: scrolling up zooms in, clamped per event", () => {
    expect(wheelZoomFactor(-10, 0)).toBeGreaterThan(1);
    expect(wheelZoomFactor(10, 0)).toBeLessThan(1);
    expect(wheelZoomFactor(1000, 0)).toBe(wheelZoomFactor(60, 0));
    expect(wheelZoomFactor(3, 1)).toBe(wheelZoomFactor(48, 0));
  });

  it("anchors a time under the pointer", () => {
    expect(anchoredScrollLeft(10, 100, 300)).toBe(700);
    expect(anchoredScrollLeft(1, 100, 300)).toBe(0);
  });

  it("pages only when the playhead leaves the view", () => {
    expect(pageScrollTarget(500, 0, 1000, 24)).toBeNull();
    expect(pageScrollTarget(990, 0, 1000, 24)).toBe(966);
    expect(pageScrollTarget(100, 500, 1000, 24)).toBe(76);
    expect(pageScrollTarget(10, 500, 1000, 24)).toBe(0);
  });

  it("edge scroll speed ramps up towards the edges", () => {
    expect(edgeScrollSpeed(500, 1000)).toBe(0);
    expect(edgeScrollSpeed(0, 1000)).toBeLessThan(0);
    expect(edgeScrollSpeed(-50, 1000)).toBe(edgeScrollSpeed(0, 1000));
    expect(edgeScrollSpeed(1000, 1000)).toBeGreaterThan(0);
    expect(Math.abs(edgeScrollSpeed(10, 1000))).toBeGreaterThan(Math.abs(edgeScrollSpeed(40, 1000)));
  });

  it("visible window is chunk-quantised with overscan", () => {
    expect(visibleWindow(0, 800, 512)).toEqual({ x0: 0, x1: 1536 });
    expect(visibleWindow(1000, 800, 512)).toEqual({ x0: 0, x1: 2560 });
    expect(visibleWindow(1020, 800, 512)).toEqual(visibleWindow(1000, 800, 512));
    expect(visibleWindow(5000, 800, 512)).toEqual({ x0: 4096, x1: 6656 });
  });
});

describe("ruler", () => {
  it("labels are at least MIN_LABEL_SPACING apart at any zoom", () => {
    for (const zoom of [5, 7, 12, 30, 60, 100, 200, 400]) {
      const { major, minor } = tickSpacing(zoom);
      expect(major * zoom).toBeGreaterThanOrEqual(72);
      if (minor) expect(minor * zoom).toBeGreaterThanOrEqual(6);
    }
    expect(tickSpacing(60).major).toBe(2);
    expect(tickSpacing(400).major).toBe(0.25);
  });

  it("generates ticks for a window without drift", () => {
    const ticks = rulerTicks(60, 0, 600); // 10s at 60px/s: major 2s, minor 0.5s
    expect(ticks[0]).toMatchObject({ time: 0, x: 0, major: true, label: "0:00" });
    expect(ticks.filter((t) => t.major).map((t) => t.label)).toEqual([
      "0:00", "0:02", "0:04", "0:06", "0:08", "0:10",
    ]);
    expect(ticks.length).toBe(21);
    const far = rulerTicks(400, 400 * 3600, 400 * 3600 + 200);
    expect(far[0].time).toBe(3600);
    expect(far.every((t) => Number.isFinite(t.x))).toBe(true);
    expect(far.find((t) => t.major && t.time === 3600.25)?.label).toBe("1:00:00.25");
  });

  it("formats labels", () => {
    expect(formatRulerLabel(0, 1)).toBe("0:00");
    expect(formatRulerLabel(65, 5)).toBe("1:05");
    expect(formatRulerLabel(1.5, 0.5)).toBe("0:01.5");
    expect(formatRulerLabel(0.25, 0.25)).toBe("0:00.25");
    expect(formatRulerLabel(3, 0.25)).toBe("0:03");
    expect(formatRulerLabel(3723, 60)).toBe("1:02:03");
  });
});

describe("snapping", () => {
  it("snaps whichever edge is closer", () => {
    const pts = [0, 10, 20];
    expect(snapClipStart(9.9, 3, pts, 0.2)).toEqual({ start: 10, snappedTo: 10 });
    expect(snapClipStart(17.1, 3, pts, 0.2)).toEqual({ start: 17, snappedTo: 20 });
    expect(snapClipStart(15, 3, pts, 0.2)).toEqual({ start: 15, snappedTo: null });
    expect(snapClipStart(-5, 3, pts, 0.2)).toEqual({ start: 0, snappedTo: 0 });
    expect(snapClipStart(5, 3, pts, 0)).toEqual({ start: 5, snappedTo: null });
  });

  it("never snaps an end edge that would push the start below 0", () => {
    expect(snapClipStart(0.05, 3, [2.9], 0.2)).toEqual({ start: 0.05, snappedTo: null });
  });

  it("move snap points use the layout without the dragged clip", () => {
    const pts = moveSnapPoints(sample(), "a", 7).sort((x, y) => x - y);
    // Without a, main packs to b[0,3) c[3,4); audio m[1,4); playhead 7.
    expect(pts).toEqual([0, 1, 3, 4, 7]);
  });

  it("trim snap points exclude main clips that ripple", () => {
    const pts = trimSnapPoints(sample(), "b", 9).sort((x, y) => x - y);
    // a[0,2) stays, c ripples; m[1,4); playhead 9
    expect(pts).toEqual([0, 1, 2, 4, 9]);
    const audio = trimSnapPoints(sample(), "m", 0).sort((x, y) => x - y);
    expect(audio).toEqual([0, 2, 5, 6]);
  });

  it("main slot boundary times", () => {
    const p = sample();
    expect(mainSlotTime(p, 0)).toBe(0);
    expect(mainSlotTime(p, 1)).toBe(2);
    expect(mainSlotTime(p, 3)).toBe(6);
    expect(mainSlotTime(createDefaultProject(), 0)).toBe(0);
  });
});

describe("thumbnails + waveform", () => {
  it("only emits tiles in the requested range, with the nearest frame", () => {
    const tiles = filmstripTiles({
      from: 250,
      to: 520,
      tileWidth: 100,
      inPoint: 2,
      zoom: 100,
      assetDuration: 10,
      frameCount: 20,
    });
    expect(tiles.map((t) => t.x)).toEqual([200, 300, 400, 500]);
    // tile at x=200 -> source 4s -> frame 8 (0.5s per frame)
    expect(tiles[0].frame).toBe(8);
    const clamped = filmstripTiles({
      from: 0,
      to: 100000,
      tileWidth: 50,
      inPoint: 0,
      zoom: 5,
      assetDuration: 10,
      frameCount: 20,
    });
    expect(Math.max(...clamped.map((t) => t.frame))).toBe(19);
    expect(filmstripTiles({ from: 10, to: 5, tileWidth: 50, inPoint: 0, zoom: 5, assetDuration: 10, frameCount: 5 })).toEqual([]);
  });

  it("peakInRange takes the max and always samples a bucket", () => {
    const peaks = [0.1, 0.5, 0.2, 0.9];
    expect(peakInRange(peaks, 2, 0, 1)).toBe(0.5);
    expect(peakInRange(peaks, 2, 1.2, 1.25)).toBe(0.2);
    expect(peakInRange(peaks, 2, 0, 100)).toBe(0.9);
    expect(peakInRange(peaks, 2, 50, 51)).toBe(0);
    expect(peakInRange([], 2, 0, 1)).toBe(0);
  });
});
