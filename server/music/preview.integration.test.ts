/**
 * The Browser's preview in the real engine, offline (`engine/src/FilePreview.cpp`): a file played outside
 * the song, from disk, at the device's rate. Skipped when the engine hasn't been built.
 */
import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { ENGINE } from "../config.ts";
import { DataPaths } from "../storage.ts";
import { AudioEngine } from "./engine.ts";
import { readWav, writeWav } from "./wav.ts";

const RATE = 48_000;

describe.skipIf(!existsSync(ENGINE))("the Browser's preview, offline", () => {
  let dir: string;
  let engine: AudioEngine;
  let out: string;

  /** A mono file holding `level` for each of `parts` seconds, at `rate`. */
  async function levels(name: string, rate: number, ...parts: [level: number, seconds: number][]): Promise<string> {
    const samples: number[] = [];
    for (const [level, seconds] of parts) for (let i = 0; i < Math.round(seconds * rate); i++) samples.push(level);
    const file = path.join(dir, name);
    await writeWav(file, samples, rate);
    return file;
  }

  /** The next `seconds` the engine makes, left channel. */
  async function render(seconds: number): Promise<Float32Array> {
    await engine.render(Math.round(seconds * RATE), out);
    return (await readWav(out)).channels[0];
  }

  /** Where the sound is (above a tenth of `level`): its first and last sample. */
  function extent(samples: Float32Array, level: number): [number, number] {
    let first = -1;
    let last = -1;
    for (let i = 0; i < samples.length; i++)
      if (Math.abs(samples[i]) > level / 10) {
        if (first < 0) first = i;
        last = i;
      }
    return [first, last];
  }

  const at = (samples: Float32Array, seconds: number) => samples[Math.round(seconds * RATE)];

  beforeAll(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "engine-preview-"));
    out = path.join(dir, "out.wav");
    engine = new AudioEngine(new DataPaths(dir), {
      offline: true,
      onlyPluginPaths: true,
      pluginPaths: [],
      samplePath: (_project, id) => (id === "steps" ? path.join(dir, "steps.wav") : null),
    });
  });
  afterAll(async () => {
    engine.shutdown();
    await fs.rm(dir, { recursive: true, force: true });
  });
  beforeEach(async () => {
    await engine.command("stopPreview", {});
    await engine.command("previewVolume", { volume: 1 });
    await render(0.05);
  });

  it("plays a song's own file as its channel sounds: its gains, its speed, whatever the Browser's volume", async () => {
    // A second at 0.2, then a second at 0.4.
    await levels("steps.wav", RATE, [0.2, 1], [0.4, 1]);
    await engine.command("previewVolume", { volume: 0.1 });
    await engine.previewSample({ projectId: "proj_0123456789ab", sampleId: "steps", id: "chan", gainLeft: 0.5, gainRight: 2, speed: 2 });
    const sound = await render(1.5);
    // Twice as fast: the second level half a second in, all of it over by one second.
    expect(at(sound, 0.25)).toBeCloseTo(0.1, 2);
    expect(at(sound, 0.75)).toBeCloseTo(0.2, 2);
    expect(extent(sound, 0.1)[1] / RATE).toBeCloseTo(1, 1);
    await expect(engine.previewSample({ projectId: "proj_0123456789ab", sampleId: "nope" })).rejects.toThrow(/song's media/);
  });

  it("plays a file once, at once, at its level, and says how far along it is", async () => {
    const file = await levels("half.wav", RATE, [0.5, 0.5]);
    const status = await engine.previewFile(file, 0, "one");
    expect(status.transport.preview).toMatchObject({ id: "one", seconds: 0, duration: 0.5 });

    const first = await render(0.25);
    expect(extent(first, 0.5)[0]).toBeLessThan(64);
    expect(at(first, 0.1)).toBeCloseTo(0.5, 3);
    expect((await engine.command("status", {})).transport.preview).toMatchObject({ id: "one", seconds: 0.25 });

    const rest = await render(0.5);
    // A quarter of a second was left of it.
    expect(extent(rest, 0.5)[1] / RATE).toBeCloseTo(0.25, 2);
    expect((await engine.command("status", {})).transport.preview).toBeNull();
  });

  it("plays a file of another rate at the device's, for as long as it lasts", async () => {
    const file = await levels("cd.wav", 44_100, [0.5, 1]);
    await engine.previewFile(file, 0, "cd");
    const samples = await render(1.5);
    const [first, last] = extent(samples, 0.5);
    expect(first).toBeLessThan(64);
    expect((last - first) / RATE).toBeCloseTo(1, 2);
    expect(at(samples, 0.5)).toBeCloseTo(0.5, 3);
  });

  it("starts from where it's asked", async () => {
    const file = await levels("halves.wav", RATE, [0.25, 0.5], [0.75, 0.5]);
    const status = await engine.previewFile(file, 0.5, "late");
    expect(status.transport.preview).toMatchObject({ seconds: 0.5 });
    const samples = await render(0.75);
    expect(at(samples, 0.1)).toBeCloseTo(0.75, 3);
    expect(extent(samples, 0.75)[1] / RATE).toBeCloseTo(0.5, 2);
  });

  it("streams a long file past what it decodes ahead", async () => {
    const file = await levels("long.wav", RATE, [0.5, 4], [0.25, 2]);
    await engine.previewFile(file, 0, "long");
    const samples = await render(5);
    expect(at(samples, 1)).toBeCloseTo(0.5, 3);
    expect(at(samples, 3.9)).toBeCloseTo(0.5, 3);
    expect(at(samples, 4.5)).toBeCloseTo(0.25, 3);
    expect((await engine.command("status", {})).transport.preview).toMatchObject({ id: "long", seconds: 5 });
  });

  it("cuts the last preview off for the next, quickly and without a click", async () => {
    const a = await levels("a.wav", RATE, [0.5, 2]);
    const b = await levels("b.wav", RATE, [-0.25, 2]);
    await engine.previewFile(a, 0, "a");
    await render(0.5);
    const status = await engine.previewFile(b, 0, "b");
    expect(status.transport.preview).toMatchObject({ id: "b" });
    const samples = await render(0.5);
    // A fades out over 256 samples while B fades in: no jump bigger than the fades' steps.
    for (let i = 1; i < 512; i++) expect(Math.abs(samples[i] - samples[i - 1])).toBeLessThan(0.01);
    expect(at(samples, 0.1)).toBeCloseTo(-0.25, 3);
  });

  it("stops, and follows its volume", async () => {
    const file = await levels("vol.wav", RATE, [0.5, 2]);
    await engine.previewFile(file, 0, "vol");
    await render(0.1);
    await engine.command("previewVolume", { volume: 0.5 });
    expect(at(await render(0.2), 0.1)).toBeCloseTo(0.25, 3);
    await engine.command("stopPreview", {});
    const samples = await render(0.2);
    expect(extent(samples, 0.25)[1]).toBeLessThan(256);
    expect((await engine.command("status", {})).transport.preview).toBeNull();
  });

  it("says when a file can't be played", async () => {
    const file = path.join(dir, "not-audio.wav");
    await fs.writeFile(file, "not a wav");
    await expect(engine.previewFile(file, 0, "bad")).rejects.toThrow(/can't be read as audio/);
  });
});
