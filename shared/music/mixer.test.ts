import { describe, expect, it } from "vitest";
import { addChannels } from "./edits.ts";
import {
  addMixerTracks,
  canSend,
  channelsOn,
  isFreeTrack,
  moveEffect,
  moveMixerTracks,
  pasteTrackState,
  removeMixerTracks,
  routeChannels,
  routeChannelsFrom,
  routeToFreeTracks,
  sendOnly,
  sendersTo,
  setEffect,
  setMixerMuted,
  setMixerVolumes,
  setSend,
  soloMixerTrack,
  trackName,
  trackNumber,
  trackState,
  updateEffect,
  updateMixerTrack,
} from "./mixer.ts";
import { MASTER_TRACK_ID, MAX_INSERTS, createMusicProject } from "./project.ts";
import type { MusicProject } from "./types.ts";

const M = MASTER_TRACK_ID;
const PRO_Q = { id: "VST3-Pro-Q 4", name: "Pro-Q 4", format: "VST3" };
const ECHO = { id: "AU-EchoBoy", name: "EchoBoy", format: "AudioUnit" };

const rack = (): MusicProject =>
  addChannels(createMusicProject("Beat"), [
    { id: "chan_kick", name: "Kick", sampleId: null },
    { id: "chan_hat", name: "Hat", sampleId: null },
    { id: "chan_clap", name: "Clap", sampleId: null },
  ]);
const ids = (song: MusicProject) => song.mixer.tracks.map((t) => t.id);
const sends = (song: MusicProject, id: string) => song.mixer.tracks.find((t) => t.id === id)!.sends;
const routing = (song: MusicProject) => song.channels.map((c) => c.mixerTrack);
const mutes = (song: MusicProject) => song.mixer.tracks.slice(0, 6).map((t) => t.muted);

describe("mixer tracks", () => {
  it("are called by their number until they're named, and an empty name goes back to it", () => {
    let song = rack();
    expect([trackName(song, M), trackName(song, "insert_3"), trackNumber(song, "insert_3")]).toEqual(["Master", "Insert 3", 3]);
    song = updateMixerTrack(song, "insert_3", { name: "  Drums " });
    expect(trackName(song, "insert_3")).toBe("Drums");
    expect(trackName(updateMixerTrack(song, "insert_3", { name: "" }), "insert_3")).toBe("Insert 3");
  });

  it("are added after a track (FL's +), up to the limit, and keep their number in the order", () => {
    const song = addMixerTracks(rack(), "insert_2", 2, ["insert_x", "insert_y"]);
    expect(ids(song).slice(0, 5)).toEqual([M, "insert_1", "insert_2", "insert_x", "insert_y"]);
    expect(trackName(song, "insert_3")).toBe("Insert 5");
    expect(ids(addMixerTracks(rack(), null, 1, ["insert_end"])).at(-1)).toBe("insert_end");
    const full = addMixerTracks(rack(), null, 10_000);
    expect(full.mixer.tracks).toHaveLength(MAX_INSERTS + 1);
    expect(addMixerTracks(full, null)).toBe(full);
  });

  it("are removed, never the master: their channels go to the master, and a track left sending nowhere does too", () => {
    let song = routeChannels(rack(), ["chan_kick"], "insert_1");
    song = sendOnly(song, "insert_2", "insert_1");
    song = setSend(song, "insert_3", "insert_1", 0.5);
    song = removeMixerTracks(song, ["insert_1", M]);
    expect(ids(song)).not.toContain("insert_1");
    expect(ids(song)[0]).toBe(M);
    expect(routing(song)[0]).toBe(M);
    expect(sends(song, "insert_2")).toEqual([{ to: M, level: 1 }]);
    expect(sends(song, "insert_3")).toEqual([{ to: M, level: 1 }]);
    expect(removeMixerTracks(song, [M, "nope"])).toBe(song);
  });

  it("move left and right together, their routing with them, never before the master", () => {
    let song = routeChannels(rack(), ["chan_kick"], "insert_2");
    song = moveMixerTracks(song, ["insert_2", "insert_3"], -1);
    expect(ids(song).slice(0, 4)).toEqual([M, "insert_2", "insert_3", "insert_1"]);
    expect(trackName(song, routing(song)[0])).toBe("Insert 1");
    expect(moveMixerTracks(song, ["insert_2"], -1)).toBe(song);
    expect(moveMixerTracks(song, [M], 1)).toBe(song);
  });

  it("set faders, pans and mutes within their range, several at once, and leave the song alone when nothing changes", () => {
    const song = rack();
    expect(updateMixerTrack(song, "insert_1", { volume: 3, pan: -2 }).mixer.tracks[1]).toMatchObject({ volume: 1, pan: -1 });
    expect(updateMixerTrack(song, "insert_1", { volume: 0.8 })).toBe(song);
    expect(updateMixerTrack(song, "insert_1", { latencyOffset: -2000 }).mixer.tracks[1].latencyOffset).toBe(-1000);
    expect(updateMixerTrack(song, "insert_1", { latencyOffset: 0 })).toBe(song);
    expect(updateMixerTrack(song, "insert_1", { invert: true, swap: true, stereo: -3 }).mixer.tracks[1]).toMatchObject({ invert: true, swap: true, stereo: -1 });
    expect(updateMixerTrack(song, "insert_1", { invert: false, stereo: 0 })).toBe(song);
    expect(updateMixerTrack(song, "insert_1", { color: "#4A89DC" }).mixer.tracks[1].color).toBe("#4a89dc");
    expect(updateMixerTrack(song, "insert_1", { color: "blue" }).mixer.tracks[1].color).toBeNull();
    const both = setMixerVolumes(song, new Map([["insert_1", 0.5], ["insert_2", 0.3]]));
    expect(both.mixer.tracks.slice(1, 4).map((t) => t.volume)).toEqual([0.5, 0.3, 0.8]);
    expect(setMixerVolumes(song, new Map([["insert_1", NaN]]))).toBe(song);
    expect(mutes(setMixerMuted(song, ["insert_2"], true))).toEqual([false, false, true, false, false, false]);
  });
});

describe("solo", () => {
  it("mutes every other insert (never the master), and soloing the lone track again unmutes them", () => {
    const song = rack();
    const solo = soloMixerTrack(song, "insert_2");
    expect(mutes(solo)).toEqual([false, true, false, true, true, true]);
    expect(mutes(soloMixerTrack(solo, "insert_2"))).toEqual([false, false, false, false, false, false]);
    expect(mutes(soloMixerTrack(solo, "insert_3"))).toEqual([false, true, true, false, true, true]);
  });

  it("with Alt keeps the tracks routed to and from it on", () => {
    let song = sendOnly(rack(), "insert_1", "insert_2");
    song = sendOnly(song, "insert_2", "insert_3");
    expect(mutes(soloMixerTrack(song, "insert_2", true))).toEqual([false, false, false, false, true, true]);
    expect(mutes(soloMixerTrack(song, "insert_2"))).toEqual([false, true, false, true, true, true]);
  });
});

describe("routing", () => {
  it("routes channels to a track (Ctrl+L)", () => {
    const song = routeChannels(rack(), ["chan_kick", "chan_clap"], "insert_4");
    expect(routing(song)).toEqual(["insert_4", M, "insert_4"]);
    expect(channelsOn(song, "insert_4").map((c) => c.name)).toEqual(["Kick", "Clap"]);
    expect(routeChannels(song, ["chan_kick"], "insert_4")).toBe(song);
    expect(routeChannels(song, ["chan_kick"], "insert_404")).toBe(song);
  });

  it("routes channels to a track and the next ones, one each, named after them unless named already, adding tracks past the end (Ctrl+Shift+L)", () => {
    const named = updateMixerTrack(rack(), "insert_8", { name: "Bus" });
    const routed = routeChannelsFrom(named, ["chan_kick", "chan_hat", "chan_clap"], "insert_7");
    expect(routing(routed)).toEqual(["insert_7", "insert_8", "insert_9"]);
    expect(["insert_7", "insert_8", "insert_9"].map((id) => trackName(routed, id))).toEqual(["Kick", "Bus", "Clap"]);
    // To one track (Ctrl+L), nothing is renamed.
    expect(trackName(routeChannels(rack(), ["chan_kick"], "insert_4"), "insert_4")).toBe("Insert 4");
    const song = routeChannelsFrom(rack(), ["chan_kick", "chan_hat", "chan_clap"], "insert_15", ["insert_17"]);
    expect(routing(song)).toEqual(["insert_15", "insert_16", "insert_17"]);
  });

  it("gives channels free tracks named after them (the TRACK label), adding one when none is free", () => {
    let song = updateMixerTrack(rack(), "insert_1", { name: "Used" });
    song = routeToFreeTracks(song, ["chan_kick", "chan_hat"]);
    expect(routing(song).slice(0, 2)).toEqual(["insert_2", "insert_3"]);
    expect([trackName(song, "insert_2"), trackName(song, "insert_3")]).toEqual(["Kick", "Hat"]);
    expect(isFreeTrack(song, song.mixer.tracks[2])).toBe(false);
    expect(isFreeTrack(song, song.mixer.tracks[4])).toBe(true);
    let full = rack();
    for (const track of full.mixer.tracks.slice(1)) full = updateMixerTrack(full, track.id, { name: "Taken" });
    full = routeToFreeTracks(full, ["chan_clap"], ["insert_new"]);
    expect(routing(full)[2]).toBe("insert_new");
    expect(trackName(full, "insert_new")).toBe("Clap");
  });
});

describe("sends", () => {
  it("are made, changed and removed, the master's too", () => {
    let song = setSend(rack(), "insert_1", "insert_5", 0.4);
    expect(sends(song, "insert_1")).toEqual([
      { to: M, level: 1 },
      { to: "insert_5", level: 0.4 },
    ]);
    expect(sendersTo(song, "insert_5").map((t) => t.id)).toEqual(["insert_1"]);
    song = setSend(song, "insert_1", "insert_5", 2);
    expect(sends(song, "insert_1")[1].level).toBe(1);
    expect(setSend(song, "insert_1", "insert_5", 1)).toBe(song);
    song = setSend(song, "insert_1", M, null);
    expect(sends(song, "insert_1")).toEqual([{ to: "insert_5", level: 1 }]);
    expect(setSend(song, "insert_1", M, null)).toBe(song);
  });

  it("never close a loop, never go from the master, and never to the track itself", () => {
    let song = setSend(rack(), "insert_1", "insert_2", 1);
    song = setSend(song, "insert_2", "insert_3", 1);
    expect(canSend(song, "insert_3", "insert_1")).toBe(false);
    expect(setSend(song, "insert_3", "insert_1", 1)).toBe(song);
    expect(sendOnly(song, "insert_3", "insert_1")).toBe(song);
    expect(setSend(song, M, "insert_1", 1)).toBe(song);
    expect(setSend(song, "insert_1", "insert_1", 1)).toBe(song);
    expect(canSend(song, "insert_1", "insert_3")).toBe(true);
  });

  it("go to one track only (\"Route to this track only\")", () => {
    const song = sendOnly(setSend(rack(), "insert_1", "insert_2", 0.3), "insert_1", "insert_2");
    expect(sends(song, "insert_1")).toEqual([{ to: "insert_2", level: 0.3 }]);
    expect(sendOnly(song, "insert_1", "insert_2")).toBe(song);
  });
});

describe("effect slots", () => {
  it("hold a plugin each, replaced or emptied, bypassed, mixed and moved", () => {
    let song = setEffect(rack(), "insert_1", 0, PRO_Q, "fx_eq");
    song = setEffect(song, "insert_1", 1, ECHO, "fx_echo");
    const slots = (s: MusicProject) => s.mixer.tracks[1].effects.slice(0, 3).map((e) => e?.id ?? null);
    expect(slots(song)).toEqual(["fx_eq", "fx_echo", null]);
    expect(song.mixer.tracks[1].effects[0]).toEqual({ id: "fx_eq", plugin: PRO_Q, enabled: true, mix: 1 });
    song = updateEffect(song, "insert_1", 1, { enabled: false, mix: 1.5 });
    expect(song.mixer.tracks[1].effects[1]).toMatchObject({ enabled: false, mix: 1 });
    expect(updateEffect(song, "insert_1", 1, { enabled: false })).toBe(song);
    expect(updateEffect(song, "insert_1", 5, { enabled: false })).toBe(song);
    song = moveEffect(song, "insert_1", 1, 1);
    expect(slots(song)).toEqual(["fx_eq", null, "fx_echo"]);
    expect(moveEffect(song, "insert_1", 0, -1)).toBe(song);
    expect(moveEffect(song, "insert_1", 1, 1)).toBe(song);
    song = setEffect(song, "insert_1", 0, null);
    expect(slots(song)).toEqual([null, null, "fx_echo"]);
    expect(setEffect(song, "insert_1", 0, null)).toBe(song);
    expect(setEffect(song, "insert_1", 10, PRO_Q)).toBe(song);
  });
});

describe("a track's state", () => {
  it("is copied (effects and controls, not name, colour or routing) and pasted with new effect ids", () => {
    let song = setEffect(rack(), "insert_1", 2, PRO_Q, "fx_eq");
    song = updateMixerTrack(song, "insert_1", { name: "Lead", color: "#4a89dc", volume: 0.5, pan: -0.25, stereo: 0.5, invert: true });
    song = setSend(song, "insert_1", "insert_3", 0.5);
    const state = trackState(song, "insert_1")!;
    const pasted = pasteTrackState(song, "insert_2", state, new Map([["fx_eq", "fx_eq_copy"]]));
    const [, one, two] = pasted.mixer.tracks;
    expect(two).toMatchObject({ name: null, color: null, volume: 0.5, pan: -0.25, stereo: 0.5, invert: true, sends: [{ to: M, level: 1 }] });
    expect(two.effects[2]).toEqual({ ...one.effects[2], id: "fx_eq_copy" });
    expect(two.effects.filter(Boolean)).toHaveLength(1);
    // Without ids given, its effects get new ones (never the original's: their settings files are their own).
    expect(pasteTrackState(song, "insert_2", state).mixer.tracks[2].effects[2]!.id).not.toBe("fx_eq");
    expect(trackState(song, "insert_404")).toBeNull();
    expect(pasteTrackState(song, "insert_404", state)).toBe(song);
  });
});
