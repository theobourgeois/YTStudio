/**
 * The real engine (`pnpm engine:build`), offline: no audio device, nothing is heard, and the sound it
 * would make is computed and measured instead. Skipped when the engine hasn't been built.
 *
 * This is where what a song *sounds like* gets tested: load, play, `render`, assert on the samples.
 */
import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ENGINE, ENGINE_PLUGIN_PATHS } from "../config.ts";
import { DataPaths } from "../storage.ts";
import { AudioEngine } from "./engine.ts";

const SECOND = 48_000;
const built = existsSync(ENGINE) && ENGINE_PLUGIN_PATHS.every((dir) => existsSync(dir));

describe.skipIf(!built)("the audio engine, offline", () => {
  let dir: string;
  let engine: AudioEngine;
  let synthId: string;

  beforeAll(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "engine-offline-"));
    // Only our own test synth: a scan of this computer's plugins would be slow and differ per machine.
    engine = new AudioEngine(new DataPaths(dir), { offline: true, onlyPluginPaths: true });
    synthId = await scanForTestSynth(engine);
  });
  afterAll(async () => {
    engine.shutdown();
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("has no device and is silent until something plays", async () => {
    const status = await engine.command("status", {});
    expect(status).toMatchObject({ offline: true, device: null, sampleRate: SECOND, dropouts: 0 });
    expect(await engine.render(SECOND)).toMatchObject({ frames: SECOND, peak: 0, rms: 0 });
  });

  it("renders the test tone at its level, the same every time", async () => {
    await engine.command("tone", { on: true });
    const first = await engine.render(SECOND);
    const second = await engine.render(SECOND);
    await engine.command("tone", { on: false });
    expect(first.peak).toBeCloseTo(0.15, 3);
    // A sine's RMS is its peak over √2.
    expect(first.rms).toBeCloseTo(0.15 / Math.SQRT2, 3);
    expect(second.rms).toBeCloseTo(first.rms, 4);
    expect((await engine.render(SECOND)).peak).toBe(0);
  });

  it("hosts a VST3 instrument: notes sound, and stop when released", async () => {
    const status = await engine.command("load", { slot: "instrument", pluginId: synthId });
    expect(status.instrument).toMatchObject({ name: "Vaudio Test Synth", format: "VST3", isInstrument: true });
    expect((await engine.render(SECOND / 10)).peak).toBe(0);

    await engine.command("note", { pitch: 60, on: true, velocity: 0.5 });
    const one = await engine.render(SECOND / 2);
    expect(one.peak).toBeGreaterThan(0.05);
    await engine.command("note", { pitch: 64, on: true, velocity: 0.5 });
    const two = await engine.render(SECOND / 2);
    expect(two.rms).toBeGreaterThan(one.rms * 1.2);

    await engine.command("note", { pitch: 60, on: false });
    await engine.command("note", { pitch: 64, on: false });
    await engine.render(SECOND);
    expect((await engine.render(SECOND / 10)).peak).toBe(0);
  });

  it("writes what it renders as a WAV", async () => {
    const file = path.join(dir, "out.wav");
    await engine.command("tone", { on: true });
    await engine.render(SECOND, file);
    await engine.command("tone", { on: false });
    const wav = await fs.readFile(file);
    expect(wav.subarray(0, 4).toString()).toBe("RIFF");
    // One second of 24-bit stereo, after the header.
    expect(wav.length).toBeGreaterThanOrEqual(SECOND * 2 * 3);
  });

  it("keeps a plugin's state across saving, unloading and restoring", async () => {
    await engine.command("load", { slot: "instrument", pluginId: synthId });
    expect((await engine.command("saveState", { slot: "instrument" })).instrument?.hasSavedState).toBe(true);
    await engine.command("unload", { slot: "instrument" });
    await expect(engine.command("restoreState", { slot: "instrument" })).rejects.toMatchObject({ status: 409 });
    await engine.command("load", { slot: "instrument", pluginId: synthId });
    expect((await engine.command("restoreState", { slot: "instrument" })).instrument?.hasSavedState).toBe(true);
  });
});

/** Scan, wait for it, and answer with the test synth's id. */
async function scanForTestSynth(engine: AudioEngine): Promise<string> {
  await engine.command("scan", {});
  for (;;) {
    const status = await engine.command("status", {});
    if (!status.scanning) break;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  const plugins = await engine.plugins();
  expect(plugins.map((p) => p.name)).toEqual(["Vaudio Test Synth"]);
  const [synth] = plugins;
  if (!synth) throw new Error("The test synth wasn't found: run `pnpm engine:build`.");
  return synth.id;
}
