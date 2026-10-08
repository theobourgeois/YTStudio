import { describe, expect, it } from "vitest";
import { cableClips, cablePath, cableSwing } from "./cables";

describe("a routing cable", () => {
  it("drops below the strips' bottom between its ends, further the further apart they are", () => {
    expect(cablePath({ x: 10, y: 100 }, { x: 50, y: 100 }, 120)).toBe("M 10 100 C 10 152.8, 50 152.8, 50 100");
    expect(cablePath({ x: 10, y: 100 }, { x: 2000, y: 100 }, 120)).toContain("C 10 268");
  });

  it("swings when it's plugged in, less and less, and is still after a moment", () => {
    expect(cableSwing(0)).toBe(18);
    expect(Math.abs(cableSwing(300))).toBeLessThan(4);
    expect(cableSwing(900)).toBe(0);
    expect(cableSwing(Infinity)).toBe(0);
  });

  it("shows each end only in its own dock: one scrolled under a docked strip is cut off there", () => {
    const middle = [0, 600] as const;
    const right = [600, 900] as const;
    // Both ends in view: each half up to the middle (within its dock), with room for the stroke past its end.
    expect(cableClips({ x: 100, region: middle }, { x: 700, region: right })).toEqual([[97, 400], [600, 703]]);
    // The middle strip scrolled behind the right dock: its end isn't drawn, the dock's is.
    const [hidden, shown] = cableClips({ x: 650, region: middle }, { x: 800, region: right });
    expect(hidden[1] - hidden[0]).toBeLessThanOrEqual(0);
    expect(shown).toEqual([725, 803]);
  });
});
