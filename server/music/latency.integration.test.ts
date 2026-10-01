/**
 * Plugin delay compensation, heard: the real engine, offline, with the test effect delaying its track's
 * sound (as a look-ahead plugin does) and saying so. Every path into a track waits for its latest one,
 * so everything lines up at the master, to the sample. Skipped when the engine hasn't been built.
 *
 * The kick is panned hard left and the clap hard right, so each side of the output is one of them.
 */
import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addChannels, setSteps, updateChannel } from "../../shared/music/edits.ts";
import { routeChannels, sendOnly, setEffect, setSend, updateEffect, updateMixerTrack } from "../../shared/music/mixer.ts";
import { FIRST_PATTERN_ID, createMusicProject as newSong } from "../../shared/music/project.ts";
import type { MusicProject } from "../../shared/music/types.ts";
import { ENGINE, ENGINE_PLUGIN_PATHS } from "../config.ts";
import { DataPaths } from "../storage.ts";
import { AudioEngine } from "./engine.ts";
import { type WavData, onsets, peakOf, readWav, writeWav } from "./wav.ts";

/** A new song at 120 BPM, which these tests' timings are worked out at (new songs start at 140). */
const createMusicProject = (name: string) => newSong(name, 120);

const RATE = 48_000;
const BEAT = 24_000;
const P = FIRST_PATTERN_ID;
const PROJECT = "proj_0123456789ab";
/** A hit: 10 ms of a steady half-scale level. */
const HIT = 480;
/** What the test effect delays its sound by: 20 ms. */
const DELAY = 960;

const built = existsSync(ENGINE) && ENGINE_PLUGIN_PATHS.every((dir) => existsSync(dir));

describe.skipIf(!built)("plugin delay compensation, offline", () => {
  let dir: string;
  let engine: AudioEngine;
  let effectId: string;
  let render = 0;

  beforeAll(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "latency-"));
    await writeWav(path.join(dir, "hit.wav"), new Float32Array(HIT).fill(0.5), RATE);
    engine = new AudioEngine(new DataPaths(dir), {
      offline: true,
      onlyPluginPaths: true,
      samplePath: (_project, id) => (id === "hit" ? path.join(dir, "hit.wav") : null),
      // Every test effect in this engine delays its sound (and says so); it also halves it.
      env: { VAUDIO_TEST_EFFECT_LATENCY: String(DELAY) },
    });
    await engine.command("scan", {});
    while ((await engine.command("status", {})).scanning) await new Promise((resolve) => setTimeout(resolve, 50));
    effectId = (await engine.plugins()).find((p) => p.name === "Vaudio Test Effect")!.id;
  });
  afterAll(async () => {
    engine.shutdown();
    await fs.rm(dir, { recursive: true, force: true });
  });

  /** Kick (left) on insert 1 and clap (right) on insert 2, each hitting the first step. */
  const drums = (): MusicProject => {
    let song = addChannels(createMusicProject("Late"), [
      { id: "chan_kick", name: "Kick", sampleId: "hit" },
      { id: "chan_clap", name: "Clap", sampleId: "hit" },
    ]);
    song = setSteps(setSteps(song, P, "chan_kick", [0], true), P, "chan_clap", [0], true);
    song = updateChannel(updateChannel(song, "chan_kick", { pan: -1 }), "chan_clap", { pan: 1 });
    return routeChannels(routeChannels(song, ["chan_kick"], "insert_1"), ["chan_clap"], "insert_2");
  };
  const late = { get id() {
    return effectId;
  }, name: "Vaudio Test Effect", format: "VST3" };

  /** The song played from its start, once its plugins have loaded: where each side's hits begin. */
  async function hear(song: MusicProject): Promise<{ kick: number[]; clap: number[]; wav: WavData }> {
    await engine.command("stop", {});
    const effects = song.mixer.tracks.flatMap((t) => t.effects.filter(Boolean)).length;
    await expect.poll(async () => (await engine.setSong({ projectId: PROJECT, song, patternId: null })).effects.loaded.length).toBe(effects);
    // Let what was sounding (and the delay lines) go quiet first.
    await engine.render(BEAT);
    await engine.command("play", {});
    const file = path.join(dir, `render-${render++}.wav`);
    await engine.render(BEAT, file);
    const wav = await readWav(file);
    return { kick: onsets(wav.channels[0]), clap: onsets(wav.channels[1]), wav };
  }

  it("lines a track behind a delaying effect up with the others: both come out as late as it", async () => {
    // Without compensation the kick would be DELAY late and the clap on time.
    const song = setEffect(drums(), "insert_1", 0, late, "fx_late");
    const heard = await hear(song);
    expect(heard).toMatchObject({ kick: [DELAY], clap: [DELAY] });
    expect(peakOf(heard.wav.channels[0])).toBeCloseTo(0.25, 3);
    const status = await engine.command("status", {});
    expect(status.songLatency).toBe(DELAY);
    expect(status.outputLatencyMs).toBeCloseTo(20, 3);

    // Bypassed, the effect delays nothing: neither waits.
    expect(await hear(updateEffect(song, "insert_1", 0, { enabled: false }))).toMatchObject({ kick: [0], clap: [0] });
    expect((await engine.command("status", {})).songLatency).toBe(0);
  });

  it("adds up delays along a chain of tracks, and lines a send up with the path round a delaying track", async () => {
    // Kick: insert 1 (late) → insert 3 (late) → master; clap straight to the master.
    let song = sendOnly(setEffect(drums(), "insert_1", 0, late, "fx_late"), "insert_1", "insert_3");
    song = setEffect(song, "insert_3", 0, late, "fx_late_2");
    expect(await hear(song)).toMatchObject({ kick: [2 * DELAY], clap: [2 * DELAY] });

    // The clap goes to the master directly and through insert 1 (late, and halved): its direct path waits, so it's one hit of both.
    let sent = setEffect(drums(), "insert_1", 0, late, "fx_late");
    sent = setSend(sent, "insert_2", "insert_1", 1);
    const heard = await hear(sent);
    expect(heard.clap).toEqual([DELAY]);
    expect(peakOf(heard.wav.channels[1])).toBeCloseTo(0.5 + 0.25, 3);
  });

  it("takes a track's manual offset as more delay (the others wait), or less (it waits)", async () => {
    // +20 ms on the kick's track: its plugins are later than they say, so the clap waits for it.
    expect(await hear(updateMixerTrack(drums(), "insert_1", { latencyOffset: 20 }))).toMatchObject({ kick: [0], clap: [DELAY] });
    // −20 ms: it's earlier than they say, so it waits for the clap.
    expect(await hear(updateMixerTrack(drums(), "insert_1", { latencyOffset: -20 }))).toMatchObject({ kick: [DELAY], clap: [0] });
  });
});
