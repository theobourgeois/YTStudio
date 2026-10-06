import { describe, expect, it } from "vitest";
import { DEFAULT_VISUALIZER_OPTIONS } from "../handoff.ts";
import { controlOf, createAutomation, editPoints, updateAutomation } from "./automation.ts";
import { addChannels, addPattern, setSteps } from "./edits.ts";
import { addMarker } from "./markers.ts";
import { routeChannels, updateMixerTrack } from "./mixer.ts";
import { addClips, editClips } from "./playlist.ts";
import { FIRST_PATTERN_ID, createMusicProject } from "./project.ts";
import { TEMPO_TARGET } from "./tempo.ts";
import type { MusicProject } from "./types.ts";
import { chosenStems, defaultChoice, normalizeVisualizerChoice, songBeats, songMarkers, songNotes, visualizerMode, visualizerSources } from "./visualizer.ts";

const P = FIRST_PATTERN_ID;
const BAR = 384;

/** 120 BPM (a beat is half a second): a kick on every beat and a snare on 2 and 4 on their own inserts, hats into the master. */
function beat(): MusicProject {
  let s = addChannels(createMusicProject("Night drive", 120), [
    { id: "chan_kick", name: "Kick", sampleId: null },
    { id: "chan_snare", name: "Snare 2", sampleId: null },
    { id: "chan_hat", name: "Hi-hat", sampleId: null },
  ]);
  s = setSteps(s, P, "chan_kick", [0, 4, 8, 12], true);
  s = setSteps(s, P, "chan_snare", [4, 12], true);
  s = setSteps(s, P, "chan_hat", [2, 6, 10, 14], true);
  return routeChannels(routeChannels(s, ["chan_kick"], "insert_1"), ["chan_snare"], "insert_2");
}

const mute = (s: MusicProject, id: string): MusicProject => ({ ...s, channels: s.channels.map((c) => (c.id === id ? { ...c, muted: true } : c)) });

describe("what a song hands over", () => {
  it("lists a stem per insert something plays into, the channels with notes, and those heard only in the mix", () => {
    const sources = visualizerSources(beat(), P);
    expect(sources.mode).toBe("pattern");
    expect(sources.length).toBeCloseTo(2);
    expect(sources.stems.map((s) => [s.trackId, s.name, s.role, s.channels])).toEqual([
      ["insert_1", "Insert 1", "kick", ["Kick"]],
      ["insert_2", "Insert 2", "snare", ["Snare 2"]],
    ]);
    expect(sources.channels.map((c) => [c.name, c.role, c.notes])).toEqual([
      ["Kick", "kick", 4],
      ["Snare 2", "snare", 2],
      ["Hi-hat", "hats", 4],
    ]);
    expect(sources.direct).toEqual(["Hi-hat"]);
    expect(sources.stems.every((s) => /^#[0-9a-f]{6}$/.test(s.color))).toBe(true);
  });

  it("leaves out what isn't heard: a muted channel, and a muted track's stem and notes", () => {
    let s = mute(beat(), "chan_hat");
    s = updateMixerTrack(s, "insert_2", { muted: true });
    const sources = visualizerSources(s, P);
    expect(sources.stems.map((t) => t.trackId)).toEqual(["insert_1"]);
    expect(sources.channels.map((c) => c.name)).toEqual(["Kick"]);
    expect(sources.direct).toEqual([]);
  });

  it("gives each chosen channel's notes in seconds, with their keys, velocities and lengths, roles as chosen", () => {
    const s = beat();
    const sources = visualizerSources(s, P);
    const choice = { ...defaultChoice(sources, DEFAULT_VISUALIZER_OPTIONS), channels: ["chan_kick", "chan_snare"], roles: { chan_snare: "none" as const } };
    const notes = songNotes(s, P, sources, choice);
    expect(notes.map((n) => [n.channel, n.role])).toEqual([
      ["Kick", "kick"],
      ["Snare 2", undefined],
    ]);
    expect(notes[0].events.map((e) => e.time)).toEqual([0, 0.5, 1, 1.5]);
    expect(notes[1].events.map((e) => e.time)).toEqual([0.5, 1.5]);
    expect(notes[0].events[0]).toMatchObject({ key: expect.any(Number), velocity: expect.any(Number) });
    expect(notes[0].events[0].length).toBeCloseTo(0.125, 3);
  });

  it("takes only stems and channels the song has, and roles it knows", () => {
    const choice = normalizeVisualizerChoice({ stems: ["insert_1", "nope", "insert_1"], channels: ["chan_kick", 3], roles: { insert_1: "bass", chan_kick: "dance", x: "kick" }, video: { look: "bars", fps: 60 } }, beat());
    expect(choice).toEqual({ stems: ["insert_1"], channels: ["chan_kick"], roles: { insert_1: "bass" }, video: { look: "bars", aspectRatio: "9:16", fps: 60 } });
    const stems = chosenStems(visualizerSources(beat(), P), choice);
    expect(stems.map((s) => [s.trackId, s.role])).toEqual([["insert_1", "bass"]]);
  });

  it("counts the beat from the song's start, on past its end at its tempo", () => {
    const beats = songBeats(beat(), "pattern", 3);
    expect(beats).toHaveLength(7);
    expect(beats.at(-1)).toBe(3);
    // 6/8: a beat is an eighth note.
    const sixEight = { ...beat(), settings: { ...beat().settings, timeSignature: [6, 8] as [number, number] } };
    expect(songBeats(sixEight, "pattern", 1)).toEqual([0, 0.25, 0.5, 0.75, 1]);
  });
});

describe("a song's arrangement", () => {
  /** Drums for six bars, the bass coming in for bars 3 and 4; a "Drop" marker at bar 6. */
  function arranged(): MusicProject {
    let s = addPattern(beat(), { id: "pat_bass", name: "Bass" });
    s = { ...s, patterns: s.patterns.map((p) => (p.id === P ? { ...p, name: "Drums" } : p)) };
    s = setSteps(s, "pat_bass", "chan_kick", [0], true);
    const bars = (ref: string, track: number, from: number, to: number) => Array.from({ length: to - from }, (_, i) => ({ kind: "pattern" as const, ref, track, start: BAR * (from + i), length: BAR }));
    s = editClips(s, (clips) => addClips(clips, [...bars(P, 0, 0, 6), ...bars("pat_bass", 1, 2, 4)]).clips);
    return addMarker(s, BAR * 5, { name: "Drop" }).song;
  }

  it("plays the playlist once there's something on it", () => {
    expect(visualizerMode(beat())).toBe("pattern");
    expect(visualizerMode(arranged())).toBe("song");
  });

  it("marks where what plays changes, two bars apart at least, and the playlist's own markers", () => {
    const s = arranged();
    expect(songMarkers(s, "song")).toEqual([
      { time: 4, label: "Bass + Drums" },
      { time: 8, label: "Drums" },
      { time: 10, label: "Drop" },
    ]);
    // The bass for one bar only: its going out is too soon after its coming in to be a section.
    const short = editClips(s, (clips) => clips.filter((c) => !(c.ref === "pat_bass" && c.start === BAR * 3)));
    expect(songMarkers(short, "song").map((m) => m.time)).toEqual([4, 10]);
    expect(songMarkers(s, "pattern")).toEqual([]);
  });

  it("puts notes and beats where tempo clips move them", () => {
    let s = arranged();
    // Twice as fast from bar 2 on.
    const made = createAutomation(s, TEMPO_TARGET, { start: BAR, length: BAR * 5 });
    const info = controlOf(made.song, TEMPO_TARGET);
    s = editPoints(updateAutomation(made.song, made.automationId, { min: 0, max: 1 }), made.automationId, () => [
      { tick: 0, value: info.fromControl(240), tension: 0, curve: "single" },
      { tick: BAR * 5, value: info.fromControl(240), tension: 0, curve: "single" },
    ]);
    const sources = visualizerSources(s, P);
    const bass = songNotes(s, P, sources, defaultChoice(sources, DEFAULT_VISUALIZER_OPTIONS)).find((n) => n.channel === "Kick")!;
    // Bar 2's first kick: a bar at 120 (2 s), then one at 240 (1 s).
    expect(bass.events.some((e) => Math.abs(e.time - 3) < 1e-6)).toBe(true);
    const beats = songBeats(s, "song", 4);
    expect(beats.slice(0, 5)).toEqual([0, 0.5, 1, 1.5, 2]);
    expect(beats[8]).toBeCloseTo(3);
    expect(beats[9]).toBeCloseTo(3.25);
  });
});
