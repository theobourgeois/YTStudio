import { describe, expect, it } from "vitest";
import { addChannels, addPattern, movePatterns, setStepNote, setSteps, transposePatterns } from "./edits.ts";
import { FIRST_PATTERN_ID, createMusicProject } from "./project.ts";
import type { MusicProject } from "./types.ts";

const P = FIRST_PATTERN_ID;
const rack = (): MusicProject =>
  addChannels(createMusicProject("Beat"), [
    { id: "chan_kick", name: "Kick", sampleId: null },
    { id: "chan_hat", name: "Hat", sampleId: null },
  ]);
const ids = (song: MusicProject) => song.patterns.map((p) => p.id);
const pitches = (song: MusicProject, pattern: string, channel: string) => song.patterns.find((p) => p.id === pattern)!.notes[channel]?.map((n) => n.pitch);

describe("the Picker's pattern edits", () => {
  it("move patterns up and down the list together, those at an edge staying", () => {
    const song = addPattern(addPattern(addPattern(rack(), { id: "pat_2" }), { id: "pat_3" }), { id: "pat_4" });
    expect(ids(movePatterns(song, ["pat_3"], -1))).toEqual([P, "pat_3", "pat_2", "pat_4"]);
    expect(ids(movePatterns(song, ["pat_2", "pat_3"], 1))).toEqual([P, "pat_4", "pat_2", "pat_3"]);
    expect(ids(movePatterns(song, [P, "pat_3"], -1))).toEqual([P, "pat_3", "pat_2", "pat_4"]);
    expect(movePatterns(song, [P], -1)).toBe(song);
    expect(movePatterns(song, ["pat_4"], 1)).toBe(song);
    expect(movePatterns(song, ["pat_gone"], 1)).toBe(song);
  });

  it("transpose every note of each pattern chosen, every channel's, stopping at the MIDI range's ends", () => {
    let song = addPattern(rack(), { id: "pat_2" });
    song = setSteps(song, P, "chan_kick", [0, 4], true);
    song = setSteps(song, P, "chan_hat", [2], true);
    song = setStepNote(song, P, "chan_hat", 2, { pitch: 125 });
    song = setSteps(song, "pat_2", "chan_kick", [8], true);
    const up = transposePatterns(song, [P], 5);
    expect(pitches(up, P, "chan_kick")).toEqual([65, 65]);
    expect(pitches(up, P, "chan_hat")).toEqual([127]);
    // The pattern not chosen stays as it was, the same object.
    expect(up.patterns[1]).toBe(song.patterns[1]);
    const both = transposePatterns(song, [P, "pat_2"], -12);
    expect(pitches(both, P, "chan_kick")).toEqual([48, 48]);
    expect(pitches(both, "pat_2", "chan_kick")).toEqual([48]);
  });

  it("leave the song as it is when nothing moves", () => {
    const song = setSteps(addPattern(rack(), { id: "pat_2" }), P, "chan_kick", [0], true);
    expect(transposePatterns(song, [P], 0)).toBe(song);
    expect(transposePatterns(song, ["pat_2"], 3)).toBe(song);
    expect(transposePatterns(song, [], 3)).toBe(song);
    expect(transposePatterns(song, [P], NaN)).toBe(song);
    const top = transposePatterns(song, [P], 200);
    expect(pitches(top, P, "chan_kick")).toEqual([127]);
    expect(transposePatterns(top, [P], 1)).toBe(top);
  });
});
