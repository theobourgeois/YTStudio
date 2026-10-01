import { describe, expect, it } from "vitest";
import { inputChoices, inputKey, inputLabel } from "./inputs";

describe("the Input menu", () => {
  it("lists the device's pairs, then each input alone, as FL Studio does", () => {
    expect(inputChoices(["In 1", "In 2", "In 3"]).map((c) => [inputKey(c.input), c.label])).toEqual([
      ["s0", "In 1 - In 2"],
      ["m0", "In 1"],
      ["m1", "In 2"],
      ["m2", "In 3"],
    ]);
    expect(inputChoices(["Mic"])).toEqual([{ input: { channel: 0, stereo: false }, label: "Mic" }]);
    expect(inputChoices([])).toEqual([]);
  });

  it("names a track's input by the device's names, or by number when it hasn't got it", () => {
    expect(inputLabel({ channel: 0, stereo: true }, ["L", "R"])).toBe("L - R");
    expect(inputLabel({ channel: 3, stereo: false }, ["Mic"])).toBe("Input 4");
    expect(inputKey(null)).toBe("none");
  });
});
