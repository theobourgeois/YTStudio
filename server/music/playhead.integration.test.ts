/**
 * What hosted plugins are told about the song (the engine's playhead, `engine/src/PlayHead.h`): the real engine,
 * offline, with the test effect reporting what it hears from its host (VAUDIO_TEST_EFFECT_PLAYHEAD=report: the
 * tempo over 1000 on the left; on the right, where it is in the bar, 0..1, while playing, -0.5 when stopped).
 * Without a playhead, a plugin's synced LFOs and delays run at its own default tempo, out of time with the song.
 * Skipped when the engine hasn't been built.
 */
import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addChannels, setTimeSignature } from "../../shared/music/edits.ts";
import { routeChannels, setEffect } from "../../shared/music/mixer.ts";
import { createMusicProject } from "../../shared/music/project.ts";
import type { MusicProject } from "../../shared/music/types.ts";
import { ENGINE, ENGINE_PLUGIN_PATHS } from "../config.ts";
import { DataPaths } from "../storage.ts";
import { AudioEngine } from "./engine.ts";
import { readWav } from "./wav.ts";

const RATE = 48_000;
const PROJECT = "proj_0123456789ab";
const built = existsSync(ENGINE) && ENGINE_PLUGIN_PATHS.every((dir) => existsSync(dir));

describe.skipIf(!built)("the playhead plugins are given, offline", () => {
  let dir: string;
  let engine: AudioEngine;
  let effectId: string;
  let render = 0;

  beforeAll(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "playhead-"));
    engine = new AudioEngine(new DataPaths(dir), { offline: true, onlyPluginPaths: true, env: { VAUDIO_TEST_EFFECT_PLAYHEAD: "report" } });
    await engine.command("scan", {});
    while ((await engine.command("status", {})).scanning) await new Promise((resolve) => setTimeout(resolve, 50));
    effectId = (await engine.plugins()).find((p) => p.name === "Vaudio Test Effect")!.id;
  });
  afterAll(async () => {
    engine.shutdown();
    await fs.rm(dir, { recursive: true, force: true });
  });

  /** A song at `tempo` with the reporting effect on Insert 1 (a silent channel plays into it, so it's run). */
  const song = (tempo: number): MusicProject => {
    let s = addChannels(createMusicProject("Playhead", tempo), [{ id: "chan_quiet", name: "Quiet", sampleId: null }]);
    s = routeChannels(s, ["chan_quiet"], "insert_1");
    return setEffect(s, "insert_1", 0, { id: effectId, name: "Vaudio Test Effect", format: "VST3" }, "fx_report");
  };

  /** `seconds` of what the effect reports, its plugins loaded first; from the song's start when `play`. */
  async function report(s: MusicProject, play: boolean, seconds: number) {
    await engine.command("stop", {});
    await expect.poll(async () => (await engine.setSong({ projectId: PROJECT, song: s, patternId: null })).effects.loaded.length).toBe(1);
    await engine.render(RATE / 10);
    if (play) await engine.command("play", {});
    const file = path.join(dir, `render-${render++}.wav`);
    await engine.render(Math.round(seconds * RATE), file);
    const [left, right] = (await readWav(file)).channels;
    return { left, right };
  }

  it("tells a plugin the song's tempo, stopped and playing", async () => {
    const stopped = await report(song(150), false, 0.1);
    expect(stopped.left[stopped.left.length - 1]).toBeCloseTo(0.15, 4);
    expect(stopped.right[stopped.right.length - 1]).toBeCloseTo(-0.5, 4);
    const playing = await report(song(87), true, 0.1);
    expect(playing.left[playing.left.length - 1]).toBeCloseTo(0.087, 4);
  });

  it("tells it where the song is: a quarter of a 4/4 bar after one beat, a third of a 3/4 bar", async () => {
    // A beat at 150 BPM is 0.4 s; a block is about 10 ms, so the position is known to about 0.01 of a bar.
    const four = await report(song(150), true, 1);
    expect(four.right[0]).toBeCloseTo(0, 1);
    expect(four.right[Math.round(0.4 * RATE)]).toBeCloseTo(0.25, 1);
    expect(Math.abs(four.right[Math.round(0.4 * RATE)] - 0.25)).toBeLessThan(0.02);
    const three = await report(setTimeSignature(song(150), [3, 4]), true, 1);
    expect(Math.abs(three.right[Math.round(0.4 * RATE)] - 1 / 3)).toBeLessThan(0.02);
  });
});
