/**
 * The music suite's models for real (`ml-worker.mjs` with ONNX Runtime): HTDemucs splitting a mix of the starter
 * kit's drums and a bass line, and Basic Pitch hearing a melody. Skipped until the models are downloaded (Extract
 * stems' and Convert to notes' Download, or `musicModels(MODELS_DIR).stems.setUp()`), as the engine's tests are
 * until it's built.
 */
import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MUSIC_MODELS } from "../../shared/music/models.ts";
import { heardFromJson, pickNotes } from "../../shared/music/transcribe.ts";
import { MODELS_DIR, MUSIC_WORKER } from "../config.ts";
import { NoteHearing } from "./hearing.ts";
import { decodeRaw, musicModels, runWorker } from "./ml.ts";
import { readWav, writeWavChannels } from "./wav.ts";

const here = (name: keyof typeof MUSIC_MODELS) => existsSync(path.join(MODELS_DIR, MUSIC_MODELS[name].files[0].file));
const KIT = path.resolve(import.meta.dirname, "../../public/kit");
const RATE = 44_100;

let dir = "";
beforeAll(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "vaudio-ml-"));
});
afterAll(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

/** The signal-to-distortion ratio (dB) of an estimate of `truth`: MDX's measure of a separation. */
function sdr(truth: Float32Array, estimate: Float32Array) {
  let signal = 0;
  let error = 0;
  for (let i = 0; i < truth.length; i++) {
    signal += truth[i] ** 2;
    error += (truth[i] - estimate[i]) ** 2;
  }
  return 10 * Math.log10(signal / error);
}

describe.skipIf(!here("stems"))("HTDemucs, for real", () => {
  it("splits drums from a bass line, and the rest is silent", async () => {
    const [kick, snare, hat] = await Promise.all(["kick", "snare", "hat"].map(async (n) => (await readWav(path.join(KIT, `${n}.wav`))).channels[0]));
    const n = RATE * 12;
    const drums = new Float32Array(n);
    const bass = new Float32Array(n);
    for (let s = 0; s * 0.125 < 11.5; s++) {
      const at = Math.round(s * 0.125 * RATE);
      const add = (x: Float32Array, gain: number) => x.forEach((v, i) => at + i < n && (drums[at + i] += v * gain));
      if (s % 8 === 0) add(kick, 0.8);
      if (s % 8 === 4) add(snare, 0.7);
      if (s % 2 === 0) add(hat, 0.3);
    }
    const line = [40, 40, 43, 45, 40, 40, 47, 45];
    for (let b = 0; b * 0.5 < 11.5; b++) {
      const f = 440 * 2 ** ((line[b % 8] - 69) / 12);
      const at = Math.round(b * 0.5 * RATE);
      for (let i = 0; i < 0.45 * RATE; i++) {
        const t = i / RATE;
        const envelope = Math.min(1, t * 200) * Math.exp(-t * 2);
        bass[at + i] += 0.35 * envelope * (Math.sin(2 * Math.PI * f * t) + 0.5 * Math.sin(4 * Math.PI * f * t) + 0.25 * Math.sin(6 * Math.PI * f * t));
      }
    }
    const mix = drums.map((v, i) => v + bass[i]);
    const source = path.join(dir, "mix.wav");
    await writeWavChannels(source, [mix, mix], RATE);
    const raw = path.join(dir, "mix.f32");
    const frames = await decodeRaw(source, raw, { rate: RATE, channels: 2 });
    const out = (stem: string) => path.join(dir, `${stem}.wav`);
    const progress: number[] = [];
    const result = await runWorker(
      MUSIC_WORKER,
      {
        cmd: "stems",
        model: await musicModels(MODELS_DIR, false).stems.file(),
        input: raw,
        frames,
        outputs: [
          { file: out("drums"), sources: ["drums"] },
          { file: out("bass"), sources: ["bass"] },
          { file: out("rest"), sources: ["vocals", "other", "guitar", "piano"] },
        ],
      },
      { onProgress: (p) => progress.push(p) },
    );
    expect(result.frames).toBe(n);
    expect(progress.at(-1)).toBe(1);
    const [d, b, rest] = await Promise.all(["drums", "bass", "rest"].map(async (s) => (await readWav(out(s))).channels[0]));
    expect(d.length).toBe(n);
    // Measured at about 20 dB each (fp16 weights, 2026-10).
    expect(sdr(drums, d)).toBeGreaterThan(14);
    expect(sdr(bass, b)).toBeGreaterThan(14);
    const energy = (x: Float32Array) => x.reduce((sum, v) => sum + v * v, 0);
    expect(energy(rest) / energy(mix)).toBeLessThan(0.01);
  }, 120_000);
});

describe.skipIf(!here("notes"))("Basic Pitch, for real", () => {
  it("hears a melody's notes where they're played", async () => {
    // C4 E4 G4 C5 B4 G4: a note every 0.4 s, each 0.35 s of a tone with a few harmonics.
    const melody = [60, 64, 67, 72, 71, 67];
    const samples = new Float32Array(Math.round(RATE * (melody.length * 0.4 + 0.5)));
    melody.forEach((pitch, k) => {
      const f = 440 * 2 ** ((pitch - 69) / 12);
      const at = Math.round((0.25 + k * 0.4) * RATE);
      for (let i = 0; i < 0.35 * RATE; i++) {
        const t = i / RATE;
        const envelope = Math.min(1, t * 100) * Math.exp(-t * 3);
        samples[at + i] += 0.3 * envelope * (Math.sin(2 * Math.PI * f * t) + 0.4 * Math.sin(4 * Math.PI * f * t) + 0.2 * Math.sin(6 * Math.PI * f * t));
      }
    });
    const file = path.join(dir, "melody.wav");
    await writeWavChannels(file, [samples], RATE);
    const hearing = new NoteHearing({
      worker: MUSIC_WORKER,
      models: musicModels(MODELS_DIR, false),
      standIn: false,
      samplePath: () => file,
      tmpFile: (suffix) => path.join(dir, `t${Math.random().toString(36).slice(2)}${suffix}`),
    });
    const heard = heardFromJson(await hearing.hear({ projectId: "p", sampleId: "m" }));
    const notes = pickNotes(heard, { onsetThreshold: 0.5, frameThreshold: 0.3, minFrames: 11, lowest: 21, highest: 108 });
    expect(notes.map((n) => n.pitch)).toEqual(melody);
    notes.forEach((n, k) => expect(Math.abs(n.start - (0.25 + k * 0.4))).toBeLessThan(0.04));
  }, 60_000);
});
