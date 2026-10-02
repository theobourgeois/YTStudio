import { describe, expect, it } from "vitest";
import { GROSS_TIME_PRESETS, offsetValue } from "@shared/music/gross-beat-presets";
import { curveTick, curveX, curveY } from "../automation/curve-geometry";
import { gridLines, guides, panelBox, pointHint, snapLabel, snapTick, snapValue, stepCell, valueText } from "./geometry";

describe("Gross Beat's mapping panel", () => {
  it("spreads the bar across the panel, with room at its ends", () => {
    const box = panelBox(394, 300);
    expect(curveX(box, 0)).toBe(5);
    expect(curveX(box, 384)).toBeCloseTo(389, 6);
    expect(curveTick(box, 5 + 96 * box.pxPerTick)).toBeCloseTo(96, 6);
    // Now along the top, eight beats back along the bottom.
    expect(curveY(box, 1)).toBeLessThan(curveY(box, offsetValue(-1)));
  });

  it("snaps to the grid (Alt or X: to the tick), times' values in steps of it too", () => {
    expect(snapTick(50, 1 / 8, false)).toBe(48);
    expect(snapTick(50, 1 / 3, false)).toBe(64);
    expect(snapTick(50, 1 / 8, true)).toBe(50);
    expect(snapTick(50.4, 0, false)).toBe(50);
    expect(snapTick(500, 1 / 4, false)).toBe(384);
    // An offset of 0.3 beats back, on the 1/4 grid: a quarter beat back.
    expect(snapValue(offsetValue(-0.3), "time", 1 / 4, false)).toBe(offsetValue(-0.25));
    expect(snapValue(0.37, "volume", 1 / 4, false)).toBe(0.37);
    expect(snapLabel(1 / 16)).toBe("1/16");
    expect(snapLabel(0)).toBe("X");
  });

  it("paints steps in the grid's cells", () => {
    expect(stepCell(50, 1 / 8)).toEqual({ from: 48, to: 60 });
    expect(stepCell(383.5, 1 / 4)).toEqual({ from: 360, to: 384 });
    expect(stepCell(7.6, 0)).toEqual({ from: 7, to: 8 });
  });

  it("draws each snap step and each beat, and the guides", () => {
    const lines = gridLines(1 / 4);
    expect(lines).toHaveLength(17);
    expect(lines.filter((l) => l.beat).map((l) => l.tick)).toEqual([0, 96, 192, 288, 384]);
    const { safety, reverse } = guides();
    // A pause: a beat back for each beat on, so four back at the bar's end.
    expect(safety).toEqual([0, 1, 384, offsetValue(-4)]);
    // Backwards at normal speed: two back per beat, from each beat along the top.
    expect(reverse[0]).toEqual([0, 1, 384, 0]);
    expect(reverse[3]).toEqual([288, 1, 384, offsetValue(-2)]);
  });

  it("says what a point is, and how fast it plays from there", () => {
    expect(valueText(offsetValue(-1.5), "time")).toBe("1.5 beats back");
    expect(valueText(1, "time")).toBe("now");
    expect(valueText(0.25, "volume")).toBe("25%");
    const half = GROSS_TIME_PRESETS.find((p) => p.name === "1/2 Speed")!.points;
    expect(pointHint(half, 0, "time")).toBe("Beat 0: now, then ×0.5 (-12 st)");
  });
});
