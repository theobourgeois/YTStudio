import { describe, expect, it } from "vitest";
import { setEffect, updateEffect } from "@shared/music/mixer";
import { createMusicProject } from "@shared/music/project";
import { delayText, offsetText, pluginDelay } from "./latency";

const PLUGIN = { id: "VST3-EQ", name: "EQ", format: "VST3" };

describe("a track's delay", () => {
  it("is what its effects that are on and loaded say they delay it by", () => {
    let song = setEffect(createMusicProject(), "insert_1", 0, PLUGIN, "fx_a");
    song = setEffect(song, "insert_1", 3, PLUGIN, "fx_b");
    song = setEffect(song, "insert_1", 5, PLUGIN, "fx_c");
    const loaded = [
      { effect: "fx_a", name: "EQ", editorOpen: false, latency: 882 },
      { effect: "fx_b", name: "EQ", editorOpen: false, latency: 64 },
    ];
    expect(pluginDelay(song.mixer.tracks[1], loaded)).toBe(946);
    expect(pluginDelay(updateEffect(song, "insert_1", 0, { enabled: false }).mixer.tracks[1], loaded)).toBe(64);
    expect(pluginDelay(song.mixer.tracks[2], loaded)).toBe(0);
  });

  it("reads in ms and samples, and its offset with a sign", () => {
    expect(delayText(882, 44100)).toBe("20.0 ms (882 samples)");
    expect(delayText(1, 48000)).toBe("0.0 ms (1 sample)");
    expect(offsetText(5)).toBe("+5 ms");
    expect(offsetText(-2.5)).toBe("−2.5 ms");
    expect(offsetText(0)).toBe("0 ms");
  });
});
