/**
 * Resampling (FL's interpolation), heard: the real engine, offline, playing sines through a sampler
 * channel and an audio clip at another rate or pitched, with each method (`engine/src/Resampling.h`).
 * What comes out is compared with the sine it should be, sample for sample: how far off it is says
 * how clean the method is, and that it's off by so little says nothing was delayed. Hits pitched or
 * resampled still start on their sample. Skipped when the engine hasn't been built.
 */
import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addChannels, setSteps, updateChannel } from "../../shared/music/edits.ts";
import { RESAMPLING, type Resampling } from "../../shared/music/engine.ts";
import { addAudioClips } from "../../shared/music/playlist.ts";
import { FIRST_PATTERN_ID, createMusicProject as newSong } from "../../shared/music/project.ts";
import type { MusicProject } from "../../shared/music/types.ts";
import { ENGINE } from "../config.ts";
import { DataPaths } from "../storage.ts";
import { AudioEngine } from "./engine.ts";
import { type WavData, onsets, readWav, writeWav } from "./wav.ts";

const createMusicProject = (name: string) => newSong(name, 120);

const RATE = 48_000;
const BEAT = 24_000;
const P = FIRST_PATTERN_ID;
const PROJECT = "proj_0123456789ab";
const AMPLITUDE = 0.5;

/** A sine's samples: `seconds` long at `rate`. */
const sine = (hz: number, rate: number, seconds: number) => Float32Array.from({ length: Math.round(rate * seconds) }, (_, i) => AMPLITUDE * Math.sin((2 * Math.PI * hz * i) / rate));

/** How far `heard` is from `wanted` over `[from, to)`, in dB under the sine's own level (higher is cleaner). */
function cleanness(heard: Float32Array, wanted: (i: number) => number, from: number, to: number): number {
  let error = 0;
  for (let i = from; i < to; i++) error += (heard[i] - wanted(i)) ** 2;
  const rms = Math.sqrt(error / (to - from));
  return 20 * Math.log10(AMPLITUDE / Math.SQRT2 / rms);
}

/** The level of `[from, to)` in dB under the sine's own (higher is quieter). */
function quietness(heard: Float32Array, from: number, to: number): number {
  let sum = 0;
  for (let i = from; i < to; i++) sum += heard[i] ** 2;
  return 20 * Math.log10(AMPLITUDE / Math.SQRT2 / Math.sqrt(sum / (to - from)));
}

describe.skipIf(!existsSync(ENGINE))("resampling, offline", () => {
  let dir: string;
  let engine: AudioEngine;
  let render = 0;

  async function hear(song: MusicProject, resampling: Resampling, frames: number, mode: "pattern" | "song" = "pattern"): Promise<WavData> {
    await engine.command("stop", {});
    await engine.setSong({ projectId: PROJECT, song, patternId: P, mode, resampling });
    // Let what was sounding end.
    await engine.render(RATE / 10);
    await engine.command("play", {});
    const file = path.join(dir, `render-${render++}.wav`);
    await engine.render(frames, file);
    return readWav(file);
  }
  /** A sampler channel playing `sampleId` on the first step. */
  const sampler = (sampleId: string, pitch = 0) =>
    updateChannel(setSteps(addChannels(createMusicProject("Test"), [{ id: "chan_tone", name: "Tone", sampleId }]), P, "chan_tone", [0], true), "chan_tone", { pitch });

  beforeAll(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "resampling-"));
    // A 5 kHz sine at 44.1 kHz: every sample out falls between two of its own.
    await writeWav(path.join(dir, "tone44.wav"), sine(5000, 44_100, 1), 44_100);
    // A 15 kHz sine at 48 kHz: an octave up it's 30 kHz, past what 48 kHz can hold, so all of it would alias.
    await writeWav(path.join(dir, "high.wav"), sine(15_000, RATE, 1), RATE);
    // Silence then a steady level from 0.25 s, at 44.1 kHz: a hit inside a file.
    await writeWav(path.join(dir, "late44.wav"), Float32Array.from({ length: 44_100 }, (_, i) => (i >= 11_025 ? 0.5 : 0)), 44_100);
    await writeWav(path.join(dir, "hit.wav"), new Float32Array(480).fill(0.5), RATE);
    engine = new AudioEngine(new DataPaths(dir), {
      offline: true,
      onlyPluginPaths: true,
      pluginPaths: [],
      samplePath: (_project, id) => (["tone44", "high", "late44", "hit"].includes(id) ? path.join(dir, `${id}.wav`) : null),
    });
  });
  afterAll(async () => {
    engine.shutdown();
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("plays a 44.1 kHz sample at 48 kHz cleaner with each better method, and not a sample late", async () => {
    // What it should be: the same sine, from the step's sample on (none of the methods delays it).
    const wanted = (i: number) => AMPLITUDE * Math.sin((2 * Math.PI * 5000 * i) / RATE);
    const results: Record<string, number> = {};
    for (const method of RESAMPLING) results[method] = cleanness((await hear(sampler("tone44"), method, BEAT)).channels[0], wanted, 64, BEAT - 64);
    console.log("5 kHz from 44.1 kHz, dB clean:", results);
    expect(results.linear).toBeLessThan(results.hermite - 10);
    expect(results.hermite).toBeLessThan(results.sinc - 20);
    expect(results.sinc).toBeGreaterThan(80);
  });

  it("filters out what pitching up would alias, with the sinc", async () => {
    // An octave up: 30 kHz can't be played at 48 kHz, so the right answer is silence.
    const results: Record<string, number> = {};
    for (const method of RESAMPLING) results[method] = quietness((await hear(sampler("high", 12), method, RATE / 4)).channels[0], 64, RATE / 4);
    console.log("15 kHz an octave up, dB quiet:", results);
    expect(results.linear).toBeLessThan(20);
    expect(results.hermite).toBeLessThan(20);
    expect(results.sinc).toBeGreaterThan(60);
  });

  it("starts hits on their sample whichever method, pitched or not", async () => {
    const kick = (pitch: number) => updateChannel(setSteps(addChannels(createMusicProject("Test"), [{ id: "chan_kick", name: "Kick", sampleId: "hit" }]), P, "chan_kick", [0, 4, 8, 12], true), "chan_kick", { pitch });
    for (const method of RESAMPLING)
      for (const pitch of [0, 5, -7.5]) expect(onsets((await hear(kick(pitch), method, BEAT * 4)).channels[0]), `${method} at ${pitch}`).toEqual([0, BEAT, 2 * BEAT, 3 * BEAT]);
  });

  it("starts an audio clip's sound where it is in its file, whichever method (the stream isn't late)", async () => {
    // The clip starts on the song's first tick; its file's level comes in 0.25 s in: 12000 samples at 48 kHz.
    const song = addAudioClips(createMusicProject("Test"), [{ name: "Late", sampleId: "late44", seconds: 1, channelId: "chan_late" }], { start: 0, track: 1 }).song;
    for (const method of RESAMPLING) {
      const heard = (await hear(song, method, RATE / 2, "song")).channels[0];
      // Where it crosses half its level: on the step, to the sample (the sinc rings a little either side of it).
      expect(heard.findIndex((v) => v >= 0.25), method).toBe(12_000);
    }
    // And a 44.1 kHz sine played as an audio clip: as clean as the sampler's, and in time.
    const tone = addAudioClips(createMusicProject("Test"), [{ name: "Tone", sampleId: "tone44", seconds: 1, channelId: "chan_tone" }], { start: 0, track: 1 }).song;
    const wanted = (i: number) => AMPLITUDE * Math.sin((2 * Math.PI * 5000 * i) / RATE);
    const results: Record<string, number> = {};
    for (const method of RESAMPLING) results[method] = cleanness((await hear(tone, method, BEAT, "song")).channels[0], wanted, 256, BEAT - 256);
    console.log("5 kHz audio clip from 44.1 kHz, dB clean:", results);
    expect(results.sinc).toBeGreaterThan(80);
    expect(results.hermite).toBeGreaterThan(results.linear + 10);
  });
});
