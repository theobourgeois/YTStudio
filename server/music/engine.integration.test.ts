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
import { routeChannels, setEffect, updateEffect } from "../../shared/music/mixer.ts";
import { FIRST_PATTERN_ID, createMusicProject as newSong } from "../../shared/music/project.ts";
import type { MusicProject } from "../../shared/music/types.ts";
import { DataPaths } from "../storage.ts";
import { AudioEngine } from "./engine.ts";
import { peakOf, readWav } from "./wav.ts";
import { fillMixerInserts } from "../../shared/music/mixer-setup.ts";

/** A new song at 120 BPM, which these tests' timings are worked out at (new songs start at 140). */
const createMusicProject = (name: string) => newSong(name, 120);

const SECOND = 48_000;
const built = existsSync(ENGINE) && ENGINE_PLUGIN_PATHS.every((dir) => existsSync(dir));

describe.skipIf(!built)("the audio engine, offline", () => {
  let dir: string;
  let engine: AudioEngine;
  let synthId: string;
  let effectId: string;

  beforeAll(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "engine-offline-"));
    // Only our own test synth: a scan of this computer's plugins would be slow and differ per machine.
    engine = new AudioEngine(new DataPaths(dir), { offline: true, onlyPluginPaths: true });
    ({ synth: synthId, effect: effectId } = await scanForTestPlugins(engine));
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

    // A key held (the Piano roll's keyboard): it sounds until it's let go.
    await engine.render(SECOND);
    await engine.command("preview", { channel: "chan_synth", key: 67, on: true });
    expect((await engine.render(SECOND)).peak).toBeGreaterThan(0.05);
    const held = path.join(dir, "held.wav");
    await engine.render(SECOND, held);
    expect(peakOf((await readWav(held)).channels[0], SECOND * 0.9)).toBeGreaterThan(0.05);
    await engine.command("preview", { channel: "chan_synth", key: 67, on: false });
    await engine.render(SECOND);
    expect((await engine.render(SECOND / 4)).peak).toBe(0);
    await expect(engine.command("preview", { channel: "chan_none", key: 60, on: true })).rejects.toMatchObject({ status: 409 });

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

  it("plays through Fill inserts' two buses at the same level, without doubling the Master signal", async () => {
    const projectId = "proj_0123456789ab";
    let song = addPluginChannel(createMusicProject("Bus setup"), { id: synthId, name: "Vaudio Test Synth", format: "VST3" }, "chan_bus_test");
    song = setSteps(song, FIRST_PATTERN_ID, "chan_bus_test", [0, 8], true);
    await engine.setSong({ projectId, song, patternId: null });
    await expect.poll(async () => (await engine.command("status", {})).channels.loaded.map((c) => c.channel)).toEqual(["chan_bus_test"]);
    await engine.command("play", {});
    const before = await engine.render(SECOND * 2);
    await engine.command("stop", {});
    const filled = fillMixerInserts(song, new Map([["chan_bus_test", "instr"]]));
    await engine.setSong({ projectId, song: filled, patternId: null });
    await engine.command("play", {});
    const after = await engine.render(SECOND * 2);
    await engine.command("stop", {});
    expect(before.peak).toBeGreaterThan(0.05);
    expect(after.peak).toBeCloseTo(before.peak, 3);
    // Short-note tails/oscillator phase can vary slightly between passes; a doubled path is 2×.
    expect(after.rms / before.rms).toBeGreaterThan(0.97);
    expect(after.rms / before.rms).toBeLessThan(1.03);
  });

  it("runs a mixer track's effects on its sound: in order, bypassed, mixed, their state kept beside the project", async () => {
    const project = "proj_0123456789ab";
    const gain = { id: effectId, name: "Vaudio Test Effect", format: "VST3" };
    let song = addPluginChannel(createMusicProject("Effects"), { id: synthId, name: "Vaudio Test Synth", format: "VST3" }, "chan_synth");
    song = routeChannels(song, ["chan_synth"], "insert_1");
    const withGain = setEffect(song, "insert_1", 0, gain, "fx_gain");
    /** The held note's level through the song as it is now (after it's settled). */
    const level = async (next: MusicProject) => {
      await engine.setSong({ projectId: project, song: next, patternId: null });
      await engine.render(SECOND / 4);
      return (await engine.render(SECOND / 4)).peak;
    };

    // The effect loads in the background, as an instrument does.
    const first = await engine.setSong({ projectId: project, song: withGain, patternId: null });
    expect([...first.effects.loading, ...first.effects.loaded.map((e) => e.effect)]).toEqual(["fx_gain"]);
    await expect.poll(async () => (await engine.command("status", {})).effects.loaded.map((e) => e.effect)).toEqual(["fx_gain"]);
    await expect.poll(async () => (await engine.command("status", {})).channels.loaded.map((c) => c.channel)).toEqual(["chan_synth"]);
    await engine.command("preview", { channel: "chan_synth", key: 69, on: true });

    // A half (the test effect's gain), nothing when bypassed, three quarters at half mix; two of them, a quarter.
    const dry = await level(updateEffect(withGain, "insert_1", 0, { enabled: false }));
    expect(dry).toBeGreaterThan(0.05);
    expect((await level(withGain)) / dry).toBeCloseTo(0.5, 2);
    expect((await level(updateEffect(withGain, "insert_1", 0, { mix: 0.5 }))) / dry).toBeCloseTo(0.75, 2);
    const two = setEffect(withGain, "insert_1", 4, gain, "fx_gain_2");
    await expect.poll(async () => (await engine.setSong({ projectId: project, song: two, patternId: null })).effects.loaded.length).toBe(2);
    expect((await level(two)) / dry).toBeCloseTo(0.25, 2);
    await engine.command("preview", { channel: "chan_synth", key: 69, on: false });

    // Its state is a file beside the project's, by the effect's id; its window opens by that id.
    await engine.saveStates();
    expect((await fs.stat(path.join(dir, "projects", project, "plugins", "fx_gain.bin"))).size).toBeGreaterThan(0);
    await expect(engine.command("effectEditor", { effect: "fx_none", open: true })).rejects.toMatchObject({ status: 409 });

    // Removed, it goes; an effect that isn't on this computer says so, and the rest plays.
    expect((await engine.setSong({ projectId: project, song, patternId: null })).effects).toEqual({ loaded: [], loading: [], failed: [] });
    const missing = setEffect(song, "insert_1", 0, { id: "VST3-Nothing-0-0", name: "Nothing", format: "VST3" }, "fx_none");
    expect((await engine.setSong({ projectId: project, song: missing, patternId: null })).effects.failed).toMatchObject([{ effect: "fx_none" }]);
    await engine.setSong({ projectId: project, song: createMusicProject("Empty"), patternId: null });
  });

  it("saves a plugin channel's settings as a preset of the user's, for every song, and loads and deletes it", async () => {
    const project = "proj_0123456789ab";
    const song = addPluginChannel(createMusicProject("Presets"), { id: synthId, name: "Vaudio Test Synth", format: "VST3" }, "chan_keys");
    await engine.setSong({ projectId: project, song, patternId: null });
    await expect.poll(async () => (await engine.command("status", {})).channels.loaded.map((c) => c.channel)).toEqual(["chan_keys"]);
    // The test synth has one program: none to choose, as most VST3s.
    expect(await engine.presets("channel", "chan_keys")).toEqual({ programs: [], program: -1, presets: [], preset: "", currentName: "", category: "" });
    expect(await engine.preset({ owner: "channel", id: "chan_keys", action: "savePreset", name: "Warm/Pad" })).toMatchObject({ presets: ["WarmPad"], preset: "WarmPad" });
    const file = path.join(dir, "engine", "presets", "VST3", "Vaudio Test Synth", "WarmPad.preset");
    expect((await fs.stat(file)).size).toBeGreaterThan(0);
    expect(await engine.preset({ owner: "channel", id: "chan_keys", action: "loadPreset", name: "WarmPad" })).toMatchObject({ preset: "WarmPad" });
    await expect(engine.preset({ owner: "channel", id: "chan_keys", action: "loadPreset", name: "Nothing" })).rejects.toMatchObject({ status: 409 });
    await expect(engine.preset({ owner: "channel", id: "chan_keys", action: "setProgram", index: 3 })).rejects.toMatchObject({ status: 409 });
    expect(await engine.preset({ owner: "channel", id: "chan_keys", action: "deletePreset", name: "WarmPad" })).toEqual({ programs: [], program: -1, presets: [], preset: "", currentName: "", category: "" });
    await expect(engine.presets("channel", "chan_none")).rejects.toMatchObject({ status: 409 });
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

/** Scan, wait for it, and answer with the test synth's id and the test effect's. */
async function scanForTestPlugins(engine: AudioEngine): Promise<{ synth: string; effect: string }> {
  await engine.command("scan", {});
  for (;;) {
    const status = await engine.command("status", {});
    if (!status.scanning) break;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  const plugins = await engine.plugins();
  expect(plugins.map((p) => p.name).sort()).toEqual(["Vaudio Test Effect", "Vaudio Test Synth"]);
  const synth = plugins.find((p) => p.name === "Vaudio Test Synth");
  const effect = plugins.find((p) => p.name === "Vaudio Test Effect");
  if (!synth || !effect) throw new Error("The test plugins weren't found: run `pnpm engine:build`.");
  expect(effect.isInstrument).toBe(false);
  return { synth: synth.id, effect: effect.id };
}
