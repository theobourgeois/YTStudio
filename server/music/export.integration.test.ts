/**
 * The export, in the real engine, offline: a song rendered once to 32-bit float WAVs on the engine's
 * own thread (`engine/src/Export.cpp`), checked to the sample. Its length, the tail, the plugins' delay
 * trimmed, stems lined up with the mix, plugins told they're rendering offline, and playback set aside
 * meanwhile. At 120 BPM and 48 kHz a beat is 24000 samples and a bar 96000. Skipped when the engine
 * hasn't been built.
 */
import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addChannels, addPluginChannel, setChannelNotes, setSteps, updateChannel } from "../../shared/music/edits.ts";
import { bounceRender, placeBounced } from "../../shared/music/consolidate.ts";
import { routeChannels, setEffect, setSend, updateMixerTrack } from "../../shared/music/mixer.ts";
import { updateProC } from "../../shared/music/pro-c.ts";
import { PRO_C_PLUGIN } from "../../shared/music/pro-c-presets.ts";
import { setSidechain } from "../../shared/music/sidechain.ts";
import { addAudioClips, addClips, editClips } from "../../shared/music/playlist.ts";
import { createAutomation, editPoints, updateAutomation } from "../../shared/music/automation.ts";
import { FIRST_PATTERN_ID, createMusicProject as newSong } from "../../shared/music/project.ts";
import type { MusicProject } from "../../shared/music/types.ts";
import { ENGINE, ENGINE_PLUGIN_PATHS } from "../config.ts";
import { DataPaths } from "../storage.ts";
import { AudioEngine, type RenderExportRequest } from "./engine.ts";
import { type WavData, onsets, peakOf, readWav, writeWav } from "./wav.ts";
import { wrapTail } from "./wrap.ts";

const createMusicProject = (name: string) => newSong(name, 120);

const RATE = 48_000;
const BEAT = 24_000;
const BAR = 96_000;
const BAR_TICKS = 384;
const P = FIRST_PATTERN_ID;
const PROJECT = "proj_0123456789ab";
const HIT = 480;
/** What the test effect delays its sound by: 20 ms. */
const DELAY = 960;

const built = existsSync(ENGINE) && ENGINE_PLUGIN_PATHS.every((dir) => existsSync(dir));

describe.skipIf(!built)("the export, offline", () => {
  let dir: string;
  let engine: AudioEngine;
  let effectId: string;
  let exports = 0;

  beforeAll(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "export-"));
    await writeWav(path.join(dir, "hit.wav"), new Float32Array(HIT).fill(0.5), RATE);
    await writeWav(path.join(dir, "long.wav"), new Float32Array(RATE * 2).fill(0.5), RATE);
    engine = new AudioEngine(new DataPaths(dir), {
      offline: true,
      onlyPluginPaths: true,
      samplePath: (_project, id) => (id === "hit" || id === "long" || id === "bounced" ? path.join(dir, `${id}.wav`) : null),
      // The test effect delays its sound 20 ms (and says so), and while rendering offline it leaves the sound whole.
      env: { VAUDIO_TEST_EFFECT_LATENCY: String(DELAY), VAUDIO_TEST_EFFECT_OFFLINE: "full" },
    });
    await engine.command("scan", {});
    while ((await engine.command("status", {})).scanning) await new Promise((resolve) => setTimeout(resolve, 50));
    effectId = (await engine.plugins()).find((p) => p.name === "Vaudio Test Effect")!.id;
  });
  afterAll(async () => {
    engine.shutdown();
    await fs.rm(dir, { recursive: true, force: true });
  });

  /** Export `song`: what it wrote, read back, by file id ("mix", or a track's id). */
  async function exportSong(song: MusicProject, options: Partial<RenderExportRequest> = {}, onProgress?: (done: number, frames: number) => void) {
    const folder = path.join(dir, `export-${exports++}`);
    const request: RenderExportRequest = { id: `exp_${exports}`, projectId: PROJECT, song, patternId: P, mode: "pattern", loop: null, resampling: "sinc", folder, mix: true, stems: false, tail: "cut", ...options };
    const result = await engine.renderExport(request, onProgress);
    const files: Record<string, WavData> = {};
    if (result.state === "done") for (const file of result.files) files[file.id] = await readWav(file.file);
    return { result, files, folder };
  }
  const kicks = (steps: number[]) => setSteps(addChannels(createMusicProject("Test"), [{ id: "chan_kick", name: "Kick", sampleId: "hit" }]), P, "chan_kick", steps, true);
  /** Waits for every plugin of the song to have loaded (as the app does before it's heard). */
  async function loaded(song: MusicProject) {
    // (Ours aren't plugins: they're always ready.)
    const effects = song.mixer.tracks.flatMap((t) => t.effects.filter((e) => e && !e.proC)).length;
    await expect.poll(async () => (await engine.setSong({ projectId: PROJECT, song, patternId: P })).effects.loaded.length).toBe(effects);
  }

  it("writes the song once, exactly as long as it is, each hit on its sample, in 32-bit float", async () => {
    const progress: number[] = [];
    const { result, files } = await exportSong(kicks([0, 4, 8, 12]), {}, (done) => progress.push(done));
    expect(result).toMatchObject({ state: "done", frames: BAR, sampleRate: RATE, latency: 0, missing: [] });
    const mix = files.mix;
    expect(mix.channels[0].length).toBe(BAR);
    expect(onsets(mix.channels[0])).toEqual([0, BEAT, 2 * BEAT, 3 * BEAT]);
    // Float: the sample's level exactly.
    expect(mix.channels[0][10]).toBe(0.5);
    expect(peakOf(mix.channels[0], HIT, BEAT)).toBe(0);
  });

  it("cuts at the end, or rings out until it's quiet; either way the song isn't played again", async () => {
    // The kick on the first beat, and a two-second sound starting on the last beat: it rings 1.75 s past the bar.
    const song = setSteps(addChannels(kicks([0]), [{ id: "chan_long", name: "Long", sampleId: "long" }]), P, "chan_long", [12], true);
    const cut = await exportSong(song);
    expect(cut.files.mix.channels[0].length).toBe(BAR);
    expect(onsets(cut.files.mix.channels[0])).toEqual([0, 3 * BEAT]);

    const ringing = await exportSong(song, { tail: "ring" });
    const length = ringing.files.mix.channels[0].length;
    const end = 3 * BEAT + 2 * RATE;
    // It went on until the sound ended, then half a second of quiet (counted in whole blocks of 2048).
    expect(length).toBeGreaterThanOrEqual(end + RATE / 2);
    expect(length).toBeLessThan(end + RATE / 2 + 2 * 2048);
    // The long sound plays to its end, and the kick doesn't come round again on the next bar.
    expect(peakOf(ringing.files.mix.channels[0], end - 10, end)).toBeCloseTo(0.5, 3);
    expect(onsets(ringing.files.mix.channels[0])).toEqual([0, 3 * BEAT]);
    expect(peakOf(ringing.files.mix.channels[0], end, length)).toBe(0);

    // A tail stops at its longest, however much is still ringing.
    const short = await exportSong(song, { tail: "ring", maxTail: 0.5 });
    expect(short.files.mix.channels[0].length).toBeGreaterThanOrEqual(BAR + RATE / 2);
    expect(short.files.mix.channels[0].length).toBeLessThan(BAR + RATE / 2 + 2048);
  });

  it("wraps what rings past the end onto the start (Wrap remainder): a loop that plays round seamlessly", async () => {
    // Two seconds of sample from the bar's last step: it rings 1.75 s past the end.
    const song = setSteps(addChannels(createMusicProject("Test"), [{ id: "chan_pad", name: "Pad", sampleId: "long" }]), P, "chan_pad", [15], true);
    const { result } = await exportSong(song, { tail: "ring" });
    expect(result.state === "done" && result.frames).toBeGreaterThan(BAR);
    const mix = result.state === "done" ? result.files[0].file : "";
    await wrapTail(mix, BAR);
    const left = (await readWav(mix)).channels[0];
    expect(left.length).toBe(BAR);
    // The tail from the start: the last step's two seconds go round, filling the bar's first 1.875 s (to a
    // sample: a sampler stops a sample short of its file's end), so the loop is one even sound, nowhere doubled.
    expect(left[0]).toBeCloseTo(0.5, 3);
    expect(left[BAR - 6010]).toBeCloseTo(0.5, 3);
    expect(left[BAR - 1]).toBeCloseTo(0.5, 3);
    expect(peakOf(left)).toBeLessThan(0.5001);
  });

  it("trims the plugins' delay, lines each stem up with the mix to the sample, and renders plugins in their offline mode", async () => {
    // Kick (left) on insert 1, through the delaying effect; clap (right) on insert 2, straight.
    let song = addChannels(kicks([0, 8]), [{ id: "chan_clap", name: "Clap", sampleId: "hit" }]);
    song = setSteps(song, P, "chan_clap", [4, 12], true);
    song = updateChannel(updateChannel(song, "chan_kick", { pan: -1 }), "chan_clap", { pan: 1 });
    song = routeChannels(routeChannels(song, ["chan_kick"], "insert_1"), ["chan_clap"], "insert_2");
    song = setEffect(song, "insert_1", 0, { id: effectId, name: "Vaudio Test Effect", format: "VST3" }, "fx_late");
    await loaded(song);

    const { result, files } = await exportSong(song, { stems: true });
    expect(result).toMatchObject({ state: "done", latency: DELAY, frames: BAR });
    // Every hit on its step, though the kick's track is 20 ms late: the delay is trimmed off.
    expect(onsets(files.mix.channels[0])).toEqual([0, 2 * BEAT]);
    expect(onsets(files.mix.channels[1])).toEqual([BEAT, 3 * BEAT]);
    // Played live the effect halves the kick; told it's rendering offline, it leaves it whole.
    expect(peakOf(files.mix.channels[0])).toBeCloseTo(0.5, 5);
    // A stem for each track that sounds (not the master: that's the mix), each in time with it.
    expect(Object.keys(files).sort()).toEqual(["insert_1", "insert_2", "mix"]);
    expect(onsets(files.insert_1.channels[0])).toEqual([0, 2 * BEAT]);
    expect(onsets(files.insert_2.channels[1])).toEqual([BEAT, 3 * BEAT]);
    // The stems add up to the mix, sample for sample.
    let worst = 0;
    for (let ch = 0; ch < 2; ch++)
      for (let i = 0; i < BAR; i++) worst = Math.max(worst, Math.abs(files.insert_1.channels[ch][i] + files.insert_2.channels[ch][i] - files.mix.channels[ch][i]));
    expect(worst).toBeLessThan(1e-6);
  });

  it("consolidates a track before its mixer track's effects: played back into it, the song sounds the same, sample for sample", async () => {
    // Kick (and a long sound) into insert 1, through the delaying effect, turned down, panned and sending to insert 2.
    let song = setSteps(addChannels(kicks([0, 8]), [{ id: "chan_long", name: "Long", sampleId: "long" }]), P, "chan_long", [12], true);
    song = routeChannels(song, ["chan_kick", "chan_long"], "insert_1");
    song = setEffect(song, "insert_1", 0, { id: effectId, name: "Vaudio Test Effect", format: "VST3" }, "fx_late");
    song = setSend(updateMixerTrack(song, "insert_1", { volume: 0.5, pan: -0.5 }), "insert_1", "insert_2", 0.7);
    song = editClips(song, (clips) => addClips(clips, [{ kind: "pattern", ref: P, start: BAR_TICKS, track: 0 }]).clips);
    await loaded(song);
    const before = await exportSong(song, { mode: "song", tail: "ring" });

    const clip = song.playlist.clips[0];
    const plan = bounceRender(song, [clip])!;
    const bounce = await exportSong(plan.song, { mode: "song", patternId: null, loop: { start: plan.start, end: plan.end }, mix: false, stems: true, tail: "ring" });
    expect(Object.keys(bounce.files)).toEqual(["bounce_1"]);
    const stem = bounce.files.bounce_1;
    // Before the effect and the fader: the kick whole and on its beat.
    expect(onsets(stem.channels[0])).toEqual([0, 2 * BEAT, 3 * BEAT]);
    expect(peakOf(stem.channels[0], 0, HIT)).toBeCloseTo(0.5, 5);
    // It becomes the song's media as the engine wrote it (32-bit float).
    await fs.copyFile(path.join(bounce.folder, "bounce_1.wav"), path.join(dir, "bounced.wav"));

    const seconds = stem.channels[0].length / RATE;
    const consolidated = placeBounced(song, new Set([clip.id]), [{ into: plan.stems[0].into, sampleId: "bounced", seconds, name: "Kick (consolidated)" }], "cons_1").song;
    expect(consolidated.playlist.clips.map((c) => c.kind)).toEqual(["audio"]);
    const after = await exportSong(consolidated, { mode: "song", tail: "ring" });
    const length = Math.min(before.files.mix.channels[0].length, after.files.mix.channels[0].length);
    expect(length).toBeGreaterThan(2 * BAR);
    let worst = 0;
    for (let ch = 0; ch < 2; ch++) for (let i = 0; i < length; i++) worst = Math.max(worst, Math.abs(after.files.mix.channels[ch][i] - before.files.mix.channels[ch][i]));
    expect(worst).toBeLessThan(1e-5);
  });

  it("runs the plugins on every core and sounds the same, sample for sample, as on one", async () => {
    // Four test synths, each on its own track through the test effect, two of them sending on to a third track.
    const synth = (await engine.plugins()).find((p) => p.name === "Vaudio Test Synth")!;
    let song = kicks([0, 8]);
    for (let i = 0; i < 4; i++) {
      song = addPluginChannel(song, { id: synth.id, name: synth.name, format: synth.format }, `chan_synth_${i}`);
      song = setChannelNotes(song, P, `chan_synth_${i}`, () => [{ id: 1, start: i * 24, length: 200, pitch: 60 + i * 4, velocity: 0.8, pan: 0, muted: false }]);
      song = routeChannels(song, [`chan_synth_${i}`], `insert_${i + 1}`);
      song = setEffect(song, `insert_${i + 1}`, 0, { id: effectId, name: "Vaudio Test Effect", format: "VST3" }, `fx_${i}`);
    }
    song = setSend(setSend(song, "insert_1", "insert_5", 0.5), "insert_2", "insert_5", 0.5);
    // And keys: a Pro-C on the bus ducking to Insert 3 (before its effects), Insert 4's effect keyed by Insert 1.
    song = setEffect(song, "insert_5", 1, PRO_C_PLUGIN, "fx_duck");
    song = updateProC(song, "fx_duck", { style: "clean", threshold: -30, slope: 1, attack: 0.001, release: 0.05, autoGain: false });
    song = setSidechain(setSidechain(song, "fx_duck", "insert_3", "preFx"), "fx_3", "insert_1");
    await expect.poll(async () => (await engine.setSong({ projectId: PROJECT, song, patternId: P })).channels.loaded.length).toBe(4);
    await loaded(song);
    const one = await exportSong(song, { threads: 1, stems: true, tail: "ring" });
    const all = await exportSong(song, { stems: true, tail: "ring" });
    expect(Object.keys(all.files).sort()).toEqual(Object.keys(one.files).sort());
    for (const id of Object.keys(one.files))
      for (let ch = 0; ch < 2; ch++) expect(Buffer.from(all.files[id].channels[ch].buffer).equals(Buffer.from(one.files[id].channels[ch].buffer)), `${id} ${ch}`).toBe(true);
    expect(peakOf(one.files.mix.channels[0])).toBeGreaterThan(0.1);
  });

  it("exports the playlist in song mode, to the end of its last clip's bar, or only its time selection", async () => {
    let song = editClips(kicks([0]), (clips) => addClips(clips, [{ kind: "pattern", ref: P, start: 0, track: 0 }, { kind: "pattern", ref: P, start: 2 * BAR_TICKS, track: 0 }]).clips);
    song = addAudioClips(song, [{ name: "Long", sampleId: "long", seconds: 2, channelId: "chan_long" }], { start: BAR_TICKS, track: 1 }).song;
    const whole = await exportSong(song, { mode: "song" });
    expect(whole.files.mix.channels[0].length).toBe(3 * BAR);
    // The kick in bars 1 and 3, the audio clip from bar 2 (two seconds: to the start of bar 3).
    expect(onsets(whole.files.mix.channels[0])).toEqual([0, BAR]);
    expect(peakOf(whole.files.mix.channels[0], BAR, 2 * BAR - 64)).toBeCloseTo(0.5, 3);
    expect(peakOf(whole.files.mix.channels[0], 2 * BAR, 2 * BAR + HIT)).toBeCloseTo(0.5, 3);

    const part = await exportSong(song, { mode: "song", loop: { start: 2 * BAR_TICKS, end: 3 * BAR_TICKS } });
    expect(part.files.mix.channels[0].length).toBe(BAR);
    expect(onsets(part.files.mix.channels[0])).toEqual([0]);
  });

  it("refuses to play while it exports, plays the song sent meanwhile once it's done, and stops when aborted, leaving no files", async () => {
    // A long song (a clip 990 bars in, 33 minutes), to have time to try things while it renders.
    const long = editClips(kicks([0]), (clips) => addClips(clips, [{ kind: "pattern", ref: P, start: 990 * BAR_TICKS, track: 0 }]).clips);
    /** Resolves on its first progress, or fails if it was done before saying any. */
    const watch = (start: (onProgress: () => void) => Promise<unknown>) => {
      let started!: () => void;
      const rendering = new Promise<void>((resolve) => (started = resolve));
      const ended = start(() => started());
      return { ended, rendering: Promise.race([rendering, ended.then(() => Promise.reject(new Error("It was done before it could be watched.")))]) };
    };
    const first = watch((onProgress) => exportSong(long, { mode: "song", stems: true }, onProgress));
    const exported = first.ended as ReturnType<typeof exportSong>;
    await first.rendering;
    await expect(engine.command("play", {})).rejects.toThrow(/exported/);
    expect((await engine.command("status", {})).exporting).toMatchObject({ frames: 991 * BAR });
    // Sent while it renders: played once it's done.
    await engine.setSong({ projectId: PROJECT, song: kicks([4]), patternId: P });
    const { result } = await exported;
    expect(result.state).toBe("done");
    expect((await engine.command("status", {})).exporting).toBeNull();
    await engine.command("play", {});
    const file = path.join(dir, "after.wav");
    await engine.render(BAR, file);
    expect(onsets((await readWav(file)).channels[0])).toEqual([BEAT]);
    await engine.command("stop", {});

    // Aborted: it stops, and what it wrote is gone.
    const second = watch((onProgress) => exportSong(long, { mode: "song", id: "exp_abort", stems: true }, onProgress));
    await second.rendering;
    await engine.abortExport("exp_abort");
    const ended = (await second.ended) as Awaited<ReturnType<typeof exportSong>>;
    expect(ended.result.state).toBe("aborted");
    expect(await fs.readdir(ended.folder)).toEqual([]);
  });

  it("says which channels it couldn't play (a plugin not installed here)", async () => {
    const song = addPluginChannel(kicks([0]), { id: "VST3-Nowhere-1234", name: "Nowhere", format: "VST3" }, "chan_nowhere");
    const { result } = await exportSong(song);
    expect(result).toMatchObject({ state: "done", missing: ["chan_nowhere"] });
  });

  it("plays its automation as it plays live, sample for sample, in the mix and the stems", async () => {
    // The long sound on insert 1, once a bar for two bars; its volume rising, the track's pan swinging.
    let song = routeChannels(setSteps(addChannels(createMusicProject("Automated"), [{ id: "chan_long", name: "Long", sampleId: "long" }]), P, "chan_long", [0], true), ["chan_long"], "insert_1");
    song = editClips(song, (clips) =>
      addClips(clips, [
        { kind: "pattern", ref: P, track: 0, start: 0 },
        { kind: "pattern", ref: P, track: 0, start: BAR_TICKS },
      ]).clips,
    );
    const rise = createAutomation(song, { kind: "channel", channel: "chan_long", control: "volume" }, { start: 0, length: BAR_TICKS * 2 });
    song = editPoints(rise.song, rise.automationId, () => [
      { tick: 0, value: 0, tension: 0.5, curve: "single" },
      // Kept under full scale, which the live render's 24-bit file can't go past.
      { tick: BAR_TICKS * 2, value: 0.6, tension: 0.5, curve: "single" },
    ]);
    const swing = createAutomation(song, { kind: "mixer", track: "insert_1", control: "pan" }, { start: 0, length: BAR_TICKS * 2 });
    song = updateAutomation(swing.song, swing.automationId, { lfo: { enabled: true, speed: 3, level: 1 } });

    const { files } = await exportSong(song, { mode: "song", stems: true, threads: 4 });
    // Live: played once first (a new song's first block glides from the last's gains), then from the start.
    await engine.setSong({ projectId: PROJECT, song, patternId: P, mode: "song" });
    await engine.command("play", {});
    await engine.render(2048);
    await engine.command("stop", {});
    await engine.render(2048);
    await engine.command("play", {});
    const file = path.join(dir, "live.wav");
    await engine.render(BAR * 2, file);
    const live = await readWav(file);
    await engine.command("stop", {});
    let worst = 0;
    for (const side of [0, 1]) for (let i = 0; i < BAR * 2; i++) worst = Math.max(worst, Math.abs(files.mix.channels[side][i] - live.channels[side][i]));
    // The same, but for the live render's 24-bit file.
    expect(worst).toBeLessThan(1e-4);
    // The pan swings: the sides differ, and it isn't silence.
    expect(peakOf(files.mix.channels[0], BAR, BAR * 2)).toBeGreaterThan(0.1);
    expect(files.mix.channels[0][BAR + 1000]).not.toBeCloseTo(files.mix.channels[1][BAR + 1000], 2);
    // Insert 1's stem is the whole mix (the master is at 0 dB).
    for (let i = 0; i < BAR * 2; i += 97) expect(files.insert_1.channels[0][i]).toBeCloseTo(files.mix.channels[0][i], 6);
  });
});
