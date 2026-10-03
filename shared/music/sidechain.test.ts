import { describe, expect, it } from "vitest";
import { compileSong, trackOrder } from "./compile.ts";
import { canSend, effectToTrack, removeMixerTracks, setEffect, setMixerSolo, setSend, updateMixerTrack } from "./mixer.ts";
import { PRO_C_PLUGIN } from "./pro-c-presets.ts";
import { FIRST_PATTERN_ID, createMusicProject, normalizeMusicProject } from "./project.ts";
import { canKey, findSlot, keyChoices, keyedBy, setSidechain, setSidechainTap, sidechainLinks, takesKey, withValidKeys } from "./sidechain.ts";
import { ECHO_BOY_PLUGIN } from "./echo-boy-presets.ts";
import { PRO_Q_PLUGIN } from "./pro-q-presets.ts";
import type { MusicProject, PluginRef } from "./types.ts";

const SERUM: PluginRef = { id: "VST3-Comp-1", name: "Some Compressor", format: "VST3" };

/** Insert 1 (a kick) keys a compressor plugin on Insert 2 (the bass), and every insert goes to the master. */
function song(): MusicProject {
  const s = setEffect(createMusicProject("Duck", 120), "insert_2", 0, SERUM, "fx_comp");
  return setSidechain(s, "fx_comp", "insert_1");
}
const key = (s: MusicProject, id = "fx_comp") => findSlot(s, id)?.effect.sidechain;
const order = (s: MusicProject) => trackOrder(s.mixer.tracks).map((t) => t.id);

describe("keys", () => {
  it("are any effect's, taken after the source's effects by default, with no send made", () => {
    const s = song();
    expect(key(s)).toEqual({ track: "insert_1", tap: "postFx" });
    expect(s.mixer.tracks.find((t) => t.id === "insert_1")!.sends).toEqual([{ to: "master", level: 1 }]);
    expect(keyedBy(s, "insert_1").map((k) => k.effect.id)).toEqual(["fx_comp"]);
    expect(sidechainLinks(s)).toEqual([{ from: "insert_1", to: "insert_2" }]);
  });

  it("give the same song back when nothing changes, and change their tap", () => {
    const s = song();
    expect(setSidechain(s, "fx_comp", "insert_1")).toBe(s);
    expect(setSidechainTap(s, "fx_comp", "postFx")).toBe(s);
    expect(key(setSidechainTap(s, "fx_comp", "preFx"))).toEqual({ track: "insert_1", tap: "preFx" });
    // A tap given with the source; then kept when the source changes.
    const faded = setSidechain(s, "fx_comp", "insert_3", "postFader");
    expect(key(faded)).toEqual({ track: "insert_3", tap: "postFader" });
    expect(key(setSidechain(faded, "fx_comp", "insert_4"))).toEqual({ track: "insert_4", tap: "postFader" });
    expect(key(setSidechain(s, "fx_comp", null))).toBeUndefined();
    expect(setSidechain(createMusicProject(), "fx_comp", null)).toEqual(createMusicProject());
  });

  it("never come from the master, the effect's own track, or round a loop through sends and keys", () => {
    const s = song();
    expect(setSidechain(s, "fx_comp", "master")).toBe(s);
    expect(setSidechain(s, "fx_comp", "insert_2")).toBe(s);
    expect(canKey(s, "master", "insert_2")).toBe(false);
    // Insert 2 sends to Insert 3: Insert 3 can't key Insert 2.
    const sent = setSend(s, "insert_2", "insert_3", 1);
    expect(setSidechain(sent, "fx_comp", "insert_3")).toBe(sent);
    // A key orders tracks as a send does: Insert 2 (keyed by 1) can't send back to Insert 1...
    expect(canSend(s, "insert_2", "insert_1")).toBe(false);
    expect(setSend(s, "insert_2", "insert_1", 1)).toBe(s);
    // ...nor can a key on Insert 1 come from Insert 2.
    const two = setEffect(s, "insert_1", 0, PRO_C_PLUGIN, "fx_c");
    expect(setSidechain(two, "fx_c", "insert_2")).toBe(two);
    // But the effect's own key is left out of the check (replacing it with another source is fine).
    expect(canKey(s, "insert_3", "insert_2", "fx_comp")).toBe(true);
  });

  it("put the source before the keyed track, even when it comes after it in the mixer", () => {
    const s = setSidechain(song(), "fx_comp", "insert_5");
    const o = order(s);
    expect(o.indexOf("insert_5")).toBeLessThan(o.indexOf("insert_2"));
    expect(o.at(-1)).toBe("master");
    const compiled = compileSong(s, FIRST_PATTERN_ID);
    const effect = compiled.tracks.find((t) => t.id === "insert_2")!.effects[0];
    expect(effect.key).toEqual({ track: o.indexOf("insert_5"), tap: "postFx" });
  });

  it("go with their source track when it's removed, and with an effect moved onto it", () => {
    const s = song();
    expect(key(removeMixerTracks(s, ["insert_1"]))).toBeUndefined();
    // Moved onto the kick's own track: no longer possible.
    const moved = effectToTrack(s, "insert_2", 0, "insert_1");
    expect(findSlot(moved, "fx_comp")!.track.id).toBe("insert_1");
    expect(key(moved)).toBeUndefined();
    // Moved elsewhere: kept.
    expect(key(effectToTrack(s, "insert_2", 0, "insert_3"))).toEqual({ track: "insert_1", tap: "postFx" });
    expect(withValidKeys(s)).toBe(s);
  });

  it("are checked on load: a missing track, the effect's own, the master or a loop goes", () => {
    const raw = JSON.parse(JSON.stringify(setEffect(song(), "insert_1", 1, PRO_C_PLUGIN, "fx_loop")));
    const tracks = raw.mixer.tracks as { id: string; effects: ({ id: string; sidechain?: unknown } | null)[] }[];
    // A Pro-C on Insert 1 keyed by Insert 2 (which Insert 1 keys): a loop, so it goes; the first stays.
    tracks.find((t) => t.id === "insert_1")!.effects[1]!.sidechain = { track: "insert_2", tap: "preFx" };
    tracks.find((t) => t.id === "insert_3")!.effects[0] = { id: "fx_gone", plugin: SERUM, sidechain: { track: "insert_99" } } as never;
    tracks.find((t) => t.id === "insert_4")!.effects[0] = { id: "fx_self", plugin: SERUM, sidechain: { track: "insert_4" } } as never;
    tracks.find((t) => t.id === "insert_5")!.effects[0] = { id: "fx_master", plugin: SERUM, sidechain: { track: "master" } } as never;
    tracks.find((t) => t.id === "insert_6")!.effects[0] = { id: "fx_tap", plugin: SERUM, sidechain: { track: "insert_7", tap: "sideways" } } as never;
    const s = normalizeMusicProject(raw);
    expect(key(s)).toEqual({ track: "insert_1", tap: "postFx" });
    expect(key(s, "fx_loop")).toBeUndefined();
    expect(key(s, "fx_gone")).toBeUndefined();
    expect(key(s, "fx_self")).toBeUndefined();
    expect(key(s, "fx_master")).toBeUndefined();
    expect(key(s, "fx_tap")).toEqual({ track: "insert_7", tap: "postFx" });
  });

  it("list the tracks to choose from, a loop greyed", () => {
    const s = setSend(song(), "insert_2", "insert_3", 1);
    const choices = keyChoices(s, "fx_comp");
    expect(choices.map((c) => c.number)).toEqual(Array.from({ length: s.mixer.tracks.length - 1 }, (_, i) => i + 1).filter((n) => n !== 2));
    expect(choices.find((c) => c.id === "insert_1")).toMatchObject({ name: "Insert 1", possible: true });
    expect(choices.find((c) => c.id === "insert_3")!.possible).toBe(false);
  });

  it("are heard by Pro-C, Pro-Q and plugins with a sidechain input", () => {
    expect(takesKey({ plugin: PRO_C_PLUGIN })).toBe(true);
    expect(takesKey({ plugin: PRO_Q_PLUGIN })).toBe(true);
    expect(takesKey({ plugin: ECHO_BOY_PLUGIN })).toBe(false);
    expect(takesKey({ plugin: SERUM })).toBe(true);
    expect(takesKey({ plugin: SERUM }, false)).toBe(false);
  });

  it("keep feeding a solo: a source the solo silences keeps its unsoloed gains for a key after its fader", () => {
    let s = setSidechainTap(song(), "fx_comp", "postFader");
    s = updateMixerTrack(s, "insert_1", { volume: 0.4 });
    const soloed = setMixerSolo(s, ["insert_2"], true);
    const kick = compileSong(soloed, FIRST_PATTERN_ID).tracks.find((t) => t.id === "insert_1")!;
    expect(kick.gains).toEqual([0, 0, 0, 0]);
    expect(kick.keyGains![0]).toBeCloseTo((0.4 / 0.8) ** 3, 9);
    // Not soloed out: its keys take its gains.
    expect(compileSong(s, FIRST_PATTERN_ID).tracks.find((t) => t.id === "insert_1")!.keyGains).toBeUndefined();
    // Muted by hand, it's silent after its fader (its key after its effects isn't).
    const muted = updateMixerTrack(s, "insert_1", { muted: true });
    expect(compileSong(muted, FIRST_PATTERN_ID).tracks.find((t) => t.id === "insert_1")!.keyGains).toBeUndefined();
  });
});
