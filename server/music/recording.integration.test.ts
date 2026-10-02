/**
 * Recording, with the real engine offline: a WAV stands in for the audio device's inputs (`render`'s
 * `input`), and what the engine writes for each armed track is checked against it, sample for sample.
 * At 120 BPM and 48 kHz a beat is 24000 samples and a bar (the pattern, looped) 96000.
 */
import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { EngineTakeEvent } from "../../shared/music/engine.ts";
import { createAutomation, editPoints } from "../../shared/music/automation.ts";
import { levelGain } from "../../shared/music/compile.ts";
import { addChannels, setSteps } from "../../shared/music/edits.ts";
import { routeChannels, updateMixerTrack } from "../../shared/music/mixer.ts";
import { addClips, editClips } from "../../shared/music/playlist.ts";
import { DEFAULT_VOLUME, FIRST_PATTERN_ID, createMusicProject } from "../../shared/music/project.ts";
import type { InputMonitor, MusicProject } from "../../shared/music/types.ts";
import type { MediaAsset } from "../../shared/types.ts";
import { ENGINE } from "../config.ts";
import { DataPaths } from "../storage.ts";
import { AudioEngine } from "./engine.ts";
import { type WavData, onsets, peakOf, readWav, writeWav, writeWavChannels } from "./wav.ts";

const RATE = 48_000;
const BEAT = 24_000;
const BAR = 4 * BEAT;
const P = FIRST_PATTERN_ID;
const PROJECT = "proj_0123456789ab";
/** One bar, in ticks. */
const BAR_TICKS = 384;

describe.skipIf(!existsSync(ENGINE))("recording, offline", () => {
  let dir: string;
  let engine: AudioEngine;
  let render = 0;
  /** What the "microphone" plays: two channels of different noise, three bars long. */
  let input: WavData;
  let inputFile: string;
  const takes: EngineTakeEvent[] = [];

  /** The next `frames` samples of sound; `withInput` starts the stand-in input from its beginning. */
  async function hear(frames: number, withInput = false): Promise<WavData> {
    const file = path.join(dir, `render-${render++}.wav`);
    await engine.render(frames, file, withInput ? inputFile : undefined);
    return readWav(file);
  }
  /** A song whose `insert_1` takes `input` (and monitors it as `monitor` says), armed. */
  function play(song: MusicProject, armed = ["insert_1"]) {
    return engine.setSong({ projectId: PROJECT, song, patternId: P, armed });
  }
  const withInput = (song: MusicProject, stereo = false, monitor: InputMonitor = "armed") =>
    updateMixerTrack(song, "insert_1", { input: { channel: 0, stereo }, monitor });
  const record = (options: { countIn?: number; loop?: boolean } = {}) =>
    engine.record({ projectId: PROJECT, from: 0, countIn: options.countIn ?? 0, loop: options.loop ?? false, names: { insert_1: "Vox" } });
  /** Stop, and wait until `count` takes have come. */
  async function stopFor(count: number): Promise<EngineTakeEvent[]> {
    await engine.command("stop", {});
    await hear(512);
    for (let waited = 0; takes.length < count && waited < 5000; waited += 20) await new Promise((resolve) => setTimeout(resolve, 20));
    return takes.splice(0);
  }
  const fileOf = (take: EngineTakeEvent) => readWav(take.media!.src);
  const slice = (channel: Float32Array, from: number, length: number) => Array.from(channel.subarray(from, from + length));

  beforeAll(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "recording-"));
    // Noise, so each stretch of it is unlike any other: a take in the wrong place can't match.
    let seed = 1;
    const noise = () => Array.from({ length: 3 * BAR }, () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31 - 0.5) * 0.5);
    inputFile = path.join(dir, "input.wav");
    await writeWavChannels(inputFile, [noise(), noise()], RATE);
    input = await readWav(inputFile);
    await writeWav(path.join(dir, "hit.wav"), new Float32Array(480).fill(0.5), RATE);
    await writeWav(path.join(dir, "pad.wav"), new Float32Array(RATE * 8).fill(0.5), RATE);
    engine = new AudioEngine(new DataPaths(dir), {
      offline: true,
      onlyPluginPaths: true,
      pluginPaths: [],
      samplePath: (_project, id) => (id === "hit" || id === "pad" ? path.join(dir, `${id}.wav`) : null),
      // A take is moved into the "media", as the app's library does.
      adoptTake: async (_project, file, name, origin) => {
        const to = path.join(dir, "media", `${origin.replace(/:/g, "_")}.wav`);
        await fs.mkdir(path.dirname(to), { recursive: true });
        await fs.rename(file, to);
        return { id: origin, name, src: to } as MediaAsset;
      },
    });
    engine.onEvent((event) => event.event === "take" && takes.push(event));
  });
  afterAll(async () => {
    engine.shutdown();
    await fs.rm(dir, { recursive: true, force: true });
  });
  beforeEach(async () => {
    await engine.command("stop", {});
    await engine.command("metronome", { on: false });
    await hear(RATE / 10);
    takes.length = 0;
  });

  it("records an armed track's input, dry, from where play starts, and hears it through the track while it's armed", async () => {
    await play(withInput(createMusicProject("Test", 120)));
    await record();
    const heard = await hear(2 * BEAT, true);
    // Monitored: the input is heard, on both sides, as it is (the track's fader at 0 dB).
    expect(slice(heard.channels[0], 0, 2 * BEAT)).toEqual(slice(input.channels[0], 0, 2 * BEAT));
    expect(slice(heard.channels[1], 0, 2 * BEAT)).toEqual(slice(input.channels[0], 0, 2 * BEAT));

    const [take] = await stopFor(1);
    expect(take).toMatchObject({ track: "insert_1", startTick: 0, skip: 0, frames: 2 * BEAT, pass: 0, final: true, sampleRate: RATE, projectId: PROJECT });
    expect(take.media?.name).toMatch(/^Vox \d{4}-\d\d-\d\d \d\d-\d\d-\d\d$/);
    const file = await fileOf(take);
    expect(file.channels).toHaveLength(1);
    expect(slice(file.channels[0], 0, 2 * BEAT)).toEqual(slice(input.channels[0], 0, 2 * BEAT));
  });

  it("measures what it records as it goes: the loudest sample of every 5 ms (240 samples), for the take drawn live", async () => {
    await play(withInput(createMusicProject("Test", 120)));
    await record();
    const file = path.join(dir, `render-${render++}.wav`);
    const rendered = await engine.render(BEAT, file, inputFile);
    const peaks = rendered.levels?.insert_1 ?? [];
    expect(peaks).toHaveLength(BEAT / 240);
    const loudest = (from: number) => Math.max(...Array.from(input.channels[0].subarray(from, from + 240), Math.abs));
    for (const i of [0, 1, 50, 99]) expect(peaks[i]).toBeCloseTo(loudest(i * 240), 3);
    await stopFor(1);
  });

  it("records a pair as two channels, and records without being heard when monitoring is off", async () => {
    await play(withInput(createMusicProject("Test", 120), true, "off"));
    await record();
    const heard = await hear(BEAT, true);
    expect(peakOf(heard.channels[0])).toBe(0);
    const file = await fileOf((await stopFor(1))[0]);
    expect(file.channels).toHaveLength(2);
    expect(slice(file.channels[0], 0, BEAT)).toEqual(slice(input.channels[0], 0, BEAT));
    expect(slice(file.channels[1], 0, BEAT)).toEqual(slice(input.channels[1], 0, BEAT));
  });

  it("shows an armed track's input level on its meter even when it isn't heard, so the level can be set first", async () => {
    await play(withInput(createMusicProject("Test", 120), false, "off"));
    const file = path.join(dir, `render-${render++}.wav`);
    const measured = await engine.render(BEAT / 4, file, inputFile);
    expect(measured.peak).toBe(0);
    expect(measured.meters.insert_1?.[0]).toBeGreaterThan(0.1);
    // Disarmed: nothing.
    await play(withInput(createMusicProject("Test", 120), false, "off"), []);
    expect((await engine.render(BEAT / 4)).meters.insert_1).toBeUndefined();
  });

  it("only records tracks that are armed, and refuses when none is", async () => {
    await play(withInput(createMusicProject("Test", 120)), []);
    await expect(record()).rejects.toThrow(/armed/);
  });

  it("counts in a bar of clicks with the transport held, then plays and records from the bar's end", async () => {
    let song = withInput(createMusicProject("Test", 120), false, "off");
    song = setSteps(addChannels(song, [{ id: "chan_kick", name: "Kick", sampleId: "hit" }]), P, "chan_kick", [0], true);
    await play(song);
    await record({ countIn: BAR_TICKS });
    const heard = await hear(BAR + BEAT, true);
    // Four clicks on the beats (the metronome is off: a count-in is heard anyway; a click is a sine,
    // so its first sample is 0), then the pattern's first kick, on the bar.
    expect(onsets(heard.channels[0])).toEqual([1, BEAT + 1, 2 * BEAT + 1, 3 * BEAT + 1, BAR]);
    const [take] = await stopFor(1);
    expect(take).toMatchObject({ startTick: 0, frames: BEAT });
    expect(slice((await fileOf(take)).channels[0], 0, BEAT)).toEqual(slice(input.channels[0], BAR, BEAT));
  });

  it("makes nothing of a recording stopped in its count-in", async () => {
    await play(withInput(createMusicProject("Test", 120)));
    await record({ countIn: BAR_TICKS });
    await hear(BEAT, true);
    expect(await stopFor(0)).toEqual([]);
    expect((await fs.readdir(path.join(dir, "projects", PROJECT, "recordings"))).filter((f) => f.endsWith(".wav"))).toEqual([]);
  });

  it("with Loop record, makes a take of each pass round the loop, split on the sample it goes round", async () => {
    await play(withInput(createMusicProject("Test", 120)));
    await record({ loop: true });
    await hear(2 * BAR + 2 * BEAT, true);
    const found = await stopFor(3);
    expect(found.map((t) => [t.pass, t.startTick, t.skip, t.frames, t.final])).toEqual([
      [0, 0, 0, BAR, false],
      [1, 0, 0, BAR, false],
      [2, 0, 0, 2 * BEAT, true],
    ]);
    expect(found[1].media?.name).toMatch(/ take 2$/);
    const files = await Promise.all(found.map(fileOf));
    expect(slice(files[0].channels[0], 0, BAR)).toEqual(slice(input.channels[0], 0, BAR));
    expect(slice(files[1].channels[0], 0, BAR)).toEqual(slice(input.channels[0], BAR, BAR));
    expect(slice(files[2].channels[0], 0, 2 * BEAT)).toEqual(slice(input.channels[0], 2 * BAR, 2 * BEAT));
  });

  it("without Loop record, plays on past the loop's end into one take", async () => {
    await play(withInput(createMusicProject("Test", 120)));
    const { status } = await record();
    expect(status.recording).not.toBeNull();
    await hear(BAR + 2 * BEAT, true);
    expect((await engine.command("status", {})).transport.tick).toBeGreaterThan(BAR_TICKS);
    const [take] = await stopFor(1);
    expect(take).toMatchObject({ frames: BAR + 2 * BEAT, final: true, pass: 0 });
    expect(slice((await fileOf(take)).channels[0], BAR - 100, 200)).toEqual(slice(input.channels[0], BAR - 100, 200));
    expect((await engine.command("status", {})).recording).toBeNull();
  });

  it("keeps automation on the song's time through a count-in: it starts when the transport moves", async () => {
    // A steady pad over four bars (song mode), its volume automated up a line across the second bar.
    let song = addChannels(withInput(createMusicProject("Test", 120), false, "off"), [{ id: "chan_pad", name: "Pad", sampleId: "pad" }]);
    song = routeChannels(setSteps(song, P, "chan_pad", [0], true), ["chan_pad"], "insert_2");
    song = editClips(song, (clips) => addClips(clips, [{ kind: "pattern", ref: P, track: 0, start: 0, length: BAR_TICKS * 4 }]).clips);
    const made = createAutomation(song, { kind: "channel", channel: "chan_pad", control: "volume" }, { start: BAR_TICKS, length: BAR_TICKS });
    song = editPoints(made.song, made.automationId, () => [
      { tick: 0, value: 0, tension: 0, curve: "single" },
      { tick: BAR_TICKS, value: 1, tension: 0, curve: "single" },
    ]);
    await engine.setSong({ projectId: PROJECT, song, patternId: P, mode: "song", armed: ["insert_1"] });
    await record({ countIn: BAR_TICKS });
    const heard = await hear(3 * BAR, true);
    const levelAt = (at: number) => peakOf(heard.channels[0], at - 50, at + 50);
    // The song's first bar (after the count-in's): the pad as it is; then its second bar, up the line.
    expect(levelAt(BAR + BAR / 2)).toBeCloseTo(0.5, 3);
    expect(levelAt(2 * BAR + BAR / 2)).toBeCloseTo(0.5 * levelGain(0.5, DEFAULT_VOLUME), 2);
    await stopFor(1);
  });
});

