import { describe, expect, it } from "vitest";
import { controlAt } from "@shared/music/automation";
import { addChannels, addPluginChannel } from "@shared/music/edits";
import { setEffect, setSend } from "@shared/music/mixer";
import { createMusicProject } from "@shared/music/project";
import { addAutomationEdit, describeAutomations, resolveControl, updateAutomationTool } from "./tool-edits";

const BAR = 384;
function song() {
  let s = addChannels(createMusicProject("Song", 120), [{ id: "chan_kick", name: "Kick", sampleId: "m" }]);
  s = addPluginChannel(s, { id: "VST3-serum", name: "Serum 2", format: "VST3" }, "chan_lead");
  s = setEffect(s, "insert_2", 0, { id: "VST3-q", name: "Pro-Q 4", format: "VST3" }, "fx_q");
  return setSend(s, "insert_2", "insert_3", 0.5);
}

describe("the assistant's automation", () => {
  it("names controls as the model does: a channel's or track's, a send, an effect's mix, a plugin's parameter", () => {
    const s = song();
    expect(resolveControl(s, { control: "pan", channel: "Kick" })).toEqual({ kind: "channel", channel: "chan_kick", control: "pan" });
    expect(resolveControl(s, { control: "volume", track: 2 })).toEqual({ kind: "mixer", track: "insert_2", control: "volume" });
    expect(resolveControl(s, { control: "send", track: 2, to: 3 })).toEqual({ kind: "send", track: "insert_2", to: "insert_3" });
    expect(resolveControl(s, { control: "mix", track: "Insert 2", slot: 1 })).toEqual({ kind: "effect", effect: "fx_q" });
    expect(resolveControl(s, { control: "main volume" })).toEqual({ kind: "main" });
    expect(resolveControl(s, { control: "parameter", channel: "Serum 2", parameter: "Cutoff" })).toMatchObject({ owner: "channel", id: "chan_lead", parameter: "Cutoff" });
    expect(() => resolveControl(s, { control: "send", track: 2, to: 4 })).toThrow(/doesn.t send to.*Insert 4.*sends go to:.*Insert 3/);
    expect(() => resolveControl(s, { control: "mix", track: 2, slot: 5 })).toThrow(/slots 1 \(Pro-Q 4\)/);
    expect(() => resolveControl(s, { control: "parameter", channel: "Kick", parameter: "x" })).toThrow(/isn't a plugin channel/);
    expect(() => resolveControl(s, { control: "tempo" })).toThrow(/must be one of/);
  });

  it("makes a clip along the points given, in the control's own values, from a bar", () => {
    const s = song();
    const made = addAutomationEdit(s, { control: "pan", channel: "Kick", bar: 3, length: 2, points: [{ at: 0, value: -1 }, { at: 2, value: 1, curve: "double" }] }, { kind: "channel", channel: "chan_kick", control: "pan" });
    const target = { kind: "channel", channel: "chan_kick", control: "pan" } as const;
    expect(controlAt(made.song, target, BAR * 2)).toBeCloseTo(0);
    expect(controlAt(made.song, target, BAR * 3)).toBeCloseTo(0.5);
    expect(controlAt(made.song, target, BAR * 4)).toBeCloseTo(1);
    expect(made.text).toMatch(/"Pan \(Kick\)".*Drives Pan of Kick.*0: 100% left; 2: 100% right \(double curve\)/s);
    expect(() => addAutomationEdit(s, { control: "pan", length: 1, points: [{ at: 4, value: 0 }] }, target)).toThrow(/past the clip's end/);
    expect(() => addAutomationEdit(s, { control: "pan", points: [{ at: 0, value: 0, curve: "zigzag" }] }, target)).toThrow(/"curve" must be one of/);
  });

  it("changes a clip: points, range, LFO, a tool; deletes it", () => {
    const s = song();
    const made = addAutomationEdit(s, { control: "volume", channel: "Kick" }, { kind: "channel", channel: "chan_kick", control: "volume" });
    const id = made.automationId;
    const changed = updateAutomationTool(made.song, { automation: id, points: [{ at: 0, value: 0.2 }, { at: 1, value: 0.6 }], max: 0.5, lfo: { enabled: true, speed: 4, level: 0.3 }, tool: "flip" });
    const automation = changed.song.automations[0];
    expect(automation.points.map((p) => p.value)).toEqual([0.8, 0.4]);
    expect(automation).toMatchObject({ max: 0.5, lfo: { enabled: true, speed: 4, level: 0.3 } });
    expect(updateAutomationTool(changed.song, { automation: "Volume (Kick)", remove: true }).song.automations).toEqual([]);
    expect(() => updateAutomationTool(changed.song, { automation: "nope" })).toThrow(/automation clips are: "Volume \(Kick\)"/);
    expect(() => updateAutomationTool(changed.song, { automation: id, min: 3 })).toThrow(/0 to 1/);
  });

  it("describes every automation clip, and how automation plays", () => {
    const s = song();
    expect(describeAutomations(s)).toMatch(/song mode only.*none yet/s);
    const made = addAutomationEdit(s, { control: "volume", track: "master" }, { kind: "mixer", track: "master", control: "volume" });
    expect(describeAutomations(made.song)).toMatch(/"Volume \(Master\)" \(id auto_\w+\):\nDrives Volume of Master.*Its clips: clip 1 on track 1 at bar 1, 4 bars/s);
  });
});
