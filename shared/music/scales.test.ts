import { describe, expect, it } from "vitest";
import { inScale, isRoot, scaleName, snapToScale, stampPitches } from "./scales.ts";

const aMinor = { root: 9, type: "minor" as const };
const cMajor = { root: 0, type: "major" as const };

describe("scales", () => {
  it("know their notes, root and name", () => {
    expect([57, 59, 60, 61, 62].map((p) => inScale(aMinor, p))).toEqual([true, true, true, false, true]);
    expect(isRoot(aMinor, 69)).toBe(true);
    expect(isRoot(aMinor, 60)).toBe(false);
    expect(scaleName(aMinor)).toBe("A Minor (aeolian)");
  });

  it("snap a pitch to the nearest of their notes, the lower when two are as near", () => {
    expect(snapToScale(cMajor, 61)).toBe(60);
    expect(snapToScale(cMajor, 66)).toBe(65);
    expect(snapToScale(cMajor, 64)).toBe(64);
    expect(snapToScale({ root: 0, type: "minorPentatonic" }, 65)).toBe(65);
    expect(snapToScale({ root: 0, type: "minorPentatonic" }, 66)).toBe(65);
  });
});

describe("the Stamp", () => {
  it("places a chord from the note clicked, within MIDI's range", () => {
    expect(stampPitches("major", 60, null)).toEqual([60, 64, 67]);
    expect(stampPitches("minor7", 57, null)).toEqual([57, 60, 64, 67]);
    expect(stampPitches("dominant13", 120, null)).toEqual([120, 124, 127]);
  });

  it("stacks the song's scale from the scale note nearest the one clicked", () => {
    // In A minor: on C, C E G; on B, B D F (diminished); a seventh on A: A C E G.
    expect(stampPitches("scaleTriad", 60, aMinor)).toEqual([60, 64, 67]);
    expect(stampPitches("scaleTriad", 59, aMinor)).toEqual([59, 62, 65]);
    expect(stampPitches("scaleSeventh", 57, aMinor)).toEqual([57, 60, 64, 67]);
    // C# isn't in A minor: from C.
    expect(stampPitches("scaleTriad", 61, aMinor)).toEqual([60, 64, 67]);
    // No scale: the major scale on the note clicked.
    expect(stampPitches("scaleTriad", 62, null)).toEqual([62, 66, 69]);
  });
});
