/**
 * MIDI keyboards, with the real engine offline (`engine.integration.test.ts`): what `midiIn` sends plays
 * the target channel (a plugin, or a sampler) until the key is let go, the sustain pedal holds a
 * sampler's notes, and the engine says what was played and where the song was.
 */
import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { addChannels, addPluginChannel, updateChannel } from "../../shared/music/edits.ts";
import type { EngineEvent, MidiPlayed } from "../../shared/music/engine.ts";
import { createMusicProject as newSong } from "../../shared/music/project.ts";
import type { MusicProject } from "../../shared/music/types.ts";
import { ENGINE, ENGINE_PLUGIN_PATHS } from "../config.ts";
import { DataPaths } from "../storage.ts";
import { AudioEngine } from "./engine.ts";
import { peakOf, readWav, writeWav } from "./wav.ts";

const RATE = 48_000;
const PROJECT = "proj_0123456789ab";
const built = existsSync(ENGINE) && ENGINE_PLUGIN_PATHS.every((dir) => existsSync(dir));
const noteOn = (key: number, velocity = 100) => [0x90, key, velocity];
const noteOff = (key: number) => [0x80, key, 0];

describe.skipIf(!built)("MIDI input, offline", () => {
  let dir: string;
  let engine: AudioEngine;
  let synth: { id: string; name: string; format: string };
  let played: MidiPlayed[] = [];
  let render = 0;

  const send = (song: MusicProject) => engine.setSong({ projectId: PROJECT, song, patternId: null });
  const midi = (...messages: number[][]) => engine.command("midiIn", { messages });
  async function hear(frames: number) {
    const file = path.join(dir, `midi-${render++}.wav`);
    await engine.render(frames, file);
    return (await readWav(file)).channels[0];
  }

  beforeAll(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "midi-"));
    await writeWav(path.join(dir, "long.wav"), new Float32Array(RATE * 4).fill(0.5), RATE);
    engine = new AudioEngine(new DataPaths(dir), {
      offline: true,
      onlyPluginPaths: true,
      samplePath: (_project, id) => (id === "long" ? path.join(dir, "long.wav") : null),
    });
    engine.onEvent((event: EngineEvent) => {
      if (event.event === "midi") played.push(...event.notes);
    });
    await engine.command("scan", {});
    while ((await engine.command("status", {})).scanning) await new Promise((resolve) => setTimeout(resolve, 50));
    const found = (await engine.plugins()).find((p) => p.name === "Vaudio Test Synth");
    if (!found) throw new Error("The test synth wasn't found: run `pnpm engine:build`.");
    synth = { id: found.id, name: found.name, format: found.format };
  });
  afterAll(async () => {
    engine.shutdown();
    await fs.rm(dir, { recursive: true, force: true });
  });
  beforeEach(async () => {
    await engine.command("stop", {});
    await midi([0xb0, 64, 0]);
    await engine.command("midiTarget", { channel: null });
    await hear(RATE / 2);
    played = [];
  });

  it("plays the target plugin channel until the key is let go, and says what was played", async () => {
    await send(addPluginChannel(newSong("Keys", 120), synth, "chan_synth"));
    await expect.poll(async () => (await engine.command("status", {})).channels.loaded.map((c) => c.channel)).toEqual(["chan_synth"]);

    // No target: nothing sounds, nothing's said.
    await midi(noteOn(60));
    expect(peakOf(await hear(RATE / 4))).toBe(0);
    await midi(noteOff(60));
    await hear(RATE / 10);
    expect(played).toEqual([]);

    await engine.command("midiTarget", { channel: "chan_synth" });
    await midi(noteOn(64, 127));
    const held = await hear(RATE * 2);
    // Held for as long as it's held (the Piano roll keyboard's held keys stop at 30 s; a keyboard's don't).
    expect(peakOf(held, 0, RATE / 10)).toBeGreaterThan(0.05);
    expect(peakOf(held, RATE * 1.9)).toBeGreaterThan(0.05);
    await midi(noteOff(64));
    await hear(RATE);
    expect(peakOf(await hear(RATE / 4))).toBe(0);
    expect(played).toEqual([
      { channel: "chan_synth", key: 64, velocity: 1, on: true, tick: null, counting: false, pass: 0 },
      { channel: "chan_synth", key: 64, velocity: 0, on: false, tick: null, counting: false, pass: 0 },
    ]);

    // While the song plays: where it was when each key went down, into the loop.
    played = [];
    await engine.command("play", {});
    await hear(RATE / 2);
    await midi(noteOn(60));
    await hear(RATE / 4);
    await midi(noteOff(60));
    await hear(RATE / 10);
    const [on, off] = played;
    // Half a second in at 120 BPM is a beat (96 ticks), to within a block.
    expect(on).toMatchObject({ channel: "chan_synth", key: 60, on: true });
    expect(on.tick).toBeGreaterThanOrEqual(95);
    expect(on.tick).toBeLessThan(100);
    expect(off.tick! - on.tick!).toBeGreaterThan(46);
    expect(off.tick! - on.tick!).toBeLessThan(52);
  });

  it("ends a key on the channel it started on, whatever the target is by then", async () => {
    await send(addPluginChannel(newSong("Keys", 120), synth, "chan_synth"));
    await expect.poll(async () => (await engine.command("status", {})).channels.loaded.map((c) => c.channel)).toEqual(["chan_synth"]);
    await engine.command("midiTarget", { channel: "chan_synth" });
    await midi(noteOn(67));
    await hear(RATE / 4);
    await engine.command("midiTarget", { channel: null });
    await midi(noteOff(67));
    await hear(RATE);
    expect(peakOf(await hear(RATE / 4))).toBe(0);
    expect(played.map((p) => [p.channel, p.on])).toEqual([
      ["chan_synth", true],
      ["chan_synth", false],
    ]);
  });

  it("plays a sampler: its envelope's release when the key is let go, held meanwhile by the sustain pedal", async () => {
    let song = addChannels(newSong("Pads", 120), [{ id: "chan_pad", name: "Pad", sampleId: "long" }]);
    song = updateChannel(song, "chan_pad", { envelope: { enabled: true, attack: 0, decay: 0, sustain: 1, release: 0.05 } });
    await send(song);
    await engine.command("midiTarget", { channel: "chan_pad" });

    await midi(noteOn(60));
    const sound = await hear(RATE);
    expect(peakOf(sound, 0, RATE / 10)).toBeGreaterThan(0.3);
    expect(peakOf(sound, RATE * 0.9)).toBeGreaterThan(0.3);
    await midi(noteOff(60));
    // Its release (50 ms), then silence, long before the 4 s sample would end.
    await hear(RATE / 5);
    expect(peakOf(await hear(RATE / 4))).toBe(0);

    // The pedal down: letting the key go doesn't end it, letting the pedal go does.
    await midi([0xb0, 64, 127], noteOn(62));
    await hear(RATE / 4);
    await midi(noteOff(62));
    expect(peakOf(await hear(RATE / 2))).toBeGreaterThan(0.3);
    await midi([0xb0, 64, 0]);
    await hear(RATE / 5);
    expect(peakOf(await hear(RATE / 4))).toBe(0);
  });
});
