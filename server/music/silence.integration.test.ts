/**
 * Stop pressed while stopped (FL Studio's): the effects' tails stop too. The real engine, offline, with
 * an EchoBoy on the master repeating a hit; a plain stop leaves its echoes ringing, a reset doesn't.
 * At 120 BPM and 48 kHz a beat is 24000 samples.
 */
import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { updateEchoBoy } from "../../shared/music/echo-boy.ts";
import { ECHO_BOY_PLUGIN } from "../../shared/music/echo-boy-presets.ts";
import { addChannels, setSteps } from "../../shared/music/edits.ts";
import { setEffect } from "../../shared/music/mixer.ts";
import { FIRST_PATTERN_ID, MASTER_TRACK_ID, createMusicProject } from "../../shared/music/project.ts";
import { ENGINE } from "../config.ts";
import { DataPaths } from "../storage.ts";
import { AudioEngine } from "./engine.ts";
import { peakOf, readWav, writeWav } from "./wav.ts";

const RATE = 48_000;
const BEAT = 24_000;
const PROJECT = "proj_0123456789ab";
const ECHO = "fx_echo";

describe.skipIf(!existsSync(ENGINE))("Stopping the effects' tails, offline", () => {
  let dir: string;
  let engine: AudioEngine;
  let render = 0;

  async function loudest(frames: number) {
    const file = path.join(dir, `render-${render++}.wav`);
    await engine.render(frames, file);
    const sound = await readWav(file);
    return Math.max(...sound.channels.map((side) => peakOf(side, 0, side.length)));
  }

  beforeAll(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "silence-"));
    await writeWav(path.join(dir, "hit.wav"), new Float32Array(480).fill(0.5), RATE);
    engine = new AudioEngine(new DataPaths(dir), {
      offline: true,
      onlyPluginPaths: true,
      pluginPaths: [],
      samplePath: (_project, id) => (id === "hit" ? path.join(dir, "hit.wav") : null),
    });
    // A hit, then an EchoBoy repeating it every eighth note for a long while.
    let song = addChannels(createMusicProject("Tails", 120), [{ id: "chan_hit", name: "Hit", sampleId: "hit" }]);
    song = setSteps(song, FIRST_PATTERN_ID, "chan_hit", [0], true);
    song = { ...song, patterns: song.patterns.map((p) => (p.id === FIRST_PATTERN_ID ? { ...p, length: 16 * 4 * 96 } : p)) };
    song = setEffect(song, MASTER_TRACK_ID, 0, ECHO_BOY_PLUGIN, ECHO);
    song = updateEchoBoy(song, ECHO, { style: "Digital Delay", mix: 0.5, feedback: 0.95, width: 0, echo1: { sync: "note", note: 8 } });
    await engine.setSong({ projectId: PROJECT, song, patternId: FIRST_PATTERN_ID, mode: "pattern" });
  });
  afterAll(async () => {
    engine.shutdown();
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("leaves the echoes ringing on a stop, and silences them on a stop with reset", async () => {
    await engine.command("play", {});
    await loudest(BEAT);
    await engine.command("stop", {});
    // Stopped, the echoes go on (as FL's do after one press of Stop).
    expect(await loudest(BEAT * 2)).toBeGreaterThan(0.05);
    await engine.command("stop", { reset: true });
    expect(await loudest(BEAT * 2)).toBe(0);
    // And it plays as before afterwards.
    await engine.command("play", {});
    expect(await loudest(BEAT)).toBeGreaterThan(0.4);
  });
});
