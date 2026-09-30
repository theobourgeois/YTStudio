/**
 * What a song sounds like: the real engine, offline (see `engine.integration.test.ts`), playing songs
 * made with the same edits and compiler as the app, and the rendered sound checked to the sample.
 * At 120 BPM and 48 kHz a beat is 24000 samples and a step 6000.
 */
import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { addChannels, setPatternSteps, setStepNote, setSteps, setSwing, setTempo, updateChannel } from "../../shared/music/edits.ts";
import { FIRST_PATTERN_ID, createMusicProject } from "../../shared/music/project.ts";
import type { MusicProject } from "../../shared/music/types.ts";
import { ENGINE } from "../config.ts";
import { DataPaths } from "../storage.ts";
import { AudioEngine } from "./engine.ts";
import { type WavData, onsets, peakOf, readWav, writeWav } from "./wav.ts";

const RATE = 48_000;
const BEAT = 24_000;
const STEP = 6_000;
const P = FIRST_PATTERN_ID;
const PROJECT = "proj_0123456789ab";
/** A hit: 10 ms of a steady half-scale level. */
const HIT = 480;

describe.skipIf(!existsSync(ENGINE))("the sequencer, offline", () => {
  let dir: string;
  let engine: AudioEngine;
  let render = 0;

  const play = (song: MusicProject) => engine.setSong({ projectId: PROJECT, song, patternId: P });
  /** The next `frames` samples of sound. */
  async function hear(frames: number): Promise<WavData> {
    const file = path.join(dir, `render-${render++}.wav`);
    await engine.render(frames, file);
    return readWav(file);
  }
  /** Kick on a channel with the hit sample, hat on one with the long sample. */
  const rack = () =>
    addChannels(createMusicProject("Test"), [
      { id: "chan_kick", name: "Kick", sampleId: "hit" },
      { id: "chan_pad", name: "Pad", sampleId: "long" },
    ]);

  beforeAll(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "sequencer-"));
    await writeWav(path.join(dir, "hit.wav"), new Float32Array(HIT).fill(0.5), RATE);
    await writeWav(path.join(dir, "long.wav"), new Float32Array(RATE * 2).fill(0.5), RATE);
    engine = new AudioEngine(new DataPaths(dir), {
      offline: true,
      onlyPluginPaths: true,
      pluginPaths: [],
      samplePath: (_project, id) => (id === "hit" || id === "long" ? path.join(dir, `${id}.wav`) : null),
    });
  });
  afterAll(async () => {
    engine.shutdown();
    await fs.rm(dir, { recursive: true, force: true });
  });
  beforeEach(async () => {
    await engine.command("stop", {});
    await engine.command("metronome", { on: false });
    await hear(RATE / 10);
  });

  it("is silent until it plays, then plays each step on its sample, and loops", async () => {
    await play(setSteps(rack(), P, "chan_kick", [0, 4, 8, 12], true));
    expect(peakOf((await hear(BEAT)).channels[0])).toBe(0);

    await engine.command("play", {});
    const sound = await hear(BEAT * 8);
    expect(onsets(sound.channels[0])).toEqual([0, 1, 2, 3, 4, 5, 6, 7].map((beat) => beat * BEAT));
    // The sample as it is: its own level, its own length, on both sides.
    expect(peakOf(sound.channels[0], 0, HIT - 1)).toBeCloseTo(0.5, 3);
    expect(peakOf(sound.channels[1], 0, HIT - 1)).toBeCloseTo(0.5, 3);
    expect(peakOf(sound.channels[0], HIT + 1, BEAT)).toBe(0);
  });

  it("says where it is, and goes back to the start when stopped", async () => {
    await play(setSteps(rack(), P, "chan_kick", [0], true));
    await engine.command("play", {});
    await hear(BEAT);
    let status = await engine.command("status", {});
    expect(status.transport.playing).toBe(true);
    // A beat in: 96 ticks, to within a block.
    expect(status.transport.tick).toBeGreaterThan(95);
    expect(status.transport.tick).toBeLessThan(99);

    await hear(BEAT * 3.5);
    expect((await engine.command("status", {})).transport.tick).toBeLessThan(384);
    status = await engine.command("stop", {});
    await hear(STEP);
    expect((await engine.command("status", {})).transport).toMatchObject({ playing: false, tick: 0 });
    await engine.command("play", {});
    expect(onsets((await hear(BEAT)).channels[0])).toEqual([0]);
  });

  it("swings every second step late", async () => {
    const song = setSteps(rack(), P, "chan_kick", [0, 1, 2, 3], true);
    await play(song);
    await engine.command("play", {});
    expect(onsets((await hear(BEAT)).channels[0])).toEqual([0, STEP, 2 * STEP, 3 * STEP]);

    await engine.command("stop", {});
    await play(setSwing(song, 1));
    await engine.command("play", {});
    expect(onsets((await hear(BEAT)).channels[0])).toEqual([0, STEP * 1.5, 2 * STEP, STEP * 3.5]);
  });

  it("follows the tempo and the pattern's length, even changed while it plays", async () => {
    const song = setSteps(rack(), P, "chan_kick", [0, 4], true);
    await play(setPatternSteps(setTempo(song, 240), P, 8));
    await engine.command("play", {});
    // Twice as fast, and half a bar long: a hit every beat, a beat being 12000 samples.
    expect(onsets((await hear(BEAT * 2)).channels[0])).toEqual([0, 12_000, 24_000, 36_000]);
    // Back to 120 BPM without stopping: the loop carries on from where it is, and nothing clicks.
    await play(setPatternSteps(song, P, 8));
    expect(onsets((await hear(BEAT * 2)).channels[0])).toEqual([0, BEAT]);
  });

  it("plays volume, pan, mute and velocity as gains", async () => {
    let song = setSteps(rack(), P, "chan_kick", [0, 4], true);
    song = setStepNote(song, P, "chan_kick", 4, { velocity: 0.39 });
    song = updateChannel(song, "chan_kick", { pan: 1, volume: 0.39 });
    await play(song);
    await engine.command("play", {});
    const sound = await hear(BEAT * 2);
    // Half the default level is a quarter of the gain, and so is half the default velocity.
    expect(peakOf(sound.channels[1], 0, HIT - 1)).toBeCloseTo(0.125, 3);
    expect(peakOf(sound.channels[1], BEAT, BEAT + HIT - 1)).toBeCloseTo(0.03125, 3);
    expect(peakOf(sound.channels[0])).toBe(0);

    await play(updateChannel(song, "chan_kick", { muted: true }));
    expect(peakOf((await hear(BEAT * 2)).channels[1])).toBe(0);
  });

  it("pitches a sample by playing it faster or slower", async () => {
    let song = setSteps(rack(), P, "chan_kick", [0, 8], true);
    song = setStepNote(song, P, "chan_kick", 8, { pitch: 48 });
    await play(updateChannel(song, "chan_kick", { pitch: 12 }));
    await engine.command("play", {});
    const left = (await hear(BEAT * 4)).channels[0];
    // An octave up (the channel's pitch) lasts half as long; the second note, an octave below that, as long as the sample.
    const length = (from: number) => left.subarray(from, from + BEAT).findIndex((v, i) => i > 10 && Math.abs(v) < 0.01);
    expect(length(0)).toBeGreaterThan(HIT / 2 - 4);
    expect(length(0)).toBeLessThan(HIT / 2 + 4);
    expect(length(2 * BEAT)).toBeGreaterThan(HIT - 4);
    expect(length(2 * BEAT)).toBeLessThan(HIT + 4);
  });

  it("plays a whole sample whatever the note's length, unless the channel has an envelope", async () => {
    const song = setSteps(rack(), P, "chan_pad", [0], true);
    await play(song);
    await engine.command("play", {});
    // Two seconds of sample: still sounding at the end of the bar.
    expect(peakOf((await hear(BEAT * 4)).channels[0], BEAT * 3.9)).toBeCloseTo(0.5, 2);

    await engine.command("stop", {});
    await play(updateChannel(song, "chan_pad", { envelope: { enabled: true, attack: 0.1, sustain: 0.5, decay: 0, release: 0.05 } }));
    await engine.command("play", {});
    const left = (await hear(BEAT)).channels[0];
    // It fades in over the attack (the step, 6000 samples, is over before it's done: 125 ms of 100)...
    expect(left[10]).toBeLessThan(0.01);
    expect(left[2400]).toBeCloseTo(0.25, 1);
    // ...and is gone a release after the step ends.
    expect(peakOf(left, STEP + 0.06 * RATE)).toBe(0);
  });

  it("stops what's sounding when it stops", async () => {
    await play(setSteps(rack(), P, "chan_pad", [0], true));
    await engine.command("play", {});
    await hear(STEP);
    await engine.command("stop", {});
    const left = (await hear(BEAT)).channels[0];
    // A fade of a few milliseconds, not a click, then nothing.
    expect(peakOf(left, 0, 10)).toBeGreaterThan(0.2);
    expect(peakOf(left, RATE * 0.01)).toBe(0);
  });

  it("clicks on every beat with the metronome, higher on the bar", async () => {
    await play(rack());
    await engine.command("metronome", { on: true });
    await engine.command("play", {});
    const left = (await hear(BEAT * 4)).channels[0];
    expect(onsets(left, 0.02, 2000)).toHaveLength(4);
    const crossings = (from: number) => {
      let count = 0;
      for (let i = from + 1; i < from + 960; i++) if (left[i - 1] < 0 !== left[i] < 0) count++;
      return count;
    };
    // 20 ms of 1760 Hz against 1175 Hz.
    expect(crossings(0)).toBeGreaterThan(crossings(BEAT) * 1.3);
  });

  it("plays a channel on its own when asked, without the song playing", async () => {
    await play(rack());
    await engine.command("trigger", { channel: "chan_kick" });
    const sound = await hear(BEAT);
    expect(onsets(sound.channels[0])).toEqual([0]);
    expect(peakOf(sound.channels[0], 0, HIT - 1)).toBeCloseTo(0.5, 3);
    await expect(engine.command("trigger", { channel: "chan_none" })).rejects.toMatchObject({ status: 409 });
  });

  it("plays the starter kit's drums (44.1 kHz files) at their own speed", async () => {
    const kit = path.resolve(import.meta.dirname, "..", "..", "public", "kit");
    const drums = new AudioEngine(new DataPaths(path.join(dir, "kit")), {
      offline: true,
      onlyPluginPaths: true,
      pluginPaths: [],
      samplePath: (_project, id) => path.join(kit, `${id}.wav`),
    });
    try {
      let song = addChannels(createMusicProject("Kit"), [
        { id: "chan_kick", name: "Kick", sampleId: "kick" },
        { id: "chan_hat", name: "Hat", sampleId: "hat" },
      ]);
      song = setSteps(song, P, "chan_kick", [0], true);
      song = setSteps(song, P, "chan_hat", [8], true);
      expect(await drums.setSong({ projectId: PROJECT, song, patternId: P })).toEqual({ unreadable: [] });
      await drums.command("play", {});
      const file = path.join(dir, "kit.wav");
      await drums.render(BEAT * 4, file);
      const left = (await readWav(file)).channels[0];
      expect(onsets(left, 0.02, 4000)).toEqual([0, 2 * BEAT]);
      // The kick lasts its 0.45 s, not 0.41 (which it would if 44.1 kHz were played as 48).
      expect(peakOf(left, 0.43 * RATE, 0.445 * RATE)).toBeGreaterThan(0.0005);
      expect(peakOf(left, 0.46 * RATE, 2 * BEAT - 1)).toBe(0);
    } finally {
      drums.shutdown();
    }
  });

  it("says which samples it couldn't read, and plays the rest", async () => {
    await fs.writeFile(path.join(dir, "broken.wav"), "not audio");
    const broken = new AudioEngine(new DataPaths(path.join(dir, "other")), {
      offline: true,
      onlyPluginPaths: true,
      pluginPaths: [],
      samplePath: (_project, id) => path.join(dir, `${id}.wav`),
    });
    try {
      const song = addChannels(rack(), [{ id: "chan_bad", name: "Bad", sampleId: "broken" }]);
      expect(await broken.setSong({ projectId: PROJECT, song, patternId: P })).toEqual({ unreadable: ["chan_bad"] });
      await expect(broken.setSong({ projectId: "nope", song, patternId: P })).rejects.toMatchObject({ status: 400 });
    } finally {
      broken.shutdown();
    }
  });
});
