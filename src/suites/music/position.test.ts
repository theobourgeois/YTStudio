import { describe, expect, it } from "vitest";
import { STEP_TICKS } from "@shared/music/types";
import { PPQ } from "@shared/music/types";
import { positionAt, positionText, splitTail, tempoText, timeText } from "./position";

describe("the toolbar's position", () => {
  it("reads bars, steps and ticks, from 1", () => {
    expect(positionText(0, 16)).toBe("1:01:00");
    expect(positionText(STEP_TICKS * 4 + 5, 16)).toBe("1:05:05");
    expect(positionText(STEP_TICKS * 16, 16)).toBe("2:01:00");
    // In 3/4, a bar is 12 steps.
    expect(positionText(STEP_TICKS * 13, 12)).toBe("2:02:00");
    expect(positionText(-3, 16)).toBe("1:01:00");
  });

  it("reads minutes, seconds and hundredths at the song's tempo", () => {
    expect(timeText(0, 120)).toBe("0:00:00");
    // At 120 BPM a beat is half a second.
    expect(timeText(PPQ, 120)).toBe("0:00:50");
    expect(timeText(PPQ * 2 * 75 + PPQ / 2, 120)).toBe("1:15:25");
    expect(timeText(PPQ * 140, 140)).toBe("1:00:00");
    expect(timeText(-1, 120)).toBe("0:00:00");
  });

  it("shows the tempo with three decimals, and splits what's drawn smaller off the end", () => {
    expect(tempoText(140)).toBe("140.000");
    expect(tempoText(92.5)).toBe("92.500");
    expect(splitTail(tempoText(172), ".")).toEqual(["172", ".000"]);
    expect(splitTail("1:01:00", ":")).toEqual(["1:01", ":00"]);
    expect(splitTail("12", ":")).toEqual(["12", ""]);
  });

  it("puts a press on the slider at the step under it, inside the pattern", () => {
    const pattern = STEP_TICKS * 16;
    expect(positionAt(0, pattern)).toBe(0);
    expect(positionAt(0.5, pattern)).toBe(STEP_TICKS * 8);
    expect(positionAt(1, pattern)).toBe(STEP_TICKS * 15);
    expect(positionAt(-1, pattern)).toBe(0);
  });
});
