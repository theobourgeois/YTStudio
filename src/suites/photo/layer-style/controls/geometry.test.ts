import { describe, expect, it } from "vitest";
import { CONTOUR_PRESETS, MAX_CONTOUR_POINTS } from "@shared/photo/style/contours";
import { GRADIENT_PRESETS } from "@shared/photo/style/gradients";
import type { ContourPoint } from "@shared/photo/types";
import {
  addContourPoint,
  addGradientStop,
  moveGradientStop,
  removeGradientStop,
  setGradientStop,
  addStop,
  angleFromOffset,
  contourArea,
  contourPath,
  contourSamples,
  dialOffset,
  gradientHexAt,
  gradientOpacityAt,
  moveContourPoint,
  moveStop,
  nearestContourPoint,
  nearestStop,
  offGraph,
  pulledOff,
  removeContourPoint,
  removeStop,
  setContourCorner,
  stopLocation,
  wrapAngle,
} from "./geometry";

describe("the angle dial", () => {
  it("reads degrees anticlockwise from 3 o'clock, with the screen's y down", () => {
    expect(angleFromOffset(10, 0)).toBe(0);
    expect(angleFromOffset(0, -10)).toBe(90);
    expect(angleFromOffset(-10, 0)).toBe(180);
    expect(angleFromOffset(0, 10)).toBe(-90);
    expect(angleFromOffset(-10, -10)).toBe(135);
    expect(angleFromOffset(-5, -8.66)).toBe(120);
  });

  it("rounds to whole degrees, and Shift snaps to 15°", () => {
    expect(angleFromOffset(10, -1)).toBe(6);
    expect(angleFromOffset(10, -1, true)).toBe(0);
    expect(angleFromOffset(10, -2, true)).toBe(15);
    expect(angleFromOffset(-10, 0.5, true)).toBe(180);
  });

  it("points nowhere from the centre", () => {
    expect(angleFromOffset(0, 0)).toBeNull();
  });

  it("wraps onto (−180, 180]", () => {
    expect(wrapAngle(-180)).toBe(180);
    expect(wrapAngle(181)).toBe(-179);
    expect(wrapAngle(-190)).toBe(170);
    expect(wrapAngle(720)).toBe(0);
    expect(Object.is(wrapAngle(-360), -0)).toBe(false);
  });

  it("draws its line the way the angle points", () => {
    const up = dialOffset(90, 10);
    expect(up.x).toBeCloseTo(0);
    expect(up.y).toBeCloseTo(-10);
    const left = dialOffset(180, 10);
    expect(left.x).toBeCloseTo(-10);
    expect(left.y).toBeCloseTo(0);
  });
});

describe("a gradient's stops", () => {
  const stops = [{ at: 0 }, { at: 0.3 }, { at: 1 }];

  it("keeps locations in whole percent on the bar", () => {
    expect(stopLocation(0.123)).toBe(0.12);
    expect(stopLocation(-0.4)).toBe(0);
    expect(stopLocation(1.7)).toBe(1);
  });

  it("finds the nearest within the tolerance", () => {
    expect(nearestStop(stops, 0.32, 0.04)).toBe(1);
    expect(nearestStop(stops, 0.97, 0.04)).toBe(2);
    expect(nearestStop(stops, 0.6, 0.04)).toBe(-1);
  });

  it("adds a stop in order, after any at the same place", () => {
    expect(addStop(stops, { at: 0.5 })).toEqual({ stops: [{ at: 0 }, { at: 0.3 }, { at: 0.5 }, { at: 1 }], index: 2 });
    expect(addStop(stops, { at: 0.3 }).index).toBe(2);
    expect(addStop(stops, { at: -1 }).stops[0]).toEqual({ at: 0 });
  });

  it("moves a stop past its neighbours, keeping the order, and says where it went", () => {
    const colours = [
      { at: 0, colour: "#000000" },
      { at: 0.5, colour: "#ff0000", mid: 0.3 },
      { at: 1, colour: "#ffffff" },
    ];
    const moved = moveStop(colours, 1, 0.9);
    expect(moved.index).toBe(1);
    expect(moved.stops[1]).toEqual({ at: 0.9, colour: "#ff0000", mid: 0.3 });
    const past = moveStop(colours, 0, 1.4);
    expect(past.index).toBe(2);
    expect(past.stops.map((s) => s.at)).toEqual([0.5, 1, 1]);
    expect(past.stops[2].colour).toBe("#000000");
    expect(colours[0].at).toBe(0);
  });

  it("removes a stop but never the last of its kind", () => {
    expect(removeStop(stops, 1)).toEqual([{ at: 0 }, { at: 1 }]);
    const one = [{ at: 0.4 }];
    expect(removeStop(one, 0)).toBe(one);
    expect(removeStop(stops, 7)).toBe(stops);
  });

  it("comes off when dragged well away from the bar, either way", () => {
    expect(pulledOff(10)).toBe(false);
    expect(pulledOff(60)).toBe(true);
    expect(pulledOff(-60)).toBe(true);
  });

  it("edits a gradient's stops of either kind, named Custom, keeping their midpoints", () => {
    const g = { ...GRADIENT_PRESETS[4], colours: GRADIENT_PRESETS[4].colours.map((s, i) => (i === 0 ? { ...s, mid: 0.3 } : s)) };
    const added = addGradientStop(g, "opacity", 0.25);
    expect(added.index).toBe(1);
    expect(added.gradient.name).toBe("Custom");
    expect(added.gradient.opacities[1]).toEqual({ at: 0.25, opacity: 1 });
    expect(added.gradient.colours).toBe(g.colours);
    const colour = addGradientStop(g, "colour", 1);
    expect(colour.index).toBe(3);
    expect(colour.gradient.colours[3]).toEqual({ at: 1, colour: "#fffc00" });

    const moved = moveGradientStop(g, "colour", 0, 0.75);
    expect(moved.index).toBe(1);
    expect(moved.gradient.colours[1]).toEqual({ at: 0.75, colour: "#0a00b2", mid: 0.3 });

    expect(removeGradientStop(g, "colour", 1).colours.map((s) => s.colour)).toEqual(["#0a00b2", "#fffc00"]);
    const single = { ...g, opacities: [{ at: 0, opacity: 1 }] };
    expect(removeGradientStop(single, "opacity", 0)).toBe(single);

    expect(setGradientStop(g, "colour", 2, "#ABCDEF").colours[2]).toEqual({ at: 1, colour: "#abcdef" });
    expect(setGradientStop(g, "opacity", 1, 1.5).opacities[1].opacity).toBe(1);
    expect(setGradientStop(g, "opacity", 1, "#ffffff")).toBe(g);
  });

  it("gives a stop added the gradient's colour and opacity there", () => {
    const blackWhite = GRADIENT_PRESETS[0];
    expect(gradientHexAt(blackWhite, 0)).toBe("#000000");
    expect(gradientHexAt(blackWhite, 1)).toBe("#ffffff");
    expect(gradientHexAt(blackWhite, 0.5)).toBe("#808080");
    const fading = GRADIENT_PRESETS[1];
    expect(gradientOpacityAt(fading, 0)).toBe(1);
    expect(gradientOpacityAt(fading, 0.5)).toBe(0.5);
    expect(gradientOpacityAt(fading, 1)).toBe(0);
  });
});

describe("a contour's points", () => {
  const line: ContourPoint[] = [
    { x: 0, y: 0 },
    { x: 100, y: 120, corner: true },
    { x: 255, y: 255 },
  ];

  it("finds the point under the pointer", () => {
    expect(nearestContourPoint(line, 103, 118)).toBe(1);
    expect(nearestContourPoint(line, 2, 4)).toBe(0);
    expect(nearestContourPoint(line, 180, 20)).toBe(-1);
  });

  it("keeps the ends at inputs 0 and 255, moving only up and down", () => {
    expect(moveContourPoint(line, 0, 40, 30.4)[0]).toEqual({ x: 0, y: 30 });
    expect(moveContourPoint(line, 2, 200, 300)[2]).toEqual({ x: 255, y: 255 });
    const rolling = CONTOUR_PRESETS.find((c) => c.name === "Rolling Slope - Descending")!.points;
    expect(moveContourPoint(rolling, 0, 2, 250)[0]).toEqual({ x: 0, y: 250 });
  });

  it("keeps a point strictly between its neighbours, and its corner", () => {
    expect(moveContourPoint(line, 1, 300, -5)[1]).toEqual({ x: 254, y: 0, corner: true });
    expect(moveContourPoint(line, 1, -20, 60.6)[1]).toEqual({ x: 1, y: 61, corner: true });
    expect(line[1]).toEqual({ x: 100, y: 120, corner: true });
  });

  it("adds a smooth point in order, between the ends, one per input, 16 at most", () => {
    expect(addContourPoint(line, 50.2, 40)).toEqual({ points: [line[0], { x: 50, y: 40 }, line[1], line[2]], index: 1 });
    expect(addContourPoint(line, 100, 10)).toBeNull();
    expect(addContourPoint(line, 0, 10)).toBeNull();
    expect(addContourPoint(line, 255, 10)).toBeNull();
    const full: ContourPoint[] = Array.from({ length: MAX_CONTOUR_POINTS }, (_, i) => ({ x: i * 17, y: i * 17 }));
    expect(addContourPoint(full, 9, 9)).toBeNull();
  });

  it("removes inner points, never the ends", () => {
    expect(removeContourPoint(line, 1)).toEqual([line[0], line[2]]);
    expect(removeContourPoint(line, 0)).toBe(line);
    expect(removeContourPoint(line, 2)).toBe(line);
  });

  it("makes a point a corner or smooth", () => {
    expect(setContourCorner(line, 1, false)[1]).toEqual({ x: 100, y: 120 });
    expect(setContourCorner(line, 0, true)[0]).toEqual({ x: 0, y: 0, corner: true });
  });

  it("is off the graph past its margin", () => {
    expect(offGraph(128, 128)).toBe(false);
    expect(offGraph(-10, 270)).toBe(false);
    expect(offGraph(128, 300)).toBe(true);
    expect(offGraph(-40, 128)).toBe(true);
  });

  it("samples the curve with every point's input, so corners stay sharp", () => {
    const saw = CONTOUR_PRESETS.find((c) => c.name === "Sawtooth 1")!;
    const samples = contourSamples(saw, 16);
    const peak = samples.find(([x]) => x === 66)!;
    expect(peak[1]).toBeCloseTo(128, 5);
    expect(samples[0]).toEqual([0, 0]);
    expect(samples.at(-1)![0]).toBe(255);
    expect(samples.every(([x], i) => i === 0 || x > samples[i - 1][0])).toBe(true);
  });

  it("draws the curve and the area under it in a 255 box, y down", () => {
    const linear = CONTOUR_PRESETS[0];
    expect(contourPath(linear, 1)).toBe("M0.00,255.00L255.00,0.00");
    expect(contourArea(linear, 1)).toBe("M0,255L0.00,255.00L255.00,0.00L255,255Z");
  });
});
