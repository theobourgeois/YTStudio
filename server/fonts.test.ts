import { describe, expect, it } from "vitest";
import { appKitWeightToCss, tidy } from "./fonts.ts";

describe("fonts", () => {
  it("maps AppKit weights to the CSS weights Chrome asks for", () => {
    expect([2, 3, 4, 5, 6, 8, 9, 10, 12].map(appKitWeightToCss)).toEqual([100, 200, 300, 400, 500, 600, 700, 800, 900]);
  });

  it("sorts families and styles, dropping hidden families and styles CSS can't tell apart", () => {
    const face = (name: string, weight: number, italic = false, stretch = "normal") => ({ name, weight, italic, stretch });
    const out = tidy([
      { family: "zeta", styles: [face("Bold", 700), face("Regular", 400), face("Roman", 400), face("Italic", 400, true)] },
      { family: ".Hidden", styles: [face("Regular", 400)] },
      { family: "Alpha", styles: [face("Condensed", 400, false, "condensed"), face("Regular", 400)] },
    ]);
    expect(out.map((f) => f.family)).toEqual(["Alpha", "zeta"]);
    expect(out[0].styles.map((s) => s.name)).toEqual(["Regular", "Condensed"]);
    expect(out[1].styles.map((s) => s.name)).toEqual(["Regular", "Italic", "Bold"]);
  });
});
