/**
 * The sampler's loop, filter, and envelopes and LFOs beyond its volume's (`shared/music/sampler.ts`),
 * with the real engine offline (see `sequencer.integration.test.ts`). At 120 BPM and 48 kHz a beat is
 * 24000 samples; a step 6000.
 */
import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { addChannels, updateChannel } from "../../shared/music/edits.ts";
import { addNotes, editNotes } from "../../shared/music/notes.ts";
import type { ChannelPatch } from "../../shared/music/edits.ts";
import { FIRST_PATTERN_ID as P, createMusicProject } from "../../shared/music/project.ts";
import type { MusicProject } from "../../shared/music/types.ts";
import { ENGINE } from "../config.ts";
import { DataPaths } from "../storage.ts";
import { AudioEngine } from "./engine.ts";
import { peakOf, readWav, writeWav } from "./wav.ts";

const RATE = 48_000;
const BEAT = 24_000;
const PROJECT = "proj_0123456789ab";

describe.skipIf(!existsSync(ENGINE))("the sampler's loop, filter, envelopes and LFOs, offline", () => {
  let dir: string;
  let engine: AudioEngine;
  let render = 0;

  async function hear(frames: number) {
    const file = path.join(dir, `render-${render++}.wav`);
    await engine.render(frames, file);
    return readWav(file);
  }
  /** One channel playing `sample`, a note on the first step `steps` long (a bar's pattern), shaped by `patch`. */
  async function play(sample: string, patch: ChannelPatch, steps = 16): Promise<MusicProject> {
    let song = addChannels(createMusicProject("Test", 120), [{ id: "chan_a", name: "A", sampleId: sample }]);
    song = editNotes(song, P, "chan_a", () => addNotes([], [{ start: 0, length: steps * 24, pitch: 60 }]).notes);
    song = updateChannel(song, "chan_a", patch);
    await engine.setSong({ projectId: PROJECT, song, patternId: P });
    await engine.command("play", {});
    return song;
  }
  /** Zero crossings in `[from, to)`: twice a cycle. */
  const crossings = (samples: Float32Array, from: number, to: number) => {
    let count = 0;
    for (let i = from + 1; i < to; i++) if (samples[i - 1] < 0 !== samples[i] < 0) count++;
    return count;
  };

  beforeAll(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "sampler-"));
    // A second rising from 0 to 1 (where it is tells where in it is playing), a 480 Hz tone (100 samples a cycle), and a 6 kHz one.
    await writeWav(path.join(dir, "ramp.wav"), Float32Array.from({ length: RATE }, (_, i) => i / RATE), RATE);
    await writeWav(path.join(dir, "tone.wav"), Float32Array.from({ length: RATE * 2 }, (_, i) => 0.5 * Math.sin((2 * Math.PI * i) / 100)), RATE);
    await writeWav(path.join(dir, "high.wav"), Float32Array.from({ length: RATE * 2 }, (_, i) => 0.5 * Math.sin((2 * Math.PI * i) / 8)), RATE);
    engine = new AudioEngine(new DataPaths(dir), {
      offline: true,
      onlyPluginPaths: true,
      pluginPaths: [],
      samplePath: (_project, id) => (["ramp", "tone", "high"].includes(id) ? path.join(dir, `${id}.wav`) : null),
    });
  });
  afterAll(async () => {
    engine.shutdown();
    await fs.rm(dir, { recursive: true, force: true });
  });
  beforeEach(async () => {
    await engine.command("stop", {});
    await hear(RATE / 10);
  });

  it("goes round its loop while the note is held, then plays on to the sample's end", async () => {
    // The loop from a quarter to a half of the ramp; the note a bar (two seconds) long.
    await play("ramp", { loop: { enabled: true, start: 0.25, end: 0.5 } });
    const left = (await hear(RATE * 2)).channels[0];
    // Past the loop's end, it's back in it: never above a half while held.
    expect(peakOf(left, 28_800, 91_200)).toBeLessThanOrEqual(0.5);
    expect(Math.min(...left.slice(28_800, 91_200))).toBeGreaterThanOrEqual(0.25 - 0.001);
    // Without the loop, a second of ramp, then silence.
    await engine.command("stop", {});
    await hear(RATE / 10);
    await play("ramp", {});
    expect(peakOf((await hear(RATE * 2)).channels[0], RATE + RATE / 10)).toBe(0);
  });

  it("filters its sound: a low pass takes a high tone away", async () => {
    await play("high", {});
    const open = peakOf((await hear(BEAT)).channels[0], 1000);
    await engine.command("stop", {});
    await hear(RATE / 10);
    await play("high", { filter: { type: "lowpass", cutoff: 0.3 } });
    const closed = peakOf((await hear(BEAT)).channels[0], 1000);
    expect(open).toBeCloseTo(0.5, 1);
    expect(closed).toBeLessThan(0.02);
  });

  it("moves its pitch with its pitch envelope, and its pan with its pan envelope", async () => {
    // An octave up (half of 24 semitones), at once and held.
    await play("tone", { mods: { pitch: { envelope: { enabled: true, attack: 0, decay: 0, sustain: 1, amount: 0.5 } } } });
    let left = (await hear(BEAT)).channels[0];
    // 480 Hz is 240 crossings in 12000 samples: an octave up, 480.
    expect(Math.abs(crossings(left, 1000, 13_000) - 480)).toBeLessThan(4);
    await engine.command("stop", {});
    await hear(RATE / 10);
    // All the way left: nothing on the right.
    await play("tone", { mods: { pan: { envelope: { enabled: true, attack: 0, decay: 0, sustain: 1, amount: -1 } } } });
    const sound = await hear(BEAT);
    left = sound.channels[0];
    expect(peakOf(left, 1000)).toBeGreaterThan(0.4);
    expect(peakOf(sound.channels[1], 1000)).toBeLessThan(0.001);
  });

  it("dips its volume with its LFO, and holds and bends its volume envelope", async () => {
    // A square at 2 Hz, all the way: on for a quarter second, off for the next.
    await play("tone", { mods: { volumeLfo: { enabled: true, shape: "square", speed: 2, amount: 1 } } });
    let left = (await hear(RATE / 2)).channels[0];
    expect(peakOf(left, 1000, 11_000)).toBeGreaterThan(0.45);
    expect(peakOf(left, 13_000, 23_000)).toBeLessThan(0.01);
    await engine.command("stop", {});
    await hear(RATE / 10);
    // Silent for its delay (a tenth of a second), then up at once and held.
    await play("tone", { envelope: { enabled: true, delay: 0.1, attack: 0, hold: 0.5, decay: 0.1, sustain: 0 } });
    left = (await hear(RATE)).channels[0];
    expect(peakOf(left, 0, 4700)).toBe(0);
    expect(peakOf(left, 5000, 20_000)).toBeGreaterThan(0.45);
    // After its hold and decay, nothing.
    expect(peakOf(left, 36_000)).toBeLessThan(0.001);
  });
});
