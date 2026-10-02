/**
 * Pro-Q's sound (`docs/fabfilter/pro-q.md`): the real engine, offline, playing an impulse through a Pro-Q
 * on the master, and what comes out measured against the analog curve the tab draws
 * (`shared/music/pro-q-filters.ts`): Zero Latency within a tenth of a dB for bands under a ninth of the rate (half a dB above),
 * Natural Phase exact to 20 kHz (magnitude and phase, 7.3 ms late), Linear Phase exact with its own
 * latency; and placements, dynamics, the output and solo. At 48 kHz.
 */
import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { addChannels, setSteps } from "../../shared/music/edits.ts";
import { setEffect } from "../../shared/music/mixer.ts";
import { FIRST_PATTERN_ID, MASTER_TRACK_ID, createMusicProject } from "../../shared/music/project.ts";
import { editProQ } from "../../shared/music/pro-q.ts";
import { bandSections, playedBand, responseAt } from "../../shared/music/pro-q-filters.ts";
import { DEFAULT_BAND, PRO_Q_PLUGIN } from "../../shared/music/pro-q-presets.ts";
import type { EqBand, MusicProject, ProQ } from "../../shared/music/types.ts";
import { ENGINE } from "../config.ts";
import { DataPaths } from "../storage.ts";
import { AudioEngine } from "./engine.ts";
import { type WavData, readWav, writeWav, writeWavChannels } from "./wav.ts";

const RATE = 48_000;
const P = FIRST_PATTERN_ID;
const PROJECT = "proj_0123456789ab";
const EQ = "fx_proq";
const band = (id: number, patch: Partial<EqBand>): EqBand => ({ ...DEFAULT_BAND, id, ...patch });
/** The impulse's height: well under full scale, which the rendered WAV clips at (a boost's first sample is over it). */
const AMP = 0.125;

/** The response of `samples` (from `start`) at `hz`: its magnitude in dB and phase in radians, `delay` samples taken off. */
function measure(samples: Float32Array, hz: number, start = 0, delay = 0): { db: number; phase: number } {
  let re = 0;
  let im = 0;
  const w = (2 * Math.PI * hz) / RATE;
  for (let n = start; n < samples.length; n++) {
    re += samples[n] * Math.cos(w * (n - start - delay));
    im -= samples[n] * Math.sin(w * (n - start - delay));
  }
  return { db: 10 * Math.log10((re * re + im * im) / (AMP * AMP)), phase: Math.atan2(im, re) };
}
/** The analog curve the tab draws, at `hz`. */
function analog(bands: EqBand[], hz: number, pq: Pick<ProQ, "gainScale" | "gainQ"> = { gainScale: 1, gainQ: false }) {
  let re = 1;
  let im = 0;
  for (const b of bands) {
    const [r, i] = responseAt(bandSections(playedBand(b, pq)), hz);
    [re, im] = [re * r - im * i, re * i + im * r];
  }
  return { db: 10 * Math.log10(re * re + im * im), phase: Math.atan2(im, re) };
}
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
const FREQUENCIES = [20, 31.5, 50, 80, 125, 200, 315, 500, 800, 1250, 2000, 3150, 5000, 8000, 11_000];

describe.skipIf(!existsSync(ENGINE))("Pro-Q, offline", () => {
  let dir: string;
  let engine: AudioEngine;
  let render = 0;

  async function hear(frames: number): Promise<WavData> {
    const file = path.join(dir, `render-${render++}.wav`);
    await engine.render(frames, file);
    return readWav(file);
  }
  /** A song at 120 BPM: `sample` on the first step, a Pro-Q on the master set by `change`. */
  function song(change: (pq: ProQ) => ProQ, sample = "impulse"): MusicProject {
    let s = addChannels(createMusicProject("EQ", 120), [{ id: "chan_x", name: "X", sampleId: sample }]);
    s = setSteps(s, P, "chan_x", [0], true);
    s = setEffect(s, MASTER_TRACK_ID, 0, PRO_Q_PLUGIN, EQ);
    return editProQ(s, EQ, change);
  }
  /** Play `s` and hear `frames` of it (the hit is on the first sample). */
  async function play(s: MusicProject, frames: number) {
    await engine.setSong({ projectId: PROJECT, song: s, patternId: P, mode: "pattern" });
    // A moment for its settings to glide from the last song's (and its kernels to be taken), stopped.
    await hear(RATE / 5);
    await engine.command("play", {});
    return hear(frames);
  }

  beforeAll(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "pro-q-"));
    // An impulse, and a stereo one: left only (to tell the sides apart).
    const impulse = new Float32Array(8);
    impulse[0] = AMP;
    await writeWav(path.join(dir, "impulse.wav"), impulse, RATE);
    await writeWavChannels(path.join(dir, "left.wav"), [impulse, new Float32Array(8)], RATE);
    // A loud 1 kHz sine, two seconds, and the same quiet.
    const sine = (level: number) => Float32Array.from({ length: RATE * 2 }, (_, n) => level * Math.sin((2 * Math.PI * 1000 * n) / RATE));
    await writeWav(path.join(dir, "loud.wav"), sine(0.9), RATE);
    await writeWav(path.join(dir, "quiet.wav"), sine(0.01), RATE);
    engine = new AudioEngine(new DataPaths(dir), {
      offline: true,
      onlyPluginPaths: true,
      pluginPaths: [],
      samplePath: (_project, id) => (["impulse", "left", "loud", "quiet"].includes(id) ? path.join(dir, `${id}.wav`) : null),
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

  it("leaves the sound exactly as it is with no bands", async () => {
    const sound = await play(
      song((pq) => pq),
      4096,
    );
    expect(sound.channels[0][0]).toBeCloseTo(AMP, 6);
    expect(Math.max(...sound.channels[0].slice(1).map(Math.abs))).toBeLessThan(1e-6);
  });

  it("Zero Latency: every shape matches the analog curve within a tenth of a dB below 11 kHz, with no delay", async () => {
    const cases: EqBand[][] = [
      [band(1, { frequency: 1000, gain: 9, q: 1 })],
      [band(1, { frequency: 120, gain: -12, q: 4 })],
      [band(1, { frequency: 3000, gain: 6, q: 0.5, slope: 48 })],
      [band(1, { shape: "lowShelf", frequency: 200, gain: 8, q: 1 }), band(2, { shape: "highShelf", frequency: 6000, gain: -6, q: 2, slope: 24 })],
      [band(1, { shape: "lowCut", frequency: 80, slope: 24, q: 1 }), band(2, { shape: "highCut", frequency: 4000, slope: 12, q: 2 })],
      [band(1, { shape: "notch", frequency: 1000, q: 4 })],
      [band(1, { shape: "bandPass", frequency: 700, q: 1, slope: 12 })],
      [band(1, { shape: "tiltShelf", frequency: 1000, gain: 6, slope: 6 })],
      [band(1, { shape: "flatTilt", frequency: 1000, gain: 12 })],
    ];
    for (const bands of cases) {
      await engine.command("stop", {});
      const sound = await play(
        song((pq) => ({ ...pq, bands })),
        RATE,
      );
      for (const hz of FREQUENCIES) {
        const want = analog(bands, hz).db;
        if (want < -40) continue;
        // Deep in a skirt (20 dB down and more), half a dB; a Flat Tilt (a ladder of shelves reaching past
        // Nyquist, their small errors adding up), a quarter. Natural Phase makes both exact.
        const tolerance = want < -20 ? 0.5 : bands[0].shape === "flatTilt" ? 0.25 : 0.1;
        expect(Math.abs(measure(sound.channels[0], hz).db - want), `${bands.map((b) => b.shape).join("+")} at ${hz} Hz`).toBeLessThan(tolerance);
      }
    }
  });

  it("Zero Latency near the top: within half a dB (as Pro-Q's, it can't be exact there)", async () => {
    const bands = [band(1, { frequency: 12_000, gain: 9, q: 1 }), band(2, { shape: "highCut", frequency: 9000, slope: 12, q: 2 })];
    const sound = await play(
      song((pq) => ({ ...pq, bands })),
      RATE,
    );
    for (const hz of [...FREQUENCIES, 14_000, 16_000]) expect(Math.abs(measure(sound.channels[0], hz).db - analog(bands, hz).db), `at ${hz} Hz`).toBeLessThan(0.5);
  });

  it("Natural Phase: the analog magnitude and phase to 20 kHz, 7.3 ms late (and the song says so)", async () => {
    const bands = [band(1, { frequency: 15_000, gain: 12, q: 1 }), band(2, { frequency: 60, gain: 8, q: 4 }), band(3, { shape: "lowCut", frequency: 30, q: 1 })];
    const sound = await play(
      song((pq) => ({ ...pq, mode: "naturalPhase", bands })),
      RATE,
    );
    const delay = Math.round(0.0073 * RATE);
    expect((await engine.command("status", {})).songLatency).toBe(delay);
    for (const hz of [...FREQUENCIES, 14_000, 16_000, 18_000, 20_000]) {
      const want = analog(bands, hz);
      const got = measure(sound.channels[0], hz, 0, delay);
      expect(got.db, `at ${hz} Hz`).toBeCloseTo(want.db, 1);
      expect(Math.abs(wrap(got.phase - want.phase)), `phase at ${hz} Hz`).toBeLessThan(0.02);
    }
  });

  it("Linear Phase: the analog magnitude, no phase change, Pro-Q's latency", async () => {
    const bands = [band(1, { frequency: 1000, gain: 9, q: 2 }), band(2, { shape: "highShelf", frequency: 8000, gain: -6 })];
    const sound = await play(
      song((pq) => ({ ...pq, mode: "linearPhase", resolution: "medium", bands })),
      RATE,
    );
    // 5120 samples at 44.1 kHz: half an 8k kernel and a block of 1024.
    const latency = 8192 / 2 + 1024;
    expect((await engine.command("status", {})).songLatency).toBe(latency);
    for (const hz of FREQUENCIES.filter((f) => f >= 50)) {
      const got = measure(sound.channels[0], hz, 0, latency);
      expect(got.db, `at ${hz} Hz`).toBeCloseTo(analog(bands, hz).db, 1);
      expect(Math.abs(wrap(got.phase)), `phase at ${hz} Hz`).toBeLessThan(0.01);
    }
  });

  it("places bands: a left band leaves the right alone; a mid band leaves the side alone", async () => {
    // A cut on the left: the left's impulse is changed, the right (silent in, silent out) stays silent.
    let sound = await play(
      song((pq) => ({ ...pq, bands: [band(1, { frequency: 1000, gain: -12, placement: "right" })] }), "left"),
      RATE / 2,
    );
    expect(measure(sound.channels[0], 1000).db).toBeCloseTo(0, 2);
    expect(Math.max(...sound.channels[1].map(Math.abs))).toBeLessThan(1e-7);
    await engine.command("stop", {});
    sound = await play(
      song((pq) => ({ ...pq, bands: [band(1, { frequency: 1000, gain: -12, placement: "left" })] }), "left"),
      RATE / 2,
    );
    expect(measure(sound.channels[0], 1000).db).toBeCloseTo(-12, 1);
    // A side boost on a left-only impulse: mid and side are equal halves, so the side's gain shows on both.
    await engine.command("stop", {});
    sound = await play(
      song((pq) => ({ ...pq, bands: [band(1, { frequency: 1000, gain: 6, placement: "side" })] }), "left"),
      RATE / 2,
    );
    const side = 10 ** (6 / 20);
    expect(measure(sound.channels[0], 1000).db).toBeCloseTo(20 * Math.log10((1 + side) / 2), 1);
    expect(measure(sound.channels[1], 1000).db).toBeCloseTo(20 * Math.log10((side - 1) / 2), 1);
  });

  it("output: level, phase and pan", async () => {
    const sound = await play(
      song((pq) => ({ ...pq, output: -6, invert: true, pan: 0.5 })),
      1024,
    );
    expect(sound.channels[0][0]).toBeCloseTo(-0.5 * AMP * 10 ** (-6 / 20), 4);
    expect(sound.channels[1][0]).toBeCloseTo(-AMP * 10 ** (-6 / 20), 4);
  });

  it("dynamics: a band cuts a loud sound in its range by up to its range, and leaves a quiet one", async () => {
    const dynamic = [band(1, { frequency: 1000, gain: 0, q: 1, range: -9, threshold: -30 })];
    let sound = await play(
      song((pq) => ({ ...pq, bands: dynamic }), "loud"),
      RATE,
    );
    // After it's settled: the sine cut by most of the range.
    const tail = sound.channels[0].slice(RATE / 2);
    const level = 20 * Math.log10(Math.max(...tail.map(Math.abs)) / 0.9);
    expect(level).toBeLessThan(-6);
    expect(level).toBeGreaterThan(-9.5);
    await engine.command("stop", {});
    sound = await play(
      song((pq) => ({ ...pq, bands: dynamic }), "quiet"),
      RATE,
    );
    const quiet = 20 * Math.log10(Math.max(...sound.channels[0].slice(RATE / 2).map(Math.abs)) / 0.01);
    expect(Math.abs(quiet)).toBeLessThan(0.2);
  });

  it("the analyzer: a watched Pro-Q's spectra before and after it, a sine reading its level, a cut taking it down", async () => {
    await engine.command("eqWatch", { effects: [{ effect: EQ, size: 4096 }] });
    const bands = [band(1, { frequency: 1000, gain: -12, q: 1 })];
    await play(
      song((pq) => ({ ...pq, bands }), "loud"),
      RATE / 2,
    );
    // Offline, the render's answer carries what its transport events would.
    const state = (await engine.render(4096)).eq![EQ];
    const at = (levels: number[], hz: number) => levels[Math.round(Math.log2(hz / 10) * ((480 - 1) / Math.log2(3000)))];
    // 0.9 of full scale: -0.9 dB, read within a dB (the Hann window's peak falls a little between bins).
    expect(at(state.pre!, 1000)).toBeGreaterThan(-2.5);
    expect(at(state.pre!, 1000)).toBeLessThan(0);
    expect(at(state.post!, 1000)).toBeCloseTo(at(state.pre!, 1000) - 12, 0);
    expect(at(state.pre!, 100)).toBeLessThan(-60);
    expect(state.peak[0]).toBeGreaterThan(0.2);
    await engine.command("eqWatch", { effects: [] });
  });

  it("solo: only what the band works on is heard while it's held", async () => {
    const bands = [band(1, { frequency: 1000, gain: 6, q: 2 })];
    await engine.setSong({ projectId: PROJECT, song: song((pq) => ({ ...pq, bands })), patternId: P, mode: "pattern" });
    await engine.command("eqSolo", { effect: EQ, band: 1 });
    await hear(RATE / 10);
    await engine.command("play", {});
    const sound = await hear(RATE / 2);
    // A band pass round 1 kHz: far below it, nothing.
    expect(measure(sound.channels[0], 1000).db).toBeCloseTo(0, 0);
    expect(measure(sound.channels[0], 60).db).toBeLessThan(-20);
    await engine.command("eqSolo", { effect: EQ, band: null });
  });
});
