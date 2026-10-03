import { describe, expect, it } from "vitest";
import { addMixerTracks, setEffect } from "@shared/music/mixer";
import { findProQ } from "@shared/music/pro-q";
import { PRO_Q_PLUGIN } from "@shared/music/pro-q-presets";
import { MASTER_TRACK_ID, createMusicProject } from "@shared/music/project";
import { describeProQ, findEq, setProQBandsTool, updateProQTool } from "./tool-edits";

const EQ = "fx_eq";
const song = () => setEffect(createMusicProject("EQ", 120), MASTER_TRACK_ID, 0, PRO_Q_PLUGIN, EQ);
const bands = (s: ReturnType<typeof song>) => findProQ(s, EQ)!.proQ.bands;

describe("the assistant's Pro-Q", () => {
  it("adds, changes and removes bands, and says the curve they make", () => {
    let { song: s, text } = setProQBandsTool(song(), {
      bands: [
        { shape: "lowCut", frequency: 30, slope: 24 },
        { frequency: 250, gain: -3, q: 1.5 },
        { shape: "highShelf", frequency: 10000, gain: 2 },
      ],
    });
    expect(bands(s).map((b) => [b.id, b.shape, b.frequency])).toEqual([
      [1, "lowCut", 30],
      [2, "bell", 250],
      [3, "highShelf", 10000],
    ]);
    expect(text).toContain("added Band 2: Bell at 250.0 Hz, −3.00 dB, Q 1.50, 12 dB/oct");
    expect(text).toMatch(/Curve now .*125 -0\.9, 250 -3, 500 -0\.9/);
    ({ song: s } = setProQBandsTool(s, { bands: [{ band: 2, gain: -5, range: -4 }, { band: 1, remove: true }] }));
    expect(bands(s).map((b) => b.id)).toEqual([2, 3]);
    expect(bands(s)[0]).toMatchObject({ gain: -5, range: -4, threshold: null });
    ({ song: s } = setProQBandsTool(s, { clear: true, bands: [{ frequency: 1000, gain: 3 }] }));
    expect(bands(s).map((b) => b.id)).toEqual([1]);
  });

  it("explains what's wrong: a band that isn't there, a shape that can't be dynamic, a slope a shape doesn't take", () => {
    const { song: s } = setProQBandsTool(song(), { bands: [{ frequency: 100 }] });
    expect(() => setProQBandsTool(s, { bands: [{ band: 9, gain: 2 }] })).toThrow(/no band 9. Its bands: 1/);
    expect(() => setProQBandsTool(s, { bands: [{ shape: "notch", frequency: 100, range: -3 }] })).toThrow(/can't be dynamic/);
    expect(() => setProQBandsTool(s, { bands: [{ band: 1, slope: "brickwall" }] })).toThrow(/takes slopes 12, 18/);
    expect(() => setProQBandsTool(s, { bands: [{ gain: 3 }] })).toThrow(/give its "frequency"/);
    expect(() => findEq(createMusicProject("None", 120), {})).toThrow(/add_mixer_effect with plugin "YT-EQ"/);
  });

  it("finds a Pro-Q by track, and asks which when there are several", () => {
    let s = addMixerTracks(song(), null);
    const insert = s.mixer.tracks[1].id;
    s = setEffect(s, insert, 0, PRO_Q_PLUGIN, "fx_two");
    expect(findEq(s, { track: 1 }).effect.id).toBe("fx_two");
    expect(() => findEq(s, {})).toThrow(/Say which YT-EQ/);
  });

  it("sets the mode, output and Gain Scale, loads presets, switches A/B; and reads it all back", () => {
    let { song: s } = updateProQTool(song(), { mode: "linearPhase", resolution: "high", output: -2, gainScale: 50, autoGain: true });
    const pq = findProQ(s, EQ)!.proQ;
    expect(pq).toMatchObject({ mode: "linearPhase", resolution: "high", output: -2, gainScale: 0.5, autoGain: true });
    ({ song: s } = updateProQTool(s, { preset: "vocal presence" }));
    expect(bands(s).length).toBe(5);
    ({ song: s } = updateProQTool(s, { ab: "switch" }));
    expect(findProQ(s, EQ)!.proQ.ab).toBe("b");
    const said = describeProQ(s, {});
    expect(said).toContain("Mode: Zero Latency");
    expect(said).toContain("Editing B of A/B");
    expect(said).toContain("Band 1: Low Cut at 90.00 Hz");
    expect(() => updateProQTool(s, { preset: "nope" })).toThrow(/Its presets: Default Setting/);
    expect(updateProQTool(s, {}).text).toBe("Nothing changed.");
  });
});
