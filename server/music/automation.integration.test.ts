/**
 * Automation, heard (`docs/fl-studio/automation.md`): the real engine, offline, playing songs whose
 * controls are automated with the app's own edits and compiler. A pad holds a steady half-scale level, so
 * what the automation does to it is what's measured. At 120 BPM and 48 kHz a bar is 96000 samples and a
 * tick 250. Skipped when the engine (or its test plugins) hasn't been built.
 */
import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createAutomation, editPoints } from "../../shared/music/automation.ts";
import { addChannels, setSteps } from "../../shared/music/edits.ts";
import { routeChannels, setEffect } from "../../shared/music/mixer.ts";
import { addClips, editClips } from "../../shared/music/playlist.ts";
import { DEFAULT_VOLUME, FIRST_PATTERN_ID, createMusicProject } from "../../shared/music/project.ts";
import type { AutomationPoint, AutomationTarget, MusicProject } from "../../shared/music/types.ts";
import { levelGain } from "../../shared/music/compile.ts";
import { ENGINE, ENGINE_PLUGIN_PATHS } from "../config.ts";
import { DataPaths } from "../storage.ts";
import { AudioEngine } from "./engine.ts";
import { type WavData, peakOf, readWav, writeWav } from "./wav.ts";

const RATE = 48_000;
const BAR = 96_000;
const TICKS = 384;
const P = FIRST_PATTERN_ID;
const PROJECT = "proj_0123456789ab";
const built = existsSync(ENGINE) && ENGINE_PLUGIN_PATHS.every((dir) => existsSync(dir));

const point = (tick: number, value: number, curve: AutomationPoint["curve"] = "single"): AutomationPoint => ({ tick, value, tension: 0, curve });

describe.skipIf(!built)("automation, offline", () => {
  let dir: string;
  let engine: AudioEngine;
  let effectId: string;
  let render = 0;

  beforeAll(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "automation-"));
    // Eight seconds (four bars) of a steady half-scale level.
    await writeWav(path.join(dir, "pad.wav"), new Float32Array(RATE * 8).fill(0.5), RATE);
    engine = new AudioEngine(new DataPaths(dir), {
      offline: true,
      onlyPluginPaths: true,
      samplePath: (_project, id) => (id === "pad" ? path.join(dir, "pad.wav") : null),
    });
    await engine.command("scan", {});
    while ((await engine.command("status", {})).scanning) await new Promise((resolve) => setTimeout(resolve, 50));
    effectId = (await engine.plugins()).find((p) => p.name === "Vaudio Test Effect")!.id;
  });
  afterAll(async () => {
    engine.shutdown();
    await fs.rm(dir, { recursive: true, force: true });
  });
  beforeEach(async () => {
    await engine.command("stop", {});
    await hear(RATE / 10);
  });

  /** The next `frames` samples, asked for `chunk` at a time (the engine's blocks are no longer than that). */
  async function hear(frames: number, chunk = frames): Promise<WavData> {
    const parts: WavData[] = [];
    for (let done = 0; done < frames; done += chunk) {
      const file = path.join(dir, `render-${render++}.wav`);
      await engine.render(Math.min(chunk, frames - done), file);
      parts.push(await readWav(file));
    }
    const join = (side: number) => {
      const all = new Float32Array(frames);
      let at = 0;
      for (const part of parts) {
        all.set(part.channels[side], at);
        at += part.channels[side].length;
      }
      return all;
    };
    return { sampleRate: RATE, channels: [join(0), join(1)] };
  }

  /** The pad, hit once at the start of a four-bar clip of its pattern (it rings all four bars), on insert 1. */
  function pad(): MusicProject {
    let song = addChannels(createMusicProject("Automated", 120), [{ id: "chan_pad", name: "Pad", sampleId: "pad" }]);
    song = setSteps(song, P, "chan_pad", [0], true);
    song = routeChannels(song, ["chan_pad"], "insert_1");
    return editClips(song, (clips) => addClips(clips, [{ kind: "pattern", ref: P, track: 0, start: 0, length: TICKS * 4 }]).clips);
  }
  /** `song` with `target` automated by a clip of `points` from `start` (ticks), `length` long. */
  function automate(song: MusicProject, target: AutomationTarget, start: number, length: number, points: AutomationPoint[]): MusicProject {
    const made = createAutomation(song, target, { start, length });
    return editPoints(made.song, made.automationId, () => points);
  }
  async function playSong(song: MusicProject) {
    const effects = song.mixer.tracks.flatMap((t) => t.effects.filter(Boolean)).length;
    await expect.poll(async () => (await engine.setSong({ projectId: PROJECT, song, patternId: P, mode: "song" })).effects.loaded.length).toBe(effects);
    await engine.command("play", {});
  }
  /** The level over a few ms around `at` samples. */
  const levelAt = (wav: WavData, at: number) => peakOf(wav.channels[0], Math.round(at) - 50, Math.round(at) + 50);

  it("turns a channel's volume along its curve, from its own value before the clip, and holds the last value after it", async () => {
    const volume: AutomationTarget = { kind: "channel", channel: "chan_pad", control: "volume" };
    await playSong(automate(pad(), volume, TICKS, TICKS, [point(0, 0), point(TICKS, 1)]));
    const sound = await hear(BAR * 3);
    // Its own 78%: the sample as it is.
    expect(levelAt(sound, BAR / 2)).toBeCloseTo(0.5, 3);
    // The clip: from silence, up its line, squared as the volume knob is.
    expect(levelAt(sound, BAR + 200)).toBeLessThan(0.01);
    for (const at of [0.25, 0.5, 0.75]) expect(levelAt(sound, BAR * (1 + at))).toBeCloseTo(0.5 * levelGain(at, DEFAULT_VOLUME), 2);
    // Held at the end's 100% after it.
    expect(levelAt(sound, BAR * 2.5)).toBeCloseTo(0.5 * levelGain(1, DEFAULT_VOLUME), 3);
  });

  it("keeps its place when the song changes as it plays (longer, here)", async () => {
    const volume: AutomationTarget = { kind: "channel", channel: "chan_pad", control: "volume" };
    // Two bars of song, the volume down to nothing in the second: it loops after it.
    let song = automate(pad(), volume, TICKS, TICKS, [point(0, 0), point(TICKS, 0)]);
    song = editClips(song, (clips) => clips.map((c) => (c.kind === "pattern" ? { ...c, length: TICKS * 2 } : c)));
    await playSong(song);
    await hear(BAR * 2.5);
    // Half a bar into its second time round, the song grows to four bars: it goes on from there.
    await engine.setSong({ projectId: PROJECT, song: editClips(song, (clips) => clips.map((c) => (c.kind === "pattern" ? { ...c, length: TICKS * 4 } : c))), patternId: P, mode: "song" });
    const after = await hear(BAR * 1.5);
    // Still in bar 0 for half a bar (its own value)...
    expect(levelAt(after, BAR / 4)).toBeGreaterThan(0.4);
    // ...then bar 1, silenced.
    expect(levelAt(after, BAR)).toBeLessThan(0.01);
  });

  it("plays nothing of it in pattern mode", async () => {
    const song = automate(pad(), { kind: "channel", channel: "chan_pad", control: "volume" }, 0, TICKS, [point(0, 0)]);
    await engine.setSong({ projectId: PROJECT, song, patternId: P, mode: "pattern" });
    await engine.command("play", {});
    expect(levelAt(await hear(BAR / 2), BAR / 4)).toBeCloseTo(0.5, 3);
  });

  it("sounds the same whatever the blocks it's played in, to the sample", async () => {
    let song = automate(pad(), { kind: "mixer", track: "insert_1", control: "volume" }, 0, TICKS * 2, [point(0, 0.2), point(TICKS / 2, 1, "stairs"), point(TICKS * 2, 0, "wave")]);
    song = automate(song, { kind: "channel", channel: "chan_pad", control: "pan" }, TICKS / 3, TICKS, [point(0, 0), point(TICKS, 1, "double")]);
    // Played once first: a new song's first block glides from the last song's gains, which isn't what's compared.
    await playSong(song);
    await hear(RATE / 10);
    await engine.command("stop", {});
    await hear(RATE / 10);
    await engine.command("play", {});
    const big = await hear(BAR * 2);
    await engine.command("stop", {});
    await hear(RATE / 10);
    await engine.command("play", {});
    // Blocks of 300: never on the slices' edges.
    const small = await hear(BAR * 2, 300);
    let worst = 0;
    for (let i = 0; i < BAR * 2; i++) worst = Math.max(worst, Math.abs(big.channels[0][i] - small.channels[0][i]), Math.abs(big.channels[1][i] - small.channels[1][i]));
    expect(worst).toBeLessThan(1e-6);
    // And the automation was heard: it isn't the pad's steady level.
    expect(peakOf(big.channels[0], 0, BAR / 8)).toBeLessThan(0.2);
  });

  it("drives a plugin's parameter, and gives the plugin its own value back when it stops", async () => {
    // The test effect is a gain (its Gain parameter, half by default): automated to full for a bar from bar 1.
    let song = setEffect(pad(), "insert_1", 0, { id: effectId, name: "Vaudio Test Effect", format: "VST3" }, "fx_gain");
    await playSong(song);
    await engine.command("stop", {});
    // Its parameter's id, as the app finds it: from the list the engine gives.
    const gain = (await engine.parameters("effect", "fx_gain")).find((p) => p.name === "Gain")!;
    song = automate(song, { kind: "plugin", owner: "effect", id: "fx_gain", param: gain.id, index: gain.index, name: "Gain" }, TICKS, TICKS, [point(0, 1), point(TICKS, 1)]);
    await playSong(song);
    const sound = await hear(BAR * 2.5);
    // Its own value (a half) before the clip, the clip's after.
    expect(levelAt(sound, BAR / 2)).toBeCloseTo(0.25, 3);
    expect(levelAt(sound, BAR * 1.5)).toBeCloseTo(0.5, 3);
    expect(levelAt(sound, BAR * 2.25)).toBeCloseTo(0.5, 3);
    const parameters = await engine.parameters("effect", "fx_gain");
    expect(parameters.find((p) => p.id === gain.id)).toMatchObject({ name: "Gain", value: 1 });

    // Stopped, it's its own again: what plays in pattern mode, and what's saved.
    await engine.command("stop", {});
    await hear(RATE / 10);
    expect((await engine.parameters("effect", "fx_gain")).find((p) => p.id === gain.id)).toMatchObject({ value: 0.5 });
    await engine.setSong({ projectId: PROJECT, song, patternId: P, mode: "pattern" });
    await engine.command("play", {});
    expect(levelAt(await hear(BAR / 2), BAR / 4)).toBeCloseTo(0.25, 3);
  });

  it("exports from the plugins' own values, even started while their automation plays", async () => {
    let song = setEffect(pad(), "insert_1", 0, { id: effectId, name: "Vaudio Test Effect", format: "VST3" }, "fx_gain");
    await playSong(song);
    await engine.command("stop", {});
    const gain = (await engine.parameters("effect", "fx_gain")).find((p) => p.name === "Gain")!;
    // Full gain over the second bar; the plugin's own is a half.
    song = automate(song, { kind: "plugin", owner: "effect", id: "fx_gain", param: gain.id, index: gain.index, name: "Gain" }, TICKS, TICKS, [point(0, 1), point(TICKS, 1)]);
    await playSong(song);
    await hear(BAR * 1.5);
    expect((await engine.parameters("effect", "fx_gain")).find((p) => p.id === gain.id)!.value).toBe(1);

    const folder = path.join(dir, "exported");
    const result = await engine.renderExport({ id: "exp_auto", projectId: PROJECT, song, patternId: P, mode: "song", loop: null, resampling: "sinc", folder, mix: true, stems: false, tail: "cut" });
    expect(result.state).toBe("done");
    const mix = await readWav(path.join(folder, "mix.wav"));
    // The first bar at the plugin's own half, the second at the clip's full gain.
    expect(levelAt(mix, BAR / 2)).toBeCloseTo(0.25, 3);
    expect(levelAt(mix, BAR * 1.5)).toBeCloseTo(0.5, 3);
    // And after it, the plugin is as it was.
    expect((await engine.parameters("effect", "fx_gain")).find((p) => p.id === gain.id)!.value).toBe(0.5);
  });
});
