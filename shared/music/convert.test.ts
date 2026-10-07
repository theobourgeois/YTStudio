import { describe, expect, it } from "vitest";
import { DEFAULT_CONVERT, addConvertedPattern, convertSettings, convertedParts, pickSettings } from "./convert.ts";
import { addAudioClips, clipContext, clipEnd } from "./playlist.ts";
import { DEFAULT_VELOCITY, createMusicProject } from "./project.ts";
import { ANALYSIS_RATE, DRUM_FEATURES, FRAME_SECONDS, type HeardAudio, KEYS, LOWEST_KEY, drumFeatures, packDrums } from "./transcribe.ts";
import { PPQ, ROOT_PITCH, STEP_TICKS } from "./types.ts";

/** Activations with notes at given seconds (onset a frame in, held to their end), and no drums. */
function heardNotes(notes: { at: number; to: number; pitch: number; level?: number }[], seconds = 6): HeardAudio {
  const frames = Math.round(seconds / FRAME_SECONDS);
  const act = new Uint16Array(frames * KEYS);
  const onsets = new Uint16Array(frames * KEYS);
  for (const n of notes) {
    const key = n.pitch - LOWEST_KEY;
    const from = Math.round(n.at / FRAME_SECONDS);
    for (let t = from; t < Math.round(n.to / FRAME_SECONDS); t++) act[t * KEYS + key] = Math.round((n.level ?? 0.8) * 65_535);
    onsets[from * KEYS + key] = 60_000;
  }
  return { duration: seconds, frames, notes: act, onsets, drums: new Uint16Array(DRUM_FEATURES.length), drumFrames: 1 };
}

/** Song ticks at 120 BPM, as file seconds go (no stretch): a quarter note is half a second. */
const atTempo = { secondsPerTick: 0.5 / PPQ };

describe("Convert to notes' settings", () => {
  it("are Basic Pitch's own thresholds at 0.5, lower when more sensitive", () => {
    expect(pickSettings(DEFAULT_CONVERT)).toMatchObject({ onsetThreshold: 0.5, frameThreshold: 0.3, minFrames: 11 });
    const keen = pickSettings({ ...DEFAULT_CONVERT, sensitivity: 1 });
    expect(keen.onsetThreshold).toBeCloseTo(0.1);
    expect(keen.frameThreshold).toBeCloseTo(0.1);
  });

  it("are kept in range", () => {
    expect(convertSettings({ kind: "drums", sensitivity: 4, lowest: 200, highest: 0, quantize: -3, snapToScale: "yes" })).toEqual({
      ...DEFAULT_CONVERT,
      kind: "drums",
      sensitivity: 1,
      lowest: 108,
      highest: 108,
      quantize: 0,
    });
  });
});

describe("notes heard, in the song's time", () => {
  const heard = heardNotes([
    { at: 0.5, to: 1, pitch: 60 },
    { at: 1.52, to: 2.01, pitch: 64, level: 0.4 },
    { at: 2.5, to: 3.5, pitch: 61 },
  ]);

  it("land on the grid from the window's start, the loudest at the usual velocity", () => {
    const [part] = convertedParts(heard, DEFAULT_CONVERT, { from: 0, to: 6, ...atTempo });
    expect(part.drum).toBeNull();
    expect(part.notes.map((n) => [n.start, n.length, n.pitch])).toEqual([
      [PPQ, PPQ, 60],
      [3 * PPQ, PPQ, 64],
      [5 * PPQ, 2 * PPQ, 61],
    ]);
    expect(part.notes[0].velocity).toBeCloseTo(DEFAULT_VELOCITY, 1);
    expect(part.notes[1].velocity!).toBeLessThan(part.notes[0].velocity!);
  });

  it("are where they were heard without a grid", () => {
    const [part] = convertedParts(heard, { ...DEFAULT_CONVERT, quantize: 0 }, { from: 0, to: 6, ...atTempo });
    expect(part.notes[1].start).not.toBe(3 * PPQ);
    expect(Math.abs(part.notes[1].start - 3 * PPQ)).toBeLessThan(STEP_TICKS);
  });

  it("are the clip's part of the file only, from its start", () => {
    const [part] = convertedParts(heard, DEFAULT_CONVERT, { from: 1.5, to: 3, ...atTempo });
    // The first note is before the window; the last is cut at its end.
    expect(part.notes.map((n) => [n.start, n.length, n.pitch])).toEqual([
      [0, PPQ, 64],
      [2 * PPQ, PPQ, 61],
    ]);
  });

  it("follow the clip's speed (a stretched clip plays the file faster)", () => {
    const [part] = convertedParts(heard, DEFAULT_CONVERT, { from: 0, to: 6, secondsPerTick: 1 / PPQ });
    expect(part.notes[0].start).toBe(PPQ / 2);
  });

  it("move to the song's scale when asked", () => {
    const scale = { root: 0, type: "major" as const };
    const pitches = (snap: boolean) => convertedParts(heard, { ...DEFAULT_CONVERT, snapToScale: snap }, { from: 0, to: 6, ...atTempo }, scale)[0].notes.map((n) => n.pitch);
    expect(pitches(false)).toEqual([60, 64, 61]);
    expect(pitches(true)).toEqual([60, 64, 60]);
  });
});

describe("drum hits, in the song's time", () => {
  it("are a part per drum, one step long at the sample's own pitch", () => {
    // A kick a beat (half a second), from a falling sine.
    const samples = new Float32Array(ANALYSIS_RATE * 3);
    for (let k = 0; k < 4; k++) {
      let phase = 0;
      const at = Math.round((0.5 + k * 0.5) * ANALYSIS_RATE);
      for (let i = 0; i < 0.3 * ANALYSIS_RATE; i++) {
        phase += (2 * Math.PI * (50 + 100 * Math.exp(-(i / ANALYSIS_RATE) * 30))) / ANALYSIS_RATE;
        samples[at + i] += 0.9 * Math.sin(phase) * Math.exp(-(i / ANALYSIS_RATE) * 9);
      }
    }
    const { frames, features } = drumFeatures(samples);
    const heard: HeardAudio = { ...heardNotes([], 3), drums: packDrums(features, frames), drumFrames: frames };
    const parts = convertedParts(heard, { ...DEFAULT_CONVERT, kind: "drums" }, { from: 0, to: 3, ...atTempo });
    expect(parts.map((p) => p.drum)).toEqual(["kick", "snare", "hat"]);
    expect(parts[0].notes.map((n) => [n.start, n.length, n.pitch])).toEqual([1, 2, 3, 4].map((beat) => [beat * PPQ, STEP_TICKS, ROOT_PITCH]));
    expect(parts[1].notes).toEqual([]);
    expect(parts[2].notes).toEqual([]);
  });
});

describe("the pattern made", () => {
  const base = addAudioClips(createMusicProject("Song", 120), [{ channelId: "chan_bass", name: "Bass", sampleId: "media_bass", seconds: 4 }], { start: 2 * PPQ, track: 1 }).song;
  const source = base.playlist.clips[0];
  const notes = [
    { start: 0, length: PPQ, pitch: 40 },
    { start: PPQ, length: PPQ, pitch: 43 },
  ];

  it("is a sampler with the notes in a new pattern, its clip under the audio clip and as long", () => {
    const after = addConvertedPattern(base, { id: "pat_notes", name: "Bass notes" }, [{ channel: { id: "chan_notes", name: "Bass notes", sampleId: "media_tone" }, notes }], { clipId: source.id });
    const channel = after.channels.find((c) => c.id === "chan_notes")!;
    expect(channel).toMatchObject({ kind: "sampler", sampleId: "media_tone", name: "Bass notes" });
    const pattern = after.patterns.find((p) => p.id === "pat_notes")!;
    expect(pattern.name).toBe("Bass notes");
    expect(pattern.notes.chan_notes.map((n) => [n.start, n.pitch])).toEqual([
      [0, 40],
      [PPQ, 43],
    ]);
    const clip = after.playlist.clips.find((c) => c.kind === "pattern" && c.ref === "pat_notes")!;
    expect(clip).toMatchObject({ track: 2, start: source.start });
    expect(clipEnd(clip, clipContext(after))).toBe(clipEnd(source, clipContext(base)));
  });

  it("is a channel per drum with hits, unplaced when there's no clip", () => {
    const after = addConvertedPattern(
      base,
      { id: "pat_drums", name: "Drums" },
      [
        { channel: { id: "chan_kick", name: "Kick", sampleId: "media_kick" }, notes },
        { channel: { id: "chan_snare", name: "Snare", sampleId: "media_snare" }, notes: [] },
      ],
      null,
    );
    expect(after.channels.some((c) => c.id === "chan_kick")).toBe(true);
    expect(after.channels.some((c) => c.id === "chan_snare")).toBe(false);
    expect(after.playlist.clips).toEqual(base.playlist.clips);
  });

  it("is nothing when nothing was heard", () => {
    expect(addConvertedPattern(base, { id: "pat_x", name: "X" }, [{ channel: { id: "chan_x", name: "X", sampleId: null }, notes: [] }], { clipId: source.id })).toBe(base);
  });
});
