import { describe, expect, it } from "vitest";
import { MAX_TEMPO, createMusicProject, normalizeMusicProject } from "./project.ts";

describe("music projects", () => {
  it("start at 120 BPM in 4/4", () => {
    expect(createMusicProject("Demo")).toEqual({ version: 1, name: "Demo", settings: { tempo: 120, timeSignature: [4, 4] } });
  });

  it("are repaired from anything", () => {
    expect(normalizeMusicProject(null)).toEqual(createMusicProject());
    expect(normalizeMusicProject({ name: "  Beat  ", settings: { tempo: 5000, timeSignature: [6, 8] }, extra: 1 })).toEqual({
      version: 1,
      name: "Beat",
      settings: { tempo: MAX_TEMPO, timeSignature: [6, 8] },
    });
    // A beat unit that isn't a note, or no beats: the default.
    expect(normalizeMusicProject({ settings: { tempo: 93.456, timeSignature: [3, 5] } }).settings).toEqual({ tempo: 93.46, timeSignature: [4, 4] });
    expect(normalizeMusicProject({ settings: { timeSignature: [0, 4] } }).settings.timeSignature).toEqual([4, 4]);
  });

  it("keep a valid song as it is", () => {
    const song = { version: 1 as const, name: "Song", settings: { tempo: 87.5, timeSignature: [7, 8] as [number, number] } };
    expect(normalizeMusicProject(song)).toEqual(song);
  });
});
