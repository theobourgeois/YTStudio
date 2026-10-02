/**
 * Auto-Tune's sound (`docs/antares/auto-tune.md`): the real engine, offline, playing a sung vowel (made
 * here, harmonic by harmonic, under a vowel's formants) through an Auto-Tune on the master, set with the
 * app's own edits; the pitch, formants, level and delay of what comes out measured.
 */
import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { type AutoTunePatch, setAutoTuneNote, updateAutoTune } from "../../shared/music/auto-tune.ts";
import { AUTO_TUNE_PLUGIN } from "../../shared/music/auto-tune-presets.ts";
import { createAutomation, editPoints } from "../../shared/music/automation.ts";
import { addChannels, setSteps } from "../../shared/music/edits.ts";
import { setEffect, updateEffect } from "../../shared/music/mixer.ts";
import { addClips, editClips } from "../../shared/music/playlist.ts";
import { FIRST_PATTERN_ID, MASTER_TRACK_ID, createMusicProject } from "../../shared/music/project.ts";
import type { MusicProject } from "../../shared/music/types.ts";
import { ENGINE } from "../config.ts";
import { DataPaths } from "../storage.ts";
import { AudioEngine } from "./engine.ts";
import { type WavData, readWav, writeWav } from "./wav.ts";

const RATE = 48_000;
const P = FIRST_PATTERN_ID;
const PROJECT = "proj_0123456789ab";
const TUNE = "fx_tune";
/** The sample: 1.8 s of a vowel (the pattern's bar is 2 s at 120 BPM, so it plays once). */
const LENGTH = Math.round(1.8 * RATE);

/** An "ah": its formants (Hz, width, level). */
const AH = [
  [700, 110, 1],
  [1220, 120, 0.5],
  [2600, 160, 0.25],
] as const;
const formantLevel = (f: number) => AH.reduce((sum, [centre, width, level]) => sum + level / (1 + ((f - centre) / width) ** 2), 0.02);

/**
 * A sung vowel at `pitch` (Hz, or Hz by time in seconds), harmonic by harmonic under the formants (so they
 * stay where they are whatever the pitch), at about half scale.
 */
function vowel(pitch: number | ((t: number) => number), length = LENGTH): Float32Array {
  const out = new Float32Array(length);
  const at = typeof pitch === "number" ? () => pitch : pitch;
  let phase = 0;
  for (let i = 0; i < length; i++) {
    const f0 = at(i / RATE);
    phase += f0 / RATE;
    let v = 0;
    for (let k = 1; k * f0 < 5000; k++) v += formantLevel(k * f0) * Math.sin(2 * Math.PI * k * phase);
    out[i] = v;
  }
  let peak = 0;
  for (const v of out) peak = Math.max(peak, Math.abs(v));
  // A 10 ms fade at each end: no click to hear as a pitch.
  const fade = RATE / 100;
  for (let i = 0; i < length; i++) out[i] = (out[i] / peak) * 0.5 * Math.min(1, i / fade, (length - 1 - i) / fade);
  return out;
}

/** The pitch in `[from, from + 2048)` (Hz), by YIN, between 60 and 1200 Hz; 0 for none. */
function pitchOf(samples: Float32Array, from: number, size = 2048): number {
  const maxTau = Math.floor(RATE / 60);
  const minTau = Math.floor(RATE / 1200);
  const w = size - maxTau;
  const d = new Float64Array(maxTau + 1);
  let running = 0;
  d[0] = 1;
  for (let tau = 1; tau <= maxTau; tau++) {
    let sum = 0;
    for (let j = 0; j < w; j++) {
      const e = samples[from + j] - samples[from + j + tau];
      sum += e * e;
    }
    running += sum;
    d[tau] = running ? (sum * tau) / running : 1;
  }
  let best = -1;
  for (let tau = minTau; tau < maxTau; tau++)
    if (d[tau] < 0.15) {
      while (tau + 1 < maxTau && d[tau + 1] < d[tau]) tau++;
      best = tau;
      break;
    }
  if (best < 0) return 0;
  const [a, b, c] = [d[best - 1], d[best], d[best + 1]];
  const shift = a - 2 * b + c > 0 ? (0.5 * (a - c)) / (a - 2 * b + c) : 0;
  return RATE / (best + shift);
}

/** How alike `[from, from + 4096)` is to itself `hz`'s period later (1: exactly periodic at it). */
function periodicity(samples: Float32Array, from: number, hz: number): number {
  const lag = RATE / hz;
  const whole = Math.floor(lag);
  const f = lag - whole;
  let dot = 0;
  let a = 0;
  let b = 0;
  for (let i = from; i < from + 4096; i++) {
    const later = samples[i + whole] * (1 - f) + samples[i + whole + 1] * f;
    dot += samples[i] * later;
    a += samples[i] ** 2;
    b += later ** 2;
  }
  return dot / Math.sqrt(a * b);
}

/** Cents from `b` to `a`. */
const cents = (a: number, b: number) => 1200 * Math.log2(a / b);

/** The pitches through `[from, to)`, a reading every `step` samples. */
function pitches(samples: Float32Array, from: number, to: number, step = 960): number[] {
  const out: number[] = [];
  for (let at = from; at + 2048 <= to; at += step) out.push(pitchOf(samples, at));
  return out;
}

/** The middle reading of a list (one outlier doesn't move it). */
const median = (list: number[]) => [...list].sort((a, b) => a - b)[Math.floor(list.length / 2)];

function rms(samples: Float32Array, from: number, to: number): number {
  let sum = 0;
  for (let i = from; i < to; i++) sum += samples[i] * samples[i];
  return Math.sqrt(sum / (to - from));
}

/** The spectral centroid (Hz) of `[from, from + 8192)`: where its formants put its brightness. */
function centroid(samples: Float32Array, from: number): number {
  const n = 8192;
  const re = new Float64Array(n);
  const im = new Float64Array(n);
  for (let i = 0; i < n; i++) re[i] = samples[from + i] * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / n));
  // An in-place radix-2 FFT.
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const angle = (-2 * Math.PI) / len;
    for (let i = 0; i < n; i += len)
      for (let k = 0; k < len / 2; k++) {
        const [wr, wi] = [Math.cos(angle * k), Math.sin(angle * k)];
        const [ur, ui] = [re[i + k], im[i + k]];
        const [vr, vi] = [re[i + k + len / 2] * wr - im[i + k + len / 2] * wi, re[i + k + len / 2] * wi + im[i + k + len / 2] * wr];
        re[i + k] = ur + vr;
        im[i + k] = ui + vi;
        re[i + k + len / 2] = ur - vr;
        im[i + k + len / 2] = ui - vi;
      }
  }
  let weighted = 0;
  let total = 0;
  for (let k = 1; k < n / 2; k++) {
    const f = (k * RATE) / n;
    if (f > 6000) break;
    const m = Math.hypot(re[k], im[k]);
    weighted += f * m;
    total += m;
  }
  return weighted / total;
}

describe.skipIf(!existsSync(ENGINE))("Auto-Tune, offline", () => {
  let dir: string;
  let engine: AudioEngine;
  let render = 0;
  const samples = new Map<string, Float32Array>();

  async function hear(frames: number): Promise<WavData> {
    const file = path.join(dir, `render-${render++}.wav`);
    await engine.render(frames, file);
    return readWav(file);
  }
  /** A song at 120 BPM playing the sample `name` once, through an Auto-Tune on the master set as `patch` says. */
  function song(name: string, patch: AutoTunePatch = {}, edit: (s: MusicProject) => MusicProject = (s) => s): MusicProject {
    let s = addChannels(createMusicProject("Vocal", 120), [{ id: "chan_vox", name: "Vox", sampleId: name }]);
    s = setSteps(s, P, "chan_vox", [0], true);
    s = setEffect(s, MASTER_TRACK_ID, 0, AUTO_TUNE_PLUGIN, TUNE);
    return edit(updateAutoTune(s, TUNE, patch));
  }
  /** Play `s` from its start and hear 1.9 s of it. */
  async function play(s: MusicProject): Promise<Float32Array> {
    await engine.setSong({ projectId: PROJECT, song: s, patternId: P, mode: "pattern" });
    await engine.command("play", {});
    return (await hear(Math.round(1.9 * RATE))).channels[0];
  }
  const latency = async () => (await engine.command("status", {})).songLatency;
  /** The steady part of a note heard: from 0.3 s to 1.5 s after it starts (`delay` later for the Auto-Tune's). */
  const steady = (sound: Float32Array, delay: number) => median(pitches(sound, delay + 0.3 * RATE, delay + 1.5 * RATE));

  beforeAll(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "auto-tune-"));
    const made: Record<string, Float32Array> = {
      // A3 is 220 Hz: this is 39 cents sharp of it.
      sharp: vowel(225),
      // The same, for the formants.
      high: vowel(225),
      // 10 cents sharp of A3.
      near: vowel(220 * 2 ** (10 / 1200)),
      // A vibrato of ±40 cents at 6 Hz around A3 (never nearer another note).
      vibrato: vowel((t) => 220 * 2 ** ((40 / 1200) * Math.sin(2 * Math.PI * 6 * t))),
      // Noise (unpitched: a breath, an "s").
      noise: (() => {
        const out = new Float32Array(LENGTH);
        let seed = 1;
        for (let i = 0; i < LENGTH; i++) {
          seed = (seed * 1664525 + 1013904223) >>> 0;
          out[i] = ((seed / 2 ** 32) * 2 - 1) * 0.3;
        }
        return out;
      })(),
    };
    for (const [name, data] of Object.entries(made)) {
      samples.set(name, data);
      await writeWav(path.join(dir, `${name}.wav`), data, RATE);
    }
    engine = new AudioEngine(new DataPaths(dir), {
      offline: true,
      onlyPluginPaths: true,
      pluginPaths: [],
      samplePath: (_project, id) => (samples.has(id) ? path.join(dir, `${id}.wav`) : null),
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

  it("tunes a note sung 39 cents sharp to the note, as late as it says (compensated)", async () => {
    const sound = await play(song("sharp"));
    const delay = await latency();
    expect(delay).toBeGreaterThan(1000);
    expect(delay).toBeLessThan(0.06 * RATE);
    const status = await engine.command("status", {});
    expect(status.transport.autoTunes?.[TUNE]?.latency).toBe(delay);
    // Every reading through the note within 2 cents of A3.
    for (const p of pitches(sound, delay + 0.25 * RATE, delay + 1.5 * RATE, 4800)) expect(Math.abs(cents(p, 220))).toBeLessThan(2);
    // Nothing before its delay: the note starts that much later.
    expect(rms(sound, 0, delay - 200)).toBeLessThan(0.002);
    expect(rms(sound, delay + 2000, delay + 6000)).toBeGreaterThan(0.05);
    // What it says it heard and played: A3 39 cents sharp (MIDI 57.39), tuned to 57.
    const points = status.transport.autoTunes![TUNE].points.filter(([, sung]) => sung > 0);
    expect(points.length).toBeGreaterThan(5);
    const [, sung, tuned, target] = points[points.length - 1];
    expect(sung).toBeCloseTo(57.39, 1);
    expect(tuned).toBeCloseTo(57, 2);
    expect(target).toBe(57);
  });

  it("keeps its level, and the sound as it is when it's bypassed (and no later)", async () => {
    const input = samples.get("sharp")!;
    const tuned = await play(song("sharp"));
    const delay = await latency();
    expect(Math.abs(20 * Math.log10(rms(tuned, delay + 0.3 * RATE, delay + 1.5 * RATE) / rms(input, 0.3 * RATE, 1.5 * RATE)))).toBeLessThan(1);

    await engine.command("stop", {});
    const bypassed = await play(song("sharp", {}, (s) => updateEffect(s, MASTER_TRACK_ID, 0, { enabled: false })));
    expect(await latency()).toBe(0);
    expect(Math.abs(cents(steady(bypassed, 0), 225))).toBeLessThan(2);
  });

  it("tunes to the key's notes: one removed isn't a target, one bypassed is left as it's sung", async () => {
    // A is in C major: A3.
    let sound = await play(song("sharp", { key: 0, scale: "major" }));
    let delay = await latency();
    expect(Math.abs(cents(steady(sound, delay), 220))).toBeLessThan(2);
    // A removed: A#3 (61 cents away) is nearer than G#3.
    await engine.command("stop", {});
    sound = await play(song("sharp", {}, (s) => setAutoTuneNote(s, TUNE, 9, "remove")));
    delay = await latency();
    expect(Math.abs(cents(steady(sound, delay), 233.08))).toBeLessThan(2);
    // A bypassed: as it's sung.
    await engine.command("stop", {});
    sound = await play(song("sharp", {}, (s) => setAutoTuneNote(s, TUNE, 9, "bypass")));
    expect(Math.abs(cents(steady(sound, await latency()), 225))).toBeLessThan(3);
    // Detune +20 cents: A3 is 222.55 Hz.
    await engine.command("stop", {});
    sound = await play(song("sharp", { detune: 20 }));
    expect(Math.abs(cents(steady(sound, await latency()), 220 * 2 ** (20 / 1200)))).toBeLessThan(2);
  });

  it("takes its Retune Speed to reach the note", async () => {
    const sound = await play(song("sharp", { retuneSpeed: 300 }));
    const delay = await latency();
    // At first it's still nearly as sung; half a second in, tuned.
    const early = pitchOf(sound, delay + Math.round(0.02 * RATE));
    expect(cents(early, 220)).toBeGreaterThan(25);
    expect(Math.abs(cents(pitchOf(sound, delay + Math.round(0.9 * RATE)), 220))).toBeLessThan(3);
  });

  it("flattens a vibrato at Retune Speed 0, and lets it through slowly", async () => {
    const spread = (list: number[]) => Math.max(...list.map((p) => cents(p, 220))) - Math.min(...list.map((p) => cents(p, 220)));
    let sound = await play(song("vibrato"));
    let delay = await latency();
    expect(spread(pitches(sound, delay + 0.3 * RATE, delay + 1.5 * RATE, 480))).toBeLessThan(4);
    await engine.command("stop", {});
    sound = await play(song("vibrato", { retuneSpeed: 400, humanize: 1 }));
    delay = await latency();
    expect(spread(pitches(sound, delay + 0.3 * RATE, delay + 1.5 * RATE, 480))).toBeGreaterThan(40);
  });

  it("tunes only what's sung near a note with Flex-Tune", async () => {
    let sound = await play(song("sharp", { flexTune: 0.6 }));
    expect(Math.abs(cents(steady(sound, await latency()), 225))).toBeLessThan(2);
    await engine.command("stop", {});
    sound = await play(song("near", { flexTune: 0.6 }));
    expect(Math.abs(cents(steady(sound, await latency()), 220))).toBeLessThan(2);
  });

  it("mixes with the dry sound held back as long as the tuned one", async () => {
    const sound = await play(song("sharp", {}, (s) => updateEffect(s, MASTER_TRACK_ID, 0, { mix: 0.5 })));
    const delay = await latency();
    expect(rms(sound, 0, delay - 200)).toBeLessThan(0.002);
    expect(rms(sound, delay + 0.3 * RATE, delay + 1.5 * RATE)).toBeGreaterThan(0.1);
  });

  it("follows its automation in song mode, and exports in time (its delay trimmed)", async () => {
    let s = song("sharp");
    s = editClips(s, (clips) => addClips(clips, [{ kind: "pattern" as const, ref: P, track: 0, start: 0, length: null }]).clips);
    const made = createAutomation(s, { kind: "autoTune", effect: TUNE, control: "transpose" }, { start: 0, length: 384 }, { id: "auto_transpose", value: 1 });
    s = made.song;
    await engine.setSong({ projectId: PROJECT, song: s, patternId: P, mode: "song" });
    await engine.command("play", {});
    const sound = (await hear(Math.round(1.9 * RATE))).channels[0];
    const delay = await latency();
    expect(Math.abs(cents(steady(sound, delay), 440))).toBeLessThan(3);

    await engine.command("stop", {});
    const folder = path.join(dir, "exported");
    const result = await engine.renderExport({ id: "exp_tune", projectId: PROJECT, song: editPoints(s, "auto_transpose", (points) => points.map((p) => ({ ...p, value: 0.5 }))), patternId: P, mode: "song", loop: null, resampling: "sinc", folder, mix: true, stems: false, tail: "cut" });
    expect(result.state).toBe("done");
    expect(result.missing).toEqual([]);
    const mix = (await readWav(path.join(folder, "mix.wav"))).channels[0];
    // Tuned, and starting where the note does (the vowel fades in over 10 ms).
    expect(Math.abs(cents(steady(mix, 0), 220))).toBeLessThan(2);
    expect(rms(mix, 0.015 * RATE, 0.05 * RATE)).toBeGreaterThan(0.05);
  });

  it("follows its automated Detune: the tuning moved up 50 cents, the voice tuned to it", async () => {
    let s = song("sharp");
    s = editClips(s, (clips) => addClips(clips, [{ kind: "pattern" as const, ref: P, track: 0, start: 0, length: null }]).clips);
    s = createAutomation(s, { kind: "autoTune", effect: TUNE, control: "detune" }, { start: 0, length: 384 }, { value: 0.75 }).song;
    await engine.setSong({ projectId: PROJECT, song: s, patternId: P, mode: "song" });
    await engine.command("play", {});
    const sound = (await hear(Math.round(1.9 * RATE))).channels[0];
    expect(Math.abs(cents(steady(sound, await latency()), 220 * 2 ** (50 / 1200)))).toBeLessThan(3);
  });

  it("transposes, keeping the formants (Formant) or moving them with the pitch; Throat moves them", async () => {
    const input = samples.get("high")!;
    const inputCentroid = centroid(input, 0.5 * RATE);
    let sound = await play(song("high", { transpose: 12 }));
    let delay = await latency();
    expect(Math.abs(cents(steady(sound, delay), 440))).toBeLessThan(3);
    const kept = centroid(sound, delay + 0.5 * RATE);
    expect(Math.abs(kept / inputCentroid - 1)).toBeLessThan(0.15);

    await engine.command("stop", {});
    sound = await play(song("high", { transpose: 7, formant: false }));
    delay = await latency();
    expect(Math.abs(cents(steady(sound, delay), 220 * 2 ** (7 / 12)))).toBeLessThan(3);
    expect(centroid(sound, delay + 0.5 * RATE) / inputCentroid).toBeGreaterThan(1.3);

    await engine.command("stop", {});
    sound = await play(song("high", { throat: 1.5 }));
    delay = await latency();
    // Still A3 (its lowered first formant on the second harmonic fools a pitch reading: its period is A3's).
    expect(periodicity(sound, delay + 0.5 * RATE, 220)).toBeGreaterThan(0.98);
    expect(centroid(sound, delay + 0.5 * RATE) / inputCentroid).toBeLessThan(0.85);
  });

  it("adds its own vibrato (Create Vibrato)", async () => {
    const sound = await play(song("sharp", { vibrato: { shape: "sine", rate: 5, delay: 0, onset: 0, pitch: 50, variation: 0 } }));
    const delay = await latency();
    const list = pitches(sound, delay + 0.3 * RATE, delay + 1.5 * RATE, 480).map((p) => cents(p, 220));
    expect(Math.max(...list)).toBeGreaterThan(35);
    expect(Math.min(...list)).toBeLessThan(-35);
  });

  it("leaves what has no pitch as it is", async () => {
    const input = samples.get("noise")!;
    const sound = await play(song("noise"));
    const delay = await latency();
    let dot = 0;
    let a = 0;
    let b = 0;
    for (let i = Math.round(0.2 * RATE); i < 1.5 * RATE; i++) {
      dot += sound[i + delay] * input[i];
      a += sound[i + delay] ** 2;
      b += input[i] ** 2;
    }
    expect(dot / Math.sqrt(a * b)).toBeGreaterThan(0.98);
  });
});
