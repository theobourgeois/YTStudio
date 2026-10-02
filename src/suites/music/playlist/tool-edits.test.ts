import { describe, expect, it } from "vitest";
import { addChannels, setSteps, setTempo } from "@shared/music/edits";
import { addAudioClips } from "@shared/music/playlist";
import { createMusicProject } from "@shared/music/project";
import type { MusicProject } from "@shared/music/types";
import { setMarkersTool, chopClipsTool, describePlaylist, makeClipUniqueTool, placeClipsTool, playlistSummary, removeClipsTool, sliceClipsTool, splitByChannelTool, stretchAudioTool, updateClipsTool, updatePlaylistTrackTool } from "./tool-edits";
import { clipContext, clipLength } from "@shared/music/playlist";

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
  it("give audio clips their own gain and fades", () => {
    const song = addAudioClips(beat(), [{ name: "Loop 90bpm", sampleId: "m3", seconds: 4, channelId: "chan_loop" }], { start: 0, track: 2 }).song;
    const id = song.playlist.clips[0].id;
    const shaped = updateClipsTool(song, { ids: [id], gain_db: -6, fade_in: 1, fade_out: 2, fade_out_curve: 0.5 });
    expect(shaped.song.playlist.clips[0]).toMatchObject({ fadeIn: 96, fadeOut: 192, fadeOutTension: 0.5 });
    expect(shaped.song.playlist.clips[0].gain).toBeCloseTo(0.501, 3);
    expect(shaped.text).toContain("-6 dB gain, fading in over 1 beat, fading out over 2 beats (curve 0.5)");
    expect(updateClipsTool(song, { ids: [id], gain_db: -100 }).song.playlist.clips[0].gain).toBe(0);
    expect(() => updateClipsTool(song, { ids: [id], fade_in_curve: 3 })).toThrow(/-1/);
  });

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

describe("the assistant's audio tracks", () => {
  it("link a playlist track to a mixer track, and back", () => {
    const { song, text } = updatePlaylistTrackTool(beat(), { track: 3, audioTrack: "Insert 2" });
    expect(song.playlist.tracks[2].mixerTrack).toBe("insert_2");
    expect(text).toMatch(/the audio track of Insert 2/);
    expect(describePlaylist(song, null)).toMatch(/Track 3 \(audio track of Insert 2: its takes land here\)/);
    expect(updatePlaylistTrackTool(song, { track: 3, audioTrack: "none" }).song.playlist.tracks).toEqual([]);
    expect(() => updatePlaylistTrackTool(beat(), { track: 1, audioTrack: "master" })).toThrow(/master/);
  });

  it("stretch audio clips by their file's tempo, its length in bars or a clip's new length, keeping their content", () => {
    // A four-second vocal (two bars at 120 BPM), in two clips of a bar each.
    let song = addAudioClips(beat(), [{ name: "Vocal", sampleId: "m3", seconds: 4, channelId: "chan_vox" }], { start: 0, track: 0 }).song;
    song = sliceClipsTool(song, { bar: 2, track: 1 }).song;
    const files = { seconds: () => 4 };
    const length = (s: MusicProject, id: number) => clipLength(s.playlist.clips.find((c) => c.id === id)!, clipContext(s)) / BAR;
    // Made at 90 BPM: played a third faster in a 120 song, its first second-of-two lasts three quarters of a bar.
    const tempo = stretchAudioTool(song, { ids: [1], tempo: 90 }, files);
    expect(tempo.song.playlist.clips.find((c) => c.id === 1)?.stretch).toEqual({ mode: "stretch", tempo: 90 });
    expect(length(tempo.song, 1)).toBe(0.75);
    expect(tempo.text).toContain("its file's tempo 90 BPM: 1.333× its speed; its own");
    // The whole file in four bars, Resample, on the channel: both clips follow, each twice as long.
    const bars = stretchAudioTool(song, { audio: "Vocal", bars: 4, mode: "resample" }, files);
    expect(bars.song.channels.find((c) => c.id === "chan_vox")?.stretch).toEqual({ mode: "resample", tempo: 240 });
    expect([length(bars.song, 1), length(bars.song, 2)]).toEqual([2, 2]);
    expect(bars.text).toContain("in Resample mode");
    // A clip's length: its content in that many bars.
    const long = stretchAudioTool(song, { ids: [2], length: 3 }, files);
    expect(length(long.song, 2)).toBe(3);
    expect(long.song.playlist.clips.find((c) => c.id === 2)?.stretch).toEqual({ mode: "stretch", tempo: 360 });
    // Back to its channel's, and "detect" with what was heard.
    expect(stretchAudioTool(long.song, { ids: [2], follow_channel: true }, files).song.playlist.clips.find((c) => c.id === 2)).not.toHaveProperty("stretch");
    expect(stretchAudioTool(song, { audio: "chan_vox", tempo: "detect" }, { ...files, heard: () => 60 }).song.channels.find((c) => c.id === "chan_vox")?.stretch).toEqual({ mode: "stretch", tempo: 60 });
    // Resampled twice as fast (an octave up), then back to its own pitch at that speed.
    const fast = stretchAudioTool(song, { ids: [1], tempo: 60, mode: "resample" }, files).song;
    const reset = stretchAudioTool(fast, { ids: [1], reset_pitch: true }, files);
    expect(reset.song.playlist.clips.find((c) => c.id === 1)?.stretch).toEqual({ mode: "stretch", tempo: 60 });
    expect(length(reset.song, 1)).toBe(length(fast, 1));
    expect(stretchAudioTool(reset.song, { ids: [1], reset_pitch: true }, files).text).toMatch(/Nothing changed/);
    // What's wrong, said.
    expect(() => stretchAudioTool(song, { tempo: 90 }, files)).toThrow(/either "ids"/);
    expect(() => stretchAudioTool(song, { ids: [1], tempo: 90, bars: 2 }, files)).toThrow(/not "tempo" and "bars"/);
    expect(() => stretchAudioTool(song, { audio: "Vocal", length: 2 }, files)).toThrow(/for clips/);
    expect(() => stretchAudioTool(song, { audio: "Vocal", tempo: "detect" }, files)).toThrow(/No steady beat/);
    expect(() => stretchAudioTool(song, { audio: "Snare", tempo: 90 }, files)).toThrow(/no audio clip "Snare"/);
    const withPattern = placeClipsTool(song, { clips: [{ pattern: "Beat", track: 3, bar: 1 }] }, env).song;
    expect(() => stretchAudioTool(withPattern, { ids: [3], tempo: 90 }, files)).toThrow(/Only audio clips stretch/);
  });
});

describe("time markers, for the assistant", () => {
  it("adds, renames, moves, gives kinds to and removes markers, by number or name", () => {
    let song = setMarkersTool(beat(), { action: "add", bar: 9, name: "Drop" }).song;
    song = setMarkersTool(song, { action: "add", bar: 5, kind: "punchIn" }).song;
    expect(song.playlist.markers?.map((m) => [m.tick, m.name, m.kind])).toEqual([
      [BAR * 4, "Start recording", "punchIn"],
      [BAR * 8, "Drop", "marker"],
    ]);
    song = setMarkersTool(song, { action: "update", id: "drop", bar: 17 }).song;
    expect(song.playlist.markers?.[1].tick).toBe(BAR * 16);
    const { text } = setMarkersTool(song, { action: "remove", id: 2 });
    expect(text).toBe('Time markers: 1. "Drop" at bar 17 (marker).');
    expect(setMarkersTool(song, { action: "remove", id: 2 }).song.playlist.markers).toHaveLength(1);
    expect(() => setMarkersTool(song, { action: "update", id: "nope" })).toThrow(/no marker/);
    expect(() => setMarkersTool(song, { action: "add", bar: 0 })).toThrow(/bar number/);
    expect(describePlaylist(song, "song")).toContain('"Drop" at bar 17');
  });
});
