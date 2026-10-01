import { describe, expect, it } from "vitest";
import { addChannels, addPattern, setSteps, setTempo, stepString } from "@shared/music/edits";
import { FIRST_PATTERN_ID, createMusicProject } from "@shared/music/project";
import type { MediaAsset } from "@shared/types";
import { describeSong, songContext } from "./context";
import {
  addPatternTool,
  editStep,
  moveChannelTool,
  movePatternTool,
  removeChannelTool,
  removePatternTool,
  setStepsTool,
  soloChannelTool,
  transposeChannelsTool,
  transposePatternsTool,
  setNotesTool,
  chopNotesTool,
  describeNotes,
  updateChannelTool,
  updatePatternTool,
  updateSong,
} from "./tool-edits";

const env = { patternId: FIRST_PATTERN_ID };
const rack = () =>
  addChannels(setTempo(createMusicProject("Beat"), 120), [
    { id: "chan_kick", name: "Kick", sampleId: "media_kick" },
    { id: "chan_hat", name: "Hat", sampleId: null },
  ]);
const asset = (id: string, name: string) => ({ id, name, hasAudio: true }) as MediaAsset;

describe("the assistant's song edits", () => {
  it("set the song's settings, refusing what can't be", () => {
    const { song, text } = updateSong(rack(), { tempo: 140, swing: 0.5, timeSignature: [6, 8], volume: 0.5 }, env);
    expect(song.settings).toEqual({ tempo: 140, swing: 0.5, timeSignature: [6, 8], volume: 0.5 });
    expect(text).toBe("The song is at 140 BPM in 6/8, swing 50%, main volume 50%.");
    expect(() => updateSong(rack(), { volume: 2 }, env)).toThrow(/from 0 to 1/);
    expect(() => updateSong(rack(), { tempo: 5 }, env)).toThrow(/from 20 to 999/);
    expect(() => updateSong(rack(), { timeSignature: [4, 5] }, env)).toThrow(/unit of 1, 2, 4/);
  });

  it("find a channel by id or by name, and say which exist when it isn't one", () => {
    const byName = setStepsTool(rack(), { channel: "kick", steps: "x--- x---" }, env);
    expect(stepString(byName.song.patterns[0], "chan_kick", 16)).toBe("x---x---x---x---");
    expect(byName.text).toBe('"Kick" in "Pattern 1": x---x---x---x---');
    expect(() => setStepsTool(rack(), { channel: "snare", steps: "x" }, env)).toThrow(/The channels are: "Kick", "Hat"/);
    expect(() => setStepsTool(rack(), { channel: "chan_kick", steps: "  " }, env)).toThrow(/drawing/);
    expect(() => setStepsTool(rack(), { channel: "chan_kick", steps: "x", pattern: "Chorus" }, env)).toThrow(/The patterns are: "Pattern 1"/);
  });

  it("change a channel, and one step of it", () => {
    const changed = updateChannelTool(rack(), { channel: "Hat", volume: 0.5, pan: -0.25, muted: true, envelope: { enabled: true, release: 0.2 } }, env);
    expect(changed.song.channels[1]).toMatchObject({ volume: 0.5, pan: -0.25, muted: true, envelope: { enabled: true, release: 0.2, sustain: 1 } });
    expect(changed.text).toContain("volume 50%, pan 25% left, muted, envelope");
    expect(() => updateChannelTool(rack(), { channel: "Hat", volume: 3 }, env)).toThrow(/"volume" must be a number from 0 to 1/);
    // Colours: a channel's and a pattern's (their clips on the playlist take them), "none" for the usual.
    const red = updateChannelTool(rack(), { channel: "Hat", color: "#A8403C" }, env).song;
    expect(red.channels.find((c) => c.name === "Hat")?.color).toBe("#a8403c");
    expect(updateChannelTool(red, { channel: "Hat", color: "none" }, env).song.channels.find((c) => c.name === "Hat")?.color).toBeNull();
    expect(() => updateChannelTool(rack(), { channel: "Hat", color: "red" }, env)).toThrow(/"#rrggbb"/);
    expect(updatePatternTool(rack(), { pattern: rack().patterns[0].id, color: "#3f8a4c" }, env).song.patterns[0].color).toBe("#3f8a4c");

    const drawn = setStepsTool(rack(), { channel: "Hat", steps: "--x-" }, env).song;
    const step = editStep(drawn, { channel: "Hat", step: 3, velocity: 0.4, pitch: 12 }, env);
    expect(step.song.patterns[0].notes.chan_hat[0]).toMatchObject({ velocity: 0.4, pitch: 72 });
    expect(() => editStep(drawn, { channel: "Hat", step: 1, velocity: 0.4 }, env)).toThrow(/Step 1 of "Hat" is off \(its steps are --x---x---x---x-\)/);
    expect(() => editStep(drawn, { channel: "Hat", step: 99 }, env)).toThrow(/from 1 to 16/);
    expect(removeChannelTool(drawn, { channel: "Hat" }, env).song.channels.map((c) => c.name)).toEqual(["Kick"]);
  });

  it("add, change and remove patterns", () => {
    const added = addPatternTool(rack(), { name: "Fill" }, env);
    expect(added.song.patterns[1]).toMatchObject({ name: "Fill", length: null, id: added.showPattern });
    expect(updatePatternTool(added.song, { pattern: "Fill", length: 32, name: "Long fill" }, env).text).toBe('The pattern "Long fill" is 32 steps (set).');
    // Without a pattern, the one shown.
    const set = updatePatternTool(added.song, { length: 24 }, env).song;
    expect(set.patterns[0].length).toBe(24);
    expect(updatePatternTool(set, { length: "auto" }, env).text).toBe('The pattern "Pattern 1" is 16 steps (automatic).');
    expect(() => updatePatternTool(set, { length: "long" }, env)).toThrow(/"auto" or a whole number/);
    expect(removePatternTool(added.song, { pattern: "Fill" }, env).song.patterns).toHaveLength(1);
    expect(() => removePatternTool(rack(), { pattern: "Pattern 1" }, env)).toThrow(/at least one pattern/);
  });

  it("draw past the end of an automatic pattern, which grows to hold it", () => {
    const two = setStepsTool(rack(), { channel: "Kick", steps: "x---------------x---x-----------" }, env);
    expect(two.text).toBe('"Kick" in "Pattern 1": x---------------x---x-----------');
    // A short drawing still repeats over what's there.
    expect(setStepsTool(two.song, { channel: "Hat", steps: "x-" }, env).text).toContain("x-x-x-x-x-x-x-x-x-x-x-x-x-x-x-x-");
  });

  it("solo and move channels, and prepare their samples", () => {
    const solo = soloChannelTool(rack(), { channel: "Hat" }, env);
    expect(solo.song.channels.map((c) => c.muted)).toEqual([true, false]);
    expect(solo.text).toBe('"Hat" is soloed (the others are muted).');
    expect(soloChannelTool(solo.song, { channel: "Hat" }, env).text).toMatch(/every channel is unmuted/);
    expect(moveChannelTool(rack(), { channel: "Hat", direction: "up" }, env).text).toBe("The rack's order is now: Hat, Kick.");
    expect(() => moveChannelTool(rack(), { channel: "Hat", direction: "left" }, env)).toThrow(/"up" or "down"/);
    const edited = updateChannelTool(rack(), { channel: "Kick", cutSelf: true, sample: { reverse: true, normalize: true, start: 0.25, fadeOut: 0.5 } }, env);
    expect(edited.song.channels[0]).toMatchObject({ cutSelf: true, precomputed: { normalize: true, reverse: true, start: 0.25, length: 1, fadeIn: 0, fadeOut: 0.5 } });
    expect(edited.text).toContain("cut self, sample normalized, reversed, starts at 25%, fade out 50%");
    expect(() => updateChannelTool(rack(), { channel: "Kick", sample: { start: 3 } }, env)).toThrow(/"start" must be a number from 0 to 1/);
  });

  it("transpose channels' notes by semitones", () => {
    const drawn = setStepsTool(rack(), { channel: "Kick", steps: "x---" }, env).song;
    const up = transposeChannelsTool(drawn, { channels: ["Kick", "chan_hat"], semitones: 12 }, env);
    expect(up.song.patterns[0].notes.chan_kick.every((n) => n.pitch === 72)).toBe(true);
    expect(up.text).toBe('Moved the notes of "Kick", "Hat" in "Pattern 1" 12 semitones up.');
    expect(transposeChannelsTool(drawn, { channels: ["Hat"], semitones: -1 }, env).text).toMatch(/Nothing moved/);
    expect(() => transposeChannelsTool(drawn, { channels: ["Kick"], semitones: 1.5 }, env)).toThrow(/whole number/);
    expect(() => transposeChannelsTool(drawn, { channels: [], semitones: 1 }, env)).toThrow(/list of channels/);
  });

  it("transpose whole patterns, every channel's notes, and move patterns along the list", () => {
    let song = addPattern(rack(), { id: "pat_fill", name: "Fill" });
    song = setSteps(song, FIRST_PATTERN_ID, "chan_kick", [0], true);
    song = setSteps(song, FIRST_PATTERN_ID, "chan_hat", [2], true);
    song = setSteps(song, "pat_fill", "chan_kick", [4], true);
    const down = transposePatternsTool(song, { patterns: ["Pattern 1", "pat_fill"], semitones: -12 }, env);
    expect(down.song.patterns.flatMap((p) => Object.values(p.notes).flat().map((n) => n.pitch))).toEqual([48, 48, 48]);
    expect(down.text).toBe('Moved every note of "Pattern 1", "Fill" 12 semitones down.');
    expect(transposePatternsTool(song, { patterns: ["Fill"], semitones: 0 }, env).text).toMatch(/Nothing moved/);
    expect(() => transposePatternsTool(song, { patterns: ["Chorus"], semitones: 1 }, env)).toThrow(/The patterns are: "Pattern 1", "Fill"/);
    expect(() => transposePatternsTool(song, { patterns: [], semitones: 1 }, env)).toThrow(/list of patterns/);
    const moved = movePatternTool(song, { pattern: "Fill", direction: "up" }, env);
    expect(moved.song.patterns.map((p) => p.name)).toEqual(["Fill", "Pattern 1"]);
    expect(moved.text).toBe('The patterns are now, in order: "Fill", "Pattern 1".');
    expect(movePatternTool(song, { pattern: "Fill", direction: "down" }, env).song).toBe(song);
    expect(() => movePatternTool(song, { pattern: "Fill", direction: "left" }, env)).toThrow(/"up" or "down"/);
  });

  it("write and read a channel's notes: pitches by name, times in steps", () => {
    const written = setNotesTool(
      rack(),
      {
        channel: "Kick",
        notes: [
          { pitch: "C5", start: 0, length: 4 },
          { pitch: "E5", start: 0, length: 4, velocity: 0.5 },
          { pitch: 67, start: 20.5, length: 2 },
        ],
      },
      env,
    );
    expect(written.text).toBe('"Kick" has 3 notes in "Pattern 1", which is 32 steps long.');
    expect(written.song.patterns[0].notes.chan_kick.map((n) => [n.pitch, n.start, n.length, n.velocity])).toEqual([
      [60, 0, 96, 0.78],
      [64, 0, 96, 0.5],
      [67, 492, 48, 0.78],
    ]);
    expect(describeNotes(written.song, { channel: "Kick" }, env)).toBe(
      [
        '"Kick" in "Pattern 1" (32 steps long): 3 notes, as pitch, start and length in steps.',
        "- C5 at 0 for 4, velocity 0.78",
        "- E5 at 0 for 4, velocity 0.50",
        "- G5 at 20.5 for 2, velocity 0.78",
      ].join("\n"),
    );
    // Added, not replacing.
    const more = setNotesTool(written.song, { channel: "Kick", notes: [{ pitch: "A5", start: 8, length: 1 }], mode: "add" }, env);
    expect(more.song.patterns[0].notes.chan_kick).toHaveLength(4);
    expect(() => setNotesTool(rack(), { channel: "Kick", notes: [{ pitch: "H2", start: 0, length: 1 }] }, env)).toThrow(/Note 1: "pitch"/);
    expect(() => setNotesTool(rack(), { channel: "Kick", notes: [{ pitch: "C5", start: -1, length: 1 }] }, env)).toThrow(/"start" must be a number/);
    expect(describeNotes(rack(), { channel: "Hat" }, env)).toBe('"Hat" has no notes in "Pattern 1".');
  });

  it("chop a channel's notes into a rhythm", () => {
    const held = setNotesTool(rack(), { channel: "Hat", notes: [{ pitch: "C5", start: 0, length: 4 }, { pitch: "D5", start: 4, length: 4 }] }, env).song;
    const sixteenths = chopNotesTool(held, { channel: "Hat", pitch: "C5" }, env);
    expect(sixteenths.text).toBe('Chopped 1 note of "Hat" to "Default": it has 5 notes in "Pattern 1" now.');
    expect(sixteenths.song.patterns[0].notes.chan_hat.filter((n) => n.pitch === 60).map((n) => [n.start, n.length])).toEqual([[0, 24], [24, 24], [48, 24], [72, 24]]);
    const roll = chopNotesTool(held, { channel: "Hat", rhythm: "trap-roll", time_mul: 2, velocity_levels: 1 }, env).song.patterns[0].notes.chan_hat;
    // The roll, twice as fast, is a beat long: an eighth's worth of sixteenths, then triplets and 32nds' halves.
    expect(roll.filter((n) => n.pitch === 60).map((n) => n.length)).toEqual([24, 24, 8, 8, 8, 6, 6, 6, 6]);
    expect(roll.find((n) => n.start === 24)!.velocity).toBeCloseTo(0.78 * 0.8);
    expect(() => chopNotesTool(held, { channel: "Hat", rhythm: "nope" }, env)).toThrow(/"trap-roll"/);
    expect(() => chopNotesTool(held, { channel: "Hat", pitch: "G5" }, env)).toThrow(/no notes of G5/);
    expect(chopNotesTool(chopNotesTool(held, { channel: "Hat" }, env).song, { channel: "Hat" }, env).text).toMatch(/Nothing to chop/);
  });

  it("describe the song for the model: channels, every pattern's steps, spare files", () => {
    const song = setStepsTool(addPatternTool(rack(), { name: "Fill" }, env).song, { channel: "Kick", steps: "x---" }, env).song;
    const text = describeSong(song, [asset("media_kick", "kick.wav"), asset("media_snare", "snare.wav")], FIRST_PATTERN_ID);
    expect(text).toContain('Song: "Beat", 120 BPM, 4/4, swing 0%, main volume 78%.');
    expect(text).toContain('- "Kick" (id chan_kick), sample kick.wav, volume 78%');
    expect(text).toContain('- "Hat" (id chan_hat), no sample (silent), volume 78%');
    expect(text).toContain(`- "Pattern 1" (id ${FIRST_PATTERN_ID}, 16 steps (automatic)), shown in the rack: it's the one that plays\n    x---x---x---x---  Kick\n    ----------------  Hat`);
    expect(text).toContain("- snare.wav (mediaId media_snare)");
    expect(text).not.toContain("kick.wav (mediaId");
    expect(songContext(song, FIRST_PATTERN_ID)).toEqual({
      context: 'Song: "Beat", 120 BPM, 4/4, 2 channels (Kick, Hat). The channel rack shows the pattern "Pattern 1".',
      label: "120 BPM, 4/4",
    });
  });
});
