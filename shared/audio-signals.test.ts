import { describe, expect, it } from "vitest";
import {
  AUTO_RANGE_DB,
  NEVER,
  beatAt,
  createSignalReader,
  linkLevel,
  resolveSource,
  signalValue,
  sourceHits,
  audioInputs,
  demoAudio,
  nestedHearing,
  usesSignals,
  visualizerSource,
  withHearing,
  withSignals,
} from "./audio-signals.ts";
import { VOLUME, expressionProblem, opacityAt, setExpression, setLink, setParams, solidEffects, visualizerEffects } from "./effects.ts";
import { effectPasses } from "./effect-gl.ts";
import { allClips } from "./sequences.ts";
import { defaultEffects } from "./effects.ts";
import { SignalAnalyser } from "./signals/analyse.ts";
import type { SignalData } from "./signals/format.ts";
import { MAIN_TRACK_ID, createDefaultProject } from "./timeline.ts";
import type { Clip, MusicAnalysis, ParamLink, Project, SignalDef } from "./types.ts";
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

  it("hears a song's own beat (Make visualizer's tempo) over the analysis's, wherever its clip goes, speeding up as it does", () => {
    // The song's beat, in its file: at 0.3 s, then every 0.4 s, then every 0.2 s from 1.9 s (it doubles), three to a bar.
    const beats = [0.3, 0.7, 1.1, 1.5, 1.9, 2.1, 2.3, 2.5, 2.7];
    const exact = project([songClip(), solid], { tempo: { assetIds: ["song"], beatsPerBar: 3, beats } });
    // File 1.1 is at timeline 2.6.
    const beat = beatAt(reader(exact), null, 2.6);
    expect(beat.beat).toBeCloseTo(1, 5);
    expect(beat.bpm).toBeCloseTo(150, 5);
    expect(beat.since).toBeCloseTo(0, 5);
    // Faster after the change: a beat every 0.2 s, so 300 BPM; bars from the song's first beat, three beats each.
    expect(beatAt(reader(exact), null, 3.5).bpm).toBeCloseTo(300, 5);
    // Downbeats at file 1.5 and 2.3: timeline 3.0 and 3.8.
    expect(beatAt(reader(exact), null, 3.4).bar).toBeCloseTo(0.5, 5);
    expect(beatAt(reader(exact), null, 3.8).bar).toBeCloseTo(1, 5);
    // Moved and sped up, it keeps its own beat.
    const moved = project([songClip({ start: 0, speed: 2 }), solid], { tempo: exact.tempo });
    expect(beatAt(reader(moved), null, 0.3).since).toBeCloseTo(0, 5);
    expect(beatAt(reader(moved), null, 0.3).bpm).toBeCloseTo(300, 5);
    // Before its file's signals are even loaded.
    expect(beatAt(createSignalReader(exact, new Map()), null, 2.6).bpm).toBeCloseTo(150, 5);
    // Another file's clip isn't the song's: the analysis is still what it hears.
    const other = project([songClip(), solid], { tempo: { assetIds: ["another"], beatsPerBar: 3, beats } });
    expect(beatAt(reader(other), null, 3.0).bpm).toBe(120);
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

describe("links: parameters that follow a signal", () => {
  const response = { threshold: 0, curve: 1, attack: 0, release: 0, invert: false };
  /** The solid at opacity 0, linked to add `link`'s signal. */
  const linked = (link: Partial<ParamLink>, over: Partial<Project> = {}, clips: Clip[] = [songClip(), solid]) =>
    setLink(
      setParams(project(clips, over), "solid", OPACITY.type, { opacity: 0 }, 0),
      "solid",
      OPACITY.type,
      "opacity",
      { signal: { name: "bass" }, mode: "add", amount: 1, response, ...link },
    );
  const opacity = (p: Project, t: number, clipId = "solid") => withSignals(reader(p), () => opacityAt(allClips(p).find((c) => c.id === clipId)!, t));

  it("moves with the sound, and says the video uses signals", () => {
    const p = linked({});
    expect(opacity(p, 2.27)).toBeCloseTo(signalValue(reader(p), null, MASTER, "bass", 2.27), 1);
    expect(opacity(p, 1)).toBe(0);
    expect(usesSignals(p)).toBe(true);
  });

  it("falls in its release, and the value doesn't depend on what was read before", () => {
    const slow = linked({ response: { ...response, release: 0.5 } });
    const fast = linked({});
    // Between kicks the bass has gone, but a slow release still holds some.
    expect(opacity(slow, 2.7)).toBeGreaterThan(opacity(fast, 2.7) + 0.2);
    const cold = opacity(linked({ response: { ...response, release: 0.5 } }), 5.1);
    for (let t = 0; t < 5.1; t += 0.05) opacity(slow, t);
    expect(opacity(slow, 5.1)).toBeCloseTo(cold, 4);
  });

  it("punches on each kick with a hit shape, and pulses on the beat", () => {
    const punch = linked({ signal: { name: "onsetLow" }, hit: { attack: 0, hold: 0, decay: 0.2 } });
    expect(opacity(punch, 2.26)).toBeGreaterThan(0.9);
    expect(opacity(punch, 2.36)).toBeCloseTo(0.5, 1);
    expect(opacity(punch, 2.5)).toBe(0);
    const beat = linked({ signal: { name: "beat" }, hit: { attack: 0, hold: 0, decay: 0.1 } });
    // Beats at 2.25, 2.75...
    expect(opacity(beat, 2.3)).toBeCloseTo(0.5, 5);
    expect(opacity(beat, 2.5)).toBe(0);
  });

  it("reads a song's intensity: how much is going on, worked out from its signals", () => {
    const p = project([songClip(), solid]);
    // Kicks every half second: something's going on while the clip plays, nothing before it.
    expect(signalValue(reader(p), null, MASTER, "intensity", 4.5)).toBeGreaterThan(0.2);
    expect(signalValue(reader(p), null, MASTER, "intensity", 1)).toBe(0);
    const followed = linked({ signal: { name: "intensity" } });
    expect(opacity(followed, 4.5)).toBeGreaterThan(0.2);
  });

  it("moves as far as its depth says: a punch scaled by how intense the music is", () => {
    const hit = { attack: 0, hold: 0, decay: 0.2 };
    const full = linked({ signal: { name: "onsetLow" }, hit });
    const scaled = linked({ signal: { name: "onsetLow" }, hit, depth: { signal: { name: "intensity" }, floor: 0, threshold: 0 } });
    const floored = linked({ signal: { name: "onsetLow" }, hit, depth: { signal: { name: "intensity" }, floor: 0.5, threshold: 0 } });
    const gated = linked({ signal: { name: "onsetLow" }, hit, depth: { signal: { name: "intensity" }, floor: 0, threshold: 0.99 } });
    const t = 4.26;
    const level = signalValue(reader(full), null, MASTER, "intensity", t);
    expect(level).toBeGreaterThan(0.1);
    expect(level).toBeLessThan(0.95);
    expect(opacity(scaled, t)).toBeLessThan(opacity(full, t) - 0.05);
    expect(opacity(floored, t)).toBeGreaterThan(opacity(scaled, t));
    expect(opacity(gated, t)).toBe(0);
  });

  it("inverts, and multiplies or maps", () => {
    expect(opacity(linked({ response: { ...response, invert: true } }), 1)).toBe(1);
    const p = setParams(linked({ mode: "map", to: 0.2 }), "solid", OPACITY.type, { opacity: 1 }, 0);
    expect(opacity(p, 1)).toBe(1);
    expect(opacity(p, 2.27)).toBeLessThan(0.4);
  });

  it("follows the video's own signals: hits, bands with onsets, curves", () => {
    const events: SignalDef = { id: "sig_k", name: "Kick", color: "#ffffff", kind: "events", events: [{ time: 1, velocity: 0.8 }] };
    const band: SignalDef = { id: "sig_b", name: "Thump", color: "#ffffff", kind: "band", source: MASTER, low: 40, high: 120, gain: 0, threshold: 0.5, attack: 0, release: 0.05, curve: 1, autoGain: true, onsets: true };
    const curve: SignalDef = { id: "sig_c", name: "Ramp", color: "#ffffff", kind: "curve", points: [{ time: 0, value: 0 }, { time: 4, value: 1 }] };
    const p = (def: SignalDef, link: Partial<ParamLink> = {}) => linked({ signal: { id: def.id }, ...link }, { signals: [events, band, curve] });
    expect(opacity(p(events), 1.1)).toBeCloseTo(0.8 * (1 - 0.095 / 0.25), 5);
    expect(opacity(p(events), 0.9)).toBe(0);
    expect(opacity(p(band), 2.27)).toBeGreaterThan(0.3);
    expect(opacity(p(band), 2.6)).toBeLessThan(0.02);
    // The band's onsets: where it rises out of silence, on each kick (2.25, 2.75, 3.25, 3.75).
    const counted = (source: string, t: number) => opacity(setExpression(p(band), "solid", OPACITY.type, "opacity", source), t);
    expect(counted('hitCount("Thump") / 10', 3.9)).toBeCloseTo(0.4, 5);
    expect(counted('sinceHit("Thump")', 2.3)).toBeGreaterThan(0.02);
    expect(counted('sinceHit("Thump")', 2.3)).toBeLessThan(0.06);
    expect(opacity(p(band, { hit: { attack: 0, hold: 0, decay: 0.2 } }), 2.28)).toBeGreaterThan(0.3);
    expect(opacity(p(curve), 2)).toBeCloseTo(0.5, 5);
    // A link to a signal that was deleted moves nothing.
    expect(opacity(linked({ signal: { id: "gone" } }), 2.27)).toBe(0);
  });

  it("reads the video's own signals in expressions", () => {
    const events: SignalDef = { id: "sig_k", name: "Kick", color: "#ffffff", kind: "events", events: [{ time: 1, velocity: 1 }, { time: 2, velocity: 1 }] };
    const p = (source: string) => setExpression(project([solid], { signals: [events] }), "solid", OPACITY.type, "opacity", source);
    expect(opacity(p('sinceHit("Kick")'), 2.5)).toBeCloseTo(0.5, 5);
    expect(opacity(p('hitCount("kick") / 10'), 2.5)).toBeCloseTo(0.2, 5);
    expect(opacity(p('signal("Kick")'), 1.05)).toBeCloseTo(1 - 0.045 / 0.25, 5);
    const clip = p('signal("Snare")').clips[0];
    const problem = withSignals(reader(p('signal("Snare")')), () => expressionProblem(OPACITY, clip.effects.find((e) => e.type === "opacity")!, "opacity", 1, clip));
    expect(problem).toMatch(/no signal "Snare". This video's signals: "Kick"/);
  });

  it("hears the song of the video a nest is placed in, wherever it's placed", () => {
    // A look (a solid linked to the bass) in a nest of its own, placed at 1 s and at 3 s over the song.
    const look = setLink(
      setParams(project([solid]), "solid", OPACITY.type, { opacity: 0 }, 0),
      "solid",
      OPACITY.type,
      "opacity",
      { signal: { name: "bass" }, mode: "add", amount: 1, response },
    );
    const seq = { id: "seq_look", name: "Look", settings: base.settings, tracks: look.tracks, clips: look.clips };
    const use = (id: string, start: number): Clip => ({ id, assetId: "seq_look", trackId: MAIN_TRACK_ID, start, in: 0, out: 2, effects: defaultEffects() });
    const outer = project([use("first", 0.5), use("second", 2.5), songClip()], { sequences: [seq] });
    const r = reader(outer);
    const lookSolid = look.clips[0];
    // Drawn nowhere in particular, it hears where it's first used: its 1.77 is the song's 2.27 (a kick).
    expect(withSignals(r, () => opacityAt(lookSolid, 1.77))).toBeGreaterThan(0.8);
    // Drawn in its second use, its 1.77 is the song's 4.27 (also a kick), its 0.0 the song's 2.5 (none).
    const second = outer.clips.find((c) => c.id === "second")!;
    const inSecond = (t: number) => withSignals(r, () => withHearing(nestedHearing(second, null), () => opacityAt(lookSolid, t)));
    expect(inSecond(1.77)).toBeGreaterThan(0.8);
    expect(inSecond(0.2)).toBeLessThan(0.2);
    expect(withSignals(r, () => opacityAt(lookSolid, 0.2))).toBe(0);
  });
});

describe("what a visualizer hears", () => {
  const p = project([songClip(), solid]);
  const ask = { rows: 4, span: 0.3, fall: 0, window: 0.02 };

  it("reads the spectrum now and before, the sound around now, levels and the last hits", () => {
    const a = audioInputs(reader(p), null, MASTER, 2.27, { ...ask, hits: "onsetLow" }, 30);
    expect(a.rows).toBe(4);
    expect(a.spectrum).toHaveLength(4 * 96);
    // The kick's lows are loud now; the highs aren't.
    const low = Math.max(...a.spectrum.slice(5, 20));
    const high = Math.max(...a.spectrum.slice(80, 96));
    expect(low).toBeGreaterThan(0.7);
    expect(high).toBeLessThan(low - 0.3);
    // 0.3 s before (row 3, at 1.97: before the song starts at 2) it was silent.
    expect(Math.max(...a.spectrum.slice(3 * 96, 4 * 96))).toBe(0);
    expect(a.wave).toHaveLength(512 * 2);
    expect(Math.max(...a.wave.map(Math.abs))).toBeGreaterThan(0.2);
    expect(a.scalars.bass).toBeGreaterThan(0.8);
    expect(a.scalars.bpm).toBe(120);
    // The kick at 2.25 is the last hit, 0.02 s ago.
    expect(a.hits[0][0]).toBeCloseTo(0.02, 1);
  });

  it("falls away over `fall` seconds, and hears silence where there's no sound", () => {
    const now = audioInputs(reader(p), null, MASTER, 2.6, { ...ask, rows: 1, window: 0 }, 30);
    const falling = audioInputs(reader(p), null, MASTER, 2.6, { ...ask, rows: 1, fall: 0.5, window: 0 }, 30);
    expect(Math.max(...falling.spectrum.slice(0, 20))).toBeGreaterThan(Math.max(...now.spectrum.slice(0, 20)) + 0.1);
    const quiet = audioInputs(reader(p), null, MASTER, 1, ask, 30);
    expect(Math.max(...quiet.spectrum)).toBe(0);
    expect(quiet.wave.every((v) => v === 0)).toBe(true);
    expect(quiet.hits).toEqual([]);
  });

  it("chooses its hits, and maps its source parameter", () => {
    expect(audioInputs(reader(p), null, MASTER, 2.27, { ...ask, hits: "onsetHigh" }, 30).hits).toEqual([]);
    expect(visualizerSource("self", "c1")).toEqual({ kind: "clip", clipId: "c1" });
    expect(visualizerSource("t:a1", "c1")).toEqual({ kind: "track", trackId: "a1" });
    expect(visualizerSource("master", "c1")).toEqual(MASTER);
  });

  it("gives cards made-up sound that's the same every time", () => {
    expect(demoAudio(1.3, ask)).toEqual(demoAudio(1.3, ask));
    expect(demoAudio(1.3, ask).spectrum.some((v) => v > 0.5)).toBe(true);
  });

  it("is what a visualizer's pass carries, from its clip's moment", () => {
    const bars = visualizerEffects();
    const clip: Clip = { ...solid, effects: bars };
    const passes = withSignals(reader(project([songClip(), clip])), () => effectPasses(clip, 2.27, 30));
    expect(passes).toHaveLength(1);
    expect(Math.max(...passes[0].audio!.spectrum.slice(0, 30))).toBeGreaterThan(0.7);
    expect(bars.find((e) => e.type === "audio-bars")?.params.blendMode).toBe("replace");
    // The export reads the sound for it.
    expect(usesSignals(project([clip]))).toBe(true);
    // Without a reader, silence (cards get made-up sound instead).
    expect(Math.max(...effectPasses(clip, 2.27, 30)[0].audio!.spectrum)).toBe(0);
  });
});

describe("signals heard live", () => {
  it("follow on from frame to frame as a fresh warm-up would", () => {
    const p = project([songClip(), solid]);
    const link = { signal: { name: "bass" as const }, response: { threshold: 0, curve: 1, attack: 0.01, release: 0.3, invert: false } };
    const fresh = (t: number) => linkLevel(createSignalReader(p, new Map(store)), null, link, t);
    // A new store each frame, as Now Playing's is: the live series carries on, the other warms up each time.
    const live = (t: number) => linkLevel({ document: p, store: new Map(store), live: "song" }, null, link, t);
    for (let t = 2; t < 5.5; t += 1 / 60) expect(live(t)).toBeCloseTo(fresh(t), 3);
    // Read far from where it was, it warms up afresh.
    expect(live(2.4)).toBeCloseTo(fresh(2.4), 3);
  });
});
