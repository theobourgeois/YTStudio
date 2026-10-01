import { describe, expect, it } from "vitest";
import { addChannels, setSteps, setTempo } from "@shared/music/edits";
import { addAudioClips } from "@shared/music/playlist";
import { createMusicProject } from "@shared/music/project";
import type { MusicProject } from "@shared/music/types";
import { chopClipsTool, describePlaylist, makeClipUniqueTool, placeClipsTool, playlistSummary, removeClipsTool, sliceClipsTool, splitByChannelTool, updateClipsTool, updatePlaylistTrackTool } from "./tool-edits";

const BAR = 384;
const env = { patternId: null };

function beat(): MusicProject {
  // At 120 BPM, whatever the default: a bar is two seconds.
  let song = addChannels(setTempo(createMusicProject("Song"), 120), [
    { id: "chan_kick", name: "Kick", sampleId: "m1" },
    { id: "chan_hat", name: "Hat", sampleId: "m2" },
  ]);
  song = { ...song, patterns: [{ ...song.patterns[0], name: "Beat" }] };
  song = setSteps(song, song.patterns[0].id, "chan_kick", [0, 4, 8, 12], true);
  return setSteps(song, song.patterns[0].id, "chan_hat", [2, 6, 10, 14], true);
}

describe("the assistant's playlist tools", () => {
  it("chop clips into bars or beats, and say when nothing's inside", () => {
    const placed = placeClipsTool(beat(), { clips: [{ pattern: "Beat", track: 1, bar: 1, length: 2 }] }, env).song;
    const { song, text } = chopClipsTool(placed, { ids: [1], every: "beat" });
    expect(song.playlist.clips.map((c) => [c.start, c.length, c.offset])).toEqual(Array.from({ length: 8 }, (_, i) => [(i * BAR) / 4, BAR / 4, (i * BAR) / 4]));
    expect(text).toContain("into 8 pieces");
    expect(chopClipsTool(placed, { ids: [1], every: "bar" }).song.playlist.clips).toHaveLength(2);
    expect(() => chopClipsTool(placed, { ids: [9], every: "bar" })).toThrow(/no clip 9/);
    expect(() => chopClipsTool(placed, { ids: [1], every: "half" })).toThrow(/"bar", "beat" or "step"/);
  });

  it("place patterns by bar on numbered tracks, repeated to fill a section", () => {
    const { song, text } = placeClipsTool(beat(), { clips: [{ pattern: "Beat", track: 1, bar: 1, repeat: 4 }, { pattern: "beat", track: 2, bar: 3, length: 0.5 }] }, env);
    expect(song.playlist.clips.map((c) => [c.track, c.start, c.length])).toEqual([
      [0, 0, null],
      [0, BAR, null],
      [0, 2 * BAR, null],
      [1, 2 * BAR, BAR / 2],
      [0, 3 * BAR, null],
    ]);
    expect(text).toContain('clip 1: pattern "Beat" at bar 1, 1 bars (its pattern\'s length)');
    expect(text).toContain("at bar 3, 0.5 bars");
  });

  it("say what's wrong with a clip, and what would do", () => {
    expect(() => placeClipsTool(beat(), { clips: [{ pattern: "Nope", track: 1, bar: 1 }] }, env)).toThrow(/Clip 1: There's no pattern "Nope". The patterns are: "Beat"/);
    expect(() => placeClipsTool(beat(), { clips: [{ pattern: "Beat", track: 0, bar: 1 }] }, env)).toThrow(/"track" must be a track's number/);
    expect(() => placeClipsTool(beat(), { clips: [{ track: 1, bar: 1 }] }, env)).toThrow(/one of "pattern", "audio" or "automation"/);
    expect(() => placeClipsTool(beat(), { clips: [{ audio: "Vox", track: 1, bar: 1 }] }, env)).toThrow(/The song has none: add_audio_clip/);
  });

  it("move, resize, slip and mute clips", () => {
    const placed = placeClipsTool(beat(), { clips: [{ pattern: "Beat", track: 1, bar: 1, repeat: 2 }] }, env).song;
    const moved = updateClipsTool(placed, { ids: [2], bar: 4, track: 3 }).song;
    expect(moved.playlist.clips.find((c) => c.id === 2)).toMatchObject({ start: 3 * BAR, track: 2 });
    const both = updateClipsTool(placed, { ids: [1, 2], move_bars: 1, move_tracks: 1, muted: true }).song;
    expect(both.playlist.clips.map((c) => [c.start, c.track, c.muted])).toEqual([
      [BAR, 1, true],
      [2 * BAR, 1, true],
    ]);
    expect(updateClipsTool(placed, { ids: [1], length: 2 }).song.playlist.clips[0].length).toBe(2 * BAR);
    expect(updateClipsTool(placed, { ids: [1], offset: 0.25 }).song.playlist.clips[0]).toMatchObject({ offset: 96, length: BAR });
    expect(() => updateClipsTool(placed, { ids: [1, 2], bar: 2 })).toThrow(/"bar" and "track" place a single clip/);
    expect(() => updateClipsTool(placed, { ids: [9] })).toThrow(/There's no clip 9/);
  });

  it("remove clips by id, track or pattern, and slice them at a bar", () => {
    const placed = placeClipsTool(beat(), { clips: [{ pattern: "Beat", track: 1, bar: 1, length: 2 }, { pattern: "Beat", track: 2, bar: 1 }] }, env).song;
    expect(removeClipsTool(placed, { track: 2 }, env).song.playlist.clips).toHaveLength(1);
    expect(removeClipsTool(placed, { pattern: "Beat" }, env).song.playlist.clips).toHaveLength(0);
    const sliced = sliceClipsTool(placed, { bar: 2, tracks: [1] });
    expect(sliced.song.playlist.clips.map((c) => [c.track, c.start, c.length, c.offset])).toEqual([
      [0, 0, BAR, 0],
      [1, 0, null, 0],
      [0, BAR, BAR, BAR],
    ]);
    expect(sliceClipsTool(placed, { bar: 5 }).text).toMatch(/No clip crosses bar 5/);
  });

  it("split a pattern by channel, its clips one per channel", () => {
    const placed = placeClipsTool(beat(), { clips: [{ pattern: "Beat", track: 1, bar: 1 }] }, env).song;
    const { song, text, showPattern } = splitByChannelTool(placed, { pattern: "Beat" }, env);
    expect(song.patterns.map((p) => p.name)).toEqual(["Kick", "Hat"]);
    expect(song.playlist.clips.map((c) => c.track)).toEqual([0, 1]);
    expect(text).toMatch(/Split "Beat" into 2 patterns: "Kick" \(id .+\), "Hat"/);
    expect(showPattern).toBe(song.patterns[0].id);
  });

  it("make a clip unique, and change tracks", () => {
    const placed = placeClipsTool(beat(), { clips: [{ pattern: "Beat", track: 1, bar: 1, repeat: 2 }] }, env).song;
    expect(makeClipUniqueTool(placed, { id: 2 }).text).toMatch(/"Beat #2"/);
    const named = updatePlaylistTrackTool(placed, { track: 1, name: "Drums", color: "#3F5EA8", muted: true });
    expect(named.text).toBe('Track 1 is "Drums", muted, colour #3f5ea8.');
    expect(updatePlaylistTrackTool(placed, { track: 1, insert: true }).song.playlist.clips.map((c) => c.track)).toEqual([1, 1]);
    expect(updatePlaylistTrackTool(placed, { track: 1, delete: true }).song.playlist.clips).toHaveLength(0);
    expect(() => updatePlaylistTrackTool(placed, { track: 1, color: "blue" })).toThrow(/"#rrggbb"/);
  });

  it("describe the playlist by track, with each clip's id, bar and length", () => {
    let song = placeClipsTool(beat(), { clips: [{ pattern: "Beat", track: 2, bar: 1, repeat: 2 }] }, env).song;
    song = addAudioClips(song, [{ name: "Vox", sampleId: "m3", seconds: 4, channelId: "chan_vox" }], { start: BAR, track: 3 }).song;
    song = updatePlaylistTrackTool(song, { track: 1, name: "Empty" }).song;
    const text = describePlaylist(song, "song");
    expect(text).toContain("Playlist: 3 clips; the song is 3 bars long");
    expect(text).toContain("The editor plays the song (song mode).");
    expect(text).toContain('Track 1 "Empty":\n- (empty)');
    expect(text).toContain('Track 2:\n- clip 1: pattern "Beat" at bar 1, 1 bars');
    expect(text).toContain('Track 4:\n- clip 3: audio "Vox" at bar 2, 2 bars');
    expect(text).toContain('Audio clips (their channels): "Vox" (id chan_vox).');
    expect(playlistSummary(song)).toBe("Playlist: 3 clips on 2 tracks, 3 bars (get_playlist has them).");
    expect(describePlaylist(beat(), null)).toContain("Nothing is on it yet");
  });
});
