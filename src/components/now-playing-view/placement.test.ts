import { describe, expect, it } from "vitest";
import { MARGIN, MINI, SMALLEST, defaultBox, dragBox, fitBox, placeBox, readBox } from "./placement";

const APP = { width: 1440, height: 900 };

describe("placement", () => {
  it("starts the mini player in the bottom right corner, and a window centred at 16:9", () => {
    expect(defaultBox("mini", APP)).toEqual({ x: APP.width - MINI.width - MARGIN, y: APP.height - MINI.height - MARGIN, ...MINI });
    const win = defaultBox("window", APP);
    expect(win.width / win.height).toBeCloseTo(16 / 9, 1);
    expect(win.x + win.width / 2).toBeCloseTo(APP.width / 2, 0);
    expect(win.y + win.height / 2).toBeCloseTo(APP.height / 2, 0);
  });

  it("keeps a box whole inside the app, as the app gets smaller", () => {
    const left = { x: 1000, y: 600, width: 360, height: 203 };
    expect(placeBox("mini", left, APP)).toEqual(left);
    expect(placeBox("mini", left, { width: 1000, height: 600 })).toEqual({ x: 640, y: 397, width: 360, height: 203 });
    expect(fitBox({ x: -50, y: -10, width: 5000, height: 50 }, APP)).toEqual({ x: 0, y: 0, width: APP.width, height: SMALLEST.height });
  });

  it("moves a box, and resizes it by its edges with the opposite ones staying put", () => {
    const start = { x: 400, y: 300, width: 480, height: 270 };
    expect(dragBox(start, null, 100, -50, APP)).toEqual({ x: 500, y: 250, width: 480, height: 270 });
    expect(dragBox(start, null, 5000, 5000, APP)).toEqual({ x: APP.width - 480, y: APP.height - 270, width: 480, height: 270 });
    // The bottom right corner: bigger, the top left stays.
    expect(dragBox(start, { x: 1, y: 1 }, 120, 60, APP)).toEqual({ x: 400, y: 300, width: 600, height: 330 });
    // The left edge: the right one stays, never smaller than allowed.
    expect(dragBox(start, { x: -1, y: 0 }, 1000, 0, APP)).toEqual({ x: 400 + 480 - SMALLEST.width, y: 300, width: SMALLEST.width, height: 270 });
    // Not past the app's edges.
    expect(dragBox(start, { x: -1, y: -1 }, -1000, -1000, APP)).toEqual({ x: 0, y: 0, width: 880, height: 570 });
  });

  it("reads a kept box, or nothing", () => {
    expect(readBox({ x: 1, y: 2, width: 3, height: 4 })).toEqual({ x: 1, y: 2, width: 3, height: 4 });
    expect(readBox({ x: 1, y: 2, width: "3" })).toBeNull();
    expect(readBox(null)).toBeNull();
  });
});
