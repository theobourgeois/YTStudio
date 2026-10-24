import { describe, expect, it } from "vitest";
import { fuzzyMatch, rankItems, remember } from "./fuzzy";

describe("fuzzyMatch", () => {
  it("finds the query's characters in order, ignoring case and spaces", () => {
    expect(fuzzyMatch("pr", "Piano roll")?.indexes).toEqual([0, 6]);
    expect(fuzzyMatch("PIANO R", "Piano roll")?.indexes).toEqual([0, 1, 2, 3, 4, 6]);
    expect(fuzzyMatch("xyz", "Piano roll")).toBeNull();
    expect(fuzzyMatch("", "anything")).toEqual({ score: 0, indexes: [] });
  });

  it("scores a run over a spread, a word's start over its inside, early over late", () => {
    const score = (q: string, t: string) => fuzzyMatch(q, t)!.score;
    expect(score("roll", "Piano roll")).toBeGreaterThan(score("rl", "Piano roll"));
    expect(score("pr", "Piano roll")).toBeGreaterThan(score("pr", "Open recent"));
    expect(score("mix", "Mixer")).toBeGreaterThan(score("mix", "Remix stems"));
  });
});

describe("rankItems", () => {
  const items = [
    { id: "open-recent", title: "Open recent" },
    { id: "piano", title: "Piano roll", group: "Windows" },
    { id: "delete", title: "Remove notes", keywords: ["delete"] },
    { id: "mixer", title: "Mixer", group: "Windows" },
  ];

  it("puts the best match first and drops what doesn't match", () => {
    expect(rankItems(items, "pr").map((r) => r.item.id)).toEqual(["piano", "open-recent"]);
    expect(rankItems(items, "zzz")).toEqual([]);
  });

  it("matches a group and other words, without marking the title", () => {
    expect(rankItems(items, "windows mix")[0]).toEqual({ item: items[3], indexes: [] });
    expect(rankItems(items, "delete").map((r) => r.item.id)).toEqual(["delete"]);
  });

  it("puts a title that matches before a keyword that does", () => {
    const typing = { id: "typing", title: "Typing keyboard to piano", keywords: ["play notes"] };
    expect(rankItems([typing, ...items], "pno").map((r) => r.item.id)).toEqual(["piano", "typing"]);
  });

  it("with no query, lists the recent ones first, then the preferred, then the rest", () => {
    const ranked = rankItems(items, "", ["mixer", "delete"], (item) => item.id === "piano");
    expect(ranked.map((r) => r.item.id)).toEqual(["mixer", "delete", "piano", "open-recent"]);
  });
});

describe("remember", () => {
  it("moves an id to the front, once, keeping the list short", () => {
    expect(remember(["a", "b", "c"], "b")).toEqual(["b", "a", "c"]);
    expect(remember(["a", "b"], "c", 2)).toEqual(["c", "a"]);
  });
});
