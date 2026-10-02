import { describe, expect, it } from "vitest";
import { updateMixerTrack } from "./mixer.ts";
import { addClips, updateTrack } from "./playlist.ts";
import { FIRST_PATTERN_ID, MASTER_TRACK_ID, createMusicProject } from "./project.ts";
import { addChannels, addPattern } from "./edits.ts";
import {
  type PlayedEvent,
  type RecordedNotesOptions,
  type Take,
  addRecordedNotes,
  addTakes,
  assignAudioTracks,
  audioTrackOf,
  linkAudioTracks,
  liveTakeTracks,
  recordedNotes,
  takeWindow,
} from "./recording.ts";
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

describe("liveTakeTracks", () => {
  it("shows takes still recording where addTakes will put them, each on a track of its own", () => {
    let song = updateTrack(song120(), 2, { mixerTrack: "insert_1" });
    song = { ...song, playlist: { ...song.playlist, clips: addClips([], [{ kind: "pattern", ref: FIRST_PATTERN_ID, track: 0, start: BAR, length: BAR }]).clips } };
    // Insert 1 on its audio track; insert 2 on track 0 while it's short of the pattern clip, then below it.
    expect(liveTakeTracks(song, [{ track: "insert_1", start: 0, end: BAR }, { track: "insert_2", start: 0, end: BAR / 2 }])).toEqual([2, 0]);
    expect(liveTakeTracks(song, [{ track: "insert_2", start: 0, end: BAR * 2 }, { track: "insert_3", start: 0, end: BAR }])).toEqual([1, 0]);
    const placed = addTakes(song, [take({ track: "insert_2", skip: 0, seconds: 4 })], { blend: false }, nextId).song;
    expect(placed.playlist.clips.find((c) => c.kind === "audio")!.track).toBe(1);
  });
});


describe("recordedNotes", () => {
  const options = (over: Partial<RecordedNotesOptions> = {}): RecordedNotesOptions => ({
    loopStart: 0,
    loopTicks: BAR * 4,
    through: true,
    startTick: 0,
    latencyTicks: 0,
    quantize: "none",
    grid: 24,
    ...over,
  });
  const ev = (key: number, on: boolean, tick: number, over: Partial<PlayedEvent> = {}): PlayedEvent => ({ channel: "chan_a", key, velocity: on ? 0.8 : 0, on, tick, counting: false, pass: 0, ...over });

  it("makes each key a note from where it went down to where it was let go, in the song's ticks", () => {
    const events = [ev(60, true, 10), ev(64, true, 100), ev(60, false, 90), ev(64, false, 200)];
    expect(recordedNotes(events, options({ loopStart: BAR }))).toEqual([
      { channel: "chan_a", pitch: 60, velocity: 0.8, start: BAR + 10, length: 80 },
      { channel: "chan_a", pitch: 64, velocity: 0.8, start: BAR + 100, length: 100 },
    ]);
  });

  it("moves notes back by the latency, ends held ones where play stopped, and puts count-in notes at the start", () => {
    const notes = recordedNotes([ev(60, true, 30), ev(62, true, 0, { counting: true })], options({ latencyTicks: 10, startTick: 0, stop: { tick: 230, pass: 0 } }));
    expect(notes).toEqual([
      { channel: "chan_a", pitch: 62, velocity: 0.8, start: 0, length: 230 },
      { channel: "chan_a", pitch: 60, velocity: 0.8, start: 20, length: 200 },
    ]);
    // Unknown stop: a step.
    expect(recordedNotes([ev(60, true, 30)], options())[0].length).toBe(24);
  });

  it("lays loop passes over each other, a pass's late first notes at the loop's end, and ends notes at the loop's end", () => {
    const loop = options({ through: false, loopTicks: BAR, latencyTicks: 6 });
    const notes = recordedNotes([ev(60, true, 100), ev(60, false, 148), ev(62, true, 2, { pass: 1 }), ev(62, false, 30, { pass: 1 }), ev(64, true, 370, { pass: 1 }), ev(64, false, 50, { pass: 2 })], loop);
    expect(notes.map((n) => [n.pitch, n.start, n.length])).toEqual([
      [60, 94, 48],
      [64, 364, 20],
      [62, 380, 4],
    ]);
  });

  it("quantizes as Record's menu says", () => {
    const one = [ev(60, true, 30), ev(60, false, 70)];
    const q = (quantize: RecordedNotesOptions["quantize"]) => recordedNotes(one, options({ quantize, grid: 24 }))[0];
    expect(q("none")).toMatchObject({ start: 30, length: 40 });
    expect(q("start")).toMatchObject({ start: 24, length: 46 });
    expect(q("end")).toMatchObject({ start: 30, length: 42 });
    expect(q("both")).toMatchObject({ start: 24, length: 48 });
    expect(q("startKeepLength")).toMatchObject({ start: 24, length: 40 });
  });
});

describe("addRecordedNotes", () => {
  const withSynth = () => addChannels(song120(), [{ id: "chan_a", name: "A", sampleId: null }]);
  const note = (start: number, pitch = 60) => ({ channel: "chan_a", pitch, velocity: 0.8, start, length: 48 });

  it("puts them in the selected pattern, if it isn't placed yet, with a clip from the bar recording started in", () => {
    const { song, patternId, clipId } = addRecordedNotes(withSynth(), [note(BAR + 100), note(BAR + 200, 64)], { patternId: FIRST_PATTERN_ID, startTick: BAR + 40 });
    expect(patternId).toBe(FIRST_PATTERN_ID);
    expect(song.patterns[0].notes.chan_a.map((n) => [n.start, n.pitch])).toEqual([
      [100, 60],
      [200, 64],
    ]);
    expect(song.playlist.clips).toEqual([expect.objectContaining({ id: clipId, kind: "pattern", ref: FIRST_PATTERN_ID, track: 0, start: BAR, length: null })]);
  });

  it("makes a new pattern when the selected one is already on the playlist, on the first track it fits", () => {
    let start = withSynth();
    start = { ...start, playlist: { ...start.playlist, clips: addClips([], [{ kind: "pattern", ref: FIRST_PATTERN_ID, track: 0, start: 0, length: BAR * 3 }]).clips } };
    const { song, patternId } = addRecordedNotes(start, [note(BAR * 2 + 10), note(BAR * 3 + 10)], { patternId: FIRST_PATTERN_ID, startTick: BAR * 3 }, () => "pat_new");
    expect(patternId).toBe("pat_new");
    expect(song.patterns.find((p) => p.id === FIRST_PATTERN_ID)!.notes).toEqual({});
    // From the bar of its first note (played in the latency before recording started).
    expect(song.patterns.find((p) => p.id === "pat_new")!.notes.chan_a.map((n) => n.start)).toEqual([10, BAR + 10]);
    expect(song.playlist.clips.find((c) => c.ref === "pat_new")).toMatchObject({ track: 1, start: BAR * 2 });
  });

  it("records into a clip of the selected pattern playing where recording started", () => {
    let start = addPattern(withSynth(), { id: "pat_b" });
    start = { ...start, playlist: { ...start.playlist, clips: addClips([], [{ kind: "pattern", ref: "pat_b", track: 3, start: BAR, length: BAR * 2, offset: 24 }]).clips } };
    const { song, clipId } = addRecordedNotes(start, [note(BAR + 50)], { patternId: "pat_b", startTick: BAR });
    expect(clipId).toBeNull();
    expect(song.playlist.clips).toEqual(start.playlist.clips);
    expect(song.patterns.find((p) => p.id === "pat_b")!.notes.chan_a.map((n) => n.start)).toEqual([74]);
  });

  it("leaves the song as it was when nothing was played on its channels", () => {
    const start = withSynth();
    expect(addRecordedNotes(start, [{ ...note(0), channel: "chan_gone" }], { patternId: FIRST_PATTERN_ID, startTick: 0 }).song).toBe(start);
  });
});
