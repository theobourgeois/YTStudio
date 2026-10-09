import { describe, expect, it } from "vitest";
import { type SerumPresetEntry, findSerumPresets, serumCategory, serumFolders, stepSerumPreset, randomSerumPreset } from "./serum-presets.ts";

const preset = (name: string, more: Partial<SerumPresetEntry> = {}): SerumPresetEntry => ({
  path: `/presets/${more.folder ?? ""}/${name}.SerumPreset`,
  name,
  author: "",
  description: "",
  tags: [],
  category: serumCategory(name, null, more.folder ?? ""),
  folder: "",
  kind: "serum2",
  hash: name,
  rating: 0,
  ...more,
});

describe("Serum preset categories", () => {
  it("takes Serum's own first, then the name's words, then the folder", () => {
    expect(serumCategory("Anything", "Keyboard", "")).toBe("Keys");
    expect(serumCategory("Anything", "Elec.Piano", "")).toBe("Keys");
    expect(serumCategory("MO_SHINJU_LD_Wex", null, "")).toBe("Lead");
    expect(serumCategory("pl - good", "", "")).toBe("Pluck");
    expect(serumCategory("[PS] pad [sense]", null, "")).toBe("Pad");
    expect(serumCategory("BA 8bitfwap [GI]", null, "")).toBe("Bass");
    expect(serumCategory("BassReese - Porta Potty", null, "")).toBe("Bass");
    expect(serumCategory("banjo lol", null, "Factory/Pad")).toBe("Pad");
    expect(serumCategory("banjo lol", null, "Bass (Hard)")).toBe("Bass");
    expect(serumCategory("WIND - Flute", null, "Factory/Woodwind")).toBe("Orchestral");
    expect(serumCategory("HIT - Nova Surge", null, "Factory/Hit")).toBe("FX");
    expect(serumCategory("eselbass", null, "Serum Starred Presets")).toBe("Bass");
    expect(serumCategory("jumpkey2", null, "Serum Starred Presets")).toBe("Keys");
    expect(serumCategory("banjo lol", null, "")).toBe("Other");
  });
});

describe("finding Serum presets", () => {
  const list = [
    preset("MO_SHINJU_LD_Wex", { author: "@shinju_09", rating: 4, folder: "Serum Starred Presets", kind: "serum1" }),
    preset("MO_SHINJU_LD_Walker", { author: "@shinju_09", folder: "Serum Starred Presets", kind: "serum1" }),
    preset("KY - Dream Keys", { category: "Keys", folder: "Factory/Keyboard", rating: 4, tags: ["Poly", "Sample"] }),
    preset("PD - Pacific Rain", { category: "Pad", folder: "Factory/Pad", tags: ["Granular"], author: "Steve Duda" }),
    preset("BA - Sputnikv2", { category: "Bass", folder: "Serum Starred Presets" }),
  ];

  it("lists them by name without a query, narrowed by the filters", () => {
    expect(findSerumPresets(list, "").map((p) => p.name)).toEqual(["BA - Sputnikv2", "KY - Dream Keys", "MO_SHINJU_LD_Walker", "MO_SHINJU_LD_Wex", "PD - Pacific Rain"]);
    expect(findSerumPresets(list, "", { favourites: true }).map((p) => p.name)).toEqual(["KY - Dream Keys", "MO_SHINJU_LD_Wex"]);
    expect(findSerumPresets(list, "", { category: "Lead" }).map((p) => p.name)).toEqual(["MO_SHINJU_LD_Walker", "MO_SHINJU_LD_Wex"]);
    expect(findSerumPresets(list, "", { kind: "serum2", folder: "Factory" }).map((p) => p.name)).toEqual(["KY - Dream Keys", "PD - Pacific Rain"]);
  });

  it("searches names first, then authors, folders, categories and tags, with a typo", () => {
    expect(findSerumPresets(list, "wex").map((p) => p.name)).toEqual(["MO_SHINJU_LD_Wex"]);
    // The rated one first among equals.
    expect(findSerumPresets(list, "shinju").map((p) => p.name)).toEqual(["MO_SHINJU_LD_Wex", "MO_SHINJU_LD_Walker"]);
    expect(findSerumPresets(list, "duda").map((p) => p.name)).toEqual(["PD - Pacific Rain"]);
    expect(findSerumPresets(list, "granular").map((p) => p.name)).toEqual(["PD - Pacific Rain"]);
    expect(findSerumPresets(list, "keys poly").map((p) => p.name)).toEqual(["KY - Dream Keys"]);
    expect(findSerumPresets(list, "sputnik").map((p) => p.name)).toEqual(["BA - Sputnikv2"]);
    expect(findSerumPresets(list, "pacfic").map((p) => p.name)).toEqual(["PD - Pacific Rain"]);
    expect(findSerumPresets(list, "nothing like it")).toEqual([]);
  });

  it("steps through the list and stops at its ends", () => {
    const shown = findSerumPresets(list, "");
    expect(stepSerumPreset(shown, null, 1)?.name).toBe("BA - Sputnikv2");
    expect(stepSerumPreset(shown, null, -1)?.name).toBe("PD - Pacific Rain");
    expect(stepSerumPreset(shown, shown[1].path, 1)?.name).toBe("MO_SHINJU_LD_Walker");
    expect(stepSerumPreset(shown, shown[4].path, 1)?.name).toBe("PD - Pacific Rain");
    expect(stepSerumPreset(shown, shown[0].path, -1)?.name).toBe("BA - Sputnikv2");
    expect(stepSerumPreset([], null, 1)).toBeNull();
  });

  it("lists the folders once each", () => {
    expect(serumFolders(list)).toEqual(["Factory/Keyboard", "Factory/Pad", "Serum Starred Presets"]);
  });
});

describe("a random preset", () => {
  const entry = (path: string) => ({ path, name: path, author: "", description: "", tags: [], category: "Lead" as const, folder: "", kind: "serum2" as const, hash: path, rating: 0 });
  const list = ["a", "b", "c"].map(entry);

  it("comes from the list, never the one playing while there's another", () => {
    expect(randomSerumPreset(list, "a", () => 0)?.path).toBe("b");
    expect(randomSerumPreset(list, "a", () => 0.99)?.path).toBe("c");
    expect(randomSerumPreset(list, null, () => 0.5)?.path).toBe("b");
    expect(randomSerumPreset([entry("a")], "a")?.path).toBe("a");
    expect(randomSerumPreset([], null)).toBeNull();
  });
});

