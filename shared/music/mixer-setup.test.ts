import { describe, expect, it } from "vitest";
import { addChannels } from "./edits.ts";
import { fillMixerInserts, explicitMixRole, ROLE_COLORS, setupTrackFree, type ChannelEvidence } from "./mixer-setup.ts";
import { addMixerTracks, routeChannels, setSend, updateMixerTrack } from "./mixer.ts";
import { createMusicProject, MASTER_TRACK_ID, normalizeMusicProject } from "./project.ts";
import { compileSong } from "./compile.ts";
const MIX_ROLES_FOR_TEST = ["instr", "bass", "drums"] as const;

const rack = () => addChannels(createMusicProject("Setup"), [{ id: "chan_synth", name: "Lead", sampleId: null }, { id: "chan_808", name: "808", sampleId: null }, { id: "chan_kick", name: "Kick", sampleId: null }]);
const assignments = () => new Map([ ["chan_synth", "instr"], ["chan_808", "bass"], ["chan_kick", "drums"] ] as const);

describe("Fill inserts routing", () => {
  it("fills disconnected template inserts instead of adding a second rack, and removes the leftovers", () => {
    let song = addMixerTracks(createMusicProject("Disconnected template"), null, 9, Array.from({ length: 9 }, (_, i) => `insert_${17 + i}`));
    song = { ...song, mixer: { ...song.mixer, tracks: song.mixer.tracks.map((t, i) => i > 0 && i < 16 ? { ...t, sends: [] } : t) } };
    song = updateMixerTrack(song, "insert_16", { name: "rec", dock: "left" });
    for (let i = 17; i <= 20; i++) song = updateMixerTrack(song, `insert_${i}`, { color: "#4e9d61" });
    const channels = Array.from({ length: 14 }, (_, i) => ({ id: `chan_sound_${i}`, name: `Sound ${i}`, sampleId: null }));
    song = addChannels(song, channels);
    const roles = new Map(channels.map((c) => [c.id, "drums" as const]));
    const next = fillMixerInserts(song, roles);
    expect(next.channels.map((c) => c.mixerTrack)).toEqual(Array.from({ length: 14 }, (_, i) => `insert_${i + 1}`));
    expect(next.mixer.tracks).toHaveLength(25);
    expect(next.mixer.tracks.some((t) => t.id === "insert_15")).toBe(false);
    expect(next.mixer.tracks.filter((t) => setupTrackFree(next, t))).toEqual([]);
    expect(fillMixerInserts(next, roles)).toBe(next);
  });
  it("creates the screenshot layout, one insert per channel, and one output path to Master", () => {
    const song = fillMixerInserts(rack(), assignments());
    expect(song.mixer.tracks.slice(-5).map((t) => [t.name, t.dock])).toEqual([ ["instr", "right"], ["bass", "right"], ["drums", "right"], ["vocals", "right"], ["mixbus", "right"] ]);
    for (const channel of song.channels) {
      const role = assignments().get(channel.id as "chan_synth")!;
      const source = song.mixer.tracks.find((t) => t.id === channel.mixerTrack)!;
      const bus = song.mixer.tracks.find((t) => t.setupRole === role && !t.setupChannel)!;
      expect(source.color).toBe(ROLE_COLORS[role]);
      expect(source.sends).toEqual([{ to: bus.id, level: 1 }]);
      expect(bus.sends).toEqual([{ to: song.mixer.tracks.at(-1)!.id, level: 1 }]);
    }
    expect(song.mixer.tracks.at(-1)!.sends).toEqual([{ to: MASTER_TRACK_ID, level: 1 }]);
    expect(song.mixer.tracks).toHaveLength(10);
    expect(song.mixer.tracks[4].id).toBe("insert_16");
    expect(song.mixer.tracks.filter((t) => t.id !== "insert_16" && setupTrackFree(song, t))).toEqual([]);
    expect(() => compileSong(song, null)).not.toThrow();
  });
  it("survives serialization and reruns without duplicates or new history entries", () => {
    const first = fillMixerInserts(rack(), assignments());
    const normalized = normalizeMusicProject(JSON.parse(JSON.stringify(first)));
    expect(normalized.mixer.tracks.at(-5)!.setupRole).toBe("instr");
    expect(fillMixerInserts(first, assignments())).toBe(first);
    expect(fillMixerInserts(normalized, assignments())).toBe(normalized);
    const changed = fillMixerInserts(first, new Map([["chan_synth", "bass"]]));
    expect(changed.channels[0].mixerTrack).toBe(first.channels[0].mixerTrack);
    expect(changed.mixer.tracks.find((t) => t.setupChannel === "chan_synth")?.sends[0].to).toBe(first.mixer.tracks.at(-4)!.id);
  });
  it("grows past the free inserts, then adds new channels in role/rack order without duplicates", () => {
    const channels = Array.from({ length: 30 }, (_, i) => ({ id: `chan_${i}`, name: `Sound ${i}`, sampleId: null }));
    const roles = new Map(channels.map((c, i) => [c.id, MIX_ROLES_FOR_TEST[i % 3]]));
    const first = fillMixerInserts(addChannels(createMusicProject("Large rack"), channels), roles);
    expect(first.mixer.tracks.filter((t) => t.setupChannel)).toHaveLength(30);
    expect(first.mixer.tracks.length).toBeGreaterThan(31);
    const oldIds = new Set(first.mixer.tracks.map((t) => t.id));
    const added = addChannels(first, [{ id: "chan_new_lead", name: "New lead", sampleId: null }]);
    const next = fillMixerInserts(added, new Map([["chan_new_lead", "instr"]]));
    expect(next.mixer.tracks.filter((t) => !oldIds.has(t.id))).toHaveLength(1);
    expect(next.mixer.tracks.filter((t) => t.setupChannel)).toHaveLength(31);
    const owned = next.mixer.tracks.filter((t) => t.setupChannel);
    expect(owned.map((t) => t.setupRole)).toEqual([...Array(11).fill("instr"), ...Array(10).fill("bass"), ...Array(10).fill("drums")]);
    expect(owned[10].setupChannel).toBe("chan_new_lead");
    for (const old of first.channels) expect(next.channels.find((c) => c.id === old.id)?.mixerTrack).toBe(old.mixerTrack);
    expect(fillMixerInserts(next, new Map([["chan_new_lead", "instr"]]))).toBe(next);
    const recordingIndex = next.mixer.tracks.findIndex((t) => t.id === "insert_16");
    expect(next.mixer.tracks.slice(1, recordingIndex).filter((t) => t.setupChannel)).toHaveLength(31);
    expect(next.mixer.tracks.slice(1, recordingIndex)).toHaveLength(31);
  });
  it("names Serum inserts after presets without renaming the channel rack", () => {
    const names = new Map([["chan_synth", "ARP - Bell Aperium"]]);
    const next = fillMixerInserts(rack(), assignments(), names);
    expect(next.mixer.tracks.find((t) => t.setupChannel === "chan_synth")?.name).toBe("ARP - Bell Aperium");
    expect(next.channels[0].name).toBe("Lead");
    expect(fillMixerInserts(next, assignments(), names)).toBe(next);
  });
  it("removes spare inserts on reruns and adds only one insert for a new channel", () => {
    let song = rack();
    song = updateMixerTrack(song, "insert_14", { pan: 0.2 });
    song = updateMixerTrack(song, "insert_16", { name: "rec", dock: "left" });
    const first = fillMixerInserts(song, assignments());
    expect(first.mixer.tracks.map((t) => t.id)).toContain("insert_14");
    expect(first.mixer.tracks.filter((t) => setupTrackFree(first, t))).toEqual([]);
    const padded = addMixerTracks(first, null, 4);
    expect(fillMixerInserts(padded, assignments())).toEqual(first);
    const added = addChannels(first, [{ id: "chan_new", name: "New lead", sampleId: null }]);
    const next = fillMixerInserts(added, new Map([["chan_new", "instr"]]));
    expect(next.mixer.tracks).toHaveLength(first.mixer.tracks.length + 1);
    expect(next.mixer.tracks.slice(1, 5).map((t) => t.setupChannel)).toEqual(["chan_synth", "chan_new", "chan_808", "chan_kick"]);
    expect(next.mixer.tracks.filter((t) => setupTrackFree(next, t))).toEqual([]);
    expect(fillMixerInserts(next, assignments())).toBe(next);
  });
  it("reuses the existing template and grows before recording/vocals while preserving their controls and connections", () => {
    let song = addMixerTracks(createMusicProject("Existing template"), null, 9, Array.from({ length: 9 }, (_, i) => `insert_${17 + i}`));
    song = updateMixerTrack(song, "insert_16", { name: "rec", dock: "left", pan: 0.1 });
    for (const [i, role] of ["instr", "bass", "drums", "vocals", "mixbus"].entries()) {
      song = updateMixerTrack(song, `insert_${21 + i}`, { name: role, dock: "right" });
      if (role !== "mixbus") song = { ...song, mixer: { ...song.mixer, tracks: song.mixer.tracks.map((t) => t.id === `insert_${21 + i}` ? { ...t, sends: [{ to: "insert_25", level: 1 }] } : t) } };
    }
    for (let i = 17; i <= 20; i++) {
      song = updateMixerTrack(song, `insert_${i}`, { name: `Vocal ${i}`, color: "#4e9d61" });
      song = { ...song, mixer: { ...song.mixer, tracks: song.mixer.tracks.map((t) => t.id === `insert_${i}` ? { ...t, sends: [{ to: "insert_24", level: 1 }] } : t) } };
    }
    const protectedTracks = song.mixer.tracks.slice(16, 21);
    const channels = Array.from({ length: 20 }, (_, i) => ({ id: `chan_large_${i}`, name: `Sound ${i}`, sampleId: null }));
    song = addChannels(song, channels);
    const next = fillMixerInserts(song, new Map(channels.map((c) => [c.id, "instr" as const])));
    expect(next.mixer.tracks.slice(1, 21).every((t) => t.setupChannel)).toBe(true);
    expect(next.mixer.tracks.slice(21, 26)).toEqual(protectedTracks);
    expect(next.mixer.tracks.filter((t) => t.setupRole && !t.setupChannel).map((t) => t.id)).toEqual(["insert_21", "insert_22", "insert_23", "insert_24", "insert_25"]);
    expect(next.mixer.tracks[26].name).toBe("instr");
  });
  it("refuses occupied bus slots atomically, including custom unnamed controls", () => {
    let song = addMixerTracks(rack(), null, 10);
    song = updateMixerTrack(song, song.mixer.tracks[21].id, { pan: 0.2 });
    const before = JSON.stringify(song);
    expect(() => fillMixerInserts(song, assignments())).toThrow(/Insert 21 is already in use/);
    expect(JSON.stringify(song)).toBe(before);
  });
  it("preserves dedicated insert effects/controls and sidechain-only sends", () => {
    let song = routeChannels(rack(), ["chan_kick"], "insert_5");
    song = updateMixerTrack(song, "insert_5", { volume: 0.4, pan: 0.2 });
    song = setSend(song, "insert_5", "insert_6", 0);
    const next = fillMixerInserts(song, assignments());
    const track = next.mixer.tracks.find((t) => t.id === "insert_5")!;
    expect(track).toMatchObject({ volume: 0.4, pan: 0.2 });
    expect(track.sends).toContainEqual({ to: "insert_6", level: 0 });
    expect(next.channels[2].mixerTrack).toBe("insert_5");
  });
  it("rejects shared inserts, recording inserts and custom audible outputs", () => {
    const shared = routeChannels(rack(), ["chan_kick", "chan_808"], "insert_5");
    expect(() => fillMixerInserts(shared, assignments())).toThrow(/shares an insert/);
    const recording = routeChannels(rack(), ["chan_kick"], "insert_16");
    expect(() => fillMixerInserts(recording, assignments())).toThrow(/recording\/vocal/);
    const custom = setSend(routeChannels(rack(), ["chan_kick"], "insert_5"), "insert_5", "insert_6", 1);
    expect(() => fillMixerInserts(custom, assignments())).toThrow(/custom output routing/);
  });
  it("does not claim an automated empty insert or silently accept stale assignments", () => {
    const song = rack();
    song.automations.push({ id: "auto_pan", name: "Pan", color: null, target: { kind: "mixer", track: "insert_1", control: "pan" }, points: [], tension: 0 } as unknown as typeof song.automations[number]);
    expect(setupTrackFree(song, song.mixer.tracks[1])).toBe(false);
    expect(() => fillMixerInserts(song, new Map([["gone", "bass"]]))).toThrow(/channel rack changed/);
  });
});

describe("user routing conventions", () => {
  const evidence = (filename: string | null, preset: string | null = null, category: string | null = null): ChannelEvidence => ({ channelId: "c", name: "Display name", kind: "sampler", filename, preset, category, supported: true });
  it("always puts 808 in bass, and uses filenames/categories over display names", () => {
    expect(explicitMixRole(evidence("808_Kick.wav"))).toBe("bass");
    expect(explicitMixRole(evidence(null, "808 - To 909 BD Maker", "808"))).toBe("bass");
    expect(explicitMixRole(evidence(null, "SY_2", "Bass"))).toBe("bass");
    expect(explicitMixRole(evidence("HH_7 Minute.wav"))).toBe("drums");
    expect(explicitMixRole(evidence(null, "ARP - Acid101"))).toBe("instr");
    expect(explicitMixRole(evidence("FX 199X.wav"))).toBe(null);
    expect(explicitMixRole(evidence("FX - 199X [Ginseng].wav"))).toBe("drums");
    expect(explicitMixRole(evidence("FX_199X_[Ginseng].wav"))).toBe("drums");
    expect(explicitMixRole(evidence("FX - Risers [Ginseng].wav"))).toBe(null);
  });
  it("treats Serum choir and vocal synthesis presets as instruments", () => {
    expect(explicitMixRole(evidence(null, "VOX - String Vocal Follower", "Choir"))).toBe("instr");
    expect(explicitMixRole(evidence(null, "VOX - String Vocal Follower"))).toBe("instr");
    expect(explicitMixRole(evidence(null, "Singing", "Vocal"))).toBe("instr");
    expect(explicitMixRole(evidence("Recorded vocal.wav", null, "Vocal"))).toBe(null);
    for (const category of ["Strings", "Bell", "Brass", "Instrument", "Keyboard", "E Piano", "Guitar"]) expect(explicitMixRole(evidence(null, "Melody", category))).toBe("instr");
    expect(explicitMixRole(evidence(null, "808 Choir", "Choir"))).toBe("bass");
  });
});
