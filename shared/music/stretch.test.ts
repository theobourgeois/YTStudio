import { describe, expect, it } from "vitest";
import { setChannelStretch, setTempo } from "./edits.ts";
import { createMusicProject, normalizeMusicProject } from "./project.ts";
import { addAudioClips, clipContext, clipLength, contentAt, editClips, makeUnique, resizeClips, setClipStretch, sliceClips, stretchClips } from "./playlist.ts";
import { MAX_AUDIO_SPEED, audioPlayback, fileTempo, normalizeStretch, stretchedTo, tempoForBeats } from "./stretch.ts";
import type { MusicProject } from "./types.ts";

const BAR = 384;

/** A song at 120 BPM (a bar is two seconds) with a four-second vocal from its first bar. */
function vocal(): MusicProject {
  const { song } = addAudioClips(setTempo(createMusicProject("Song"), 120), [{ name: "Vocal", sampleId: "media_vox", seconds: 4, channelId: "chan_vox" }], { start: 0, track: 0 });
  return song;
}

describe("how an audio clip plays its file", () => {
  it("is at its own speed without a stretch, faster and higher with its channel pitched (Resample)", () => {
    expect(audioPlayback(undefined, 0, 120)).toEqual({ speed: 1, transpose: 0, keepPitch: false });
    expect(audioPlayback(undefined, 12, 120)).toEqual({ speed: 2, transpose: 0, keepPitch: false });
  });

  it("follows the song's tempo against its own when stretched, in either mode", () => {
    // A 90 BPM loop in a 120 BPM song plays a third faster.
    expect(audioPlayback({ mode: "resample", tempo: 90 }, 0, 120).speed).toBeCloseTo(4 / 3);
    expect(audioPlayback({ mode: "stretch", tempo: 90 }, 0, 120)).toMatchObject({ keepPitch: true, transpose: 0 });
    expect(audioPlayback({ mode: "stretch", tempo: 90 }, 0, 120).speed).toBeCloseTo(4 / 3);
    // Resample: its channel's pitch speeds it up too. Stretch: it shifts its pitch, its time kept.
    expect(audioPlayback({ mode: "resample", tempo: 60 }, 12, 120).speed).toBeCloseTo(4);
    expect(audioPlayback({ mode: "stretch", tempo: 60 }, 12, 120)).toEqual({ speed: 2, transpose: 12, keepPitch: true });
    // A stretch that changes nothing goes through no stretcher.
    expect(audioPlayback({ mode: "stretch", tempo: 120 }, 0, 120).keepPitch).toBe(false);
    expect(audioPlayback({ mode: "stretch", tempo: null }, 0, 120).keepPitch).toBe(false);
    expect(audioPlayback({ mode: "stretch", tempo: null }, -3, 120)).toEqual({ speed: 1, transpose: -3, keepPitch: true });
  });

  it("stays within the engine's speeds", () => {
    expect(audioPlayback({ mode: "resample", tempo: 5 }, 0, 999).speed).toBe(MAX_AUDIO_SPEED);
  });
});

describe("the tempo a file was made at", () => {
  it("is rounded to a whole number of beats when that's close to what was heard", () => {
    // Two bars at 120 BPM, heard as 118: it's 120 (eight beats).
    expect(fileTempo(4, 118)).toBe(120);
    // Nowhere near a whole number of beats: as heard.
    expect(fileTempo(4.4, 100)).toBe(100);
  });

  it("is guessed from its length when no beat is heard: a power of two beats, nearest 120", () => {
    expect(fileTempo(4, null)).toBe(120);
    expect(fileTempo(2.5, null)).toBe(96);
    expect(fileTempo(0, null)).toBeNull();
  });

  it("can be given as a number of beats (FL's TIME menu)", () => {
    expect(tempoForBeats(4, 4)).toBe(60);
  });
});

describe("stretching audio clips", () => {
  it("keeps their content and changes their speed to fill the new length", () => {
    const song = vocal();
    const ctx = clipContext(song);
    // Its end dragged a bar further: four seconds in three bars, played at two thirds of its speed.
    const [clip] = stretchClips(song.playlist.clips, new Set([1]), "end", BAR, ctx, "stretch");
    expect(clipLength(clip, ctx)).toBe(3 * BAR);
    expect(clip.offset).toBe(0);
    expect(clip.stretch).toEqual({ mode: "stretch", tempo: 180 });
    expect(contentAt(clip, 3 * BAR, ctx)).toBeCloseTo(4);
    // Its start dragged a bar in: the same four seconds in one bar, from where its start is now.
    const [short] = stretchClips(song.playlist.clips, new Set([1]), "start", BAR, ctx, "resample");
    expect([short.start, clipLength(short, ctx), short.offset, short.stretch]).toEqual([BAR, BAR, 0, { mode: "resample", tempo: 60 }]);
    expect(contentAt(short, 2 * BAR, ctx)).toBeCloseTo(4);
  });

  it("keep a mode they already have, and stretch every selected clip by the same ticks", () => {
    let song = vocal();
    song = editClips(song, (clips, ctx) => sliceClips(clips, BAR, 0, 0, ctx).clips);
    song = setChannelStretch(song, "chan_vox", { mode: "resample", tempo: null });
    const ctx = clipContext(song);
    const stretched = stretchClips(song.playlist.clips, new Set([1, 2]), "end", BAR / 2, ctx, "stretch");
    expect(stretched.map((c) => [clipLength(c, ctx), c.stretch?.mode])).toEqual([
      [BAR * 1.5, "resample"],
      [BAR * 1.5, "resample"],
    ]);
    // The second still starts where its content was cut (two seconds into the file).
    expect(stretched[1].offset).toBe(2);
  });

  it("leave clips that aren't audio to resize as usual", () => {
    const song = editClips(vocal(), (clips) => [...clips, { id: 9, kind: "pattern", ref: song0Pattern(), track: 1, start: 0, length: BAR, offset: 0, muted: false }]);
    const ctx = clipContext(song);
    expect(stretchClips(song.playlist.clips, new Set([9]), "end", BAR, ctx, "stretch")).toEqual(resizeClips(song.playlist.clips, new Set([9]), "end", BAR, ctx));
  });

  it("follow the tempo once stretched: the same bars at another tempo", () => {
    const song = editClips(vocal(), (clips, ctx) => stretchClips(clips, new Set([1]), "end", BAR, ctx, "stretch"));
    const faster = setTempo(song, 150);
    const ctx = clipContext(faster);
    expect(contentAt(faster.playlist.clips[0], 3 * BAR, ctx)).toBeCloseTo(4);
    // An unstretched clip at the new tempo goes further into its file in the same ticks.
    expect(contentAt(vocal().playlist.clips[0], 2 * BAR, clipContext(setTempo(vocal(), 60)))).toBeCloseTo(8);
  });

  it("is a clip's own, over its channel's; taken away, it's its channel's again", () => {
    let song = setChannelStretch(vocal(), "chan_vox", { mode: "stretch", tempo: 60 });
    let ctx = clipContext(song);
    // Made at 60 BPM, played at 120: twice as fast, so two bars go through eight seconds of the file.
    expect(contentAt(song.playlist.clips[0], 2 * BAR, ctx)).toBeCloseTo(8);
    song = editClips(song, (clips) => setClipStretch(clips, new Set([1]), { mode: "resample", tempo: 240 }));
    ctx = clipContext(song);
    expect(contentAt(song.playlist.clips[0], 2 * BAR, ctx)).toBeCloseTo(2);
    const back = editClips(song, (clips) => setClipStretch(clips, new Set([1]), null));
    expect(back.playlist.clips[0]).not.toHaveProperty("stretch");
    expect(editClips(back, (clips) => setClipStretch(clips, new Set([1]), null))).toBe(back);
  });

  it("go with a clip that's sliced, copied or made unique, and are kept by normalising", () => {
    let song = editClips(vocal(), (clips, ctx) => stretchClips(clips, new Set([1]), "end", BAR, ctx, "stretch"));
    song = editClips(song, (clips, ctx) => sliceClips(clips, BAR, 0, 0, ctx).clips);
    expect(song.playlist.clips.map((c) => c.stretch?.tempo)).toEqual([180, 180]);
    const unique = makeUnique(song, 2, "chan_copy");
    expect(unique.playlist.clips[1]).toMatchObject({ ref: "chan_copy", stretch: { mode: "stretch", tempo: 180 } });
    const channel = setChannelStretch(unique, "chan_copy", { mode: "resample", tempo: 100 });
    const loaded = normalizeMusicProject(JSON.parse(JSON.stringify(channel)), () => true);
    expect(loaded.playlist.clips).toEqual(channel.playlist.clips);
    expect(loaded.channels.find((c) => c.id === "chan_copy")?.stretch).toEqual({ mode: "resample", tempo: 100 });
    expect(normalizeStretch({ mode: "elastique", tempo: 100 })).toBeUndefined();
    expect(normalizeStretch({ mode: "stretch", tempo: -4 })).toEqual({ mode: "stretch", tempo: null });
  });

  it("are clamped to the engine's speeds", () => {
    // Four seconds squeezed into a tick would be far past 16 times as fast.
    const { stretch, length } = stretchedTo({ fileSecondsPerTick: 1 / 192, length: 768 }, 1, "stretch", { tempo: 120, secondsPerTick: 1 / 192, pitch: 0 });
    expect(stretch.tempo).toBe(7.5);
    expect(length).toBe(48);
  });
});

function song0Pattern() {
  return createMusicProject("x").patterns[0].id;
}
