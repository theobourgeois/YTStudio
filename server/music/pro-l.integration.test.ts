/**
 * YT-L's sound (`docs/fabfilter/pro-l.md` §8.9): the real engine, offline, playing test signals through a YT-L on
 * the master, measured here in TypeScript (nothing shared with the engine): the ceiling by sample, by BS.1770's
 * meter and by an ideal reconstruction; the latency it reports; nothing touched under the ceiling; a held bass
 * note undistorted (Auto Hold); loudness that always rises with Gain; the release stage; linking; the slot's mix;
 * the clip stage, mid/side and Audition; its meters held to EBU Tech 3341 and 3342; and its dither.
 *
 * The render isn't delay-compensated: what comes out is late by the YT-L's latency, which the tests read from
 * the engine's status.
 */
import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { integratedLoudness, loudnessChunks } from "../../shared/music/audio-intelligence/loudness.ts";
import { createAutomation, editPoints } from "../../shared/music/automation.ts";
import { addChannels, setSteps } from "../../shared/music/edits.ts";
import { addClips, editClips } from "../../shared/music/playlist.ts";
import { setEffect } from "../../shared/music/mixer.ts";
import { type ProLPatch, updateProL } from "../../shared/music/pro-l.ts";
import { FL_CLIP_KNEE, PRO_L_PLUGIN } from "../../shared/music/pro-l-presets.ts";
import { FIRST_PATTERN_ID, MASTER_TRACK_ID, createMusicProject } from "../../shared/music/project.ts";
import { PRO_L_STYLES, type MusicProject, type ProLStyle } from "../../shared/music/types.ts";
import { ENGINE } from "../config.ts";
import { DataPaths } from "../storage.ts";
import { AudioEngine } from "./engine.ts";
import { type WavData, readWav, writeWavChannels } from "./wav.ts";

const RATE = 48_000;
const P = FIRST_PATTERN_ID;
const PROJECT = "proj_0123456789ab";
const L = "fx_lim";
const TICKS = 384;

const db = (gain: number) => 20 * Math.log10(Math.max(gain, 1e-12));
const amp = (level: number) => 10 ** (level / 20);

function peak(x: Float32Array, from = 0, to = x.length) {
  let p = 0;
  for (let i = from; i < to; i++) p = Math.max(p, Math.abs(x[i]));
  return p;
}

/** ITU-R BS.1770-5 Annex 2: the meter's own 4× interpolator (48 taps, 4 phases), its highest value. */
const ITU = [
  [0.001708984375, 0.010986328125, -0.0196533203125, 0.033203125, -0.0594482421875, 0.1373291015625, 0.97216796875, -0.102294921875, 0.047607421875, -0.0266113281250, 0.0148925781250, -0.0083007812500],
  [-0.0291748046875, 0.029296875, -0.0517578125, 0.0891113281250, -0.1665039062500, 0.4650878906250, 0.7797851562500, -0.2003173828125, 0.1015625, -0.0582275390625, 0.0330810546875, -0.0189208984375],
  [-0.0189208984375, 0.0330810546875, -0.0582275390625, 0.1015625, -0.2003173828125, 0.7797851562500, 0.4650878906250, -0.1665039062500, 0.0891113281250, -0.0517578125, 0.029296875, -0.0291748046875],
  [-0.0083007812500, 0.0148925781250, -0.0266113281250, 0.047607421875, -0.102294921875, 0.97216796875, 0.1373291015625, -0.0594482421875, 0.033203125, -0.0196533203125, 0.010986328125, 0.001708984375],
];
function bs1770Peak(channels: Float32Array[]) {
  let p = 0;
  for (const x of channels)
    for (let n = 0; n < x.length; n++)
      for (const h of ITU) {
        let v = 0;
        for (let k = 0; k < 12; k++) if (n - k >= 0) v += h[k] * x[n - k];
        p = Math.max(p, Math.abs(v));
      }
  return p;
}

/** An ideal reconstruction's peak: 16× from a long Kaiser-windowed sinc, looked at where the samples come near `near`. */
const IDEAL_HALF = 64;
const idealTaps = (() => {
  const bessel = (x: number) => {
    let sum = 1, term = 1;
    for (let k = 1; k < 40; k++) {
      term *= (x / (2 * k)) ** 2;
      sum += term;
    }
    return sum;
  };
  const beta = 14, norm = bessel(beta);
  return Array.from({ length: 16 }, (_, p) =>
    Array.from({ length: 2 * IDEAL_HALF }, (_, m) => {
      const t = p / 16 - (m - IDEAL_HALF + 1);
      const sinc = Math.abs(t) < 1e-12 ? 1 : Math.sin(Math.PI * t) / (Math.PI * t);
      const r = t / (IDEAL_HALF + 0.5);
      return Math.abs(r) >= 1 ? 0 : (sinc * bessel(beta * Math.sqrt(1 - r * r))) / norm;
    }),
  );
})();
function idealPeak(channels: Float32Array[], near: number) {
  let p = 0;
  for (const x of channels)
    for (let j = 0; j + 1 < x.length; j++) {
      p = Math.max(p, Math.abs(x[j]));
      if (Math.max(Math.abs(x[j]), Math.abs(x[j + 1])) < near) continue;
      for (let ph = 1; ph < 16; ph++) {
        let v = 0;
        const h = idealTaps[ph];
        for (let m = 0; m < 2 * IDEAL_HALF; m++) {
          const i = j - IDEAL_HALF + 1 + m;
          if (i >= 0 && i < x.length) v += h[m] * x[i];
        }
        p = Math.max(p, Math.abs(v));
      }
    }
  return p;
}

/** Harmonics 2–10 of a steady sine, against the fundamental (dB), from a Blackman–Harris DFT at those bins only. */
function thd(x: Float32Array, from: number, length: number, f0: number) {
  const w = (i: number) => 0.35875 - 0.48829 * Math.cos((2 * Math.PI * i) / length) + 0.14128 * Math.cos((4 * Math.PI * i) / length) - 0.01168 * Math.cos((6 * Math.PI * i) / length);
  const power = (f: number) => {
    // The bin's neighbourhood (the window's main lobe is 4 bins wide).
    let best = 0;
    for (const df of [-2, -1, 0, 1, 2]) {
      const k = Math.round((f * length) / RATE) + df;
      let re = 0, im = 0;
      for (let i = 0; i < length; i++) {
        const a = (2 * Math.PI * k * i) / length;
        const v = x[from + i] * w(i);
        re += v * Math.cos(a);
        im -= v * Math.sin(a);
      }
      best += re * re + im * im;
    }
    return best;
  };
  const fundamental = power(f0);
  let harmonics = 0;
  for (let h = 2; h <= 10; h++) if (h * f0 < RATE / 2) harmonics += power(h * f0);
  return 10 * Math.log10(harmonics / fundamental);
}

/** A Blackman–Harris windowed power spectrum (radix-2; `x` cut to a power of two). */
function spectrum(x: Float32Array, from: number, size: number) {
  const re = new Float64Array(size), im = new Float64Array(size);
  for (let i = 0; i < size; i++) {
    const w = 0.35875 - 0.48829 * Math.cos((2 * Math.PI * i) / size) + 0.14128 * Math.cos((4 * Math.PI * i) / size) - 0.01168 * Math.cos((6 * Math.PI * i) / size);
    re[i] = x[from + i] * w;
  }
  for (let i = 1, j = 0; i < size; i++) {
    let bit = size >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) [re[i], re[j], im[i], im[j]] = [re[j], re[i], im[j], im[i]];
  }
  for (let len = 2; len <= size; len <<= 1) {
    const angle = (-2 * Math.PI) / len;
    for (let i = 0; i < size; i += len)
      for (let k = 0; k < len / 2; k++) {
        const cr = Math.cos(angle * k), ci = Math.sin(angle * k);
        const ar = re[i + k + len / 2] * cr - im[i + k + len / 2] * ci, ai = re[i + k + len / 2] * ci + im[i + k + len / 2] * cr;
        re[i + k + len / 2] = re[i + k] - ar;
        im[i + k + len / 2] = im[i + k] - ai;
        re[i + k] += ar;
        im[i + k] += ai;
      }
  }
  return Float64Array.from({ length: size / 2 }, (_, k) => re[k] ** 2 + im[k] ** 2);
}

/** Fruity Soft Clipper (measured, `pro-l-research.md` §2.9) at a ceiling of 1. */
function flCurve(x: number) {
  const t = amp(-FL_CLIP_KNEE), a = Math.abs(x);
  return Math.sign(x) * (a <= t ? a : 1 - (1 - t) * Math.exp(-(a - t) / (1 - t)));
}

// ----------------------------------------------------------------------------------------------- material

const both = (x: Float32Array) => [x, x];
function seeded(seed: number) {
  let s = seed;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32) * 2 - 1;
}
/** Drum hits (noise bursts and a falling kick), four a second, clipped hard: energy up to half the rate. */
function drums(seconds: number) {
  const rand = seeded(7);
  const x = new Float32Array(seconds * RATE);
  for (let hit = 0; hit < seconds * 4; hit++) {
    const at = Math.round((hit * RATE) / 4);
    for (let i = 0; i < 0.2 * RATE && at + i < x.length; i++) {
      const t = i / RATE;
      x[at + i] += rand() * Math.exp(-t / 0.03) + Math.sin(2 * Math.PI * (60 * t + (200 * 0.02 * (1 - Math.exp(-t / 0.02))))) * Math.exp(-t / 0.1);
    }
  }
  return x.map((v) => Math.max(-0.5, Math.min(0.5, v * 2)));
}
/** White noise clipped at half scale. */
function noise(seconds: number) {
  const rand = seeded(11);
  return Float32Array.from({ length: seconds * RATE }, () => Math.max(-0.5, Math.min(0.5, rand() * 0.9)));
}
/** A loop: kicks, a snare, hats, and a long 808 under them; peaking near −1 dBFS. */
function loop(seconds: number) {
  const rand = seeded(3);
  const x = new Float32Array(seconds * RATE);
  const beat = 60 / 140;
  for (let b = 0; b * beat < seconds; b++) {
    const at = Math.round(b * beat * RATE);
    for (let i = 0; i < 0.15 * RATE && at + i < x.length; i++) {
      const t = i / RATE;
      if (b % 2 === 0) x[at + i] += 0.6 * Math.sin(2 * Math.PI * (55 * t + 150 * 0.015 * (1 - Math.exp(-t / 0.015)))) * Math.exp(-t / 0.08);
      else x[at + i] += 0.45 * rand() * Math.exp(-t / 0.05);
    }
    for (let h = 0; h < 2; h++) {
      const hat = at + Math.round((h * beat * RATE) / 2);
      for (let i = 0; i < 0.03 * RATE && hat + i < x.length; i++) x[hat + i] += 0.15 * rand() * Math.exp(-i / RATE / 0.008);
    }
    if (b % 4 === 0)
      for (let i = 0; i < 4 * beat * RATE && at + i < x.length; i++) {
        const t = i / RATE;
        x[at + i] += 0.45 * Math.sin(2 * Math.PI * (45 * t + 45 * 0.025 * (1 - Math.exp(-t / 0.025)))) * Math.exp(-t / 1.2);
      }
  }
  const most = peak(x);
  return x.map((v) => (v / most) * amp(-1));
}

describe.skipIf(!existsSync(ENGINE))("YT-L, offline", () => {
  let dir: string;
  let engine: AudioEngine;
  let render = 0;

  async function hear(frames: number): Promise<WavData> {
    const file = path.join(dir, `render-${render++}.wav`);
    await engine.render(frames, file);
    return readWav(file);
  }
  /**
   * A song playing `sample` from its start, a YT-L on the master. Its pattern is as long as a pattern can be (512
   * steps: 64 seconds at 120 BPM, the tempo; longer signals play at 60).
   */
  function song(sample: string, patch: ProLPatch = {}, tempo = 120): MusicProject {
    let s = addChannels(createMusicProject("Loud", tempo), [{ id: "chan_sig", name: "Signal", sampleId: sample }]);
    s = setSteps(s, P, "chan_sig", [0], true);
    s = { ...s, patterns: s.patterns.map((p) => (p.id === P ? { ...p, length: 16 * TICKS } : p)) };
    s = setEffect(s, MASTER_TRACK_ID, 0, PRO_L_PLUGIN, L);
    return updateProL(s, L, { oversampling: 1, ...patch });
  }
  async function fresh() {
    await engine.command("stop", {});
    await engine.setSong({ projectId: PROJECT, song: createMusicProject("Silence", 120), patternId: P, mode: "pattern" });
    await hear(RATE / 10);
  }
  async function played(s: MusicProject, seconds: number, mode: "pattern" | "song" = "pattern") {
    await fresh();
    await engine.setSong({ projectId: PROJECT, song: s, patternId: P, mode });
    await engine.command("play", {});
    return hear(Math.round(seconds * RATE));
  }
  async function latency() {
    const status = await engine.command("status", {});
    return status.transport?.limiters?.[L]?.latency ?? -1;
  }
  /** What the YT-L says now: its meters. */
  async function meters() {
    const status = await engine.command("status", {});
    const state = status.transport?.limiters?.[L];
    if (!state) throw new Error("The engine said nothing of the YT-L.");
    return state;
  }
  /** A stereo 1 kHz sine at each level (dBFS) for each length (seconds), as a file: EBU Tech 3341's and 3342's signals. */
  async function tones(name: string, parts: [level: number, seconds: number][]) {
    const x = new Float32Array(Math.round(parts.reduce((t, [, seconds]) => t + seconds, 0) * RATE));
    let at = 0;
    for (const [level, seconds] of parts)
      for (const end = at + Math.round(seconds * RATE); at < end; at++) x[at] = amp(level) * Math.sin((2 * Math.PI * 1000 * at) / RATE);
    await writeWavChannels(path.join(dir, `${name}.wav`), both(x), RATE);
    return x.length / RATE;
  }

  beforeAll(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "pro-l-"));
    await writeWavChannels(path.join(dir, "drums.wav"), both(drums(2)), RATE);
    await writeWavChannels(path.join(dir, "noise.wav"), both(noise(2)), RATE);
    await writeWavChannels(path.join(dir, "loop.wav"), both(loop(4)), RATE);
    for (const f of [40, 60, 100]) await writeWavChannels(path.join(dir, `sine${f}.wav`), both(Float32Array.from({ length: 2 * RATE }, (_, i) => amp(-6) * Math.sin((2 * Math.PI * f * i) / RATE))), RATE);
    // A 50 Hz sine rising from −30 to 0 dBFS over 3 s (the FL curve's test).
    await writeWavChannels(path.join(dir, "ramp.wav"), both(Float32Array.from({ length: 3 * RATE }, (_, i) => amp(-30 + (30 * i) / (3 * RATE)) * Math.sin((2 * Math.PI * 50 * i) / RATE))), RATE);
    await writeWavChannels(path.join(dir, "tone1250.wav"), both(Float32Array.from({ length: 2 * RATE }, (_, i) => amp(-6) * Math.sin((2 * Math.PI * 1250 * i) / RATE))), RATE);
    // A centred 60 Hz note and a wide 2 kHz one: |L| and |R| reach 1.2 together.
    const centre = (i: number) => 0.6 * Math.sin((2 * Math.PI * 60 * i) / RATE), wide = (i: number) => 0.6 * Math.sin((2 * Math.PI * 2000 * i) / RATE);
    await writeWavChannels(path.join(dir, "wide.wav"), [Float32Array.from({ length: 2 * RATE }, (_, i) => Math.max(-1, Math.min(1, (centre(i) + wide(i)) / 1.25))), Float32Array.from({ length: 2 * RATE }, (_, i) => Math.max(-1, Math.min(1, (centre(i) - wide(i)) / 1.25)))], RATE);
    // A click at 0.25 s, well under the ceiling.
    const click = new Float32Array(RATE);
    click[RATE / 4] = 0.25;
    await writeWavChannels(path.join(dir, "click.wav"), both(click), RATE);
    // A 1 kHz tone at −20 dBFS (nothing to limit).
    await writeWavChannels(path.join(dir, "quiet.wav"), both(Float32Array.from({ length: RATE }, (_, i) => amp(-20) * Math.sin((2 * Math.PI * 1000 * i) / RATE))), RATE);
    // A 1 kHz tone at −12 dBFS with a 50 ms burst at −0 dBFS at 0.5 s (the release stage's test).
    await writeWavChannels(
      path.join(dir, "burst.wav"),
      both(Float32Array.from({ length: 3 * RATE }, (_, i) => (i >= RATE / 2 && i < RATE / 2 + 0.05 * RATE ? 1 : amp(-12)) * Math.sin((2 * Math.PI * 1000 * i) / RATE))),
      RATE,
    );
    // The left alone 6 dB over (at gain 6), the right a quiet tone (linking's test).
    const left = Float32Array.from({ length: RATE }, (_, i) => (i > RATE / 4 && i < RATE / 2 ? amp(-0.5) : 0) * Math.sin((2 * Math.PI * 500 * i) / RATE));
    const right = Float32Array.from({ length: RATE }, (_, i) => amp(-20) * Math.sin((2 * Math.PI * 700 * i) / RATE));
    await writeWavChannels(path.join(dir, "onesided.wav"), [left, right], RATE);
    engine = new AudioEngine(new DataPaths(dir), { offline: true, onlyPluginPaths: true, pluginPaths: [], samplePath: (_project, id) => path.join(dir, `${id}.wav`) });
  });
  afterAll(async () => {
    engine.shutdown();
    await fs.rm(dir, { recursive: true, force: true });
  });
  beforeEach(fresh);

  it("never lets a sample over its ceiling, in any style, oversampled or not", async () => {
    for (const style of PRO_L_STYLES)
      for (const oversampling of [1, 4] as const)
        for (const material of ["drums", "noise"]) {
          const sound = await played(song(material, { style, oversampling, gain: 12, output: -1, lookahead: 0 }), 2.1);
          const over = db(Math.max(peak(sound.channels[0]), peak(sound.channels[1]))) + 1;
          expect(over, `${style}, ${oversampling}x, ${material}`).toBeLessThanOrEqual(1e-4);
        }
  });

  it("never lets a sample over its ceiling with its clip stage, in either order, or in mid/side", async () => {
    const cases: ProLPatch[] = [
      { clip: true, clipShape: "smooth", clipRange: 1.5 },
      { clip: true, clipShape: "hard", clipRange: 0 },
      { clip: true, clipShape: "fl", clipRange: 3 },
      { clip: true, clipShape: "soft", clipRange: 1 },
      { clip: true, clipShape: "converter", clipRange: 2 },
      { clip: true, clipShape: "hard", clipRange: 1, clipOrder: "last" },
      { clip: true, clipShape: "fl", clipRange: 2, clipOrder: "last" },
      { stereo: "ms", sideFloor: -6 },
      { stereo: "ms", sideFloor: -18, clip: true },
    ];
    for (const patch of cases)
      for (const style of ["transparent", "modern", "aggressive", "spit"] as ProLStyle[])
        for (const material of ["drums", "noise"]) {
          const sound = await played(song(material, { style, gain: 12, output: -1, lookahead: 0, ...patch }), 2.1);
          const over = db(Math.max(peak(sound.channels[0]), peak(sound.channels[1]))) + 1;
          expect(over, `${style}, ${JSON.stringify(patch)}, ${material}`).toBeLessThanOrEqual(1e-4);
        }
  });

  it("holds a true peak ceiling by BS.1770's meter, and by an ideal reconstruction when oversampled", async () => {
    for (const style of ["transparent", "modern", "aggressive"] as ProLStyle[])
      for (const oversampling of [1, 4] as const)
        for (const material of ["drums", "noise"]) {
          const sound = await played(song(material, { style, oversampling, truePeak: true, gain: 12, output: -1, lookahead: 0 }), 2.1);
          const label = `${style}, ${oversampling}x, ${material}`;
          expect(db(bs1770Peak(sound.channels)) + 1, label).toBeLessThanOrEqual(0.001);
          if (oversampling > 1) expect(db(idealPeak(sound.channels, amp(-8))) + 1, label).toBeLessThanOrEqual(0.02);
        }
  });

  it("is late by exactly the latency it reports, whatever its Lookahead", async () => {
    for (const style of ["transparent", "modern", "bus", "spit"] as ProLStyle[])
      for (const oversampling of [1, 4] as const)
        for (const truePeak of [false, true])
          for (const lookahead of [0, 0.001]) {
            const sound = await played(song("click", { style, oversampling, truePeak, lookahead, clip: lookahead > 0 }), 0.5);
            const late = sound.channels[0].reduce((best, v, i, x) => (Math.abs(v) > Math.abs(x[best]) ? i : best), 0) - RATE / 4;
            expect(late, `${style}, ${oversampling}x, true peak ${truePeak}`).toBe(await latency());
          }
  });

  it("leaves the sound under its ceiling untouched", async () => {
    for (const style of PRO_L_STYLES) {
      const sound = await played(song("quiet", { style, oversampling: 1, output: 0 }), 1);
      const late = await latency();
      let error = 0, power = 0;
      for (let i = late + 1000; i < RATE - 1000; i++) {
        const input = amp(-20) * Math.sin((2 * Math.PI * 1000 * (i - late)) / RATE);
        // (The file holds whole 16-bit steps, which are read back as steps of 1/32768.)
        const quantised = Math.round(input * 32767) / 32768;
        error += (sound.channels[0][i] - quantised) ** 2;
        power += quantised ** 2;
      }
      expect(10 * Math.log10(error / power), style).toBeLessThan(-100);
    }
  });

  it("doesn't distort a held bass note (Auto Hold), where a fast release would", async () => {
    for (const f of [40, 60, 100])
      for (const style of PRO_L_STYLES.filter((s) => s !== "spit")) {
        const sound = await played(song(`sine${f}`, { style, gain: 12, output: 0, lookahead: 0.001 }), 2);
        expect(thd(sound.channels[0], RATE, RATE / 2, f), `${style} at ${f} Hz`).toBeLessThan(-80);
      }
    // Without its hold, Transparent's gain rises between the half-cycles: Pro-L 2's −21 dB.
    const held = await played(song("sine40", { style: "transparent", gain: 12, output: 0, lookahead: 0.001, hold: 0 }), 2);
    expect(thd(held.channels[0], RATE, RATE / 2, 40)).toBeGreaterThan(-45);
  });

  it("gets louder whenever Gain goes up, in every style", async () => {
    for (const style of PRO_L_STYLES) {
      let last = -Infinity;
      for (const gain of [0, 4, 8, 12, 16, 20, 24]) {
        const sound = await played(song("loop", { style, gain, output: -1 }), 4);
        const lufs = integratedLoudness(loudnessChunks(sound.channels, RATE)) ?? -Infinity;
        expect(lufs, `${style} at +${gain} dB`).toBeGreaterThanOrEqual(last - 0.05);
        last = lufs;
      }
    }
  });

  it("lets a short peak go at once with Attack at its longest, and over Release with Attack at 0", async () => {
    // The tone after the burst: back within 0.5 dB of its level how long after the burst ends?
    const recovery = async (attack: number, release: number) => {
      const sound = await played(song("burst", { style: "transparent", gain: 6, output: 0, attack, release }), 3);
      const late = await latency();
      const level = amp(-12 + 6);
      const end = RATE / 2 + 0.05 * RATE + late;
      for (let i = end; i < sound.channels[0].length - RATE / 1000; i += RATE / 1000) {
        if (peak(sound.channels[0], i, i + RATE / 1000) > level * amp(-0.5)) return (i - end) / RATE;
      }
      return Infinity;
    };
    expect(await recovery(10, 0.5)).toBeLessThan(0.08);
    const slow = await recovery(0, 0.5);
    expect(slow).toBeGreaterThan(0.3);
    expect(slow).toBeLessThan(2);
  });

  it("links the channels as much as it's told to", async () => {
    const quietRight = async (link: number) => {
      const sound = await played(song("onesided", { style: "transparent", gain: 6, output: 0, linkTransients: link, linkRelease: link }), 1);
      const late = await latency();
      return db(peak(sound.channels[1], RATE / 4 + late + 2400, RATE / 2 + late)) - db(amp(-14));
    };
    expect(await quietRight(0)).toBeCloseTo(0, 1);
    expect(await quietRight(1)).toBeLessThan(-5);
    const half = await quietRight(0.5);
    expect(half).toBeLessThan(-2);
    expect(half).toBeGreaterThan(-4);
  });

  it("adds the dry sound back below 100% mix, held back as long as itself", async () => {
    const s = (mix: number) => {
      const lim = song("quiet", { style: "modern", oversampling: 4, truePeak: true, output: 0 });
      return { ...lim, mixer: { ...lim.mixer, tracks: lim.mixer.tracks.map((t) => ({ ...t, effects: t.effects.map((e) => (e?.id === L ? { ...e, mix } : e)) })) } };
    };
    const wet = await played(s(1), 1);
    const half = await played(s(0.5), 1);
    // Nothing is limited at −20 dBFS: a half-and-half mix of two aligned copies is the same sound (no comb).
    const a = db(peak(wet.channels[0], RATE / 2, RATE - 1000)), b = db(peak(half.channels[0], RATE / 2, RATE - 1000));
    expect(Math.abs(a - b)).toBeLessThan(0.05);
  });

  it("leaves the sound under its clip stage's knee bit for bit", async () => {
    // Clipping at 4x either way: the same samples whether the clip stage is on or not, when nothing reaches it.
    const off = await played(song("quiet", { style: "modern", oversampling: 4, output: 0 }), 1);
    const on = await played(song("quiet", { style: "modern", oversampling: 4, output: 0, clip: true, clipShape: "hard", clipRange: 0 }), 1);
    let most = 0;
    for (let i = 0; i < RATE; i++) most = Math.max(most, Math.abs(off.channels[0][i] - on.channels[0][i]));
    expect(most).toBeLessThan(1e-6);
  });

  it("clips as Fruity Soft Clipper does with its FL shape", async () => {
    const input = (await readWav(path.join(dir, "ramp.wav"))).channels[0];
    const sound = await played(song("ramp", { style: "transparent", oversampling: 4, output: 0, gain: 6, clip: true, clipShape: "fl", clipRange: 0 }), 3);
    const late = await latency();
    let most = 0;
    for (let i = RATE / 2; i < 2.5 * RATE; i++) most = Math.max(most, Math.abs(sound.channels[0][i + late] - flCurve(input[i] * amp(6))));
    expect(most).toBeLessThan(0.002);
  });

  it("keeps a hard clip's aliasing under −85 dB (4x, anti-aliased)", async () => {
    // What the clip stage takes off, alone (Audition: Clip): a 1250 Hz tone 12 dB into a hard clip. The floor is
    // JUCE's half-band filters' (more oversampling reads worse: −85 dB at 8x, −84.5 at 16x), not the clip's: FL
    // Studio's own reads −46 dB, a plain clip at 4x about −73.
    const sound = await played(song("tone1250", { style: "transparent", output: 0, gain: 12, clip: true, clipShape: "hard", clipRange: 0, audition: "clip" }), 2);
    const size = 65536;
    const power = spectrum(sound.channels[0], RATE / 2, size);
    const bin = (f: number) => Math.round((f * size) / RATE);
    const fundamental = Math.max(...[-2, -1, 0, 1, 2].map((d) => power[bin(1250) + d]));
    let alias = 0;
    for (let k = 10; k < size / 2; k++) {
      const harmonic = Math.abs(k * (RATE / size) / 1250 - Math.round(k * (RATE / size) / 1250)) * 1250 < 8 * (RATE / size);
      if (!harmonic) alias = Math.max(alias, power[k]);
    }
    expect(10 * Math.log10(alias / fundamental)).toBeLessThan(-85);
  });

  it("in mid/side, turns the side down first and leaves the centre alone", async () => {
    const midLevel = async (stereo: "lr" | "ms") => {
      const sound = await played(song("wide", { style: "transparent", output: 0, gain: 2, stereo, sideFloor: -6 }), 2);
      const late = await latency();
      let sum = 0, input = 0;
      for (let i = RATE / 2; i < 1.5 * RATE; i++) {
        sum += ((sound.channels[0][i + late] + sound.channels[1][i + late]) / 2) ** 2;
        input += ((0.6 / 1.25) * amp(2) * Math.sin((2 * Math.PI * 60 * i) / RATE)) ** 2;
      }
      return { mid: 10 * Math.log10(sum / input), peak: db(Math.max(peak(sound.channels[0]), peak(sound.channels[1]))) };
    };
    const ms = await midLevel("ms"), lr = await midLevel("lr");
    expect(Math.abs(ms.mid)).toBeLessThan(0.05);
    expect(ms.peak).toBeLessThanOrEqual(1e-4);
    expect(lr.mid).toBeLessThan(-0.5);
  });

  it("auditions what it takes away: that and what's heard add up to what came in", async () => {
    const input = (await readWav(path.join(dir, "drums.wav"))).channels[0];
    const heard = await played(song("drums", { style: "modern", output: -1, gain: 6, oversampling: 1 }), 2);
    const taken = await played(song("drums", { style: "modern", output: -1, gain: 6, oversampling: 1, audition: "all" }), 2);
    const late = await latency();
    let error = 0, power = 0;
    for (let i = 0.01 * RATE; i < 1.8 * RATE; i++) {
      const want = input[i] * amp(6);
      error += (heard.channels[0][i + late] + taken.channels[0][i + late] - want) ** 2;
      power += want ** 2;
    }
    expect(10 * Math.log10(error / power)).toBeLessThan(-80);
  });

  it("measures loudness as EBU Tech 3341 says: Momentary, Short-term and Integrated, gated", async () => {
    const cases: [string, [number, number][], number][] = [
      ["1", [[-23, 20]], -23],
      ["2", [[-33, 20]], -33],
      ["3", [[-36, 10], [-23, 60], [-36, 10]], -23],
      ["4", [[-72, 10], [-36, 10], [-23, 60], [-36, 10], [-72, 10]], -23],
      ["5", [[-26, 20], [-20, 20.1], [-26, 20]], -23],
    ];
    for (const [test, parts, want] of cases) {
      const seconds = await tones(`ebu${test}`, parts);
      await played(song(`ebu${test}`, { output: 0 }, seconds > 60 ? 60 : 120), seconds - 0.2);
      const { loudness } = await meters();
      expect(Math.abs(loudness.integrated - want), `test ${test}: ${loudness.integrated}`).toBeLessThanOrEqual(0.1);
      if (parts.length === 1) {
        expect(Math.abs(loudness.momentary - want), `test ${test}`).toBeLessThanOrEqual(0.1);
        expect(Math.abs(loudness.shortTerm - want), `test ${test}`).toBeLessThanOrEqual(0.1);
        expect(Math.abs(loudness.maxMomentary - want), `test ${test}`).toBeLessThanOrEqual(0.1);
      }
    }
  });

  it("measures the loudness range as EBU Tech 3342 says", async () => {
    const cases: [string, [number, number][], number][] = [
      ["1", [[-20, 20], [-30, 20]], 10],
      ["2", [[-20, 20], [-15, 20]], 5],
      ["3", [[-40, 20], [-20, 20]], 20],
      ["4", [[-50, 20], [-35, 20], [-20, 20], [-35, 20], [-50, 20]], 15],
    ];
    for (const [test, parts, want] of cases) {
      const seconds = await tones(`lra${test}`, parts);
      await played(song(`lra${test}`, { output: 0 }, seconds > 60 ? 60 : 120), seconds);
      const { loudness } = await meters();
      expect(Math.abs(loudness.range - want), `test ${test}: ${loudness.range}`).toBeLessThanOrEqual(1);
    }
  });

  it("reads true peaks as EBU Tech 3341 says, where the samples miss them", async () => {
    // Tests 15–19: a sine at a fraction of the rate, its samples at a phase that misses its peak.
    const cases: [number, number, number, number][] = [
      [4, 0, 0.5, -6.02],
      [4, 45, 0.5, -6.02],
      [6, 60, 0.5, -6.02],
      [8, 67.5, 0.5, -6.02],
      [4, 45, Math.SQRT2, 3.01],
    ];
    for (const [divide, phase, amplitude, want] of cases) {
      // (Faded in and out, so its ends ring no higher than it.)
      const fade = (i: number) => Math.min(1, i / (0.05 * RATE), (2 * RATE - i) / (0.05 * RATE));
      const x = Float32Array.from({ length: 2 * RATE }, (_, i) => Math.max(-1, Math.min(1, fade(i) * amplitude * Math.sin((2 * Math.PI * i) / divide + (phase * Math.PI) / 180))));
      // (A file of its own: the engine keeps what it's read by path.)
      const name = `peaks${divide}-${phase}-${amplitude.toFixed(2)}`;
      await writeWavChannels(path.join(dir, `${name}.wav`), both(x), RATE);
      await played(song(name, { output: 0 }), 2.1);
      const { loudness } = await meters();
      expect(loudness.maxTruePeak - want, `1/${divide} of the rate at ${phase}°`).toBeLessThanOrEqual(0.2);
      expect(loudness.maxTruePeak - want, `1/${divide} of the rate at ${phase}°`).toBeGreaterThanOrEqual(-0.4);
    }
  });

  it("measures only while it isn't paused, and starts again when reset", async () => {
    await tones("steps", [[-20, 6], [-30, 12]]);
    await engine.setSong({ projectId: PROJECT, song: song("steps", { output: 0 }), patternId: P, mode: "pattern" });
    await engine.command("play", {});
    await hear(6 * RATE);
    expect(Math.abs((await meters()).loudness.integrated + 20)).toBeLessThanOrEqual(0.1);
    // Paused through the quieter part: Integrated keeps what it had; Momentary carries on.
    await engine.command("proL", { effect: L, pause: true });
    await hear(5.5 * RATE);
    let now = await meters();
    expect(now.loudness.paused).toBe(true);
    expect(Math.abs(now.loudness.integrated + 20)).toBeLessThanOrEqual(0.1);
    expect(Math.abs(now.loudness.momentary + 30)).toBeLessThanOrEqual(0.1);
    // Reset and carried on: only the quieter part counts.
    await engine.command("proL", { effect: L, pause: false, reset: true });
    await hear(6 * RATE);
    now = await meters();
    expect(Math.abs(now.loudness.integrated + 30)).toBeLessThanOrEqual(0.1);
    expect(Math.abs(now.loudness.maxMomentary + 30)).toBeLessThanOrEqual(0.1);
    expect(Math.abs(now.loudness.seconds - 6)).toBeLessThanOrEqual(0.2);
    await expect(engine.command("proL", { effect: "fx_none", reset: true })).rejects.toThrow(/no such YT-L/);
  });

  it("says what it takes away: the clip stage's and the limiter's most, the share clipped, the peaks", async () => {
    await played(song("drums", { style: "modern", output: -1, gain: 12, oversampling: 4, clip: true, clipShape: "hard", clipRange: 2 }), 2);
    const now = await meters();
    expect(now.maxClip).toBeGreaterThan(0.5);
    expect(now.maxClip).toBeLessThan(13);
    expect(now.maxReduction).toBeGreaterThan(0.5);
    expect(now.clipped).toBeGreaterThan(0);
    expect(now.density).toBeGreaterThan(0);
    expect(Math.max(...now.input)).toBeGreaterThan(1);
    expect(db(Math.max(...now.output))).toBeLessThanOrEqual(-1 + 1e-4);
    expect(db(Math.max(...now.truePeak))).toBeGreaterThan(-1.5);
  });

  it("dithers to 16 bits: whole steps, TPDF's noise, and each noise shaping as Pro-L 2's", async () => {
    const LSB = 1 / 32768;
    await writeWavChannels(path.join(dir, "silence.wav"), both(new Float32Array(11 * RATE)), RATE);
    const noiseOf = async (noiseShaping: "none" | "basic" | "optimized" | "weighted") =>
      (await played(song("silence", { dither: 16, noiseShaping }), 10.5)).channels.map((x) => x.subarray(0.5 * RATE));
    const flat = await noiseOf("none");
    for (const x of flat) {
      let power = 0;
      for (const v of x) {
        expect(Math.abs(v / LSB - Math.round(v / LSB))).toBeLessThan(1e-6);
        power += v * v;
      }
      // Rounding (1/12 of a step squared) and TPDF's dither (1/6): a quarter of a step squared.
      expect(power / x.length / LSB ** 2).toBeGreaterThan(0.25 * 0.95);
      expect(power / x.length / LSB ** 2).toBeLessThan(0.25 * 1.05);
    }
    // Each shaping's noise per octave against flat TPDF's (dB), as Pro-L 2's (`pro-l-research.md` §2.7).
    const BANDS = [63, 125, 250, 500, 2000, 4000, 8000, 12000, 16000, 20000];
    const PRO_L_2: Record<"basic" | "optimized" | "weighted", number[]> = {
      basic: [-6.75, -6.63, -6.02, -5.73, -6.72, -8.37, -3.93, 2.38, 5.77, 6.76],
      optimized: [-11.98, -12.06, -11.4, -10.79, -10.98, -8.96, -4.95, -2.29, 11.69, 14.44],
      weighted: [-12.19, -13.18, -11.74, -12.04, -17.32, -23.09, -3.34, -0.07, 19.3, 22.21],
    };
    const SIZE = 8192;
    const bands = (x: Float32Array) => {
      const sum = new Float64Array(SIZE / 2);
      let count = 0;
      for (let at = 0; at + SIZE <= x.length; at += SIZE / 2, count++) spectrum(x, at, SIZE).forEach((p, k) => (sum[k] += p));
      return BANDS.map((b) => {
        let total = 0, n = 0;
        for (let k = 1; k < SIZE / 2; k++) {
          const f = (k * RATE) / SIZE;
          if (f > b / 1.41 && f < b * 1.41) (total += sum[k] / count), n++;
        }
        return total / n;
      });
    };
    const base = bands(flat[0]);
    for (const shaping of ["basic", "optimized", "weighted"] as const) {
      const shaped = bands((await noiseOf(shaping))[0]);
      BANDS.forEach((b, i) => expect(Math.abs(10 * Math.log10(shaped[i] / base[i]) - PRO_L_2[shaping][i]), `${shaping} at ${b} Hz`).toBeLessThanOrEqual(2));
    }
  });

  it("plays its automated Output: the ceiling moved by an automation clip", async () => {
    let s = song("tone1250", { output: 0 });
    s = editClips(s, (clips) => addClips(clips, [{ kind: "pattern", ref: P, track: 0, start: 0, length: TICKS }]).clips);
    const made = createAutomation(s, { kind: "proL", effect: L, control: "output" }, { start: 0, length: TICKS });
    // 0 dB for the first second (the −6 dBFS tone untouched), −12 dB after (the fraction of −30..0).
    s = editPoints(made.song, made.automationId, () => [
      { tick: 0, value: 1, tension: 0, curve: "single" },
      { tick: TICKS / 2, value: 1, tension: 0, curve: "single" },
      { tick: TICKS / 2, value: 0.6, tension: 0, curve: "single" },
      { tick: TICKS, value: 0.6, tension: 0, curve: "single" },
    ]);
    const sound = await played(s, 2, "song");
    expect(db(peak(sound.channels[0], 0.3 * RATE, 0.9 * RATE))).toBeCloseTo(-6, 1);
    expect(db(peak(sound.channels[0], 1.3 * RATE, 1.9 * RATE))).toBeCloseTo(-12, 1);
  });
});
