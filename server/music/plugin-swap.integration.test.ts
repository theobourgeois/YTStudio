/**
 * What the Serum player needs of the engine (`docs/serum/player.md`, step 1), heard on the test synth, offline: a
 * parameter set from the app, and a new state given while a key is held (a swap: faded out, loaded while nothing
 * plays the plugin, the note played again, faded in), with no click. Skipped when the engine (or its test plugins)
 * hasn't been built.
 */
import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { addPluginChannel } from "../../shared/music/edits.ts";
import { createMusicProject } from "../../shared/music/project.ts";
import { ENGINE, ENGINE_PLUGIN_PATHS } from "../config.ts";
import { DataPaths } from "../storage.ts";
import { AudioEngine } from "./engine.ts";
import { readWav } from "./wav.ts";

const RATE = 48_000;
const PROJECT = "proj_0123456789ab";
const CHANNEL = "chan_synth";
const built = existsSync(ENGINE) && ENGINE_PLUGIN_PATHS.every((dir) => existsSync(dir));

/** The largest step between two samples in a row: a sine this quiet and low never steps more than a few hundredths. */
function largestStep(samples: Float32Array): number {
  let largest = 0;
  for (let i = 1; i < samples.length; i++) largest = Math.max(largest, Math.abs(samples[i] - samples[i - 1]));
  return largest;
}

function rms(samples: Float32Array, from = 0, to = samples.length): number {
  let sum = 0;
  for (let i = from; i < to; i++) sum += samples[i] * samples[i];
  return Math.sqrt(sum / Math.max(1, to - from));
}

describe.skipIf(!built)("plugin swaps and parameters, offline", () => {
  let dir: string;
  let engine: AudioEngine;
  let render = 0;

  async function hear(frames: number): Promise<Float32Array> {
    const file = path.join(dir, `swap-${render++}.wav`);
    await engine.render(frames, file);
    return (await readWav(file)).channels[0];
  }
  /** A tenth of a second at a time until `done` (a swap answered: offline, only rendering moves it on), joined. */
  async function hearUntil(done: () => boolean): Promise<Float32Array> {
    const parts: Float32Array[] = [];
    for (let i = 0; i < 20 && !done(); i++) parts.push(await hear(RATE / 10));
    const all = new Float32Array(parts.reduce((n, part) => n + part.length, 0));
    parts.reduce((at, part) => (all.set(part, at), at + part.length), 0);
    return all;
  }
  const brightness = async () => (await engine.parameters("channel", CHANNEL)).find((p) => p.name === "Brightness")!;
  const setBrightness = async (value: number) => engine.command("setParameter", { owner: "channel", ownerId: CHANNEL, param: (await brightness()).id, value });
  const hold = (on: boolean) => engine.command("preview", { channel: CHANNEL, key: 60, on, velocity: 0.8 });

  beforeAll(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "plugin-swap-"));
    engine = new AudioEngine(new DataPaths(dir), { offline: true, onlyPluginPaths: true });
    await engine.command("scan", {});
    while ((await engine.command("status", {})).scanning) await new Promise((resolve) => setTimeout(resolve, 50));
    const found = (await engine.plugins()).find((p) => p.name === "Vaudio Test Synth");
    if (!found) throw new Error("The test synth wasn't found: run `pnpm engine:build`.");
    await engine.setSong({ projectId: PROJECT, song: addPluginChannel(createMusicProject("Swap", 120), { id: found.id, name: found.name, format: found.format }, CHANNEL), patternId: null });
    for (let tries = 0; !(await engine.command("status", {})).channels.loaded.some((c) => c.channel === CHANNEL); tries++) {
      if (tries > 200) throw new Error("The test synth didn't load.");
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  });
  afterAll(async () => {
    engine.shutdown();
    await fs.rm(dir, { recursive: true, force: true });
  });
  beforeEach(async () => {
    await hold(false);
    await setBrightness(0);
    await hear(RATE / 2);
  });

  it("sets a parameter from the app, and the plugin sounds it", async () => {
    await hold(true);
    const dark = await hear(RATE / 4);
    await setBrightness(1);
    expect(await brightness()).toMatchObject({ value: 1 });
    const bright = await hear(RATE / 4);
    // Brightness adds harmonics: louder for the same note.
    expect(rms(bright, RATE / 8)).toBeGreaterThan(rms(dark, RATE / 8) * 1.1);
    await expect(engine.command("setParameter", { owner: "channel", ownerId: CHANNEL, param: "nothing", value: 1 })).rejects.toThrow(/no parameter "nothing"/);
  });

  it("gives the plugin a new state under a held key: faded out, loaded, the note played again, faded in", async () => {
    // A state with Brightness up, then the plugin set back down.
    await setBrightness(1);
    await engine.saveStates();
    const state = await fs.readFile(path.join(new DataPaths(dir).projectDir(PROJECT), "plugins", `${CHANNEL}.bin`));
    await setBrightness(0);

    await hold(true);
    const before = await hear(RATE / 4);
    let answered = false;
    const swapped = engine.swapState(CHANNEL, state).then(() => (answered = true));
    // Rendering is what lets the swap happen offline: the plugin fades out over a block, and is loaded after it.
    const during = await hearUntil(() => answered);
    await swapped;
    const after = await hear(RATE / 4);

    expect(await brightness()).toMatchObject({ value: 1 });
    const heard = new Float32Array(before.length + during.length + after.length);
    heard.set(before);
    heard.set(during, before.length);
    heard.set(after, before.length + during.length);
    // No click: across the swap, no step is steeper than the steady note's own, before (dark) or after (bright).
    expect(largestStep(heard)).toBeLessThan(Math.max(largestStep(before), largestStep(after)) * 1.2 + 0.002);
    // It went quiet (the fade, then the load), and the note sounds again after, brighter.
    let quietest = Infinity;
    for (let at = 0; at + 64 <= during.length; at += 64) quietest = Math.min(quietest, rms(during, at, at + 64));
    expect(quietest).toBeLessThan(0.01);
    expect(rms(after)).toBeGreaterThan(rms(before) * 1.1);
  });

  it("says why a plugin won't take dropped files, and plays on", async () => {
    await hold(true);
    await hear(RATE / 8);
    // The test synth's window is JUCE's own: nothing in it takes files.
    let answered = false;
    const dropped = engine.dropFiles(CHANNEL, [path.join(dir, "nothing.fxp")]).then(
      () => null,
      (error: Error) => error,
    );
    void dropped.finally(() => (answered = true));
    const during = await hearUntil(() => answered);
    expect((await dropped)?.message).toMatch(/No view in the window takes drops|macOS's only/);
    const after = await hear(RATE / 4);
    expect(rms(after)).toBeGreaterThan(0.05);
    expect(largestStep(during)).toBeLessThan(0.05);
  });
});
