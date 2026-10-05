/**
 * Uncompressed audio files (WAV, RF64, AIFF/AIFF-C) read without ffmpeg: their header, and their waveform's
 * peaks. Launching ffprobe or ffmpeg costs about half a second on Windows whatever the work, which made a
 * sample dragged from the music Browser take a second or two; these files need no decoder at all. Anything
 * this can't read is left to ffmpeg (`readPcmHeader` answers null).
 */
import fs from "node:fs/promises";

export interface PcmFormat {
  /** Integer samples (signed, or unsigned at 8 bits in WAV) or IEEE floats. */
  float: boolean;
  /** Bits a sample takes in the file: 8, 16, 24, 32 (integers) or 32, 64 (floats). */
  bits: number;
  bigEndian: boolean;
  /** Only WAV's 8-bit samples are unsigned. */
  unsigned: boolean;
}

export interface PcmHeader extends PcmFormat {
  /** ffprobe's name for the container. */
  container: "wav" | "aiff";
  /** ffprobe's name for the samples' codec, e.g. "pcm_s16le". */
  codec: string;
  channels: number;
  sampleRate: number;
  /** Where the samples start in the file, and how many whole frames there are. */
  dataOffset: number;
  frames: number;
  /** Bytes a frame (a sample of every channel) takes. */
  blockAlign: number;
  /** In seconds, to the microsecond, as ffprobe reports it. */
  duration: number;
}

/** How much of a file is read for its header: chunks before the samples past this send it to ffprobe. */
export const HEADER_BYTES = 64 * 1024;

const tag = (b: Uint8Array, at: number) => String.fromCharCode(b[at], b[at + 1], b[at + 2], b[at + 3]);

/**
 * A PCM file's header, from its first bytes (`bytes`, at least what holds the chunks before the samples) and
 * its whole size. Null for anything else, or any header that doesn't add up (a data chunk longer than the
 * file, no frames, odd sizes): ffprobe then decides.
 */
export function parsePcmHeader(bytes: Uint8Array, fileSize: number): PcmHeader | null {
  if (bytes.length < 12) return null;
  const riff = tag(bytes, 0);
  if ((riff === "RIFF" || riff === "RF64" || riff === "BW64") && tag(bytes, 8) === "WAVE") return parseWav(bytes, fileSize, riff !== "RIFF");
  if (riff === "FORM" && (tag(bytes, 8) === "AIFF" || tag(bytes, 8) === "AIFC")) return parseAiff(bytes, fileSize, tag(bytes, 8) === "AIFC");
  return null;
}

function parseWav(bytes: Uint8Array, fileSize: number, wide: boolean): PcmHeader | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let format: { float: boolean; channels: number; sampleRate: number; blockAlign: number; bits: number } | null = null;
  let dataSize64: number | null = null;
  let at = 12;
  while (at + 8 <= bytes.length) {
    const id = tag(bytes, at);
    const size = view.getUint32(at + 4, true);
    const body = at + 8;
    if (id === "ds64") {
      if (body + 16 > bytes.length) return null;
      dataSize64 = view.getUint32(body + 8, true) + view.getUint32(body + 12, true) * 2 ** 32;
    } else if (id === "fmt ") {
      if (size < 16 || body + size > bytes.length) return null;
      let tagId = view.getUint16(body, true);
      if (tagId === 0xfffe) {
        // WAVE_FORMAT_EXTENSIBLE: the real format is the sub-format GUID's first two bytes.
        if (size < 40) return null;
        tagId = view.getUint16(body + 24, true);
      }
      if (tagId !== 1 && tagId !== 3) return null;
      format = {
        float: tagId === 3,
        channels: view.getUint16(body + 2, true),
        sampleRate: view.getUint32(body + 4, true),
        blockAlign: view.getUint16(body + 12, true),
        bits: view.getUint16(body + 14, true),
      };
    } else if (id === "data") {
      if (!format) return null;
      const dataSize = wide && size === 0xffffffff ? dataSize64 : size;
      if (dataSize === null) return null;
      const { float, bits } = format;
      const kind = float ? (bits === 32 || bits === 64) : [8, 16, 24, 32].includes(bits);
      if (!kind) return null;
      const unsigned = !float && bits === 8;
      return finish({
        container: "wav",
        codec: `pcm_${float ? "f" : unsigned ? "u" : "s"}${bits}${bits === 8 ? "" : "le"}`,
        float, bits, bigEndian: false, unsigned,
        channels: format.channels,
        sampleRate: format.sampleRate,
        blockAlign: format.blockAlign,
        dataOffset: body,
        dataBytes: dataSize,
        frames: Math.floor(dataSize / format.blockAlign),
      }, fileSize);
    }
    at = body + size + (size & 1);
  }
  return null;
}

function parseAiff(bytes: Uint8Array, fileSize: number, compressed: boolean): PcmHeader | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let comm: { channels: number; frames: number; bits: number; sampleRate: number; float: boolean; littleEndian: boolean } | null = null;
  let at = 12;
  while (at + 8 <= bytes.length) {
    const id = tag(bytes, at);
    const size = view.getUint32(at + 4, false);
    const body = at + 8;
    if (id === "COMM") {
      if (size < 18 || body + Math.min(size, 22) > bytes.length) return null;
      const bits = view.getInt16(body + 6, false);
      let float = false;
      let littleEndian = false;
      if (compressed) {
        if (size < 22) return null;
        const type = tag(bytes, body + 18);
        if (type === "fl32" || type === "FL32") float = true;
        else if (type === "fl64" || type === "FL64") float = true;
        else if (type === "sowt") littleEndian = true;
        else if (type !== "NONE" && type !== "twos") return null;
      }
      comm = { channels: view.getUint16(body, false), frames: view.getUint32(body + 2, false), bits, sampleRate: extended(view, body + 8), float, littleEndian };
    } else if (id === "SSND") {
      if (!comm || body + 8 > bytes.length) return null;
      const { float, bits, littleEndian } = comm;
      if (float ? bits !== 32 && bits !== 64 : ![8, 16, 24, 32].includes(bits)) return null;
      if (littleEndian && bits === 8) return null;
      const blockAlign = comm.channels * (bits / 8);
      const dataOffset = body + 8 + view.getUint32(body, false);
      return finish({
        container: "aiff",
        codec: `pcm_${float ? "f" : "s"}${bits}${bits === 8 ? "" : littleEndian ? "le" : "be"}`,
        float, bits, bigEndian: !littleEndian, unsigned: false,
        channels: comm.channels,
        sampleRate: comm.sampleRate,
        blockAlign,
        dataOffset,
        dataBytes: Math.min(size - 8 - view.getUint32(body, false), comm.frames * blockAlign),
        frames: comm.frames,
      }, fileSize);
    }
    at = body + size + (size & 1);
  }
  return null;
}

/** The header, once it's checked to add up. */
function finish(
  h: Omit<PcmHeader, "duration"> & { dataBytes: number },
  fileSize: number,
): PcmHeader | null {
  const { dataBytes, ...header } = h;
  if (!(header.channels > 0 && header.channels <= 64)) return null;
  if (!(header.sampleRate >= 1000 && header.sampleRate <= 1_536_000) || !Number.isInteger(header.sampleRate)) return null;
  if (header.blockAlign !== header.channels * (header.bits / 8)) return null;
  // A data chunk said to be longer than the file (a recording cut short, a streamed header): ffprobe's call.
  if (!(dataBytes > 0) || header.dataOffset + dataBytes > fileSize) return null;
  const frames = Math.min(header.frames, Math.floor(dataBytes / header.blockAlign));
  if (!(frames > 0)) return null;
  return { ...header, frames, duration: Math.round((frames / header.sampleRate) * 1e6) / 1e6 };
}

/** An 80-bit IEEE extended float (AIFF's sample rate). */
function extended(view: DataView, at: number): number {
  const exponent = view.getUint16(at, false) & 0x7fff;
  const hi = view.getUint32(at + 2, false);
  const lo = view.getUint32(at + 6, false);
  if (exponent === 0 && hi === 0 && lo === 0) return 0;
  return (hi * 2 ** 32 + lo) * 2 ** (exponent - 16383 - 63);
}

/** A file's PCM header (see `parsePcmHeader`), or null when it isn't one or can't be read. */
export async function readPcmHeader(file: string): Promise<PcmHeader | null> {
  let handle: fs.FileHandle | undefined;
  try {
    handle = await fs.open(file, "r");
    const { size } = await handle.stat();
    const bytes = new Uint8Array(Math.min(size, HEADER_BYTES));
    const { bytesRead } = await handle.read(bytes, 0, bytes.length, 0);
    return parsePcmHeader(bytes.subarray(0, bytesRead), size);
  } catch {
    return null;
  } finally {
    await handle?.close().catch(() => {});
  }
}

/**
 * A waveform's peaks, frame by frame: each bucket of 1/`peaksPerSecond` s keeps the largest magnitude of
 * the channels' average (ffmpeg's mono mix, without its resampling). Fed whole frames only.
 */
export class PcmPeaks {
  readonly peaks: number[] = [];
  private frame = 0;
  private peak = 0;
  private bucket = 0;
  private readonly read: (view: DataView, at: number) => number;

  constructor(
    private readonly header: Pick<PcmHeader, "float" | "bits" | "bigEndian" | "unsigned" | "channels" | "sampleRate" | "blockAlign">,
    private readonly peaksPerSecond: number,
  ) {
    this.read = sampleReader(header);
  }

  /** Whole frames of the file's samples. */
  push(bytes: Uint8Array): void {
    const { channels, blockAlign, sampleRate } = this.header;
    const step = blockAlign / channels;
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const frames = Math.floor(bytes.length / blockAlign);
    const read = this.read;
    for (let f = 0; f < frames; f++) {
      const bucket = Math.floor(((this.frame + f) * this.peaksPerSecond) / sampleRate);
      if (bucket !== this.bucket) {
        this.peaks.push(this.peak);
        this.peak = 0;
        this.bucket = bucket;
      }
      let sum = 0;
      const at = f * blockAlign;
      for (let c = 0; c < channels; c++) sum += read(view, at + c * step);
      const v = Math.abs(sum / channels);
      if (v > this.peak) this.peak = v;
    }
    this.frame += frames;
  }

  /** The peaks, the last (partial) bucket included. */
  finish(): number[] {
    if (this.frame > 0) this.peaks.push(this.peak);
    this.frame = 0;
    return this.peaks;
  }
}

/** Reads one sample as -1..1. */
function sampleReader({ float, bits, bigEndian, unsigned }: PcmFormat): (view: DataView, at: number) => number {
  const le = !bigEndian;
  if (float) return bits === 64 ? (v, at) => v.getFloat64(at, le) : (v, at) => v.getFloat32(at, le);
  switch (bits) {
    case 8:
      return unsigned ? (v, at) => (v.getUint8(at) - 128) / 128 : (v, at) => v.getInt8(at) / 128;
    case 16:
      return (v, at) => v.getInt16(at, le) / 32768;
    case 24:
      return le
        ? (v, at) => ((v.getUint8(at) | (v.getUint8(at + 1) << 8) | (v.getInt8(at + 2) << 16)) / 8388608)
        : (v, at) => ((v.getUint8(at + 2) | (v.getUint8(at + 1) << 8) | (v.getInt8(at) << 16)) / 8388608);
    default:
      return (v, at) => v.getInt32(at, le) / 2147483648;
  }
}

/** Bytes read at once for a waveform: a long file is never held whole. */
const READ_BYTES = 1 << 20;

/** The peaks of a PCM file's samples (see `PcmPeaks`), read a megabyte at a time. */
export async function pcmPeaks(file: string, header: PcmHeader, peaksPerSecond: number, signal?: AbortSignal): Promise<number[]> {
  const peaks = new PcmPeaks(header, peaksPerSecond);
  const handle = await fs.open(file, "r");
  try {
    const chunk = Math.max(1, Math.floor(READ_BYTES / header.blockAlign)) * header.blockAlign;
    const buffer = new Uint8Array(chunk);
    const end = header.dataOffset + header.frames * header.blockAlign;
    for (let at = header.dataOffset; at < end;) {
      signal?.throwIfAborted();
      const { bytesRead } = await handle.read(buffer, 0, Math.min(chunk, end - at), at);
      const whole = bytesRead - (bytesRead % header.blockAlign);
      if (whole <= 0) break;
      peaks.push(buffer.subarray(0, whole));
      // A short read's part frame is read again with the next.
      at += whole;
    }
  } finally {
    await handle.close();
  }
  return peaks.finish();
}
