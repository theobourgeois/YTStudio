import { describe, expect, it } from "vitest";
import { createAutomation } from "./automation.ts";
import { type BouncedFile, bounceRender, insideOf, placeBounced, playedInto, rerendered, unconsolidate } from "./consolidate.ts";
import { addChannels, addPattern, removePattern, setSteps } from "./edits.ts";
import { routeChannels, setEffect } from "./mixer.ts";
import { PRO_Q_PLUGIN } from "./pro-q-presets.ts";
import { addClips, clipContext, clipLength, duplicateClips, editClips, moveClips, resizeClips, sliceClips } from "./playlist.ts";
import { DEFAULT_VOLUME, FIRST_PATTERN_ID, MASTER_TRACK_ID, createMusicProject, normalizeMusicProject } from "./project.ts";
import type { MusicProject } from "./types.ts";

const DRUMS = FIRST_PATTERN_ID;
const BASS = "pat_bass";
const BAR = 384;

/**
 * At 120 BPM (a bar is two seconds): a drum pattern (kick into insert 1, which has an EQ, snare into insert 2)
 * twice on track 1, a bass pattern (into insert 3) on track 2, the kick's volume automated, and insert 1's fader.
 */
function song(): MusicProject {
  let s = addChannels(createMusicProject("Beat", 120), [
    { id: "chan_kick", name: "Kick", sampleId: null },
    { id: "chan_snare", name: "Snare", sampleId: null },
    { id: "chan_bass", name: "Bass", sampleId: null },
  ]);
  s = addPattern(s, { id: BASS, name: "Bass" });
  s = setSteps(setSteps(s, DRUMS, "chan_kick", [0, 4, 8, 12], true), DRUMS, "chan_snare", [4, 12], true);
  s = setSteps(s, BASS, "chan_bass", [0], true);
  s = routeChannels(routeChannels(routeChannels(s, ["chan_kick"], "insert_1"), ["chan_snare"], "insert_2"), ["chan_bass"], "insert_3");
  s = setEffect(s, "insert_1", 0, PRO_Q_PLUGIN, "fx_eq");
  s = editClips(s, (clips) =>
    addClips(clips, [
      { kind: "pattern", ref: DRUMS, track: 0, start: 0 },
      { kind: "pattern", ref: DRUMS, track: 0, start: BAR },
      { kind: "pattern", ref: BASS, track: 1, start: 0 },
    ]).clips,
  );
  s = createAutomation(s, { kind: "channel", channel: "chan_kick", control: "volume" }, { start: 0, length: BAR, track: 5 }, { id: "auto_kick" }).song;
  s = createAutomation(s, { kind: "mixer", track: "insert_1", control: "volume" }, { start: 0, length: BAR, track: 6 }, { id: "auto_fader" }).song;
  return s;
}

const clipsOf = (s: MusicProject, ids: number[]) => s.playlist.clips.filter((c) => ids.includes(c.id));
const file = (into: string, seconds: number, sampleId = `media_${into}`): BouncedFile => ({ into, sampleId, seconds, name: `Beat ${into}` });
const ids = (...list: number[]) => new Set(list);
/** Channel ids, one after another: chan_c1, chan_c2... */
const counter = () => {
  let n = 0;
  return () => `chan_c${++n}`;
};
/** The playlist's pattern and audio clips, as places. */
const places = (s: MusicProject) =>
  s.playlist.clips.filter((c) => c.kind !== "automation").map((c) => ({ kind: c.kind, ref: c.ref, track: c.track, start: c.start, length: c.length }));

describe("the render", () => {
  it("lists the mixer tracks clips play into, highest clip first", () => {
    const s = song();
    expect(playedInto(s, s.playlist.clips.filter((c) => c.kind === "pattern")).map((g) => [g.into, g.clips.map((c) => c.id)])).toEqual([
      ["insert_1", [1, 2]],
      ["insert_2", [1, 2]],
      ["insert_3", [3]],
    ]);
  });

  it("plays only the clips, into plain stand-ins for their mixer tracks (no effects, at 0 dB), with only their channels' automation", () => {
    const s = song();
    const render = bounceRender(s, clipsOf(s, [1, 2, 3]))!;
    expect(render.start).toBe(0);
    expect(render.end).toBe(2 * BAR);
    expect(render.stems).toEqual([
      { track: "bounce_1", into: "insert_1" },
      { track: "bounce_2", into: "insert_2" },
      { track: "bounce_3", into: "insert_3" },
    ]);
    const r = render.song;
    expect(r.mixer.tracks.map((t) => t.id)).toEqual([MASTER_TRACK_ID, "bounce_1", "bounce_2", "bounce_3"]);
    for (const track of r.mixer.tracks) {
      expect(track.effects.every((e) => e === null)).toBe(true);
      expect(track).toMatchObject({ volume: 0.8, pan: 0, muted: false });
    }
    expect(r.settings.volume).toBe(DEFAULT_VOLUME);
    expect(Object.fromEntries(r.channels.map((c) => [c.id, c.mixerTrack]))).toMatchObject({ chan_kick: "bounce_1", chan_snare: "bounce_2", chan_bass: "bounce_3" });
    expect(r.automations.map((a) => a.id)).toEqual(["auto_kick"]);
    expect(r.playlist.clips.map((c) => [c.kind, c.ref, c.start])).toEqual([
      ["pattern", DRUMS, 0],
      ["pattern", BASS, 0],
      ["automation", "auto_kick", 0],
      ["pattern", DRUMS, BAR],
    ]);
    // The server normalises it as it is.
    expect(normalizeMusicProject(r)).toEqual(r);
  });

  it("plays clips on a muted track, but not a muted channel's notes", () => {
    let s = song();
    s = { ...s, playlist: { ...s.playlist, tracks: [{ ...s.playlist.tracks[0], name: null, color: null, size: 1, mixerTrack: null, muted: true }] } };
    s = { ...s, channels: s.channels.map((c) => (c.id === "chan_snare" ? { ...c, muted: true } : c)) };
    const render = bounceRender(s, clipsOf(s, [1]))!;
    expect(render.stems.map((t) => t.into)).toEqual(["insert_1"]);
    expect(render.song.playlist.tracks[0].muted).toBe(false);
    expect(bounceRender(s, [])).toBeNull();
  });
});

describe("Consolidate", () => {
  it("puts a clip for each mixer track in the clips' place, playing back into it, with the clips inside", () => {
    const s = song();
    const placed = placeBounced(s, ids(1, 2), [file("insert_1", 4.5), file("insert_2", 4.5)], "cons_1", counter());
    const made = clipsOf(placed.song, placed.clipIds);
    // The kick's on the drums' track; the snare's on the first free one below (the bass is on the next).
    expect(made.map((c) => [c.track, c.start, c.length, c.offset])).toEqual([
      [0, 0, 864, 0],
      [2, 0, 864, 0],
    ]);
    expect(made.map((c) => placed.song.channels.find((ch) => ch.id === c.ref)?.mixerTrack)).toEqual(["insert_1", "insert_2"]);
    expect(made.map((c) => c.consolidated)).toEqual([
      { id: "cons_1", into: "insert_1", start: 0, track: 0 },
      { id: "cons_1", into: "insert_2", start: 0, track: 2 },
    ]);
    // The clips inside are kept once, for both.
    expect(insideOf(placed.song, "cons_1").map((c) => c.id)).toEqual([1, 2]);
    expect(placed.song.playlist.clips.some((c) => c.id === 1 || c.id === 2)).toBe(false);
    // Saved and opened again, it's the same.
    expect(normalizeMusicProject(placed.song).playlist).toEqual(placed.song.playlist);
  });

  it("Render as audio clip leaves the clips and goes below them", () => {
    const s = song();
    const placed = placeBounced(s, ids(3), [file("insert_3", 2.5)], null);
    expect(clipsOf(placed.song, placed.clipIds).map((c) => [c.track, c.start, c.length, c.consolidated])).toEqual([[2, 0, 480, undefined]]);
    expect(placed.song.playlist.clips.some((c) => c.id === 3)).toBe(true);
  });
});

describe("Unconsolidate", () => {
  const consolidated = () => {
    const placed = placeBounced(song(), ids(1, 2), [file("insert_1", 4.5), file("insert_2", 4.5)], "cons_1");
    return { song: placed.song, kick: placed.clipIds[0], snare: placed.clipIds[1] };
  };

  it("gives back the clips where the clip is now, takes its other mixer track's clip and the channels", () => {
    const { song: s, kick, snare } = consolidated();
    // Moved apart, they're two places: the snare's stays.
    const apart = editClips(s, (clips, ctx) => moveClips(clips, ids(kick), 2 * BAR, 3, ctx));
    expect(unconsolidate(apart, ids(kick)).song.playlist.clips.some((c) => c.id === snare)).toBe(true);
    const moved = editClips(s, (clips, ctx) => moveClips(clips, ids(kick, snare), 2 * BAR, 3, ctx));
    const back = unconsolidate(moved, ids(kick));
    expect(places(back.song)).toEqual([
      { kind: "pattern", ref: BASS, track: 1, start: 0, length: null },
      { kind: "pattern", ref: DRUMS, track: 3, start: 2 * BAR, length: null },
      { kind: "pattern", ref: DRUMS, track: 3, start: 3 * BAR, length: null },
    ]);
    expect(back.restored).toHaveLength(2);
    expect(back.song.channels.map((c) => c.id)).toEqual(song().channels.map((c) => c.id));
    expect(back.song.playlist.consolidations).toBeUndefined();
  });

  it("gives back only what's inside a trimmed clip, and the whole of a sliced one once", () => {
    const placed = placeBounced(song(), ids(3), [file("insert_3", 2.5)], "cons_bass");
    const trimmed = editClips(placed.song, (clips, ctx) => resizeClips(clips, ids(placed.clipIds[0]), "end", 192 - 480, ctx));
    expect(places(unconsolidate(trimmed, ids(placed.clipIds[0])).song).filter((c) => c.ref === BASS)).toEqual([{ kind: "pattern", ref: BASS, track: 1, start: 0, length: 192 }]);

    const { song: s, kick } = consolidated();
    const sliced = editClips(s, (clips, ctx) => sliceClips(clips, BAR, 0, 0, ctx).clips);
    const back = unconsolidate(sliced, ids(kick));
    expect(places(back.song).filter((c) => c.ref === DRUMS)).toHaveLength(2);
    expect(back.song.playlist.clips.some((c) => c.kind === "audio")).toBe(false);
  });

  it("a copy elsewhere gives back its own clips, and the first stays", () => {
    const { song: s, kick, snare } = consolidated();
    const copied = editClips(s, (clips, ctx) => duplicateClips(clips, ids(kick, snare), BAR, ctx, 4 * BAR).clips);
    const copy = copied.playlist.clips.find((c) => c.consolidated && c.start === 4 * BAR && c.track === 0)!;
    const back = unconsolidate(copied, ids(copy.id));
    expect(places(back.song).filter((c) => c.ref === DRUMS).map((c) => c.start)).toEqual([4 * BAR, 5 * BAR]);
    expect(back.song.playlist.clips.filter((c) => c.consolidated).map((c) => c.id)).toEqual([kick, snare]);
    expect(insideOf(back.song, "cons_1")).toHaveLength(2);
    // Their channels still play the first one.
    expect(back.song.channels).toHaveLength(copied.channels.length);
  });

  it("leaves out clips whose pattern is gone, and keeps them when the song's opened again otherwise", () => {
    const { song: s, kick } = consolidated();
    const reopened = normalizeMusicProject(s);
    expect(insideOf(reopened, "cons_1")).toHaveLength(2);
    expect(reopened.playlist).toEqual(s.playlist);
    // Deleted (and the song opened again), what's left of it is gone too.
    const deleted = editClips(s, (clips) => clips.filter((c) => !c.consolidated));
    expect(normalizeMusicProject(deleted).playlist.consolidations).toBeUndefined();
    const gone = removePattern(s, DRUMS);
    expect(normalizeMusicProject(gone).playlist.clips.find((c) => c.id === kick)?.consolidated).toBeUndefined();
    const back = unconsolidate(gone, ids(kick));
    expect(back.restored).toEqual([]);
    expect(back.song.playlist.clips.some((c) => c.consolidated)).toBe(false);
    expect(back.song.playlist.consolidations).toBeUndefined();
  });

  it("a consolidated clip consolidated again comes apart one step at a time, kept when the song's opened again", () => {
    const once = placeBounced(song(), ids(3), [file("insert_3", 2.5)], "cons_a");
    const twice = placeBounced(once.song, ids(once.clipIds[0]), [file("insert_3", 3, "media_again")], "cons_b");
    const reopened = normalizeMusicProject(twice.song);
    expect(Object.keys(reopened.playlist.consolidations ?? {}).sort()).toEqual(["cons_a", "cons_b"]);
    const first = unconsolidate(reopened, ids(twice.clipIds[0]));
    expect(first.song.playlist.clips.find((c) => c.id === first.restored[0])?.consolidated?.id).toBe("cons_a");
    const second = unconsolidate(first.song, new Set(first.restored));
    expect(places(second.song).filter((c) => c.ref === BASS)).toEqual([{ kind: "pattern", ref: BASS, track: 1, start: 0, length: null }]);
    expect(second.song.playlist.consolidations).toBeUndefined();
  });

  it("does nothing to clips that aren't consolidated", () => {
    const s = song();
    expect(unconsolidate(s, ids(1, 2, 3)).song).toBe(s);
  });
});

describe("Re-render", () => {
  it("each mixer track's channel plays its new file; whole clips take its length; a new track gets clips, a gone one loses them", () => {
    const placed = placeBounced(song(), ids(1, 2), [file("insert_1", 4.5), file("insert_2", 4.5)], "cons_1", counter());
    const [kick] = placed.clipIds;
    // A slice of the kick's clip, and a copy of it later.
    let s = editClips(placed.song, (clips, ctx) => duplicateClips(clips, ids(kick), BAR, ctx, 8 * BAR).clips);
    s = editClips(s, (clips, ctx) => sliceClips(clips, BAR, 0, 0, ctx).clips);
    const ctx = clipContext(s);
    const old = (sampleId: string) => (sampleId.startsWith("media_") ? 864 : null);
    const next = rerendered(s, "cons_1", [file("insert_1", 5, "media_kick2"), file("insert_3", 5, "media_new")], old, () => "chan_new");
    const chan = (id: string) => next.song.channels.find((c) => c.id === id);
    expect(chan("chan_c1")?.sampleId).toBe("media_kick2");
    // The snare's clip and channel are gone.
    expect(chan("chan_c2")).toBeUndefined();
    const kicks = next.song.playlist.clips.filter((c) => c.ref === "chan_c1").map((c) => [c.start, clipLength(c, ctx)]);
    // The slices keep their lengths (neither was the whole file); the copy (the whole file) is the new one's.
    expect(kicks).toEqual([
      [0, BAR],
      [BAR, 864 - BAR],
      [8 * BAR, 960],
    ]);
    // Insert 3 has a clip in each place: by the slices and by the copy.
    const added = next.song.playlist.clips.filter((c) => c.ref === "chan_new");
    expect(added.map((c) => [c.start, c.length, c.consolidated?.into])).toEqual([
      [0, 960, "insert_3"],
      [8 * BAR, 960, "insert_3"],
    ]);
    expect(next.clipIds).toHaveLength(2);
    expect(chan("chan_new")?.mixerTrack).toBe("insert_3");
  });
});
