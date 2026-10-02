/**
 * Pitch Wheel's sound (`docs/quikquak/pitchwheel.md`): the real engine, offline, playing sines, a sung
 * vowel and clicks through a Pitch Wheel on the master, set with the app's own edits; the pitch, level,
 * formants, stereo, timing and delay of what comes out measured.
 */
import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { addChannels, setChannelNotes, setSteps } from "../../shared/music/edits.ts";
import { setEffect, updateEffect } from "../../shared/music/mixer.ts";
import { type PitchWheelPatch, restingAt, stepWheel, updatePitchWheel, wheelPhysics } from "../../shared/music/pitch-wheel.ts";
import { PITCH_WHEEL_PLUGIN } from "../../shared/music/pitch-wheel-presets.ts";
import { FIRST_PATTERN_ID, MASTER_TRACK_ID, createMusicProject } from "../../shared/music/project.ts";
import { type MusicProject, type Note, PPQ } from "../../shared/music/types.ts";
import { ENGINE } from "../config.ts";
import { DataPaths } from "../storage.ts";
import { AudioEngine } from "./engine.ts";
import { type WavData, readWav, writeWav, writeWavChannels } from "./wav.ts";

const RATE = 48_000;
const P = FIRST_PATTERN_ID;
const PROJECT = "proj_0123456789ab";
const WHEEL = "fx_wheel";
/** At 60 BPM a beat is a second and the pattern's bar four: the sample (3.5 s) plays once. */
const TEMPO = 60;
const LENGTH = Math.round(3.5 * RATE);
const TIGHT = 2048;

/** A 10 ms fade at each end: no click. */
function faded(out: Float32Array): Float32Array {
  const fade = RATE / 100;
  for (let i = 0; i < out.length; i++) out[i] *= Math.min(1, i / fade, (out.length - 1 - i) / fade);
  return out;
}
const sine = (hz: number, level = 0.5, length = LENGTH) => faded(Float32Array.from({ length }, (_, i) => level * Math.sin((2 * Math.PI * hz * i) / RATE)));

/** An "ah" at `hz` (its formants fixed whatever the pitch), at about half scale. */
function vowel(hz: number): Float32Array {
  const formants = [
    [700, 110, 1],
    [1220, 120, 0.5],
    [2600, 160, 0.25],
  ] as const;
  const level = (f: number) => formants.reduce((sum, [centre, width, l]) => sum + l / (1 + ((f - centre) / width) ** 2), 0.02);
  const out = new Float32Array(LENGTH);
  for (let i = 0; i < LENGTH; i++) for (let k = 1; k * hz < 5000; k++) out[i] += level(k * hz) * Math.sin((2 * Math.PI * k * hz * i) / RATE);
  let peak = 0;
  for (const v of out) peak = Math.max(peak, Math.abs(v));
  for (let i = 0; i < LENGTH; i++) out[i] *= 0.5 / peak;
  return faded(out);
}

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

/** How much of `hz` there is in `[from, from + size)`: its amplitude (Goertzel, Hann-windowed). */
function amount(samples: Float32Array, hz: number, from: number, size = 8192): number {
  let re = 0;
  let im = 0;
  let windowSum = 0;
  for (let n = 0; n < size; n++) {
    const w = 0.5 - 0.5 * Math.cos((2 * Math.PI * n) / size);
    const a = (2 * Math.PI * hz * n) / RATE;
    re += samples[from + n] * w * Math.cos(a);
    im -= samples[from + n] * w * Math.sin(a);
    windowSum += w;
  }
  return (2 * Math.hypot(re, im)) / windowSum;
}

const cents = (a: number, b: number) => 1200 * Math.log2(a / b);
const semitones = (ratio: number) => 12 * Math.log2(ratio);
function rms(samples: Float32Array, from: number, to: number): number {
  let sum = 0;
  for (let i = from; i < to; i++) sum += samples[i] * samples[i];
  return Math.sqrt(sum / (to - from));
}
const db = (x: number) => 20 * Math.log10(x);

describe.skipIf(!existsSync(ENGINE))("Pitch Wheel, offline", () => {
  let dir: string;
  let engine: AudioEngine;
  let render = 0;
  const samples = new Map<string, Float32Array | [Float32Array, Float32Array]>();

  async function hear(frames: number): Promise<WavData> {
    const file = path.join(dir, `render-${render++}.wav`);
    await engine.render(frames, file);
    return readWav(file);
  }
  /** A song at 60 BPM playing the sample `name` once, through a Pitch Wheel on the master set as `patch` says. */
  function song(name: string, patch: PitchWheelPatch = {}, edit: (s: MusicProject) => MusicProject = (s) => s): MusicProject {
    let s = addChannels(createMusicProject("Wheel", TEMPO), [{ id: "chan_src", name: "Source", sampleId: name }]);
    s = setSteps(s, P, "chan_src", [0], true);
    s = setEffect(s, MASTER_TRACK_ID, 0, PITCH_WHEEL_PLUGIN, WHEEL);
    return edit(updatePitchWheel(s, WHEEL, patch));
  }
  /** Notes (MIDI, seconds) for a channel of their own, which plays nothing (its sample isn't there), that the Pitch Wheel follows. */
  function withNotes(notes: { pitch: number; at: number; length: number }[]) {
    return (s: MusicProject) => {
      let next = addChannels(s, [{ id: "chan_notes", name: "Notes", sampleId: "nothing" }]);
      next = setChannelNotes(next, P, "chan_notes", () =>
        notes.map((n, i): Note => ({ id: i + 1, start: Math.round(n.at * PPQ), length: Math.round(n.length * PPQ), pitch: n.pitch, velocity: 0.78, pan: 0, muted: false })),
      );
      return updatePitchWheel(next, WHEEL, { notesFrom: "chan_notes" });
    };
  }
  /** Play `s` from its start and hear `seconds` of it, both sides. */
  async function play(s: MusicProject, seconds = 3.6): Promise<[Float32Array, Float32Array]> {
    await engine.setSong({ projectId: PROJECT, song: s, patternId: P, mode: "pattern" });
    await settle(s);
    await engine.command("play", {});
    const heard = await hear(Math.round(seconds * RATE));
    return [heard.channels[0], heard.channels[1]];
  }
  /** The wheels at rest on their pointers (a wheel left swinging by the last test swings on through a new song, as a real one would). */
  const settle = async (s: MusicProject) => {
    if (s.mixer.tracks.some((t) => t.effects.some((e) => e?.id === WHEEL && e.enabled))) await engine.command("pitchWheel", { effect: WHEEL, jump: true });
  };
  const latency = async () => (await engine.command("status", {})).songLatency;

  beforeAll(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "pitch-wheel-"));
    const clicks = new Float32Array(LENGTH);
    // A click every half second: a decaying burst of a few cycles, as a rim shot.
    for (let start = RATE / 4; start + 2000 < LENGTH; start += RATE / 2) for (let i = 0; i < 1500; i++) clicks[start + i] = 0.6 * Math.exp(-i / 120) * Math.sin((2 * Math.PI * 1800 * i) / RATE);
    const made: Record<string, Float32Array | [Float32Array, Float32Array]> = {
      a440: sine(440),
      ah: vowel(220),
      clicks,
      // Stereo: the right side upside down and quieter.
      wide: [sine(440), sine(440).map((v) => -0.5 * v)],
    };
    for (const [name, data] of Object.entries(made)) {
      samples.set(name, data);
      if (Array.isArray(data)) await writeWavChannels(path.join(dir, `${name}.wav`), data, RATE);
      else await writeWav(path.join(dir, `${name}.wav`), data, RATE);
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

  it("is transparent at 0: the sound exactly as it came, a window late (compensated)", async () => {
    const [left] = await play(song("a440"));
    const delay = await latency();
    expect(delay).toBe(TIGHT);
    expect((await engine.command("status", {})).transport.pitchWheels?.[WHEEL]?.latency).toBe(TIGHT);
    const source = samples.get("a440") as Float32Array;
    let error = 0;
    for (let i = 0; i < RATE * 3; i++) error = Math.max(error, Math.abs(left[i + delay] - source[i]));
    // To the 24-bit render's grain: -80 dB.
    expect(error).toBeLessThan(1e-4);
  });

  it("shifts a sine by the wheel, to the cent, keeping its level", async () => {
    for (const shift of [7, -5, 12, -12, 0.5]) {
      const [left] = await play(song("a440", { pitch: { value: shift, snap: "off" } }));
      const delay = await latency();
      const heard = frequency(left, delay + RATE / 2, delay + 3 * RATE);
      expect(Math.abs(cents(heard, 440 * 2 ** (shift / 12)))).toBeLessThan(1);
      // Within half a decibel of the sine's level (0.5: 0.354 rms).
      expect(Math.abs(db(rms(left, delay + RATE / 2, delay + 3 * RATE) / (0.5 / Math.SQRT2)))).toBeLessThan(0.5);
      // Nothing else: the sine alone (its old pitch gone).
      if (Math.abs(shift) >= 1) expect(amount(left, 440, delay + RATE)).toBeLessThan(0.005);
    }
  });

  it("snaps the wheel to semitones, or octaves", async () => {
    const [semitone] = await play(song("a440", { pitch: { value: 2.4, snap: "semitone" } }));
    const delay = await latency();
    expect(Math.abs(cents(frequency(semitone, delay + RATE / 2, delay + 3 * RATE), 440 * 2 ** (2 / 12)))).toBeLessThan(1);
    const [octave] = await play(song("a440", { pitch: { value: 8, snap: "octave" } }));
    expect(Math.abs(cents(frequency(octave, delay + RATE / 2, delay + 3 * RATE), 880))).toBeLessThan(1);
  });

  it("keeps the formants with the Timbre tab open, moves them with it closed, and moves them alone with the Timbre wheel", async () => {
    const at = TIGHT + RATE;
    /** The loudest harmonic of `f0` under 2 kHz: where the first formant (700 Hz in the vowel) puts it. */
    const loudest = (sound: Float32Array, f0: number) => {
      let best = 0;
      let most = 0;
      for (let k = 1; k * f0 < 2000; k++) {
        const a = amount(sound, k * f0, at);
        if (a > most) [best, most] = [k * f0, a];
      }
      return best;
    };
    const [plain] = await play(song("ah"));
    expect(loudest(plain, 220)).toBe(660);
    // An octave down, Timbre open: the pitch halves, the formant stays: the harmonics by 700 Hz loudest, not those by 350.
    const [kept] = await play(song("ah", { pitch: { value: -12 } }));
    // (Its odd harmonics are new: 550 and 770 are no harmonics of 220.)
    expect(amount(kept, 550, at)).toBeGreaterThan(0.03);
    expect(Math.abs(loudest(kept, 110) - 700)).toBeLessThanOrEqual(80);
    expect(amount(kept, 770, at) / amount(kept, 330, at)).toBeGreaterThan(2);
    // As loud as it was.
    expect(Math.abs(db(rms(kept, at, at + RATE) / rms(plain, at, at + RATE)))).toBeLessThan(1);
    // Closed: the formant comes down with it (a tape slowed down): by 350 Hz.
    const [moved] = await play(song("ah", { pitch: { value: -12 }, timbreOn: false }));
    expect(loudest(moved, 110)).toBe(330);
    expect(amount(moved, 330, at) / amount(moved, 770, at)).toBeGreaterThan(4);
    // The Timbre wheel alone up 5: the same pitch, the first formant up a fourth (by 935 Hz).
    const [helium] = await play(song("ah", { timbre: { value: 5 } }));
    // (Still harmonics of 220: nothing between them.)
    expect(amount(helium, 330, at)).toBeLessThan(0.01);
    expect([880, 1100]).toContain(loudest(helium, 220));
    expect((amount(helium, 880, at) + amount(helium, 1100, at)) / amount(helium, 660, at)).toBeGreaterThan(2.5);
  });

  it("keeps the stereo image: the same turn on both sides", async () => {
    const [left, right] = await play(song("wide", { pitch: { value: 5 } }));
    const delay = await latency();
    let dot = 0;
    let ll = 0;
    let rr = 0;
    for (let i = delay + RATE / 2; i < delay + 3 * RATE; i++) {
      dot += left[i] * right[i];
      ll += left[i] ** 2;
      rr += right[i] ** 2;
    }
    // The right side still the left upside down (correlation -1), half as loud.
    expect(dot / Math.sqrt(ll * rr)).toBeLessThan(-0.999);
    expect(Math.sqrt(rr / ll)).toBeCloseTo(0.5, 2);
  });

  it("keeps a drum hit sharp: little of it before it lands", async () => {
    const [left] = await play(song("clicks", { pitch: { value: 5 } }));
    const delay = await latency();
    const hits = [0.75, 1.25, 1.75, 2.25].map((t) => Math.round(t * RATE) + delay);
    for (const hit of hits) {
      const before = rms(left, hit - Math.round(0.02 * RATE), hit - Math.round(0.004 * RATE));
      const after = rms(left, hit, hit + Math.round(0.01 * RATE));
      // The smear ahead of it at least 20 dB under it.
      expect(db(before / after)).toBeLessThan(-20);
    }
  });

  it("follows the wheel as its physics say: firm by default, swinging past at low gravity", async () => {
    // The wheel moved to +12 a second in (a new song: what the hand does), heard through a sine.
    async function moved(patch: PitchWheelPatch) {
      const before = song("a440", patch);
      await engine.setSong({ projectId: PROJECT, song: before, patternId: P, mode: "pattern" });
      await settle(before);
      await engine.command("play", {});
      const first = await hear(RATE);
      await engine.setSong({ projectId: PROJECT, song: updatePitchWheel(before, WHEEL, { pitch: { value: 12 } }), patternId: P, mode: "pattern" });
      const second = await hear(2 * RATE);
      const all = new Float32Array(3 * RATE);
      all.set(first.channels[0]);
      all.set(second.channels[0], RATE);
      return all;
    }
    const delay = TIGHT;
    /** Semitones heard every 20 ms from the move on. */
    const track = (sound: Float32Array) => Array.from({ length: 80 }, (_, i) => semitones(frequency(sound, delay + RATE + i * 960, delay + RATE + (i + 1) * 960) / 440));

    const firm = track(await moved({}));
    // There within 120 ms, never past it by more than a quarter-tone.
    expect(Math.abs(firm[6] - 12)).toBeLessThan(0.3);
    expect(Math.max(...firm)).toBeLessThan(12.5);

    const swinging = { pitch: { snap: "off" as const, gravity: 0, inertia: 0.45, smooth: 0 } };
    const swing = track(await moved(swinging));
    // It flies past the pointer, towards twice as far, as the model says.
    const model: number[] = [];
    let m = restingAt(0);
    const physics = wheelPhysics(swinging.pitch);
    for (let i = 0; i < 80; i++) {
      for (let s = 0; s < 960; s++) m = stepWheel(m, 12, physics, 1 / RATE);
      model.push(m.actual);
    }
    const highest = Math.max(...swing);
    expect(highest).toBeGreaterThan(20);
    expect(Math.abs(highest - Math.max(...model))).toBeLessThan(1);
    // And when: within 40 ms of the model's peak.
    expect(Math.abs(swing.indexOf(highest) - model.indexOf(Math.max(...model)))).toBeLessThanOrEqual(2);
  });

  it("plays the notes of a channel in Multi: a voice each, gated on their sample, silent without", async () => {
    const notes = withNotes([
      { pitch: 64, at: 1, length: 1 },
      { pitch: 67, at: 1, length: 1 },
    ]);
    const [left] = await play(song("a440", { midiMode: "multi" }, notes));
    const delay = await latency();
    // Silent before the notes and after them.
    expect(rms(left, delay + RATE / 4, delay + RATE - 300)).toBeLessThan(1e-4);
    expect(rms(left, delay + 2 * RATE + 300, delay + 3 * RATE)).toBeLessThan(1e-4);
    // A major third and a fifth over A (the origin, C5, plays it as it is), not A itself.
    const at = delay + Math.round(1.3 * RATE);
    expect(amount(left, 440 * 2 ** (4 / 12), at)).toBeGreaterThan(0.4);
    expect(amount(left, 440 * 2 ** (7 / 12), at)).toBeGreaterThan(0.4);
    expect(amount(left, 440, at)).toBeLessThan(0.01);
    // In on its sample (with a 3 ms fade): nothing a millisecond before, all of it 4 ms after.
    const on = delay + RATE;
    expect(rms(left, on - 96, on - 48)).toBeLessThan(0.002);
    expect(rms(left, on + 192, on + 1200)).toBeGreaterThan(0.4);
  });

  it("follows the latest note in Single, holding its offset after it, and the wheel adds to it", async () => {
    const notes = withNotes([
      { pitch: 72, at: 1, length: 0.5 },
      { pitch: 55, at: 2, length: 0.5 },
    ]);
    const [left] = await play(song("a440", { pitch: { value: 2 } }, notes));
    const delay = await latency();
    const heard = (from: number, to: number) => semitones(frequency(left, delay + Math.round(from * RATE), delay + Math.round(to * RATE)) / 440);
    // Before any note: the wheel's +2.
    expect(heard(0.4, 0.95)).toBeCloseTo(2, 1);
    // C6 is an octave over the origin: +14, held after it ends.
    expect(heard(1.2, 1.95)).toBeCloseTo(14, 1);
    // G4 is 5 under: -3.
    expect(heard(2.2, 3)).toBeCloseTo(-3, 1);
  });

  it("is late by its window: Wide is 4096", async () => {
    await play(song("a440", { resolution: "wide", pitch: { value: 3 } }), 0.2);
    expect(await latency()).toBe(4096);
  });

  it("passes the sound untouched when bypassed, and mixes the dry sound in time", async () => {
    const source = samples.get("a440") as Float32Array;
    const [bypassed] = await play(song("a440", { pitch: { value: 7 } }, (s) => updateEffect(s, MASTER_TRACK_ID, 0, { enabled: false })));
    expect(await latency()).toBe(0);
    expect(Math.abs(bypassed[RATE] - source[RATE])).toBeLessThan(1e-4);
    // Half mixed at 0: dry and wet are the same sound, as late: it's the sound, exactly.
    const [mixed] = await play(song("a440", {}, (s) => updateEffect(s, MASTER_TRACK_ID, 0, { mix: 0.5 })));
    let error = 0;
    for (let i = 0; i < 2 * RATE; i++) error = Math.max(error, Math.abs(mixed[i + TIGHT] - source[i]));
    expect(error).toBeLessThan(1e-4);
  });

  it("holds the wheel where the hand is, and jumps there", async () => {
    await engine.setSong({ projectId: PROJECT, song: song("a440", { pitch: { gravity: 0, smooth: 0, snap: "off" } }), patternId: P, mode: "pattern" });
    await engine.command("play", {});
    await hear(RATE / 2);
    // Held at +7 and jumped there: no swing, at once.
    await engine.command("pitchWheel", { effect: WHEEL, pitch: 7, jump: true });
    const held = (await hear(RATE / 5)).channels[0];
    expect(Math.abs(cents(frequency(held, TIGHT + 2000, held.length), 440 * 2 ** (7 / 12)))).toBeLessThan(2);
    expect((await engine.command("status", {})).transport.pitchWheels?.[WHEEL]?.pitch).toBeCloseTo(7, 3);
    await expect(engine.command("pitchWheel", { effect: "fx_none", pitch: 1 })).rejects.toMatchObject({ status: 409 });
  });
});
