import { describe, expect, it } from "vitest";
import { createAutomation } from "@shared/music/automation";
import { addChannels, addPluginChannel } from "@shared/music/edits";
import { routeChannels, setEffect } from "@shared/music/mixer";
import { createMusicProject } from "@shared/music/project";
import { matches, pluginOwners, songControls } from "./controls";

function song() {
  let s = addChannels(createMusicProject("Song"), [{ id: "chan_kick", name: "Kick", sampleId: "m" }]);
  s = addPluginChannel(s, { id: "VST3-serum", name: "Serum 2", format: "VST3" }, "chan_lead");
  s = routeChannels(s, ["chan_kick"], "insert_1");
  s = setEffect(s, "insert_2", 0, { id: "VST3-q", name: "Pro-Q 4", format: "VST3" }, "fx_q");
  return createAutomation(s, { kind: "channel", channel: "chan_kick", control: "pan" }, { start: 0, length: 384 }).song;
}

describe("the controls a song can automate", () => {
  it("are the main volume and tempo, every channel's volume, pan and pitch, and the mixer tracks in use", () => {
    const groups = songControls(song());
    expect(groups.map((g) => g.title)).toEqual(["Song", "Channels", "Mixer"]);
    expect(groups[0].rows.map((r) => r.name)).toEqual(["Main volume", "Tempo"]);
    const channels = groups[1].rows.map((r) => `${r.name} (${r.owner})${r.automated ? " *" : ""}`);
    expect(channels).toContain("Pan (Kick) *");
    expect(channels).toContain("Volume (Serum 2)");
    expect(channels).toContain("Pitch (Kick)");
    // The master, insert 1 (the kick plays into it) and insert 2 (an effect), with their sends and the effect's mix.
    const mixer = groups[2].rows.map((r) => `${r.name} (${r.owner})`);
    expect(mixer).toContain("Volume (Master)");
    expect(mixer).toContain("Volume (Insert 1)");
    expect(mixer).toContain("Mix (Pro-Q 4 (Insert 2))");
    expect(mixer).not.toContain("Volume (Insert 3)");
  });

  it("include the plugins whose parameters the engine lists", () => {
    expect(pluginOwners(song())).toEqual([
      { owner: "channel", id: "chan_lead", name: "Serum 2" },
      { owner: "effect", id: "fx_q", name: "Pro-Q 4 (Insert 2)" },
    ]);
  });

  it("are found by every word typed, in any order", () => {
    expect(matches("vol kick", "Volume", "Kick")).toBe(true);
    expect(matches("kick pan", "Volume", "Kick")).toBe(false);
    expect(matches("  ", "anything")).toBe(true);
  });
});
