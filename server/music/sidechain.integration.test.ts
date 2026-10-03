/**
 * Keys, heard (`docs/sidechain.md`): the real engine, offline, with the test effect listening to its
 * sidechain input (VAUDIO_TEST_EFFECT_SIDECHAIN=listen: what it puts out is its key, halved). A kick on
 * Insert 1, panned hard left, goes to the master; Insert 2 has the listening effect, keyed by Insert 1, and
 * puts its key out on both sides. So the right side is the key alone (the left the kick, 0.5, and the
 * key, 0.25), and where it starts says whether the key came on time, lined up with what the master hears. Skipped when the engine hasn't been built.
 */
import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addChannels, setSteps, updateChannel } from "../../shared/music/edits.ts";
import { routeChannels, setEffect, setMixerSolo, updateMixerTrack } from "../../shared/music/mixer.ts";
import { updateProC } from "../../shared/music/pro-c.ts";
import { PRO_C_PLUGIN } from "../../shared/music/pro-c-presets.ts";
import { addBand, editProQ } from "../../shared/music/pro-q.ts";
import { PRO_Q_PLUGIN } from "../../shared/music/pro-q-presets.ts";
import { FIRST_PATTERN_ID, createMusicProject } from "../../shared/music/project.ts";
import { setSidechain, setSidechainTap } from "../../shared/music/sidechain.ts";
import type { MusicProject, SidechainTap } from "../../shared/music/types.ts";
import { ENGINE, ENGINE_PLUGIN_PATHS } from "../config.ts";
import { DataPaths } from "../storage.ts";
import { AudioEngine } from "./engine.ts";
import { type WavData, onsets, peakOf, readWav, writeWav } from "./wav.ts";

const RATE = 48_000;
const BEAT = 24_000;
const P = FIRST_PATTERN_ID;
const PROJECT = "proj_0123456789ab";
/** A hit: 10 ms of a steady half-scale level. */
const HIT = 480;
/** Pro-C's lookahead on the kick, in samples (10 ms): a latency its key carries. */
const LOOK = 480;

const built = existsSync(ENGINE) && ENGINE_PLUGIN_PATHS.every((dir) => existsSync(dir));

describe.skipIf(!built)("keys, offline", () => {
  let dir: string;
  let engine: AudioEngine;
  let listenerId: string;
  let render = 0;

  beforeAll(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "sidechain-"));
    await writeWav(path.join(dir, "hit.wav"), new Float32Array(HIT).fill(0.5), RATE);
    // Two seconds of a 1 kHz sine at half scale (the bass), and a 100 ms burst (the kick) for Pro-Q's test.
    await writeWav(path.join(dir, "sine.wav"), Float32Array.from({ length: 2 * RATE }, (_, i) => 0.5 * Math.sin((2 * Math.PI * 1000 * i) / RATE)), RATE);
    await writeWav(path.join(dir, "burst.wav"), new Float32Array(RATE / 10).fill(0.5), RATE);
    engine = new AudioEngine(new DataPaths(dir), {
      offline: true,
      onlyPluginPaths: true,
      samplePath: (_project, id) => (["hit", "sine", "burst"].includes(id) ? path.join(dir, `${id}.wav`) : null),
      env: { VAUDIO_TEST_EFFECT_SIDECHAIN: "listen" },
    });
    await engine.command("scan", {});
    while ((await engine.command("status", {})).scanning) await new Promise((resolve) => setTimeout(resolve, 50));
    listenerId = (await engine.plugins()).find((p) => p.name === "Vaudio Test Effect")!.id;
  });
  afterAll(async () => {
    engine.shutdown();
    await fs.rm(dir, { recursive: true, force: true });
  });

  /**
   * The kick (left) on Insert 1, hitting the first step; a channel playing nothing on Insert 2 (so it's
   * run), which has the listening effect keyed by Insert 1 at `tap`.
   */
  const duck = (tap: SidechainTap = "postFx"): MusicProject => {
    let song = addChannels(createMusicProject("Duck", 120), [
      { id: "chan_kick", name: "Kick", sampleId: "hit" },
      { id: "chan_bass", name: "Bass", sampleId: "hit" },
    ]);
    song = updateChannel(setSteps(song, P, "chan_kick", [0], true), "chan_kick", { pan: -1 });
    song = routeChannels(routeChannels(song, ["chan_kick"], "insert_1"), ["chan_bass"], "insert_2");
    song = setEffect(song, "insert_2", 0, { id: listenerId, name: "Vaudio Test Effect", format: "VST3" }, "fx_listen");
    return setSidechain(song, "fx_listen", "insert_1", tap);
  };

  /** The song played from its start once its plugins have loaded: the kick's side and the key's (right). */
  async function hear(song: MusicProject): Promise<{ kick: number[]; key: number[]; wav: WavData }> {
    await engine.command("stop", {});
    const effects = song.mixer.tracks.flatMap((t) => t.effects.filter((e) => e && !e.plugin.id.startsWith("vaudio:"))).length;
    await expect.poll(async () => (await engine.setSong({ projectId: PROJECT, song, patternId: null })).effects.loaded.length).toBe(effects);
    await engine.render(BEAT);
    await engine.command("play", {});
    const file = path.join(dir, `render-${render++}.wav`);
    await engine.render(BEAT, file);
    const wav = await readWav(file);
    return { kick: onsets(wav.channels[0]), key: onsets(wav.channels[1]), wav };
  }

  it("gives a plugin's sidechain input the key, on time, with no send between the tracks", async () => {
    const song = duck();
    expect(song.mixer.tracks.find((t) => t.id === "insert_1")!.sends).toEqual([{ to: "master", level: 1 }]);
    const heard = await hear(song);
    expect(heard).toMatchObject({ kick: [0], key: [0] });
    // The listener halves what it hears: the kick's level after its pan (a hard-left half-scale hit).
    expect(peakOf(heard.wav.channels[1])).toBeCloseTo(0.25, 3);
    const status = await engine.command("status", {});
    expect(status.effects.loaded.find((e: { effect: string }) => e.effect === "fx_listen")?.sidechain).toBe(true);
  });

  it("hears nothing without a key", async () => {
    const heard = await hear(setSidechain(duck(), "fx_listen", null));
    expect(heard.key).toEqual([]);
  });

  it("takes the key before or after the fader as asked: a ghost kick still keys after its effects", async () => {
    const quiet = updateMixerTrack(duck(), "insert_1", { volume: 0.4 });
    // After its effects: the fader doesn't change the key.
    expect(peakOf((await hear(quiet)).wav.channels[1])).toBeCloseTo(0.25, 3);
    // After its fader: it does, (0.4 / 0.8)³.
    expect(peakOf((await hear(setSidechainTap(quiet, "fx_listen", "postFader"))).wav.channels[1])).toBeCloseTo(0.25 / 8, 3);
    // Muted (a ghost kick): still keys after its effects, and is silent after its fader.
    const ghost = updateMixerTrack(duck(), "insert_1", { muted: true });
    const heard = await hear(ghost);
    expect(peakOf(heard.wav.channels[0])).toBeCloseTo(0.25, 3);
    expect(heard.key).toEqual([0]);
    expect(await hear(setSidechainTap(ghost, "fx_listen", "postFader"))).toMatchObject({ kick: [], key: [] });
  });

  it("keeps keying while another track's solo silences the source, after its fader too", async () => {
    const soloed = setMixerSolo(setSidechainTap(duck(), "fx_listen", "postFader"), ["insert_2"], true);
    const heard = await hear(soloed);
    // The kick isn't heard (only the key's copy is, on the left too), but it keys.
    expect(peakOf(heard.wav.channels[0])).toBeCloseTo(0.25, 3);
    expect(heard.key).toEqual([0]);
    expect(peakOf(heard.wav.channels[1])).toBeCloseTo(0.25, 3);
  });

  it("lines a key up with the sound when its source is late (a lookahead on the kick): the keyed track waits", async () => {
    // Pro-C looking 10 ms ahead (changing nothing else) makes the kick 10 ms late: the key after it is too.
    let song = setEffect(duck(), "insert_1", 0, PRO_C_PLUGIN, "fx_look");
    song = updateProC(song, "fx_look", { style: "clean", threshold: 0, slope: 0, maxLookahead: LOOK / RATE, lookahead: LOOK / RATE, autoGain: false });
    for (const tap of ["postFx", "postFader"] as const) expect(await hear(setSidechainTap(song, "fx_listen", tap))).toMatchObject({ kick: [LOOK], key: [LOOK] });
    // Before its effects, the key isn't late: it waits in its delay line instead, and still lands with the kick.
    expect(await hear(setSidechainTap(song, "fx_listen", "preFx"))).toMatchObject({ kick: [LOOK], key: [LOOK] });
    expect((await engine.command("status", {})).songLatency).toBe(LOOK);
  });

  it("ducks a Pro-Q's dynamic band on the key (External Side Chain), and not without it", async () => {
    // The sine on Insert 2 through a Pro-Q bell at 1 kHz (range -12 dB from a -40 dB threshold); the burst on Insert 1 (sending nowhere) keys it.
    const make = (external: boolean) => {
      let song = addChannels(createMusicProject("Dynamic", 120), [
        { id: "chan_kick", name: "Kick", sampleId: "burst" },
        { id: "chan_bass", name: "Bass", sampleId: "sine" },
      ]);
      // The kick on the third step (a quarter of a second in), the sine from the start.
      song = setSteps(setSteps(song, P, "chan_kick", [2], true), P, "chan_bass", [0], true);
      song = routeChannels(routeChannels(song, ["chan_kick"], "insert_1"), ["chan_bass"], "insert_2");
      song = { ...song, mixer: { ...song.mixer, tracks: song.mixer.tracks.map((t) => (t.id === "insert_1" ? { ...t, sends: [] } : t)) } };
      song = setEffect(song, "insert_2", 0, PRO_Q_PLUGIN, "fx_eq");
      song = editProQ(song, "fx_eq", (pq) => addBand(pq, { shape: "bell", frequency: 1000, gain: 0, q: 1, range: -12, dynamics: true, threshold: -40, ...(external && { external: true }) })!.proQ);
      return setSidechain(song, "fx_eq", "insert_1");
    };
    const rms = (wav: WavData, from: number, to: number) => {
      let sum = 0;
      for (let i = Math.round(from * RATE); i < Math.round(to * RATE); i++) sum += wav.channels[1][i] ** 2;
      return 10 * Math.log10(sum / ((to - from) * RATE));
    };
    const keyed = (await hear(make(true))).wav;
    const before = rms(keyed, 0.15, 0.24);
    // The burst (from 0.25 s to 0.35 s) pulls the band down by most of its range, then it lets go.
    expect(rms(keyed, 0.28, 0.34) - before).toBeLessThan(-8);
    expect(before).toBeGreaterThan(-12);
    // Not external: the sine itself (louder than the threshold) holds it down all along, whatever the key does.
    const own = (await hear(make(false))).wav;
    expect(Math.abs(rms(own, 0.28, 0.34) - rms(own, 0.15, 0.24))).toBeLessThan(1);
  });
});
