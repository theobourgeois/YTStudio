/**
 * The Reverb's sound (`docs/reverb/reverb.md` 9.7): the real engine, offline, a Reverb on the master,
 * songs made with the app's own edits. Its impulse response is a click (one full-scale sample) played
 * through it; its measurements are `reverb-measure.ts`'s (tested on synthetic signals). Each test says
 * what passes; the numbers come from the design document.
 */
import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createAutomation, editPoints } from "../../shared/music/automation.ts";
import { addChannels, setSteps } from "../../shared/music/edits.ts";
import { routeChannels, setEffect, setSend } from "../../shared/music/mixer.ts";
import { addClips, editClips } from "../../shared/music/playlist.ts";
import { type ReverbPatch, chooseReverbPreset, decayCurve, findReverb, reverbT60, setReverbKey, updateReverb } from "../../shared/music/reverb.ts";
import { PLATE_TAPS, REVERB_OCTAVES, plateCurve } from "../../shared/music/reverb-modes.ts";
import { PRESET_LOUDNESS, REVERB_PLUGIN, REVERB_PRESETS } from "../../shared/music/reverb-presets.ts";
import { FIRST_PATTERN_ID, MASTER_TRACK_ID, createMusicProject } from "../../shared/music/project.ts";
import { type MusicProject, REVERB_MODES, type ReverbMode } from "../../shared/music/types.ts";
import { ENGINE } from "../config.ts";
import { DataPaths } from "../storage.ts";
import { AudioEngine } from "./engine.ts";
import {
  bandPass,
  correlation,
  dB,
  decayCurvature,
  echoDensity,
  energy,
  energyDecay,
  loudness,
  octaveBand,
  peakIndex,
  peakiness,
  pink,
  powerSpectrum,
  reverbTime,
  smoothTail,
  welch,
  whitened,
} from "./reverb-measure.ts";
import { type WavData, readWav, writeWavChannels } from "./wav.ts";

const P = FIRST_PATTERN_ID;
const PROJECT = "proj_0123456789ab";
const V = "fx_verb";
/** A clean measuring patch: fully wet, nothing in the way (no pre-delay, cuts, de-esser, ducking, onset shelf, mono below). */
const CLEAN: ReverbPatch = { mix: 1, predelay: 0, sync: false, lowCut: 20, highCut: 20000, deEss: 0, duck: 0, input: { vlfCut: 0 }, output: { monoBelow: 0 } };
/** Where each mode's early energy ends (s at scale 1): the late decay is measured after it. */
const EARLY_END: Record<ReverbMode, number> = { smoothPlate: 0.012, plate: 0, room: 0.04, chamber: 0.06, hall: 0.12, ambience: 0.08 };

/**
 * The T60 an octave band's measurement should read when T60 changes across the band: the band's energy
 * decay is every frequency in it decaying at its own rate (a white spectrum's weights), fitted as the
 * measurement fits it (T20 from -5 dB).
 */
function expectedBandT60(t60: readonly number[], centre: number): number {
  const fs: number[] = [];
  for (let k = 0; k <= 40; k++) fs.push((centre / Math.SQRT2) * 2 ** (k / 40));
  const at = (t: number) => fs.reduce((sum, f) => sum + f * decayCurve(t60, f) * Math.exp((-13.8155 * t) / decayCurve(t60, f)), 0);
  const e0 = at(0);
  const times: number[] = [];
  const levels: number[] = [];
  for (let t = 0; t < 60; t += 0.002) {
    const level = 10 * Math.log10(at(t) / e0);
    if (level > -5) continue;
    if (level < -25) break;
    times.push(t);
    levels.push(level);
  }
  const n = times.length,
    st = times.reduce((a, b) => a + b, 0),
    sy = levels.reduce((a, b) => a + b, 0);
  const stt = times.reduce((a, t) => a + t * t, 0),
    sty = times.reduce((a, t, i) => a + t * levels[i], 0);
  return -60 / ((n * sty - st * sy) / (n * stt - st * st));
}

const RATE = Number(process.env.VAUDIO_OFFLINE_RATE ?? 48_000);

describe.skipIf(!existsSync(ENGINE))("the Reverb, offline", () => {
  let dir: string;
  let engine: AudioEngine;
  let render = 0;

  /** A song at 120 BPM playing `sample` once from its start, a Reverb on the master set by `patch`. */
  function song(sample: string, patch: ReverbPatch = {}, preset?: string): MusicProject {
    let s = addChannels(createMusicProject("Verb", 120), [{ id: "chan_sig", name: "Signal", sampleId: sample }]);
    s = { ...s, channels: s.channels.map((c) => ({ ...c, volume: 1 })) };
    s = setSteps(s, P, "chan_sig", [0], true);
    s = { ...s, patterns: s.patterns.map((p) => (p.id === P ? { ...p, length: 16 * 96 * 400 } : p)) };
    s = setEffect(s, MASTER_TRACK_ID, 0, REVERB_PLUGIN, V);
    if (preset) s = chooseReverbPreset(s, V, preset);
    return updateReverb(s, V, { ...CLEAN, ...patch });
  }
  async function fresh() {
    await engine.command("stop", {});
    await engine.setSong({ projectId: PROJECT, song: createMusicProject("Silence", 120), patternId: P, mode: "pattern" });
    await engine.render(Math.round(RATE / 10));
  }
  async function hear(frames: number): Promise<WavData> {
    const file = path.join(dir, `render-${render++}.wav`);
    await engine.render(frames, file);
    return readWav(file);
  }
  async function played(s: MusicProject, seconds: number, mode: "pattern" | "song" = "pattern") {
    await fresh();
    await engine.setSong({ projectId: PROJECT, song: s, patternId: P, mode });
    await engine.command("play", {});
    return hear(Math.round(seconds * RATE));
  }
  /** The impulse response of a Reverb set by `patch` (the click is at sample 0 of the render). */
  const ir = (patch: ReverbPatch, seconds: number) => played(song("click", patch), seconds);
  const t60Of = (patch: ReverbPatch) => reverbT60(findReverb(song("click", patch), V)!.reverb);
  const scaleOf = (s: MusicProject) => {
    const r = findReverb(s, V)!.reverb;
    return r.size;
  };
  void scaleOf;

  beforeAll(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "reverb-"));
    const write = (name: string, left: Float32Array, right = left) => writeWavChannels(path.join(dir, `${name}.wav`), [left, right], RATE);
    const click = new Float32Array(RATE);
    click[0] = 1;
    await write("click", click);
    await write("pink", pink(RATE * 10, 1), pink(RATE * 10, 2));
    // Two seconds of pink noise, then silence (Freeze's, the long decay's burst).
    await write("burst", Float32Array.from(pink(RATE * 4, 3), (v, i) => (i < RATE * 2 ? v : 0)));
    // A glottal source's stand-in: a 100 Hz pulse train, band-limited (a Hann-windowed pulse each period), for a second.
    const pulses = new Float32Array(RATE * 2);
    for (let p = 0; p < RATE; p += RATE / 100) for (let k = 0; k < 24; k++) pulses[Math.round(p) + k] += 0.5 * Math.sin((Math.PI * k) / 24) ** 2;
    await write("pulses", pulses);
    // A 1 kHz tone held two seconds.
    await write("tone", Float32Array.from({ length: RATE * 4 }, (_, i) => (i < RATE * 2 ? 0.3 * Math.sin((2 * Math.PI * 1000 * i) / RATE) * Math.min(1, i / 480, (RATE * 2 - i) / 480) : 0)));
    // A vocal stand-in: pink noise in 400 ms phrases with 600 ms gaps, at -12 dBFS.
    const phrases = pink(RATE * 6, 4).map((v, i) => (i % RATE < RATE * 0.4 ? v * 0.25 * 1.4 : 0));
    await write("phrases", phrases);
    // A sibilant's stand-in (7 kHz-centred noise bursts) over a 300 Hz tone.
    const noise = bandPass(pink(RATE * 3, 5), RATE, 5500, 9000);
    await write("sibilant", Float32Array.from({ length: RATE * 3 }, (_, i) => 0.2 * Math.sin((2 * Math.PI * 300 * i) / RATE) + (i % (RATE / 2) < RATE / 8 ? 2 * noise[i] : 0)));
    engine = new AudioEngine(new DataPaths(dir), { offline: true, onlyPluginPaths: true, pluginPaths: [], samplePath: (_p, id) => path.join(dir, `${id}.wav`) });
  });
  afterAll(async () => {
    engine.shutdown();
    await fs.rm(dir, { recursive: true, force: true });
  });

  /** T60 of a band, both sides averaged, after the early energy. */
  const bandT60 = (wav: WavData, centre: number, after: number) => (reverbTime(octaveBand(wav.channels[0], RATE, centre), RATE, 20, after) + reverbTime(octaveBand(wav.channels[1], RATE, centre), RATE, 20, after)) / 2;

  it("1: rings at each octave band as long as it's asked (every mode, short to long, small and big, flat and shaped)", async () => {
    const misses: string[] = [];
    const shaped = [
      { id: 1, enabled: true, shape: "highShelf" as const, frequency: 4000, multiplier: 0.5, q: 1 },
      { id: 2, enabled: true, shape: "lowShelf" as const, frequency: 200, multiplier: 1.6, q: 1 },
    ];
    for (const mode of REVERB_MODES)
      for (const decay of [0.4, 1.5, 4])
        for (const size of [0.5, 1])
          for (const bands of decay === 1.5 && size === 0.5 ? [[], shaped] : [[]]) {
            const patch: ReverbPatch = { mode, decay, size, modDepth: 0, bands };
            const t60 = t60Of(patch);
            const wav = await ir(patch, Math.min(decay * 2.2, 9) + 0.6);
            // After the early energy, but not so late in a short decay that the fit starts far down (an octave
            // of a few modes scatters there). Ambience is its early energy: after it, always.
            const early = EARLY_END[mode] * 2.5 * size + 0.03;
            const after = Math.round(RATE * (mode === "ambience" ? early : Math.min(early, decay * 0.25)));
            for (const centre of [125, 250, 500, 1000, 2000, 4000, 8000]) {
              const want = expectedBandT60(t60, centre);
              const got = bandT60(wav, centre, after);
              // (An octave band of a short decay is a few modes: its measurement alone scatters ±15%, `reverb-measure.test.ts`.)
              const edge = centre === 125 || centre === 8000;
              const tolerance = decay < 1 ? (edge ? 0.25 : 0.18) : edge ? 0.2 : centre === 250 ? 0.15 : 0.12;
              if (Math.abs(got / want - 1) > tolerance) misses.push(`${mode} ${decay}s size ${size}${bands.length ? " shaped" : ""} @${centre}: ${got.toFixed(2)} for ${want.toFixed(2)}`);
            }
          }
    expect(misses).toEqual([]);
  }, 600_000);

  it("1: holds a 12 s decay, and dies at both ends of the spectrum (the two-stage filter's point)", async () => {
    const t60 = t60Of({ mode: "hall", decay: 12 });
    const wav = await ir({ mode: "hall", decay: 12, modDepth: 0 }, 14);
    const got = bandT60(wav, 1000, Math.round(RATE * 0.35));
    expect(Math.abs(got / expectedBandT60(t60, 1000) - 1)).toBeLessThan(0.12);
    // A 1.5 s decay rendered to three times its longest band: nothing at 20 Hz or 20 kHz still ringing above -60 dB.
    const short = await ir({ mode: "hall", decay: 1.5, modDepth: 0 }, 1.5 * 1.2 * 3 + 0.5);
    for (const band of [[10, 30], [16000, Math.min(22000, RATE * 0.45)]]) {
      const x = bandPass(short.channels[0], RATE, band[0], band[1]);
      const start = energy(x, 0, Math.round(RATE * 0.2));
      const end = energy(x, x.length - Math.round(RATE * 0.2));
      expect(dB(end) - dB(start)).toBeLessThan(-60);
    }
  }, 120_000);

  it("2: decays exponentially in every band, no double slope", async () => {
    for (const mode of REVERB_MODES) {
      const wav = await ir({ mode, decay: 1.5, modDepth: 0 }, 3.5);
      for (const centre of [500, 1000, 2000]) {
        // After the early energy: the late decay's straightness.
        const band = octaveBand(wav.channels[0], RATE, centre).subarray(Math.round(RATE * (EARLY_END[mode] + 0.03)));
        expect(decayCurvature(band, RATE), `${mode} @${centre}`).toBeLessThan(2.5);
      }
    }
  }, 120_000);

  it("3: is dense by its mixing time, and stays so (Abel and Huang's echo density)", async () => {
    // (Echo density reads velvet noise, mostly zeros, as sparse however smooth it sounds: a mode is dense once
    // its network has filled in after its early pattern. Plate's sparser onset is Dattorro's.)
    const MIXING: Record<ReverbMode, number> = { plate: 0.5, smoothPlate: 0.11, room: 0.06, chamber: 0.09, hall: 0.2, ambience: 0.11 };
    for (const mode of REVERB_MODES) {
      const t60 = t60Of({ mode, decay: 2 });
      const wav = await ir({ mode, decay: 2, modDepth: 0 }, 3);
      const x = wav.channels[0];
      const start = x.findIndex((v) => Math.abs(v) > 1e-6);
      const profile = echoDensity(x.subarray(start), Math.round((1024 * RATE) / 48000));
      const reached = profile.find((p) => p.density >= 0.9);
      expect(reached, mode).toBeTruthy();
      expect(reached!.at / RATE, mode).toBeLessThan(MIXING[mode]);
      // Stays dense while the tail is above -60 dB (after it's reached, allowing a dip of a few windows).
      const until = Math.min(2, t60[5]) * RATE;
      const later = profile.filter((p) => p.at > reached!.at && p.at < until);
      expect(later.filter((p) => p.density < 0.85).length / later.length, mode).toBeLessThan(0.04);
    }
  }, 120_000);

  /** Each mode at a decay it's made for (a room isn't a 2 s hall). */
  const OWN_DECAY: Record<ReverbMode, number> = { smoothPlate: 2, plate: 2, room: 0.8, chamber: 1.2, hall: 2.6, ambience: 0.5 };

  it("4: has no metallic modes: its tail's spectrum hardly peakier than smooth noise decaying the same way", async () => {
    for (const mode of REVERB_MODES) {
      const decay = OWN_DECAY[mode];
      const t60 = t60Of({ mode, decay });
      const span = Math.max(0.6, decay * 0.65);
      const wav = await ir({ mode, decay }, decay + 1.5);
      const tail = wav.channels[0].subarray(Math.round(RATE * 0.1), Math.round(RATE * (0.1 + span)));
      const reference = smoothTail(RATE, span, REVERB_OCTAVES, t60);
      const size = 8192;
      const ours = peakiness(welch(whitened(tail, RATE), size), RATE, size, 200, 10000);
      const smooth = peakiness(welch(whitened(reference, RATE), size), RATE, size, 200, 10000);
      // (A network's modes are fixed: Welch's frames can't average them out as they do noise's. Rooms, with
      // the least memory for their decay, show it most: `docs/reverb/reverb.md` 12.)
      expect(ours, `${mode}: ${ours.toFixed(1)} dB against ${smooth.toFixed(1)}`).toBeLessThan(smooth + (decay < 1.5 ? 4.5 : 2.5));
      expect(ours).toBeLessThan(12);
    }
  }, 120_000);

  it("5: no mode rings much longer than its band (against smooth noise measured the same way)", async () => {
    const N = 8192;
    /** The 99th percentile of each bin's decay time against its band's, between two frames a second apart. */
    const slowest = (x: ArrayLike<number>, t60: readonly number[]) => {
      const frame = (t: number) => powerSpectrum(Float64Array.from({ length: N }, (_, k) => x[Math.round(t * RATE) + k] * (0.5 - 0.5 * Math.cos((2 * Math.PI * k) / N))));
      // Half the decay apart (above the floor even for Ambience's short tail).
      const apart = Math.min(1, 0.5 * t60[5]);
      const a = frame(0.3),
        b = frame(0.3 + apart);
      const ratios: number[] = [];
      for (let k = Math.round((100 * N) / RATE); k < Math.round((10000 * N) / RATE); k++) ratios.push((60 * apart) / (10 * Math.log10(a[k] / b[k])) / decayCurve(t60, (k * RATE) / N));
      ratios.sort((p, q) => p - q);
      return ratios[Math.floor(ratios.length * 0.99)];
    };
    for (const mode of REVERB_MODES) {
      const decay = Math.max(2, OWN_DECAY[mode]);
      const t60 = t60Of({ mode, decay, modDepth: 0 });
      const wav = await ir({ mode, decay, modDepth: 0 }, 3.6);
      const ours = slowest(wav.channels[0], t60);
      const smooth = slowest(smoothTail(RATE, 3.6, REVERB_OCTAVES, t60, 13), t60);
      expect(ours, `${mode}: ${ours.toFixed(2)} against ${smooth.toFixed(2)}`).toBeLessThan(smooth * 1.3);
    }
  }, 120_000);

  it("6: doesn't ring on a male voice's pulses: its partials no taller than through smooth noise", async () => {
    for (const mode of REVERB_MODES) {
      const t60 = t60Of({ mode, decay: 2 });
      const wav = await played(song("pulses", { mode, decay: 2 }), 2);
      const tail = wav.channels[0].subarray(Math.round(RATE * 1.05), Math.round(RATE * 1.55));
      // The same pulses through a smooth tail (convolved: a pulse each 10 ms, the tail shifted and added).
      const reference = smoothTail(RATE, 2, REVERB_OCTAVES, t60, 11);
      const through = new Float64Array(RATE * 2);
      for (let p = 0; p < RATE; p += RATE / 100) for (let i = 0; i + p < through.length; i++) through[i + p] += reference[i];
      const refTail = through.subarray(Math.round(RATE * 1.05), Math.round(RATE * 1.55));
      // How much of the tail is still at the pulses' harmonics against between them (every partial together,
      // so it's steady), against the same through the smooth tail: a ringing network keeps the harmonics.
      const harmonicity = (x: ArrayLike<number>) => {
        const spectrum = welch(x, 8192);
        let on = 0,
          off = 0;
        for (let h = 1; h < 50; h++) {
          const k = Math.round((h * 100 * 8192) / RATE),
            between = Math.round(((h + 0.5) * 100 * 8192) / RATE);
          on += spectrum[k - 1] + spectrum[k] + spectrum[k + 1];
          off += spectrum[between - 1] + spectrum[between] + spectrum[between + 1];
        }
        return 10 * Math.log10(on / off);
      };
      expect(harmonicity(tail), mode).toBeLessThan(harmonicity(refTail) + 6);
    }
  }, 120_000);

  it("7, 8: is wide but mono-safe, and its width follows the knob", async () => {
    const correlations: number[] = [];
    for (const width of [0, 0.5, 1, 1.5]) {
      const wav = await played(song("pink", { mode: "hall", decay: 2, width }), 6);
      const L = wav.channels[0].subarray(RATE * 2),
        R = wav.channels[1].subarray(RATE * 2);
      if (width === 0) {
        let most = 0;
        for (let i = 0; i < L.length; i++) most = Math.max(most, Math.abs(L[i] - R[i]));
        expect(20 * Math.log10(most + 1e-12)).toBeLessThan(-90);
      }
      if (width === 1)
        for (const centre of [125, 250, 500, 1000, 2000, 4000, 8000]) {
          const l = octaveBand(L, RATE, centre),
            r = octaveBand(R, RATE, centre);
          const rho = correlation(l, r);
          expect(rho, `ρ @${centre}`).toBeGreaterThan(-0.3);
          expect(rho, `ρ @${centre}`).toBeLessThan(0.5);
          const mono = energy(l.map((v, i) => (v + r[i]) / 2));
          expect(dB(mono) - dB((energy(l) + energy(r)) / 2), `mono @${centre}`).toBeGreaterThan(-5);
        }
      correlations.push(correlation(L, R));
    }
    for (let i = 1; i < correlations.length; i++) expect(correlations[i]).toBeLessThan(correlations[i - 1]);
  }, 120_000);

  it("9: holds a frozen tail for minutes, level steady, nothing new let in", async () => {
    await fresh();
    let s = song("burst", { mode: "smoothPlate", decay: 2 });
    await engine.setSong({ projectId: PROJECT, song: s, patternId: P, mode: "pattern" });
    await engine.command("play", {});
    await hear(RATE * 2);
    s = updateReverb(s, V, { freeze: true });
    await engine.setSong({ projectId: PROJECT, song: s, patternId: P, mode: "pattern" });
    const first = await hear(RATE * 2);
    const level = (w: WavData) => dB(energy(w.channels[0], w.channels[0].length - RATE));
    const start = level(first);
    for (let minute = 0; minute < 3; minute++) {
      const w = await hear(RATE * 60);
      for (const c of w.channels) for (const v of c) expect(Number.isFinite(v)).toBe(true);
      expect(Math.max(...w.channels[0].subarray(0, RATE))).toBeLessThan(1);
      expect(Math.abs(level(w) - start), `after ${minute + 1} min`).toBeLessThan(1);
    }
  }, 300_000);

  it("10: a 60 s decay with deep modulation still falls at its rate, a hundred turns of it on", async () => {
    await fresh();
    const t60 = t60Of({ mode: "hall", decay: 60 });
    const s = song("burst", { mode: "hall", decay: 60, modDepth: 1, modRate: 2 });
    await engine.setSong({ projectId: PROJECT, song: s, patternId: P, mode: "pattern" });
    await engine.command("play", {});
    // Within the pattern's longest (a minute: it plays again after), the modulation's half-second turns
    // a hundred times over between the two.
    await hear(RATE * 10);
    const a = await hear(RATE * 10);
    await hear(RATE * 20);
    const b = await hear(RATE * 10);
    const band = (w: WavData) => dB(energy(octaveBand(w.channels[0], RATE, 1000)));
    const rate = (band(a) - band(b)) / 30;
    expect(Math.abs(rate / (60 / expectedBandT60(t60, 1000)) - 1)).toBeLessThan(0.15);
  }, 300_000);

  it("11: costs next to nothing once silent", async () => {
    await fresh();
    await engine.setSong({ projectId: PROJECT, song: song("burst", { mode: "hall", decay: 1.5 }), patternId: P, mode: "pattern" });
    await engine.command("play", {});
    const time = async () => {
      const t = performance.now();
      await engine.render(RATE);
      return performance.now() - t;
    };
    const active = [await time(), await time()];
    for (let i = 0; i < 8; i++) await time();
    const idle = [await time(), await time(), await time()];
    const busy = Math.min(...active);
    expect(Math.max(...idle)).toBeLessThan(busy * 0.35);
  }, 120_000);

  it("12, 13: adds no latency; its pre-delay is where it's set, in ms or at the tempo", async () => {
    const onset = (x: Float32Array, from = 1) => {
      const peak = Math.max(...Array.from(x.subarray(from), Math.abs));
      for (let i = from; i < x.length; i++) if (Math.abs(x[i]) > peak * 0.01) return i;
      return -1;
    };
    const dry = await played(song("click", { mix: 0 }), 0.5);
    expect(peakIndex(dry.channels[0])).toBe(0);
    const half = await played(song("click", { mode: "plate", mix: 0.5 }), 1);
    expect(peakIndex(half.channels[0])).toBe(0);
    const at0 = onset((await ir({ mode: "plate" }, 1)).channels[0]);
    const at40 = onset((await ir({ mode: "plate", predelay: 0.04 }, 1)).channels[0]);
    expect(Math.abs((at40 - at0) / RATE - 0.04)).toBeLessThan(0.0005);
    const sixteenth = onset((await ir({ mode: "plate", sync: true, predelayNote: { note: 16, feel: "straight" } }, 1)).channels[0]);
    expect(Math.abs((sixteenth - at0) / RATE - 0.125)).toBeLessThan(0.0005);
  }, 60_000);

  it("14: ducks under the voice and swells back in the gaps, by its own input or another track's", async () => {
    const DUCK: ReverbPatch = { mode: "hall", decay: 2, duck: -10, ducking: { threshold: -30, attack: 0.01, release: 0.25, hold: 0, what: "all" } };
    const open = await played(song("phrases", { ...DUCK, duck: 0 }), 5);
    const ducked = await played(song("phrases", DUCK), 5);
    const level = (w: WavData, a: number, b: number) => dB(energy(w.channels[0], Math.round(a * RATE), Math.round(b * RATE)));
    for (const phrase of [2, 3]) {
      expect(level(open, phrase + 0.1, phrase + 0.38) - level(ducked, phrase + 0.1, phrase + 0.38)).toBeCloseTo(10, 0);
      // Back within 1 dB 250 ms (±20%) after the phrase ends.
      expect(Math.abs(level(open, phrase + 0.4 + 0.3, phrase + 0.4 + 0.34) - level(ducked, phrase + 0.4 + 0.3, phrase + 0.4 + 0.34))).toBeLessThan(1);
    }
    // Keyed from another track: phrases on Insert 2 (its slot's key, after the fader) duck the reverb of a steady sound.
    let s = song("pink", DUCK);
    s = addChannels(s, [{ id: "chan_lead", name: "Lead", sampleId: "phrases" }]);
    s = { ...s, channels: s.channels.map((c) => ({ ...c, volume: 1 })) };
    s = setSteps(s, P, "chan_lead", [0], true);
    s = routeChannels(s, ["chan_lead"], "insert_2");
    s = setSend(s, "insert_2", MASTER_TRACK_ID, 0);
    s = setReverbKey(s, V, "insert_2");
    const keyed = await played(s, 5);
    const steady = await played(song("pink", { ...DUCK, duck: 0 }), 5);
    expect(level(steady, 3.1, 3.38) - level(keyed, 3.1, 3.38)).toBeGreaterThan(8);
    expect(Math.abs(level(steady, 3.7, 3.95) - level(keyed, 3.7, 3.95))).toBeLessThan(1.5);
  }, 120_000);

  it("15: keeps sibilance out of the reverb, the rest untouched", async () => {
    const off = await played(song("sibilant", { mode: "room", decay: 0.6, deEss: 0 }), 3);
    const on = await played(song("sibilant", { mode: "room", decay: 0.6, deEss: 8 }), 3);
    const band = (w: WavData, lo: number, hi: number) => dB(energy(bandPass(w.channels[0], RATE, lo, hi), RATE / 2, RATE * 2.5));
    expect(band(off, 6000, 8500) - band(on, 6000, 8500)).toBeGreaterThan(6.5);
    expect(band(off, 6000, 8500) - band(on, 6000, 8500)).toBeLessThan(9.5);
    expect(Math.abs(band(off, 250, 350) - band(on, 250, 350))).toBeLessThan(0.5);
  }, 60_000);

  it("16, 17: changes don't click or bend, and a new mode rings the old tail out at its own rate", async () => {
    // A click is what a 1 kHz tone and its reverb never have: sound above 5 kHz. Its loudest sample there,
    // under the tone (-10.5 dBFS) by 50 dB at least.
    const clicks = (w: WavData) => {
      const hf = bandPass(w.channels[0], RATE, 5000, 20000);
      let most = 0;
      for (let i = RATE / 20; i < hf.length - RATE / 20; i++) most = Math.max(most, Math.abs(hf[i]));
      return dB(most ** 2);
    };
    // Decay, pre-delay and size automated (song mode) while a tone holds, in a Plate and a Hall (its early
    // taps and line feeds).
    for (const mode of ["plate", "hall"] as const) {
      let s = song("tone", { mode, decay: 1.5, modDepth: 0 });
      s = editClips(s, (clips) => addClips(clips, [{ kind: "pattern", ref: P, track: 0, start: 0, length: 96 * 16 }]).clips);
      for (const control of ["decay", "predelay", "size"] as const) {
        const made = createAutomation(s, { kind: "reverb", effect: V, control }, { start: 0, length: 96 * 4 }, { id: `auto_${control}` });
        const auto = editPoints(made.song, `auto_${control}`, () => [
          { tick: 0, value: 0.3, tension: 0, curve: "single" },
          { tick: 96 * 4, value: 0.6, tension: 0, curve: "single" },
        ]);
        expect(clicks(await played(auto, 2, "song")), `${mode} ${control}`).toBeLessThan(-60);
      }
    }
    // A new mode mid-tail: the old one goes on falling at its rate.
    await fresh();
    const hall = song("click", { mode: "hall", decay: 3, modDepth: 0 });
    await engine.setSong({ projectId: PROJECT, song: hall, patternId: P, mode: "pattern" });
    await engine.command("play", {});
    const before = await hear(RATE);
    await engine.setSong({ projectId: PROJECT, song: updateReverb(hall, V, { mode: "room", decay: 0.5 }), patternId: P, mode: "pattern" });
    const after = await hear(RATE);
    // Half a second on (the click's tail gets quiet enough to be let go of past -100 dB).
    const band = (w: WavData, from: number, to: number) => dB(energy(octaveBand(w.channels[0], RATE, 1000), Math.round(from * RATE), Math.round(to * RATE)));
    const rate = (band(before, 0.75, 1) - band(after, 0.25, 0.5)) / 0.5;
    expect(Math.abs(rate / (60 / expectedBandT60(t60Of({ mode: "hall", decay: 3 }), 1000)) - 1)).toBeLessThan(0.15);
  }, 120_000);

  it("18: plays the same every time (seeded: the velvet taps and the random modulation)", async () => {
    const patch: ReverbPatch = { mode: "hall", decay: 2, late: { modShape: "random", diffusion: null, variation: 1, toneLock: true } };
    const a = await ir(patch, 1.5);
    const b = await ir(patch, 1.5);
    let most = 0;
    for (let i = 0; i < a.channels[0].length; i++) most = Math.max(most, Math.abs(a.channels[0][i] - b.channels[0][i]));
    expect(20 * Math.log10(most + 1e-12)).toBeLessThan(-100);
  }, 60_000);

  it("19: darkens and limits in the old eras as their band limits say", async () => {
    const spectrum = async (era: "now" | "1980s" | "1970s") => welch((await played(song("pink", { mode: "hall", decay: 1.5, era }), 6)).channels[0].subarray(RATE * 2), 8192);
    const now = await spectrum("now");
    const level = (s: Float64Array, f: number) => 10 * Math.log10(s.subarray(Math.round(((f / 1.06) * 8192) / RATE), Math.round(((f * 1.06) * 8192) / RATE)).reduce((a, b) => a + b, 0));
    for (const [era, limit] of [["1980s", 18000], ["1970s", 9000]] as const) {
      if (limit > RATE * 0.45) continue;
      const s = await spectrum(era);
      // The band limit's knee, against the same era's level a fifth of the way below it, so the
      // loop's darkening and the aperture lift (both slow across that) and the early energy (which
      // the loop doesn't darken) cancel out.
      const knee = (x: Float64Array) => level(x, limit) - level(x, limit * 0.8);
      expect(knee(s) - knee(now), era).toBeGreaterThan(-4.5);
      expect(knee(s) - knee(now), era).toBeLessThan(-1.5);
      expect(level(s, Math.min(limit * 1.6, RATE * 0.45)) - level(now, Math.min(limit * 1.6, RATE * 0.45)), era).toBeLessThan(-20);
      expect(Math.abs(level(s, 1000) - level(now, 1000)), era).toBeLessThan(1);
    }
  }, 120_000);

  it("21: keeps a lead vocal clear at an insert's mix (the direct sound stands over what builds up in 100 ms)", async () => {
    for (const preset of REVERB_PRESETS.filter((p) => p.folder === "Lead Vocal")) {
      const wav = await played(song("click", { mix: 0.25 }, preset.name), 0.4);
      const x = bandPass(wav.channels[0], RATE, 700, 4000);
      const direct = energy(x, 0, Math.round(RATE * 0.005)) * Math.round(RATE * 0.005);
      const built = energy(x, Math.round(RATE * 0.005), Math.round(RATE * 0.1)) * Math.round(RATE * 0.095);
      expect(dB(direct) - dB(built), preset.name).toBeGreaterThan(3);
    }
  }, 120_000);

  it("22: no grain or flutter on a held note's tail", async () => {
    for (const mode of REVERB_MODES) {
      const decay = Math.max(OWN_DECAY[mode], 0.8);
      const t60 = t60Of({ mode, decay });
      const wav = await played(song("tone", { mode, decay }), 2.6);
      // After the early energy: the late tail's (Ambience's is mostly early energy, fading into its quiet
      // late tail: well after it, or the fit reads that bend as a flutter).
      const from = 2.02 + EARLY_END[mode] * (mode === "ambience" ? 2.5 : 1.2);
      const partials = wav.channels.map((c) => bandPass(c, RATE, 900, 1110).subarray(Math.round(RATE * from), Math.round(RATE * (from + 0.45))));
      const references = [21, 22, 23].map((seed) => bandPass(smoothTail(RATE, 0.6, REVERB_OCTAVES, t60, seed), RATE, 900, 1110).subarray(Math.round(RATE * 0.05), Math.round(RATE * 0.5)));
      // Its envelope (5 ms RMS) over its own fitted exponential, then the residue's power from 2 to 50 Hz:
      // the mean over that band and over several tails (one tail's loudest bin is a lottery of its modes).
      const flutter = (tails: ArrayLike<number>[]) => {
        let sum = 0,
          count = 0;
        for (const x of tails) {
          const env = Array.from({ length: Math.floor(x.length / (RATE / 200)) }, (_, k) => dB(energy(x, (k * RATE) / 200, ((k + 1) * RATE) / 200)));
          const n = env.length,
            ts = env.map((_, i) => i);
          const st = ts.reduce((a, b) => a + b, 0),
            sy = env.reduce((a, b) => a + b, 0);
          const slope = (n * ts.reduce((a, t, i) => a + t * env[i], 0) - st * sy) / (n * ts.reduce((a, t) => a + t * t, 0) - st * st);
          const residue = Float64Array.from({ length: 128 }, (_, i) => (i < n ? env[i] - (sy / n + slope * (i - st / n)) : 0));
          const power = powerSpectrum(residue);
          for (let k = 1; k < power.length; k++) {
            const f = (k * 200) / 128;
            if (f >= 2 && f <= 50) (sum += power[k]), count++;
          }
        }
        return 10 * Math.log10(sum / count + 1e-30);
      };
      // (Plate is Dattorro's four long lines: a held note's tail beats at their period, the classic plate's
      // character, "objectionable on piano" as he says; Smooth Plate is the vocal one. Hall's long tail is
      // its lush chorus: its moving modes beat a held partial, as a 480L's chorused hall does.)
      expect(flutter(partials), mode).toBeLessThan(flutter(references) + (mode === "plate" || mode === "hall" ? 8 : 6));
    }
  }, 120_000);

  it("23: has every mode and every preset as loud as the others", async () => {
    const dryWav = await played((() => {
      let s = addChannels(createMusicProject("Dry", 120), [{ id: "chan_sig", name: "Signal", sampleId: "pink" }]);
      s = { ...s, channels: s.channels.map((c) => ({ ...c, volume: 1 })) };
      s = setSteps(s, P, "chan_sig", [0], true);
      return { ...s, patterns: s.patterns.map((p) => (p.id === P ? { ...p, length: 16 * 96 * 400 } : p)) };
    })(), 5);
    const dry = loudness(dryWav.channels[0].subarray(RATE * 2), dryWav.channels[1].subarray(RATE * 2));
    const off: string[] = [];
    // The modes first (Init at Decay 1.8 s, each mode's `calibration`), as loud as each other.
    const modes = new Map<ReverbMode, number>();
    for (const mode of REVERB_MODES) {
      const wav = await played(song("pink", { mode, decay: 1.8, mix: 1, duck: 0, ducking: { autoDecay: 0 } }, "Init"), 5);
      modes.set(mode, loudness(wav.channels[0].subarray(RATE * 2), wav.channels[1].subarray(RATE * 2)) - dry);
    }
    const mean = [...modes.values()].reduce((a, b) => a + b, 0) / modes.size;
    for (const [mode, l] of modes) if (Math.abs(l - mean) > 0.5) off.push(`${mode}: ${(l - mean).toFixed(2)} LU from the others (its calibration ${(mean - l).toFixed(2)} more)`);
    for (const preset of REVERB_PRESETS) {
      if (preset.name === "Infinite") continue;
      const wav = await played(song("pink", { mix: 1, duck: 0, ducking: { autoDecay: 0 }, ...(presetCuts(preset.name)) }, preset.name), 5);
      const l = loudness(wav.channels[0].subarray(RATE * 2), wav.channels[1].subarray(RATE * 2)) - dry;
      if (Math.abs(l - PRESET_LOUDNESS) > 1) off.push(`${preset.name}: ${l.toFixed(2)} LU (trim it by ${(PRESET_LOUDNESS - l).toFixed(1)})`);
    }
    expect(off).toEqual([]);
  }, 600_000);

  it("24: follows the EMT 140 in Plate (its curve as ratios to 1 kHz at three damper settings)", async () => {
    for (const decay of [1.05, 2.15, 4.0]) {
      const wav = await ir({ mode: "plate", decay, modDepth: 0 }, decay * 2.5 + 0.6);
      const at1k = bandT60(wav, 1000, Math.round(RATE * 0.03));
      for (const centre of [125, 250, 500, 2000, 4000, 8000]) {
        const want = plateCurve(decay, centre) / plateCurve(decay, 1000);
        const got = bandT60(wav, centre, Math.round(RATE * 0.03)) / at1k;
        expect(Math.abs(got / want - 1), `${decay}s @${centre}: ${got.toFixed(2)} for ${want.toFixed(2)}`).toBeLessThan(0.2);
      }
    }
  }, 120_000);

  it("plays Dattorro's output taps from the plate's lines (Table 2: seven a side)", () => {
    expect(PLATE_TAPS.filter((t) => t.side === 0)).toHaveLength(7);
    expect(PLATE_TAPS.filter((t) => t.side === 1)).toHaveLength(7);
    void energyDecay;
  });
});

/** A preset's own settings kept, the measuring patch's cleanups not applied (presets are measured as they are). */
function presetCuts(name: string): ReverbPatch {
  const preset = REVERB_PRESETS.find((p) => p.name === name)!.settings;
  return { lowCut: preset.lowCut ?? 20, highCut: preset.highCut ?? 20000, deEss: preset.deEss ?? 0, input: { vlfCut: preset.input?.vlfCut ?? 0 }, output: { monoBelow: preset.output?.monoBelow ?? 0 }, predelay: preset.predelay ?? 0.02, sync: preset.sync ?? false };
}
