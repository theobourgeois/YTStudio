import { describe, expect, it } from "vitest";
import { addChannels } from "./edits.ts";
import {
  addMixerTracks,
  canSend,
  channelsOn,
  isFreeTrack,
  createGroup,
  effectToTrack,
  freeSlot,
  moveEffect,
  moveEffectTo,
  moveMixerTracks,
  moveMixerTracksTo,
  pasteTrackState,
  renameGroup,
  removeMixerTracks,
  routeChannels,
  routeChannelsFrom,
  routeToFreeTracks,
  routeToNewBus,
  sendOnly,
  sendersTo,
  setEffect,
  clearMixerSolo,
  setMixerMuted,
  setMixerSolo,
  setMixerVolumes,
  setSend,
  setSendPreFader,
  setSoloSafe,
  soloMixerTrack,
  toggleMixerSolo,
  trackName,
  trackNumber,
  trackState,
  ungroup,
  updateEffect,
  updateMixerTrack,
  updateMixerTracks,
} from "./mixer.ts";
import { updateTrack } from "./playlist.ts";
import { compileSong } from "./compile.ts";
import { MASTER_TRACK_ID, MAX_INSERTS, createMusicProject, normalizeMusicProject } from "./project.ts";
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
    expect(updateMixerTracks(song, ["insert_1", "master"], { dock: "right" }).mixer.tracks.slice(0, 2).map((t) => t.dock)).toEqual(["left", "right"]);
    const both = setMixerVolumes(song, new Map([["insert_1", 0.5], ["insert_2", 0.3]]));
    expect(both.mixer.tracks.slice(1, 4).map((t) => t.volume)).toEqual([0.5, 0.3, 0.8]);
    expect(setMixerVolumes(song, new Map([["insert_1", NaN]]))).toBe(song);
    expect(mutes(setMixerMuted(song, ["insert_2"], true))).toEqual([false, false, true, false, false, false]);
    const named = updateMixerTracks(song, ["insert_1", "insert_3"], { name: "Drums", color: "#e8833a" });
    expect([1, 2, 3].map((n) => [named.mixer.tracks[n].name, named.mixer.tracks[n].color])).toEqual([["Drums", "#e8833a"], [null, null], ["Drums", "#e8833a"]]);
    expect(updateMixerTracks(named, ["insert_1"], { name: "Drums" })).toBe(named);
  });
});

describe("inputs", () => {
  it("are chosen, monitored and offset per insert; the master takes none; the same input again changes nothing", () => {
    const song = createMusicProject();
    const vox = updateMixerTrack(song, "insert_1", { input: { channel: 0, stereo: false }, monitor: "on", inputOffset: 4.567 });
    expect(vox.mixer.tracks[1]).toMatchObject({ input: { channel: 0, stereo: false }, monitor: "on", inputOffset: 4.57 });
    expect(updateMixerTrack(vox, "insert_1", { input: { channel: 0, stereo: false } })).toBe(vox);
    expect(updateMixerTrack(vox, "insert_1", { input: null }).mixer.tracks[1].input).toBeNull();
    expect(updateMixerTrack(vox, "insert_1", { input: { channel: 63, stereo: true } }).mixer.tracks[1].input).toBeNull();
    expect(updateMixerTrack(song, M, { input: { channel: 0, stereo: false } })).toBe(song);
    expect(updateMixerTrack(vox, "insert_1", { monitor: "never" as never })).toBe(vox);
  });

  it("go with their track: a playlist track linked to a removed insert is an ordinary one again", () => {
    const linked = updateTrack(createMusicProject(), 2, { mixerTrack: "insert_4", name: "Vox" });
    expect(linked.playlist.tracks[2]).toMatchObject({ name: "Vox", mixerTrack: "insert_4" });
    expect(updateTrack(linked, 3, { mixerTrack: M }).playlist.tracks[3]).toBeUndefined();
    expect(updateTrack(linked, 3, { mixerTrack: "insert_gone" })).toBe(linked);
    const removed = removeMixerTracks(linked, ["insert_4"]);
    expect(removed.playlist.tracks[2]).toMatchObject({ name: "Vox", mixerTrack: null });
    expect(removeMixerTracks(updateTrack(createMusicProject(), 2, { mixerTrack: "insert_4" }), ["insert_4"]).playlist.tracks).toEqual([]);
  });
});

describe("solo", () => {
  const solos = (song: MusicProject) => song.mixer.tracks.slice(0, 6).map((t) => t.solo);

  it("is a state of its own: the mutes stay as they were, and clearing it brings back exactly what was heard", () => {
    const muted = setMixerMuted(rack(), ["insert_3"], true);
    const solo = soloMixerTrack(muted, "insert_2");
    expect(mutes(solo)).toEqual(mutes(muted));
    expect(solos(solo)).toEqual([false, false, true, false, false, false]);
    expect(clearMixerSolo(solo).mixer).toEqual(muted.mixer);
  });

  it("adds up with S, and Alt solos alone (again: no solo)", () => {
    const one = toggleMixerSolo(rack(), ["insert_1"]);
    const two = toggleMixerSolo(one, ["insert_2"]);
    expect(solos(two)).toEqual([false, true, true, false, false, false]);
    expect(solos(toggleMixerSolo(two, ["insert_2"]))).toEqual([false, true, false, false, false, false]);
    // Several at once: soloed unless they all are already.
    expect(solos(toggleMixerSolo(one, ["insert_1", "insert_3"]))).toEqual([false, true, false, true, false, false]);
    expect(solos(toggleMixerSolo(two, ["insert_1", "insert_2"]))).toEqual([false, false, false, false, false, false]);
    expect(solos(soloMixerTrack(two, "insert_3"))).toEqual([false, false, false, true, false, false]);
    expect(solos(soloMixerTrack(soloMixerTrack(two, "insert_3"), "insert_3"))).toEqual([false, false, false, false, false, false]);
  });

  it("never solos the master", () => {
    const song = rack();
    expect(soloMixerTrack(song, M)).toBe(song);
    expect(setMixerSolo(song, [M], true)).toBe(song);
    expect(updateMixerTrack(song, M, { solo: true })).toBe(song);
  });

  it("makes tracks solo safe", () => {
    const safe = setSoloSafe(rack(), ["insert_4"], true);
    expect(safe.mixer.tracks[4].soloSafe).toBe(true);
    expect(setSoloSafe(safe, ["insert_4"], true)).toBe(safe);
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
    // Dragged onto another slot, it swaps with what's there.
    const dragged = moveEffectTo(setEffect(song, "insert_1", 5, PRO_Q, "fx_eq2"), "insert_1", 5, 2);
    expect(slots(dragged)).toEqual([null, null, "fx_eq2"]);
    expect(dragged.mixer.tracks[1].effects[5]?.id).toBe("fx_echo");
    expect(moveEffectTo(song, "insert_1", 0, 4)).toBe(song);
  });

  it("move to another track (its first empty slot, or the one dropped on), or copy there with a new id", () => {
    let song = setEffect(rack(), "insert_1", 3, PRO_Q, "fx_eq");
    song = updateEffect(song, "insert_1", 3, { mix: 0.5 });
    song = setEffect(song, "insert_2", 0, ECHO, "fx_echo");
    const ids = (s: MusicProject, t: number) => s.mixer.tracks[t].effects.slice(0, 4).map((e) => e?.id ?? null);
    // Moved: the same effect (its id, so its plugin and settings), out of where it was.
    const moved = effectToTrack(song, "insert_1", 3, "insert_2");
    expect(ids(moved, 1)).toEqual([null, null, null, null]);
    expect(ids(moved, 2)).toEqual(["fx_echo", "fx_eq", null, null]);
    expect(moved.mixer.tracks[2].effects[1]).toEqual(song.mixer.tracks[1].effects[3]);
    // Onto an empty slot of it, there; onto a taken one, the first empty.
    expect(ids(effectToTrack(song, "insert_1", 3, "insert_2", { to: 3 }), 2)).toEqual(["fx_echo", null, null, "fx_eq"]);
    expect(ids(effectToTrack(song, "insert_1", 3, "insert_2", { to: 0 }), 2)).toEqual(["fx_echo", "fx_eq", null, null]);
    // Copied: it stays, and the copy has the id it's given (its settings file copied beside it).
    const copied = effectToTrack(song, "insert_1", 3, "insert_2", { copy: "fx_eq_2" });
    expect(ids(copied, 1)).toEqual([null, null, null, "fx_eq"]);
    expect(copied.mixer.tracks[2].effects[1]).toEqual({ ...song.mixer.tracks[1].effects[3], id: "fx_eq_2" });
    // A copy onto its own track goes in a free slot.
    expect(ids(effectToTrack(song, "insert_1", 3, "insert_1", { copy: "fx_eq_3" }), 1)).toEqual(["fx_eq_3", null, null, "fx_eq"]);
    // Nothing to move, nowhere to go, or no room: the same song.
    expect(effectToTrack(song, "insert_1", 0, "insert_2")).toBe(song);
    expect(effectToTrack(song, "insert_1", 3, "insert_1")).toBe(song);
    expect(effectToTrack(song, "insert_1", 3, "insert_404")).toBe(song);
    const full = Array.from({ length: 10 }, (_, slot) => slot).reduce((s, slot) => setEffect(s, "insert_3", slot, ECHO, `fx_${slot}`), song);
    expect(freeSlot(full, "insert_3")).toBeNull();
    expect(effectToTrack(full, "insert_1", 3, "insert_3")).toBe(full);
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

describe("separators and groups", () => {
  it("put a divider before a track, and name groups of tracks; an emptied group goes", () => {
    expect(updateMixerTrack(rack(), "insert_3", { separator: true }).mixer.tracks[3].separator).toBe(true);
    let song = createGroup(rack(), ["insert_1", "insert_2", M], "Drums", "group_drums");
    expect(song.mixer.groups).toEqual([{ id: "group_drums", name: "Drums" }]);
    expect(song.mixer.tracks.slice(0, 3).map((t) => t.group)).toEqual([null, "group_drums", "group_drums"]);
    expect(createGroup(song, ["insert_5"]).mixer.groups.map((g) => g.name)).toEqual(["Drums", "Group 2"]);
    // A track moved into another group leaves its old one (which goes once it's empty).
    const moved = createGroup(createGroup(rack(), ["insert_1"], "A", "g_a"), ["insert_1"], "B", "g_b");
    expect(moved.mixer.groups).toEqual([{ id: "g_b", name: "B" }]);
    song = renameGroup(song, "group_drums", " Kit ");
    expect(song.mixer.groups[0].name).toBe("Kit");
    expect(renameGroup(song, "group_drums", "Kit")).toBe(song);
    song = ungroup(song, ["insert_1"]);
    expect(song.mixer.groups).toHaveLength(1);
    expect(ungroup(song, ["insert_2"]).mixer.groups).toEqual([]);
    expect(removeMixerTracks(song, ["insert_2"]).mixer.groups).toEqual([]);
    expect(createGroup(rack(), [M])).toEqual(rack());
  });
});

describe("a new bus for tracks", () => {
  it("goes right after them, and takes their sound instead of where it went (sidechains kept)", () => {
    let song = setSend(rack(), "insert_2", "insert_6", 0);
    song = routeToNewBus(song, ["insert_2", "insert_1", M], "bus");
    expect(ids(song).slice(0, 5)).toEqual([M, "insert_1", "insert_2", "bus", "insert_3"]);
    expect(trackName(song, "bus")).toBe("Bus");
    expect(sends(song, "insert_1")).toEqual([{ to: "bus", level: 1 }]);
    expect(sends(song, "insert_2")).toEqual([{ to: "insert_6", level: 0 }, { to: "bus", level: 1 }]);
    expect(sends(song, "bus")).toEqual([{ to: M, level: 1 }]);
    expect(trackName(routeToNewBus(song, ["insert_5"], "bus_2"), "bus_2")).toBe("Bus 2");
  });

  it("goes where they all went, when that was one same track", () => {
    let song = sendOnly(rack(), "insert_1", "insert_8");
    song = sendOnly(song, "insert_2", "insert_8");
    expect(sends(routeToNewBus(song, ["insert_1", "insert_2"], "bus"), "bus")).toEqual([{ to: "insert_8", level: 1 }]);
    const apart = sendOnly(song, "insert_2", "insert_9");
    expect(sends(routeToNewBus(apart, ["insert_1", "insert_2"], "bus"), "bus")).toEqual([{ to: M, level: 1 }]);
  });

  it("needs a track to route, and room for the bus", () => {
    const song = rack();
    expect(routeToNewBus(song, [M])).toBe(song);
    const full = addMixerTracks(song, null, MAX_INSERTS);
    expect(routeToNewBus(full, ["insert_1"])).toBe(full);
  });
});

describe("tracks dragged to another place", () => {
  it("go before the track they're dropped on, together and in their order, never before the master", () => {
    const song = rack();
    expect(ids(moveMixerTracksTo(song, ["insert_5", "insert_2"], "insert_1")).slice(0, 6)).toEqual([M, "insert_2", "insert_5", "insert_1", "insert_3", "insert_4"]);
    expect(ids(moveMixerTracksTo(song, ["insert_2"], M)).slice(0, 3)).toEqual([M, "insert_2", "insert_1"]);
    expect(ids(moveMixerTracksTo(song, ["insert_1"], null)).slice(-2)).toEqual(["insert_16", "insert_1"]);
    // Dropped on one of themselves: before the next one that isn't moving.
    expect(ids(moveMixerTracksTo(song, ["insert_1", "insert_2"], "insert_2")).slice(0, 4)).toEqual([M, "insert_1", "insert_2", "insert_3"]);
    expect(moveMixerTracksTo(song, ["insert_1", "insert_2"], "insert_3")).toBe(song);
    expect(moveMixerTracksTo(song, [M], "insert_3")).toBe(song);
  });

  it("take the dock they're dropped in", () => {
    const moved = moveMixerTracksTo(rack(), ["insert_3"], "insert_9", "right");
    expect(moved.mixer.tracks.find((t) => t.id === "insert_3")!.dock).toBe("right");
  });
});

describe("pre-fader sends", () => {
  it("are switched on a send, and kept as its level changes or it becomes the only one", () => {
    const song = setSend(rack(), "insert_1", "insert_4", 0.5);
    const pre = setSendPreFader(song, "insert_1", "insert_4", true);
    expect(sends(pre, "insert_1")).toEqual([{ to: M, level: 1 }, { to: "insert_4", level: 0.5, preFader: true }]);
    expect(setSendPreFader(pre, "insert_1", "insert_4", true)).toBe(pre);
    expect(sends(setSend(pre, "insert_1", "insert_4", 0.8), "insert_1")[1]).toEqual({ to: "insert_4", level: 0.8, preFader: true });
    expect(sends(sendOnly(pre, "insert_1", "insert_4"), "insert_1")).toEqual([{ to: "insert_4", level: 0.5, preFader: true }]);
    expect(sends(setSendPreFader(pre, "insert_1", "insert_4", false), "insert_1")[1]).toEqual({ to: "insert_4", level: 0.5 });
    expect(setSendPreFader(song, "insert_1", "insert_9", true)).toBe(song);
  });

  it("survive a save and load", () => {
    const pre = setSendPreFader(setSend(rack(), "insert_1", "insert_4", 0.5), "insert_1", "insert_4", true);
    expect(normalizeMusicProject(JSON.parse(JSON.stringify(pre))).mixer).toEqual(pre.mixer);
  });

  it("are compiled to be taken before the fader, and silent while the track is muted", () => {
    const pre = setSendPreFader(setSend(rack(), "insert_1", "insert_4", 1), "insert_1", "insert_4", true);
    const sendOf = (song: MusicProject) => compileSong(song, null).tracks.find((t) => t.id === "insert_1")!.sends.find((s) => s.preFader);
    expect(sendOf(pre)).toMatchObject({ gain: 1, preFader: true });
    expect(sendOf(setMixerMuted(pre, ["insert_1"], true))).toMatchObject({ gain: 0, preFader: true });
    expect(sendOf(setMixerSolo(pre, ["insert_2"], true))).toMatchObject({ gain: 0 });
  });
});
