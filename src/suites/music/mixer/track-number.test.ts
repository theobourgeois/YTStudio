import { describe, expect, it } from "vitest";
import { parseTrackNumber } from "./track-number";

describe("a mixer track's number typed in", () => {
  it("is the master as 0, M, master or ---, an insert by its number, and nothing past the last", () => {
    expect(["0", "M", "master", "---"].map((t) => parseTrackNumber(t, 17))).toEqual([0, 0, 0, 0]);
    expect(parseTrackNumber(" 12 ", 17)).toBe(12);
    expect(parseTrackNumber("17", 17)).toBeNull();
    expect(parseTrackNumber("drums", 17)).toBeNull();
  });
});
