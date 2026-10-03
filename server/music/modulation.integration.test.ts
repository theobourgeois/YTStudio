/**
 * Modulators, heard (`docs/sidechain.md`): the real engine, offline. A sine (the bass) plays on Insert 2;
 * a burst (the kick) on Insert 1 sends nowhere, so what's heard is the bass alone, moved by a modulator
 * following the kick: its fader, a plugin's parameter, from the kick's sound or its notes (muted). Skipped
 * when the engine hasn't been built.
 */
import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addChannels, setSteps, updateChannel } from "../../shared/music/edits.ts";
import { routeChannels, setEffect } from "../../shared/music/mixer.ts";
import { addModulator, linkControl, updateModulator } from "../../shared/music/modulation.ts";
import { FIRST_PATTERN_ID, createMusicProject } from "../../shared/music/project.ts";
import type { ModulatorSource, MusicProject } from "../../shared/music/types.ts";
import { ENGINE, ENGINE_PLUGIN_PATHS } from "../config.ts";
import { DataPaths } from "../storage.ts";
import { AudioEngine } from "./engine.ts";
import { type WavData, readWav, writeWav } from "./wav.ts";

const RATE = 48_000;
const P = FIRST_PATTERN_ID;
const PROJECT = "proj_0123456789ab";

const built = existsSync(ENGINE) && ENGINE_PLUGIN_PATHS.every((dir) => existsSync(dir));

describe.skipIf(!built)("modulators, offline", () => {
  let dir: string;
  let engine: AudioEngine;
  let effectId: string;
  let render = 0;

  beforeAll(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "modulation-"));
    await writeWav(path.join(dir, "sine.wav"), Float32Array.from({ length: 2 * RATE }, (_, i) => 0.5 * Math.sin((2 * Math.PI * 500 * i) / RATE)), RATE);
    await writeWav(path.join(dir, "burst.wav"), new Float32Array(RATE / 10).fill(0.5), RATE);
    engine = new AudioEngine(new DataPaths(dir), {
      offline: true,
      onlyPluginPaths: true,
      samplePath: (_project, id) => (["sine", "burst"].includes(id) ? path.join(dir, `${id}.wav`) : null),
    });
    await engine.command("scan", {});
    while ((await engine.command("status", {})).scanning) await new Promise((resolve) => setTimeout(resolve, 50));
    effectId = (await engine.plugins()).find((p) => p.name === "Vaudio Test Effect")!.id;
  });
  afterAll(async () => {
    engine.shutdown();
    await fs.rm(dir, { recursive: true, force: true });
  });

  /** The bass from the start on Insert 2; the kick on the third step (0.25 s at 120 BPM) on Insert 1, sending nowhere; a modulator following `source`. */
  const pump = (source: ModulatorSource = { kind: "track", track: "insert_1", tap: "postFx" }): MusicProject => {
    let song = addChannels(createMusicProject("Pump", 120), [
      { id: "chan_kick", name: "Kick", sampleId: "burst" },
      { id: "chan_bass", name: "Bass", sampleId: "sine" },
    ]);
    song = setSteps(setSteps(song, P, "chan_kick", [2], true), P, "chan_bass", [0], true);
    song = routeChannels(routeChannels(song, ["chan_kick"], "insert_1"), ["chan_bass"], "insert_2");
    song = { ...song, mixer: { ...song.mixer, tracks: song.mixer.tracks.map((t) => (t.id === "insert_1" ? { ...t, sends: [] } : t)) } };
    // +6 dB: the half-scale burst (or a note's 0.78) reaches full level.
    return updateModulator(addModulator(song, source, "mod_kick")!, "mod_kick", { attack: 0.001, release: 0.05, gain: 6 });
  };

  /** The song played from its start (its plugins loaded), `seconds` of it, rendered `chunk` samples at a time. */
  async function hear(song: MusicProject, seconds = 0.6, chunk = 0): Promise<WavData> {
    await engine.command("stop", {});
    const plugins = song.mixer.tracks.flatMap((t) => t.effects.filter((e) => e && !e.plugin.id.startsWith("vaudio:"))).length;
    await expect.poll(async () => (await engine.setSong({ projectId: PROJECT, song, patternId: null })).effects.loaded.length).toBe(plugins);
    // Long enough for any follower to settle from what was heard before.
    await engine.render(RATE);
    await engine.command("play", {});
    const frames = Math.round(seconds * RATE);
    if (!chunk) {
      const file = path.join(dir, `render-${render++}.wav`);
      await engine.render(frames, file);
      return readWav(file);
    }
    const parts: WavData[] = [];
    for (let done = 0; done < frames; done += chunk) {
      const file = path.join(dir, `render-${render++}.wav`);
      await engine.render(Math.min(chunk, frames - done), file);
      parts.push(await readWav(file));
    }
    const join = (ch: number) => Float32Array.from(parts.flatMap((p) => [...p.channels[ch]]));
    return { ...parts[0], channels: [join(0), join(1)] };
  }
  /** The level (dB, RMS) of the left side over `[from, to)` seconds. */
  const rms = (wav: WavData, from: number, to: number) => {
    let sum = 0;
    for (let i = Math.round(from * RATE); i < Math.round(to * RATE); i++) sum += wav.channels[0][i] ** 2;
    return 10 * Math.log10(sum / ((to - from) * RATE) + 1e-20);
  };

  it("ducks a fader under the kick's sound, and lets it go", async () => {
    // The fader at 0.8, −0.8 at full level: down to nothing while the kick sounds.
    const song = linkControl(pump(), "mod_kick", { kind: "mixer", track: "insert_2", control: "volume" }, -0.8);
    const sound = await hear(song);
    const before = rms(sound, 0.1, 0.24);
    expect(before).toBeGreaterThan(-12);
    expect(rms(sound, 0.27, 0.34) - before).toBeLessThan(-40);
    // 50 ms of release after the kick ends (0.35 s): back.
    expect(rms(sound, 0.5, 0.58) - before).toBeGreaterThan(-1);
    // The tab hears its level.
    expect((await engine.command("status", {})).transport?.modulators?.mod_kick).toBeGreaterThanOrEqual(0);
  });

  it("follows a channel's notes, the channel muted: the duck without the kick's sound", async () => {
    let song = linkControl(pump({ kind: "notes", channel: "chan_kick" }), "mod_kick", { kind: "mixer", track: "insert_2", control: "volume" }, -0.8);
    song = updateChannel(song, "chan_kick", { muted: true });
    const sound = await hear(song, 0.8);
    const before = rms(sound, 0.1, 0.24);
    // The note is a step long (125 ms): ducked from 0.25 s, back after it ends (its gate 1.56 over full level falls for a while).
    expect(rms(sound, 0.27, 0.36) - before).toBeLessThan(-40);
    expect(rms(sound, 0.7, 0.78) - before).toBeGreaterThan(-1);
  });

  it("moves a plugin's parameter from its own value", async () => {
    // The test effect's Gain (its own 0.5), −0.5 at full level: silent while the kick sounds.
    let song = setEffect(pump(), "insert_2", 0, { id: effectId, name: "Vaudio Test Effect", format: "VST3" }, "fx_gain");
    await hear(song, 0.1);
    const gain = (await engine.parameters("effect", "fx_gain")).find((p) => p.name === "Gain")!;
    song = linkControl(song, "mod_kick", { kind: "plugin", owner: "effect", id: "fx_gain", param: gain.id, index: gain.index, name: "Gain" }, -0.5);
    const sound = await hear(song);
    const before = rms(sound, 0.1, 0.24);
    expect(rms(sound, 0.27, 0.34) - before).toBeLessThan(-30);
    expect(rms(sound, 0.5, 0.58) - before).toBeGreaterThan(-1);
  });

  it("sounds the same whatever the blocks it's rendered in", async () => {
    const song = linkControl(pump(), "mod_kick", { kind: "mixer", track: "insert_2", control: "volume" }, -0.5);
    const whole = await hear(song, 0.5);
    const pieces = await hear(song, 0.5, 300);
    let worst = 0;
    for (let i = 0; i < whole.channels[0].length; i++) worst = Math.max(worst, Math.abs(whole.channels[0][i] - pieces.channels[0][i]));
    expect(worst).toBeLessThan(1e-6);
  });
});
