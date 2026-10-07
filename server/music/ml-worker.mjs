/**
 * The music suite's models (docs/fl-studio/stems-and-notes.md), run by ONNX Runtime's native build in a process of
 * their own: one job a process, so a model's gigabytes are given back when it ends, a crash takes nothing else with
 * it, and cancelling is killing it. Plain JavaScript, so Node (or Electron in Node mode) runs it as it is; the desktop
 * build bundles it with ONNX Runtime's native library beside it (scripts/desktop.ts).
 *
 * Usage: `ml-worker.mjs '<job as JSON>'`. Audio comes in and goes out as files (the server decodes with ffmpeg);
 * stdout carries JSON lines: `{ "progress": 0..1 }` as it goes, then `{ "done": true, ...result }`. A failure is a
 * message on stderr and a non-zero exit.
 *
 * - `stems`: HTDemucs v4, six sources (MIT; Meta's weights, StemSplitio's ONNX export with the STFT as
 *   convolutions). In: raw float32 stereo at 44.1 kHz, interleaved. Out: a 24-bit WAV for each output, the sum of
 *   the sources it names (`{ file, sources }`: "Other" can be everything not asked for), written as it goes
 *   (segments of 7.8 s, a quarter overlapped and crossfaded), so memory stays flat whatever the song's length.
 * - `notes`: Spotify's Basic Pitch (Apache 2.0). In: raw float32 mono at 22050 Hz. Out: its note and onset
 *   activations, a frame every 256 samples by 88 keys, as 16-bit fractions (notes, then onsets). Picking notes
 *   out of them is `pickNotes` (shared/music/transcribe.ts), in the tab, so its settings answer at once.
 */
import fs from "node:fs";
import os from "node:os";
import ort from "onnxruntime-node";

const send = (message) => process.stdout.write(`${JSON.stringify(message)}\n`);

/**
 * ONNX Runtime's arena keeps the peak's memory for good: off, a separation needs about half the memory. Two cores
 * are left to the audio engine, so a song can play on while it separates (as fast: measured on 18 cores).
 */
const SESSION = {
  executionProviders: ["cpu"],
  graphOptimizationLevel: "all",
  enableCpuMemArena: false,
  enableMemPattern: false,
  intraOpNumThreads: Math.max(1, os.cpus().length - 2),
};

// ---- Stems ----

/** The six-source model's sources, in its output's order. */
const SOURCES = ["drums", "bass", "other", "vocals", "guitar", "piano"];
const SEGMENT = 343_980; // 7.8 s at 44.1 kHz: the length the model was exported for.
const OVERLAP = SEGMENT / 4;
const STRIDE = SEGMENT - OVERLAP;
const STEM_RATE = 44_100;

/** Reads frames [start, start + count) of an interleaved stereo float32 file into planar channels (zeros past its end). */
function readStereo(fd, totalFrames, start, count, into) {
  into.fill(0);
  const frames = Math.max(0, Math.min(count, totalFrames - start));
  if (!frames) return;
  const bytes = Buffer.alloc(frames * 8);
  fs.readSync(fd, bytes, 0, bytes.length, start * 8);
  const samples = new Float32Array(bytes.buffer, bytes.byteOffset, frames * 2);
  for (let i = 0; i < frames; i++) {
    into[i] = samples[2 * i];
    into[count + i] = samples[2 * i + 1];
  }
}

/** A 24-bit stereo WAV written frame by frame (its length is known before the first). */
class WavWriter {
  constructor(file, frames, rate) {
    this.fd = fs.openSync(file, "w");
    const data = frames * 2 * 3;
    const header = Buffer.alloc(44);
    header.write("RIFF", 0);
    header.writeUInt32LE(36 + data, 4);
    header.write("WAVEfmt ", 8);
    header.writeUInt32LE(16, 16);
    header.writeUInt16LE(1, 20);
    header.writeUInt16LE(2, 22);
    header.writeUInt32LE(rate, 24);
    header.writeUInt32LE(rate * 2 * 3, 28);
    header.writeUInt16LE(2 * 3, 32);
    header.writeUInt16LE(24, 34);
    header.write("data", 36);
    header.writeUInt32LE(data, 40);
    fs.writeSync(this.fd, header);
  }

  /** Writes `count` frames of two planar channels. */
  write(left, right, count) {
    const out = Buffer.alloc(count * 6);
    for (let i = 0; i < count; i++) {
      out.writeIntLE(toInt24(left[i]), i * 6, 3);
      out.writeIntLE(toInt24(right[i]), i * 6 + 3, 3);
    }
    fs.writeSync(this.fd, out);
  }

  close() {
    fs.closeSync(this.fd);
  }
}

const toInt24 = (v) => Math.round(Math.max(-1, Math.min(1, v)) * 8_388_607);

async function stems(job) {
  const session = await ort.InferenceSession.create(job.model, SESSION);
  const total = job.frames;
  const outputs = job.outputs.map((output) => {
    const sources = output.sources.map((name) => SOURCES.indexOf(name));
    if (!sources.length || sources.some((k) => k < 0)) throw new Error(`Unknown sources: ${output.sources.join(", ")}`);
    return { sources, writer: new WavWriter(output.file, total, STEM_RATE) };
  });
  const fd = fs.openSync(job.input, "r");
  const fadeIn = Float32Array.from({ length: OVERLAP }, (_, i) => (i + 0.5) / OVERLAP);
  // What the segment before left of its last quarter (each output's two channels, and the weights), to add to the next.
  const carry = outputs.map(() => [new Float32Array(OVERLAP), new Float32Array(OVERLAP)]);
  const carryWeight = new Float32Array(OVERLAP);
  const input = new Float32Array(2 * SEGMENT);
  const segments = Math.max(1, Math.ceil(Math.max(0, total - OVERLAP) / STRIDE));
  const left = new Float32Array(SEGMENT);
  const right = new Float32Array(SEGMENT);
  try {
    for (let s = 0; s < segments; s++) {
      const start = s * STRIDE;
      const length = Math.min(SEGMENT, total - start);
      const last = s === segments - 1;
      readStereo(fd, total, start, SEGMENT, input);
      const output = (await session.run({ mix: new ort.Tensor("float32", input, [1, 2, SEGMENT]) })).stems.data;
      // A segment fades in over the one before it and out under the next (not at the song's ends).
      const weight = (i) => (s > 0 && i < OVERLAP ? fadeIn[i] : 1) * (!last && i >= STRIDE ? 1 - fadeIn[i - STRIDE] : 1);
      const final = last ? length : STRIDE;
      outputs.forEach(({ sources, writer }, o) => {
        for (let i = 0; i < length; i++) {
          const w = weight(i);
          let l = 0;
          let r = 0;
          for (const k of sources) {
            l += output[k * 2 * SEGMENT + i];
            r += output[k * 2 * SEGMENT + SEGMENT + i];
          }
          l *= w;
          r *= w;
          let sum = w;
          if (s > 0 && i < OVERLAP) {
            l += carry[o][0][i];
            r += carry[o][1][i];
            sum += carryWeight[i];
          }
          if (i < final) {
            left[i] = l / sum;
            right[i] = r / sum;
          } else {
            carry[o][0][i - STRIDE] = l;
            carry[o][1][i - STRIDE] = r;
          }
        }
        writer.write(left, right, final);
      });
      if (!last) for (let i = STRIDE; i < SEGMENT; i++) carryWeight[i - STRIDE] = 1 - fadeIn[i - STRIDE];
      send({ progress: (s + 1) / segments });
    }
  } finally {
    fs.closeSync(fd);
    for (const { writer } of outputs) writer.close();
  }
  return { frames: total };
}

// ---- Notes ----

const NOTE_RATE = 22_050;
const HOP = 256;
const WINDOW = NOTE_RATE * 2 - HOP; // 43 844 samples: the model's input.
const WINDOW_FRAMES = 172;
/** Windows overlap by 30 frames; half of that is dropped from each side of every window's output. */
const OVERLAP_FRAMES = 30;
const NOTE_HOP = WINDOW - OVERLAP_FRAMES * HOP;
const KEYS = 88;

async function notes(job) {
  const session = await ort.InferenceSession.create(job.model, SESSION);
  const [input] = session.inputNames;
  // The model's outputs, by Basic Pitch's own names for them (inference.py: `StatefulPartitionedCall:1` is the notes).
  const NOTE = "StatefulPartitionedCall:1";
  const ONSET = "StatefulPartitionedCall:2";
  const bytes = fs.readFileSync(job.input);
  const audio = new Float32Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.length - (bytes.length % 4)));
  // Half an overlap of silence first, as Basic Pitch does, so the first window's dropped frames are before the audio.
  const padded = new Float32Array(audio.length + (OVERLAP_FRAMES * HOP) / 2);
  padded.set(audio, (OVERLAP_FRAMES * HOP) / 2);
  const keep = WINDOW_FRAMES - OVERLAP_FRAMES;
  const windows = Math.ceil(padded.length / NOTE_HOP);
  // As many frames as the audio lasts, at Basic Pitch's whole 86 a second (its release's `unwrap_output`).
  const frames = Math.min(windows * keep, Math.floor((audio.length * Math.floor(NOTE_RATE / HOP)) / NOTE_RATE));
  const noteOut = new Uint16Array(frames * KEYS);
  const onsetOut = new Uint16Array(frames * KEYS);
  const window = new Float32Array(WINDOW);
  for (let w = 0; w < windows; w++) {
    window.fill(0);
    window.set(padded.subarray(w * NOTE_HOP, w * NOTE_HOP + WINDOW));
    const result = await session.run({ [input]: new ort.Tensor("float32", window, [1, WINDOW, 1]) });
    const noteData = result[NOTE].data;
    const onsetData = result[ONSET].data;
    for (let f = OVERLAP_FRAMES / 2; f < WINDOW_FRAMES - OVERLAP_FRAMES / 2; f++) {
      const frame = w * keep + f - OVERLAP_FRAMES / 2;
      if (frame >= frames) break;
      for (let k = 0; k < KEYS; k++) {
        noteOut[frame * KEYS + k] = Math.round(Math.max(0, Math.min(1, noteData[f * KEYS + k])) * 65_535);
        onsetOut[frame * KEYS + k] = Math.round(Math.max(0, Math.min(1, onsetData[f * KEYS + k])) * 65_535);
      }
    }
    if (w % 8 === 7 || w === windows - 1) send({ progress: (w + 1) / windows });
  }
  const out = fs.openSync(job.output, "w");
  try {
    fs.writeSync(out, new Uint8Array(noteOut.buffer));
    fs.writeSync(out, new Uint8Array(onsetOut.buffer));
  } finally {
    fs.closeSync(out);
  }
  return { frames };
}

const COMMANDS = { stems, notes, version: async () => ({ onnxruntime: ort.env.versions.common }) };

try {
  const job = JSON.parse(process.argv[2] ?? "{}");
  const command = COMMANDS[job.cmd];
  if (!command) throw new Error(`Unknown job "${job.cmd}"`);
  send({ done: true, ...(await command(job)) });
  process.exit(0);
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
}
