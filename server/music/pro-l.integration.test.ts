/**
 * YT-L's sound (`docs/fabfilter/pro-l.md` §8.9): the real engine, offline, playing test signals through a YT-L on
 * the master, measured here in TypeScript (nothing shared with the engine): the ceiling by sample, by BS.1770's
 * meter and by an ideal reconstruction; the latency it reports; nothing touched under the ceiling; a held bass
 * note undistorted (Auto Hold); loudness that always rises with Gain; the release stage; linking; the slot's mix.
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
import { addChannels, setSteps } from "../../shared/music/edits.ts";
import { setEffect } from "../../shared/music/mixer.ts";
import { type ProLPatch, updateProL } from "../../shared/music/pro-l.ts";
import { PRO_L_PLUGIN } from "../../shared/music/pro-l-presets.ts";
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
  /** A song at 120 BPM playing `sample` from its start, a YT-L on the master. */
  function song(sample: string, patch: ProLPatch = {}): MusicProject {
    let s = addChannels(createMusicProject("Loud", 120), [{ id: "chan_sig", name: "Signal", sampleId: sample }]);
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
  async function played(s: MusicProject, seconds: number) {
    await fresh();
    await engine.setSong({ projectId: PROJECT, song: s, patternId: P, mode: "pattern" });
    await engine.command("play", {});
    return hear(Math.round(seconds * RATE));
  }
  async function latency() {
    const status = await engine.command("status", {});
    return status.transport?.limiters?.[L]?.latency ?? -1;
  }

  beforeAll(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "pro-l-"));
    await writeWavChannels(path.join(dir, "drums.wav"), both(drums(2)), RATE);
    await writeWavChannels(path.join(dir, "noise.wav"), both(noise(2)), RATE);
    await writeWavChannels(path.join(dir, "loop.wav"), both(loop(4)), RATE);
    for (const f of [40, 60, 100]) await writeWavChannels(path.join(dir, `sine${f}.wav`), both(Float32Array.from({ length: 2 * RATE }, (_, i) => amp(-6) * Math.sin((2 * Math.PI * f * i) / RATE))), RATE);
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
            const sound = await played(song("click", { style, oversampling, truePeak, lookahead }), 0.5);
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
});
