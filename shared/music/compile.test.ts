import { describe, expect, it } from "vitest";
import { compileSong, levelGain, panGains, swungTick } from "./compile.ts";
import { addChannels, addPattern, addPluginChannel, setPatternLength, setStepNote, setSteps, setSwing, setTempo, setTimeSignature, updateChannel } from "./edits.ts";
import { FIRST_PATTERN_ID, createMusicProject } from "./project.ts";

const P = FIRST_PATTERN_ID;
const rack = () =>
  addChannels(createMusicProject("Beat"), [
    { id: "chan_kick", name: "Kick", sampleId: "media_kick" },
    { id: "chan_hat", name: "Hat", sampleId: "media_hat" },
  ]);

describe("compileSong", () => {
  it("gives the engine the loop: tempo, length, and every note in order", () => {
    let song = setTempo(rack(), 140);
    song = setSteps(song, P, "chan_hat", [2, 0], true);
    song = setSteps(song, P, "chan_kick", [0, 8], true);
    const compiled = compileSong(song, P);
    expect(compiled).toMatchObject({ tempo: 140, ppq: 96, loopTicks: 384, beatTicks: 96, barTicks: 384 });
    expect(compiled.channels.map((c) => c.sample)).toEqual(["media_kick", "media_hat"]);
    expect(compiled.notes.map((n) => [n.tick, n.channel])).toEqual([
      [0, 0],
      [0, 1],
      [48, 1],
      [192, 0],
    ]);
    expect(compiled.notes[0]).toEqual({ channel: 0, tick: 0, length: 24, pitch: 0, gain: 1, key: 60, velocity: 0.78 });
  });

  it("plays the pattern asked for, or the first", () => {
    let song = addPattern(rack(), { id: "pat_2" });
    song = setSteps(song, "pat_2", "chan_kick", [20], true);
    expect(compileSong(song, "pat_2")).toMatchObject({ loopTicks: 768, notes: [{ tick: 480 }] });
    expect(compileSong(song, "pat_none").notes).toEqual([]);
    expect(compileSong(song, null).loopTicks).toBe(384);
  });

  it("loops a pattern over its length: automatic (the bars with notes), or set, leaving later notes unplayed", () => {
    const song = setSteps(rack(), P, "chan_kick", [0, 20, 40], true);
    expect(compileSong(song, P)).toMatchObject({ loopTicks: 48 * 24, notes: [{ tick: 0 }, { tick: 480 }, { tick: 960 }] });
    const short = compileSong(setPatternLength(song, P, 24), P);
    expect(short.loopTicks).toBe(24 * 24);
    expect(short.notes.map((n) => n.tick)).toEqual([0, 480]);
    expect(compileSong(setPatternLength(song, P, 64), P).loopTicks).toBe(64 * 24);
  });

  it("passes on cut self and what's done to the sample, when anything is", () => {
    const song = rack();
    expect(compileSong(song, P).channels[0]).toMatchObject({ cutSelf: false, precomputed: null });
    const edited = updateChannel(song, "chan_kick", { cutSelf: true, precomputed: { reverse: true, fadeOut: 0.5 } });
    expect(compileSong(edited, P).channels[0]).toMatchObject({
      cutSelf: true,
      precomputed: { normalize: false, reverse: true, start: 0, length: 1, fadeIn: 0, fadeOut: 0.5 },
    });
  });

  it("plays a plugin channel's notes as MIDI notes with a velocity", () => {
    let song = addPluginChannel(rack(), { id: "VST3-Synth-1", name: "Synth", format: "VST3" }, "chan_synth");
    song = setSteps(song, P, "chan_synth", [4], true);
    song = setStepNote(song, P, "chan_synth", 4, { pitch: 64, velocity: 0.5 });
    const compiled = compileSong(song, P);
    expect(compiled.channels[2]).toMatchObject({ id: "chan_synth", sample: null, plugin: { id: "VST3-Synth-1", state: "" }, gainLeft: 1, gainRight: 1 });
    expect(compiled.channels[0].plugin).toBeNull();
    expect(compiled.notes[0]).toMatchObject({ channel: 2, tick: 96, length: 24, key: 64, velocity: 0.5 });
  });

  it("turns volume, pan, mute and velocity into gains", () => {
    expect(levelGain(0.78, 0.78)).toBe(1);
    expect(levelGain(0, 0.78)).toBe(0);
    expect(levelGain(1, 0.78)).toBeCloseTo(1.64, 2);
    expect(panGains(0)).toEqual([1, 1]);
    expect(panGains(-1)).toEqual([1, 0]);
    expect(panGains(0.5)).toEqual([0.5, 1]);

    let song = setSteps(rack(), P, "chan_kick", [0], true);
    song = setStepNote(song, P, "chan_kick", 0, { velocity: 0.39, pitch: 67 });
    song = updateChannel(song, "chan_kick", { pan: 1, pitch: -12, envelope: { enabled: true, release: 0.3 } });
    song = updateChannel(song, "chan_hat", { muted: true });
    const compiled = compileSong(song, P);
    expect(compiled.channels[0]).toMatchObject({ gainLeft: 0, gainRight: 1, pitch: -12, envelope: { attack: 0, decay: 0.2, sustain: 1, release: 0.3 } });
    expect(compiled.channels[1]).toMatchObject({ gainLeft: 0, gainRight: 0, envelope: null });
    expect(compiled.notes[0]).toMatchObject({ pitch: 7, gain: 0.25 });
  });

  it("swings every second step late, up to half a step", () => {
    expect(swungTick(24, 1)).toBe(36);
    expect(swungTick(24, 0)).toBe(24);
    expect(swungTick(48, 1)).toBe(48);
    const song = setSwing(setSteps(rack(), P, "chan_hat", [0, 1, 2, 3], true), 0.5);
    expect(compileSong(song, P).notes.map((n) => n.tick)).toEqual([0, 30, 48, 78]);
  });

  it("counts beats and bars by the time signature", () => {
    expect(compileSong(setTimeSignature(rack(), [6, 8]), P)).toMatchObject({ beatTicks: 48, barTicks: 288 });
    expect(compileSong(setTimeSignature(rack(), [3, 4]), P)).toMatchObject({ beatTicks: 96, barTicks: 288 });
  });
});
