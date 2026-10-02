/**
 * PanMan's sound (`docs/soundtoys/panman.md`): the real engine, offline, playing songs with a PanMan on the
 * master, made with the app's own edits. A steady sound (a constant level) shows where it's put, sample
 * by sample, from its two sides: the angle of (left, right) is the position. At 120 BPM and 48 kHz a beat
 * is 24000 samples.
 */
import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createAutomation, editPoints } from "../../shared/music/automation.ts";
import { addChannels, setSteps } from "../../shared/music/edits.ts";
import { setEffect } from "../../shared/music/mixer.ts";
import { cycleValue, panDegrees, panPattern, updatePanMan } from "../../shared/music/panman.ts";
import { DEFAULT_PANMAN, PANMAN_PLUGIN, PAN_STYLES } from "../../shared/music/panman-presets.ts";
import { addClips, editClips } from "../../shared/music/playlist.ts";
import { FIRST_PATTERN_ID, MASTER_TRACK_ID, createMusicProject } from "../../shared/music/project.ts";
import type { MusicProject, PanMan } from "../../shared/music/types.ts";
import { ENGINE } from "../config.ts";
import { DataPaths } from "../storage.ts";
import { AudioEngine } from "./engine.ts";
import { type WavData, readWav, writeWav } from "./wav.ts";

const RATE = 48_000;
const BEAT = 24_000;
const BAR = 4 * BEAT;
const P = FIRST_PATTERN_ID;
const PROJECT = "proj_0123456789ab";
const PAN = "fx_pan";
/** A hit: 10 ms of a steady half-scale level. */
const HIT = 480;

/** Where a sample is (degrees, ±90 hard left / right), from its two sides. */
function degreesAt(sound: WavData, i: number) {
  const [left, right] = [sound.channels[0][i], sound.channels[1][i]];
  return (Math.atan2(right, left) / (Math.PI / 2)) * 180 - 90;
}
/** How much louder (the sum of its levels) a stretch of sound is on the right than the left. */
function side(sound: WavData, from: number, to: number) {
  let left = 0;
  let right = 0;
  for (let i = from; i < to; i++) {
    left += Math.abs(sound.channels[0][i]);
    right += Math.abs(sound.channels[1][i]);
  }
  return right > 4 * left ? "R" : left > 4 * right ? "L" : "C";
}
const rms = (samples: Float32Array, from: number, to: number) => {
  let sum = 0;
  for (let i = from; i < to; i++) sum += samples[i] ** 2;
  return Math.sqrt(sum / (to - from));
};

describe.skipIf(!existsSync(ENGINE))("PanMan, offline", () => {
  let dir: string;
  let engine: AudioEngine;
  let render = 0;

  const play = (song: MusicProject, mode: "pattern" | "song" = "pattern") => engine.setSong({ projectId: PROJECT, song, patternId: P, mode });
  async function hear(frames: number): Promise<WavData> {
    const file = path.join(dir, `render-${render++}.wav`);
    await engine.render(frames, file);
    return readWav(file);
  }
  /** A song at 120 BPM: `sample` on `steps`, and a PanMan on the master set as `patch` says (none: no PanMan). */
  function song(patch: Partial<PanMan> | null, sample: "long" | "hit" | "sine" = "long", steps = [0]) {
    let s = addChannels(createMusicProject("Pans", 120), [{ id: "chan_one", name: "One", sampleId: sample }]);
    s = setSteps(s, P, "chan_one", steps, true);
    if (!patch) return s;
    s = setEffect(s, MASTER_TRACK_ID, 0, PANMAN_PLUGIN, PAN);
    return updatePanMan(s, PAN, patch);
  }
  const settings = (s: MusicProject) => s.mixer.tracks[0].effects[0]!.panMan!;

  beforeAll(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "panman-"));
    await writeWav(path.join(dir, "hit.wav"), new Float32Array(HIT).fill(0.5), RATE);
    await writeWav(path.join(dir, "long.wav"), new Float32Array(RATE * 4).fill(0.5), RATE);
    // A quiet 1 kHz sine (-26 dBFS), four seconds.
    await writeWav(path.join(dir, "sine.wav"), Float32Array.from({ length: RATE * 4 }, (_, i) => 0.05 * Math.sin((2 * Math.PI * 1000 * i) / RATE)), RATE);
    engine = new AudioEngine(new DataPaths(dir), {
      offline: true,
      onlyPluginPaths: true,
      pluginPaths: [],
      samplePath: (_project, id) => (["hit", "long", "sine"].includes(id) ? path.join(dir, `${id}.wav`) : null),
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

  it("pans slowly back and forth as it comes (LFO, 0.5 Hz), from the left when play starts, as the pattern says", async () => {
    const s = song({});
    await play(s);
    await engine.command("play", {});
    const sound = await hear(2 * RATE);
    for (const seconds of [0.05, 0.25, 0.5, 0.8, 1, 1.3, 1.9]) {
      const want = panDegrees(0, 180, cycleValue("both", DEFAULT_PANMAN.smoothing, seconds * DEFAULT_PANMAN.rate));
      expect(Math.abs(degreesAt(sound, Math.round(seconds * RATE)) - want)).toBeLessThan(0.5);
    }
    expect(side(sound, 0, RATE / 20)).toBe("L");
    expect(side(sound, RATE - RATE / 40, RATE + RATE / 40)).toBe("R");
  });

  it("steps in time with the song (Rhythm Step), from where play starts in it", async () => {
    // The sound on every beat, so it's there wherever play starts.
    const s = song({ mode: "rhythmStep", rhythm: "1/4", steps: 3, direction: "down", smoothing: 0 }, "long", [0, 4, 8, 12]);
    await play(s);
    await engine.command("play", {});
    const sound = await hear(BAR);
    expect([0, 1, 2, 3].map((beat) => Math.round(degreesAt(sound, beat * BEAT + BEAT / 2)))).toEqual([90, 0, -90, 90]);
    // A jump on the beat, done within 2 ms (98% of it in one).
    expect(Math.round(degreesAt(sound, BEAT - 2))).toBe(90);
    expect(Math.abs(degreesAt(sound, BEAT + 48))).toBeLessThan(2);
    expect(Math.round(degreesAt(sound, BEAT + 96))).toBe(0);
    // Played from the second beat: its step, not the first.
    await engine.command("stop", {});
    await hear(RATE / 10);
    await engine.command("play", { from: 96 });
    const later = await hear(BEAT);
    expect(Math.round(degreesAt(later, BEAT / 2))).toBe(0);
  });

  it("steps at its own tempo out of sync, from when play starts", async () => {
    await play(song({ mode: "rhythmStep", rhythm: "1/4", steps: 2, smoothing: 0, sync: false, tempo: 60 }));
    await engine.command("play", {});
    const sound = await hear(2 * RATE);
    expect(Math.round(degreesAt(sound, RATE / 2))).toBe(-90);
    expect(Math.round(degreesAt(sound, RATE + RATE / 2))).toBe(90);
  });

  it("glides with Smoothing in the Smoothing Mode's curve, as the pattern says", async () => {
    const s = song({ mode: "rhythmStep", rhythm: "1/2", steps: 2, smoothing: 0.5 });
    await play(s);
    await engine.command("play", {});
    const sound = await hear(BAR);
    const pattern = panPattern(settings(s))!;
    for (const tick of [30, 100, 150, 170, 190, 250, 330]) expect(Math.abs(degreesAt(sound, Math.round((tick / 96) * BEAT)) - panDegrees(0, 180, pattern.value(tick)))).toBeLessThan(0.5);
  });

  it("is the sound itself at the centre (Clean, unity), and keeps its power wherever it is", async () => {
    await play(song(null));
    await engine.command("play", {});
    const dry = await hear(BEAT);
    await engine.command("stop", {});
    await hear(RATE / 10);
    await play(song({ width: 0 }));
    await engine.command("play", {});
    const wet = await hear(BEAT);
    for (const i of [10, 1000, 20_000]) {
      expect(wet.channels[0][i]).toBeCloseTo(dry.channels[0][i], 6);
      expect(wet.channels[1][i]).toBeCloseTo(dry.channels[1][i], 6);
    }
    await engine.command("stop", {});
    await hear(RATE / 10);
    // Anywhere, even beyond the speakers (the far side a little inverted): the same power.
    for (const offset of [-45, 70, 105]) {
      await play(song({ width: 0, offset }));
      await engine.command("play", {});
      const sound = await hear(BEAT / 4);
      const [l, r] = [sound.channels[0][3000], sound.channels[1][3000]];
      expect(l ** 2 + r ** 2).toBeCloseTo(2 * 0.25, 5);
      if (offset === 105) expect(l).toBeLessThan(0);
      await engine.command("stop", {});
      await hear(RATE / 10);
    }
  });

  it("goes somewhere new each step at random (Random), the same places every time it plays", async () => {
    const s = song({ mode: "random", rhythm: "1/4", smoothing: 0 });
    const places = async () => {
      await play(s);
      await engine.command("play", {});
      const sound = await hear(BAR);
      await engine.command("stop", {});
      await hear(RATE / 10);
      return [0, 1, 2, 3].map((beat) => {
        const start = degreesAt(sound, beat * BEAT + 200);
        expect(Math.abs(degreesAt(sound, beat * BEAT + BEAT - 200) - start)).toBeLessThan(0.01);
        return Math.round(start * 100) / 100;
      });
    };
    const first = await places();
    expect(new Set(first.map(Math.round)).size).toBeGreaterThan(2);
    for (const place of first) expect(Math.abs(place)).toBeLessThanOrEqual(90);
    expect(await places()).toEqual(first);
  });

  it("bounces side to side on the hits (PingPong), every hit or every second one (Divider)", async () => {
    const hits = async (patch: Partial<PanMan>) => {
      await play(song({ mode: "pingPong", trigger: -20, smoothing: 0, ...patch }, "hit", [0, 4, 8, 12]));
      await engine.command("play", {});
      const sound = await hear(BAR);
      await engine.command("stop", {});
      await hear(RATE / 10);
      return [0, 1, 2, 3].map((beat) => side(sound, beat * BEAT + 60, beat * BEAT + HIT));
    };
    // From the left: each hit moves it, so the first is heard on the right.
    expect(await hits({})).toEqual(["R", "L", "R", "L"]);
    expect(await hits({ divider: 2 })).toEqual(["L", "R", "R", "L"]);
    // A high-pass at 6 kHz leaves only each hit's edges, 12 dB under its level: a Trigger at -10 dB hears nothing.
    expect(await hits({ trigger: -10, filter: "hpf", cutoff: 6000 })).toEqual(["L", "L", "L", "L"]);
    expect(await hits({ trigger: -10, filter: "hpf", cutoff: 6000, filterGain: 20 })).toEqual(["R", "L", "R", "L"]);
  });

  it("moves on a Manual Trigger, and plays what the trigger hears unpanned with Monitor", async () => {
    await play(song({ mode: "pingPong", trigger: 0, smoothing: 0 }));
    await engine.command("play", {});
    const before = await hear(RATE / 10);
    expect(side(before, 0, before.channels[0].length)).toBe("L");
    await engine.command("panMan", { effect: PAN, trigger: true });
    const after = await hear(RATE / 10);
    expect(side(after, 100, after.channels[0].length)).toBe("R");
    await play(song({ mode: "pingPong", trigger: 0, monitor: true }));
    const monitored = await hear(RATE / 10);
    expect(monitored.channels[0][2000]).toBeCloseTo(0.5, 5);
    expect(monitored.channels[1][2000]).toBeCloseTo(0.5, 5);
  });

  it("goes to a random place on each hit (Step), the same each time", async () => {
    const places = async () => {
      await play(song({ mode: "step", trigger: -20, smoothing: 0 }, "hit", [0, 4, 8, 12]));
      await engine.command("play", {});
      const sound = await hear(BAR);
      await engine.command("stop", {});
      await hear(RATE / 10);
      return [0, 1, 2, 3].map((beat) => Math.round(degreesAt(sound, beat * BEAT + 200)));
    };
    const first = await places();
    expect(new Set(first).size).toBeGreaterThan(2);
    expect(await places()).toEqual(first);
  });

  it("moves its offset with the sound's level (the dynamics), only over the threshold", async () => {
    await play(song({ width: 0, offsetMod: 90, gate: true, threshold: -20, attack: 0, release: 0 }));
    await engine.command("play", {});
    const loud = await hear(BEAT / 4);
    expect(Math.round(degreesAt(loud, 2000))).toBe(90);
    await engine.command("stop", {});
    await hear(RATE / 10);
    await play(song({ width: 0, offsetMod: 90, gate: true, threshold: -3, attack: 0, release: 0 }));
    await engine.command("play", {});
    const quiet = await hear(BEAT / 4);
    expect(Math.round(degreesAt(quiet, 2000))).toBe(0);
    // Env: as far as the level is over the threshold (-6 dB of -20's way to 0: 70%), reached in a straight
    // line at the Attack's pace (all the way in 100 ms).
    await engine.command("stop", {});
    await hear(RATE / 10);
    await play(song({ width: 0, offsetMod: 90, threshold: -20, attack: 0.1, release: 0 }));
    await engine.command("play", {});
    const env = await hear(RATE / 4);
    const full = (20 + 20 * Math.log10(0.5)) / 20;
    expect(degreesAt(env, RATE / 40)).toBeCloseTo(90 * 0.25, 0);
    expect(degreesAt(env, RATE / 5)).toBeCloseTo(90 * full, 0);
  });

  it("follows its offset's automation in song mode", async () => {
    let s = song({ width: 0 });
    s = editClips(s, (clips) => addClips(clips, [{ kind: "pattern", ref: P, track: 0, start: 0, length: 384 }]).clips);
    const made = createAutomation(s, { kind: "panMan", effect: PAN, control: "offset" }, { start: 0, length: 384 }, { id: "auto_offset" });
    s = editPoints(made.song, "auto_offset", () => [
      { tick: 0, value: 0, tension: 0, curve: "single" },
      { tick: 384, value: 1, tension: 0, curve: "single" },
    ]);
    await play(s, "song");
    await engine.command("play", {});
    const sound = await hear(BAR);
    expect(degreesAt(sound, BAR / 4)).toBeCloseTo(-52.5, 0);
    expect(degreesAt(sound, BAR / 2)).toBeCloseTo(0, 0);
  });

  it("follows its automated Feel: the pattern played late (draggin'), sent whole", async () => {
    let s = song({ mode: "rhythmStep", rhythm: "1/4", steps: 3, direction: "down", smoothing: 0 }, "long", [0, 4, 8, 12]);
    s = editClips(s, (clips) => addClips(clips, [{ kind: "pattern", ref: P, track: 0, start: 0, length: 384 }]).clips);
    // Feel at its most (a sixteenth late) all through.
    s = createAutomation(s, { kind: "panMan", effect: PAN, control: "feel" }, { start: 0, length: 384 }, { value: 1 }).song;
    await play(s, "song");
    await engine.command("play", {});
    const sound = await hear(BAR);
    // Each step a sixteenth late: just after the beat it's still the last one, then the next.
    expect(Math.round(degreesAt(sound, BEAT + BEAT / 8))).toBe(90);
    expect(Math.round(degreesAt(sound, BEAT + BEAT / 2))).toBe(0);
    expect(Math.round(degreesAt(sound, 2 * BEAT + BEAT / 2))).toBe(-90);
  });

  it("follows its automated Threshold (the dynamics, gated): the automation's threshold is heard, not its own", async () => {
    // The sound at -6 dBFS; its own threshold says one thing, the automation (all through) the other.
    const at = async (own: number, automated: number) => {
      let s = song({ width: 0, offsetMod: 90, gate: true, threshold: own, attack: 0, release: 0 });
      s = editClips(s, (clips) => addClips(clips, [{ kind: "pattern", ref: P, track: 0, start: 0, length: 384 }]).clips);
      s = createAutomation(s, { kind: "panMan", effect: PAN, control: "threshold" }, { start: 0, length: 384 }, { value: (automated + 40) / 40 }).song;
      await engine.command("stop", {});
      await hear(RATE / 10);
      await play(s, "song");
      await engine.command("play", {});
      return Math.round(degreesAt(await hear(BEAT / 4), 2000));
    };
    expect(await at(-3, -20)).toBe(90);
    expect(await at(-20, -3)).toBe(0);
  });

  it("colours the sound by its Analog Style: near the sound itself when quiet, each its own when driven", async () => {
    const levels: Record<string, number> = {};
    const peaks: Record<string, number> = {};
    for (const { id } of PAN_STYLES) {
      await play(song({ width: 0, style: id }, "sine"));
      await engine.command("play", {});
      const quiet = await hear(RATE / 4);
      levels[id] = rms(quiet.channels[0], RATE / 10, RATE / 4);
      await engine.command("stop", {});
      await hear(RATE / 10);
      await play(song({ width: 0, style: id, input: 24 }, "sine"));
      await engine.command("play", {});
      const loud = await hear(RATE / 4);
      peaks[id] = Math.max(...loud.channels[0].subarray(RATE / 10));
      expect(Number.isFinite(peaks[id])).toBe(true);
      await engine.command("stop", {});
      await hear(RATE / 10);
    }
    // Clean is the sound itself; the others within 1.5 dB of it at -26 dBFS (Pump's makeup is louder by design).
    expect(levels.clean).toBeCloseTo(0.05 / Math.SQRT2, 4);
    for (const id of ["fat", "squash", "dirt", "crunch"]) expect(Math.abs(20 * Math.log10(levels[id] / levels.clean))).toBeLessThan(1.5);
    // Driven 24 dB (to 0.8 peak): Clean holds full scale; each style is its own.
    expect(peaks.clean).toBeLessThanOrEqual(1);
    expect(new Set(Object.values(peaks).map((p) => p.toFixed(3))).size).toBeGreaterThan(4);
  });
});
