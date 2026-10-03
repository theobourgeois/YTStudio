import { describe, expect, it } from "vitest";
import { setSteps } from "./edits.ts";
import {
  DEFAULT_ENVELOPE,
  DEFAULT_PLAYLIST_TRACK,
  DEFAULT_PRECOMPUTED,
  DEFAULT_VOLUME,
  FIRST_CHANNEL_ID,
  FIRST_PATTERN_ID,
  MASTER_TRACK_ID,
  MAX_INSERTS,
  MAX_TEMPO,
  createAudioChannel,
  createChannel,
  createMixer,
  createMixerTrack,
  createMusicProject,
  createPluginChannel,
  normalizeMusicProject,
  patternSteps,
  stepsPerBar,
  withSongOptions,
} from "./project.ts";
import type { MusicProject } from "./types.ts";

const song: MusicProject = {
  version: 1,
  name: "Song",
  settings: { tempo: 87.5, timeSignature: [7, 8], swing: 0.25, volume: 0.6 },
  channels: [
    { ...createChannel("Kick", "media_1", "chan_kick"), cutSelf: true, precomputed: { ...DEFAULT_PRECOMPUTED, reverse: true, start: 0.25, fadeOut: 0.5 } },
    {
      ...createChannel("Hat", null, "chan_hat"),
      volume: 0.5,
      pan: -0.3,
      pitch: 12,
      muted: true,
      envelope: { ...DEFAULT_ENVELOPE, enabled: true },
      mixerTrack: "insert_drums",
    },
  ],
  patterns: [
    { id: "pat_a", name: "Verse", length: 14, notes: { chan_kick: [{ id: 3, start: 0, length: 24, pitch: 60, velocity: 0.78, pan: -0.5, muted: true }] }, color: null },
    { id: "pat_b", name: "Chorus", length: null, notes: {}, color: null },
  ],
  playlist: {
    tracks: [DEFAULT_PLAYLIST_TRACK, { name: "Drums", color: "#4a89dc", size: 1.5, muted: true, mixerTrack: null }],
    clips: [
      { id: 1, kind: "pattern", ref: "pat_a", track: 0, start: 0, length: null, offset: 0, muted: false },
      { id: 4, kind: "pattern", ref: "pat_b", track: 1, start: 384, length: 192, offset: 24, muted: true },
      { id: 5, kind: "automation", ref: "auto_cut", track: 2, start: 384, length: null, offset: 96, muted: false },
    ],
  },
  mixer: {
    tracks: [
      { ...createMixerTrack(MASTER_TRACK_ID), dock: "left", sends: [] },
      {
        ...createMixerTrack("insert_drums"),
        name: "Drums",
        color: "#4a89dc",
        dock: "right",
        volume: 0.6,
        latencyOffset: -12.5,
        invert: true,
        stereo: -0.5,
        pan: 0.25,
        effects: [{ id: "fx_eq", plugin: { id: "VST3-Pro-Q 4", name: "Pro-Q 4", format: "VST3" }, enabled: false, mix: 0.5 }, ...Array(9).fill(null)],
        sends: [
          { to: "insert_verb", level: 0.3 },
          { to: MASTER_TRACK_ID, level: 1 },
        ],
      },
      { ...createMixerTrack("insert_verb"), muted: true, separator: true, group: "group_fx", sends: [] },
    ],
    groups: [{ id: "group_fx", name: "FX" }],
  },
  automations: [
    {
      id: "auto_cut",
      name: "Cutoff (Serum 2)",
      color: "#8a4a9e",
      target: { kind: "plugin", owner: "effect", id: "fx_eq", param: "1029", index: 12, name: "Cutoff" },
      length: 768,
      points: [
        { tick: 0, value: 0.25, tension: 0, curve: "single" },
        { tick: 384, value: 1, tension: -0.5, curve: "double" },
        { tick: 384, value: 0, tension: 0, curve: "hold" },
        { tick: 768, value: 0.5, tension: 0.75, curve: "stairs" },
      ],
      min: 0.1,
      max: 0.9,
      lfo: { enabled: true, speed: 4, tension: 0.5, skew: 0.25, level: -0.5, multiply: true },
    },
  ],
  modulators: [
    {
      id: "mod_kick",
      name: null,
      source: { kind: "track", track: "insert_verb", tap: "postFader" },
      attack: 0.001,
      release: 0.25,
      gain: 6,
      tension: -0.5,
      links: [
        { target: { kind: "mixer", track: MASTER_TRACK_ID, control: "volume" }, amount: -0.5 },
        { target: { kind: "plugin", owner: "effect", id: "fx_eq", param: "1029", index: 12, name: "Cutoff" }, amount: 0.25 },
      ],
    },
    { id: "mod_notes", name: "Pump", source: { kind: "notes", channel: "chan_kick" }, attack: 0, release: 0.1, gain: 0, tension: 0, links: [] },
  ],
};

describe("music projects", () => {
  it("start at 140 BPM in 4/4, with a sampler in the rack and one pattern of automatic length", () => {
    expect(createMusicProject("Demo")).toEqual({
      version: 1,
      name: "Demo",
      settings: { tempo: 140, timeSignature: [4, 4], swing: 0, volume: DEFAULT_VOLUME },
      channels: [expect.objectContaining({ id: FIRST_CHANNEL_ID, name: "Sampler", kind: "sampler", sampleId: null })],
      patterns: [{ id: FIRST_PATTERN_ID, name: "Pattern 1", length: null, notes: {}, color: null }],
      playlist: { tracks: [], clips: [] },
      mixer: createMixer(),
      automations: [],
      modulators: [],
    });
    expect(stepsPerBar([3, 4])).toBe(12);
    expect(stepsPerBar([6, 8])).toBe(12);
  });

  it("take the tempo set as the default, if it's one a song can have", () => {
    const song = createMusicProject("Demo");
    expect(withSongOptions(song, { tempo: 92.505 }).settings.tempo).toBe(92.51);
    expect(withSongOptions(song, { tempo: 140 })).toBe(song);
    expect(withSongOptions(song, { tempo: MAX_TEMPO + 1 })).toBe(song);
    expect(withSongOptions(song, { tempo: "fast" })).toBe(song);
    expect(withSongOptions(song, null)).toBe(song);
  });

  it("are repaired from anything", () => {
    expect(normalizeMusicProject(null)).toEqual(createMusicProject());
    const repaired = normalizeMusicProject({ name: "  Beat  ", settings: { tempo: 5000, timeSignature: [6, 8], swing: 3, volume: 4 }, extra: 1 });
    expect(repaired).toMatchObject({ name: "Beat", settings: { tempo: MAX_TEMPO, timeSignature: [6, 8], swing: 1, volume: 1 } });
    // A beat unit that isn't a note, or no beats: the default.
    expect(normalizeMusicProject({ settings: { tempo: 93.456, timeSignature: [3, 5] } }).settings).toMatchObject({ tempo: 93.46, timeSignature: [4, 4] });
    expect(normalizeMusicProject({ settings: { timeSignature: [0, 4] } }).settings.timeSignature).toEqual([4, 4]);
  });

  it("upgrade songs from before there were channels, and from before patterns had an automatic length", () => {
    const shell = { version: 1, name: "Old", settings: { tempo: 100, timeSignature: [4, 4] } };
    expect(normalizeMusicProject(shell)).toEqual({ ...createMusicProject("Old"), settings: { tempo: 100, timeSignature: [4, 4], swing: 0, volume: DEFAULT_VOLUME } });
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
            chan_kick: [{ start: 48.2, velocity: 2 }, { start: 0 }, { start: 1000 * 384 }, { start: -1 }, "x"],
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
          // Notes without an id are given the next ones, in the order they were in.
          chan_kick: [
            { id: 2, start: 0, length: 24, pitch: 60, velocity: 0.78, pan: 0, muted: false },
            { id: 1, start: 48, length: 24, pitch: 60, velocity: 1, pan: 0, muted: false },
          ],
        },
        color: null,
      },
    ]);
  });
});

describe("the mixer", () => {
  it("starts as FL Studio's templates do: the master and 16 inserts at 0 dB, sending to the master, every channel on the master", () => {
    const { mixer, channels } = createMusicProject();
    expect(mixer.tracks.map((t) => t.id)).toEqual([MASTER_TRACK_ID, ...Array.from({ length: 16 }, (_, i) => `insert_${i + 1}`)]);
    expect(mixer.tracks[0].sends).toEqual([]);
    expect(mixer.tracks[3]).toEqual({ id: "insert_3", name: null, color: null, dock: "middle", separator: false, group: null, volume: 0.8, pan: 0, muted: false, solo: false, soloSafe: false, invert: false, swap: false, stereo: 0, latencyOffset: 0, input: null, monitor: "armed", inputOffset: 0, effects: Array(10).fill(null), sends: [{ to: MASTER_TRACK_ID, level: 1 }] });
    expect(channels[0].mixerTrack).toBe(MASTER_TRACK_ID);
  });

  it("is given to songs from before it, their channels on the master", () => {
    const old = normalizeMusicProject({ ...song, mixer: undefined, channels: song.channels.map(({ mixerTrack: _, ...c }) => c) });
    expect(old.mixer).toEqual(createMixer());
    expect(old.channels.map((c) => c.mixerTrack)).toEqual([MASTER_TRACK_ID, MASTER_TRACK_ID]);
  });

  it("is repaired: the master first, unknown sends and routing dropped, ten slots, limits kept", () => {
    const repaired = normalizeMusicProject({
      ...song,
      channels: [{ ...song.channels[0], mixerTrack: "insert_gone" }],
      mixer: {
        tracks: [
          { id: "insert_a", name: "  ", volume: 4, latencyOffset: 5000, effects: [null, { id: "fx_1", plugin: { id: "p", name: "P" } }, { id: "fx_1", plugin: { id: "q" } }, { id: "fx_2" }], sends: [{ to: "insert_gone" }, { to: MASTER_TRACK_ID, level: 7 }, { to: MASTER_TRACK_ID }] },
          { id: MASTER_TRACK_ID, dock: "right", sends: [{ to: "insert_a" }] },
          { id: "insert_a" },
          { id: "insert_b", color: "red" },
        ],
      },
    });
    expect(repaired.channels[0].mixerTrack).toBe(MASTER_TRACK_ID);
    const [master, a, b] = repaired.mixer.tracks;
    expect([master.id, a.id, b.id]).toEqual([MASTER_TRACK_ID, "insert_a", "insert_b"]);
    expect(master).toMatchObject({ sends: [], dock: "left" });
    expect(b.dock).toBe("middle");
    expect(a).toMatchObject({ name: null, volume: 1, latencyOffset: 1000, sends: [{ to: MASTER_TRACK_ID, level: 1 }] });
    expect(a.effects).toEqual([null, { id: "fx_1", plugin: { id: "p", name: "P", format: "VST3" }, enabled: true, mix: 1 }, ...Array(8).fill(null)]);
    // A track with no list of sends goes to the master; one with an empty list goes nowhere.
    expect(b.sends).toEqual([{ to: MASTER_TRACK_ID, level: 1 }]);
    expect(b.color).toBeNull();
    // A group no track is in goes; a track in a group that isn't there is in none.
    const grouped = normalizeMusicProject({ mixer: { tracks: [{ id: "a", group: "g1" }, { id: "b", group: "g9" }], groups: [{ id: "g1", name: "Drums" }, { id: "g2", name: "Empty" }] } });
    expect(grouped.mixer.groups).toEqual([{ id: "g1", name: "Drums" }]);
    expect(grouped.mixer.tracks.map((t) => t.group)).toEqual([null, "g1", null]);
    const many = normalizeMusicProject({ mixer: { tracks: Array.from({ length: 600 }, (_, i) => ({ id: `t_${i}` })) } });
    expect(many.mixer.tracks).toHaveLength(MAX_INSERTS + 1);
  });

  it("keeps each insert's input (a device input, or a pair), its monitoring and input offset; never the master's", () => {
    const repaired = normalizeMusicProject({
      mixer: {
        tracks: [
          { id: MASTER_TRACK_ID, input: { channel: 0, stereo: false } },
          { id: "vox", input: { channel: 2, stereo: false }, monitor: "on", inputOffset: 12.345 },
          { id: "gtr", input: { channel: 62, stereo: true }, monitor: "loud", inputOffset: -9000 },
          { id: "bad", input: { channel: 63, stereo: true } },
          { id: "odd", input: { channel: 1.5 } },
        ],
      },
      playlist: { tracks: [{ mixerTrack: "vox" }, { mixerTrack: MASTER_TRACK_ID, name: "Master?" }, { mixerTrack: "gone" }], clips: [] },
    });
    const [master, vox, gtr, bad, odd] = repaired.mixer.tracks;
    expect(master.input).toBeNull();
    expect(vox).toMatchObject({ input: { channel: 2, stereo: false }, monitor: "on", inputOffset: 12.35 });
    expect(gtr).toMatchObject({ input: { channel: 62, stereo: true }, monitor: "armed", inputOffset: -1000 });
    expect([bad.input, odd.input]).toEqual([null, null]);
    // A playlist track linked to an insert (FL's audio track); never to the master or a track that's gone.
    expect(repaired.playlist.tracks.map((t) => t.mixerTrack)).toEqual(["vox", null]);
  });

  it("never sends round in a loop: the send that would close one is dropped", () => {
    const repaired = normalizeMusicProject({
      mixer: {
        tracks: [
          { id: MASTER_TRACK_ID },
          { id: "a", sends: [{ to: "b" }] },
          { id: "b", sends: [{ to: "c" }, { to: MASTER_TRACK_ID }] },
          { id: "c", sends: [{ to: "a" }, { to: "c" }, { to: MASTER_TRACK_ID }] },
        ],
      },
    });
    expect(repaired.mixer.tracks.map((t) => t.sends.map((s) => s.to))).toEqual([[], ["b"], ["c", MASTER_TRACK_ID], [MASTER_TRACK_ID]]);
  });
});

describe("a pattern's length", () => {
  const empty = { ...createMusicProject(), channels: [createChannel("Kick", null, "chan_kick")] };
  const steps = (s: MusicProject) => patternSteps(s.patterns[0], s.settings.timeSignature);

  it("is automatic by default: a bar, or up to the end of the two bars the last note is in", () => {
    expect(steps(empty)).toBe(16);
    expect(steps(setSteps(empty, FIRST_PATTERN_ID, "chan_kick", [15], true))).toBe(16);
    expect(steps(setSteps(empty, FIRST_PATTERN_ID, "chan_kick", [16], true))).toBe(32);
    // Three bars of notes make four, five make six.
    expect(steps(setSteps(empty, FIRST_PATTERN_ID, "chan_kick", [0, 40], true))).toBe(64);
    expect(steps(setSteps(empty, FIRST_PATTERN_ID, "chan_kick", [0, 72], true))).toBe(96);
    // A bar of 3/4 is 12 steps.
    const waltz = { ...empty, settings: { ...empty.settings, timeSignature: [3, 4] as [number, number] } };
    expect(steps(setSteps(waltz, FIRST_PATTERN_ID, "chan_kick", [12], true))).toBe(24);
  });

  it("counts a note to where it ends: one held into the next bar makes the pattern a bar longer", () => {
    const held = (length: number) => ({ ...empty, patterns: [{ ...empty.patterns[0], notes: { chan_kick: [{ id: 1, start: 360, length, pitch: 60, velocity: 0.78, pan: 0, muted: false }] } }] });
    expect(steps(held(24))).toBe(16);
    expect(steps(held(25))).toBe(32);
    // Ids a song gives twice are given again.
    const twice = normalizeMusicProject({ ...empty, patterns: [{ id: "pat_1", notes: { chan_kick: [{ id: 4, start: 0 }, { id: 4, start: 24 }, { id: -1, start: 48 }] } }] });
    expect(twice.patterns[0].notes.chan_kick.map((n) => n.id)).toEqual([4, 5, 6]);
  });

  it("is at least what it's set to, and reaches the end of the bar of a note past that", () => {
    const set = { ...empty, patterns: [{ ...empty.patterns[0], length: 20 }] };
    expect(steps(setSteps(set, FIRST_PATTERN_ID, "chan_kick", [4], true))).toBe(20);
    expect(steps(setSteps(set, FIRST_PATTERN_ID, "chan_kick", [19], true))).toBe(20);
    expect(steps(setSteps(set, FIRST_PATTERN_ID, "chan_kick", [20], true))).toBe(32);
    expect(steps(setSteps(set, FIRST_PATTERN_ID, "chan_kick", [40], true))).toBe(48);
  });
});

describe("the playlist", () => {
  it("keeps tracks by number, as short a list as it can be, and clips of what's still there", () => {
    const audio = createAudioChannel("Vocal", "media_vox", "chan_vox");
    const messy = normalizeMusicProject({
      ...song,
      channels: [...song.channels, audio, { id: "chan_lost", kind: "audio", sampleId: "media_gone" }],
      playlist: {
        tracks: [{ name: "  Lead  ", size: 9, color: "#ABCDEF" }, "x", {}, { muted: false }],
        clips: [
          { id: 2, kind: "pattern", ref: "pat_b", track: 3, start: 96.4, length: 0, offset: -5 },
          { id: 2, kind: "audio", ref: "chan_vox", track: 1, start: 0, length: null, offset: 1.25 },
          { kind: "pattern", ref: "pat_gone", track: 0, start: 0 },
          { kind: "audio", ref: "chan_kick", track: 0, start: 0 },
          { kind: "audio", ref: "chan_lost", track: 0, start: 0 },
          { kind: "pattern", ref: "pat_a", track: 500, start: 0 },
          { kind: "pattern", ref: "pat_a", track: 1.5, start: 0 },
          { kind: "pattern", ref: "pat_a", track: 2, start: -1 },
          { kind: "pattern", ref: "pat_a", track: 2, start: 10, length: null },
        ],
      },
    }, (id) => id !== "media_gone");
    // An audio clip's channel without its file goes.
    expect(messy.channels.map((c) => c.id)).toEqual(["chan_kick", "chan_hat", "chan_vox"]);
    expect(messy.playlist.tracks).toEqual([{ name: "Lead", color: "#abcdef", size: 4, muted: false, mixerTrack: null }]);
    expect(messy.playlist.clips).toEqual([
      // In order of start; the second id 2 gets the next free one; an audio clip always has a length.
      { id: 3, kind: "audio", ref: "chan_vox", track: 1, start: 0, length: 384, offset: 1.25, muted: false },
      { id: 4, kind: "pattern", ref: "pat_a", track: 2, start: 10, length: null, offset: 0, muted: false },
      { id: 2, kind: "pattern", ref: "pat_b", track: 3, start: 96, length: 1, offset: 0, muted: false },
    ]);
  });

  it("is empty in songs from before it", () => {
    const { playlist: _, ...old } = song;
    expect(normalizeMusicProject(old).playlist).toEqual({ tracks: [], clips: [] });
  });

  it("keeps the notes of an audio clip's channel: it plays from patterns too, as in FL Studio", () => {
    const audio = createAudioChannel("Vocal", "media_vox", "chan_vox");
    const withNotes = normalizeMusicProject({ ...song, channels: [...song.channels, audio], patterns: [{ id: "pat_a", notes: { chan_vox: [{ start: 0 }] } }] });
    expect(Object.keys(withNotes.patterns[0].notes)).toEqual(["chan_vox"]);
    expect(withNotes.channels[2]).toMatchObject({ kind: "audio", sampleId: "media_vox" });
  });
});

describe("automation clips", () => {
  it("are kept, with their clips", () => {
    const kept = normalizeMusicProject(song);
    expect(kept.automations).toEqual(song.automations);
    expect(kept.playlist.clips.find((c) => c.kind === "automation")).toEqual(song.playlist.clips[2]);
  });

  it("are none in songs from before them", () => {
    const { automations: _, ...old } = song;
    expect(normalizeMusicProject(old).automations).toEqual([]);
  });

  it("are repaired: points in order inside the curve, the first at 0, limits kept, unknown targets dropped", () => {
    const fixed = normalizeMusicProject({
      ...song,
      automations: [
        {
          id: "auto_a",
          target: { kind: "channel", channel: "chan_kick", control: "volume" },
          length: 96.4,
          points: [{ tick: 200, value: 3 }, { tick: 10, value: -1, tension: 9, curve: "zigzag" }, "x"],
          min: -1,
          max: 2,
          lfo: { enabled: true, speed: 1000, skew: 2 },
        },
        { id: "auto_a", target: { kind: "main" } },
        { id: "auto_b", target: { kind: "channel", channel: "chan_kick", control: "swing" } },
        { id: "auto_c", target: { kind: "plugin", owner: "channel", id: "chan_gone", param: "7", index: 2 } },
        { id: "auto_d", target: { kind: "main" }, points: [] },
      ],
      playlist: { tracks: [], clips: [{ kind: "automation", ref: "auto_a", track: 0, start: 0, length: null }, { kind: "automation", ref: "auto_b", track: 0, start: 0 }] },
    });
    expect(fixed.automations.map((a) => a.id)).toEqual(["auto_a", "auto_c", "auto_d"]);
    expect(fixed.automations[0]).toMatchObject({
      name: "Automation",
      length: 96,
      points: [
        { tick: 0, value: 0, tension: 1, curve: "single" },
        { tick: 96, value: 1, tension: 0, curve: "single" },
      ],
      min: 0,
      max: 1,
      lfo: { enabled: true, speed: 32, skew: 1, level: 0, multiply: false },
    });
    // A target that's gone (the channel deleted) is kept: undoing the deletion brings it back to life.
    expect(fixed.automations[1].target).toEqual({ kind: "plugin", owner: "channel", id: "chan_gone", param: "7", index: 2, name: "Parameter" });
    expect(fixed.automations[2].points).toEqual([{ tick: 0, value: 0.5, tension: 0, curve: "single" }]);
    // Clips of automation clips that are gone go.
    expect(fixed.playlist.clips.map((c) => c.ref)).toEqual(["auto_a"]);
    expect(fixed.playlist.clips[0].length).toBeNull();
  });
});
