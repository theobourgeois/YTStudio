/**
 * Gross Beat's sound (`docs/fl-studio/gross-beat.md`): the real engine, offline, playing songs with a
 * Gross Beat on the master, made with the app's own edits; where each hit lands checked to the sample.
 * At 120 BPM and 48 kHz a beat is 24000 samples.
 */
import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createAutomation, editPoints } from "../../shared/music/automation.ts";
import { addChannels, setSteps } from "../../shared/music/edits.ts";
import { type GrossBeatPatch, updateGrossBeat } from "../../shared/music/gross-beat.ts";
import { GROSS_BEAT_PLUGIN, GROSS_TIME_PRESETS, GROSS_VOLUME_PRESETS } from "../../shared/music/gross-beat-presets.ts";
import { setEffect, updateEffect } from "../../shared/music/mixer.ts";
import { addClips, editClips } from "../../shared/music/playlist.ts";
import { FIRST_PATTERN_ID, MASTER_TRACK_ID, createMusicProject } from "../../shared/music/project.ts";
import type { MusicProject } from "../../shared/music/types.ts";
import { ENGINE } from "../config.ts";
import { DataPaths } from "../storage.ts";
import { AudioEngine } from "./engine.ts";
import { type WavData, onsets, peakOf, readWav, writeWav } from "./wav.ts";

const RATE = 48_000;
const BEAT = 24_000;
const BAR = 4 * BEAT;
const P = FIRST_PATTERN_ID;
const PROJECT = "proj_0123456789ab";
/** A hit: 10 ms of a steady half-scale level. */
const HIT = 480;
const GROSS = "fx_gross";
const time = (name: string) => GROSS_TIME_PRESETS.findIndex((p) => p.name === name);
const volume = (name: string) => GROSS_VOLUME_PRESETS.findIndex((p) => p.name === name);

describe.skipIf(!existsSync(ENGINE))("Gross Beat, offline", () => {
  let dir: string;
  let engine: AudioEngine;
  let render = 0;

  const play = (song: MusicProject, mode: "pattern" | "song" = "pattern") => engine.setSong({ projectId: PROJECT, song, patternId: P, mode });
  async function hear(frames: number): Promise<WavData> {
    const file = path.join(dir, `render-${render++}.wav`);
    await engine.render(frames, file);
    return readWav(file);
  }
  /**
   * Where hits start, in beats, to the nearest 1/1000 (5 samples): a jump fades in over 3 ms (click
   * reduction), so a hit it lands on rises a sample or two late; reading between samples (half speed)
   * rings a few samples early.
   */
  const beats = (sound: WavData) => onsets(sound.channels[0]).map((at) => Math.round((at / BEAT) * 1000) / 1000);
  /** A song at 120 BPM: a kick on `steps`, a pad on `padSteps`, and a Gross Beat on the master set as `patch` says. */
  function song(steps: number[], patch: GrossBeatPatch = {}, padSteps: number[] = []) {
    let s = addChannels(createMusicProject("Chops", 120), [
      { id: "chan_kick", name: "Kick", sampleId: "hit" },
      { id: "chan_pad", name: "Pad", sampleId: "long" },
    ]);
    s = setSteps(s, P, "chan_kick", steps, true);
    if (padSteps.length) s = setSteps(s, P, "chan_pad", padSteps, true);
    s = setEffect(s, MASTER_TRACK_ID, 0, GROSS_BEAT_PLUGIN, GROSS);
    return updateGrossBeat(s, GROSS, patch);
  }

  beforeAll(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "gross-beat-"));
    await writeWav(path.join(dir, "hit.wav"), new Float32Array(HIT).fill(0.5), RATE);
    await writeWav(path.join(dir, "long.wav"), new Float32Array(RATE * 4).fill(0.5), RATE);
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
    await hear(RATE / 10);
  });

  it("leaves the sound exactly as it is with its Empty slots", async () => {
    await play(song([0, 4, 8, 12]));
    await engine.command("play", {});
    const sound = await hear(BAR);
    expect(beats(sound)).toEqual([0, 1, 2, 3]);
    expect(peakOf(sound.channels[0], 0, HIT)).toBe(0.5);
    expect(peakOf(sound.channels[0], HIT, BEAT)).toBe(0);
  });

  it("repeats the bar's first beat (1 Beat Rpt), and the first bar can't reach back before play", async () => {
    await play(song([0], { timeSlot: time("1 Beat Rpt") }));
    await engine.command("play", {});
    let sound = await hear(2 * BAR);
    expect(beats(sound)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    // Each repeat is the hit as it was, faded in over 3 ms (144 samples) by click reduction.
    expect(peakOf(sound.channels[0], 2 * BEAT + 150, 2 * BEAT + HIT)).toBe(0.5);
    expect(Math.abs(sound.channels[0][2 * BEAT + 20])).toBeLessThan(0.25);

    // Without click reduction, a jump is a cut: the hit is there from its first sample.
    await engine.command("stop", {});
    await play(song([0], { timeSlot: time("1 Beat Rpt"), clickReduction: false }));
    await engine.command("play", {});
    sound = await hear(BAR);
    expect(onsets(sound.channels[0])).toEqual([0, 1, 2, 3].map((b) => b * BEAT));
    expect(peakOf(sound.channels[0], 2 * BEAT, 2 * BEAT + 1)).toBe(0.5);

    // Reverse in the first bar reads before play started: silence.
    await engine.command("stop", {});
    await play(song([0, 4, 8, 12], { timeSlot: time("Reverse") }));
    await engine.command("play", {});
    expect(peakOf((await hear(BAR - 100)).channels[0], 200)).toBe(0);
  });

  it("plays half speed: two beats across the bar, the hits twice as long", async () => {
    await play(song([0, 4], { timeSlot: time("1/2 Speed") }));
    await engine.command("play", {});
    const sound = await hear(2 * BAR);
    expect(beats(sound)).toEqual([0, 2, 4, 6]);
    // Twice as long (give or take the interpolation at its ends).
    expect(peakOf(sound.channels[0], 2 * HIT - 10, 2 * HIT - 2)).toBeGreaterThan(0.45);
    expect(peakOf(sound.channels[0], 2 * HIT + 4, 2 * HIT + 200)).toBeLessThan(0.01);
  });

  it("gates the volume (1/4 Bt Gate), smoothed by ATT and REL", async () => {
    await play(song([], { volumeSlot: volume("1/4 Bt Gate") }, [0]));
    await engine.command("play", {});
    let sound = await hear(BEAT);
    // On for the first eighth of each quarter beat, off for the rest.
    const eighth = BEAT / 8;
    expect(peakOf(sound.channels[0], 10, eighth - 10)).toBeCloseTo(0.5, 5);
    expect(peakOf(sound.channels[0], eighth + 1, 2 * eighth - 1)).toBe(0);
    expect(peakOf(sound.channels[0], 2 * eighth + 1, 3 * eighth - 1)).toBeCloseTo(0.5, 5);

    // With a release, the gate closes over its time: 10 ms of the 31 ms off, half way down at 5 ms.
    await engine.command("stop", {});
    await play(song([], { volumeSlot: volume("1/4 Bt Gate"), release: 0.01 }, [0]));
    await engine.command("play", {});
    sound = await hear(BEAT);
    expect(sound.channels[0][eighth + 240]).toBeCloseTo(0.25, 2);
    expect(peakOf(sound.channels[0], eighth + 490, 2 * eighth - 1)).toBe(0);
  });

  it("mixes: the slot's mix knob and the Time knob", async () => {
    await play(updateEffect(song([0], { volumeSlot: volume("Mute") }), MASTER_TRACK_ID, 0, { mix: 0.25 }));
    await engine.command("play", {});
    expect(peakOf((await hear(BEAT)).channels[0], 0, HIT)).toBeCloseTo(0.375, 5);

    // Half the Time knob: half the offset (1 Beat Rpt reaches back half a beat at beat 1).
    await engine.command("stop", {});
    await play(song([0, 2], { timeSlot: time("1 Beat Rpt"), timeMix: 0.5 }));
    await engine.command("play", {});
    expect(beats(await hear(2 * BEAT))).toEqual([0, 0.5, 1]);
  });

  it("starts a slot picked while playing on the next TRIG SYNC point, and plays a one-shot once", async () => {
    const base = song([0, 4, 8, 12], { trigSync: 1 });
    await play(base);
    await engine.command("play", {});
    await hear(BEAT * 1.5);
    await play(updateGrossBeat(base, GROSS, { timeSlot: time("1/2 Repeat") }));
    let status = await hear(100).then(() => engine.command("status", {}));
    expect(status.transport.grossBeats?.[GROSS]).toMatchObject({ time: 0, queuedTime: time("1/2 Repeat") });
    await hear(BEAT / 2);
    status = await engine.command("status", {});
    expect(status.transport.grossBeats?.[GROSS]).toMatchObject({ time: time("1/2 Repeat"), queuedTime: null });

    // One-shot: a bar of 1 Beat Rpt, then slot 1 (Empty) carries on.
    await engine.command("stop", {});
    await play(song([0], { timeSlot: time("1 Beat Rpt"), oneShot: true }));
    await engine.command("play", {});
    expect(beats(await hear(3 * BAR))).toEqual([0, 1, 2, 3, 4, 8]);
    expect((await engine.command("status", {})).transport.grossBeats?.[GROSS]).toMatchObject({ time: 0 });
  });

  it("switches slots as an automation clip says, in song mode, on the bar", async () => {
    let s = song([0]);
    s = editClips(s, (clips) => addClips(clips, [0, 384].map((start) => ({ kind: "pattern" as const, ref: P, track: 0, start, length: null }))).clips);
    const made = createAutomation(s, { kind: "grossBeat", effect: GROSS, control: "timeSlot" }, { start: 0, length: 384 * 2 }, { id: "auto_slot" });
    s = editPoints(made.song, "auto_slot", () => [
      { tick: 0, value: 0, tension: 0, curve: "single" },
      { tick: 384, value: time("1 Beat Rpt") / 35, tension: 0, curve: "hold" },
    ]);
    await play(s, "song");
    await engine.command("play", {});
    expect(beats(await hear(2 * BAR))).toEqual([0, 4, 5, 6, 7]);
  });

  it("repeats the last bar while HOLD is held, whatever comes in meanwhile", async () => {
    await play(song([4], { hold: "last" }));
    await engine.command("play", {});
    expect(beats(await hear(BAR))).toEqual([1]);
    await engine.command("grossBeat", { effect: GROSS, hold: true });
    // The kick's gone from the song, but the held bar has it.
    await play(song([], { hold: "last" }));
    expect(beats(await hear(2 * BAR))).toEqual([1, 5]);
    expect((await engine.command("status", {})).transport.grossBeats?.[GROSS]?.holding).toBe(true);
    await engine.command("grossBeat", { effect: GROSS, hold: false });
    expect(beats(await hear(BAR))).toEqual([]);
    await expect(engine.command("grossBeat", { effect: "fx_none", hold: true })).rejects.toMatchObject({ status: 409 });
  });

  it("starts afresh after it's been bypassed (its buffer missed what came in meanwhile)", async () => {
    const base = song([0, 4, 8, 12], { timeSlot: time("Reverse"), clickReduction: false });
    await play(base);
    await engine.command("play", {});
    await hear(BAR);
    // Its second bar plays the first backwards: hits.
    expect(beats(await hear(BAR)).length).toBeGreaterThan(1);
    // Bypassed through the third bar; back on in the fourth, which can't reach back before then: only
    // the hit on its first sample (now) is heard, not the bar it missed.
    await play(updateEffect(base, MASTER_TRACK_ID, 0, { enabled: false }));
    expect(beats(await hear(BAR))).toEqual([0, 1, 2, 3]);
    await play(base);
    expect(beats(await hear(BAR))).toEqual([0]);
  });

  it("exports as it plays, from an empty buffer of its own (playback's is left alone)", async () => {
    let s = song([0], { timeSlot: time("1 Beat Rpt"), clickReduction: false });
    s = editClips(s, (clips) => addClips(clips, [0, 384].map((start) => ({ kind: "pattern" as const, ref: P, track: 0, start, length: null }))).clips);
    await play(s, "song");
    await engine.command("play", {});
    await hear(BAR / 2);
    await engine.command("stop", {});
    const folder = path.join(dir, "exported");
    const result = await engine.renderExport({ id: "exp_gross", projectId: PROJECT, song: s, patternId: P, mode: "song", loop: null, resampling: "sinc", folder, mix: true, stems: false, tail: "cut" });
    expect(result.state).toBe("done");
    expect(result.missing).toEqual([]);
    const mix = await readWav(path.join(folder, "mix.wav"));
    expect(onsets(mix.channels[0])).toEqual([0, 1, 2, 3, 4, 5, 6, 7].map((b) => b * BEAT));
  });
});
