/**
 * Pro-C's sound (`docs/fabfilter/pro-c.md` 8.8): the real engine, offline, playing test signals through a
 * Pro-C on the master, measured against what the song's own TypeScript says it plays (`staticCurve`,
 * `engineProC`): the static curve, a feedback style's ratio, the attack and release times, lookahead and
 * latency, the mix and dry paths, the Vintage units' laws, the external key, Host Sync and the ceiling.
 *
 * The cleanest signal for a compressor is a square wave: |x| is the same every sample, so a peak
 * detector sees a pure step and the gain is out / in exactly, sample by sample.
 */
import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createAutomation, editPoints } from "../../shared/music/automation.ts";
import { addChannels, setSteps } from "../../shared/music/edits.ts";
import { addClips, editClips } from "../../shared/music/playlist.ts";
import { routeChannels, setEffect } from "../../shared/music/mixer.ts";
import { type ProCPatch, engineProC, findProC, setProCSidechain, staticCurve, updateProC } from "../../shared/music/pro-c.ts";
import { PRO_C_PLUGIN, slopeOf } from "../../shared/music/pro-c-presets.ts";
import { FIRST_PATTERN_ID, MASTER_TRACK_ID, createMusicProject } from "../../shared/music/project.ts";
import type { MusicProject } from "../../shared/music/types.ts";
import { ENGINE } from "../config.ts";
import { DataPaths } from "../storage.ts";
import { AudioEngine } from "./engine.ts";
import { type WavData, readWav, writeWavChannels } from "./wav.ts";

const RATE = 48_000;
const P = FIRST_PATTERN_ID;
const PROJECT = "proj_0123456789ab";
const C = "fx_proc";
const TICKS = 384;
/** Clean, 4:1 at -20 dB, a hard knee, nothing added: what most tests start from. */
const CLEAN: ProCPatch = { style: "clean", threshold: -20, slope: 0.75, knee: 0, range: 60, attack: 0.0001, release: 0.05, autoGain: false, autoRelease: false, sidechain: { bands: [] } };

const db = (gain: number) => 20 * Math.log10(Math.max(gain, 1e-9));
const amp = (level: number) => 10 ** (level / 20);
/** A square wave at 100 Hz whose level steps through `parts` (dB of full scale, seconds). */
function steps(parts: [number, number][]): Float32Array {
  const total = parts.reduce((n, [, s]) => n + Math.round(s * RATE), 0);
  const out = new Float32Array(total);
  let i = 0;
  for (const [level, seconds] of parts)
    for (let k = 0; k < Math.round(seconds * RATE); k++, i++) out[i] = (Math.floor(i / (RATE / 200)) % 2 ? -1 : 1) * amp(level);
  return out;
}
/** The gain (dB) at each sample of the output against the square that went in (its level known). */
const gainAt = (wav: WavData, i: number, level: number) => db(Math.abs(wav.channels[0][i]) / amp(level));
/** The average gain (dB) over `[from, to)` (seconds). */
function gainOver(wav: WavData, from: number, to: number, level: number) {
  let sum = 0;
  const a = Math.round(from * RATE), b = Math.round(to * RATE);
  for (let i = a; i < b; i++) sum += gainAt(wav, i, level);
  return sum / (b - a);
}
function peak(samples: Float32Array, from = 0, to = samples.length) {
  let p = 0;
  for (let i = from; i < to; i++) p = Math.max(p, Math.abs(samples[i]));
  return p;
}

describe.skipIf(!existsSync(ENGINE))("Pro-C, offline", () => {
  let dir: string;
  let engine: AudioEngine;
  let render = 0;

  async function hear(frames: number): Promise<WavData> {
    const file = path.join(dir, `render-${render++}.wav`);
    await engine.render(frames, file);
    return readWav(file);
  }
  /** A song at 120 BPM playing `sample` from its start, a Pro-C on the master. */
  function song(sample: string, patch: ProCPatch = {}): MusicProject {
    let s = addChannels(createMusicProject("Squash", 120), [{ id: "chan_sig", name: "Signal", sampleId: sample }]);
    s = setSteps(s, P, "chan_sig", [0], true);
    s = { ...s, patterns: s.patterns.map((p) => (p.id === P ? { ...p, length: 16 * TICKS } : p)) };
    s = setEffect(s, MASTER_TRACK_ID, 0, PRO_C_PLUGIN, C);
    return updateProC(s, C, { ...CLEAN, ...patch, sidechain: { ...CLEAN.sidechain, ...patch.sidechain } });
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

  beforeAll(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "pro-c-"));
    const both = (x: Float32Array) => [x, x];
    for (const level of [-40, -30, -26, -22, -20, -18, -14, -10, -6, 0]) await writeWavChannels(path.join(dir, `sq${-level}.wav`), both(steps([[level, 1.5]])), RATE);
    const sine = Float32Array.from({ length: 1.5 * RATE }, (_, i) => amp(-10) * Math.sin((2 * Math.PI * 100 * i) / RATE));
    await writeWavChannels(path.join(dir, "sine10.wav"), both(sine), RATE);
    // A 60 Hz sine at -10 dB with a 2 kHz one at -30 dB on top (the low end that mustn't trigger it).
    const boom = Float32Array.from({ length: 1.5 * RATE }, (_, i) => amp(-10) * Math.sin((2 * Math.PI * 60 * i) / RATE) + amp(-30) * Math.sin((2 * Math.PI * 2000 * i) / RATE));
    await writeWavChannels(path.join(dir, "boom.wav"), both(boom), RATE);
    await writeWavChannels(path.join(dir, "step.wav"), both(steps([[-40, 0.5], [-10, 1], [-40, 1]])), RATE);
    await writeWavChannels(path.join(dir, "short.wav"), both(steps([[-40, 0.5], [-10, 0.3], [-40, 2]])), RATE);
    await writeWavChannels(path.join(dir, "long.wav"), both(steps([[-40, 0.5], [-10, 5], [-40, 2]])), RATE);
    await writeWavChannels(path.join(dir, "burst.wav"), both(steps([[-60, 0.5], [0, 0.05], [-60, 0.5]])), RATE);
    // A click: one full-scale sample at 0.25 s.
    const click = new Float32Array(RATE);
    click[RATE / 4] = 1;
    await writeWavChannels(path.join(dir, "click.wav"), both(click), RATE);
    engine = new AudioEngine(new DataPaths(dir), { offline: true, onlyPluginPaths: true, pluginPaths: [], samplePath: (_project, id) => path.join(dir, `${id}.wav`) });
  });
  afterAll(async () => {
    engine.shutdown();
    await fs.rm(dir, { recursive: true, force: true });
  });
  beforeEach(fresh);

  it("follows its static curve to within 0.1 dB (Clean: hard and soft knees, Range)", async () => {
    for (const knee of [0, 12]) {
      for (const level of [-30, -22, -18, -10, 0]) {
        const patch = { ...CLEAN, knee };
        const sound = await played(song(`sq${-level}`, patch), 1.2);
        const expected = -staticCurve({ ...findProC(song("x", patch), C)!.proC }, level);
        expect(Math.abs(gainOver(sound, 0.8, 1.1, level) - expected), `knee ${knee} at ${level} dB`).toBeLessThan(0.1);
      }
    }
    const ranged = await played(song("sq0", { range: 6, knee: 0 }), 1.2);
    expect(gainOver(ranged, 0.8, 1.1, 0)).toBeCloseTo(-6, 1);
  });

  it("settles a feedback style (Classic) at its ratio: 4:1 is 15 dB off 20 dB over", async () => {
    // Classic's detector is 40% RMS, which reads a square 3 dB hot (it's calibrated to a sine's peak).
    const heard = 0.4 * 3.0103;
    const sound = await played(song("sq0", { style: "classic" }), 1.2);
    expect(gainOver(sound, 0.8, 1.1, 0)).toBeCloseTo(-(20 + heard) * 0.75, 1);
    // ∞:1 can't be reached in a loop: capped at 31:1.
    const hard = await played(song("sq0", { style: "classic", slope: 1 }), 1.2);
    expect(gainOver(hard, 0.8, 1.1, 0)).toBeCloseTo(-(20 + heard) * (1 - 1 / 31), 1);
  });

  it("attacks in its attack time (63% of the way) and releases in its release time", async () => {
    const patch = { ...CLEAN, attack: 0.01, release: 0.1 };
    const sound = await played(song("step", patch), 2.4);
    // 10 dB over at 4:1: 7.5 dB down, settled.
    const settled = gainOver(sound, 1.3, 1.45, -10);
    expect(settled).toBeCloseTo(-7.5, 1);
    // The 63% point after the step at 0.5 s: within a couple of samples of 10 ms.
    const start = RATE / 2;
    let at = start;
    while (gainAt(sound, at, -10) > 0.632 * settled && at < start + RATE) at++;
    expect(Math.abs((at - start) / RATE - 0.01)).toBeLessThan(0.0006);
    // And back: at 1.5 s it falls to -40 dB again; 63% of the way back to 0 dB in the release time, which a
    // second of compression has made longer (Clean's program dependency: K 2, over half a second).
    const back = Math.round(1.5 * RATE);
    let rel = back;
    while (gainAt(sound, rel, -40) < 0.368 * settled && rel < back + RATE) rel++;
    expect(Math.abs((rel - back) / RATE - 0.1 * (2 - Math.exp(-1 / 0.5)))).toBeLessThan(0.01);
  });

  it("releases more slowly after a long phrase than after a short one (program dependency)", async () => {
    const time = async (file: string, end: number) => {
      const sound = await played(song(file, { ...CLEAN, attack: 0.001, release: 0.1 }), end + 1);
      const settled = gainAt(sound, Math.round((end - 0.01) * RATE), -10);
      let i = Math.round(end * RATE);
      while (gainAt(sound, i, -40) < 0.368 * settled && i < (end + 1) * RATE) i++;
      return i / RATE - end;
    };
    const short = await time("short", 0.8);
    const long = await time("long", 5.5);
    // Clean's K is 2: after 5 s of compression the release is twice the knob's; after 0.3 s, under half that more.
    expect(short).toBeCloseTo(0.1 * (2 - Math.exp(-0.3 / 0.5)), 1);
    expect(long).toBeCloseTo(0.2, 1);
    expect(long).toBeGreaterThan(short * 1.25);
  });

  it("is late by exactly its Maximum Lookahead, and its lookahead catches a peak", async () => {
    const at = async (patch: ProCPatch) => {
      const sound = await played(song("click", { ...CLEAN, threshold: 0, ...patch }), 0.5);
      return sound.channels[0].findIndex((v) => Math.abs(v) > 0.5) - RATE / 4;
    };
    expect(await at({})).toBe(0);
    expect(await at({ maxLookahead: 0.01 })).toBe(480);
    const status = await engine.command("status", {});
    expect(status.transport?.proCs?.[C]?.latency).toBe(480);
    // A 0 dBFS burst into ∞:1 at -20 dB: without lookahead its first moments get through; with 5 ms they don't.
    const loose = await played(song("burst", { ...CLEAN, slope: 1, attack: 0.0001 }), 1);
    const caught = await played(song("burst", { ...CLEAN, slope: 1, attack: 0.0001, maxLookahead: 0.005, lookahead: 0.005 }), 1);
    expect(db(peak(loose.channels[0]))).toBeGreaterThan(-15);
    expect(db(peak(caught.channels[0]))).toBeLessThan(-19.3);
  });

  it("scales its gain change by Mix and adds the dry sound back", async () => {
    const none = await played(song("sq0", { mix: 0 }), 1.2);
    expect(gainOver(none, 0.8, 1.1, 0)).toBeCloseTo(0, 2);
    const half = await played(song("sq0", { mix: 0.5 }), 1.2);
    expect(gainOver(half, 0.8, 1.1, 0)).toBeCloseTo(-7.5, 1);
    // Dry at 0 dB: the input added to the compressed sound (-10 dB in, 10 over: 7.5 dB down).
    const dry = await played(song("sq10", { dry: 0 }), 1.2);
    expect(gainOver(dry, 0.8, 1.1, -10)).toBeCloseTo(db(1 + amp(-7.5)), 1);
  });

  it("raises FET 76's threshold with its ratio, as the measured 1176 does", async () => {
    const at = async (ratio: number) => {
      const sound = await played(song("sq0", { style: "fet", threshold: -20, slope: slopeOf(ratio), attack: 0.0001, release: 0.05 }), 1.2);
      return gainOver(sound, 0.8, 1.1, 0);
    };
    const four = await at(4);
    const twenty = await at(20);
    // At 20:1 its threshold is 9.1 dB higher: 20 dB over at 4:1 is only 10.9 dB over.
    expect(four).toBeCloseTo(-staticCurve({ ...findProC(song("x", { style: "fet", threshold: -20, slope: 0.75 }), C)!.proC }, 0), 0);
    expect(twenty).toBeGreaterThan(four);
  });

  it("gives Opto 2A a memory: it lets go more slowly after a long phrase", async () => {
    const time = async (file: string, end: number) => {
      const sound = await played(song(file, { style: "opto2a", threshold: -24 }), end + 2);
      const settled = gainAt(sound, Math.round((end - 0.01) * RATE), -10);
      let i = Math.round(end * RATE);
      while (gainAt(sound, i, -40) < 0.368 * settled && i < (end + 2) * RATE) i++;
      return i / RATE - end;
    };
    const short = await time("short", 0.8);
    const long = await time("long", 5.5);
    expect(short).toBeLessThan(0.4);
    expect(long).toBeGreaterThan(short);
  });

  it("releases VCA 160 at a constant 120 dB/s (dbx's Auto)", async () => {
    const sound = await played(song("step", { style: "vca160", threshold: -30, slope: 1, options: { auto: true, overEasy: false } }), 2.4);
    // Its RMS reads a square 3 dB hot: 23 dB over ∞:1, held down all of it (the attack's time set by the step, so it gets there).
    expect(gainOver(sound, 1.3, 1.45, -10)).toBeCloseTo(-23, 0);
    // Then it recovers in a straight line in dB (averaged over 10 ms windows: the square's tops sag a little
    // through the colour's DC blocker): about 120 dB/s.
    const g0 = gainOver(sound, 1.56, 1.57, -40);
    const g1 = gainOver(sound, 1.64, 1.65, -40);
    expect((g1 - g0) / 0.08).toBeGreaterThan(100);
    expect((g1 - g0) / 0.08).toBeLessThan(140);
  });

  it("ducks one track by another's sound (an external key: no send needed)", async () => {
    // The signal on Insert 1 with the Pro-C; a click on Insert 2 is the key.
    let s = addChannels(createMusicProject("Duck", 120), [
      { id: "chan_sig", name: "Signal", sampleId: "sq20" },
      { id: "chan_key", name: "Key", sampleId: "burst" },
    ]);
    s = setSteps(s, P, "chan_sig", [0], true);
    s = setSteps(s, P, "chan_key", [0], true);
    s = { ...s, patterns: s.patterns.map((p) => (p.id === P ? { ...p, length: 16 * TICKS } : p)) };
    s = routeChannels(s, ["chan_sig"], "insert_1");
    s = routeChannels(s, ["chan_key"], "insert_2");
    s = { ...s, mixer: { ...s.mixer, tracks: s.mixer.tracks.map((t) => (t.id === "insert_2" ? { ...t, sends: [] } : t)) } };
    s = setEffect(s, "insert_1", 0, PRO_C_PLUGIN, C);
    s = updateProC(s, C, { ...CLEAN, threshold: -30, slope: 1, attack: 0.0005, release: 0.05 });
    s = setProCSidechain(s, C, "insert_2");
    const sound = await played(s, 1.2);
    // The key (a 0 dBFS burst at 0.5 s) ducks the -20 dB signal; before it, nothing.
    const before = gainOver(sound, 0.2, 0.45, -20);
    expect(gainOver(sound, 0.51, 0.54, -20) - before).toBeLessThan(-20);
    // And it lets go once the key's gone.
    expect(gainOver(sound, 0.9, 1.1, -20) - before).toBeGreaterThan(-1);
  });

  it("pumps on the beat with Host Sync, no key needed", async () => {
    const sound = await played(song("sq20", { style: "pumping", threshold: -30, slope: 1, attack: 0.001, release: 0.05, sidechain: { trigger: "sync", sync: { note: 4, offset: 1, length: 0.25 } } }), 1.2);
    // 120 BPM: a beat every 0.5 s, the pulse its first quarter (125 ms): ducked in it, back before the next.
    expect(gainOver(sound, 0.52, 0.6, -20)).toBeLessThan(-6);
    expect(gainOver(sound, 0.4, 0.48, -20)).toBeGreaterThan(-3);
  });

  it("never lets Vox past its ceiling", async () => {
    const sound = await played(song("sq0", { style: "vox", threshold: -6, options: { ceiling: -3 } }), 1.2);
    expect(db(peak(sound.channels[0], RATE / 10))).toBeLessThan(-2.95);
  });

  it("runs every style without a NaN, and comes back to 0 dB in silence", async () => {
    for (const style of ["clean", "versatile", "smooth", "punch", "upward", "ttm", "opEl", "variMu", "classic", "opto", "vocal", "vox", "mastering", "bus", "pumping", "fet", "opto2a", "optoTube", "distress", "vca160", "diode609"] as const) {
      const sound = await played(song("burst", { style, threshold: -30 }), 1.2);
      expect(sound.channels[0].every(Number.isFinite), style).toBe(true);
      const status = await engine.command("status", {});
      expect(Number.isFinite(status.transport?.proCs?.[C]?.reduction ?? NaN), style).toBe(true);
    }
  });

  it("oversampled, sounds the same (within 0.2 dB) and is late by its filters", async () => {
    // A sine (a square's tops ring when it's oversampled: its true peaks are higher), measured by its RMS.
    const level = (wav: WavData) => {
      let sum = 0;
      for (let i = RATE * 0.8; i < RATE * 1.1; i++) sum += wav.channels[0][i] ** 2;
      return 10 * Math.log10(sum / (RATE * 0.3));
    };
    const plain = await played(song("sine10", { attack: 0.005, release: 0.5 }), 1.2);
    const over = await played(song("sine10", { attack: 0.005, release: 0.5, oversampling: 4 }), 1.2);
    expect(Math.abs(level(over) - level(plain))).toBeLessThan(0.2);
    const status = await engine.command("status", {});
    expect(status.transport?.proCs?.[C]?.latency ?? 0).toBeGreaterThan(0);
    expect(engineProC(findProC(song("x", { oversampling: 4 }), C)!.proC).oversampling).toBe(4);
  });

  it("measures its loudness in and out (Match)", async () => {
    await fresh();
    await engine.setSong({ projectId: PROJECT, song: song("sq0", {}), patternId: P, mode: "pattern" });
    await engine.command("play", {});
    await engine.command("compMatch", { effect: C, seconds: 1 });
    await hear(Math.round(1.3 * RATE));
    const status = await engine.command("status", {});
    const match = status.transport?.proCs?.[C]?.match;
    expect(match?.done).toBe(true);
    // 15 dB taken off a 0 dBFS square.
    expect(match!.input - match!.output).toBeGreaterThan(12);
  });

  it("turns quiet sound up in Upward, and leaves loud sound alone", async () => {
    const quiet = await played(song("sq40", { style: "upward", threshold: -30, slope: 0.5, knee: 0, range: 12, autoGain: false }), 1.2);
    // It hears RMS, which reads the square 3 dB hot: 7 dB under at a slope of a half, 3.5 dB up.
    expect(gainOver(quiet, 0.8, 1.1, -40)).toBeCloseTo(3.5, 1);
    const loud = await played(song("sq10", { style: "upward", threshold: -30, slope: 0.5, knee: 0, range: 12, autoGain: false }), 1.2);
    expect(gainOver(loud, 0.8, 1.1, -10)).toBeCloseTo(0, 1);
  });

  it("splits TTM into bands that add back up to the sound", async () => {
    // Range 0: no band moves, so what's left is the crossovers, which sum flat (an all-pass).
    const level = (wav: WavData) => {
      let sum = 0;
      for (let i = RATE * 0.8; i < RATE * 1.1; i++) sum += wav.channels[0][i] ** 2;
      return 10 * Math.log10(sum / (RATE * 0.3));
    };
    const plain = await played(song("sine10", { mix: 0 }), 1.2);
    const ttm = await played(song("sine10", { style: "ttm", range: 0 }), 1.2);
    expect(Math.abs(level(ttm) - level(plain))).toBeLessThan(0.1);
  });

  it("doesn't let the low end trigger it with a side chain high-pass", async () => {
    const level = (wav: WavData) => {
      let sum = 0;
      for (let i = RATE * 0.8; i < RATE * 1.1; i++) sum += wav.channels[0][i] ** 2;
      return 10 * Math.log10(sum / (RATE * 0.3));
    };
    const plain = await played(song("boom", { mix: 0 }), 1.2);
    const full = await played(song("boom", { threshold: -25, slope: 1, attack: 0.002, release: 0.2 }), 1.2);
    const filtered = await played(song("boom", { threshold: -25, slope: 1, attack: 0.002, release: 0.2, sidechain: { bands: [{ id: 1, enabled: true, shape: "lowCut", frequency: 300, gain: 0, q: 1, slope: 48, placement: "stereo", range: 0, dynamics: false, threshold: null }] } }), 1.2);
    // The 60 Hz pumps it 15 dB down; with the key's lows cut, the 2 kHz at -30 dB is under the threshold: untouched.
    expect(level(full) - level(plain)).toBeLessThan(-10);
    expect(Math.abs(level(filtered) - level(plain))).toBeLessThan(0.5);
  });

  it("attacks Opto 2A in two stages: half at once, the rest over most of a second", async () => {
    const sound = await played(song("step", { style: "opto2a", threshold: -30 }), 2.4);
    const settled = gainOver(sound, 1.4, 1.48, -10);
    const at = (t: number) => gainOver(sound, 0.5 + t, 0.5 + t + 0.005, -10);
    expect(settled).toBeLessThan(-6);
    // Moore's six LA-2As: 63% of the reduction within ~125 ms; all of it by ~1.1 s.
    expect(at(0.03) / settled).toBeGreaterThan(0.35);
    expect(at(0.15) / settled).toBeGreaterThan(0.55);
    expect(at(0.15) / settled).toBeLessThan(0.85);
    expect(at(0.9) / settled).toBeGreaterThan(0.9);
  });

  it("lets go of Nuke in two slopes: quickly at first, then slowly", async () => {
    const sound = await played(song("step", { style: "distress", threshold: -30, slope: 1, attack: 0.0001, release: 0.1 }), 2.6);
    const settled = gainOver(sound, 1.4, 1.48, -10);
    const back = (t: number) => gainOver(sound, 1.5 + t, 1.5 + t + 0.005, -40) / settled;
    // 60% of it at the release's pace (gone in a few hundred ms), the rest eight times slower.
    expect(back(0.3)).toBeLessThan(0.55);
    expect(back(0.3)).toBeGreaterThan(0.2);
    expect(back(0.8)).toBeGreaterThan(0.08);
  });

  it("releases Opto Tube's Fix / Man fast after a short peak and at its Release after a phrase", async () => {
    const time = async (file: string, end: number) => {
      const sound = await played(song(file, { style: "optoTube", threshold: -30, slope: slopeOf(4), attack: 0.1, release: 1, options: { timeMode: "fixMan" } }), end + 2);
      const settled = gainOver(sound, end - 0.03, end - 0.005, -10);
      let i = Math.round(end * RATE);
      while (gainAt(sound, i, -40) < 0.368 * settled && i < (end + 2) * RATE) i++;
      return i / RATE - end;
    };
    // The short phrase (0.3 s) is longer than Attack (0.1 s) too, so both hold: a long phrase holds as long.
    const long = await time("long", 5.5);
    expect(long).toBeGreaterThan(0.6);
    const burst = await played(song("burst", { style: "optoTube", threshold: -30, slope: slopeOf(4), attack: 0.1, release: 1, options: { timeMode: "fixMan" } }), 1.1);
    // A 50 ms burst: shorter than Attack, so only the fast detector (50 ms) moved: it's gone in a few tenths.
    expect(gainOver(burst, 0.8, 0.85, -60)).toBeGreaterThan(-1);
  });

  it("gates what's under Vox's gate", async () => {
    const open = await played(song("sq20", { style: "vox", threshold: 0, options: { gate: -30, ceiling: 0 } }), 1.2);
    const shut = await played(song("sq40", { style: "vox", threshold: 0, options: { gate: -30, ceiling: 0 } }), 1.2);
    expect(gainOver(open, 0.8, 1.1, -20)).toBeCloseTo(0, 0);
    expect(gainOver(shut, 0.8, 1.1, -40)).toBeLessThan(-20);
  });

  it("plays its automated threshold, as the knee display would", async () => {
    let s = song("sq10", { threshold: 0, attack: 0.0001, release: 0.02 });
    s = editClips(s, (clips) => addClips(clips, [{ kind: "pattern", ref: P, track: 0, start: 0, length: TICKS * 4 }]).clips);
    const made = createAutomation(s, { kind: "proC", effect: C, control: "threshold" }, { start: 0, length: TICKS * 2 });
    // 0 dB for the first half bar (a second), -30 dB after.
    s = editPoints(made.song, made.automationId, () => [
      { tick: 0, value: 1, tension: 0, curve: "single" },
      { tick: TICKS / 2, value: 1, tension: 0, curve: "single" },
      { tick: TICKS / 2, value: 0.5, tension: 0, curve: "single" },
      { tick: TICKS * 2, value: 0.5, tension: 0, curve: "single" },
    ]);
    const sound = await played(s, 1.6, "song");
    expect(gainOver(sound, 0.6, 0.9, -10)).toBeCloseTo(0, 1);
    // -30 dB: 20 over at 4:1, 15 down.
    expect(gainOver(sound, 1.3, 1.5, -10)).toBeCloseTo(-15, 0);
  });
});
