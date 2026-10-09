import { describe, expect, it } from "vitest";
import type { ProjectSummary } from "@shared/types";
import { groupByWhen, searchProjects } from "./project-search";

const project = (id: string, name: string, updatedAt: number, missing = false): ProjectSummary => ({
  id,
  name,
  suite: "music",
  tempo: 120,
  createdAt: 0,
  updatedAt,
  openedAt: 0,
  path: `/Users/me/Documents/YTStudio/${name}.yt`,
  ...(missing && { missing: true as const }),
  duration: 0,
  thumbnail: null,
});

describe("the project search", () => {
  const projects = [project("a", "Summer beat", 1), project("b", "Beat tape", 2), project("c", "Old beat", 9, true), project("d", "Vocals", 3)];
  const ids = (query: string) => searchProjects(projects, query, () => "Music").map((p) => p.id);

  it("lists every project with nothing typed, the latest first, those that are missing last", () => {
    expect(ids("")).toEqual(["d", "b", "a", "c"]);
    // Opening one doesn't move it up: only an edit does.
    expect(searchProjects([project("a", "A", 1), { ...project("b", "B", 0), openedAt: 5 }], "").map((p) => p.id)).toEqual(["a", "b"]);
  });

  it("keeps the projects with every word typed, a name starting with them first, then a word of it", () => {
    expect(ids("beat")).toEqual(["b", "a", "c"]);
    expect(ids("beat sum")).toEqual(["a"]);
    expect(ids("BEAT")).toEqual(["b", "a", "c"]);
    expect(ids("eat")).toEqual(["b", "a", "c"]);
    expect(ids("nothing")).toEqual([]);
  });

  it("finds them by their suite's name too", () => {
    expect(ids("music voc")).toEqual(["d"]);
  });
});

describe("Home's sheet groups", () => {
  it("puts each project under the day it was last touched, latest group first, empty groups left out", () => {
    const now = new Date(2026, 9, 8, 13, 0).getTime();
    const at = (d: number, h = 12) => new Date(2026, 9, d, h).getTime();
    const projects = [project("a", "A", at(8, 9)), project("b", "B", at(7, 23)), project("c", "C", at(3)), project("d", "D", at(7, 1)), project("e", "E", at(1)), project("f", "F", new Date(2026, 6, 1).getTime())];
    expect(groupByWhen(projects, now).map((g) => [g.label, g.projects.map((p) => p.id)])).toEqual([
      ["Today", ["a"]],
      ["Yesterday", ["b", "d"]],
      ["This week", ["c"]],
      // A week ago is no longer this week.
      ["This month", ["e"]],
      ["Earlier", ["f"]],
    ]);
  });
});
