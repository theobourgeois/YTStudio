import { describe, expect, it } from "vitest";
import { updateMixerTrack } from "./mixer.ts";
import { addClips, updateTrack } from "./playlist.ts";
import { FIRST_PATTERN_ID, MASTER_TRACK_ID, createMusicProject } from "./project.ts";
import { type Take, addTakes, assignAudioTracks, audioTrackOf, linkAudioTracks, takeWindow } from "./recording.ts";
import type { MusicProject } from "./types.ts";

/** At 120 BPM a tick is 1/192 s: a bar (384 ticks) is two seconds. */
const song120 = () => createMusicProject("Song", 120);
const SPT = 60 / (120 * 96);
const BAR = 384;

const take = (over: Partial<Take> = {}): Take => ({ track: "insert_1", sampleId: "media_take", seconds: 4.01, startTick: 0, skip: 480, sampleRate: 48_000, pass: 0, final: true, ...over });
let ids = 0;
const nextId = () => `chan_t${++ids}`;
const clipsOn = (song: MusicProject) => song.playlist.clips.map((c) => ({ track: c.track, start: c.start, muted: c.muted, offset: c.offset }));

describe("takeWindow", () => {
  it("leaves the latency at the take's head out: the clip starts where recording did, that far into its file", () => {
    // 480 samples at 48 kHz: 10 ms.
    expect(takeWindow(take(), 0, SPT)).toEqual({ start: 0, offset: 0.01, length: BAR * 2 });
    expect(takeWindow(take({ startTick: BAR, skip: 0, seconds: 2 }), 0, SPT)).toEqual({ start: BAR, offset: 0, length: BAR });
  });

  it("moves it earlier by the track's input offset, or later (starting later) when it's negative", () => {
    expect(takeWindow(take(), 15, SPT).offset).toBeCloseTo(0.025);
    const late = takeWindow(take({ skip: 0, startTick: BAR, seconds: 2 }), -1000 * SPT * 10, SPT);
    expect(late).toMatchObject({ start: BAR + 10, offset: 0 });
  });
});

describe("addTakes", () => {
  it("makes each take an audio clip on a channel of its own, routed into the track that recorded it, named after it", () => {
    let song = updateMixerTrack(song120(), "insert_1", { name: "Vox" });
    const { song: next, clipIds } = addTakes(song, [take()], { blend: false }, nextId);
    const channel = next.channels.at(-1)!;
    expect(channel).toMatchObject({ kind: "audio", name: "Vox", sampleId: "media_take", mixerTrack: "insert_1" });
    expect(next.playlist.clips).toEqual([{ id: clipIds[0], kind: "audio", ref: channel.id, track: 0, start: 0, length: BAR * 2, offset: 0.01, muted: false }]);
    // The master never records, and a track that's gone takes nothing.
    song = addTakes(song120(), [take({ track: MASTER_TRACK_ID }), take({ track: "insert_gone" })], { blend: false }, nextId).song;
    expect(song.playlist.clips).toEqual([]);
  });

  it("puts a take on the first playlist track it fits on (FL's), the next ones below", () => {
    let song = song120();
    song = { ...song, playlist: { ...song.playlist, clips: addClips([], [{ kind: "pattern", ref: FIRST_PATTERN_ID, track: 0, start: 0, length: BAR }]).clips } };
    const placed = addTakes(song, [take({ startTick: BAR, seconds: 2, skip: 0 }), take({ track: "insert_2", startTick: 0, seconds: 2, skip: 0 })], { blend: false }, nextId).song;
    // After the pattern clip on track 0, the first fits there; the second overlaps both, so goes to track 1.
    expect(clipsOn(placed).filter((c) => c.offset === 0 && c.track > -1).map((c) => [c.track, c.start])).toEqual([
      [0, 0],
      [1, 0],
      [0, BAR],
    ]);
  });

  it("puts a take on its track's audio track, and never on another insert's", () => {
    let song = updateTrack(song120(), 3, { mixerTrack: "insert_1" });
    song = updateTrack(song, 0, { mixerTrack: "insert_2" });
    const placed = addTakes(song, [take(), take({ track: "insert_9" })], { blend: false }, nextId).song;
    expect(placed.playlist.clips.map((c) => c.track)).toEqual([1, 3]);
  });

  it("stacks a loop recording's passes below each other, muting all but the last unless they blend", () => {
    const song = updateTrack(song120(), 2, { mixerTrack: "insert_1" });
    const passes = [take({ pass: 0, final: false, seconds: 2 }), take({ pass: 1, final: false, seconds: 2, skip: 0 }), take({ pass: 2, final: true, seconds: 1, skip: 0 })];
    const muted = addTakes(song, passes, { blend: false }, nextId).song;
    expect(muted.playlist.clips.map((c) => [c.track, c.muted])).toEqual([
      [2, true],
      [3, true],
      [4, false],
    ]);
    expect(muted.channels.slice(-3).map((c) => c.name)).toEqual(["Insert 1", "Insert 1 take 2", "Insert 1 take 3"]);
    expect(addTakes(song, passes, { blend: true }, nextId).song.playlist.clips.every((c) => !c.muted)).toBe(true);
  });
});

describe("audio tracks", () => {
  it("link playlist tracks to inserts, the next ones to the next inserts, one audio track each", () => {
    let song = linkAudioTracks(song120(), [4, 2], "insert_3");
    expect([2, 4].map((i) => song.playlist.tracks[i].mixerTrack)).toEqual(["insert_3", "insert_4"]);
    expect(audioTrackOf(song, "insert_4")).toBe(4);
    // Linked elsewhere, the first goes back to being an ordinary track.
    song = linkAudioTracks(song, [0], "insert_3");
    expect(song.playlist.tracks.map((t) => t.mixerTrack)).toEqual(["insert_3", null, null, null, "insert_4"]);
    expect(linkAudioTracks(song, [0], null).playlist.tracks[0]?.mixerTrack ?? null).toBeNull();
    expect(linkAudioTracks(song, [1], MASTER_TRACK_ID)).toBe(song);
  });

  it("are made for inserts below everything in use, named after them (Assign to new audio track)", () => {
    let song = updateMixerTrack(song120(), "insert_2", { name: "Gtr" });
    song = { ...song, playlist: { ...song.playlist, clips: addClips([], [{ kind: "pattern", ref: FIRST_PATTERN_ID, track: 1, start: 0 }]).clips } };
    const assigned = assignAudioTracks(song, ["insert_1", "insert_2", MASTER_TRACK_ID, "insert_1"]);
    expect(assigned.playlist.tracks.slice(2).map((t) => [t.name, t.mixerTrack])).toEqual([
      ["Insert 1", "insert_1"],
      ["Gtr", "insert_2"],
    ]);
    expect(assignAudioTracks(assigned, ["insert_1"])).toBe(assigned);
  });
});
