import { describe, expect, it } from "vitest";
import { DEFAULT_ENVELOPE, FIRST_PATTERN_ID, MAX_TEMPO, createMusicProject, normalizeMusicProject, stepsPerBar } from "./project.ts";
import type { MusicProject } from "./types.ts";

const song: MusicProject = {
  version: 1,
  name: "Song",
  settings: { tempo: 87.5, timeSignature: [7, 8], swing: 0.25 },
  channels: [
    { id: "chan_kick", name: "Kick", kind: "sampler", sampleId: "media_1", volume: 0.78, pan: 0, pitch: 0, muted: false, envelope: DEFAULT_ENVELOPE },
    { id: "chan_hat", name: "Hat", kind: "sampler", sampleId: null, volume: 0.5, pan: -0.3, pitch: 12, muted: true, envelope: { ...DEFAULT_ENVELOPE, enabled: true } },
  ],
  patterns: [{ id: "pat_a", name: "Verse", steps: 14, notes: { chan_kick: [{ start: 0, length: 24, pitch: 60, velocity: 0.78 }] } }],
};

describe("music projects", () => {
  it("start at 120 BPM in 4/4, with an empty rack and one pattern a bar long", () => {
    expect(createMusicProject("Demo")).toEqual({
      version: 1,
      name: "Demo",
      settings: { tempo: 120, timeSignature: [4, 4], swing: 0 },
      channels: [],
      patterns: [{ id: FIRST_PATTERN_ID, name: "Pattern 1", steps: 16, notes: {} }],
    });
    expect(stepsPerBar([3, 4])).toBe(12);
    expect(stepsPerBar([6, 8])).toBe(12);
  });

  it("are repaired from anything", () => {
    expect(normalizeMusicProject(null)).toEqual(createMusicProject());
    const repaired = normalizeMusicProject({ name: "  Beat  ", settings: { tempo: 5000, timeSignature: [6, 8], swing: 3 }, extra: 1 });
    expect(repaired).toMatchObject({ name: "Beat", settings: { tempo: MAX_TEMPO, timeSignature: [6, 8], swing: 1 } });
    // A pattern is a bar of the song's time signature unless it says otherwise.
    expect(repaired.patterns[0].steps).toBe(12);
    // A beat unit that isn't a note, or no beats: the default.
    expect(normalizeMusicProject({ settings: { tempo: 93.456, timeSignature: [3, 5] } }).settings).toMatchObject({ tempo: 93.46, timeSignature: [4, 4] });
    expect(normalizeMusicProject({ settings: { timeSignature: [0, 4] } }).settings.timeSignature).toEqual([4, 4]);
  });

  it("upgrade a song from before there were channels", () => {
    const old = { version: 1, name: "Old", settings: { tempo: 100, timeSignature: [4, 4] } };
    expect(normalizeMusicProject(old)).toEqual({ ...createMusicProject("Old"), settings: { tempo: 100, timeSignature: [4, 4], swing: 0 } });
  });

  it("keep a valid song as it is", () => {
    expect(normalizeMusicProject(song)).toEqual(song);
  });

  it("drop what can't be: samples that aren't the project's, notes of no channel or past the end, duplicates", () => {
    const messy = {
      ...song,
      channels: [...song.channels, song.channels[0], { id: "bad id!" }, { id: "chan_new", volume: 9, pan: "left" }],
      patterns: [
        {
          id: "pat_a",
          steps: 4,
          notes: {
            chan_kick: [{ start: 48.2, velocity: 2 }, { start: 0 }, { start: 96 }, { start: -1 }, "x"],
            chan_gone: [{ start: 0 }],
            chan_hat: [],
          },
        },
        { id: "pat_a" },
      ],
    };
    const repaired = normalizeMusicProject(messy, (id) => id !== "media_1");
    expect(repaired.channels.map((c) => c.id)).toEqual(["chan_kick", "chan_hat", "chan_new"]);
    expect(repaired.channels[0].sampleId).toBeNull();
    expect(repaired.channels[2]).toMatchObject({ name: "Channel", volume: 1, pan: 0, envelope: DEFAULT_ENVELOPE });
    expect(repaired.patterns).toEqual([
      {
        id: "pat_a",
        name: "Pattern 1",
        steps: 4,
        notes: {
          chan_kick: [
            { start: 0, length: 24, pitch: 60, velocity: 0.78 },
            { start: 48, length: 24, pitch: 60, velocity: 1 },
          ],
        },
      },
    ]);
  });
});
