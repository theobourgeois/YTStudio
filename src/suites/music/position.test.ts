import { describe, expect, it } from "vitest";
import { STEP_TICKS } from "@shared/music/types";
import { positionAt, positionText } from "./position";

describe("the toolbar's position", () => {
  it("reads bars, steps and ticks, from 1", () => {
    expect(positionText(0, 16)).toBe("1:01:00");
    expect(positionText(STEP_TICKS * 4 + 5, 16)).toBe("1:05:05");
    expect(positionText(STEP_TICKS * 16, 16)).toBe("2:01:00");
    // In 3/4, a bar is 12 steps.
    expect(positionText(STEP_TICKS * 13, 12)).toBe("2:02:00");
    expect(positionText(-3, 16)).toBe("1:01:00");
  });

  it("puts a press on the slider at the step under it, inside the pattern", () => {
    const pattern = STEP_TICKS * 16;
    expect(positionAt(0, pattern)).toBe(0);
    expect(positionAt(0.5, pattern)).toBe(STEP_TICKS * 8);
    expect(positionAt(1, pattern)).toBe(STEP_TICKS * 15);
    expect(positionAt(-1, pattern)).toBe(0);
  });
});
