import { describe, expect, it } from "vitest";
import { setSteps } from "./edits.ts";
import { OUTLINE_BLOCKS, OUTLINE_ROWS, songOutline } from "./outline.ts";
import { addClips, editClips, type NewClip } from "./playlist.ts";
import { createChannel, createMusicProject } from "./project.ts";
import type { MusicProject } from "./types.ts";

const BAR = 384;

/** A kick and a hat in a one-bar pattern. */
function makeSong(): MusicProject {
  const song: MusicProject = {
    ...createMusicProject("Song"),
    channels: [createChannel("Kick", null, "chan_kick"), { ...createChannel("Hat", null, "chan_hat"), color: "#cc8844" }],
    patterns: [{ id: "pat_beat", name: "Beat", length: null, notes: {}, color: null }],
  };
  return setSteps(setSteps(song, "pat_beat", "chan_kick", [0, 8], true), "pat_beat", "chan_hat", [4, 12], true);
}

const withClips = (clips: NewClip[], song = makeSong()) => editClips(song, (list) => addClips(list, clips).clips);
const clip = (c: Partial<NewClip> = {}): NewClip => ({ kind: "pattern", ref: "pat_beat", track: 0, start: 0, ...c });

describe("a song's outline", () => {
  it("is nothing for a song with no notes and no clips", () => {
    expect(songOutline(createMusicProject())).toBeNull();
  });

  it("is its busiest pattern's notes by channel before it has clips, in thousandths of the pattern", () => {
    const outline = songOutline(makeSong())!;
    expect(outline.kind).toBe("pattern");
    expect(outline.rows).toBe(2);
    expect(outline.bars).toBe(1);
    // A step is a sixteenth of the bar: 62.5 thousandths, its notes a step long.
    expect(outline.blocks.map(([row, start]) => [row, start])).toEqual([[0, 0], [0, 500], [1, 250], [1, 750]]);
    expect(outline.styles).toEqual([{ kind: "note", color: null }, { kind: "note", color: "#cc8844" }]);
  });

  it("is its clips on the tracks used, packed together, in thousandths of the song", () => {
    const song = withClips([clip(), clip({ track: 7, start: BAR }), clip({ track: 7, start: 3 * BAR, length: BAR / 2 })]);
    const outline = songOutline(song)!;
    expect(outline.kind).toBe("playlist");
    expect(outline.rows).toBe(2);
    expect(outline.bars).toBe(4);
    expect(outline.blocks).toEqual([[0, 0, 250, 0], [1, 250, 250, 0], [1, 750, 125, 0]]);
    expect(outline.styles).toEqual([{ kind: "pattern", color: null }]);
  });

  it("colours a clip as the Playlist does: its source's colour, else its track's", () => {
    let song = withClips([clip(), clip({ track: 1, start: BAR })]);
    song = { ...song, playlist: { ...song.playlist, tracks: [{ name: null, color: "#112233", size: 1, muted: false, mixerTrack: null }] } };
    expect(songOutline(song)!.styles).toEqual([{ kind: "pattern", color: "#112233" }, { kind: "pattern", color: null }]);
    song = { ...song, patterns: song.patterns.map((p) => ({ ...p, color: "#445566" })) };
    expect(songOutline(song)!.styles).toEqual([{ kind: "pattern", color: "#445566" }]);
  });

  it("stays small: a few rows and a few hundred blocks, whatever the song", () => {
    const clips = Array.from({ length: 2000 }, (_, i) => clip({ track: i % 40, start: Math.floor(i / 40) * BAR }));
    const outline = songOutline(withClips(clips))!;
    expect(outline.rows).toBe(OUTLINE_ROWS);
    expect(outline.blocks.length).toBeLessThanOrEqual(OUTLINE_BLOCKS);
    expect(outline.blocks.every(([row]) => row < OUTLINE_ROWS)).toBe(true);
  });
});
