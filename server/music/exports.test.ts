/**
 * Song exports (`MusicExports`) against the stand-in engine (`fake-engine.mjs`: it "renders" a quiet tone
 * as long as the song in about a second and a half) and the real ffmpeg, which encodes every format.
 */
import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { addChannels, setSteps } from "../../shared/music/edits.ts";
import { DEFAULT_EXPORT_SETTINGS, type ExportSettings, type MusicExportJob } from "../../shared/music/export.ts";
import { routeChannels } from "../../shared/music/mixer.ts";
import { FIRST_PATTERN_ID, createMusicProject } from "../../shared/music/project.ts";
import { FFPROBE } from "../config.ts";
import { run } from "../process.ts";
import { DataPaths } from "../storage.ts";
import { AudioEngine } from "./engine.ts";
import { MusicExports } from "./exports.ts";

const FAKE = [process.execPath, path.join(import.meta.dirname, "fake-engine.mjs")];
const PROJECT = "proj_0123456789ab";
const P = FIRST_PATTERN_ID;

/** Two channels on two mixer tracks; one bar at 120 BPM: two seconds. */
const song = () => {
  let s = addChannels(createMusicProject("Night drive", 120), [
    { id: "chan_kick", name: "Kick", sampleId: null },
    { id: "chan_bass", name: "Bass", sampleId: null },
  ]);
  s = setSteps(setSteps(s, P, "chan_kick", [0, 4], true), P, "chan_bass", [8], true);
  return routeChannels(routeChannels(s, ["chan_kick"], "insert_1"), ["chan_bass"], "insert_2");
};

async function probe(file: string) {
  const out = await run(FFPROBE, ["-v", "error", "-show_entries", "stream=codec_name,sample_fmt,sample_rate,channels,bits_per_raw_sample:format=duration", "-of", "json", file]);
  const json = JSON.parse(out) as { streams: Record<string, string | number>[]; format: { duration: string } };
  return { ...json.streams[0], duration: Number(json.format.duration) };
}

describe("MusicExports", () => {
  let dir: string;
  let engine: AudioEngine;
  let exports: MusicExports;
  let revealed: string[];

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "music-exports-"));
    const paths = new DataPaths(dir);
    await paths.init();
    engine = new AudioEngine(paths, { command: FAKE, pluginPaths: [] });
    revealed = [];
    exports = new MusicExports(paths, engine, { samplePath: () => null, reveal: async (file) => void revealed.push(file) });
  });
  afterEach(async () => {
    exports.shutdown();
    engine.shutdown();
    await fs.rm(dir, { recursive: true, force: true });
  });

  const start = (settings: Partial<ExportSettings>, destination: string | null = null) =>
    exports.start({ projectId: PROJECT, song: song(), patternId: P, selection: null, settings: { ...DEFAULT_EXPORT_SETTINGS, ...settings }, destination });
  async function finished(id: string): Promise<MusicExportJob> {
    for (;;) {
      const job = exports.get(id);
      if (job.state !== "rendering" && job.state !== "encoding") return job;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }

  it("renders once and encodes the mix and each stem into every format, plus the MIDI, to download", async () => {
    const started = await start({ mode: "pattern", formats: ["wav", "mp3", "flac", "ogg", "m4a", "mid"], wavBits: 16, flacBits: 24, stems: true });
    expect(started.state).toBe("rendering");
    const job = await finished(started.id);
    expect(job).toMatchObject({ state: "done", error: null, rendered: 1, encoded: 16, toEncode: 16, length: 2 });
    // The mix first, then each stem, in the order of the formats.
    expect(job.files.map((f) => f.name)).toEqual([
      ..."wav mp3 flac ogg m4a mid".split(" ").map((ext) => `Night drive.${ext}`),
      ..."wav mp3 flac ogg m4a".split(" ").map((ext) => `Night drive - Insert 1.${ext}`),
      ..."wav mp3 flac ogg m4a".split(" ").map((ext) => `Night drive - Insert 2.${ext}`),
    ]);
    // Kept here, to download: no path on this computer's disk.
    expect(job.files.every((f) => f.path === null && f.bytes > 0)).toBe(true);
    const file = (name: string) => exports.file(job.id, name);
    expect(await probe(file("Night drive.wav"))).toMatchObject({ codec_name: "pcm_s16le", sample_rate: "48000", channels: 2 });
    expect((await probe(file("Night drive.wav"))).duration).toBeCloseTo(2, 2);
    expect(await probe(file("Night drive.mp3"))).toMatchObject({ codec_name: "mp3", sample_rate: "48000" });
    expect(await probe(file("Night drive.flac"))).toMatchObject({ codec_name: "flac", bits_per_raw_sample: "24" });
    expect(await probe(file("Night drive.ogg"))).toMatchObject({ codec_name: "vorbis" });
    expect(await probe(file("Night drive.m4a"))).toMatchObject({ codec_name: "aac" });
    expect((await fs.readFile(file("Night drive.mid"))).subarray(0, 4).toString()).toBe("MThd");
    // The engine's own WAVs are gone.
    expect(existsSync(path.join(dir, "tmp", `export-${job.id}`))).toBe(false);
    expect(() => exports.file(job.id, "../../secrets")).toThrow(/no such file/);
  });

  it("writes beside the save dialog's file, named after it, and shows it in Finder", async () => {
    const chosen = path.join(dir, "Desktop", "Final mix.wav");
    await fs.mkdir(path.dirname(chosen));
    const job = await finished((await start({ formats: ["wav", "mp3"], mode: "pattern" }, chosen)).id);
    expect(job.state).toBe("done");
    expect(job.files.map((f) => f.path)).toEqual([chosen, path.join(dir, "Desktop", "Final mix.mp3")]);
    expect(await fs.readdir(path.dirname(chosen))).toEqual(["Final mix.mp3", "Final mix.wav"]);
    expect(revealed).toEqual([chosen]);
    // A folder that isn't there is refused at once.
    await expect(start({}, path.join(dir, "Nowhere", "x.wav"))).rejects.toMatchObject({ status: 400 });
  });

  it("exports one song at a time, and stops when asked, leaving nothing", async () => {
    const chosen = path.join(dir, "Out", "Song.wav");
    await fs.mkdir(path.dirname(chosen));
    const first = await start({ stems: true, mode: "pattern" }, chosen);
    await expect(start({})).rejects.toMatchObject({ status: 409 });
    await new Promise((resolve) => setTimeout(resolve, 300));
    await exports.abort(first.id);
    const job = await finished(first.id);
    expect(job).toMatchObject({ state: "aborted", files: [], error: null });
    expect(await fs.readdir(path.dirname(chosen))).toEqual([]);
    // Free for the next.
    expect((await finished((await start({ mode: "pattern" })).id)).state).toBe("done");
  });

  it("fails cleanly when ffmpeg can't encode, saying why", async () => {
    const broken = new MusicExports(new DataPaths(dir), engine, { samplePath: () => null, ffmpeg: path.join(dir, "no-ffmpeg") });
    const chosen = path.join(dir, "Broken", "Song.wav");
    await fs.mkdir(path.dirname(chosen));
    const job = await (async () => {
      const started = await broken.start({ projectId: PROJECT, song: song(), patternId: P, selection: null, settings: { ...DEFAULT_EXPORT_SETTINGS, mode: "pattern" }, destination: chosen });
      for (;;) {
        const now = broken.get(started.id);
        if (now.state !== "rendering" && now.state !== "encoding") return now;
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
    })();
    expect(job.state).toBe("failed");
    expect(job.error).toMatch(/Couldn't make Song\.wav/);
    expect(await fs.readdir(path.dirname(chosen))).toEqual([]);
  });
});
