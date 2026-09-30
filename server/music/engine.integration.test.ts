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
import { addPluginChannel, setSteps } from "../../shared/music/edits.ts";
import { FIRST_PATTERN_ID, createMusicProject } from "../../shared/music/project.ts";
import { DataPaths } from "../storage.ts";
import { AudioEngine } from "./engine.ts";
import { peakOf, readWav } from "./wav.ts";

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

  it("plays a plugin channel: the song's steps are its notes, each ending after its step", async () => {
    const project = "proj_0123456789ab";
    let song = addPluginChannel(createMusicProject("Synth"), { id: synthId, name: "Vaudio Test Synth", format: "VST3" }, "chan_synth");
    song = setSteps(song, FIRST_PATTERN_ID, "chan_synth", [0, 8], true);
    const first = await engine.setSong({ projectId: project, song, patternId: null });
    // It loads in the background; the song plays it once it has.
    expect([...first.channels.loading, ...first.channels.loaded.map((c) => c.channel)]).toEqual(["chan_synth"]);
    await expect.poll(async () => (await engine.command("status", {})).channels.loaded.map((c) => c.channel)).toEqual(["chan_synth"]);

    expect((await engine.render(SECOND / 4)).peak).toBe(0);
    await engine.command("play", {});
    const file = path.join(dir, "synth.wav");
    await engine.render(SECOND * 2, file);
    const left = (await readWav(file)).channels[0];
    // A note on the first and third beats of the bar (a beat is half a second), and quiet before each next one.
    for (const beat of [0, 2]) {
      const at = beat * (SECOND / 2);
      expect(peakOf(left, at, at + SECOND / 16)).toBeGreaterThan(0.05);
      expect(peakOf(left, at + SECOND * 0.45, at + SECOND * 0.5)).toBeLessThan(0.005);
    }
    expect(peakOf(left, SECOND * 0.75, SECOND)).toBeLessThan(0.005);
    await engine.command("stop", {});

    // Heard on its own, without the song playing.
    await engine.render(SECOND);
    await engine.command("trigger", { channel: "chan_synth" });
    expect((await engine.render(SECOND / 4)).peak).toBeGreaterThan(0.05);

    // Its state is kept beside the project, and the plugin goes when its channel does.
    await engine.saveStates();
    const state = path.join(dir, "projects", project, "plugins", "chan_synth.bin");
    expect((await fs.stat(state)).size).toBeGreaterThan(0);
    const gone = await engine.setSong({ projectId: project, song: createMusicProject("Empty"), patternId: null });
    expect(gone.channels).toEqual({ loaded: [], loading: [], failed: [] });
    await engine.render(SECOND);
    expect((await engine.render(SECOND / 4)).peak).toBe(0);

    // A plugin that isn't on this computer: the channel says so, and the rest of the song plays.
    const missing = addPluginChannel(createMusicProject("Missing"), { id: "VST3-Nothing-0-0", name: "Nothing", format: "VST3" }, "chan_none");
    expect((await engine.setSong({ projectId: project, song: missing, patternId: null })).channels.failed).toMatchObject([{ channel: "chan_none" }]);
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
