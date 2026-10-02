/**
 * EchoBoy's sound (`docs/soundtoys/echoboy-manual.md`): the real engine, offline, playing songs with an
 * EchoBoy on the master, made with the app's own edits; where each echo lands checked to the sample.
 * At 120 BPM and 48 kHz a beat (a quarter note, 500 ms) is 24000 samples.
 */
import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { type EchoBoyPatch, editStyle, updateEchoBoy, updateRhythm } from "../../shared/music/echo-boy.ts";
import { ECHO_BOY_PLUGIN } from "../../shared/music/echo-boy-presets.ts";
import { addChannels, setSteps } from "../../shared/music/edits.ts";
import { setEffect, updateEffect } from "../../shared/music/mixer.ts";
import { FIRST_PATTERN_ID, MASTER_TRACK_ID, createMusicProject } from "../../shared/music/project.ts";
import type { MusicProject } from "../../shared/music/types.ts";
import { ENGINE } from "../config.ts";
import { DataPaths } from "../storage.ts";
import { AudioEngine } from "./engine.ts";
import { type WavData, onsets, peakOf, readWav, writeWav } from "./wav.ts";

const RATE = 48_000;
const BEAT = 24_000;
const P = FIRST_PATTERN_ID;
const PROJECT = "proj_0123456789ab";
/** A hit: 10 ms of a steady half-scale level. */
const HIT = 480;
const ECHO = "fx_echo";
/** Clean and flat: what's heard is exactly what went in, later. */
const CLEAN: EchoBoyPatch = { style: "Digital Delay", mix: 0.5, feedback: 0, width: 0 };

describe.skipIf(!existsSync(ENGINE))("EchoBoy, offline", () => {
  let dir: string;
  let engine: AudioEngine;
  let render = 0;

  const play = (song: MusicProject) => engine.setSong({ projectId: PROJECT, song, patternId: P, mode: "pattern" });
  async function hear(frames: number): Promise<WavData> {
    const file = path.join(dir, `render-${render++}.wav`);
    await engine.render(frames, file);
    return readWav(file);
  }
  const at = (samples: number[]) => samples.map((s) => Math.round((s / BEAT) * 1000) / 1000);
  /** A song at 120 BPM: a hit on step 0 of a pattern 16 bars long (so it plays once), an EchoBoy on the master set as `patch` says. */
  function song(patch: EchoBoyPatch = {}, sample = "hit") {
    let s = addChannels(createMusicProject("Echoes", 120), [{ id: "chan_hit", name: "Hit", sampleId: sample }]);
    s = setSteps(s, P, "chan_hit", [0], true);
    s = { ...s, patterns: s.patterns.map((p) => (p.id === P ? { ...p, length: 16 * 4 * 96 } : p)) };
    s = setEffect(s, MASTER_TRACK_ID, 0, ECHO_BOY_PLUGIN, ECHO);
    return updateEchoBoy(s, ECHO, { ...CLEAN, ...patch });
  }
  /** Let go of the last song's EchoBoy: the next starts empty. */
  async function fresh() {
    await engine.command("stop", {});
    await play(createMusicProject("Silence", 120));
    await hear(RATE / 10);
  }
  async function played(patch: EchoBoyPatch, frames: number, sample = "hit") {
    await fresh();
    await play(song(patch, sample));
    await engine.command("play", {});
    return hear(frames);
  }

  beforeAll(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "echo-boy-"));
    await writeWav(path.join(dir, "hit.wav"), new Float32Array(HIT).fill(0.5), RATE);
    // A low hum, 100 Hz, half a second.
    await writeWav(path.join(dir, "hum.wav"), Float32Array.from({ length: RATE / 2 }, (_, i) => 0.5 * Math.sin((2 * Math.PI * 100 * i) / RATE)), RATE);
    engine = new AudioEngine(new DataPaths(dir), {
      offline: true,
      onlyPluginPaths: true,
      pluginPaths: [],
      samplePath: (_project, id) => (["hit", "hum"].includes(id) ? path.join(dir, `${id}.wav`) : null),
    });
  });
  afterAll(async () => {
    engine.shutdown();
    await fs.rm(dir, { recursive: true, force: true });
  });
  beforeEach(fresh);

  it("plays one echo a quarter note later, to the sample, the dry sound untouched", async () => {
    const sound = await played({ echo1: { sync: "note", note: 4 } }, BEAT * 3);
    expect(onsets(sound.channels[0])).toEqual([0, BEAT]);
    expect(peakOf(sound.channels[0], 0, HIT)).toBe(0.5);
    expect(peakOf(sound.channels[0], BEAT, BEAT + HIT)).toBeCloseTo(0.5, 3);
    expect(peakOf(sound.channels[1], BEAT, BEAT + HIT)).toBeCloseTo(0.5, 3);
  });

  it("repeats with Feedback, each repeat its gain softer", async () => {
    const sound = await played({ echo1: { sync: "note", note: 8 }, feedback: 0.5 }, BEAT * 3);
    const left = sound.channels[0];
    expect(at(onsets(left))).toEqual([0, 0.5, 1, 1.5, 2, 2.5]);
    const gain = 1.15 * 0.5;
    expect(peakOf(left, BEAT, BEAT + HIT) / peakOf(left, BEAT / 2, BEAT / 2 + HIT)).toBeCloseTo(gain, 2);
  });

  it("follows dotted and triplet note values, and ms", async () => {
    expect(at(onsets((await played({ echo1: { sync: "dot", note: 8 } }, BEAT * 2)).channels[0]))).toEqual([0, 0.75]);
    expect(at(onsets((await played({ echo1: { sync: "trip", note: 4 } }, BEAT * 2)).channels[0]))).toEqual([0, 0.667]);
    // 126.2 ms is 6057.6 samples: read between them, a hit rings a sample or two before it.
    const [dry, echo] = onsets((await played({ echo1: { sync: "time", ms: 126.2 } }, BEAT)).channels[0]);
    expect(dry).toBe(0);
    expect(Math.abs(echo - 0.1262 * RATE)).toBeLessThanOrEqual(2);
  });

  it("swings every other repeat with Groove", async () => {
    const sound = await played({ echo1: { sync: "note", note: 8 }, feedback: 0.6, groove: -1 }, BEAT * 3);
    // Towards Shuffle: the odd repeats a triplet late (2/3 of a beat, then the beat).
    expect(at(onsets(sound.channels[0])).slice(0, 5)).toEqual([0, 0.667, 1, 1.667, 2]);
  });

  it("plays Ping on the left, then Pong on the right after both", async () => {
    const sound = await played({ mode: "pingPong", echo1: { sync: "time", ms: 500 }, echo2: { sync: "time", ms: 250 }, width: 0.75 }, BEAT * 3);
    // The dry hit on both sides; Ping at 500 ms on the left alone, Pong at 750 ms on the right alone.
    expect(at(onsets(sound.channels[0]))).toEqual([0, 1]);
    expect(at(onsets(sound.channels[1]))).toEqual([0, 1.5]);
  });

  it("plays Dual Echo's two times, Echo 1 left and Echo 2 right", async () => {
    const sound = await played({ mode: "dual", echo1: { sync: "note", note: 8 }, echo2: { sync: "note", note: 4 }, width: 0.75, offset: 0 }, BEAT * 2);
    expect(at(onsets(sound.channels[0]))).toEqual([0, 0.5]);
    expect(at(onsets(sound.channels[1]))).toEqual([0, 1]);
  });

  it("plays Rhythm Echo's taps, and the pattern again with feedback", async () => {
    await play(updateRhythm(song({ mode: "rhythm", feedback: 0.5 }), ECHO, (r) => ({ ...r, shapeAmount: 0, panShape: "center" })));
    await engine.command("play", {});
    const sound = await hear(BEAT * 5);
    // Taps on the 8ths of a 2-beat pattern; then the pattern again (its "One" too), the feedback's gain softer.
    expect(at(onsets(sound.channels[0]))).toEqual([0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5]);
  });

  it("leaves the sound exactly as it is with Mix at dry", async () => {
    const sound = await played({ mix: 0, feedback: 0.8 }, BEAT * 2);
    expect(onsets(sound.channels[0])).toEqual([0]);
    expect(peakOf(sound.channels[0], HIT, BEAT * 2)).toBe(0);
  });

  it("colours the echo by its style: Telephone keeps no lows, Digital Delay all of them", async () => {
    const level = async (style: string) => peakOf((await played({ style, echo1: { sync: "note", note: 4 }, mix: 1 }, BEAT * 2, "hum")).channels[0], BEAT + 2400, BEAT + 9600);
    const digital = await level("Digital Delay");
    const telephone = await level("Telephone");
    expect(digital).toBeCloseTo(0.5, 2);
    expect(telephone).toBeLessThan(digital / 20);
  });

  it("darkens each repeat with a style's Decay, and keeps its first repeat as Gain says", async () => {
    let s = song({ echo1: { sync: "note", note: 4 }, feedback: 0.8, mix: 1 }, "hum");
    s = editStyle(s, ECHO, (st) => ({ ...st, low: { freq: 400, gain: 0, decay: -40 } }));
    await play(s);
    await engine.command("play", {});
    const left = (await hear(BEAT * 4)).channels[0];
    const first = peakOf(left, BEAT + 4800, BEAT + 9600);
    const second = peakOf(left, 2 * BEAT + 4800, 2 * BEAT + 9600);
    expect(first).toBeCloseTo(0.5, 1);
    // -6 dB a repeat below 400 Hz (a shelf: most of it at 100 Hz) on top of the feedback's gain.
    expect(second / first).toBeLessThan(0.92 * 0.6);
  });

  it("holds a runaway loop: Feedback at its most stays bounded", async () => {
    const sound = await played({ style: "Space Echo", echo1: { sync: "note", note: 16 }, feedback: 1, mix: 1 }, RATE * 4);
    expect(peakOf(sound.channels[0])).toBeLessThan(2.5);
    expect(sound.channels[0].every(Number.isFinite)).toBe(true);
    // And it does run away: still loud at the end.
    expect(peakOf(sound.channels[0], RATE * 3)).toBeGreaterThan(0.05);
  });

  it("rings on after the song stops", async () => {
    await play(song({ echo1: { sync: "note", note: 4 } }));
    await engine.command("play", {});
    await hear(BEAT / 2);
    await engine.command("stop", {});
    expect(onsets((await hear(BEAT)).channels[0])).toEqual([BEAT / 2]);
  });

  it("forgets its echoes while bypassed", async () => {
    let s = song({ echo1: { sync: "note", note: 4 } });
    await play(s);
    await engine.command("play", {});
    await hear(BEAT / 2);
    s = updateEffect(s, MASTER_TRACK_ID, 0, { enabled: false });
    await play(s);
    await hear(BEAT / 4);
    await play(updateEffect(s, MASTER_TRACK_ID, 0, { enabled: true }));
    expect(onsets((await hear(BEAT)).channels[0])).toEqual([]);
  });

  it("keeps its echoes when a knob turns (a new song)", async () => {
    const s = song({ echo1: { sync: "note", note: 4 } });
    await play(s);
    await engine.command("play", {});
    await hear(BEAT / 2);
    await play(updateEchoBoy(s, ECHO, { feedback: 0.1 }));
    expect(onsets((await hear(BEAT)).channels[0])).toEqual([BEAT / 2]);
  });
});
