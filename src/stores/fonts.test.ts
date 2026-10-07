import { describe, expect, it } from "vitest";
import { faceFromName, recentFamilies, withRecentFont } from "./fonts";

describe("font styles", () => {
  it("guesses the CSS face of a style from its name", () => {
    expect(faceFromName("Bold Italic")).toMatchObject({ weight: 700, italic: true, stretch: "normal" });
    expect(faceFromName("Semibold")).toMatchObject({ weight: 600 });
    expect(faceFromName("Condensed ExtraBold")).toMatchObject({ weight: 800, stretch: "condensed" });
    expect(faceFromName("Plain")).toMatchObject({ weight: 400, italic: false });
  });
});

describe("recent fonts", () => {
  it("puts the family used first, once, keeping ten", () => {
    expect(withRecentFont(["Arial", "Futura"], "futura")).toEqual(["futura", "Arial"]);
    const many = Array.from({ length: 10 }, (_, i) => `F${i}`);
    expect(withRecentFont(many, "New")).toEqual(["New", ...many.slice(0, 9)]);
  });

  it("shows only the recent families still installed, by their installed names", () => {
    const families = [{ family: "Arial", styles: [] }, { family: "Futura", styles: [] }];
    expect(recentFamilies(["futura", "Gone", "Arial"], families).map((f) => f.family)).toEqual(["Futura", "Arial"]);
  });
});
