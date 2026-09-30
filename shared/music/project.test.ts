import { describe, expect, it } from "vitest";
import { setSteps } from "./edits.ts";
import {
  DEFAULT_ENVELOPE,
  DEFAULT_PRECOMPUTED,
  FIRST_PATTERN_ID,
  MAX_TEMPO,
  createChannel,
  createMusicProject,
  createPluginChannel,
  normalizeMusicProject,
  patternSteps,
  stepsPerBar,
} from "./project.ts";
import type { MusicProject } from "./types.ts";

const song: MusicProject = {
  version: 1,
  name: "Song",
  settings: { tempo: 87.5, timeSignature: [7, 8], swing: 0.25 },
  channels: [
    { ...createChannel("Kick", "media_1", "chan_kick"), cutSelf: true, precomputed: { ...DEFAULT_PRECOMPUTED, reverse: true, start: 0.25, fadeOut: 0.5 } },
    { ...createChannel("Hat", null, "chan_hat"), volume: 0.5, pan: -0.3, pitch: 12, muted: true, envelope: { ...DEFAULT_ENVELOPE, enabled: true } },
  ],
  patterns: [
    { id: "pat_a", name: "Verse", length: 14, notes: { chan_kick: [{ start: 0, length: 24, pitch: 60, velocity: 0.78 }] } },
    { id: "pat_b", name: "Chorus", length: null, notes: {} },
  ],
};

describe("music projects", () => {
  it("start at 120 BPM in 4/4, with an empty rack and one pattern of automatic length", () => {
    expect(createMusicProject("Demo")).toEqual({
      version: 1,
      name: "Demo",
      settings: { tempo: 120, timeSignature: [4, 4], swing: 0 },
      channels: [],
      patterns: [{ id: FIRST_PATTERN_ID, name: "Pattern 1", length: null, notes: {} }],
    });
    expect(stepsPerBar([3, 4])).toBe(12);
    expect(stepsPerBar([6, 8])).toBe(12);
  });

  it("are repaired from anything", () => {
    expect(normalizeMusicProject(null)).toEqual(createMusicProject());
    const repaired = normalizeMusicProject({ name: "  Beat  ", settings: { tempo: 5000, timeSignature: [6, 8], swing: 3 }, extra: 1 });
    expect(repaired).toMatchObject({ name: "Beat", settings: { tempo: MAX_TEMPO, timeSignature: [6, 8], swing: 1 } });
    // A beat unit that isn't a note, or no beats: the default.
    expect(normalizeMusicProject({ settings: { tempo: 93.456, timeSignature: [3, 5] } }).settings).toMatchObject({ tempo: 93.46, timeSignature: [4, 4] });
    expect(normalizeMusicProject({ settings: { timeSignature: [0, 4] } }).settings.timeSignature).toEqual([4, 4]);
  });

  it("upgrade songs from before there were channels, and from before patterns had an automatic length", () => {
    const shell = { version: 1, name: "Old", settings: { tempo: 100, timeSignature: [4, 4] } };
    expect(normalizeMusicProject(shell)).toEqual({ ...createMusicProject("Old"), settings: { tempo: 100, timeSignature: [4, 4], swing: 0 } });
    const stepped = { ...createMusicProject("Old"), channels: [{ id: "chan_a", name: "A" }], patterns: [{ id: "pat_a", name: "A", steps: 32, notes: {} }] };
    const upgraded = normalizeMusicProject(stepped);
    expect(upgraded.patterns[0].length).toBeNull();
    expect(upgraded.channels[0]).toMatchObject({ cutSelf: false, precomputed: DEFAULT_PRECOMPUTED });
  });

  it("keep a valid song as it is", () => {
    expect(normalizeMusicProject(song)).toEqual(song);
  });

  it("have plugin channels: an instrument plugin, by the engine's id for it", () => {
    const synth = createPluginChannel({ id: "VST3-Serum 2-abc-123", name: "Serum 2", format: "VST3" }, "chan_synth");
    expect(synth).toMatchObject({ kind: "plugin", name: "Serum 2", sampleId: null, volume: 0.78 });
    const withSynth = { ...song, channels: [...song.channels, synth] };
    expect(normalizeMusicProject(withSynth)).toEqual(withSynth);
    // A plugin channel without its plugin is a sampler; a sampler has no plugin.
    const broken = normalizeMusicProject({ ...song, channels: [{ id: "chan_x", kind: "plugin" }, { id: "chan_y", kind: "sampler", plugin: synth.plugin }] });
    expect(broken.channels.map((c) => [c.kind, c.plugin])).toEqual([
      ["sampler", null],
      ["sampler", null],
    ]);
  });

  it("drop what can't be: samples that aren't the project's, notes of no channel or past the limit, duplicates", () => {
    const messy = {
      ...song,
      channels: [...song.channels, song.channels[0], { id: "bad id!" }, { id: "chan_new", volume: 9, pan: "left", precomputed: { start: 5, length: 0, normalize: "yes" } }],
      patterns: [
        {
          id: "pat_a",
          length: 9000,
          notes: {
            chan_kick: [{ start: 48.2, velocity: 2 }, { start: 0 }, { start: 512 * 24 }, { start: -1 }, "x"],
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
    expect(repaired.channels[2].precomputed).toEqual({ ...DEFAULT_PRECOMPUTED, start: 0.99, length: 0.01 });
    expect(repaired.patterns).toEqual([
      {
        id: "pat_a",
        name: "Pattern 1",
        length: 512,
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

describe("a pattern's length", () => {
  const empty = { ...createMusicProject(), channels: [createChannel("Kick", null, "chan_kick")] };
  const steps = (s: MusicProject) => patternSteps(s.patterns[0], s.settings.timeSignature);

  it("is automatic by default: up to the end of the last bar with a note, and a bar at least", () => {
    expect(steps(empty)).toBe(16);
    expect(steps(setSteps(empty, FIRST_PATTERN_ID, "chan_kick", [15], true))).toBe(16);
    expect(steps(setSteps(empty, FIRST_PATTERN_ID, "chan_kick", [16], true))).toBe(32);
    expect(steps(setSteps(empty, FIRST_PATTERN_ID, "chan_kick", [0, 40], true))).toBe(48);
    // A bar of 3/4 is 12 steps.
    const waltz = { ...empty, settings: { ...empty.settings, timeSignature: [3, 4] as [number, number] } };
    expect(steps(setSteps(waltz, FIRST_PATTERN_ID, "chan_kick", [12], true))).toBe(24);
  });

  it("is what it's set to otherwise, whatever the notes", () => {
    const set = { ...empty, patterns: [{ ...empty.patterns[0], length: 20 }] };
    expect(steps(setSteps(set, FIRST_PATTERN_ID, "chan_kick", [40], true))).toBe(20);
  });
});
