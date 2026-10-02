import { describe, expect, it } from "vitest";
import { addChannels } from "@shared/music/edits";
import { setEffect, setSend, updateMixerTrack } from "@shared/music/mixer";
import { FIRST_PATTERN_ID, MASTER_TRACK_ID, createMusicProject } from "@shared/music/project";
import type { MusicProject } from "@shared/music/types";
import {
  addMixerTrackTool,
  effectToTrackTool,
  describeMixer,
  findTrack,
  groupMixerTracksTool,
  parseInput,
  moveMixerTrackTool,
  removeMixerEffectTool,
  removeMixerTrackTool,
  routeChannelsTool,
  setSendTool,
  slotForEffect,
  soloMixerTrackTool,
  routeToNewBusTool,
  updateMixerEffectTool,
  updateMixerTrackTool,
} from "./tool-edits";

const env = { patternId: FIRST_PATTERN_ID };
const EQ = { id: "VST3-Pro-Q 4", name: "Pro-Q 4", format: "VST3" };
const rack = (): MusicProject =>
  addChannels(createMusicProject("Mix"), [
    { id: "chan_kick", name: "Kick", sampleId: null },
    { id: "chan_snare", name: "Snare", sampleId: null },
    { id: "chan_lead", name: "Lead", sampleId: null },
  ]);
const track = (song: MusicProject, n: number) => song.mixer.tracks[n];

describe("the assistant's mixer edits", () => {
  it("find a track by number, id, name or master, and say what exists when it isn't one", () => {
    const song = updateMixerTrack(rack(), "insert_3", { name: "Drums" });
    expect(findTrack(song, 3).id).toBe("insert_3");
    expect(findTrack(song, "3").id).toBe("insert_3");
    expect(findTrack(song, "drums").id).toBe("insert_3");
    expect(findTrack(song, "Insert 5").id).toBe("insert_5");
    expect(findTrack(song, "M").id).toBe(MASTER_TRACK_ID);
    expect(findTrack(song, "insert_7").id).toBe("insert_7");
    expect(() => findTrack(song, "Bus")).toThrow(/inserts 1 to 16; the named ones: "Drums" \(3\)/);
  });

  it("route channels to a track, or each to a free one named after it", () => {
    const bus = routeChannelsTool(rack(), { channels: ["Kick", "Snare"], track: 2 }, env);
    expect(bus.song.channels.map((c) => c.mixerTrack)).toEqual(["insert_2", "insert_2", MASTER_TRACK_ID]);
    expect(bus.text).toBe('"Kick", "Snare" play into insert 2 ("Insert 2").');
    const free = routeChannelsTool(rack(), { channels: ["Lead"], track: "free" }, env);
    expect(free.text).toBe('Routed "Lead" to insert 1 ("Lead").');
    expect(() => routeChannelsTool(rack(), { channels: [], track: 1 }, env)).toThrow(/list of channels/);
  });

  it("change a track: level in dB, colour by name, its switches, refusing what can't be", () => {
    const { song, text } = updateMixerTrackTool(rack(), { track: 1, level: -6, pan: -0.5, color: "Blue", invert: true, stereo: 1, name: "Bass" }, env);
    expect(track(song, 1)).toMatchObject({ name: "Bass", color: "#3f5ea8", pan: -0.5, invert: true, stereo: 1 });
    expect(text).toBe('Changed insert 1 ("Bass") (id insert_1): level −6.0 dB, pan 50% left, phase inverted, stereo 100% narrower, colour blue.');
    expect(updateMixerTrackTool(rack(), { track: 1, level: -90 }, env).song.mixer.tracks[1].volume).toBe(0);
    expect(updateMixerTrackTool(rack(), { track: 1, color: "none" }, env).text).toMatch(/already like that/);
    expect(() => updateMixerTrackTool(rack(), { track: 1, color: "mauve" }, env)).toThrow(/one of red, orange/);
    expect(() => updateMixerTrackTool(rack(), { track: 1, level: 12 }, env)).toThrow(/"level" must be a number/);
    expect(updateMixerTrackTool(rack(), { track: 2, dock: "right" }, env).text).toMatch(/docked right/);
    expect(() => updateMixerTrackTool(rack(), { track: "master", dock: "right" }, env)).toThrow(/always docked on the left/);
  });

  it("send tracks to others, only there, or not; never round in a loop, never from the master", () => {
    let song = setSendTool(rack(), { from: 1, to: 4, level: 0.5 }, env).song;
    expect(track(song, 1).sends).toEqual([{ to: MASTER_TRACK_ID, level: 1 }, { to: "insert_4", level: 0.5 }]);
    const only = setSendTool(song, { from: 1, to: 4, only: true }, env);
    expect(track(only.song, 1).sends).toEqual([{ to: "insert_4", level: 0.5 }]);
    expect(only.text).toBe('insert 1 ("Insert 1") sends to insert 4 ("Insert 4") at 50%.');
    song = setSendTool(song, { from: 1, to: "master", remove: true }, env).song;
    expect(track(song, 1).sends.map((s) => s.to)).toEqual(["insert_4"]);
    expect(() => setSendTool(song, { from: 4, to: 1 }, env)).toThrow(/already reaches it, so it would loop/);
    expect(() => setSendTool(song, { from: "master", to: 2 }, env)).toThrow(/The master sends nowhere/);
    expect(() => setSendTool(song, { from: 2, to: 2 }, env)).toThrow(/can't send to itself/);
  });

  it("route tracks to a new bus", () => {
    const routed = routeToNewBusTool(rack(), { tracks: [1, "insert_2"], name: "Drums" }, env);
    expect(routed.text).toBe('insert 1 ("Insert 1"), insert 2 ("Insert 2") now go to the new bus insert 3 ("Drums"), which sends to the master.');
    expect(track(routed.song, 1).sends.map((s) => s.to)).toEqual([track(routed.song, 3).id]);
    expect(() => routeToNewBusTool(rack(), { tracks: ["master"] }, env)).toThrow(/master can't go to a bus/);
  });

  it("solo, add, remove and move tracks", () => {
    const solo = soloMixerTrackTool(rack(), { track: 2 }, env);
    expect(solo.text).toBe('Soloed: insert 2 ("Insert 2"). 15 other tracks are silenced by the solo.');
    expect(solo.song.mixer.tracks.some((t) => t.muted)).toBe(false);
    const both = soloMixerTrackTool(solo.song, { tracks: [3], safe: true }, env);
    expect(both.song.mixer.tracks[3].soloSafe).toBe(true);
    expect(soloMixerTrackTool(both.song, { track: 4, alone: true }, env).song.mixer.tracks.filter((t) => t.solo).map((t) => t.id)).toEqual(["insert_4"]);
    expect(soloMixerTrackTool(both.song, { clear: true }, env).text).toBe('Nothing is soloed: every track that isn\'t muted is heard. Solo safe: insert 3 ("Insert 3").');
    expect(() => soloMixerTrackTool(rack(), { track: "master" }, env)).toThrow(/can't be soloed/);
    const added = addMixerTrackTool(rack(), { after: 2, name: "Verb" }, env);
    expect(track(added.song, 3).name).toBe("Verb");
    expect(added.text).toMatch(/^Added insert 3 \("Verb"\)/);
    const routed = routeChannelsTool(rack(), { channels: ["Kick"], track: 1 }, env).song;
    expect(removeMixerTrackTool(routed, { track: 1 }, env).text).toBe('Removed insert 1 ("Insert 1"). "Kick" now plays into the master.');
    expect(() => removeMixerTrackTool(rack(), { track: 0 }, env)).toThrow(/can't be removed/);
    expect(moveMixerTrackTool(rack(), { track: 1, direction: "right" }, env).text).toBe('It\'s insert 2 ("Insert 2") now.');
    expect(moveMixerTrackTool(rack(), { track: 1, direction: "left" }, env).text).toMatch(/can't go further left/);
  });

  it("group tracks under a name, and ungroup them; never the master", () => {
    const grouped = groupMixerTracksTool(rack(), { tracks: [1, 2], name: "Drums" }, env);
    expect(grouped.text).toBe('Grouped insert 1 ("Insert 1"), insert 2 ("Insert 2") as "Drums".');
    expect(grouped.song.mixer.groups.map((g) => g.name)).toEqual(["Drums"]);
    expect(groupMixerTracksTool(grouped.song, { tracks: [1, 2], ungroup: true }, env).song.mixer.groups).toEqual([]);
    expect(() => groupMixerTracksTool(rack(), { tracks: ["master"] }, env)).toThrow(/master can't be in a group/);
    expect(updateMixerTrackTool(rack(), { track: 3, separator: true }, env).text).toMatch(/a divider before it/);
  });

  it("move an effect to another track, or copy it there", () => {
    const song = setEffect(rack(), "insert_1", 2, EQ, "fx_eq");
    const moved = effectToTrackTool(song, { track: 1, slot: 3, to: "master" }, null);
    expect(moved.text).toBe('Moved Pro-Q 4 from slot 3 of insert 1 ("Insert 1") to slot 1 of the master.');
    expect(track(moved.song, 0).effects[0]?.id).toBe("fx_eq");
    expect(track(moved.song, 1).effects[2]).toBeNull();
    const copied = effectToTrackTool(song, { track: 1, slot: 3, to: 2, toSlot: 4 }, "fx_copy");
    expect(copied.text).toBe('Copied Pro-Q 4 from slot 3 of insert 1 ("Insert 1") to slot 4 of insert 2 ("Insert 2").');
    expect(track(copied.song, 2).effects[3]?.id).toBe("fx_copy");
    expect(track(copied.song, 1).effects[2]?.id).toBe("fx_eq");
    expect(() => effectToTrackTool(song, { track: 1, slot: 3, to: 1 }, null)).toThrow(/the track it's on/);
    expect(() => effectToTrackTool(song, { track: 1, slot: 1, to: 2 }, null)).toThrow(/is empty/);
  });

  it("change, move and remove effects by slot, and find a free slot for one", () => {
    const song = setEffect(rack(), "insert_1", 2, EQ, "fx_eq");
    const changed = updateMixerEffectTool(song, { track: 1, slot: 3, enabled: false, mix: 0.5, move: "up" }, env);
    expect(track(changed.song, 1).effects[1]).toMatchObject({ id: "fx_eq", enabled: false, mix: 0.5 });
    expect(changed.text).toBe('Pro-Q 4 in slot 2 of insert 1 ("Insert 1"): bypassed, mix 50%.');
    expect(() => updateMixerEffectTool(song, { track: 1, slot: 1 }, env)).toThrow(/Slot 1 of insert 1 \("Insert 1"\) is empty. Its effects are in slots 3 \(Pro-Q 4\)/);
    expect(() => updateMixerEffectTool(song, { track: 1, slot: 11 }, env)).toThrow(/from 1 to 10/);
    expect(track(removeMixerEffectTool(song, { track: 1, slot: 3 }, env).song, 1).effects.every((e) => e === null)).toBe(true);
    expect(slotForEffect(song, track(song, 1), {})).toBe(0);
    expect(slotForEffect(song, track(song, 1), { slot: 5 })).toBe(4);
    let full = song;
    for (let s = 0; s < 10; s++) full = setEffect(full, "insert_1", s, EQ, `fx_${s}`);
    expect(() => slotForEffect(full, track(full, 1), {})).toThrow(/10 slots are full/);
  });
});

describe("get_mixer", () => {
  it("says each track's controls, channels, effects (as the engine has them) and sends, and sums up the unused", () => {
    let song = routeChannelsTool(rack(), { channels: ["Kick", "Snare"], track: 1 }, env).song;
    song = updateMixerTrack(song, "insert_1", { name: "Drums", volume: 0.4 });
    song = setEffect(song, "insert_1", 0, EQ, "fx_eq");
    song = setEffect(song, "insert_1", 1, { id: "AU-Gone", name: "Gone", format: "AudioUnit" }, "fx_gone");
    song = setSend(song, "insert_1", "insert_5", 0);
    const effects = { loaded: [{ effect: "fx_eq", name: "Pro-Q 4", editorOpen: false, latency: 882 }], loading: [], failed: [{ effect: "fx_gone", error: "It isn't installed." }] };
    const text = describeMixer(song, effects);
    expect(text).toContain('- the master (id master): level 0.0 dB');
    expect(text).toContain('- insert 1 ("Drums") (id insert_1): level −18.1 dB\n    channels: "Kick", "Snare"');
    expect(text).toContain("    slot 1: Pro-Q 4 (VST3), delays its sound 882 samples");
    expect(text).toContain("    slot 2: Gone (AudioUnit), couldn't be loaded: It isn't installed.");
    expect(text).toContain('    sends to: the master, insert 5 ("Insert 5") at 0% (sidechain only)');
    expect(text).toContain("- Inserts 2–4, 6–16: unused");
    // Insert 5 is used (sent to), so it's listed.
    expect(text).toContain('- insert 5 ("Insert 5")');
  });
});

describe("the assistant's inputs", () => {
  it("are read as FL numbers them: one input, or a pair next to each other", () => {
    expect(parseInput("1")).toEqual({ channel: 0, stereo: false });
    expect(parseInput(3)).toEqual({ channel: 2, stereo: false });
    expect(parseInput("3-4")).toEqual({ channel: 2, stereo: true });
    expect(parseInput("none")).toBeNull();
    for (const bad of ["0", "2-4", "1-", "left", "65"]) expect(() => parseInput(bad), bad).toThrow(/list_audio_inputs/);
  });

  it("give an insert its input, monitoring and offset, never the master, and say so in get_mixer", () => {
    const { song, text } = updateMixerTrackTool(rack(), { track: 2, input: "1-2", monitor: "on", inputOffset: 12 }, env);
    expect(track(song, 2)).toMatchObject({ input: { channel: 0, stereo: true }, monitor: "on", inputOffset: 12 });
    expect(text).toMatch(/records input 1-2 \(stereo, always heard\), input offset 12 ms/);
    expect(() => updateMixerTrackTool(rack(), { track: "master", input: "1" }, env)).toThrow(/master/);
    expect(() => updateMixerTrackTool(rack(), { track: 1, monitor: "sometimes" }, env)).toThrow(/off, armed, on/);
    expect(describeMixer(song, null, [track(song, 2).id])).toMatch(/insert 2 .*\(id insert_2\): .*records input 1-2.*ARMED to record/);
  });
});

