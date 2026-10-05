import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { MediaAsset } from "../shared/types.ts";
import { FFMPEG, FFPROBE } from "./config.ts";
import { type ImageProbe, MediaLibrary, type MediaLibraryOptions } from "./media.ts";
import { PhotoHelper } from "./photo/helper.ts";
import { DataPaths } from "./storage.ts";

const ffmpegAvailable = spawnSync(FFMPEG, ["-version"]).status === 0 && spawnSync(FFPROBE, ["-version"]).status === 0;

const ffmpeg = (...args: string[]) => execFileSync(FFMPEG, ["-hide_banner", "-loglevel", "error", "-nostdin", "-y", ...args]);

/** The profile bytes don't matter to the store: it keeps them as they are. */
const ICC = Buffer.from("not really a profile, but bytes all the same").toString("base64");

describe.skipIf(!ffmpegAvailable)("MediaLibrary's images", () => {
  let tmp: string;
  let png: string;
  let png16: string;
  const libraries: MediaLibrary[] = [];

  /** A Library-style store (no projects) in a fresh folder, with these options. */
  async function store(options?: MediaLibraryOptions) {
    const paths = new DataPaths(await fs.mkdtemp(path.join(tmp, "data-")));
    await paths.init();
    const media = new MediaLibrary(paths, undefined, undefined, options);
    libraries.push(media);
    return { paths, media };
  }

  /** Import a copy of `file` (`add` moves what it's given). */
  async function importCopy(media: MediaLibrary, paths: DataPaths, file: string): Promise<MediaAsset> {
    const copy = paths.tmpFile(path.extname(file));
    await fs.copyFile(file, copy);
    return media.add(copy, path.basename(file), null, () => true);
  }

  beforeAll(() => {
    tmp = mkdtempSync(path.join(os.tmpdir(), "editor-media-"));
    png = path.join(tmp, "still.png");
    ffmpeg("-f", "lavfi", "-i", "testsrc2=size=64x48", "-frames:v", "1", png);
    png16 = path.join(tmp, "deep.png");
    ffmpeg("-f", "lavfi", "-i", "testsrc2=size=40x30", "-frames:v", "1", "-pix_fmt", "rgb48be", png16);
  });

  afterEach(() => {
    for (const media of libraries.splice(0)) media.shutdown();
    vi.restoreAllMocks();
  });

  afterAll(() => rmSync(tmp, { recursive: true, force: true }));

  it("imports a PNG with the image prober's reading, its upright size winning over ffprobe's", async () => {
    const reading: ImageProbe = { width: 48, height: 64, bits: 16, hasAlpha: true, orientation: 6, icc: ICC, format: "png" };
    const probeImage = vi.fn(async () => reading);
    const { paths, media } = await store({ probeImage });
    const asset = await importCopy(media, paths, png);
    expect(probeImage).toHaveBeenCalledTimes(1);
    expect(asset).toMatchObject({ kind: "image", width: 48, height: 64 });
    expect(asset.image).toEqual({ bits: 16, hasAlpha: true, orientation: 6, icc: ICC, format: "png" });
    // It's saved, and comes back on load.
    const again = new MediaLibrary(paths, undefined, undefined);
    libraries.push(again);
    await again.load();
    expect(again.get(asset.id).image).toEqual(asset.image);
  });

  it("probes only images", async () => {
    const audio = path.join(tmp, "tone.wav");
    ffmpeg("-f", "lavfi", "-i", "sine=frequency=440:duration=0.5", audio);
    const probeImage = vi.fn(async (): Promise<ImageProbe> => ({ width: 1, height: 1, bits: 8, hasAlpha: false, orientation: 1, icc: null, format: "png" }));
    const { paths, media } = await store({ probeImage });
    const asset = await importCopy(media, paths, audio);
    expect(probeImage).not.toHaveBeenCalled();
    expect(asset.image).toBeUndefined();
  });

  it("still imports an image with ffprobe's reading when the prober throws, and says so once", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { paths, media } = await store({ probeImage: async () => { throw new Error("no helper here"); } });
    const first = await importCopy(media, paths, png);
    const second = await importCopy(media, paths, png);
    for (const asset of [first, second]) {
      expect(asset).toMatchObject({ kind: "image", width: 64, height: 48, status: "ready" });
      expect(asset.image).toBeUndefined();
    }
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toContain("no helper here");
  });

  it("ignores a prober's answer that isn't an image's description", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const { paths, media } = await store({
      probeImage: async () => ({ width: 0, height: 10, bits: 8, hasAlpha: false, orientation: 1, icc: null, format: "png" }),
    });
    const asset = await importCopy(media, paths, png);
    expect(asset).toMatchObject({ width: 64, height: 48 });
    expect(asset.image).toBeUndefined();
  });

  it("drops a malformed image field from a saved asset, and keeps the asset", async () => {
    const { paths, media } = await store();
    const asset = await importCopy(media, paths, png);
    const meta = path.join(paths.media, asset.id, "meta.json");
    const malformed = [
      { bits: 12, hasAlpha: false, orientation: 1, icc: null, format: "png" },
      { bits: 8, hasAlpha: "yes", orientation: 1, icc: null, format: "png" },
      { bits: 8, hasAlpha: false, orientation: 9, icc: null, format: "png" },
      { bits: 8, hasAlpha: false, orientation: 1, icc: "not base64!", format: "png" },
      { bits: 8, hasAlpha: false, orientation: 1, icc: null, format: "../png" },
      { bits: 8, hasAlpha: false, orientation: 1, format: "png" },
      "png",
      null,
    ];
    for (const image of malformed) {
      await fs.writeFile(meta, JSON.stringify({ ...asset, image }));
      const loaded = new MediaLibrary(paths);
      libraries.push(loaded);
      await loaded.load();
      const back = loaded.get(asset.id);
      expect(back.image, JSON.stringify(image)).toBeUndefined();
      expect(back).toMatchObject({ id: asset.id, kind: "image", width: 64, height: 48 });
    }
  });

  it("keeps the image field on copies (into a project, or the Library)", async () => {
    const reading: ImageProbe = { width: 64, height: 48, bits: 8, hasAlpha: false, orientation: 1, icc: ICC, format: "png" };
    const { paths, media } = await store({ probeImage: async () => reading });
    const asset = await importCopy(media, paths, png);
    const other = new MediaLibrary(paths, { dir: path.join(paths.root, "other"), url: "/files/other" });
    libraries.push(other);
    const copy = await other.copyFrom(media, asset, { projectId: null });
    expect(copy.image).toEqual(asset.image);
  });

  it("imports a 16-bit PNG, without a prober", async () => {
    const { paths, media } = await store();
    const asset = await importCopy(media, paths, png16);
    expect(asset).toMatchObject({ kind: "image", width: 40, height: 30, status: "ready" });
    expect(asset.poster).toMatch(/poster\.png$/);
  });

  it("imports a 16-bit PNG read as 16 bits by the photo helper", async () => {
    const helper = new PhotoHelper(path.join(import.meta.dirname, "photo", "helper-process.mjs"));
    try {
      const { paths, media } = await store({ probeImage: (file) => helper.request<ImageProbe>("probe", { file }) });
      const asset = await importCopy(media, paths, png16);
      expect(asset).toMatchObject({ kind: "image", width: 40, height: 30 });
      expect(asset.image).toMatchObject({ bits: 16, hasAlpha: false, orientation: 1, format: "png" });
    } finally {
      helper.close();
    }
  });
});
