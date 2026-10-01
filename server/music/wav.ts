/** Reading and writing WAV files, for tests of what the engine plays (and test samples). */
import fs from "node:fs/promises";

/** Write mono 16-bit PCM. `samples` are -1..1. */
export async function writeWav(file: string, samples: ArrayLike<number>, sampleRate: number): Promise<void> {
  await writeWavChannels(file, [samples], sampleRate);
}

/** Write 16-bit PCM with a channel per array (all as long as the first). Samples are -1..1. */
export async function writeWavChannels(file: string, channels: ArrayLike<number>[], sampleRate: number): Promise<void> {
  const frames = channels[0].length;
  const count = channels.length;
  const data = Buffer.alloc(frames * count * 2);
  for (let i = 0; i < frames; i++)
    for (let ch = 0; ch < count; ch++) data.writeInt16LE(Math.round(Math.max(-1, Math.min(1, channels[ch][i])) * 32767), (i * count + ch) * 2);
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + data.length, 4);
  header.write("WAVEfmt ", 8);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(count, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2 * count, 28);
  header.writeUInt16LE(2 * count, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(data.length, 40);
  await fs.writeFile(file, Buffer.concat([header, data]));
}

export interface WavData {
  sampleRate: number;
  /** One array of samples (-1..1) per channel. */
  channels: Float32Array[];
}

/** Read PCM of 16 or 24 bits (what the engine's `render` writes), or 32-bit float (its exports). */
export async function readWav(file: string): Promise<WavData> {
  const bytes = await fs.readFile(file);
  let format: { channels: number; sampleRate: number; bits: number; float: boolean } | null = null;
  for (let at = 12; at + 8 <= bytes.length; ) {
    const id = bytes.toString("ascii", at, at + 4);
    const size = bytes.readUInt32LE(at + 4);
    const body = at + 8;
    if (id === "fmt ") {
      // IEEE float (3), or WAVE_FORMAT_EXTENSIBLE naming it in its sub-format.
      const tag = bytes.readUInt16LE(body);
      const float = tag === 3 || (tag === 0xfffe && size >= 26 && bytes.readUInt16LE(body + 24) === 3);
      format = { channels: bytes.readUInt16LE(body + 2), sampleRate: bytes.readUInt32LE(body + 4), bits: bytes.readUInt16LE(body + 14), float };
    }
    if (id === "data" && format) {
      const width = format.bits / 8;
      const frames = Math.floor(Math.min(size, bytes.length - body) / (width * format.channels));
      const channels = Array.from({ length: format.channels }, () => new Float32Array(frames));
      for (let frame = 0; frame < frames; frame++) {
        for (let ch = 0; ch < format.channels; ch++) {
          const offset = body + (frame * format.channels + ch) * width;
          channels[ch][frame] = format.float ? bytes.readFloatLE(offset) : width === 3 ? bytes.readIntLE(offset, 3) / 0x800000 : bytes.readInt16LE(offset) / 0x8000;
        }
      }
      return { sampleRate: format.sampleRate, channels };
    }
    at = body + size + (size % 2);
  }
  throw new Error(`${file} isn't a PCM WAV file.`);
}

/** Where sound starts after at least `gap` samples of silence: the hits in a rendered loop. */
export function onsets(samples: Float32Array, threshold = 0.01, gap = 200): number[] {
  const found: number[] = [];
  let quiet = gap;
  for (let i = 0; i < samples.length; i++) {
    if (Math.abs(samples[i]) > threshold) {
      if (quiet >= gap) found.push(i);
      quiet = 0;
    } else quiet++;
  }
  return found;
}

/** The loudest sample in `[from, to)`. */
export function peakOf(samples: Float32Array, from = 0, to = samples.length): number {
  let peak = 0;
  for (let i = Math.max(0, from); i < Math.min(samples.length, to); i++) peak = Math.max(peak, Math.abs(samples[i]));
  return peak;
}
