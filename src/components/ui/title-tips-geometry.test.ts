import { describe, expect, it } from "vitest";
import { TIP_GAP, TIP_MARGIN, placeTip } from "./title-tips-geometry";

const view = { width: 1000, height: 800 };
const tip = { width: 120, height: 24 };

describe("where a title's tip goes", () => {
  it("is centred under its control", () => {
    expect(placeTip({ left: 440, top: 100, width: 40, height: 20 }, tip, view)).toEqual({ left: 400, top: 120 + TIP_GAP, side: "bottom" });
  });

  it("goes over its control when there's no room under it", () => {
    expect(placeTip({ left: 440, top: 770, width: 40, height: 20 }, tip, view)).toEqual({ left: 400, top: 770 - TIP_GAP - 24, side: "top" });
  });

  it("stays inside the window at its edges", () => {
    expect(placeTip({ left: 0, top: 100, width: 20, height: 20 }, tip, view).left).toBe(TIP_MARGIN);
    expect(placeTip({ left: 990, top: 100, width: 10, height: 20 }, tip, view).left).toBe(1000 - TIP_MARGIN - 120);
    // Too tall for either side: under it, as far down as it fits.
    const tall = placeTip({ left: 440, top: 10, width: 40, height: 780 }, { width: 120, height: 400 }, view);
    expect(tall).toMatchObject({ side: "bottom", top: 800 - TIP_MARGIN - 400 });
  });
});
