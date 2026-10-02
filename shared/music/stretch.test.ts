import { describe, expect, it } from "vitest";
import { setTempo, updateChannel } from "./edits.ts";
import { createMusicProject, normalizeMusicProject } from "./project.ts";
import { addAudioClips, clipContext, clipLength, contentAt, editClips, makeUnique, resetPitch, resizeClips, setClipStretch, sliceClips, stretchChannel, stretchClips } from "./playlist.ts";
import { MAX_AUDIO_SPEED, audioPlayback, fileTempo, normalizeStretch, stretchedTo, tempoForBeats, tempoOfFile } from "./stretch.ts";
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

  it("can be given as a number of beats (FL's TIME menu), Resample taking the channel's pitch in", () => {
    expect(tempoForBeats(4, 4)).toBe(60);
    // An octave up, Resample plays it twice as fast already: the tempo is twice as high to last as long.
    expect(tempoForBeats(4, 4, "resample", 12)).toBe(120);
    expect(tempoOfFile(90, "stretch", 12)).toBe(90);
    expect(tempoOfFile(90, "resample", -12)).toBe(45);
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
    song = stretchChannel(song, "chan_vox", { mode: "resample", tempo: null });
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

  it("is a clip's own, over its channel's; taken away, it's its channel's again; each keeps its content", () => {
    // Made at 60 BPM, played at 120: twice as fast, so the four seconds last a bar.
    let song = stretchChannel(vocal(), "chan_vox", { mode: "stretch", tempo: 60 });
    let ctx = clipContext(song);
    expect(clipLength(song.playlist.clips[0], ctx)).toBe(BAR);
    expect(contentAt(song.playlist.clips[0], BAR, ctx)).toBeCloseTo(4);
    // Its own, at half speed: four bars.
    song = editClips(song, (clips, c) => setClipStretch(clips, new Set([1]), { mode: "resample", tempo: 240 }, c));
    ctx = clipContext(song);
    expect(clipLength(song.playlist.clips[0], ctx)).toBe(4 * BAR);
    const back = editClips(song, (clips, c) => setClipStretch(clips, new Set([1]), null, c));
    expect(back.playlist.clips[0]).not.toHaveProperty("stretch");
    expect(clipLength(back.playlist.clips[0], clipContext(back))).toBe(BAR);
    expect(editClips(back, (clips, c) => setClipStretch(clips, new Set([1]), null, c))).toBe(back);
    // A clip with its own isn't moved by its channel's.
    const own = editClips(back, (clips, c) => setClipStretch(clips, new Set([1]), { mode: "stretch", tempo: 120 }, c));
    expect(stretchChannel(own, "chan_vox", null).playlist).toBe(own.playlist);
    expect(stretchChannel(back, "chan_vox", null).playlist.clips[0].length).toBe(2 * BAR);
  });

  it("go with a clip that's sliced, copied or made unique, and are kept by normalising", () => {
    let song = editClips(vocal(), (clips, ctx) => stretchClips(clips, new Set([1]), "end", BAR, ctx, "stretch"));
    song = editClips(song, (clips, ctx) => sliceClips(clips, BAR, 0, 0, ctx).clips);
    expect(song.playlist.clips.map((c) => c.stretch?.tempo)).toEqual([180, 180]);
    const unique = makeUnique(song, 2, "chan_copy");
    expect(unique.playlist.clips[1]).toMatchObject({ ref: "chan_copy", stretch: { mode: "stretch", tempo: 180 } });
    const channel = stretchChannel(unique, "chan_copy", { mode: "resample", tempo: 100 });
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

describe("resetting the pitch, the speed kept", () => {
  /** How a song's clip plays its file: speed and pitch shift. */
  const heard = (song: MusicProject, index = 0) => {
    const clip = song.playlist.clips[index];
    const ctx = clipContext(song);
    const playback = audioPlayback(ctx.stretchOf(clip), ctx.pitchOf(clip.ref), ctx.tempo);
    const semitones = playback.keepPitch ? playback.transpose : Math.round(Math.log2(playback.speed) * 12 * 1000) / 1000;
    return { speed: Math.round(playback.speed * 1e6) / 1e6, semitones, length: clipLength(clip, ctx) };
  };

  it("plays a clip sped up the Resample way at the same speed, at its file's pitch", () => {
    // Dragged shorter in Resample: twice as fast, an octave up.
    const song = editClips(vocal(), (clips, ctx) => stretchClips(clips, new Set([1]), "end", -BAR, ctx, "resample"));
    expect(heard(song)).toEqual({ speed: 2, semitones: 12, length: BAR });
    const reset = resetPitch(song, { clips: new Set([1]) });
    expect(heard(reset)).toEqual({ speed: 2, semitones: 0, length: BAR });
    expect(reset.playlist.clips[0].stretch).toEqual({ mode: "stretch", tempo: 60 });
    // Nothing pitched any more: the same song.
    expect(resetPitch(reset, { clips: new Set([1]) })).toBe(reset);
  });

  it("takes a pitched channel's pitch back to 0, with every clip of it, each at its speed", () => {
    let song = editClips(vocal(), (clips, ctx) => sliceClips(clips, BAR, 0, 0, ctx).clips);
    // A fifth up (Resample: faster too); the second clip has a Resample stretch of its own on top.
    song = updateChannel(song, "chan_vox", { pitch: 7 });
    song = editClips(song, (clips, c) => setClipStretch(clips, new Set([2]), { mode: "resample", tempo: 60 }, c));
    const was = [heard(song, 0), heard(song, 1)];
    expect(was.map((h) => h.semitones)).toEqual([7, 19]);
    // From a clip of it: its channel's pitch is every clip's, so the channel goes back with them.
    const reset = resetPitch(song, { clips: new Set([1]) });
    expect(reset.channels.find((c) => c.id === "chan_vox")).toMatchObject({ pitch: 0, stretch: { mode: "stretch" } });
    expect([heard(reset, 0), heard(reset, 1)]).toEqual(was.map((h) => ({ ...h, semitones: 0 })));
    expect(resetPitch(song, { channel: "chan_vox" })).toEqual(reset);
  });

  it("leaves a clip heard at its own pitch alone", () => {
    const stretched = editClips(vocal(), (clips, ctx) => stretchClips(clips, new Set([1]), "end", BAR, ctx, "stretch"));
    expect(resetPitch(stretched, { clips: new Set([1]) })).toBe(stretched);
    const plain = vocal();
    expect(resetPitch(plain, { channel: "chan_vox" })).toBe(plain);
  });
});

function song0Pattern() {
  return createMusicProject("x").patterns[0].id;
}
