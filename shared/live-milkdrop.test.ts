import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import { MILKDROP_LOOKS, MILKDROP_PACKS, MILKDROP_PRESETS, milkdropPreset } from "./live-milkdrop.ts";

const require = createRequire(import.meta.url);

describe("MilkDrop's presets", () => {
  it("are each in the pack it says, once", () => {
    const packs = Object.fromEntries(
      MILKDROP_PACKS.map((pack) => {
        const m = require(`butterchurn-presets/lib/${pack}.min.js`) as { default?: { getPresets(): object }; getPresets?(): object };
        return [pack, (m.getPresets ? m : m.default!).getPresets!() as Record<string, unknown>];
      }),
    );
    for (const p of MILKDROP_PRESETS) expect(packs[p.pack][p.name], `${p.title}: ${p.name} in ${p.pack}`).toBeDefined();
    expect(new Set(MILKDROP_PRESETS.map((p) => p.id)).size).toBe(MILKDROP_PRESETS.length);
    expect(new Set(MILKDROP_PRESETS.map((p) => p.title)).size).toBe(MILKDROP_PRESETS.length);
  });

  it("are looks of their own, each drawing its preset", () => {
    expect(MILKDROP_LOOKS).toHaveLength(MILKDROP_PRESETS.length);
    for (const look of MILKDROP_LOOKS) {
      expect(look.kind).toBe("milkdrop");
      expect(milkdropPreset(look.id)?.title).toBe(look.name);
    }
    expect(milkdropPreset("nebula")).toBeNull();
    // Some for every kind of song, some that flow (slow songs), some minimal (a song's start).
    for (const c of ["chill", "groove", "hype", "heavy"] as const) expect(MILKDROP_PRESETS.filter((p) => p.suits.characters.includes(c)).length, c).toBeGreaterThanOrEqual(10);
    expect(MILKDROP_PRESETS.filter((p) => p.suits.flows).length).toBeGreaterThanOrEqual(20);
    expect(MILKDROP_PRESETS.filter((p) => p.suits.minimal).length).toBeGreaterThanOrEqual(4);
  });
});
