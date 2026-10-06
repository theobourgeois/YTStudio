import { describe, expect, it } from "vitest";
import {
  AUTO_RANGE_DB,
  NEVER,
  beatAt,
  createSignalReader,
  resolveSource,
  signalValue,
  sourceHits,
  usesSignals,
  withSignals,
} from "./audio-signals.ts";
import { VOLUME, expressionProblem, opacityAt, setExpression, solidEffects } from "./effects.ts";
import { defaultEffects } from "./effects.ts";
import { SignalAnalyser } from "./signals/analyse.ts";
import type { SignalData } from "./signals/format.ts";
import { MAIN_TRACK_ID, createDefaultProject } from "./timeline.ts";
import type { Clip, MusicAnalysis, Project } from "./types.ts";
import { OPACITY } from "./effects.ts";

const RATE = 48_000;

/** A kick every half second from 0.25 s (a falling sine, as in analyse.test.ts), `seconds` long. */
function kickSong(seconds: number, rhythm: MusicAnalysis | null = null): SignalData {
  const n = seconds * RATE;
  const samples = new Float32Array(n * 2);
  for (let i = 0; i < n; i++) {
    const t = i / RATE;
    const since = t < 0.25 ? -1 : (t - 0.25) % 0.5;
    const v = since < 0 ? 0 : 0.9 * Math.sin(2 * Math.PI * (50 * since + (100 / 30) * (1 - Math.exp(-30 * since)))) * Math.exp(-since / 0.05);
    samples[i * 2] = v;
    samples[i * 2 + 1] = v;
  }
  const a = new SignalAnalyser(RATE, seconds);
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
const song = kickSong(4, rhythm);
const store = new Map([["song", song]]);

const base = createDefaultProject();
const audioTrack = { id: "a1", kind: "audio" as const, name: "Music", muted: false };
/** The song from 0.5 s in its file, at 2 s on the timeline: file time f is at timeline f + 1.5. */
const songClip = (over: Partial<Clip> = {}): Clip => ({ id: "s", assetId: "song", trackId: "a1", start: 2, in: 0.5, out: 4, effects: defaultEffects(), ...over });
const solid: Clip = { id: "solid", assetId: "", trackId: MAIN_TRACK_ID, start: 0, in: 0, out: 6, effects: solidEffects() };
const project = (clips: Clip[], over: Partial<Project> = {}): Project => ({
  ...base,
  tracks: [...base.tracks.filter((t) => t.kind === "video"), audioTrack],
  clips,
  ...over,
});
const reader = (p: Project) => createSignalReader(p, store);
const MASTER = { kind: "master" } as const;

describe("signals on the timeline", () => {
  const p = project([songClip(), solid]);

  it("reads a file where its clip plays it, and nothing elsewhere", () => {
    // File time 0.75 (a kick) is at 2.25 on the timeline; 1.0 (between kicks) at 2.5.
    const onKick = signalValue(reader(p), null, MASTER, "bass", 2.27);
    const between = signalValue(reader(p), null, MASTER, "bass", 2.7);
    expect(onKick).toBeGreaterThan(0.8);
    expect(between).toBeLessThan(onKick - 0.3);
    expect(signalValue(reader(p), null, MASTER, "bass", 1)).toBe(0);
    expect(signalValue(reader(p), null, MASTER, "bass", 5.6)).toBe(0);
  });

  it("follows the clip's Volume (24 dB under its loud parts is 0)", () => {
    const loud = signalValue(reader(p), null, MASTER, "level", 2.27);
    const quieter = project([songClip({ effects: defaultEffects().map((e) => (e.type === VOLUME.type ? { ...e, params: { level: 0.5 } } : e)) })]);
    const half = signalValue(reader(quieter), null, MASTER, "level", 2.27);
    expect(loud - half).toBeCloseTo(6.02 / AUTO_RANGE_DB, 2);
  });

  it("leaves a muted track out of the mix, but it can still be listened to", () => {
    const muted = project([songClip()], { tracks: [...base.tracks.filter((t) => t.kind === "video"), { ...audioTrack, muted: true }] });
    expect(signalValue(reader(muted), null, MASTER, "bass", 2.27)).toBe(0);
    const track = resolveSource(muted, "Music");
    expect(track).toEqual({ kind: "track", trackId: "a1" });
    expect(signalValue(reader(muted), null, track, "bass", 2.27)).toBeGreaterThan(0.8);
  });

  it("puts the file's hits on the timeline, inside what the clip plays", () => {
    const kicks = sourceHits(reader(p), null, MASTER, "onsetLow").map(([t]) => t);
    // File kicks at 0.75, 1.25 ... 3.75 (0.25 is before the clip's in-point): timeline + 1.5.
    expect(kicks.map((t) => Math.round(t * 100) / 100)).toEqual([2.25, 2.75, 3.25, 3.75, 4.25, 4.75, 5.25]);
    // Twice as fast: half as far apart.
    const fast = sourceHits(reader(project([songClip({ speed: 2 })])), null, MASTER, "onsetLow").map(([t]) => Math.round(t * 100) / 100);
    expect(fast.slice(0, 3)).toEqual([2.13, 2.38, 2.63]);
  });

  it("sums two sounds' energies: the same song twice is 3 dB louder", () => {
    const twice = project([songClip(), songClip({ id: "s2", trackId: "a2" })], {
      tracks: [...base.tracks.filter((t) => t.kind === "video"), audioTrack, { ...audioTrack, id: "a2", name: "Copy" }],
    });
    const one = signalValue(reader(p), null, { kind: "clip", clipId: "s" }, "bass", 2.6);
    const both = signalValue(reader(twice), null, MASTER, "bass", 2.6);
    // Both the energy and what counts as loud double: the value is the same.
    expect(both).toBeCloseTo(one, 5);
  });

  it("hears a nested sequence's sound in the sequence it's in", () => {
    const inner = { id: "seq_inner", name: "Inner", settings: base.settings, tracks: [audioTrack], clips: [songClip({ start: 0, in: 0 })] };
    const nest: Clip = { id: "nest", assetId: "seq_inner", trackId: MAIN_TRACK_ID, start: 1, in: 0, out: 4, effects: defaultEffects() };
    const outer = project([nest], { sequences: [inner] });
    // File 0.75 is at 0.75 in the nest, 1.75 outside.
    expect(signalValue(reader(outer), null, MASTER, "bass", 1.77)).toBeGreaterThan(0.8);
    expect(sourceHits(reader(outer), null, MASTER, "onsetLow")[1][0]).toBeCloseTo(1.75, 2);
    expect(signalValue(reader(outer), "seq_inner", MASTER, "bass", 0.77)).toBeGreaterThan(0.8);
  });

  it("finds the beat of the song playing", () => {
    const beat = beatAt(reader(p), null, 3.0);
    // File beats from 0.75 (the first inside the clip) are at 2.25, 2.75, 3.25...
    expect(beat.bpm).toBe(120);
    expect(beat.beat).toBeCloseTo(1.5, 5);
    expect(beat.since).toBeCloseTo(0.25, 5);
    // The drop (file 2.25) is at 3.75: none yet, then a quarter second after it.
    expect(beat.sinceDrop).toBe(NEVER);
    expect(beatAt(reader(p), null, 4).sinceDrop).toBeCloseTo(0.25, 5);
    expect(beatAt(reader(p), null, 1).since).toBe(NEVER);
  });

  it("names sources", () => {
    expect(resolveSource(p, undefined)).toEqual(MASTER);
    expect(resolveSource(p, "master")).toEqual(MASTER);
    expect(resolveSource(p, 1)).toEqual({ kind: "track", trackId: "a1" });
    expect(resolveSource(p, "s")).toEqual({ kind: "clip", clipId: "s" });
    expect(resolveSource(p, "self", solid)).toEqual({ kind: "clip", clipId: "solid" });
    expect(() => resolveSource(p, "drums")).toThrow(/no track or clip "drums".*"Music"/);
  });
});

describe("expressions that react to sound", () => {
  const withOpacity = (source: string) => setExpression(project([songClip(), solid]), "solid", OPACITY.type, "opacity", source);
  const opacity = (p: Project, t: number) => withSignals(reader(p), () => opacityAt(p.clips.find((c) => c.id === "solid")!, t));

  it("reads the mix's signals at the clip's moment", () => {
    const p = withOpacity('audio("bass")');
    expect(opacity(p, 2.27)).toBeGreaterThan(0.8);
    expect(opacity(p, 1)).toBe(0);
    expect(usesSignals(p)).toBe(true);
    expect(usesSignals(project([solid]))).toBe(false);
  });

  it("punches on every kick with sinceHit and envelope", () => {
    const p = withOpacity('envelope(sinceHit("onsetLow"), 0, 0.2)');
    expect(opacity(p, 2.26)).toBeGreaterThan(0.9);
    expect(opacity(p, 2.36)).toBeCloseTo(0.5, 1);
    expect(opacity(p, 2.5)).toBe(0);
    expect(opacity(p, 1)).toBe(0);
  });

  it("counts beats", () => {
    expect(opacity(withOpacity("beatPhase()"), 3.0)).toBeCloseTo(0.5, 5);
    expect(opacity(withOpacity("hitCount('onsetLow') / 10"), 3.0)).toBeCloseTo(0.2, 5);
  });

  it("reads silence where the sound can't be heard, and says what's wrong with a bad name", () => {
    const p = withOpacity('audio("bass")');
    expect(opacityAt(p.clips.find((c) => c.id === "solid")!, 2.27)).toBe(0);
    const bad = withOpacity('audio("kick")');
    const clip = bad.clips.find((c) => c.id === "solid")!;
    const problem = withSignals(reader(bad), () => expressionProblem(OPACITY, clip.effects.find((e) => e.type === "opacity")!, "opacity", 2.27, clip));
    expect(problem).toMatch(/no signal "kick". Signals: level, peak/);
  });
});
