/**
 * Song mode in the real engine, offline (see `engine.integration.test.ts`): the playlist's pattern clips
 * flattened into notes, and its audio clips streamed from their files (`engine/src/ClipPlayer.cpp`),
 * each started on its sample. Songs are made with the app's own edits. At 120 BPM and 48 kHz a bar is
 * 96000 samples (two seconds). Skipped when the engine hasn't been built.
 */
import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { addChannels, setSteps, updateChannel } from "../../shared/music/edits.ts";
import { routeChannels, setMixerMuted } from "../../shared/music/mixer.ts";
import { type NewClip, addAudioClips, addClips, editClips, sliceClips, updateTrack } from "../../shared/music/playlist.ts";
import { FIRST_PATTERN_ID, createMusicProject } from "../../shared/music/project.ts";
import type { MusicProject } from "../../shared/music/types.ts";
import { ENGINE } from "../config.ts";
import { DataPaths } from "../storage.ts";
import { AudioEngine } from "./engine.ts";
import { type WavData, onsets, peakOf, readWav, writeWav } from "./wav.ts";

const RATE = 48_000;
const BAR = 96_000;
const BAR_TICKS = 384;
const P = FIRST_PATTERN_ID;
const PROJECT = "proj_0123456789ab";
const HIT = 480;
/** The steps file: a second at each of these levels, so where in it is playing can be read off the level. */
const STEPS = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6];

describe.skipIf(!existsSync(ENGINE))("the playlist, offline", () => {
  let dir: string;
  let engine: AudioEngine;
  let render = 0;

  const play = (song: MusicProject, loop?: { start: number; end: number }) => engine.setSong({ projectId: PROJECT, song, patternId: P, mode: "song", loop });
  async function hear(frames: number): Promise<WavData> {
    const file = path.join(dir, `render-${render++}.wav`);
    await engine.render(frames, file);
    return readWav(file);
  }
  /** The level at a sample (left), to three places. */
  const level = (sound: WavData, at: number) => Math.round(sound.channels[0][at] * 1000) / 1000;
  const place = (song: MusicProject, clips: NewClip[]) => editClips(song, (list) => addClips(list, clips).clips);
  /** A kick (a short hit), and the steps file as an audio clip at `start` ticks. */
  const song = (start = BAR_TICKS) => {
    const kick = setSteps(addChannels(createMusicProject("Test"), [{ id: "chan_kick", name: "Kick", sampleId: "hit" }]), P, "chan_kick", [0], true);
    return addAudioClips(kick, [{ name: "Steps", sampleId: "steps", seconds: STEPS.length, channelId: "chan_steps" }], { start, track: 1 }).song;
  };

  beforeAll(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "playlist-"));
    await writeWav(path.join(dir, "hit.wav"), new Float32Array(HIT).fill(0.5), RATE);
    // At 44.1 kHz, so the stream resamples it.
    const steps = STEPS.flatMap((value) => Array.from({ length: 44_100 }, () => value));
    await writeWav(path.join(dir, "steps.wav"), steps, 44_100);
    engine = new AudioEngine(new DataPaths(dir), {
      offline: true,
      onlyPluginPaths: true,
      pluginPaths: [],
      samplePath: (_project, id) => (["hit", "steps"].includes(id) ? path.join(dir, `${id}.wav`) : null),
    });
  });
  afterAll(async () => {
    engine.shutdown();
    await fs.rm(dir, { recursive: true, force: true });
  });
  beforeEach(async () => {
    await engine.command("stop", {});
    await hear(RATE / 10);
  });

  it("plays each pattern clip where it is on the playlist, and goes round at the end of the last clip's bar", async () => {
    const kick = setSteps(addChannels(createMusicProject("Test"), [{ id: "chan_kick", name: "Kick", sampleId: "hit" }]), P, "chan_kick", [0, 8], true);
    expect((await play(place(kick, [{ kind: "pattern", ref: P, track: 0, start: 0 }, { kind: "pattern", ref: P, track: 0, start: 2 * BAR_TICKS }]))).loop).toEqual({ start: 0, ticks: 3 * BAR_TICKS });
    await engine.command("play", {});
    const sound = await hear(4 * BAR);
    expect(onsets(sound.channels[0])).toEqual([0, BAR / 2, 2 * BAR, 2.5 * BAR, 3 * BAR, 3.5 * BAR]);
  });

  it("starts an audio clip on its sample and plays its file, streamed, until the clip ends", async () => {
    await play(place(song(), [{ kind: "pattern", ref: P, track: 0, start: 0 }]));
    await engine.command("play", {});
    const sound = await hear(5 * BAR);
    // The kick at 0; the file from bar 2 (exactly), a second of each level, resampled from 44.1 kHz.
    expect(onsets(sound.channels[0])).toEqual([0, BAR]);
    expect(level(sound, BAR - 1)).toBe(0);
    // Its first sample is the file's (resampling softens the edge from silence for a sample or two).
    expect(level(sound, BAR)).toBeGreaterThan(0.05);
    expect(level(sound, BAR + 4)).toBe(0.1);
    expect(level(sound, BAR + RATE / 2)).toBe(0.1);
    expect(level(sound, BAR + 2.5 * RATE)).toBe(0.3);
    expect(level(sound, BAR + 5.5 * RATE)).toBe(0.6);
    // Six seconds long (three bars): it's over at bar 5, where the song goes round to the kick.
    expect(level(sound, 4 * BAR - 200)).toBe(0.6);
    expect(level(sound, 4 * BAR + 100)).toBe(0.5);
    expect(peakOf(sound.channels[0], 4 * BAR + HIT + 10, 5 * BAR)).toBe(0);
  });

  it("plays a sliced clip's second part from where the slice was in the file", async () => {
    // Sliced at bar 2, two seconds in: the second part starts with the third second of the file.
    const sliced = editClips(song(0), (clips, ctx) => sliceClips(clips, BAR_TICKS, 0, 9, ctx).clips);
    const moved = editClips(sliced, (clips) => clips.map((c) => (c.start === BAR_TICKS && c.kind === "audio" ? { ...c, start: 2 * BAR_TICKS } : c)));
    await play(moved);
    await engine.command("play", {});
    const sound = await hear(4 * BAR);
    expect(level(sound, RATE / 2)).toBe(0.1);
    // The first part ends at bar 2, the second starts at bar 3, with the file's third second (faded in, briefly).
    expect(level(sound, BAR + RATE / 2)).toBe(0);
    expect(level(sound, 2 * BAR + RATE / 2)).toBe(0.3);
    expect(level(sound, 3 * BAR + RATE / 2)).toBe(0.5);
  });

  it("plays from inside a clip when play starts there", async () => {
    await play(song(0));
    // A bar and a half in: three seconds into the file.
    await engine.command("play", { from: 1.5 * BAR_TICKS });
    const sound = await hear(RATE);
    expect(level(sound, RATE / 4)).toBe(0.4);
    expect(level(sound, RATE / 2 + 100)).toBe(0.4);
  });

  it("plays it again each time round the loop (the time selection), from its start", async () => {
    // Only the first bar loops: the file's first two seconds, again and again.
    await play(song(0), { start: 0, end: BAR_TICKS });
    await engine.command("play", {});
    const sound = await hear(3 * BAR);
    for (const bar of [0, 1, 2]) {
      expect(level(sound, bar * BAR + RATE / 2)).toBe(0.1);
      expect(level(sound, bar * BAR + 1.5 * RATE)).toBe(0.2);
    }
  });

  it("plays a clip that began before the time selection from where the selection starts", async () => {
    await play(song(0), { start: BAR_TICKS, end: 2 * BAR_TICKS });
    await engine.command("play", {});
    const sound = await hear(2 * BAR);
    expect(level(sound, RATE / 2)).toBe(0.3);
    expect(level(sound, BAR + RATE / 2)).toBe(0.3);
  });

  it("goes through its channel's mixer track, at its channel's level; muted tracks and clips are silent", async () => {
    let routed = routeChannels(song(0), ["chan_steps"], "insert_1");
    routed = updateChannel(routed, "chan_steps", { volume: 0.39 });
    await play(routed);
    await engine.command("play", {});
    let sound = await hear(RATE);
    // Half the default volume is a quarter of the gain.
    expect(level(sound, RATE / 2)).toBe(0.025);
    await engine.command("stop", {});
    await play(setMixerMuted(routed, ["insert_1"], true));
    await engine.command("play", {});
    sound = await hear(RATE);
    expect(level(sound, RATE / 2)).toBe(0);
    await engine.command("stop", {});
    await play(updateTrack(song(0), 1, { muted: true }));
    await engine.command("play", {});
    expect(level(await hear(RATE), RATE / 2)).toBe(0);
  });

  it("keeps playing through an edit of the song that leaves its clip as it is", async () => {
    const base = song(0);
    await play(base);
    await engine.command("play", {});
    await hear(RATE);
    // Another clip added: the playing one carries on where it was.
    await play(place(base, [{ kind: "pattern", ref: P, track: 0, start: 4 * BAR_TICKS }]));
    const sound = await hear(RATE);
    expect(level(sound, RATE / 2)).toBe(0.2);
  });

  it("stops at once, and plays nothing when it's stopped", async () => {
    await play(song(0));
    await engine.command("play", {});
    await hear(RATE / 2);
    await engine.command("stop", {});
    const sound = await hear(RATE);
    expect(peakOf(sound.channels[0], 200, RATE - 1)).toBe(0);
  });
});
