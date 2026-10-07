import { randomBytes } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { StemJob } from "../../shared/music/stems.ts";
import { heardFromJson, pickNotes } from "../../shared/music/transcribe.ts";
import type { MediaAsset } from "../../shared/types.ts";
import { HttpError } from "../storage.ts";
import { NoteHearing } from "./hearing.ts";
import { musicModels } from "./ml.ts";
import { StemSeparator, type StemOptions } from "./stems.ts";
import { readWav, writeWavChannels } from "./wav.ts";

let dir = "";
let song = "";

beforeAll(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "vaudio-stems-"));
  // Two seconds of a stereo chord: left and right differ, so a stem keeps its sides.
  const frames = 88_200;
  const left = Float32Array.from({ length: frames }, (_, i) => 0.3 * Math.sin((2 * Math.PI * 220 * i) / 44_100));
  const right = Float32Array.from({ length: frames }, (_, i) => 0.2 * Math.sin((2 * Math.PI * 330 * i) / 44_100));
  song = path.join(dir, "song.wav");
  await writeWavChannels(song, [left, right], 44_100);
});

afterAll(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

/** A separator with the stand-in model whose media is a folder: what it adopted, by origin. */
function separator(overrides: Partial<StemOptions> = {}) {
  const adopted = new Map<string, MediaAsset>();
  const media = path.join(dir, `media-${randomBytes(4).toString("hex")}`);
  const options: StemOptions = {
    worker: "unused.mjs",
    models: musicModels(path.join(dir, "models"), true),
    standIn: true,
    samplePath: (projectId, id) => (projectId === "proj" && id === "media_song" ? song : null),
    mediaName: () => "Song.wav",
    find: (_projectId, origin) => adopted.get(origin),
    adopt: async (projectId, file, name, origin) => {
      await fs.mkdir(media, { recursive: true });
      const target = path.join(media, `${name}.wav`);
      await fs.rename(file, target);
      const asset = { id: `media_${adopted.size}`, projectId, name: `${name}.wav`, src: target, origin } as unknown as MediaAsset;
      adopted.set(origin, asset);
      return asset;
    },
    tmpFile: (suffix) => path.join(dir, `${randomBytes(6).toString("hex")}${suffix}`),
    ...overrides,
  };
  return { stems: new StemSeparator(options), adopted };
}

async function finished(stems: StemSeparator, job: StemJob): Promise<StemJob> {
  for (;;) {
    const now = stems.get(job.id);
    if (now.state !== "running") return now;
    await new Promise((r) => setTimeout(r, 20));
  }
}

describe("Extract stems on the server", () => {
  it("makes each stem a file of the project's, named after the song, and they add up to it", async () => {
    const { stems } = separator();
    const job = await finished(stems, await stems.start({ projectId: "proj", sampleId: "media_song", stems: ["vocals", "other"] }));
    expect(job).toMatchObject({ state: "done", progress: 1, error: null });
    expect(Object.keys(job.media)).toEqual(["vocals", "other"]);
    expect(job.media.vocals!.name).toBe("Song - Vocals.wav");
    expect(job.media.other!.origin).toBe("stems:media_song:other=bass+drums+guitar+other+piano");
    const [a, b, original] = await Promise.all([readWav(job.media.vocals!.src), readWav(job.media.other!.src), readWav(song)]);
    expect(a.sampleRate).toBe(44_100);
    for (const ch of [0, 1])
      for (let i = 0; i < original.channels[ch].length; i += 997) expect(a.channels[ch][i] + b.channels[ch][i]).toBeCloseTo(original.channels[ch][i], 3);
  });

  it("reuses stems made the same way before, and makes only what's new", async () => {
    const { stems, adopted } = separator();
    await finished(stems, await stems.start({ projectId: "proj", sampleId: "media_song", stems: ["vocals", "drums"] }));
    const first = new Set(adopted.keys());
    const again = await finished(stems, await stems.start({ projectId: "proj", sampleId: "media_song", stems: ["vocals", "bass"] }));
    expect(again.state).toBe("done");
    expect(again.media.vocals).toBe(adopted.get([...first].find((o) => o.includes(":vocals="))!));
    expect(adopted.size).toBe(3);
  });

  it("refuses what it can't do, saying why", async () => {
    const { stems } = separator();
    await expect(stems.start({ projectId: "proj", sampleId: "media_song", stems: [] })).rejects.toMatchObject({ status: 400 });
    await expect(stems.start({ projectId: "proj", sampleId: "media_other", stems: ["bass"] })).rejects.toMatchObject({ status: 404 });
    // Without the stand-in, the model must be downloaded first.
    const real = separator({ standIn: false, models: musicModels(path.join(dir, "no-models"), false) }).stems;
    await expect(real.start({ projectId: "proj", sampleId: "media_song", stems: ["bass"] })).rejects.toMatchObject({ status: 409 });
    expect(() => stems.get("stems_nope")).toThrow(HttpError);
  });

  it("can be cancelled, leaving nothing behind", async () => {
    const { stems, adopted } = separator();
    const job = await stems.start({ projectId: "proj", sampleId: "media_song", stems: ["piano"] });
    expect(stems.cancel(job.id).state).toBe("cancelled");
    expect((await finished(stems, job)).state).toBe("cancelled");
    await new Promise((r) => setTimeout(r, 100));
    expect(adopted.size).toBe(0);
  });
});

describe("Convert to notes' hearing on the server", () => {
  it("hears the stand-in's melody and measures the drums, once a file", async () => {
    const hearing = new NoteHearing({
      worker: "unused.mjs",
      models: musicModels(path.join(dir, "models"), true),
      standIn: true,
      samplePath: (projectId, id) => (projectId === "proj" && id === "media_song" ? song : null),
      tmpFile: (suffix) => path.join(dir, `${randomBytes(6).toString("hex")}${suffix}`),
    });
    const json = await hearing.hear({ projectId: "proj", sampleId: "media_song" });
    const heard = heardFromJson(json);
    expect(heard.duration).toBeCloseTo(2, 2);
    expect(heard.drumFrames).toBeGreaterThan(160);
    const notes = pickNotes(heard, { onsetThreshold: 0.5, frameThreshold: 0.3, minFrames: 11, lowest: 21, highest: 108 });
    expect(notes.map((n) => n.pitch)).toEqual([60, 64, 67, 60]);
    // The same file is heard once.
    expect(await hearing.hear({ projectId: "proj", sampleId: "media_song" })).toBe(json);
    await expect(hearing.hear({ projectId: "proj", sampleId: "media_x" })).rejects.toMatchObject({ status: 404 });
  });
});
