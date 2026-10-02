import { describe, expect, it } from "vitest";
import { controlOf, createAutomation, editPoints } from "./automation.ts";
import { compileSong } from "./compile.ts";
import { setEffect } from "./mixer.ts";
import { OTT_CONTROL_SPECS, OTT_LANES, OTT_LANES_OF, chooseOttPreset, engineOtt, findOtt, ottGainDb, ottRelease, otts, setOttControl, softKnee, updateOtt, updateOttBand } from "./ott.ts";
import { DEFAULT_OTT, OTT_PLUGIN, OTT_PRESETS, normalizeOtt, ottPreset } from "./ott-presets.ts";
import { addClips, editClips } from "./playlist.ts";
import { FIRST_PATTERN_ID, createMusicProject, normalizeMusicProject, normalizeTarget } from "./project.ts";
import { type MusicProject, OTT_CONTROLS, type Ott } from "./types.ts";

const P = FIRST_PATTERN_ID;
const BAR = 384;
const round = (v: number, digits = 3) => Math.round(v * 10 ** digits) / 10 ** digits;

/** A song at 120 BPM with an OTT in Insert 1's first slot. */
function withOtt(): MusicProject {
  return setEffect(createMusicProject("Squash", 120), "insert_1", 0, OTT_PLUGIN, "fx_ott");
}
const ott = (song: MusicProject) => findOtt(song, "fx_ott")!.ott;
const engine = (patch: Partial<Ott> = {}) => engineOtt({ ...DEFAULT_OTT, ...patch });

describe("OTT's settings", () => {
  it("is put in a slot with Xfer's defaults, and found", () => {
    const song = withOtt();
    expect(ott(song)).toEqual(DEFAULT_OTT);
    expect(otts(song).map((o) => o.effect.id)).toEqual(["fx_ott"]);
    expect(findOtt(song, "fx_nope")).toBeNull();
  });

  it("survives a save and load, and repairs what's wrong", () => {
    let song = updateOtt(withOtt(), "fx_ott", { depth: 0.4, time: 3 });
    song = updateOttBand(song, "fx_ott", 2, { gain: 2.5, downward: false });
    const loaded = normalizeMusicProject(JSON.parse(JSON.stringify(song)));
    expect(ott(loaded)).toEqual(ott(song));
    const repaired = normalizeOtt({ depth: 7, time: -1, input: 99, preset: "Nope", bands: [{ threshold: 9, gain: "loud" }] });
    expect(repaired).toMatchObject({ depth: 1, time: 0, input: 19.1, preset: null });
    expect(repaired.bands[0]).toEqual({ threshold: 2, gain: 0, upward: true, downward: true });
    expect(repaired.bands[1]).toBe(DEFAULT_OTT.bands[1]);
  });

  it("forgets its preset once the sound changes, and loads one whole", () => {
    let song = chooseOttPreset(withOtt(), "fx_ott", "Gentle");
    expect(ott(song)).toMatchObject({ preset: "Gentle", depth: 0.3 });
    song = updateOtt(song, "fx_ott", { depth: 0.31 });
    expect(ott(song).preset).toBeNull();
    // The same value: the same song.
    expect(updateOtt(song, "fx_ott", { depth: 0.31 })).toBe(song);
    expect(updateOttBand(song, "fx_ott", 5, { gain: 1 })).toBe(song);
    song = chooseOttPreset(song, "fx_ott", "Default");
    expect(ott(song)).toEqual(DEFAULT_OTT);
  });

  it("has presets that are valid and named", () => {
    expect(new Set(OTT_PRESETS.map((p) => p.name)).size).toBe(OTT_PRESETS.length);
    for (const preset of OTT_PRESETS) {
      const settings = ottPreset(preset.name)!;
      expect(normalizeOtt(settings)).toEqual(settings);
      expect(settings.preset).toBe(preset.name);
    }
    expect(ottPreset("Default")).toEqual(DEFAULT_OTT);
  });
});

describe("OTT's sound (Braun's model)", () => {
  it("leaves the sound alone at Depth 0", () => {
    const e = engine({ depth: 0 });
    for (const band of e.bands) for (const level of [-120, -60, -30, 0]) expect(ottGainDb(band, level)).toBeCloseTo(0, 9);
    expect(e.input).toBe(1);
    expect(e.output).toBe(1);
  });

  it("holds loud sound at its downward knee (an infinite ratio) at the defaults", () => {
    for (const band of engine().bands) {
      expect(band.downward).toBeCloseTo(1, 6);
      // Well above the knee, every dB more in is a dB more taken off: the output stays put.
      const out = (level: number) => level + ottGainDb(band, level);
      expect(out(-10)).toBeCloseTo(out(-20), 6);
      expect(out(-10)).toBeCloseTo(band.downKnee + band.makeup, 6);
    }
  });

  it("lifts quiet sound by about 3:4 of each dB below its upward knee, up to its cap, and never cuts past its floor", () => {
    const [low] = engine().bands;
    const lift = (level: number) => ottGainDb(low, level) - low.makeup;
    expect(lift(low.upKnee - 10)).toBeCloseTo(10 * 0.74786, 3);
    expect(lift(-200)).toBeCloseTo(low.cap, 6);
    // Turned down hard (very loud, the thresholds low), it stops at the floor.
    const hard = engineOtt({ ...DEFAULT_OTT, bands: [{ ...DEFAULT_OTT.bands[0], threshold: 0 }, DEFAULT_OTT.bands[1], DEFAULT_OTT.bands[2]] }).bands[0];
    expect(ottGainDb(hard, 20)).toBe(hard.floor);
  });

  it("is Braun's model at its defaults (fitted constants, low / mid / high)", () => {
    const [low, mid, high] = engine().bands;
    expect([low.makeup, mid.makeup, high.makeup].map((v) => round(v, 3))).toEqual([14.035, 9.052, 14.064]);
    expect([low.upKnee, mid.upKnee, high.upKnee]).toEqual([-46.0171, -46.5885, -47.4393]);
    expect([low.downKnee, mid.downKnee, high.downKnee]).toEqual([-38.9401, -34.8204, -41.6879]);
    expect([low.attack, mid.attack, high.attack]).toEqual([0.00621537, 0.006, 0.0096577]);
    expect([low.release, mid.release, high.release]).toEqual([0.030877, 0.030877, 0.0103717]);
  });

  it("moves both knees of a band with its threshold, ±23 to 24 dB", () => {
    const at = (threshold: number) => engineOtt({ ...DEFAULT_OTT, bands: [DEFAULT_OTT.bands[0], { ...DEFAULT_OTT.bands[1], threshold }, DEFAULT_OTT.bands[2]] }).bands[1];
    expect(at(2).upKnee - at(1).upKnee).toBeCloseTo(23.743, 6);
    expect(at(0).downKnee - at(1).downKnee).toBeCloseTo(-23.743, 6);
  });

  it("scales the slopes by Upwd% and Dnwd%, and switches a band's compressors off", () => {
    expect(engine({ upward: 0 }).bands.every((b) => b.upward === 0)).toBe(true);
    expect(engine({ downward: 0 }).bands.every((b) => b.downward === 0)).toBe(true);
    expect(engine({ upward: 2 }).bands[0].upward).toBeCloseTo(2 * 0.74786, 6);
    // Below 100% the ratio isn't infinite any more; above it, it stays so.
    expect(engine({ downward: 0.5, depth: 1 }).bands[0].downward).toBeLessThan(0.6);
    expect(engine({ downward: 2 }).bands[0].downward).toBe(1);
    const off = engineOtt({ ...DEFAULT_OTT, bands: [{ ...DEFAULT_OTT.bands[0], upward: false, downward: false }, DEFAULT_OTT.bands[1], DEFAULT_OTT.bands[2]] }).bands[0];
    expect([off.upward, off.downward]).toEqual([0, 0]);
    // A band off is its makeup alone.
    expect(ottGainDb(off, -30)).toBeCloseTo(off.makeup, 6);
  });

  it("releases as OTT does with Time: fitted up to 100%, in proportion after", () => {
    expect(ottRelease(0, 0)).toBeCloseTo(0.0100376, 9);
    expect(ottRelease(0, 0.5)).toBeCloseTo(0.0148167, 9);
    expect(ottRelease(0, 0.75)).toBeCloseTo((0.0148167 + 0.030877) / 2, 9);
    expect(ottRelease(2, 4)).toBeCloseTo(4 * 0.0103717, 9);
  });

  it("rounds its knees with a softplus", () => {
    expect(softKnee(0.5, -20)).toBeCloseTo(0, 6);
    expect(softKnee(0.5, 20)).toBeCloseTo(20, 6);
    expect(softKnee(0.5, 0)).toBeCloseTo(0.5 * Math.LN2, 9);
  });
});

describe("OTT's automation", () => {
  it("has every knob, with a taper and its value said", () => {
    const song = withOtt();
    for (const control of OTT_CONTROLS) {
      const spec = OTT_CONTROL_SPECS[control];
      const info = controlOf(song, { kind: "ott", effect: "fx_ott", control });
      expect(info.exists).toBe(true);
      expect(info.own).toBeCloseTo(spec.fromControl(spec.defaultValue), 9);
      for (const f of [0, 0.25, 0.5, 1]) expect(spec.fromControl(spec.toControl(f))).toBeCloseTo(f, 9);
      expect(OTT_LANES_OF[control].length).toBeGreaterThan(0);
    }
    // Time is 100% at 12 o'clock and 1000% at the end.
    expect(OTT_CONTROL_SPECS.time.toControl(0.5)).toBeCloseTo(1, 9);
    expect(OTT_CONTROL_SPECS.time.toControl(1)).toBe(10);
    expect(controlOf(song, { kind: "ott", effect: "fx_ott", control: "input" }).format(1)).toBe("+19.1 dB");
    expect(controlOf(song, { kind: "ott", effect: "fx_nope", control: "depth" })).toMatchObject({ exists: false, owner: "A deleted OTT" });
    expect(normalizeTarget({ kind: "ott", effect: "fx_ott", control: "midGain" })).toEqual({ kind: "ott", effect: "fx_ott", control: "midGain" });
    expect(normalizeTarget({ kind: "ott", effect: "fx_ott", control: "ratio" })).toBeNull();
  });

  it("sets a control in its own units", () => {
    const song = setOttControl(withOtt(), "fx_ott", "highThreshold", 1.5);
    expect(ott(song).bands[2].threshold).toBe(1.5);
    expect(ott(song).preset).toBeNull();
  });

  it("sends its automated controls as lanes in the engine's units", () => {
    let song = editClips(withOtt(), (clips) => addClips(clips, [{ kind: "pattern", ref: P, track: 0, start: 0, length: BAR * 2 }]).clips);
    const made = createAutomation(song, { kind: "ott", effect: "fx_ott", control: "depth" }, { start: 0, length: BAR }, { id: "auto_depth" });
    song = editPoints(made.song, "auto_depth", () => [
      { tick: 0, value: 0, tension: 0, curve: "single" },
      { tick: BAR, value: 1, tension: 0, curve: "single" },
    ]);
    const compiled = compileSong(song, P, null, "song");
    const track = compiled.tracks.findIndex((t) => t.id === "insert_1");
    expect(compiled.tracks[track].effects[0].ott).toEqual(engineOtt(DEFAULT_OTT));
    const lanes = compiled.lanes.filter((l) => l.target.kind === "ott");
    // Depth moves the makeups, the upward slopes and the downward amounts: three values a point (a band each).
    expect(lanes.map((l) => (l.target.kind === "ott" ? l.target.control : null)).sort()).toEqual(["downward", "makeup", "upward"]);
    const makeup = lanes.find((l) => l.target.kind === "ott" && l.target.control === "makeup")!;
    expect(makeup.values.slice(0, 3)).toEqual([0, 0, 0]);
    expect(makeup.values.slice(-3).map((v) => round(v, 3))).toEqual(OTT_LANES.makeup(engineOtt(DEFAULT_OTT)).map((v) => round(v, 3)));
    // Nothing automated, no lanes.
    expect(compileSong(withOtt(), P, null, "song").lanes).toEqual([]);
  });
});
