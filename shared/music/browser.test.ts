import { describe, expect, it } from "vitest";
import {
  type BrowserItem,
  type SearchEntry,
  isAudioName,
  isInsideFolder,
  naturalCompare,
  searchEntries,
  searchEntry,
  sortItems,
  withinEdits,
  wordsOf,
} from "./browser.ts";

const file = (folder: string, name: string): SearchEntry =>
  searchEntry({ path: `/s/${folder}/${name}`, name, kind: "file" }, folder);

describe("isAudioName", () => {
  it("takes the formats the engine plays, in any case", () => {
    expect(["a.wav", "B.WAV", "c.aiff", "d.flac", "e.mp3", "f.ogg", "g.m4a"].every(isAudioName)).toBe(true);
    expect(["a.txt", "wav", ".wav", "a.wav.asd", "a.mid"].some(isAudioName)).toBe(false);
  });
});

describe("sortItems", () => {
  it("puts folders first, each in Finder's order", () => {
    const items: BrowserItem[] = [
      { path: "/k10", name: "Kick 10.wav", kind: "file" },
      { path: "/d", name: "drums", kind: "folder" },
      { path: "/k2", name: "kick 2.wav", kind: "file" },
      { path: "/b", name: "Bass", kind: "folder" },
    ];
    expect(sortItems(items).map((i) => i.name)).toEqual(["Bass", "drums", "kick 2.wav", "Kick 10.wav"]);
    expect(naturalCompare("a", "A")).not.toBe(0);
  });
});

describe("wordsOf", () => {
  it("splits at separators, camelCase and digits", () => {
    expect(wordsOf("KickHard_808-snare  Top")).toEqual(["kick", "hard", "808", "snare", "top"]);
    expect(wordsOf("kick808")).toEqual(["kick", "808"]);
    expect(wordsOf("Éclat (Vox)")).toEqual(["éclat", "vox"]);
  });
});

describe("withinEdits", () => {
  it("counts added, removed, changed and swapped letters", () => {
    expect(withinEdits("snare", "snare", 0)).toBe(true);
    expect(withinEdits("snre", "snare", 1)).toBe(true);
    expect(withinEdits("snarre", "snare", 1)).toBe(true);
    expect(withinEdits("snafe", "snare", 1)).toBe(true);
    expect(withinEdits("kcik", "kick", 1)).toBe(true);
    expect(withinEdits("kcik", "kick", 0)).toBe(false);
    expect(withinEdits("clap", "kick", 2)).toBe(false);
  });
});

describe("searchEntries", () => {
  const entries = [
    file("Drums/808 Kit", "Kick 3.wav"),
    file("Drums/808 Kit", "Snare 1.wav"),
    file("Drums/Acoustic", "Kick Room.wav"),
    file("Drums/Acoustic", "Kickback Loop.wav"),
    file("FX", "Sidekick Riser.wav"),
    file("Vocals", "Hey.wav"),
    searchEntry({ path: "/s/Drums/808 Kit", name: "808 Kit", kind: "folder" }, "Drums"),
  ];
  const names = (query: string, favourites?: Set<string>) =>
    searchEntries(entries, query, { favourites }).hits.map((h) => h.name);

  it("finds words in any order, in the name or its folder", () => {
    expect(names("kick 808")).toEqual(["Kick 3.wav"]);
    expect(names("808 kick")).toEqual(["Kick 3.wav"]);
    expect(names("acoustic")).toEqual(["Kick Room.wav", "Kickback Loop.wav"]);
  });

  it("puts whole words before the start of one, and that before the middle", () => {
    expect(names("kick")).toEqual(["Kick 3.wav", "Kick Room.wav", "Kickback Loop.wav", "Sidekick Riser.wav"]);
  });

  it("forgives typos in longer words", () => {
    expect(names("snre")).toEqual(["Snare 1.wav"]);
    expect(names("kcik room")).toEqual(["Kick Room.wav"]);
    // Short words must be typed right: "hy" would match too much.
    expect(names("hy")).toEqual([]);
  });

  it("finds folders too, and a name as typed", () => {
    expect(names("808 kit")[0]).toBe("808 Kit");
    expect(names("kickback")).toEqual(["Kickback Loop.wav"]);
  });

  it("ranks favourites first among equals", () => {
    expect(names("kick", new Set(["/s/Drums/Acoustic/Kick Room.wav"]))[0]).toBe("Kick Room.wav");
  });

  it("counts every match but returns the best", () => {
    const result = searchEntries(entries, "kick", { limit: 2 });
    expect(result.total).toBe(4);
    expect(result.hits).toHaveLength(2);
    expect(result.hits[0]).toEqual({ path: "/s/Drums/808 Kit/Kick 3.wav", name: "Kick 3.wav", kind: "file", folder: "Drums/808 Kit" });
    expect(searchEntries(entries, "  ").total).toBe(0);
  });

  it("is quick over a big library", () => {
    const kinds = ["Kick", "Snare", "Clap", "Hat", "Perc", "Tom", "Ride", "Crash", "Vox", "Bass"];
    const big: SearchEntry[] = [];
    for (let i = 0; i < 100_000; i++) {
      big.push(file(`Packs/Pack ${i % 300}/${kinds[i % 7]}s`, `${kinds[i % 10]} ${i} Hard.wav`));
    }
    const started = performance.now();
    for (const q of ["kick", "snre hard", "pack 12 vox", "zzzz"]) searchEntries(big, q);
    expect(performance.now() - started).toBeLessThan(1500);
  });
});

describe("isInsideFolder", () => {
  it("takes Windows' paths, either slash and any drive letter case", () => {
    expect(isInsideFolder("C:\\Samples\\Drums", "C:\\Samples")).toBe(true);
    expect(isInsideFolder("c:\\samples\\Drums\\Kicks", "C:\\Samples\\")).toBe(true);
    expect(isInsideFolder("C:/Samples/Drums", "C:\\Samples")).toBe(true);
    expect(isInsideFolder("C:\\Samples", "C:\\Samples")).toBe(true);
    expect(isInsideFolder("C:\\SamplesMore", "C:\\Samples")).toBe(false);
    expect(isInsideFolder("/Users/me/Samples/Drums", "/Users/me/Samples")).toBe(true);
    expect(isInsideFolder("/Users/me/samples", "/Users/me/Samples")).toBe(false);
  });
});
