import { describe, expect, it } from "vitest";
import { addClips, editClips } from "./playlist.ts";
import {
  setScale,
  addChannels,
  addPattern,
  addPluginChannel,
  cloneChannel,
  clonePattern,
  drawSteps,
  fillSteps,
  moveChannels,
  removeChannel,
  removeChannels,
  removePattern,
  removePatterns,
  renamePattern,
  setPatternColor,
  replaceChannel,
  rotateSteps,
  setChannelNotes,
  setMuted,
  setPatternLength,
  setStepNote,
  setStepNotes,
  setSteps,
  setSwing,
  setTempo,
  soloChannel,
  stepNotes,
  stepString,
  transposeChannels,
  updateChannel,
} from "./edits.ts";
import { DEFAULT_PRECOMPUTED, FIRST_PATTERN_ID, createAudioChannel, createMusicProject, normalizeMusicProject } from "./project.ts";
import type { MusicProject } from "./types.ts";

const P = FIRST_PATTERN_ID;
const rack = (): MusicProject =>
  addChannels(createMusicProject("Beat"), [
    { id: "chan_kick", name: "Kick", sampleId: "media_kick" },
    { id: "chan_hat", name: " Hat ", sampleId: null },
    { id: "chan_clap", name: "Clap", sampleId: null },
  ]);
const steps = (song: MusicProject, channel: string, pattern = P, count = 16) => stepString(song.patterns.find((p) => p.id === pattern)!, channel, count);
const order = (song: MusicProject) => song.channels.map((c) => c.id.replace("chan_", ""));
const muted = (song: MusicProject) => song.channels.map((c) => c.muted);

describe("song settings", () => {
  it("clamps the tempo and the swing, and leaves the song alone when nothing changes", () => {
    const song = rack();
    expect(setTempo(song, 120.004).settings.tempo).toBe(120);
    expect(setTempo(song, 5).settings.tempo).toBe(20);
    expect(setTempo(song, 140)).toBe(song);
    expect(setTempo(song, NaN)).toBe(song);
    expect(setSwing(song, 2).settings.swing).toBe(1);
    expect(setSwing(song, 0)).toBe(song);
  });
});

describe("channels", () => {
  it("are added at the end of the rack, as FL's defaults", () => {
    const song = rack();
    expect(song.channels.map((c) => c.name)).toEqual(["Kick", "Hat", "Clap"]);
    expect(song.channels[0]).toMatchObject({ kind: "sampler", sampleId: "media_kick", volume: 0.78, pan: 0, muted: false, cutSelf: false });
    expect(addChannels(song, [])).toBe(song);
  });

  it("are added between two channels, where a file is dropped", () => {
    const song = rack();
    const sample = (id: string) => ({ id: `chan_${id}`, name: id, sampleId: null });
    expect(order(addChannels(song, [sample("snare"), sample("rim")], "chan_hat"))).toEqual(["kick", "snare", "rim", "hat", "clap"]);
    expect(order(addChannels(song, [sample("snare")], "chan_kick"))).toEqual(["snare", "kick", "hat", "clap"]);
    expect(order(addChannels(song, [sample("snare")], "chan_none"))).toEqual(["kick", "hat", "clap", "snare"]);
    // Before the channel named, whatever the rack hides around it (audio clips' channels when Unsorted).
    const withAudio = { ...song, channels: [song.channels[0], createAudioChannel("Vox", "media_vox", "chan_vox"), ...song.channels.slice(1)] };
    expect(order(addChannels(withAudio, [sample("snare")], "chan_hat"))).toEqual(["kick", "vox", "snare", "hat", "clap"]);
  });

  it("are changed within their limits, and not at all by a patch that changes nothing", () => {
    const song = rack();
    expect(updateChannel(song, "chan_kick", { volume: 2, pan: -3, pitch: 100, name: "  808  " }).channels[0]).toMatchObject({ volume: 1, pan: -1, pitch: 48, name: "808" });
    expect(updateChannel(song, "chan_kick", { envelope: { enabled: true, release: 99 } }).channels[0].envelope).toMatchObject({ enabled: true, release: 10, decay: 0.2 });
    expect(updateChannel(song, "chan_kick", { cutSelf: true, precomputed: { reverse: true, start: 2, length: 0, fadeIn: 0.25 } }).channels[0]).toMatchObject({
      cutSelf: true,
      precomputed: { ...DEFAULT_PRECOMPUTED, reverse: true, start: 0.99, length: 0.01, fadeIn: 0.25 },
    });
    expect(updateChannel(song, "chan_kick", { volume: 0.78, name: "", envelope: { enabled: false }, precomputed: { normalize: false } })).toBe(song);
    expect(updateChannel(song, "chan_none", { volume: 0.1 })).toBe(song);
  });

  it("take their notes with them when removed, in every pattern", () => {
    let song = addPattern(rack(), { id: "pat_2" });
    song = setSteps(song, P, "chan_kick", [0, 4], true);
    song = setSteps(song, "pat_2", "chan_kick", [2], true);
    song = setSteps(song, P, "chan_hat", [1], true);
    const removed = removeChannels(song, ["chan_kick", "chan_clap", "chan_none"]);
    expect(order(removed)).toEqual(["hat"]);
    expect(removed.patterns.every((p) => !("chan_kick" in p.notes))).toBe(true);
    expect(steps(removed, "chan_hat")).toBe("-x--------------");
    expect(removeChannel(song, "chan_none")).toBe(song);
    expect(normalizeMusicProject(removed)).toEqual(removed);
  });

  it("never leave the rack empty: its sampler, while untouched, gives way to the first channels added", () => {
    const empty = removeChannels(rack(), rack().channels.map((c) => c.id));
    expect(empty.channels.map((c) => c.name)).toEqual(["Sampler"]);
    expect(normalizeMusicProject({ ...empty, channels: [] }).channels).toEqual(empty.channels);
    expect(order(addChannels(empty, [{ id: "chan_kick", name: "Kick", sampleId: "s1" }]))).toEqual(["kick"]);
    expect(addPluginChannel(empty, { id: "p", name: "Serum 2", format: "VST3" }).channels.map((c) => c.name)).toEqual(["Serum 2"]);
    // Once it's been given notes (or anything else), it's a channel like any other.
    const used = setSteps(empty, P, empty.channels[0].id, [0], true);
    expect(order(addChannels(used, [{ id: "chan_kick", name: "Kick", sampleId: "s1" }]))).toEqual(["sampler", "kick"]);
    const renamed = updateChannel(empty, empty.channels[0].id, { name: "Bass" });
    expect(addChannels(renamed, [{ id: "chan_kick", name: "Kick", sampleId: "s1" }]).channels).toHaveLength(2);
  });

  it("give the rack a sampler when every instrument goes, even with audio clips' channels left", () => {
    const song = { ...rack(), channels: [...rack().channels, createAudioChannel("Vox", "media_vox", "chan_vox")] };
    const left = removeChannels(song, ["chan_kick", "chan_hat", "chan_clap"]);
    expect(left.channels.map((c) => [c.name, c.kind])).toEqual([["Sampler", "sampler"], ["Vox", "audio"]]);
    expect(normalizeMusicProject(left)).toEqual(left);
    // The placeholder still gives way to the first instruments added; the audio channel stays.
    expect(order(addChannels(left, [{ id: "chan_kick", name: "Kick", sampleId: "s1" }]))).toEqual(["vox", "kick"]);
    // Not while an instrument is left.
    expect(removeChannels(song, ["chan_kick", "chan_hat"]).channels.map((c) => c.name)).toEqual(["Clap", "Vox"]);
  });

  it("are cloned with their settings but without their notes", () => {
    const song = updateChannel(setSteps(rack(), P, "chan_kick", [0, 4], true), "chan_kick", { volume: 0.5 });
    const cloned = cloneChannel(song, "chan_kick", "chan_copy");
    expect(order(cloned)).toEqual(["kick", "copy", "hat", "clap"]);
    expect(cloned.channels[1]).toMatchObject({ name: "Kick", volume: 0.5, sampleId: "media_kick" });
    expect(steps(cloned, "chan_copy")).toBe("----------------");
  });

  it("are replaced by another instrument in their place, which plays their notes", () => {
    let song = updateChannel(setSteps(rack(), P, "chan_hat", [0, 4], true), "chan_hat", { volume: 0.5, pan: -0.25, muted: true });
    song = { ...song, channels: song.channels.map((c) => (c.id === "chan_hat" ? { ...c, mixerTrack: "insert_2" } : c)) };
    const serum = { id: "vst3:serum", name: "Serum", format: "VST3" };
    const replaced = replaceChannel(song, "chan_hat", serum, "chan_serum");
    expect(order(replaced)).toEqual(["kick", "serum", "clap"]);
    expect(replaced.channels[1]).toMatchObject({ kind: "plugin", plugin: serum, name: "Serum", sampleId: null, volume: 0.5, pan: -0.25, muted: true, mixerTrack: "insert_2" });
    expect(steps(replaced, "chan_serum")).toBe("x---x-----------");
    expect(replaced.patterns[0].notes.chan_hat).toBeUndefined();
    // Back to a sampler, with nothing to play yet.
    expect(replaceChannel(replaced, "chan_serum", null, "chan_s").channels[1]).toMatchObject({ kind: "sampler", plugin: null, name: "Sampler", sampleId: null });
    expect(replaceChannel(song, "chan_nope", serum)).toBe(song);
  });

  it("move up and down the rack together, stopping at its edges", () => {
    const song = rack();
    expect(order(moveChannels(song, ["chan_clap"], -1))).toEqual(["kick", "clap", "hat"]);
    expect(order(moveChannels(song, ["chan_hat", "chan_clap"], -1))).toEqual(["hat", "clap", "kick"]);
    expect(order(moveChannels(song, ["chan_kick", "chan_hat"], 1))).toEqual(["clap", "kick", "hat"]);
    expect(moveChannels(song, ["chan_kick"], -1)).toBe(song);
    expect(moveChannels(song, ["chan_hat", "chan_clap"], 1)).toBe(song);
  });

  it("are muted together, and soloed as FL Studio does it: by muting the others", () => {
    const song = rack();
    expect(muted(setMuted(song, ["chan_kick", "chan_clap"], true))).toEqual([true, false, true]);
    expect(setMuted(song, ["chan_kick"], false)).toBe(song);
    const solo = soloChannel(song, "chan_hat");
    expect(muted(solo)).toEqual([true, false, true]);
    // Soloing another moves the solo; soloing the one that's alone unmutes everything.
    expect(muted(soloChannel(solo, "chan_kick"))).toEqual([false, true, true]);
    expect(muted(soloChannel(solo, "chan_hat"))).toEqual([false, false, false]);
    // A muted channel can be soloed too.
    expect(muted(soloChannel(setMuted(song, ["chan_hat"], true), "chan_hat"))).toEqual([true, false, true]);
    expect(soloChannel(song, "chan_none")).toBe(song);
  });
});

describe("steps", () => {
  it("are switched on and off, keeping the notes in order", () => {
    let song = setSteps(rack(), P, "chan_kick", [8], true);
    song = setSteps(song, P, "chan_kick", [0], true);
    expect(steps(song, "chan_kick")).toBe("x-------x-------");
    expect(song.patterns[0].notes.chan_kick.map((n) => n.start)).toEqual([0, 192]);
    song = setSteps(song, P, "chan_kick", [0, 8], false);
    // A channel with no notes isn't in the pattern at all.
    expect(song.patterns[0].notes).toEqual({});
  });

  it("are set several at once, ignoring the ones already that way or that can't be", () => {
    const song = setSteps(rack(), P, "chan_kick", [0, 4, 4, 9999, -1, 1.5], true);
    expect(steps(song, "chan_kick")).toBe("x---x-----------");
    expect(setSteps(song, P, "chan_kick", [0, 4], true)).toBe(song);
    expect(setSteps(song, P, "chan_kick", [1, 2], false)).toBe(song);
    expect(setSteps(song, P, "chan_none", [1], true)).toBe(song);
    expect(setSteps(song, "pat_none", "chan_kick", [1], true)).toBe(song);
    // A step past the first bar is fine: the pattern grows to hold it.
    expect(steps(setSteps(song, P, "chan_kick", [20], true), "chan_kick", P, 32)).toBe("x---x---------------x-----------");
  });

  it("are drawn from text over a number of steps, repeating a short drawing and keeping what stays on", () => {
    let song = setSteps(rack(), P, "chan_hat", [2, 20], true);
    song = setStepNote(song, P, "chan_hat", 2, { velocity: 0.3 });
    song = drawSteps(song, P, "chan_hat", "--x- x---", 16);
    expect(steps(song, "chan_hat")).toBe("--x-x-----x-x---");
    expect(stepNotes(song.patterns[0], "chan_hat", 16)[2]?.velocity).toBe(0.3);
    // Past the steps drawn, nothing is touched.
    expect(steps(song, "chan_hat", P, 32).slice(16)).toBe("----x-----------");
    expect(drawSteps(song, P, "chan_hat", "--x-x-----x-x---", 16)).toBe(song);
    expect(steps(fillSteps(song, P, "chan_hat", 4, 16), "chan_hat")).toBe("x---x---x---x---");
    expect(steps(drawSteps(song, P, "chan_hat", ".", 16), "chan_hat")).toBe("----------------");
  });

  it("rotate left and right, wrapping round", () => {
    const song = setSteps(rack(), P, "chan_kick", [0, 5], true);
    expect(steps(rotateSteps(song, P, "chan_kick", 1, 16), "chan_kick")).toBe("-x----x---------");
    expect(steps(rotateSteps(song, P, "chan_kick", -1, 16), "chan_kick")).toBe("----x----------x");
    expect(rotateSteps(song, P, "chan_hat", 1, 16)).toBe(song);
  });

  it("have a velocity and a pitch (the graph editor), set one or many at a time", () => {
    const song = setSteps(rack(), P, "chan_kick", [0, 4, 8], true);
    const edited = setStepNote(song, P, "chan_kick", 0, { velocity: 1.4, pitch: 72.4 });
    expect(edited.patterns[0].notes.chan_kick[0]).toMatchObject({ velocity: 1, pitch: 72 });
    expect(setStepNote(song, P, "chan_kick", 0, { velocity: 0.78 })).toBe(song);
    expect(setStepNote(song, P, "chan_kick", 3, { velocity: 0.2 })).toBe(song);
    const many = setStepNotes(
      song,
      P,
      "chan_kick",
      new Map([
        [0, { velocity: 0.1 }],
        [8, { velocity: 0.9 }],
        [3, { velocity: 0.5 }],
      ]),
    );
    expect(many.patterns[0].notes.chan_kick.map((n) => n.velocity)).toEqual([0.1, 0.78, 0.9]);
    expect(setStepNotes(song, P, "chan_kick", new Map())).toBe(song);
  });

  it("are transposed by semitones, channel by channel, stopping at the ends of the MIDI range", () => {
    let song = setSteps(rack(), P, "chan_kick", [0, 4], true);
    song = setSteps(song, P, "chan_hat", [2], true);
    song = setStepNote(song, P, "chan_kick", 4, { pitch: 125 });
    const up = transposeChannels(song, P, ["chan_kick", "chan_hat", "chan_clap"], 5);
    expect(up.patterns[0].notes.chan_kick.map((n) => n.pitch)).toEqual([65, 127]);
    expect(up.patterns[0].notes.chan_hat.map((n) => n.pitch)).toEqual([65]);
    expect(transposeChannels(song, P, ["chan_hat"], -12).patterns[0].notes.chan_hat[0].pitch).toBe(48);
    expect(transposeChannels(song, P, ["chan_kick"], 0)).toBe(song);
    expect(transposeChannels(song, P, ["chan_clap"], 3)).toBe(song);
    expect(transposeChannels(up, P, ["chan_kick"], 200).patterns[0].notes.chan_kick.map((n) => n.pitch)).toEqual([127, 127]);
  });

  it("are replaced whole (pasting)", () => {
    const song = setSteps(rack(), P, "chan_kick", [0, 4], true);
    const pasted = setChannelNotes(song, P, "chan_hat", () => song.patterns[0].notes.chan_kick);
    expect(steps(pasted, "chan_hat")).toBe("x---x-----------");
    expect(setChannelNotes(song, P, "chan_none", () => [])).toBe(song);
  });
});

describe("patterns", () => {
  it("are added empty, named after their number, cloned and renamed", () => {
    let song = addPattern(rack(), { id: "pat_2" });
    expect(song.patterns[1]).toEqual({ id: "pat_2", name: "Pattern 2", length: null, notes: {}, color: null });
    song = setSteps(song, "pat_2", "chan_kick", [0], true);
    song = clonePattern(song, "pat_2", "pat_3");
    expect(song.patterns.map((p) => p.name)).toEqual(["Pattern 1", "Pattern 2", "Pattern 3"]);
    expect(steps(song, "chan_kick", "pat_3")).toBe("x---------------");
    expect(renamePattern(song, "pat_3", " Drop ").patterns[2].name).toBe("Drop");
    expect(renamePattern(song, "pat_3", "Pattern 3")).toBe(song);
    // Its colour (its clips' in the Playlist): a colour or none, the same song back when it's unchanged.
    const red = setPatternColor(song, "pat_3", "#A8403C");
    expect(red.patterns[2].color).toBe("#a8403c");
    expect(setPatternColor(red, "pat_3", "#a8403c")).toBe(red);
    expect(setPatternColor(red, "pat_3", "red").patterns[2].color).toBeNull();
    expect(updateChannel(song, "chan_kick", { color: "#3f8a4c" }).channels[0].color).toBe("#3f8a4c");
  });

  it("are removed with their clips; all of them leave an empty Pattern 1, as a new song has", () => {
    let song = setSteps(addPattern(rack(), { id: "pat_2" }), "pat_2", "chan_kick", [0], true);
    song = editClips(song, (clips) => addClips(clips, [{ kind: "pattern", ref: "pat_2", track: 0, start: 0 }]).clips);
    const one = removePattern(song, P);
    expect(one.patterns.map((p) => p.id)).toEqual(["pat_2"]);
    const none = removePatterns(song, [P, "pat_2"]);
    expect(none.patterns).toEqual([{ id: P, name: "Pattern 1", length: null, notes: {}, color: null }]);
    expect(none.playlist.clips).toEqual([]);
    expect(removePattern(one, "pat_2").patterns.map((p) => p.name)).toEqual(["Pattern 1"]);
    expect(removePatterns(song, ["pat_9"])).toBe(song);
  });

  it("have a length that's set, or automatic; a shorter one keeps the notes past its end", () => {
    const song = setSteps(rack(), P, "chan_kick", [0, 12], true);
    const short = setPatternLength(song, P, 8);
    expect(short.patterns[0].length).toBe(8);
    expect(short.patterns[0].notes.chan_kick).toHaveLength(2);
    expect(setPatternLength(short, P, 9000).patterns[0].length).toBe(512);
    expect(setPatternLength(short, P, null).patterns[0].length).toBeNull();
    expect(setPatternLength(song, P, null)).toBe(song);
    expect(setPatternLength(short, P, 8)).toBe(short);
  });
});

describe("the song's scale", () => {
  it("is set, changed and taken away, kept through a save, and the same song when nothing changes", () => {
    const song = createMusicProject("Scale");
    const aMinor = setScale(song, { root: 21, type: "minor" });
    expect(aMinor.settings.scale).toEqual({ root: 9, type: "minor" });
    expect(setScale(aMinor, { root: 9, type: "minor" })).toBe(aMinor);
    expect(setScale(aMinor, null).settings.scale).toBeUndefined();
    expect(setScale(song, null)).toBe(song);
    expect(normalizeMusicProject(JSON.parse(JSON.stringify(aMinor))).settings.scale).toEqual({ root: 9, type: "minor" });
    expect(normalizeMusicProject({ ...aMinor, settings: { ...aMinor.settings, scale: { root: 14, type: "minor" } } }).settings.scale).toBeUndefined();
    expect(normalizeMusicProject({ ...aMinor, settings: { ...aMinor.settings, scale: { root: 2, type: "klingon" } } }).settings.scale).toBeUndefined();
  });
});
