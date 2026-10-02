import { describe, expect, it } from "vitest";
import type { ProjectSummary } from "@shared/types";
import { searchProjects } from "./project-search";

const project = (id: string, name: string, updatedAt: number, settled = false): ProjectSummary => ({
  id,
  name,
  suite: "music",
  tempo: 120,
  status: settled ? "settled" : "active",
  createdAt: 0,
  updatedAt,
  settledAt: settled ? updatedAt : null,
  duration: 0,
  thumbnail: null,
});

describe("⌘P's project search", () => {
  const projects = [project("a", "Summer beat", 1), project("b", "Beat tape", 2), project("c", "Old beat", 9, true), project("d", "Vocals", 3)];
  const ids = (query: string) => searchProjects(projects, query, () => "Music").map((p) => p.id);

  it("lists every project with nothing typed, those in progress first, the latest first", () => {
    expect(ids("")).toEqual(["d", "b", "a", "c"]);
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
