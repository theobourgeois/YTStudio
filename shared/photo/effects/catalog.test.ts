import { describe, expect, it } from "vitest";
import { describePresets, effectPreset, entryParams, FILTER_ENTRIES, filterCategories, filterEntry, searchFilters } from "./catalog.ts";
import { FILTERS, GENERATORS, effectDefinition, validateParams } from "./index.ts";

describe("the filter catalogue", () => {
  it("lists every filter's and generator's presets by category, filters first, each key once", () => {
    const keys = FILTER_ENTRIES.map((e) => e.key);
    expect(new Set(keys).size).toBe(keys.length);
    // Light's glows and flares in order (its kernel filters, as Light Leak, come between them: filters first).
    expect(keys.filter((k) => FILTER_ENTRIES.find((e) => e.key === k)!.def.category === "Light" && /^(glow|lens-flare)\//.test(k)).slice(0, 8)).toEqual([
      "glow/bloom",
      "glow/soft-haze",
      "glow/neon",
      "glow/dreamy",
      "glow/halation",
      "lens-flare/classic",
      "lens-flare/anamorphic",
      "lens-flare/subtle",
    ]);
    // Every filter and generator is listed: a new one without a category or presets would be found nowhere.
    for (const def of [...FILTERS, ...GENERATORS]) expect(FILTER_ENTRIES.some((e) => e.def === def), def.type).toBe(true);
    // By category, in their order; within one, filters before generators.
    const order = filterCategories();
    expect(order[0]).toBe("Colour");
    expect(order).toContain("Light");
    const ranks = FILTER_ENTRIES.map((e) => order.indexOf(e.def.category) * 2 + (e.def.kind === "generator" ? 1 : 0));
    expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
  });

  it("gives every preset parameters its definition accepts as they are, on any canvas", () => {
    for (const canvas of [{ width: 64, height: 64 }, { width: 1280, height: 720 }, { width: 8000, height: 6000 }]) {
      for (const entry of FILTER_ENTRIES) {
        const params = entryParams(entry, canvas);
        expect(validateParams(entry.def, params).problems, `${entry.key} on ${canvas.width}×${canvas.height}`).toEqual([]);
      }
    }
  });

  it("scales a glow's radius with the canvas, so a look is the same on any size", () => {
    const glow = filterEntry("glow/bloom")!;
    expect(entryParams(glow, { width: 1280, height: 720 }).radius).toBe(Math.round(0.04 * Math.hypot(1280, 720)));
    expect(entryParams(glow, { width: 2560, height: 1440 }).radius).toBe(Math.round(0.04 * Math.hypot(2560, 1440)));
    expect(entryParams(filterEntry("glow/soft-haze")!, { width: 20000, height: 20000 }).radius).toBe(4000);
  });

  it("searches every word in names, looks and descriptions, within a category", () => {
    expect(searchFilters("").length).toBe(FILTER_ENTRIES.length);
    expect(searchFilters("streak").map((e) => e.key)).toEqual(["lens-flare/anamorphic"]);
    expect(searchFilters("GLOW film").map((e) => e.key)).toEqual(["glow/halation"]);
    expect(searchFilters("flare", "Light").every((e) => e.def.type === "lens-flare")).toBe(true);
    expect(searchFilters("nothing like this")).toEqual([]);
  });

  it("finds presets by id and describes them for the model", () => {
    expect(effectPreset(effectDefinition("glow")!, "dreamy")?.label).toBe("Dreamy");
    expect(effectPreset(effectDefinition("glow")!, "classic")).toBeUndefined();
    expect(describePresets("filter")).toMatch(/^glow presets: bloom \(Bloom: .*\); soft-haze/m);
    expect(describePresets("generator")).toMatch(/^lens-flare presets: classic/);
  });
});
