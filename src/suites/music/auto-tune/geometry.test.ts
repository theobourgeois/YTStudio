import { describe, expect, it } from "vitest";
import { GRAPH_SECONDS, GRAPH_SPAN, KEYS_WIDTH, agoX, followCentre, meterFraction, noteAt, noteY, visibleNotes } from "./geometry";

const view = { width: 846, height: 190, centre: 60 };

describe("the pitch graph's maths", () => {
  it("places notes as rows, and finds the note at a y", () => {
    expect(noteY(view, 60)).toBe(95);
    expect(noteY(view, 61)).toBeCloseTo(95 - 190 / GRAPH_SPAN, 6);
    expect(noteAt(view, noteY(view, 64) + 3)).toBe(64);
    expect(visibleNotes(view)[0]).toBeLessThanOrEqual(60 - GRAPH_SPAN / 2);
    expect(visibleNotes(view).at(-1)).toBeGreaterThanOrEqual(60 + GRAPH_SPAN / 2);
  });

  it("places readings by how long ago they were", () => {
    expect(agoX(view, 0)).toBe(846);
    expect(agoX(view, GRAPH_SECONDS * 1000)).toBe(KEYS_WIDTH);
  });

  it("follows the voice, only when it nears the edge, and leaps to one far away", () => {
    expect(followCentre(60, 63, 16)).toBe(60);
    expect(followCentre(60, 68, 16)).toBeGreaterThan(60);
    expect(followCentre(60, 68, 16)).toBeLessThan(63);
    expect(followCentre(60, 96, 16)).toBe(96 - (GRAPH_SPAN / 2 - 4));
    expect(followCentre(60, null, 16)).toBe(60);
  });

  it("reads the meter in ±100 cents", () => {
    expect(meterFraction(-39)).toBeCloseTo(-0.39, 6);
    expect(meterFraction(250)).toBe(1);
  });
});
