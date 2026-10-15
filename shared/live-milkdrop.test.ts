import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { MILKDROP_DIR, MILKDROP_LOOKS, MILKDROP_PRESETS, milkdropPreset } from "./live-milkdrop.ts";

describe("MilkDrop's presets", () => {
  it("are each a converted preset of butterchurn-presets', once", () => {
    const dir = path.resolve(import.meta.dirname, "../node_modules", MILKDROP_DIR);
    for (const p of MILKDROP_PRESETS) expect(fs.existsSync(path.join(dir, `${p.name}.json`)), `${p.title}: ${p.name}`).toBe(true);
    expect(new Set(MILKDROP_PRESETS.map((p) => p.name)).size).toBe(MILKDROP_PRESETS.length);
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
