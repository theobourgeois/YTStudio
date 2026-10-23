import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { FFMPEG, FFPROBE } from "./config.ts";
import { ffmpegPeaks, makeWaveform } from "./derivatives.ts";
import { MediaLibrary } from "./media.ts";
import { PcmPeaks, parsePcmHeader, pcmPeaks, readPcmHeader } from "./pcm.ts";
import { ffprobeMedia, probeMedia } from "./probe.ts";
import { DataPaths } from "./storage.ts";

interface WavSpec {
  format?: 1 | 3;
  bits: number;
  channels: number;
  rate: number;
  /** Interleaved samples, as written. */
  data: Buffer;
  extensible?: boolean;
  /** Chunks before `fmt ` / `data` (odd sizes are padded). */
  before?: Buffer[];
  rf64?: boolean;
  /** The size the data chunk claims, if not its own. */
  claimed?: number;
}

function chunk(id: string, body: Buffer): Buffer {
  const head = Buffer.alloc(8);
  head.write(id, 0, "latin1");
  head.writeUInt32LE(body.length, 4);
  return Buffer.concat([head, body, body.length & 1 ? Buffer.alloc(1) : Buffer.alloc(0)]);
}

function wav({ format = 1, bits, channels, rate, data, extensible, before = [], rf64, claimed }: WavSpec): Buffer {
  const block = channels * (bits / 8);
  const fmt = Buffer.alloc(extensible ? 40 : 16);
  fmt.writeUInt16LE(extensible ? 0xfffe : format, 0);
  fmt.writeUInt16LE(channels, 2);
  fmt.writeUInt32LE(rate, 4);
  fmt.writeUInt32LE(rate * block, 8);
  fmt.writeUInt16LE(block, 12);
  fmt.writeUInt16LE(bits, 14);
  if (extensible) {
    fmt.writeUInt16LE(22, 16);
    fmt.writeUInt16LE(bits, 18);
    fmt.writeUInt16LE(format, 24);
  }
  const dataChunk = chunk("data", data);
  if (claimed !== undefined) dataChunk.writeUInt32LE(claimed, 4);
  const parts = [...before.map((b, i) => chunk(i ? "JUNK" : "LIST", b)), chunk("fmt ", fmt)];
  if (rf64) {
    const ds64 = Buffer.alloc(28);
    ds64.writeUInt32LE(data.length, 8);
    parts.unshift(chunk("ds64", ds64));
    dataChunk.writeUInt32LE(0xffffffff, 4);
  }
  const body = Buffer.concat([Buffer.from("WAVE"), ...parts, dataChunk]);
  const head = Buffer.alloc(8);
  head.write(rf64 ? "RF64" : "RIFF", 0, "latin1");
  head.writeUInt32LE(rf64 ? 0xffffffff : body.length, 4);
  return Buffer.concat([head, body]);
}

/** 44.1 kHz as an 80-bit extended float. */
const RATE_44100 = Buffer.from([0x40, 0x0e, 0xac, 0x44, 0, 0, 0, 0, 0, 0]);

function aiff(data: Buffer, { bits, channels, compression }: { bits: number; channels: number; compression?: string }): Buffer {
  const block = channels * (bits / 8);
  const comm = Buffer.alloc(compression ? 24 : 18);
  comm.writeUInt16BE(channels, 0);
  comm.writeUInt32BE(data.length / block, 2);
  comm.writeInt16BE(bits, 6);
  RATE_44100.copy(comm, 8);
  if (compression) comm.write(compression, 18, "latin1");
  const be = (id: string, body: Buffer) => {
    const head = Buffer.alloc(8);
    head.write(id, 0, "latin1");
    head.writeUInt32BE(body.length, 4);
    return Buffer.concat([head, body, body.length & 1 ? Buffer.alloc(1) : Buffer.alloc(0)]);
  };
  const body = Buffer.concat([Buffer.from(compression ? "AIFC" : "AIFF"), be("COMM", comm), be("SSND", Buffer.concat([Buffer.alloc(8), data]))]);
  const head = Buffer.alloc(8);
  head.write("FORM", 0, "latin1");
  head.writeUInt32BE(body.length, 4);
  return Buffer.concat([head, body]);
}

const parse = (b: Buffer) => parsePcmHeader(new Uint8Array(b), b.length);

describe("reading a PCM header", () => {
  it("reads a plain 16-bit WAV", () => {
    const h = parse(wav({ bits: 16, channels: 2, rate: 44_100, data: Buffer.alloc(44_100 * 4) }));
    expect(h).toMatchObject({ container: "wav", codec: "pcm_s16le", channels: 2, sampleRate: 44_100, frames: 44_100, duration: 1, dataOffset: 44, blockAlign: 4 });
  });

  it("names every integer and float width as ffprobe does", () => {
    const codec = (format: 1 | 3, bits: number, extensible = false) =>
      parse(wav({ format, bits, channels: 1, rate: 48_000, data: Buffer.alloc((bits / 8) * 100), extensible }))?.codec;
    expect(codec(1, 8)).toBe("pcm_u8");
    expect(codec(1, 24)).toBe("pcm_s24le");
    expect(codec(1, 32)).toBe("pcm_s32le");
    expect(codec(3, 32)).toBe("pcm_f32le");
    expect(codec(3, 64)).toBe("pcm_f64le");
    expect(codec(1, 24, true)).toBe("pcm_s24le");
    expect(codec(3, 32, true)).toBe("pcm_f32le");
  });

  it("skips other chunks, padded to even sizes, and reads RF64's sizes", () => {
    const data = Buffer.alloc(300);
    const h = parse(wav({ bits: 16, channels: 1, rate: 8000, data, before: [Buffer.alloc(7), Buffer.alloc(10)] }));
    expect(h?.frames).toBe(150);
    expect(h?.dataOffset).toBe(12 + 16 + 18 + 24 + 8);
    expect(parse(wav({ bits: 16, channels: 1, rate: 8000, data, rf64: true }))?.frames).toBe(150);
  });

  it("rounds the duration to the microsecond", () => {
    expect(parse(wav({ bits: 16, channels: 1, rate: 11_025, data: Buffer.alloc(13_610 * 2) }))?.duration).toBe(1.234467);
  });

  it("leaves anything it can't vouch for to ffprobe", () => {
    const ok = { bits: 16, channels: 1, rate: 44_100, data: Buffer.alloc(100) };
    expect(parse(wav({ ...ok, format: 2 as 1 }))).toBeNull(); // ADPCM
    expect(parse(wav({ ...ok, bits: 12 }))).toBeNull();
    expect(parse(wav({ ...ok, claimed: 10_000 }))).toBeNull(); // longer than the file
    expect(parse(wav({ ...ok, data: Buffer.alloc(0) }))).toBeNull(); // no frames
    expect(parse(Buffer.from("ID3\u0004\u0000 not a wave file at all"))).toBeNull();
    // Its header past what's read: not guessed at.
    const big = wav({ ...ok, before: [Buffer.alloc(100)] });
    expect(parsePcmHeader(new Uint8Array(big.subarray(0, 60)), big.length)).toBeNull();
  });

  it("reads AIFF and AIFF-C", () => {
    const data = Buffer.alloc(4 * 441);
    expect(parse(aiff(data, { bits: 16, channels: 2 }))).toMatchObject({ container: "aiff", codec: "pcm_s16be", sampleRate: 44_100, frames: 441, duration: 0.01 });
    expect(parse(aiff(data, { bits: 16, channels: 2, compression: "sowt" }))?.codec).toBe("pcm_s16le");
    expect(parse(aiff(data, { bits: 32, channels: 1, compression: "fl32" }))?.codec).toBe("pcm_f32be");
    expect(parse(aiff(data, { bits: 16, channels: 2, compression: "ima4" }))).toBeNull();
  });
});

describe("a PCM file's peaks", () => {
  const header = { float: false, bits: 24, bigEndian: false, unsigned: false, channels: 2, sampleRate: 100, blockAlign: 6 };

  it("decodes samples and averages the channels", () => {
    const bytes = Buffer.alloc(6 * 4);
    bytes.writeIntLE(-4_194_304, 0, 3); // -0.5
    bytes.writeIntLE(-4_194_304, 3, 3);
    bytes.writeIntLE(8_388_607, 6, 3); // ~1
    bytes.writeIntLE(0, 9, 3);
    const peaks = new PcmPeaks(header, 50);
    peaks.push(bytes);
    const out = peaks.finish();
    expect(out).toHaveLength(2);
    expect(out[0]).toBeCloseTo(0.5, 5);
    expect(out[1]).toBe(0);
  });

  it("makes as many buckets as the file has fiftieths of a second, whatever the rate", () => {
    for (const sampleRate of [11_025, 22_050, 44_100, 48_000]) {
      const frames = Math.round(sampleRate * 1.234);
      const peaks = new PcmPeaks({ ...header, bits: 16, channels: 1, blockAlign: 2, sampleRate }, 50);
      // Fed in odd pieces, as a file is read.
      const bytes = Buffer.alloc(frames * 2);
      for (let at = 0; at < bytes.length; at += 2 * 333) peaks.push(bytes.subarray(at, Math.min(bytes.length, at + 2 * 333)));
      expect(peaks.finish()).toHaveLength(Math.ceil((frames * 50) / sampleRate));
    }
  });
});

const ffmpegAvailable = spawnSync(FFMPEG, ["-version"]).status === 0 && spawnSync(FFPROBE, ["-version"]).status === 0;

describe.skipIf(!ffmpegAvailable)("PCM files against ffprobe and ffmpeg", () => {
  let dir: string;
  const ffmpeg = (...args: string[]) => execFileSync(FFMPEG, ["-hide_banner", "-loglevel", "error", "-nostdin", "-y", ...args]);
  /** A tone with a swell, so peaks differ bucket to bucket. */
  const make = (name: string, codec: string, rate: number, channels: number, extra: string[] = []) => {
    const file = path.join(dir, name);
    ffmpeg("-f", "lavfi", "-i", `sine=frequency=220:sample_rate=${rate}:duration=1.2345`, "-af", "volume='0.2+0.7*t/1.2345':eval=frame",
      "-ac", String(channels), "-c:a", codec, ...extra, file);
    return file;
  };
  const files: Record<string, string> = {};

  beforeAll(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "pcm-"));
    files.s16 = make("s16.wav", "pcm_s16le", 44_100, 2);
    files.u8 = make("u8.wav", "pcm_u8", 22_050, 1);
    files.s24 = make("s24.wav", "pcm_s24le", 48_000, 1);
    files.s32 = make("s32-6ch.wav", "pcm_s32le", 44_100, 6); // WAVE_FORMAT_EXTENSIBLE
    files.f32 = make("f32.wav", "pcm_f32le", 11_025, 2);
    files.f64 = make("f64.wav", "pcm_f64le", 96_000, 2);
    files.rf64 = make("rf64.wav", "pcm_s16le", 44_100, 1, ["-rf64", "always"]);
    files.aiff = make("a.aiff", "pcm_s16be", 44_100, 1);
    files.mp3 = make("a.mp3", "libmp3lame", 44_100, 1);
  });
  afterAll(() => fs.rm(dir, { recursive: true, force: true }));

  it("reads every WAV as ffprobe does", async () => {
    for (const key of ["s16", "u8", "s24", "s32", "f32", "f64", "rf64"]) {
      expect(await readPcmHeader(files[key]), key).not.toBeNull();
      expect(await probeMedia(files[key]), key).toEqual(await ffprobeMedia(files[key]));
    }
  });

  it("refuses AIFF as ffprobe does, and leaves other formats to it", async () => {
    expect(await readPcmHeader(files.aiff)).not.toBeNull();
    const fast = await probeMedia(files.aiff).catch((e: Error) => e.message);
    const slow = await ffprobeMedia(files.aiff).catch((e: Error) => e.message);
    expect(fast).toEqual(slow);
    expect(await readPcmHeader(files.mp3)).toBeNull();
    expect((await probeMedia(files.mp3)).formatName).toBe("mp3");
  });

  it("draws the same waveform ffmpeg does", async () => {
    for (const key of ["s16", "u8", "s24", "s32", "f32", "f64", "rf64"]) {
      const header = (await readPcmHeader(files[key]))!;
      const ours = await pcmPeaks(files[key], header, 50);
      const theirs = await ffmpegPeaks(files[key]);
      expect(Math.abs(ours.length - theirs.length), key).toBeLessThanOrEqual(1);
      const top = (p: number[]) => Math.max(...p);
      for (let i = 0; i < Math.min(ours.length, theirs.length) - 1; i++) {
        expect(Math.abs(ours[i] / top(ours) - theirs[i] / top(theirs)), `${key} ${i}`).toBeLessThan(0.05);
      }
    }
    const out = path.join(dir, "waveform.json");
    await makeWaveform(files.s16, out);
    const data = JSON.parse(await fs.readFile(out, "utf8"));
    expect(data.peaksPerSecond).toBe(50);
    expect(Math.max(...data.peaks)).toBe(1);
  });

  it("adds a WAV to a project's media as it would through ffprobe", async () => {
    const paths = new DataPaths(path.join(dir, "data"));
    await paths.init();
    const media = path.join(dir, "P.ytvid", "media");
    await fs.mkdir(media, { recursive: true });
    const library = new MediaLibrary(paths, undefined, () => media);
    const asset = await library.importFile(files.s16, "proj_000000000000", () => true, "origin");
    const probe = await ffprobeMedia(files.s16);
    expect(asset).toMatchObject({
      kind: probe.kind, duration: probe.duration, width: probe.width, height: probe.height, fps: probe.fps,
      hasVideo: probe.hasVideo, hasAudio: probe.hasAudio, status: "processing", waveform: null, filmstrip: null,
      poster: null, origin: "origin", name: "s16.wav",
    });
    expect(asset.src).toMatch(/\/source\.wav$/);
    for (let i = 0; i < 100 && library.find(asset.id)?.status === "processing"; i++) await new Promise((r) => setTimeout(r, 20));
    expect(library.find(asset.id)).toMatchObject({ status: "ready", waveform: expect.stringMatching(/waveform\.json$/) });
    library.shutdown();
  });
});
