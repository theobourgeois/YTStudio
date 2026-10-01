/**
 * What a song sounds like: the real engine, offline (see `engine.integration.test.ts`), playing songs
 * made with the same edits and compiler as the app, and the rendered sound checked to the sample.
 * At 120 BPM and 48 kHz a beat is 24000 samples and a step 6000.
 */
import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { addChannels, setPatternLength, setStepNote, setSteps, setSwing, setTempo, updateChannel } from "../../shared/music/edits.ts";
import { routeChannels, sendOnly, setMixerMuted, setSend, updateMixerTrack } from "../../shared/music/mixer.ts";
import { editNotes, setNoteProps } from "../../shared/music/notes.ts";
import { FIRST_PATTERN_ID, MASTER_TRACK_ID, createMusicProject as newSong } from "../../shared/music/project.ts";
import type { MusicProject } from "../../shared/music/types.ts";
import { ENGINE } from "../config.ts";
import { DataPaths } from "../storage.ts";
import { AudioEngine } from "./engine.ts";
import { type WavData, onsets, peakOf, readWav, writeWav } from "./wav.ts";

/** A new song at 120 BPM, which these tests' timings are worked out at (new songs start at 140). */
const createMusicProject = (name: string) => newSong(name, 120);

const RATE = 48_000;
const BEAT = 24_000;
const STEP = 6_000;
const P = FIRST_PATTERN_ID;
const PROJECT = "proj_0123456789ab";
/** A hit: 10 ms of a steady half-scale level. */
const HIT = 480;

describe.skipIf(!existsSync(ENGINE))("the sequencer, offline", () => {
  let dir: string;
  let engine: AudioEngine;
  let render = 0;

  const play = (song: MusicProject) => engine.setSong({ projectId: PROJECT, song, patternId: P });
  /** The next `frames` samples of sound. */
  async function hear(frames: number): Promise<WavData> {
    const file = path.join(dir, `render-${render++}.wav`);
    await engine.render(frames, file);
    return readWav(file);
  }
  /** Kick on a channel with the hit sample, hat on one with the long sample. */
  const rack = () =>
    addChannels(createMusicProject("Test"), [
      { id: "chan_kick", name: "Kick", sampleId: "hit" },
      { id: "chan_pad", name: "Pad", sampleId: "long" },
    ]);

  beforeAll(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "sequencer-"));
    await writeWav(path.join(dir, "hit.wav"), new Float32Array(HIT).fill(0.5), RATE);
    await writeWav(path.join(dir, "long.wav"), new Float32Array(RATE * 2).fill(0.5), RATE);
    engine = new AudioEngine(new DataPaths(dir), {
      offline: true,
      onlyPluginPaths: true,
      pluginPaths: [],
      samplePath: (_project, id) => (id === "hit" || id === "long" ? path.join(dir, `${id}.wav`) : null),
    });
  });
  afterAll(async () => {
    engine.shutdown();
    await fs.rm(dir, { recursive: true, force: true });
  });
  beforeEach(async () => {
    await engine.command("stop", {});
    await engine.command("metronome", { on: false });
    await hear(RATE / 10);
  });

  it("is silent until it plays, then plays each step on its sample, and loops", async () => {
    await play(setSteps(rack(), P, "chan_kick", [0, 4, 8, 12], true));
    expect(peakOf((await hear(BEAT)).channels[0])).toBe(0);

    await engine.command("play", {});
    const sound = await hear(BEAT * 8);
    expect(onsets(sound.channels[0])).toEqual([0, 1, 2, 3, 4, 5, 6, 7].map((beat) => beat * BEAT));
    // The sample as it is: its own level, its own length, on both sides.
    expect(peakOf(sound.channels[0], 0, HIT - 1)).toBeCloseTo(0.5, 3);
    expect(peakOf(sound.channels[1], 0, HIT - 1)).toBeCloseTo(0.5, 3);
    expect(peakOf(sound.channels[0], HIT + 1, BEAT)).toBe(0);
  });

  it("says where it is, and goes back to the start when stopped", async () => {
    await play(setSteps(rack(), P, "chan_kick", [0], true));
    await engine.command("play", {});
    await hear(BEAT);
    let status = await engine.command("status", {});
    expect(status.transport.playing).toBe(true);
    // A beat in: 96 ticks, to within a block.
    expect(status.transport.tick).toBeGreaterThan(95);
    expect(status.transport.tick).toBeLessThan(99);

    await hear(BEAT * 3.5);
    expect((await engine.command("status", {})).transport.tick).toBeLessThan(384);
    status = await engine.command("stop", {});
    await hear(STEP);
    expect((await engine.command("status", {})).transport).toMatchObject({ playing: false, tick: 0 });
    await engine.command("play", {});
    expect(onsets((await hear(BEAT)).channels[0])).toEqual([0]);
  });

  it("swings every second step late", async () => {
    const song = setSteps(rack(), P, "chan_kick", [0, 1, 2, 3], true);
    await play(song);
    await engine.command("play", {});
    expect(onsets((await hear(BEAT)).channels[0])).toEqual([0, STEP, 2 * STEP, 3 * STEP]);

    await engine.command("stop", {});
    await play(setSwing(song, 1));
    await engine.command("play", {});
    expect(onsets((await hear(BEAT)).channels[0])).toEqual([0, STEP * 1.5, 2 * STEP, STEP * 3.5]);
  });

  it("follows the tempo and the pattern's length, even changed while it plays", async () => {
    const song = setSteps(rack(), P, "chan_kick", [0, 4], true);
    await play(setPatternLength(setTempo(song, 240), P, 8));
    await engine.command("play", {});
    // Twice as fast, and half a bar long: a hit every beat, a beat being 12000 samples.
    expect(onsets((await hear(BEAT * 2)).channels[0])).toEqual([0, 12_000, 24_000, 36_000]);
    // Back to 120 BPM without stopping: the loop carries on from where it is, and nothing clicks.
    await play(setPatternLength(song, P, 8));
    expect(onsets((await hear(BEAT * 2)).channels[0])).toEqual([0, BEAT]);
  });

  it("plays volume, pan, mute and velocity as gains", async () => {
    let song = setSteps(rack(), P, "chan_kick", [0, 4], true);
    song = setStepNote(song, P, "chan_kick", 4, { velocity: 0.39 });
    song = updateChannel(song, "chan_kick", { pan: 1, volume: 0.39 });
    await play(song);
    await engine.command("play", {});
    const sound = await hear(BEAT * 2);
    // Half the default level is a quarter of the gain, and so is half the default velocity.
    expect(peakOf(sound.channels[1], 0, HIT - 1)).toBeCloseTo(0.125, 3);
    expect(peakOf(sound.channels[1], BEAT, BEAT + HIT - 1)).toBeCloseTo(0.03125, 3);
    expect(peakOf(sound.channels[0])).toBe(0);

    await play(updateChannel(song, "chan_kick", { muted: true }));
    expect(peakOf((await hear(BEAT * 2)).channels[1])).toBe(0);
  });

  it("pitches a sample by playing it faster or slower", async () => {
    let song = setSteps(rack(), P, "chan_kick", [0, 8], true);
    song = setStepNote(song, P, "chan_kick", 8, { pitch: 48 });
    await play(updateChannel(song, "chan_kick", { pitch: 12 }));
    await engine.command("play", {});
    const left = (await hear(BEAT * 4)).channels[0];
    // An octave up (the channel's pitch) lasts half as long; the second note, an octave below that, as long as the sample.
    const length = (from: number) => left.subarray(from, from + BEAT).findIndex((v, i) => i > 10 && Math.abs(v) < 0.01);
    expect(length(0)).toBeGreaterThan(HIT / 2 - 4);
    expect(length(0)).toBeLessThan(HIT / 2 + 4);
    expect(length(2 * BEAT)).toBeGreaterThan(HIT - 4);
    expect(length(2 * BEAT)).toBeLessThan(HIT + 4);
  });

  it("plays a whole sample whatever the note's length, unless the channel has an envelope", async () => {
    const song = setSteps(rack(), P, "chan_pad", [0], true);
    await play(song);
    await engine.command("play", {});
    // Two seconds of sample: still sounding at the end of the bar.
    expect(peakOf((await hear(BEAT * 4)).channels[0], BEAT * 3.9)).toBeCloseTo(0.5, 2);

    await engine.command("stop", {});
    await play(updateChannel(song, "chan_pad", { envelope: { enabled: true, attack: 0.1, sustain: 0.5, decay: 0, release: 0.05 } }));
    await engine.command("play", {});
    const left = (await hear(BEAT)).channels[0];
    // It fades in over the attack (the step, 6000 samples, is over before it's done: 125 ms of 100)...
    expect(left[10]).toBeLessThan(0.01);
    expect(left[2400]).toBeCloseTo(0.25, 1);
    // ...and is gone a release after the step ends.
    expect(peakOf(left, STEP + 0.06 * RATE)).toBe(0);
  });

  it("loops a pattern of automatic length over the bars with notes, and a set one over its length (or its notes')", async () => {
    // A hit on the first step of bar 2: two bars, so a hit every two bars, a bar in.
    await play(setSteps(rack(), P, "chan_kick", [16], true));
    await engine.command("play", {});
    expect(onsets((await hear(BEAT * 16)).channels[0])).toEqual([BEAT * 4, BEAT * 12]);

    await engine.command("stop", {});
    // Set to half a bar: a hit every half bar.
    await play(setPatternLength(setSteps(rack(), P, "chan_kick", [0], true), P, 8));
    await engine.command("play", {});
    expect(onsets((await hear(BEAT * 8)).channels[0])).toEqual([0, BEAT * 2, BEAT * 4, BEAT * 6]);

    // A note past the set length makes it reach the end of that note's bar.
    await engine.command("stop", {});
    await play(setPatternLength(setSteps(rack(), P, "chan_kick", [0, 16], true), P, 8));
    await engine.command("play", {});
    expect(onsets((await hear(BEAT * 8)).channels[0])).toEqual([0, BEAT * 4]);
  });

  it("cuts a channel's own notes short with cut self", async () => {
    const song = setSteps(rack(), P, "chan_pad", [0, 4], true);
    await play(song);
    await engine.command("play", {});
    // Two notes of the long sample overlap: twice the level.
    expect(peakOf((await hear(BEAT * 2)).channels[0], BEAT * 1.5)).toBeCloseTo(1, 2);

    await engine.command("stop", {});
    await play(updateChannel(song, "chan_pad", { cutSelf: true }));
    await engine.command("play", {});
    const left = (await hear(BEAT * 2)).channels[0];
    // The second note silences the first as it starts (a fade of a few milliseconds).
    expect(peakOf(left, BEAT * 0.5, BEAT)).toBeCloseTo(0.5, 2);
    expect(peakOf(left, BEAT * 1.5)).toBeCloseTo(0.5, 2);
  });

  it("prepares a sample before playing it: trimmed, reversed, normalised, faded", async () => {
    // A ramp from silence up to half scale over 10 ms: its shape shows what was done to it.
    await writeWav(path.join(dir, "ramp.wav"), Float32Array.from({ length: HIT }, (_, i) => (0.5 * i) / HIT), RATE);
    const ramp = new AudioEngine(new DataPaths(path.join(dir, "ramp")), {
      offline: true,
      onlyPluginPaths: true,
      pluginPaths: [],
      samplePath: () => path.join(dir, "ramp.wav"),
    });
    const heard = async (precomputed: Parameters<typeof updateChannel>[2]["precomputed"]) => {
      let song = addChannels(createMusicProject("Ramp"), [{ id: "chan_ramp", name: "Ramp", sampleId: "ramp" }]);
      song = updateChannel(setSteps(song, P, "chan_ramp", [0], true), "chan_ramp", { precomputed });
      await ramp.command("stop", {});
      await ramp.setSong({ projectId: PROJECT, song, patternId: P });
      await ramp.command("play", {});
      const file = path.join(dir, `ramp-${render++}.wav`);
      await ramp.render(BEAT, file);
      return (await readWav(file)).channels[0];
    };
    try {
      const plain = await heard({});
      expect(plain[10]).toBeLessThan(0.02);
      expect(plain[HIT - 10]).toBeGreaterThan(0.48);
      // Backwards: loud first.
      const reversed = await heard({ reverse: true });
      expect(reversed[10]).toBeGreaterThan(0.48);
      expect(reversed[HIT - 10]).toBeLessThan(0.02);
      // The second half only, which is half as long and starts at a quarter scale.
      const trimmed = await heard({ start: 0.5 });
      expect(trimmed[5]).toBeGreaterThan(0.24);
      expect(peakOf(trimmed, HIT / 2 + 2)).toBe(0);
      expect(peakOf(await heard({ length: 0.5 }), HIT / 2 + 2)).toBe(0);
      // Normalised: its loudest point at full scale.
      expect(peakOf(await heard({ normalize: true }))).toBeCloseTo(1, 2);
      // Faded out over its second half: the end, which was the loudest, is silent.
      const faded = await heard({ fadeOut: 0.5 });
      expect(faded[HIT - 5]).toBeLessThan(0.02);
      expect(faded[HIT / 2 - 5]).toBeGreaterThan(0.24);
      expect((await heard({ reverse: true, fadeIn: 0.5 }))[5]).toBeLessThan(0.02);
    } finally {
      ramp.shutdown();
    }
  });

  it("starts from where it's told (playing or not), plays only a part of the pattern, and leaves muted notes out", async () => {
    const song = setSteps(rack(), P, "chan_kick", [0, 4, 8, 12], true);
    await play(song);
    // From the third beat: two hits, then round to the first.
    await engine.command("play", { from: 192 });
    expect(onsets((await hear(BEAT * 3)).channels[0])).toEqual([0, BEAT, 2 * BEAT]);
    expect((await engine.command("status", {})).transport.tick).toBeGreaterThan(95);
    // Played again while it plays (the ruler clicked): it goes there at once.
    await hear(BEAT / 2);
    await engine.command("play", { from: 288 });
    expect(onsets((await hear(BEAT * 2)).channels[0])).toEqual([0, BEAT]);

    // Only beats two and three, round and round.
    await engine.command("stop", {});
    await engine.setSong({ projectId: PROJECT, song, patternId: P, loop: { start: 96, end: 288 } });
    await engine.command("play", {});
    expect(onsets((await hear(BEAT * 4)).channels[0])).toEqual([0, BEAT, 2 * BEAT, 3 * BEAT]);
    expect((await engine.command("status", {})).transport.tick).toBeLessThan(192);

    await engine.command("stop", {});
    const kick = song.patterns[0].notes.chan_kick;
    await play(editNotes(song, P, "chan_kick", (notes) => setNoteProps(notes, new Set([kick[1].id, kick[2].id]), { muted: true })));
    await engine.command("play", {});
    expect(onsets((await hear(BEAT * 4)).channels[0])).toEqual([0, 3 * BEAT]);
  });

  it("pans a note on its own, on top of its channel", async () => {
    let song = setSteps(rack(), P, "chan_kick", [0, 4], true);
    const [first, second] = song.patterns[0].notes.chan_kick;
    song = editNotes(song, P, "chan_kick", (notes) => setNoteProps(setNoteProps(notes, new Set([first.id]), { pan: -1 }), new Set([second.id]), { pan: 0.5 }));
    await play(song);
    await engine.command("play", {});
    const sound = await hear(BEAT * 2);
    expect(peakOf(sound.channels[0], 0, HIT - 1)).toBeCloseTo(0.5, 3);
    expect(peakOf(sound.channels[1], 0, HIT - 1)).toBe(0);
    expect(peakOf(sound.channels[0], BEAT, BEAT + HIT - 1)).toBeCloseTo(0.25, 3);
    expect(peakOf(sound.channels[1], BEAT, BEAT + HIT - 1)).toBeCloseTo(0.5, 3);
  });

  it("stops what's sounding when it stops", async () => {
    await play(setSteps(rack(), P, "chan_pad", [0], true));
    await engine.command("play", {});
    await hear(STEP);
    await engine.command("stop", {});
    const left = (await hear(BEAT)).channels[0];
    // A fade of a few milliseconds, not a click, then nothing.
    expect(peakOf(left, 0, 10)).toBeGreaterThan(0.2);
    expect(peakOf(left, RATE * 0.01)).toBe(0);
  });

  it("clicks on every beat with the metronome, higher on the bar", async () => {
    await play(rack());
    await engine.command("metronome", { on: true });
    await engine.command("play", {});
    const left = (await hear(BEAT * 4)).channels[0];
    expect(onsets(left, 0.02, 2000)).toHaveLength(4);
    const crossings = (from: number) => {
      let count = 0;
      for (let i = from + 1; i < from + 960; i++) if (left[i - 1] < 0 !== left[i] < 0) count++;
      return count;
    };
    // 20 ms of 1760 Hz against 1175 Hz.
    expect(crossings(0)).toBeGreaterThan(crossings(BEAT) * 1.3);
  });

  it("plays a channel on its own when asked, without the song playing", async () => {
    await play(rack());
    await engine.command("trigger", { channel: "chan_kick" });
    const sound = await hear(BEAT);
    expect(onsets(sound.channels[0])).toEqual([0]);
    expect(peakOf(sound.channels[0], 0, HIT - 1)).toBeCloseTo(0.5, 3);
    await expect(engine.command("trigger", { channel: "chan_none" })).rejects.toMatchObject({ status: 409 });
  });

  it("plays the starter kit's drums (44.1 kHz files) at their own speed", async () => {
    const kit = path.resolve(import.meta.dirname, "..", "..", "public", "kit");
    const drums = new AudioEngine(new DataPaths(path.join(dir, "kit")), {
      offline: true,
      onlyPluginPaths: true,
      pluginPaths: [],
      samplePath: (_project, id) => path.join(kit, `${id}.wav`),
    });
    try {
      let song = addChannels(createMusicProject("Kit"), [
        { id: "chan_kick", name: "Kick", sampleId: "kick" },
        { id: "chan_hat", name: "Hat", sampleId: "hat" },
      ]);
      song = setSteps(song, P, "chan_kick", [0], true);
      song = setSteps(song, P, "chan_hat", [8], true);
      expect(await drums.setSong({ projectId: PROJECT, song, patternId: P })).toMatchObject({ unreadable: [] });
      await drums.command("play", {});
      const file = path.join(dir, "kit.wav");
      await drums.render(BEAT * 4, file);
      const left = (await readWav(file)).channels[0];
      expect(onsets(left, 0.02, 4000)).toEqual([0, 2 * BEAT]);
      // The kick lasts its 0.45 s, not 0.41 (which it would if 44.1 kHz were played as 48).
      expect(peakOf(left, 0.43 * RATE, 0.445 * RATE)).toBeGreaterThan(0.0005);
      expect(peakOf(left, 0.46 * RATE, 2 * BEAT - 1)).toBe(0);
    } finally {
      drums.shutdown();
    }
  });

  it("says which samples it couldn't read, and plays the rest", async () => {
    await fs.writeFile(path.join(dir, "broken.wav"), "not audio");
    const broken = new AudioEngine(new DataPaths(path.join(dir, "other")), {
      offline: true,
      onlyPluginPaths: true,
      pluginPaths: [],
      samplePath: (_project, id) => path.join(dir, `${id}.wav`),
    });
    try {
      const song = addChannels(rack(), [{ id: "chan_bad", name: "Bad", sampleId: "broken" }]);
      expect(await broken.setSong({ projectId: PROJECT, song, patternId: P })).toMatchObject({ unreadable: ["chan_bad"] });
      await expect(broken.setSong({ projectId: "nope", song, patternId: P })).rejects.toMatchObject({ status: 400 });
    } finally {
      broken.shutdown();
    }
  });

  describe("through the mixer", () => {
    /** The kick's hit, once a beat, played into `track`. */
    const kickOn = (track: string) => routeChannels(setSteps(rack(), P, "chan_kick", [0], true), ["chan_kick"], track);
    /** The level of the hit on each side. */
    async function hit(song: MusicProject): Promise<[number, number]> {
      await engine.command("stop", {});
      await play(song);
      // The first block after a change glides there from the last song's levels: let it pass.
      await hear(STEP);
      await engine.command("play", {});
      const sound = await hear(BEAT);
      return [peakOf(sound.channels[0], 0, HIT - 1), peakOf(sound.channels[1], 0, HIT - 1)];
    }

    it("plays a channel into its track, through the track's fader and pan, and the master's", async () => {
      // A fader at half of 0 dB's travel is an eighth of the gain: 0.5 × 0.125.
      expect(await hit(updateMixerTrack(kickOn("insert_1"), "insert_1", { volume: 0.4 }))).toEqual([expect.closeTo(0.0625, 4), expect.closeTo(0.0625, 4)]);
      // Fully right, both sides end up on the right.
      expect(await hit(updateMixerTrack(kickOn("insert_1"), "insert_1", { pan: 1 }))).toEqual([expect.closeTo(0, 4), expect.closeTo(1, 4)]);
      expect(await hit(updateMixerTrack(kickOn(MASTER_TRACK_ID), MASTER_TRACK_ID, { volume: 0.4 }))).toEqual([expect.closeTo(0.0625, 4), expect.closeTo(0.0625, 4)]);
      expect(await hit(setMixerMuted(kickOn("insert_1"), ["insert_1"], true))).toEqual([0, 0]);
    });

    it("sends a track's sound on to other tracks, each at its level", async () => {
      // To the master as it is, and to insert 2 (which goes to the master too) at a quarter of the gain.
      const both = setSend(kickOn("insert_1"), "insert_1", "insert_2", 0.5);
      expect((await hit(both))[0]).toBeCloseTo(0.5 + 0.5 * 0.25, 4);
      expect((await hit(sendOnly(both, "insert_1", "insert_2")))[0]).toBeCloseTo(0.125, 4);
      expect((await hit(setMixerMuted(sendOnly(both, "insert_1", "insert_2"), ["insert_2"], true)))[0]).toBe(0);
      // Sending nowhere, it's not heard.
      expect((await hit(setSend(setSend(both, "insert_1", "insert_2", null), "insert_1", MASTER_TRACK_ID, null)))[0]).toBe(0);
    });

    it("runs a chain of tracks in order, whatever their numbers: 1 → 3 → 2 → the master", async () => {
      let song = sendOnly(kickOn("insert_1"), "insert_1", "insert_3");
      song = sendOnly(song, "insert_3", "insert_2");
      song = updateMixerTrack(song, "insert_2", { volume: 0.4 });
      song = updateMixerTrack(song, "insert_3", { volume: 0.4 });
      expect((await hit(song))[0]).toBeCloseTo(0.5 * 0.125 * 0.125, 5);
    });

    it("measures each track's loudest level on each side, after its fader, leaving silent tracks out", async () => {
      const metersOf = async (song: MusicProject) => {
        await engine.command("stop", {});
        await play(song);
        await hear(STEP);
        await engine.command("play", {});
        return (await engine.render(BEAT)).meters;
      };
      const panned = updateMixerTrack(updateMixerTrack(kickOn("insert_1"), "insert_1", { volume: 0.4 }), "insert_1", { pan: 1 });
      const meters = await metersOf(panned);
      expect(Object.keys(meters).sort()).toEqual(["insert_1", MASTER_TRACK_ID]);
      expect(meters.insert_1[0]).toBeCloseTo(0, 4);
      expect(meters.insert_1[1]).toBeCloseTo(0.125, 4);
      expect(meters[MASTER_TRACK_ID][1]).toBeCloseTo(0.125, 4);

      // A track sending only to a muted one is measured, though nothing is heard.
      const hidden = await metersOf(setMixerMuted(sendOnly(kickOn("insert_1"), "insert_1", "insert_2"), ["insert_2"], true));
      expect(Object.keys(hidden)).toEqual(["insert_1"]);
      expect(hidden.insert_1[0]).toBeCloseTo(0.5, 4);

      // What was measured is taken: stopped and silent, there's nothing.
      await engine.command("stop", {});
      await hear(STEP);
      expect((await engine.render(STEP)).meters).toEqual({});
    });

    it("adds up the selected tracks' sound for the selection meter", async () => {
      let song = addChannels(kickOn("insert_1"), [{ id: "chan_twin", name: "Twin", sampleId: "hit" }]);
      song = routeChannels(setSteps(song, P, "chan_twin", [0], true), ["chan_twin"], "insert_2");
      const measured = async (tracks: string[]) => {
        await engine.command("meterTracks", { tracks });
        await engine.command("stop", {});
        await play(song);
        await hear(STEP);
        await engine.command("play", {});
        return (await engine.render(BEAT)).meters["@selection"];
      };
      expect((await measured(["insert_1", "insert_2"]))[0]).toBeCloseTo(1, 4);
      expect((await measured(["insert_2"]))[0]).toBeCloseTo(0.5, 4);
      expect(await measured([])).toBeUndefined();
    });

    it("inverts a track's phase: the same hit on two tracks, one inverted, cancels out; swapped, it's on the other side", async () => {
      let song = addChannels(kickOn("insert_1"), [{ id: "chan_twin", name: "Twin", sampleId: "hit" }]);
      song = routeChannels(setSteps(song, P, "chan_twin", [0], true), ["chan_twin"], "insert_2");
      expect((await hit(song))[0]).toBeCloseTo(1, 4);
      expect(await hit(updateMixerTrack(song, "insert_2", { invert: true }))).toEqual([expect.closeTo(0, 5), expect.closeTo(0, 5)]);
      const swapped = updateMixerTrack(updateChannel(kickOn("insert_1"), "chan_kick", { pan: -1 }), "insert_1", { swap: true });
      expect(await hit(swapped)).toEqual([expect.closeTo(0, 5), expect.closeTo(0.5, 4)]);
    });

    it("glides to a fader's new level as it moves while playing, rather than jumping (a click)", async () => {
      const song = routeChannels(setSteps(rack(), P, "chan_pad", [0], true), ["chan_pad"], "insert_1");
      await play(song);
      await engine.command("play", {});
      const before = await hear(STEP);
      expect(peakOf(before.channels[0], STEP / 2)).toBeCloseTo(0.5, 4);
      await play(updateMixerTrack(song, "insert_1", { volume: 0.4 }));
      const after = (await hear(STEP)).channels[0];
      let jump = 0;
      for (let i = 1; i < after.length; i++) jump = Math.max(jump, Math.abs(after[i] - after[i - 1]));
      expect(jump).toBeLessThan(0.01);
      expect(after[after.length - 1]).toBeCloseTo(0.0625, 4);
    });
  });
});
