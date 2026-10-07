/**
 * Playback spreads the song's plugins and mixer tracks over several threads (`engine/src/Workers.h`), as
 * the export does: offline, the same song played by an engine on one thread and by one on four sounds the
 * same, sample for sample. Skipped when the engine hasn't been built.
 */
import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addPluginChannel, setChannelNotes } from "../../shared/music/edits.ts";
import { routeChannels, setEffect, setSend } from "../../shared/music/mixer.ts";
import { updateProC } from "../../shared/music/pro-c.ts";
import { PRO_C_PLUGIN } from "../../shared/music/pro-c-presets.ts";
import { PRO_Q_PLUGIN } from "../../shared/music/pro-q-presets.ts";
import { FIRST_PATTERN_ID, createMusicProject } from "../../shared/music/project.ts";
import type { MusicProject } from "../../shared/music/types.ts";
import { ENGINE, ENGINE_PLUGIN_PATHS } from "../config.ts";
import { DataPaths } from "../storage.ts";
import { AudioEngine } from "./engine.ts";
import { peakOf, readWav } from "./wav.ts";

const SECOND = 48_000;
const PROJECT = "proj_0123456789ab";
const P = FIRST_PATTERN_ID;
const built = existsSync(ENGINE) && ENGINE_PLUGIN_PATHS.every((dir) => existsSync(dir));

describe.skipIf(!built)("playback on several threads", () => {
  let dir: string;
  const engines: AudioEngine[] = [];

  beforeAll(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "playback-threads-"));
  });
  afterAll(async () => {
    for (const engine of engines) engine.shutdown();
    await fs.rm(dir, { recursive: true, force: true });
  });

  /** An offline engine playing on `threads`, with the test plugins scanned. */
  async function engineOn(threads: number) {
    const engine = new AudioEngine(new DataPaths(path.join(dir, `engine-${threads}`)), { offline: true, onlyPluginPaths: true, env: { VAUDIO_PLAYBACK_THREADS: String(threads) } });
    engines.push(engine);
    await engine.command("scan", {});
    while ((await engine.command("status", {})).scanning) await new Promise((resolve) => setTimeout(resolve, 50));
    return engine;
  }

  /** Two seconds of `song`, played from the start, as samples. */
  async function play(engine: AudioEngine, song: MusicProject, name: string) {
    await expect.poll(async () => (await engine.setSong({ projectId: PROJECT, song, patternId: P })).channels.loaded.length).toBe(4);
    await expect.poll(async () => (await engine.command("status", {})).effects.loading.length).toBe(0);
    await engine.command("play", {});
    const file = path.join(dir, `${name}.wav`);
    await engine.render(SECOND * 2, file);
    await engine.command("stop", {});
    return (await readWav(file)).channels;
  }

  it("sounds the same, sample for sample, as on one thread", async () => {
    const one = await engineOn(1);
    const four = await engineOn(4);
    const plugins = await one.plugins();
    const synth = plugins.find((p) => p.name === "Vaudio Test Synth")!;
    const effect = plugins.find((p) => p.name === "Vaudio Test Effect")!;
    // Four synths, each on its own track through the test effect and a Pro-Q (so a stage has several tracks
    // with effects to spread), two sending on to a bus with a Pro-C.
    let song = createMusicProject("Threads", 120);
    for (let i = 0; i < 4; i++) {
      song = addPluginChannel(song, { id: synth.id, name: synth.name, format: synth.format }, `chan_synth_${i}`);
      song = setChannelNotes(song, P, `chan_synth_${i}`, () => [
        { id: 1, start: i * 24, length: 200, pitch: 60 + i * 4, velocity: 0.8, pan: 0, muted: false },
        { id: 2, start: 192 + i * 12, length: 96, pitch: 55 + i * 3, velocity: 0.6, pan: 0, muted: false },
      ]);
      song = routeChannels(song, [`chan_synth_${i}`], `insert_${i + 1}`);
      song = setEffect(song, `insert_${i + 1}`, 0, { id: effect.id, name: effect.name, format: effect.format }, `fx_${i}`);
      song = setEffect(song, `insert_${i + 1}`, 1, PRO_Q_PLUGIN, `fx_eq_${i}`);
    }
    song = setSend(setSend(song, "insert_1", "insert_5", 0.5), "insert_2", "insert_5", 0.5);
    song = setEffect(song, "insert_5", 0, PRO_C_PLUGIN, "fx_comp");
    song = updateProC(song, "fx_comp", { style: "clean", threshold: -30, slope: 1, attack: 0.001, release: 0.05, autoGain: false });

    const alone = await play(one, song, "one");
    const spread = await play(four, song, "four");
    expect(peakOf(alone[0])).toBeGreaterThan(0.05);
    for (let ch = 0; ch < 2; ch++) expect(Buffer.from(spread[ch].buffer).equals(Buffer.from(alone[ch].buffer)), `channel ${ch}`).toBe(true);
  });
});
