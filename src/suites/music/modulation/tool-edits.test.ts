import { describe, expect, it } from "vitest";
import { addChannels } from "@shared/music/edits";
import { createMusicProject } from "@shared/music/project";
import type { MusicProject } from "@shared/music/types";
import { addModulatorTool, describeModulators, findModulatorRef, linkModulatorEdit, removeModulatorTool, updateModulatorTool } from "./tool-edits";

const song = (): MusicProject => addChannels(createMusicProject("Pump", 120), [{ id: "chan_kick", name: "Kick", sampleId: null }]);
const FADER = { kind: "mixer", track: "insert_2", control: "volume" } as const;

describe("the assistant's modulators", () => {
  it("are made from a track's level or a channel's notes, their follower in ms and dB", () => {
    let s = addModulatorTool(song(), { track: 1, attack: 1, release: 200, gain: 6 }, "mod_a").song;
    expect(s.modulators[0]).toMatchObject({ source: { kind: "track", track: "insert_1", tap: "postFx" }, attack: 0.001, release: 0.2, gain: 6 });
    s = addModulatorTool(s, { channel: "Kick", name: "Pump" }, "mod_b").song;
    expect(s.modulators[1]).toMatchObject({ name: "Pump", source: { kind: "notes", channel: "chan_kick" } });
    expect(() => addModulatorTool(s, {}, "mod_c")).toThrow(/Say what it follows/);
    expect(() => addModulatorTool(s, { track: 1, channel: "Kick" }, "mod_c")).toThrow(/not both/);
    expect(() => addModulatorTool(s, { track: 1, release: 0 }, "mod_c")).toThrow(/"release" must be milliseconds/);
    expect(findModulatorRef(s, "insert 1 level").id).toBe("mod_a");
    expect(() => findModulatorRef(s, "nope")).toThrow(/"Insert 1 level" \(mod_a\)/);
  });

  it("link and unlink controls, change and remove", () => {
    let s = addModulatorTool(song(), { track: 1 }, "mod_a").song;
    const linked = linkModulatorEdit(s, { modulator: "mod_a", amount: -0.6 }, FADER);
    expect(linked.text).toMatch(/Volume \(Insert 2\) is moved by Insert 1 level, −60% \(80% → 20% at full level\)/);
    s = linked.song;
    expect(() => linkModulatorEdit(s, { modulator: "mod_a", amount: 2 }, FADER)).toThrow(/-1 to 1/);
    expect(() => linkModulatorEdit(s, { modulator: "mod_a", amount: 0.5 }, { kind: "tempo" })).toThrow(/tempo/);
    expect(describeModulators(s)).toMatch(/moves Volume \(Insert 2\) by −60%/);
    s = updateModulatorTool(s, { modulator: "mod_a", tap: "postFader", tension: 0.5 }).song;
    expect(s.modulators[0]).toMatchObject({ source: { tap: "postFader" }, tension: 0.5 });
    s = linkModulatorEdit(s, { modulator: "mod_a", amount: "none" }, FADER).song;
    expect(s.modulators[0].links).toEqual([]);
    expect(removeModulatorTool(s, { modulator: "mod_a" }).song.modulators).toEqual([]);
  });
});
