/**
 * Stretched audio clips in the real engine, offline (see `engine.integration.test.ts`): Resample reads the
 * file faster or slower, Stretch mode runs it through the time stretcher (Signalsmith Stretch, in
 * `engine/src/AudioStream.cpp`), its pitch kept. What's checked: where the file's hits land (the stretcher
 * smears a hit a little, but its middle must be where the song says), the pitch, and that a render is the
 * same every time. At 120 BPM and 48 kHz a bar is 96000 samples. Skipped when the engine hasn't been built.
 */
import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { setChannelStretch, updateChannel } from "../../shared/music/edits.ts";
import { addAudioClips, editClips, setClipStretch } from "../../shared/music/playlist.ts";
import { FIRST_PATTERN_ID, createMusicProject } from "../../shared/music/project.ts";
import type { AudioStretch, MusicProject } from "../../shared/music/types.ts";
import { ENGINE } from "../config.ts";
import { DataPaths } from "../storage.ts";
import { AudioEngine } from "./engine.ts";
import { type WavData, readWav, writeWav } from "./wav.ts";

const RATE = 48_000;
const BAR_TICKS = 384;
const PROJECT = "proj_0123456789ab";
/** The hits file: a short burst (5 ms of 2 kHz) every half second (120 BPM's beats), four seconds of them. */
const HIT_EVERY = RATE / 2;
const HIT_LENGTH = 240;

/** A sine's frequency over `[from, to)`, from its rising zero crossings (to a fraction of a sample). */
function frequency(samples: Float32Array, from: number, to: number): number {
  let first = -1;
  let last = -1;
  let count = 0;
  for (let i = from + 1; i < to; i++)
    if (samples[i - 1] < 0 && samples[i] >= 0) {
      const at = i - 1 + samples[i - 1] / (samples[i - 1] - samples[i]);
      if (first < 0) first = at;
      last = at;
      count++;
    }
  return count > 1 ? ((count - 1) * RATE) / (last - first) : 0;
}

const cents = (hz: number, of: number) => 1200 * Math.log2(hz / of);

/** Where the loudest moment is in `[from, to)`: the middle of the 1 ms window with the most energy. */
function loudestAt(samples: Float32Array, from: number, to: number): number {
  const window = RATE / 1000;
  let best = from;
  let bestEnergy = -1;
  for (let at = Math.max(0, from); at + window <= Math.min(samples.length, to); at += 4) {
    let energy = 0;
    for (let i = at; i < at + window; i++) energy += samples[i] * samples[i];
    if (energy > bestEnergy) {
      bestEnergy = energy;
      best = at + window / 2;
    }
  }
  return best;
}

describe.skipIf(!existsSync(ENGINE))("stretched audio clips, offline", () => {
  let dir: string;
  let engine: AudioEngine;
  let render = 0;

  const play = (song: MusicProject) => engine.setSong({ projectId: PROJECT, song, patternId: FIRST_PATTERN_ID, mode: "song" });
  async function hear(frames: number): Promise<WavData> {
    const file = path.join(dir, `render-${render++}.wav`);
    await engine.render(frames, file);
    return readWav(file);
  }
  /** A song at 120 BPM with the file `sampleId` (`seconds` long) as an audio clip from its start, its clip stretched by `stretch`. */
  function song(sampleId: string, seconds: number, stretch?: AudioStretch): MusicProject {
    const made = addAudioClips(createMusicProject("Test", 120), [{ name: "Clip", sampleId, seconds, channelId: "chan_clip" }], { start: 0, track: 0 }).song;
    return stretch ? editClips(made, (clips) => setClipStretch(clips, new Set([clips[0].id]), stretch)) : made;
  }
  /** Where each hit lands in `sound`, near where `expected` says, in samples off. */
  const hitErrors = (sound: WavData, expected: number[]) => expected.map((at) => loudestAt(sound.channels[0], at - RATE / 20, at + RATE / 20) - at);

  beforeAll(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "stretch-"));
    const hits = new Float32Array(4 * RATE);
    for (let start = 0; start < hits.length; start += HIT_EVERY)
      for (let i = 0; i < HIT_LENGTH; i++) hits[start + i] = 0.8 * Math.sin((2 * Math.PI * 2000 * i) / RATE) * Math.sin((Math.PI * i) / HIT_LENGTH);
    await writeWav(path.join(dir, "hits.wav"), hits, RATE);
    // At 44.1 kHz, so the stream resamples it before it's stretched.
    await writeWav(
      path.join(dir, "sine.wav"),
      Array.from({ length: 4 * 44_100 }, (_, i) => 0.5 * Math.sin((2 * Math.PI * 440 * i) / 44_100)),
      44_100,
    );
    engine = new AudioEngine(new DataPaths(dir), {
      offline: true,
      onlyPluginPaths: true,
      pluginPaths: [],
      samplePath: (_project, id) => (["hits", "sine"].includes(id) ? path.join(dir, `${id}.wav`) : null),
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

  /** The middle of each hit in the file is 2.5 ms (half a hit) in. */
  const hitMiddle = HIT_LENGTH / 2;

  it("keeps the file's hits on their beats when it's stretched with its pitch kept", async () => {
    // Made at 160 BPM, played at 120: three quarters of its speed, a hit every two thirds of a second.
    await play(song("hits", 4, { mode: "stretch", tempo: 160 }));
    await engine.command("play", {});
    const sound = await hear(4 * RATE);
    const expected = [1, 2, 3, 4, 5].map((n) => Math.round((n * HIT_EVERY) / 0.75 + hitMiddle / 0.75));
    for (const error of hitErrors(sound, expected)) expect(Math.abs(error)).toBeLessThan(RATE / 1000);
  });

  it("starts in time when play starts inside a stretched clip", async () => {
    await play(song("hits", 4, { mode: "stretch", tempo: 160 }));
    // A bar in (two seconds of the song): a second and a half into the file.
    await engine.command("play", { from: BAR_TICKS });
    const sound = await hear(2 * RATE);
    // The file's hits at 2 and 2.5 seconds: half a second and a second and a sixth of the song later.
    const expected = [2, 2.5].map((s) => Math.round(((s - 1.5) * RATE) / 0.75 + hitMiddle / 0.75));
    for (const error of hitErrors(sound, expected)) expect(Math.abs(error)).toBeLessThan(RATE / 1000);
  });

  it("keeps its pitch when stretched, and the channel's pitch shifts it without changing the time", async () => {
    await play(song("sine", 4, { mode: "stretch", tempo: 60 }));
    await engine.command("play", {});
    const fast = await hear(2 * RATE);
    expect(Math.abs(cents(frequency(fast.channels[0], RATE / 2, RATE), 440))).toBeLessThan(3);
    // Twice as fast: the four-second file is over by two seconds.
    expect(Math.max(...fast.channels[0].slice(Math.round(1.6 * RATE), Math.round(1.8 * RATE)).map(Math.abs))).toBeGreaterThan(0.3);

    await engine.command("stop", {});
    await hear(RATE / 10);
    await play(updateChannel(song("sine", 4, { mode: "stretch", tempo: 240 }), "chan_clip", { pitch: 12 }));
    await engine.command("play", {});
    const up = await hear(2 * RATE);
    // Shifted and slowed at once, the stretcher is a few cents sharp (3.2 here; far below what's heard).
    expect(Math.abs(cents(frequency(up.channels[0], RATE / 2, Math.round(1.5 * RATE)), 880))).toBeLessThan(5);
  });

  it("is faster and higher in Resample, its channel's stretch followed by clips without their own", async () => {
    // The channel's stretch: made at 160 BPM, three quarters of its speed and pitch.
    await play(setChannelStretch(song("sine", 4), "chan_clip", { mode: "resample", tempo: 160 }));
    await engine.command("play", {});
    const sound = await hear(2 * RATE);
    expect(Math.abs(cents(frequency(sound.channels[0], RATE / 2, RATE), 330))).toBeLessThan(1);
  });

  it("sounds the same every time it's rendered", async () => {
    const stretched = song("hits", 4, { mode: "stretch", tempo: 150 });
    await play(stretched);
    await engine.command("play", {});
    const first = await hear(2 * RATE);
    await engine.command("stop", {});
    await hear(RATE / 10);
    await play(stretched);
    await engine.command("play", {});
    const second = await hear(2 * RATE);
    expect(second.channels[0]).toEqual(first.channels[0]);
  });
});
