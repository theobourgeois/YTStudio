import { describe, expect, it } from "vitest";
import { removeChannels, removePattern, setPatternLength, setSteps, setTempo } from "./edits.ts";
import { createChannel, createMusicProject, DEFAULT_PLAYLIST_TRACK, MAX_PLAYLIST_TRACKS } from "./project.ts";
import {
  type NewClip,
  addAudioClips,
  addClips,
  clipAt,
  clipBounds,
  clipContext,
  clipEnd,
  clipLength,
  clipsInRect,
  cloneClips,
  copyClips,
  deleteSpace,
  deleteTrack,
  duplicateClips,
  editClips,
  insertSpace,
  insertTrack,
  makeUnique,
  moveClips,
  moveTrack,
  pasteClips,
  patternTickInSong,
  quantizeClips,
  removeClips,
  resizeClips,
  setClipProps,
  sliceAll,
  sliceClips,
  chopClips,
  pitchSpeed,
  slipClips,
  soloTrack,
  songTicks,
  splitByChannel,
  trackName,
  updateTrack,
  visibleClips,
} from "./playlist.ts";
import type { MusicProject } from "./types.ts";

const BAR = 384;

/** A song with a kick, a hat and a snare, a one-bar pattern of the three and an empty two-bar one. */
function makeSong(): MusicProject {
  let song: MusicProject = {
    ...createMusicProject("Song"),
    channels: [createChannel("Kick", "m_kick", "chan_kick"), createChannel("Hat", "m_hat", "chan_hat"), createChannel("Snare", "m_snare", "chan_snare")],
    patterns: [
      { id: "pat_beat", name: "Beat", length: null, notes: {}, color: null },
      { id: "pat_long", name: "Long", length: 32, notes: {}, color: null },
    ],
  };
  song = setSteps(song, "pat_beat", "chan_kick", [0, 8], true);
  song = setSteps(song, "pat_beat", "chan_hat", [2, 6, 10, 14], true);
  // At 120 BPM, whatever the default: a bar is two seconds.
  return setTempo(song, 120);
}

const clip = (c: Partial<NewClip> = {}): NewClip => ({ kind: "pattern", ref: "pat_beat", track: 0, start: 0, ...c });

/** A song with these clips on its playlist. */
function withClips(clips: NewClip[], song = makeSong()): MusicProject {
  return editClips(song, (list) => addClips(list, clips).clips);
}

const ids = (...list: number[]) => new Set(list);

describe("a playlist's clips", () => {
  it("are as long as their pattern until they're resized, and follow it", () => {
    const song = withClips([clip(), clip({ ref: "pat_long", start: BAR }), clip({ start: 3 * BAR, length: 100 })]);
    const ctx = clipContext(song);
    expect(song.playlist.clips.map((c) => clipLength(c, ctx))).toEqual([BAR, 2 * BAR, 100]);
    // The pattern grows: its clips that follow it grow too; a resized one doesn't.
    const longer = setPatternLength(song, "pat_beat", 32);
    expect(longer.playlist.clips.map((c) => clipLength(c, clipContext(longer)))).toEqual([2 * BAR, 2 * BAR, 100]);
    expect(songTicks(song)).toBe(4 * BAR);
    expect(songTicks(createMusicProject())).toBe(BAR);
  });

  it("are added with ids of their own, in order of start, and removed", () => {
    const song = withClips([clip({ start: BAR }), clip({ start: 0, track: 2 }), clip({ start: 0, track: 1 })]);
    expect(song.playlist.clips.map((c) => [c.id, c.start, c.track])).toEqual([
      [3, 0, 1],
      [2, 0, 2],
      [1, BAR, 0],
    ]);
    const { clips, created } = addClips(song.playlist.clips, [clip({ start: 5 })]);
    expect(created).toEqual([4]);
    expect(removeClips(clips, ids(4))).toEqual(song.playlist.clips);
    expect(removeClips(song.playlist.clips, ids(99))).toBe(song.playlist.clips);
  });

  it("move together, along the song and between tracks, stopping at the edges", () => {
    const song = withClips([clip({ start: BAR, track: 1 }), clip({ start: 2 * BAR, track: 3 })]);
    const ctx = clipContext(song);
    const moved = moveClips(song.playlist.clips, ids(1, 2), -2 * BAR, -5, ctx);
    // The first can only go back a bar and up a track: both stop there.
    expect(moved.map((c) => [c.start, c.track])).toEqual([
      [0, 0],
      [BAR, 2],
    ]);
    expect(moveClips(song.playlist.clips, ids(1), 0, 0, ctx)).toBe(song.playlist.clips);
    const last = moveClips(song.playlist.clips, ids(2), 0, 1000, ctx);
    expect(last.find((c) => c.id === 2)!.track).toBe(MAX_PLAYLIST_TRACKS - 1);
  });

  it("are cloned by Shift+drag, the originals staying", () => {
    const song = withClips([clip()]);
    const { clips, created } = cloneClips(song.playlist.clips, ids(1), BAR, 2, clipContext(song));
    expect(created).toEqual([2]);
    expect(clips.map((c) => [c.id, c.start, c.track])).toEqual([
      [1, 0, 0],
      [2, BAR, 2],
    ]);
  });

  it("resize by either edge: the start moves the window over its content, which stays put", () => {
    const song = withClips([clip({ start: BAR })]);
    const ctx = clipContext(song);
    const longer = resizeClips(song.playlist.clips, ids(1), "end", BAR, ctx);
    expect(longer[0]).toMatchObject({ start: BAR, length: 2 * BAR, offset: 0 });
    // The start can't go before the content's start: there's nothing of the pattern there.
    expect(resizeClips(song.playlist.clips, ids(1), "start", -96, ctx)).toBe(song.playlist.clips);
    const later = resizeClips(song.playlist.clips, ids(1), "start", 96, ctx);
    expect(later[0]).toMatchObject({ start: BAR + 96, length: BAR - 96, offset: 96 });
    // Back out again, as far as the content goes.
    expect(resizeClips(later, ids(1), "start", -500, ctx)[0]).toMatchObject({ start: BAR, length: BAR, offset: 0 });
    // Never shorter than `min`.
    expect(resizeClips(song.playlist.clips, ids(1), "end", -5000, ctx, 24)[0].length).toBe(24);
  });

  it("slip their content inside them, the window staying, and keep their length from then on", () => {
    const song = withClips([clip({ start: BAR, offset: 96 })]);
    const ctx = clipContext(song);
    const slipped = slipClips(song.playlist.clips, ids(1), 48, ctx);
    expect(slipped[0]).toMatchObject({ start: BAR, offset: 48, length: BAR - 96 });
    expect(slipClips(song.playlist.clips, ids(1), 500, ctx)[0].offset).toBe(0);
  });

  it("slice in two where the line crosses them, on the tracks it crosses", () => {
    const song = withClips([clip({ track: 0 }), clip({ track: 1 }), clip({ track: 2, start: 2 * BAR })]);
    const ctx = clipContext(song);
    const { clips, created } = sliceClips(song.playlist.clips, 96, 0, 1, ctx);
    expect(created).toEqual([4, 5]);
    expect(clips.filter((c) => c.track < 2).map((c) => [c.id, c.track, c.start, clipLength(c, ctx), c.offset])).toEqual([
      [1, 0, 0, 96, 0],
      [2, 1, 0, 96, 0],
      [4, 0, 96, BAR - 96, 96],
      [5, 1, 96, BAR - 96, 96],
    ]);
    // At an edge, or across nothing: whole.
    expect(sliceClips(song.playlist.clips, BAR, 0, 2, ctx).clips).toBe(song.playlist.clips);
  });

  it("go through their file at their channel's speed when it's pitched (FL's Resample)", () => {
    // Two bars of a four-second file at 120 BPM, its channel an octave up: twice as fast through the file.
    let song = withClips([{ kind: "audio", ref: "chan_kick", track: 0, start: 0, length: 2 * BAR, offset: 0 }]);
    song = { ...song, channels: song.channels.map((c) => (c.id === "chan_kick" ? { ...c, kind: "audio" as const, pitch: 12 } : c)) };
    const ctx = clipContext(song);
    expect(ctx.fileSecondsPerTick("chan_kick")).toBeCloseTo(2 * ctx.secondsPerTick);
    const { clips } = sliceClips(song.playlist.clips, BAR, 0, 0, ctx);
    expect(clips.map((c) => c.offset)).toEqual([0, 4]);
    expect(pitchSpeed(-12)).toBe(0.5);
  });

  it("chop into bars or beats of the song, each piece carrying on through the content", () => {
    // A two-bar pattern clip starting half a bar in, and an audio clip of four seconds (two bars).
    const song = withClips([clip({ ref: "pat_long", start: BAR / 2 }), { kind: "audio", ref: "chan_kick", track: 1, start: 0, length: 2 * BAR, offset: 1 }]);
    const ctx = clipContext(song);
    const { clips, created } = chopClips(song.playlist.clips, ids(1), BAR, ctx);
    expect(clips.filter((c) => c.track === 0).map((c) => [c.start, clipLength(c, ctx), c.offset])).toEqual([
      [BAR / 2, BAR / 2, 0],
      [BAR, BAR, BAR / 2],
      [2 * BAR, BAR / 2, BAR * 1.5],
    ]);
    expect(created).toHaveLength(2);
    // Audio clips go on through their file in seconds: two at 120 BPM a bar.
    const beats = chopClips(song.playlist.clips, ids(2), BAR / 4, ctx).clips.filter((c) => c.track === 1);
    expect(beats.map((c) => [c.start, c.offset])).toEqual([0, 1, 2, 3, 4, 5, 6, 7].map((n) => [(n * BAR) / 4, 1 + n * 0.5]));
    // Nothing inside to cut: the same clips back.
    expect(chopClips(song.playlist.clips, ids(1), 4 * BAR, ctx).clips).toBe(song.playlist.clips);
  });

  it("slice every track at once (Shift with the slice tool)", () => {
    const song = withClips([clip({ track: 0 }), clip({ track: 7 }), clip({ track: MAX_PLAYLIST_TRACKS - 1 }), clip({ track: 3, start: 2 * BAR })]);
    const ctx = clipContext(song);
    const { clips, created } = sliceAll(song.playlist.clips, 96, ctx);
    expect(created).toHaveLength(3);
    expect(clips.filter((c) => c.start === 96).map((c) => c.track)).toEqual([0, 7, MAX_PLAYLIST_TRACKS - 1]);
    // The clip the line doesn't cross is whole; so is everything, cut where no clip is.
    expect(clips.filter((c) => c.track === 3)).toHaveLength(1);
    expect(sliceAll(song.playlist.clips, 3 * BAR, ctx).clips).toBe(song.playlist.clips);
  });

  it("slice audio clips in seconds of their file, at the song's tempo", () => {
    const { song } = addAudioClips(makeSong(), [{ name: "Vocal", sampleId: "m_vox", seconds: 4, channelId: "chan_vox" }], { start: 0, track: 0 });
    const ctx = clipContext(song);
    // At 120 BPM four seconds are two bars.
    expect(clipLength(song.playlist.clips[0], ctx)).toBe(2 * BAR);
    const { clips } = sliceClips(song.playlist.clips, BAR, 0, 0, ctx);
    expect(clips[1]).toMatchObject({ kind: "audio", ref: "chan_vox", start: BAR, length: BAR, offset: 2 });
    // Its start pulled back reaches back into the file.
    expect(resizeClips(clips, ids(2), "start", -BAR / 2, ctx).find((c) => c.id === 2)).toMatchObject({ start: BAR / 2, offset: 1 });
  });

  it("mute, quantize, and are found by a rectangle or a point", () => {
    const song = withClips([clip({ start: 10 }), clip({ start: BAR + 30, track: 2 })]);
    const ctx = clipContext(song);
    expect(setClipProps(song.playlist.clips, ids(1), { muted: true })[0].muted).toBe(true);
    expect(quantizeClips(song.playlist.clips, new Set(), 96).map((c) => c.start)).toEqual([0, BAR + 0]);
    expect(clipsInRect(song.playlist.clips, 0, BAR, 0, 1, ctx)).toEqual([1]);
    expect(clipsInRect(song.playlist.clips, 0, 2 * BAR, 0, 5, ctx)).toEqual([1, 2]);
    expect(clipAt(song.playlist.clips, 2, BAR + 40, ctx)?.id).toBe(2);
    expect(clipAt(song.playlist.clips, 2, BAR + 20, ctx)).toBeNull();
    expect(clipBounds(song.playlist.clips, ctx)).toEqual({ start: 10, end: 2 * BAR + 30, top: 0, bottom: 2 });
  });

  it("duplicate to the right: straight after, or a time selection's length later", () => {
    const song = withClips([clip({ start: 0, length: 100 })]);
    const ctx = clipContext(song);
    const after = duplicateClips(song.playlist.clips, new Set(), 96, ctx);
    expect(after.interval).toBe(192);
    expect(after.clips.map((c) => c.start)).toEqual([0, 192]);
    expect(duplicateClips(song.playlist.clips, ids(1), 96, ctx, BAR).clips.map((c) => c.start)).toEqual([0, BAR]);
  });

  it("copy and paste on their own tracks, from where they're pasted", () => {
    const song = withClips([clip({ start: BAR, track: 1 }), clip({ start: BAR + 96, track: 3 })]);
    const copied = copyClips(song.playlist.clips, ids(1, 2));
    expect(copied.map((c) => [c.start, c.track])).toEqual([
      [0, 1],
      [96, 3],
    ]);
    expect(pasteClips(song.playlist.clips, copied, 4 * BAR).clips.slice(2).map((c) => [c.start, c.track])).toEqual([
      [4 * BAR, 1],
      [4 * BAR + 96, 3],
    ]);
  });

  it("insert and delete space across every track", () => {
    const song = withClips([clip({ start: 0 }), clip({ start: BAR, track: 1 }), clip({ start: 2 * BAR, track: 2 })]);
    const ctx = clipContext(song);
    expect(insertSpace(song.playlist.clips, BAR, 2 * BAR, ctx).map((c) => c.start)).toEqual([0, 2 * BAR, 3 * BAR]);
    // Sliced: the clip crossing the start is cut there and its second part moves too.
    const sliced = insertSpace(song.playlist.clips, BAR / 2, BAR, ctx, true);
    expect(sliced.map((c) => [c.track, c.start, clipLength(c, ctx)])).toEqual([
      [0, 0, BAR / 2],
      [0, BAR, BAR / 2],
      [1, 3 * BAR / 2, BAR],
      [2, 5 * BAR / 2, BAR],
    ]);
    // Deleted: what's inside goes (clips crossing its edges are cut) and the rest closes up.
    const closed = deleteSpace(song.playlist.clips, BAR / 2, 3 * BAR / 2, ctx);
    expect(closed.map((c) => [c.track, c.start, clipLength(c, ctx), c.offset])).toEqual([
      [0, 0, BAR / 2, 0],
      [1, BAR / 2, BAR / 2, BAR / 2],
      [2, BAR, BAR, 0],
    ]);
    expect(deleteSpace(song.playlist.clips, BAR, BAR, ctx)).toBe(song.playlist.clips);
  });

  it("show only those in view, even among many thousands", () => {
    const many = withClips(Array.from({ length: 20_000 }, (_, i) => clip({ start: i * 96, track: i % 50, length: 96 })));
    const ctx = clipContext(many);
    const started = performance.now();
    const [from, to] = visibleClips(many.playlist.clips, 1000 * 96, 1010 * 96, ctx);
    expect(to - from).toBeLessThanOrEqual(12);
    const moved = moveClips(many.playlist.clips, new Set(many.playlist.clips.map((c) => c.id)), 96, 1, ctx);
    expect(moved).toHaveLength(20_000);
    expect(performance.now() - started).toBeLessThan(500);
  });

  it("go when their pattern or audio channel does", () => {
    const { song: withAudio } = addAudioClips(withClips([clip(), clip({ ref: "pat_long" })]), [{ name: "Vocal", sampleId: "m_vox", seconds: 2, channelId: "chan_vox" }], { start: 0, track: 3 });
    expect(withAudio.playlist.clips).toHaveLength(3);
    expect(removePattern(withAudio, "pat_long").playlist.clips.map((c) => c.ref)).toEqual(["pat_beat", "chan_vox"]);
    expect(removeChannels(withAudio, ["chan_vox"]).playlist.clips.map((c) => c.ref)).toEqual(["pat_beat", "pat_long"]);
  });
});

describe("audio clips dropped on the playlist", () => {
  it("make a channel each, in the rack, and a clip as long as the file, down the tracks or one after another", () => {
    const files = [
      { name: "Vocal", sampleId: "m_vox", seconds: 2, channelId: "chan_vox" },
      { name: "Guitar", sampleId: "m_gtr", seconds: 1, channelId: "chan_gtr" },
    ];
    const stacked = addAudioClips(makeSong(), files, { start: BAR, track: 2 });
    expect(stacked.channelIds).toEqual(["chan_vox", "chan_gtr"]);
    expect(stacked.song.channels.slice(3).map((c) => [c.kind, c.name, c.sampleId])).toEqual([
      ["audio", "Vocal", "m_vox"],
      ["audio", "Guitar", "m_gtr"],
    ]);
    expect(stacked.song.playlist.clips.map((c) => [c.kind, c.track, c.start, c.length])).toEqual([
      ["audio", 2, BAR, BAR],
      ["audio", 3, BAR, BAR / 2],
    ]);
    const after = addAudioClips(makeSong(), files, { start: 0, track: 0, after: true });
    expect(after.song.playlist.clips.map((c) => [c.track, c.start])).toEqual([
      [0, 0],
      [0, BAR],
    ]);
  });
});

describe("playlist tracks", () => {
  it("are as new until they're changed, and the list only as long as it needs to be", () => {
    const song = makeSong();
    expect(trackName(song, 4)).toBe("Track 5");
    const named = updateTrack(song, 2, { name: " Drums ", color: "#AA0000", size: 9 });
    expect(named.playlist.tracks).toEqual([DEFAULT_PLAYLIST_TRACK, DEFAULT_PLAYLIST_TRACK, { name: "Drums", color: "#aa0000", size: 4, muted: false }]);
    expect(trackName(named, 2)).toBe("Drums");
    expect(updateTrack(named, 2, { name: "", color: null, size: 1 }).playlist.tracks).toEqual([]);
    expect(updateTrack(song, 0, { muted: false })).toBe(song);
  });

  it("solo as channels do: a state of the mutes", () => {
    const song = withClips([clip({ track: 0 }), clip({ track: 1 }), clip({ track: 3 })]);
    const solo = soloTrack(song, 1);
    expect([0, 1, 2, 3].map((i) => solo.playlist.tracks[i]?.muted ?? false)).toEqual([true, false, true, true]);
    expect(soloTrack(solo, 1).playlist.tracks).toEqual([]);
  });

  it("are inserted, deleted and moved with their clips", () => {
    const song = updateTrack(withClips([clip({ track: 0 }), clip({ track: 1 }), clip({ track: 2 })]), 1, { name: "B" });
    const inserted = insertTrack(song, 1);
    expect(inserted.playlist.clips.map((c) => c.track)).toEqual([0, 2, 3]);
    expect(trackName(inserted, 2)).toBe("B");
    const deleted = deleteTrack(song, 1);
    expect(deleted.playlist.clips.map((c) => [c.id, c.track])).toEqual([
      [1, 0],
      [3, 1],
    ]);
    expect(deleted.playlist.tracks).toEqual([]);
    const moved = moveTrack(song, 1, 1);
    expect(moved.playlist.clips.map((c) => [c.id, c.track])).toEqual([
      [1, 0],
      [3, 1],
      [2, 2],
    ]);
    expect(trackName(moved, 2)).toBe("B");
    expect(moveTrack(song, 0, -1)).toBe(song);
  });
});

describe("making a clip unique", () => {
  it("gives it a copy of its pattern of its own, named after it", () => {
    const song = withClips([clip(), clip({ start: BAR })]);
    const unique = makeUnique(song, 2, "pat_copy");
    expect(unique.patterns.map((p) => [p.id, p.name])).toEqual([
      ["pat_beat", "Beat"],
      ["pat_copy", "Beat #2"],
      ["pat_long", "Long"],
    ]);
    expect(unique.patterns[1].notes).toBe(song.patterns[0].notes);
    expect(unique.playlist.clips.map((c) => c.ref)).toEqual(["pat_beat", "pat_copy"]);
    expect(makeUnique(song, 99)).toBe(song);
  });
});

describe("split by channel", () => {
  it("replaces the pattern by one per channel, named after it, its clips by one per channel on the free tracks below", () => {
    let n = 0;
    const next = () => `pat_split${++n}`;
    const song = withClips([clip({ track: 1, start: 0 }), clip({ ref: "pat_long", track: 2, start: 0 }), clip({ track: 1, start: 2 * BAR, length: BAR / 2 })]);
    const split = splitByChannel(song, "pat_beat", next);
    expect(split.patterns.map((p) => [p.id, p.name, p.length])).toEqual([
      ["pat_split1", "Kick", 16],
      ["pat_split2", "Hat", 16],
      ["pat_long", "Long", 32],
    ]);
    expect(split.patterns[0].notes).toEqual({ chan_kick: song.patterns[0].notes.chan_kick });
    // The first clip's hat skips track 2, where "Long" is; the later one's goes straight below.
    expect(split.playlist.clips.map((c) => [c.ref, c.track, c.start, c.length])).toEqual([
      ["pat_split1", 1, 0, null],
      ["pat_long", 2, 0, null],
      ["pat_split2", 3, 0, null],
      ["pat_split1", 1, 2 * BAR, BAR / 2],
      ["pat_split2", 2, 2 * BAR, BAR / 2],
    ]);
    const ctx = clipContext(split);
    expect(split.playlist.clips.map((c) => clipEnd(c, ctx))).toEqual([BAR, 2 * BAR, BAR, 2 * BAR + BAR / 2, 2 * BAR + BAR / 2]);
  });

  it("does nothing to an empty pattern", () => {
    const song = makeSong();
    expect(splitByChannel(song, "pat_long")).toBe(song);
  });
});

describe("where a pattern is in the song", () => {
  it("is inside its clips, past their offset, and nowhere past the pattern's end", () => {
    const song = withClips([clip({ start: BAR, offset: 96, length: 2 * BAR })]);
    expect(patternTickInSong(song, "pat_beat", BAR + 10)).toBe(106);
    expect(patternTickInSong(song, "pat_beat", 10)).toBeNull();
    // Past the pattern's end (a bar, from its offset), the clip plays nothing.
    expect(patternTickInSong(song, "pat_beat", 2 * BAR + 300)).toBeNull();
    expect(patternTickInSong(song, "pat_long", BAR + 10)).toBeNull();
  });
});

