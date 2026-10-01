import { describe, expect, it } from "vitest";
import { cablePath, cableSwing } from "./cables";

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
});
