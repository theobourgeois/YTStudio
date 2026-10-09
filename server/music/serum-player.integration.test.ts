/**
 * The Serum player's engine work on the real Serum 2 (`docs/serum/player.md`, step 1), offline and silent: an
 * effect knob linked to a host slot moves the sound when the slot is set, a new state under a held key doesn't
 * click, and a preset file dropped on a song's Serum (its window invisible) is loaded as Serum's browser loads it.
 * Skipped without the engine or Serum 2 (`/Library/Audio/Plug-Ins/VST3/Serum2.vst3`).
 */
import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addPluginChannel } from "../../shared/music/edits.ts";
import { createMusicProject } from "../../shared/music/project.ts";
import { ENGINE } from "../config.ts";
import { DataPaths } from "../storage.ts";
import { AudioEngine } from "./engine.ts";
import { decodeCbor } from "./serum/cbor.ts";
import { readXfer } from "./serum/container.ts";
import { type FxLinks, presetAsState, readPluginState } from "./serum/plugin-state.ts";
import { writeSerumPreset } from "./serum/preset.ts";
import { readWav } from "./wav.ts";

const RATE = 48_000;
const PROJECT = "proj_0123456789ab";
const CHANNEL = "chan_serum";
const VST3 = "/Library/Audio/Plug-Ins/VST3";
const available = process.platform === "darwin" && existsSync(ENGINE) && existsSync(path.join(VST3, "Serum2.vst3"));

function rms(samples: Float32Array, from = 0, to = samples.length): number {
  let sum = 0;
  for (let i = from; i < to; i++) sum += samples[i] * samples[i];
  return Math.sqrt(sum / Math.max(1, to - from));
}

function largestStep(samples: Float32Array): number {
  let largest = 0;
  for (let i = 1; i < samples.length; i++) largest = Math.max(largest, Math.abs(samples[i] - samples[i - 1]));
  return largest;
}

describe.skipIf(!available)("the Serum player's engine, on Serum 2", () => {
  let dir: string;
  let engine: AudioEngine;
  let init: Uint8Array;
  let render = 0;

  async function hear(frames: number): Promise<Float32Array> {
    const file = path.join(dir, `serum-${render++}.wav`);
    await engine.render(frames, file);
    return (await readWav(file)).channels[0];
  }
  /** A tenth of a second at a time until `done` (a swap answered: offline, only rendering moves it on), joined. */
  async function hearUntil(done: () => boolean): Promise<Float32Array> {
    const parts: Float32Array[] = [];
    for (let i = 0; i < 40 && !done(); i++) parts.push(await hear(RATE / 10));
    const all = new Float32Array(parts.reduce((n, part) => n + part.length, 0));
    parts.reduce((at, part) => (all.set(part, at), at + part.length), 0);
    return all;
  }
  async function swap(state: Uint8Array): Promise<Float32Array> {
    let answered = false;
    const swapped = engine.swapState(CHANNEL, state).finally(() => (answered = true));
    const heard = await hearUntil(() => answered);
    await swapped;
    return heard;
  }
  const hold = (on: boolean) => engine.command("preview", { channel: CHANNEL, key: 48, on, velocity: 0.8 });
  const controls = () => engine.parameters("channel", CHANNEL);
  const savedState = async () => {
    await engine.saveStates();
    return new Uint8Array(await fs.readFile(path.join(new DataPaths(dir).projectDir(PROJECT), "plugins", `${CHANNEL}.bin`)));
  };
  /** A preset spec as Serum's state, with `links`. */
  const stateOf = (spec: object, links: FxLinks = {}) => presetAsState(init, readXfer(writeSerumPreset({ name: "Probe", ...spec } as never)).settings, links);

  beforeAll(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "serum-player-"));
    engine = new AudioEngine(new DataPaths(dir), { offline: true, onlyPluginPaths: true, pluginPaths: [VST3] });
    await engine.command("scan", {});
    while ((await engine.command("status", {})).scanning) await new Promise((resolve) => setTimeout(resolve, 100));
    const serum = (await engine.plugins()).find((p) => p.name === "Serum 2");
    if (!serum) throw new Error(`Serum 2 wasn't found in ${VST3}.`);
    await engine.setSong({ projectId: PROJECT, song: addPluginChannel(createMusicProject("Serum", 120), { id: serum.id, name: serum.name, format: serum.format }, CHANNEL), patternId: null });
    for (let tries = 0; !(await engine.command("status", {})).channels.loaded.some((c) => c.channel === CHANNEL); tries++) {
      if (tries > 600) throw new Error("Serum 2 didn't load.");
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    // Serum's own init state: the template every state here is made from.
    init = await savedState();
  }, 120_000);
  afterAll(async () => {
    await hold(false).catch(() => {});
    engine?.shutdown();
    if (dir) await fs.rm(dir, { recursive: true, force: true });
  });

  it("names the macros from the preset, and a linked effect knob moves the sound when its slot is set", async () => {
    // A clean saw through a distortion whose Drive (its knob 2) is linked to the main rack's first slot.
    await swap(stateOf({ macros: { "1": { name: "GRIT", value: 0 } }, fx: { main: [{ effect: "distortion", wet: 100, drive: 0 }] } }, { 0: [{ fxID: 0, paramIndex: 2 }] }));
    const listed = await controls();
    expect(listed.some((c) => c.name === "GRIT")).toBe(true);
    const slot = listed.find((c) => c.name === "FX 1: Dist Drive");
    expect(slot, `the main rack's slots: ${listed.filter((c) => c.name.startsWith("FX ")).slice(0, 3).map((c) => c.name).join(", ")}`).toBeDefined();

    await hold(true);
    await hear(RATE / 4);
    const clean = await hear(RATE / 4);
    await engine.command("setParameter", { owner: "channel", ownerId: CHANNEL, param: slot!.id, value: 1 });
    await hear(RATE / 10);
    const driven = await hear(RATE / 4);
    await hold(false);
    // Driven hard, the saw is louder and squarer.
    expect(rms(driven)).toBeGreaterThan(rms(clean) * 1.3);
    // And it's Serum's own knob that moved: its state says so.
    const settings = decodeCbor(readXfer(readPluginState(await savedState()).component).settings) as { FXRack0: { FX: { FXDistortion: { plainParams: { kParamDrive: number } } }[] } };
    expect(settings.FXRack0.FX[0].FXDistortion.plainParams.kParamDrive).toBeGreaterThan(99);
  }, 60_000);

  it("takes a new state under a held key without a click, and the note sounds on", async () => {
    await swap(stateOf({ envelopes: { "1": { attack: 0, decay: 1000, sustain: 100, release: 300 } } }));
    await hold(true);
    await hear(RATE / 4);
    const before = await hear(RATE / 4);
    // The same saw, quieter: a change that needs a reload's worth of Serum (a whole new state).
    const during = await swap(stateOf({ envelopes: { "1": { attack: 0, decay: 1000, sustain: 100, release: 300 } }, oscillators: { A: { level: 40 } } }));
    const after = await hear(RATE / 4);
    await hold(false);
    const heard = new Float32Array(before.length + during.length);
    heard.set(before);
    heard.set(during, before.length);
    expect(largestStep(heard)).toBeLessThan(Math.max(largestStep(before), largestStep(after)) * 1.5 + 0.005);
    // Sounding again (not cut off, as a bare reload does), and quieter.
    expect(rms(after)).toBeGreaterThan(0.01);
    expect(rms(after)).toBeLessThan(rms(before));
  }, 60_000);

  it("loads a preset file dropped on the channel's Serum, its window invisible", async () => {
    const file = path.join(dir, "Dropped Probe.SerumPreset");
    await fs.writeFile(file, writeSerumPreset({ name: "Dropped Probe", macros: { "1": { name: "SPACE", value: 0 } } } as never));
    let answered = false;
    const dropped = engine.dropFiles(CHANNEL, [file]).finally(() => (answered = true));
    await hearUntil(() => answered);
    expect(await dropped).toMatchObject({ performed: true });
    const state = readPluginState(await savedState());
    expect(readXfer(state.controller!).meta.presetName).toBe("Dropped Probe");
    expect((await controls()).some((c) => c.name === "SPACE")).toBe(true);
  }, 60_000);
});
