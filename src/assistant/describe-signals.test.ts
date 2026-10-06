import { describe, expect, it } from "vitest";
import { MASTER, createSignalReader } from "@shared/audio-signals";
import { defaultEffects } from "@shared/effects";
import { SignalAnalyser } from "@shared/signals/analyse";
import { createDefaultProject } from "@shared/timeline";
import type { Clip, MusicAnalysis, Project } from "@shared/types";
import { describeSignals, eventTimes } from "./describe-signals";

const RATE = 48_000;

/** Kicks every half second from 0.25 s, four seconds of them. */
function kicks(rhythm: MusicAnalysis) {
  const n = 4 * RATE;
  const samples = new Float32Array(n * 2);
  for (let i = 0; i < n; i++) {
    const t = i / RATE;
    const since = t < 0.25 ? -1 : (t - 0.25) % 0.5;
    const v = since < 0 ? 0 : 0.9 * Math.sin(2 * Math.PI * 60 * since) * Math.exp(-since / 0.05);
    samples[i * 2] = samples[i * 2 + 1] = v;
  }
  const a = new SignalAnalyser(RATE, 4);
  a.push(samples);
  return a.finish(rhythm);
}

const rhythm: MusicAnalysis = {
  bpm: 120,
  confidence: 0.9,
  beats: [0.25, 0.75, 1.25, 1.75, 2.25, 2.75, 3.25, 3.75],
  downbeats: [0.25, 2.25],
  sections: [{ start: 0, end: 4, db: -6, level: 1 }],
  drops: [{ time: 2.25, rise: 6 }],
};
const base = createDefaultProject();
const song: Clip = { id: "song", assetId: "s", trackId: "audio_1", start: 0, in: 0, out: 4, effects: defaultEffects() };
const project: Project = { ...base, clips: [song] };
const reader = createSignalReader(project, new Map([["s", kicks(rhythm)]]));

describe("get_signals", () => {
  it("says what sounds, the beat, every hit and the level's shape", () => {
    const text = describeSignals(reader, null, { source: MASTER, label: "The whole mix", from: 0, to: 4, signals: [], hasAudio: () => true });
    expect(text).toContain('Sounds: song on "Audio 1" 0–4s, 120 BPM (sure 0.90)');
    expect(text).toContain("Beat (of song): 120.0 BPM, 8 beats here from 0.25s, a beat every 0.5s");
    expect(text).toContain("Bars start at: 0.25, 2.25");
    expect(text).toContain("Drops (the energy jumps up): 2.25");
    expect(text).toMatch(/onsetLow \(kicks, below 150 Hz\): 8: 0\.2\d* \(\d\.\d\d\), 0\.75/);
    expect(text).toMatch(/Level every 0\.5s from 0s: /);
  });

  it("lists values when asked, and refuses signals that don't exist", () => {
    const text = describeSignals(reader, null, { source: MASTER, label: "The whole mix", from: 0.2, to: 0.4, signals: ["bass", "onsetLow"], step: 0.05, hasAudio: () => true });
    expect(text).toContain("t\tbass\tonsetLow");
    expect(text.split("\n").filter((l) => /^0\.\d+\t/.test(l))).toHaveLength(5);
    expect(() => describeSignals(reader, null, { source: MASTER, label: "", from: 0, to: 1, signals: ["kick"], hasAudio: () => true })).toThrow(/no signal "kick"/);
  });

  it("finds moments to look at: beats, bars, drops and hits", () => {
    expect(eventTimes(reader, null, MASTER, "bars", 0, 4)).toEqual([0.25, 2.25]);
    expect(eventTimes(reader, null, MASTER, "beats", 1, 2)).toEqual([1.25, 1.75]);
    expect(eventTimes(reader, null, MASTER, "onsetLow", 0, 1).map((t) => Math.round(t * 100) / 100)).toEqual([0.25, 0.75]);
    expect(() => eventTimes(reader, null, MASTER, "snares", 0, 1)).toThrow(/`at` must be/);
  });
});
