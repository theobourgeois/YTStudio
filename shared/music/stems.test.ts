import { describe, expect, it } from "vitest";
import { addAudioClips, clipEnd, clipContext, editClips } from "./playlist.ts";
import { createMusicProject } from "./project.ts";
import { STEMS, placeStems, stemOf, stemOrigin, stemRequest, stemSources } from "./stems.ts";
import { PPQ, type MusicProject } from "./types.ts";

/** A song with a beat's audio clip on track 2 (a later part of the file, stretched), and a clip below it on track 3. */
function song(): MusicProject {
  let s = createMusicProject("Song", 120);
  s = addAudioClips(s, [{ channelId: "chan_beat", name: "Beat", sampleId: "media_beat", seconds: 8 }], { start: 4 * PPQ, track: 2 }).song;
  s = addAudioClips(s, [{ channelId: "chan_pad", name: "Pad", sampleId: "media_pad", seconds: 2 }], { start: 6 * PPQ, track: 3 }).song;
  s = { ...s, channels: s.channels.map((c) => (c.id === "chan_beat" ? { ...c, pitch: 2 } : c)) };
  return editClips(s, (clips) => clips.map((c) => (c.ref === "chan_beat" ? { ...c, offset: 1.5, length: 8 * PPQ, gain: 0.5, stretch: { mode: "stretch", tempo: 100 } } : c)));
}

const files = (...stems: (typeof STEMS)[number][]) => stems.map((stem) => ({ stem, sampleId: `media_${stem}`, seconds: 8 }));
let n = 0;
const ids = () => `chan_new${++n}`;

describe("which sources make each stem", () => {
  it("is each stem's own, and everything not chosen for Other", () => {
    expect(stemSources(["vocals", "other"])).toEqual({ vocals: ["vocals"], other: ["drums", "bass", "guitar", "piano", "other"] });
    expect(stemSources(["vocals", "drums", "bass", "other"]).other).toEqual(["guitar", "piano", "other"]);
    expect(stemSources(["drums"])).toEqual({ drums: ["drums"] });
    expect(stemSources([...STEMS]).other).toEqual(["other"]);
  });

  it("names a stem's file by what it's made of, and reads it back", () => {
    const origin = stemOrigin("media_beat", "other", ["piano", "other", "guitar"]);
    expect(origin).toBe("stems:media_beat:other=guitar+other+piano");
    expect(stemOf({ origin })).toBe("other");
    expect(stemOf({ origin: "file:/x.wav:1:2" })).toBeNull();
    expect(stemOf(undefined)).toBeNull();
  });
});

describe("a stem request", () => {
  it("is checked, its stems in their order", () => {
    expect(stemRequest({ projectId: "p", sampleId: "m", stems: ["other", "vocals"] })).toEqual({ projectId: "p", sampleId: "m", stems: ["vocals", "other"] });
    expect(stemRequest({ projectId: "p", sampleId: "m", stems: [] })).toMatch(/stems is missing/);
    expect(stemRequest({ projectId: "p", sampleId: "m", stems: ["kazoo"] })).toMatch(/Unknown stems kazoo/);
    expect(stemRequest({ projectId: "p", stems: ["vocals"] })).toMatch(/sampleId/);
    expect(stemRequest(null)).toMatch(/projectId/);
  });
});

describe("placing stems", () => {
  it("adds a channel per stem, playing as the source's does, into the master", () => {
    const before = song();
    const clipId = before.playlist.clips.find((c) => c.ref === "chan_beat")!.id;
    const { song: after, channelIds } = placeStems(before, "chan_beat", [clipId], files("drums", "vocals"), { mute: true }, ids);
    const made = channelIds.map((id) => after.channels.find((c) => c.id === id)!);
    // In the stems' order (vocals first), whatever order the files came in.
    expect(made.map((c) => c.name)).toEqual(["Beat - Vocals", "Beat - Drums"]);
    expect(made.map((c) => c.sampleId)).toEqual(["media_vocals", "media_drums"]);
    expect(made.every((c) => c.kind === "audio" && c.pitch === 2 && c.mixerTrack === "master")).toBe(true);
  });

  it("puts each stem's clip under the clip, lined up with it, on the free tracks below, and mutes the clip", () => {
    const before = song();
    const source = before.playlist.clips.find((c) => c.ref === "chan_beat")!;
    const { song: after, channelIds } = placeStems(before, "chan_beat", [source.id], files("vocals", "drums", "bass"), { mute: true }, ids);
    const stems = channelIds.map((id) => after.playlist.clips.find((c) => c.ref === id)!);
    // Track 3 has the pad in the clip's time: the stems skip it.
    expect(stems.map((c) => c.track)).toEqual([4, 5, 6]);
    for (const clip of stems) {
      expect(clip).toMatchObject({ start: source.start, length: source.length, offset: 1.5, gain: 0.5, stretch: { mode: "stretch", tempo: 100 }, muted: false });
      expect(clipEnd(clip, clipContext(after))).toBe(clipEnd(source, clipContext(before)));
    }
    expect(after.playlist.clips.find((c) => c.id === source.id)!.muted).toBe(true);
    // New tracks are named after their stem.
    expect([4, 5, 6].map((t) => after.playlist.tracks[t]?.name)).toEqual(["Vocals", "Drums", "Bass"]);
  });

  it("leaves the clip playing when asked, and names no track that has clips", () => {
    let before = song();
    before = addAudioClips(before, [{ name: "Late", sampleId: "media_late", seconds: 1 }], { start: 64 * PPQ, track: 4 }).song;
    const source = before.playlist.clips.find((c) => c.ref === "chan_beat")!;
    const { song: after } = placeStems(before, "chan_beat", [source.id], files("vocals"), { mute: false }, ids);
    expect(after.playlist.clips.find((c) => c.id === source.id)!.muted).toBe(false);
    // Track 4 is free in the clip's time (its clip is much later), but it's in use: not renamed.
    expect(after.playlist.clips.some((c) => c.track === 4 && c.ref.startsWith("chan_new"))).toBe(true);
    expect(after.playlist.tracks[4]?.name ?? null).toBeNull();
  });

  it("makes channels only, for a channel without clips to mirror", () => {
    const before = song();
    const { song: after, channelIds } = placeStems(before, "chan_beat", [], files("bass"), { mute: true }, ids);
    expect(channelIds).toHaveLength(1);
    expect(after.playlist.clips).toEqual(before.playlist.clips);
  });

  it("changes nothing without stems or a source", () => {
    const before = song();
    expect(placeStems(before, "chan_beat", [], [], { mute: true }).song).toBe(before);
    expect(placeStems(before, "chan_gone", [], files("bass"), { mute: true }).song).toBe(before);
  });
});
