import { describe, expect, it } from "vitest";
import { addMarker, lastMarkerAfter, markersOf, normalizeMarkers, punchRange, removeMarker, updateMarker } from "./markers.ts";
import { createMusicProject, normalizeMusicProject } from "./project.ts";

const BAR = 384;

describe("time markers", () => {
  it("are added, named, moved, given a kind and removed, in order of where they are", () => {
    let song = createMusicProject("Markers");
    expect(markersOf(song)).toEqual([]);
    const a = addMarker(song, BAR * 4);
    song = a.song;
    song = addMarker(song, BAR, { name: "Intro" }).song;
    expect(markersOf(song).map((m) => [m.tick, m.name, m.kind])).toEqual([
      [BAR, "Intro", "marker"],
      [BAR * 4, "Marker 1", "marker"],
    ]);
    expect(updateMarker(song, a.id!, { tick: 0, name: "Drop" })).not.toBe(song);
    expect(markersOf(updateMarker(song, a.id!, { tick: 0, name: "Drop" }))[0]).toMatchObject({ tick: 0, name: "Drop" });
    expect(updateMarker(song, a.id!, { name: "Marker 1" })).toBe(song);
    expect(markersOf(addMarker(song, 0, { kind: "punchIn" }).song)[0]).toMatchObject({ name: "Start recording", kind: "punchIn" });
    const gone = removeMarker(removeMarker(song, a.id!), markersOf(song)[0].id);
    expect(gone.playlist.markers).toBeUndefined();
    expect(removeMarker(song, 99)).toBe(song);
  });

  it("are kept through a save, checked", () => {
    const song = addMarker(createMusicProject("Saved"), BAR * 2, { name: "Chorus" }).song;
    expect(normalizeMusicProject(JSON.parse(JSON.stringify(song))).playlist.markers).toEqual(song.playlist.markers);
    expect(normalizeMarkers([{ id: 1, tick: -5, kind: "bogus" }, { id: 1, tick: 10, name: " " }, "x"])).toEqual([
      { id: 1, tick: 0, name: "Marker", kind: "marker" },
      { id: 2, tick: 10, name: "Marker", kind: "marker" },
    ]);
  });

  it("say where a recording is punched in and out, and where an export ends", () => {
    let song = createMusicProject("Punch");
    song = addMarker(song, BAR * 2, { kind: "punchIn" }).song;
    song = addMarker(song, BAR * 3, { kind: "punchOut" }).song;
    song = addMarker(song, BAR * 8, { name: "End" }).song;
    expect(punchRange(song, 0)).toEqual({ start: BAR * 2, end: BAR * 3 });
    expect(punchRange(song, BAR * 2 + 1)).toBeNull();
    expect(lastMarkerAfter(song, BAR * 4)).toBe(BAR * 8);
    expect(lastMarkerAfter(song, BAR * 9)).toBeNull();
  });
});
