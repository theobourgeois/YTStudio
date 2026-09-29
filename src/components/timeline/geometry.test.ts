import { describe, expect, it } from "vitest";
import type { Clip, Project } from "@shared/types";
import { MAIN_TRACK_ID, appendToTrack, createDefaultProject, addClip } from "@shared/timeline";
import {
  anchoredScrollLeft,
  contentWidth,
  edgeScrollSpeed,
  filmstripTiles,
  fitZoom,
  formatRulerLabel,
  laneAt,
  layoutLanes,
  moveSnapPoints,
  newTrackZoneAt,
  pageScrollTarget,
  peakInRange,
  rulerTicks,
  sliderToZoom,
  snapDelta,
  tickSpacing,
  trimSnapPoints,
  visibleWindow,
  wheelZoomFactor,
  zoomToSlider,
} from "./geometry";
import { AUDIO_LANE_HEIGHT, TOP_GUTTER, VIDEO_LANE_HEIGHT } from "./constants";

const AUDIO = "audio_1";
function clip(id: string, trackId: string, start: number, dur: number): Clip {
  return { id, assetId: "a", trackId, start, in: 0, out: dur, volume: 1, fit: "contain" };
}
/** main: a[0,2) b[2,5) c[5,6); audio: m[1,4) */
function sample(): Project {
  let p = createDefaultProject();
  p = appendToTrack(p, clip("a", MAIN_TRACK_ID, 0, 2), MAIN_TRACK_ID);
  p = appendToTrack(p, clip("b", MAIN_TRACK_ID, 0, 3), MAIN_TRACK_ID);
  p = appendToTrack(p, clip("c", MAIN_TRACK_ID, 0, 1), MAIN_TRACK_ID);
  p = addClip(p, clip("m", AUDIO, 1, 3));
  return p;
}

describe("lanes", () => {
  it("stacks lanes below the top gutter and finds the lane under y", () => {
    const { lanes, height } = layoutLanes(createDefaultProject().tracks);
    const g = TOP_GUTTER;
    expect(lanes.map((l) => l.top)).toEqual([g, g + VIDEO_LANE_HEIGHT]);
    expect(height).toBe(g + VIDEO_LANE_HEIGHT + AUDIO_LANE_HEIGHT);
    expect(laneAt(lanes, g)?.trackId).toBe(MAIN_TRACK_ID);
    expect(laneAt(lanes, g + VIDEO_LANE_HEIGHT - 0.5)?.trackId).toBe(MAIN_TRACK_ID);
    expect(laneAt(lanes, g + VIDEO_LANE_HEIGHT)?.trackId).toBe(AUDIO);
    expect(laneAt(lanes, height)).toBeNull();
    expect(laneAt(lanes, g - 1)).toBeNull();
  });

  it("finds the new-track zones above and below the lanes", () => {
    const { lanes, height } = layoutLanes(createDefaultProject().tracks);
    expect(newTrackZoneAt(lanes, TOP_GUTTER - 1)).toBe("above");
    expect(newTrackZoneAt(lanes, -40)).toBe("above");
    expect(newTrackZoneAt(lanes, TOP_GUTTER)).toBeNull();
    expect(newTrackZoneAt(lanes, height - 1)).toBeNull();
    expect(newTrackZoneAt(lanes, height)).toBe("below");
    expect(newTrackZoneAt([], 0)).toBeNull();
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
  const one = [{ start: 0, duration: 3 }];

  it("snaps whichever edge is closer", () => {
    const pts = [0, 10, 20];
    expect(snapDelta(9.9, one, pts, 0.2)).toEqual({ delta: 10, snappedTo: 10 });
    expect(snapDelta(17.1, one, pts, 0.2)).toEqual({ delta: 17, snappedTo: 20 });
    expect(snapDelta(15, one, pts, 0.2)).toEqual({ delta: 15, snappedTo: null });
    expect(snapDelta(5, one, pts, 0)).toEqual({ delta: 5, snappedTo: null });
  });

  it("never snaps an end edge that would push the start below 0", () => {
    expect(snapDelta(0.05, one, [2.9], 0.2)).toEqual({ delta: 0.05, snappedTo: null });
  });

  it("snaps a group by whichever member edge is closest", () => {
    const group = [{ start: 0, duration: 1 }, { start: 5, duration: 2 }];
    expect(snapDelta(2.95, group, [10], 0.2)).toEqual({ delta: 3, snappedTo: 10 });
  });

  it("move snap points are the other clips' edges and the playhead", () => {
    const pts = moveSnapPoints(sample(), ["a"], 7).sort((x, y) => x - y);
    // b[2,5) c[5,6); audio m[1,4); playhead 7.
    expect(pts).toEqual([0, 1, 2, 4, 5, 6, 7]);
    expect(moveSnapPoints(sample(), ["a", "m"], 7).sort((x, y) => x - y)).toEqual([0, 2, 5, 6, 7]);
  });

  it("trim snap points are the other clips' edges and the playhead", () => {
    const pts = trimSnapPoints(sample(), "b", 9).sort((x, y) => x - y);
    expect(pts).toEqual([0, 1, 2, 4, 5, 6, 9]);
    const audio = trimSnapPoints(sample(), "m", 0).sort((x, y) => x - y);
    expect(audio).toEqual([0, 2, 5, 6]);
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
