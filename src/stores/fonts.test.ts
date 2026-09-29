import { describe, expect, it } from "vitest";
import { normalizeHex } from "@/components/properties/text-controls";
import { faceFromName } from "./fonts";

describe("font styles", () => {
  it("guesses the CSS face of a style from its name", () => {
    expect(faceFromName("Bold Italic")).toMatchObject({ weight: 700, italic: true, stretch: "normal" });
    expect(faceFromName("Semibold")).toMatchObject({ weight: 600 });
    expect(faceFromName("Condensed ExtraBold")).toMatchObject({ weight: 800, stretch: "condensed" });
    expect(faceFromName("Plain")).toMatchObject({ weight: 400, italic: false });
  });

  it("reads typed colours", () => {
    expect(normalizeHex("#ABC")).toBe("#aabbcc");
    expect(normalizeHex("12abEF")).toBe("#12abef");
    expect(normalizeHex("nope")).toBeNull();
  });
});
