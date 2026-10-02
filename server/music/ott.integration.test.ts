/**
 * OTT's sound (`docs/xfer/ott.md`): the real engine, offline, playing tones through an OTT on the master,
 * measured against the law the song's own TypeScript says it plays (`ottGainDb`): a band's steady gain at
 * levels across its range, the bands adding up to the sound at Depth 0, and Depth automated.
 *
 * The tones are stereo, a sine on the left and its cosine on the right: both sides' mean square is then
 * steady (as a band's envelope hears it), so the level the law is read at is exactly the tone's.
 */
import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createAutomation, editPoints } from "../../shared/music/automation.ts";
import { addChannels, setSteps } from "../../shared/music/edits.ts";
import { setEffect } from "../../shared/music/mixer.ts";
import { type OttPatch, engineOtt, ottGainDb, updateOtt, updateOttBand } from "../../shared/music/ott.ts";
import { DEFAULT_OTT, OTT_PLUGIN } from "../../shared/music/ott-presets.ts";
import { addClips, editClips } from "../../shared/music/playlist.ts";
import { FIRST_PATTERN_ID, MASTER_TRACK_ID, createMusicProject } from "../../shared/music/project.ts";
import type { MusicProject, OttBand } from "../../shared/music/types.ts";
import { ENGINE } from "../config.ts";
import { DataPaths } from "../storage.ts";
import { AudioEngine } from "./engine.ts";
import { type WavData, readWav, writeWavChannels } from "./wav.ts";

const RATE = 48_000;
const P = FIRST_PATTERN_ID;
const PROJECT = "proj_0123456789ab";
const OTT = "fx_ott";
const TICKS = 384;
/** Each band's tone (Hz), well inside it: the crossovers are 88.3 Hz and 2.5 kHz. */
const TONES = { low: 30, mid: 470, high: 10_000 } as const;
/** The levels the tones are made at (dB of full scale, a sine's peak). */
const LEVELS = [-60, -45, -30, -15, -6];

const db = (gain: number) => 20 * Math.log10(gain);
function rms(samples: Float32Array, from: number, to: number): number {
  let sum = 0;
  for (let i = from; i < to; i++) sum += samples[i] * samples[i];
  return Math.sqrt(sum / (to - from));
}
/** Both sides' level (their mean square, in dB) over `[from, to)`: what a band's envelope hears. */
const levelOf = (wav: WavData, from: number, to: number) => 10 * Math.log10((rms(wav.channels[0], from, to) ** 2 + rms(wav.channels[1], from, to) ** 2) / 2);

describe.skipIf(!existsSync(ENGINE))("OTT, offline", () => {
  let dir: string;
  let engine: AudioEngine;
  let render = 0;

  async function hear(frames: number): Promise<WavData> {
    const file = path.join(dir, `render-${render++}.wav`);
    await engine.render(frames, file);
    return readWav(file);
  }
  /** A song at 120 BPM playing `sample` from its start (a pattern long enough to play it once), an OTT on the master. */
  function song(sample: string, patch: OttPatch = {}, bands?: Partial<OttBand>[]): MusicProject {
    let s = addChannels(createMusicProject("Squash", 120), [{ id: "chan_tone", name: "Tone", sampleId: sample }]);
    s = setSteps(s, P, "chan_tone", [0], true);
    s = { ...s, patterns: s.patterns.map((p) => (p.id === P ? { ...p, length: 8 * TICKS } : p)) };
    s = setEffect(s, MASTER_TRACK_ID, 0, OTT_PLUGIN, OTT);
    s = updateOtt(s, OTT, patch);
    bands?.forEach((band, k) => (s = updateOttBand(s, OTT, k, band)));
    return s;
  }
  /** Let go of the last song's OTT: the next starts afresh. */
  async function fresh() {
    await engine.command("stop", {});
    await engine.setSong({ projectId: PROJECT, song: createMusicProject("Silence", 120), patternId: P, mode: "pattern" });
    await hear(RATE / 10);
  }
  async function played(s: MusicProject, frames: number, mode: "pattern" | "song" = "pattern") {
    await fresh();
    await engine.setSong({ projectId: PROJECT, song: s, patternId: P, mode });
    await engine.command("play", {});
    return hear(frames);
  }
  /** The other two bands out of the way: their compressors off and turned down, so only `band`'s sound counts. */
  const only = (band: number): Partial<OttBand>[] => [0, 1, 2].map((k) => (k === band ? {} : { upward: false, downward: false, gain: -24 }));

  beforeAll(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "ott-"));
    // Two seconds of each band's tone at each level (sine left, cosine right), and all three at once.
    for (const [name, hz] of Object.entries(TONES))
      for (const level of LEVELS) {
        const a = 10 ** (level / 20);
        const w = (2 * Math.PI * hz) / RATE;
        await writeWavChannels(
          path.join(dir, `${name}${-level}.wav`),
          [Float32Array.from({ length: 2 * RATE }, (_, i) => a * Math.sin(w * i)), Float32Array.from({ length: 2 * RATE }, (_, i) => a * Math.cos(w * i))],
          RATE,
        );
      }
    const mixed = (ch: number) =>
      Float32Array.from({ length: 2 * RATE }, (_, i) => Object.values(TONES).reduce((sum, hz) => sum + 0.2 * (ch ? Math.cos : Math.sin)((2 * Math.PI * hz * i) / RATE), 0));
    await writeWavChannels(path.join(dir, "chord.wav"), [mixed(0), mixed(1)], RATE);
    engine = new AudioEngine(new DataPaths(dir), {
      offline: true,
      onlyPluginPaths: true,
      pluginPaths: [],
      samplePath: (_project, id) => path.join(dir, `${id}.wav`),
    });
  });
  afterAll(async () => {
    engine.shutdown();
    await fs.rm(dir, { recursive: true, force: true });
  });
  beforeEach(fresh);

  it("leaves the sound as it is at Depth 0: its bands add back up to it", async () => {
    const sound = await played(song("chord", { depth: 0 }), RATE * 2);
    const input = 10 * Math.log10(3 * 0.2 ** 2 * 0.5 * 2 / 2);
    expect(levelOf(sound, RATE / 2, RATE)).toBeCloseTo(input, 1);
    // An all-pass of it: as loud on each side, whatever the phases.
    expect(db(rms(sound.channels[0], RATE / 2, RATE) / rms(sound.channels[1], RATE / 2, RATE))).toBeCloseTo(0, 1);
  });

  it.each(["mid", "high"] as const)("gives the %s band the law's gain at every level, to within 0.25 dB", async (name) => {
    const band = name === "mid" ? 1 : 2;
    const law = engineOtt({ ...DEFAULT_OTT }).bands[band];
    for (const level of LEVELS) {
      const sound = await played(song(`${name}${-level}`, {}, only(band)), RATE * 1.5);
      // Its mean square: a full-scale sine's is -3 dB.
      const heard = level - 3.0103;
      const measured = levelOf(sound, RATE, RATE * 1.4) - heard;
      expect(Math.abs(measured - ottGainDb(law, heard)), `${name} at ${level} dB: ${measured.toFixed(2)} dB, the law ${ottGainDb(law, heard).toFixed(2)}`).toBeLessThan(0.25);
    }
  });

  it("brings a quiet low band up and holds a loud one down, much as the law says", async () => {
    const law = engineOtt(DEFAULT_OTT).bands[0];
    for (const level of [-60, -6]) {
      const sound = await played(song(`low${-level}`, {}, only(0)), RATE * 1.5);
      const heard = level - 3.0103;
      // 30 Hz is near the crossover's skirt: the law within a dB.
      expect(Math.abs(levelOf(sound, RATE, RATE * 1.4) - heard - ottGainDb(law, heard))).toBeLessThan(1);
    }
  });

  it("follows its band gains, Out Gain and In Gain", async () => {
    const plain = await played(song("mid30", {}, only(1)), RATE * 1.5);
    const louder = await played(song("mid30", { output: 6 }, [{ upward: false, downward: false, gain: -24 }, { gain: 3 }, { upward: false, downward: false, gain: -24 }]), RATE * 1.5);
    expect(levelOf(louder, RATE, RATE * 1.4) - levelOf(plain, RATE, RATE * 1.4)).toBeCloseTo(9, 1);
    // In Gain moves the tone along the law (+10 dB in: the level the law is read at is 10 dB up).
    const law = engineOtt(DEFAULT_OTT).bands[1];
    const pushed = await played(song("mid30", { input: 10 }, only(1)), RATE * 1.5);
    expect(levelOf(pushed, RATE, RATE * 1.4) - (-30 - 3.0103 + 10)).toBeCloseTo(ottGainDb(law, -30 - 3.0103 + 10), 0);
  });

  it("plays its automated Depth, from untouched to all of it", async () => {
    let s = song("mid30", {}, only(1));
    s = editClips(s, (clips) => addClips(clips, [{ kind: "pattern", ref: P, track: 0, start: 0, length: TICKS * 2 }]).clips);
    const made = createAutomation(s, { kind: "ott", effect: OTT, control: "depth" }, { start: 0, length: TICKS * 2 });
    // Depth 0 for the first half bar (a second), all of it after.
    s = editPoints(made.song, made.automationId, () => [
      { tick: 0, value: 0, tension: 0, curve: "single" },
      { tick: TICKS / 2, value: 0, tension: 0, curve: "single" },
      { tick: TICKS / 2, value: 1, tension: 0, curve: "single" },
      { tick: TICKS * 2, value: 1, tension: 0, curve: "single" },
    ]);
    const sound = await played(s, RATE * 2, "song");
    const heard = -30 - 3.0103;
    expect(levelOf(sound, RATE / 2, RATE * 0.9) - heard).toBeCloseTo(0, 1);
    const law = engineOtt(DEFAULT_OTT).bands[1];
    expect(Math.abs(levelOf(sound, RATE * 1.5, RATE * 1.9) - heard - ottGainDb(law, heard))).toBeLessThan(0.25);
  });
});
