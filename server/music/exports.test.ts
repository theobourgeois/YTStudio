/**
 * Song exports (`MusicExports`) against the stand-in engine (`fake-engine.mjs`: it "renders" a quiet tone
 * as long as the song in about a second and a half) and the real ffmpeg, which encodes every format.
 */
import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { addChannels, setMainVolume, setSteps } from "../../shared/music/edits.ts";
import { DEFAULT_EXPORT_SETTINGS, type ExportSettings, type MusicExportJob } from "../../shared/music/export.ts";
import { routeChannels, setEffect, updateMixerTrack } from "../../shared/music/mixer.ts";
import { PRO_L_PLUGIN } from "../../shared/music/pro-l-presets.ts";
import { updateProL } from "../../shared/music/pro-l.ts";
import { FIRST_PATTERN_ID, MASTER_TRACK_ID, createMusicProject } from "../../shared/music/project.ts";
import { FFMPEG, FFPROBE } from "../config.ts";
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

/** A file's loudest sample, in dB from full scale (ffmpeg says on stderr). */
async function peakDb(file: string): Promise<number> {
  let said = "";
  await run(FFMPEG, ["-hide_banner", "-i", file, "-af", "astats=measure_overall=Peak_level:measure_perchannel=0", "-f", "null", "-"], { onStderr: (chunk) => (said += chunk.toString()) });
  return Number(/Peak level dB: (-?[\d.]+)/.exec(said)?.[1] ?? NaN);
}

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

  it("bounces each mixer track's stem into the project's media (Consolidate), its formats and mix left out", async () => {
    const adopted: { projectId: string; name: string; origin: string; bytes: number }[] = [];
    const paths = new DataPaths(dir);
    const bouncing = new MusicExports(paths, engine, {
      samplePath: () => null,
      adopt: async (projectId, file, name, origin) => {
        adopted.push({ projectId, name, origin, bytes: (await fs.stat(file)).size });
        return { id: `media_${adopted.length}`, name: `${name}.wav` } as never;
      },
    });
    const bounce = { name: "Beat (consolidated)", names: { insert_2: "Bass (consolidated)" } };
    const started = await bouncing.start({ projectId: PROJECT, song: song(), patternId: P, selection: { start: 0, end: 384 }, settings: { ...DEFAULT_EXPORT_SETTINGS, formats: ["mp3"], stems: false }, destination: "/tmp/x.wav", bounce });
    let job = bouncing.get(started.id);
    while (job.state === "rendering" || job.state === "encoding") {
      await new Promise((resolve) => setTimeout(resolve, 50));
      job = bouncing.get(started.id);
    }
    expect(job).toMatchObject({ state: "done", files: [], bounced: [{ track: "insert_1", media: { id: "media_1" } }, { track: "insert_2", media: { id: "media_2" } }] });
    expect(adopted).toEqual([
      { projectId: PROJECT, name: "Beat (consolidated)", origin: `bounce:${job.id}:insert_1`, bytes: 44 + 96_000 * 8 },
      { projectId: PROJECT, name: "Bass (consolidated)", origin: `bounce:${job.id}:insert_2`, bytes: 44 + 96_000 * 8 },
    ]);
    bouncing.shutdown();
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

  it("turns a render that goes over full scale down, every file alike, so nothing clips; or leaves it, if asked", async () => {
    // The master turned right up and the main volume too: the mix peaks at about 1.6 (+4 dB).
    const loud = setMainVolume(updateMixerTrack(song(), MASTER_TRACK_ID, { volume: 1 }), 1);
    const startLoud = (settings: Partial<ExportSettings>) =>
      exports.start({ projectId: PROJECT, song: loud, patternId: P, selection: null, settings: { ...DEFAULT_EXPORT_SETTINGS, mode: "pattern", ...settings }, destination: null });
    const job = await finished((await startLoud({ formats: ["wav", "mp3"], wavBits: 24, stems: true })).id);
    expect(job.peakDb).toBeGreaterThan(3);
    expect(job.gainDb).toBeCloseTo(-(job.peakDb! + 0.3), 6);
    // Just under full scale, the mix and the stems alike.
    expect(await peakDb(exports.file(job.id, "Night drive.wav"))).toBeCloseTo(-0.3, 1);
    expect(await peakDb(exports.file(job.id, "Night drive - Insert 1.wav"))).toBeCloseTo(-0.3, 1);
    expect(await peakDb(exports.file(job.id, "Night drive.mp3"))).toBeLessThan(0);

    // Off: written as it is, so a 24-bit file clips at full scale.
    const asIs = await finished((await startLoud({ formats: ["wav"], wavBits: 24, preventClipping: false })).id);
    expect(asIs.gainDb).toBe(0);
    expect(await peakDb(exports.file(asIs.id, "Night drive.wav"))).toBeCloseTo(0, 1);
  });

  it("leaves a YT-L's ceiling alone when one finishes the song: only over full scale is turned down", async () => {
    // (The stand-in engine limits nothing: this checks what the export does with what it's given.)
    const limited = updateProL(setEffect(setMainVolume(updateMixerTrack(song(), MASTER_TRACK_ID, { volume: 1 }), 1), MASTER_TRACK_ID, 0, PRO_L_PLUGIN, "fx_lim"), "fx_lim", { dither: 16 });
    const job = await finished(
      (await exports.start({ projectId: PROJECT, song: limited, patternId: P, selection: null, settings: { ...DEFAULT_EXPORT_SETTINGS, mode: "pattern", formats: ["wav"], wavBits: 16, dither: true }, destination: null })).id,
    );
    expect(job.peakDb).toBeGreaterThan(3);
    // To full scale, not to −0.3 dB.
    expect(job.gainDb).toBeCloseTo(-job.peakDb!, 6);
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
