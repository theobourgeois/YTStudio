import { describe, expect, it } from "vitest";
import { controlOf, createAutomation } from "./automation.ts";
import { compileSong } from "./compile.ts";
import { setEffect } from "./mixer.ts";
import { addClips, editClips } from "./playlist.ts";
import {
  DEFAULT_PRO_L,
  DEFAULT_PRO_L_METER,
  PRO_L_DELIVERY,
  PRO_L_PLUGIN,
  PRO_L_PRESETS,
  PRO_L_STYLE_SPECS,
  PRO_L_TOOL_CONTROLS,
  attackFromTurn,
  normalizeProL,
  normalizeProLState,
  releaseFromTurn,
  turnFromAttack,
  turnFromRelease,
} from "./pro-l-presets.ts";
import { PRO_L_CONTROL_SPECS, PRO_L_LANES, chooseProLPreset, copyProLAB, engineProL, findProL, setProLControl, switchProLAB, updateProL } from "./pro-l.ts";
import { FIRST_PATTERN_ID, MASTER_TRACK_ID, createMusicProject, normalizeMusicProject, normalizeTarget } from "./project.ts";
import { PRO_L_CONTROLS, PRO_L_STYLES } from "./types.ts";

const song = () => setEffect(createMusicProject("Loud", 140), MASTER_TRACK_ID, 0, PRO_L_PLUGIN, "fx_lim");

describe("YT-L's settings", () => {
  it("starts as Théo chose: Modern, a −0.1 dBFS sample-peak ceiling, the clipper off, 4x", () => {
    const proL = findProL(song(), "fx_lim")!.proL;
    expect(proL).toEqual(DEFAULT_PRO_L);
    expect(proL).toMatchObject({ style: "modern", output: -0.1, truePeak: false, clip: false, oversampling: 4 });
  });

  it("keeps a valid YT-L as it is and repairs anything else", () => {
    expect(normalizeProL(DEFAULT_PRO_L)).toEqual(DEFAULT_PRO_L);
    const repaired = normalizeProL({ style: "loud", gain: 99, output: 3, lookahead: 1, oversampling: 3, clipShape: "tube", hold: -1, sideFloor: -40, stereo: "x" });
    expect(repaired).toMatchObject({ style: "modern", gain: 30, output: 0, lookahead: 0.005, oversampling: 4, clipShape: "smooth", hold: 0, sideFloor: -18, stereo: "lr" });
    // Spit's Lookahead goes to 1 ms only.
    expect(normalizeProL({ ...DEFAULT_PRO_L, style: "spit", lookahead: 0.004 }).lookahead).toBe(0.001);
    expect(normalizeProL(null)).toEqual(DEFAULT_PRO_L);
  });

  it("survives a save and load", () => {
    const s = updateProL(song(), "fx_lim", { style: "aggressive", gain: 6, clip: true, clipShape: "fl", hold: 0.01 });
    const loaded = normalizeMusicProject(JSON.parse(JSON.stringify(s)));
    expect(findProL(loaded, "fx_lim")!.proL).toEqual(findProL(s, "fx_lim")!.proL);
  });

  it("edits return the same song when nothing changes, and forget the preset when the sound does", () => {
    const s = song();
    expect(updateProL(s, "fx_lim", { gain: 0 })).toBe(s);
    expect(updateProL(s, "fx_none", { gain: 3 })).toBe(s);
    const louder = updateProL(s, "fx_lim", { gain: 3 });
    expect(findProL(louder, "fx_lim")!.proL).toMatchObject({ gain: 3, preset: null });
  });

  it("reads Attack and Release as Pro-L 2's knobs do (its tapers, measured)", () => {
    expect(attackFromTurn(0.1)).toBeCloseTo(0.001, 6);
    expect(attackFromTurn(0.5)).toBeCloseTo(0.625, 6);
    expect(attackFromTurn(1)).toBe(10);
    expect(releaseFromTurn(0.5)).toBeCloseTo(0.8573, 3);
    expect(releaseFromTurn(0.9)).toBeCloseTo(5, 2);
    expect(releaseFromTurn(1)).toBe(10);
    for (const s of [0, 0.001, 0.275, 2, 10]) expect(attackFromTurn(turnFromAttack(s))).toBeCloseTo(s, 9);
    for (const s of [0, 0.01, 0.4, 5, 8, 10]) expect(releaseFromTurn(turnFromRelease(s))).toBeCloseTo(s, 6);
  });
});

describe("what the engine plays", () => {
  it("resolves every style, the ramp never shorter than the style's nor longer than its look-ahead", () => {
    for (const style of PRO_L_STYLES) {
      const spec = PRO_L_STYLE_SPECS[style];
      for (const lookahead of [0, 0.0001, 0.001, 0.005]) {
        const e = engineProL({ ...DEFAULT_PRO_L, style, lookahead });
        expect(e.lookahead).toBeGreaterThanOrEqual(Math.min(spec.ramp, spec.reserve + spec.range));
        expect(e.lookahead).toBeLessThanOrEqual(spec.reserve + spec.range);
        expect(e.reserve).toBe(spec.reserve);
      }
    }
  });

  it("keeps every release stage's strength at most 1, so more Gain is never quieter", () => {
    for (const style of PRO_L_STYLES) expect(PRO_L_STYLE_SPECS[style].releaseStage?.strength ?? 0).toBeLessThanOrEqual(1);
  });

  it("sends Auto Hold as −1, a set hold in seconds, the style's own when it has one", () => {
    expect(engineProL({ ...DEFAULT_PRO_L, style: "modern", hold: null }).hold).toBe(-1);
    expect(engineProL({ ...DEFAULT_PRO_L, style: "modern", hold: 0.012 }).hold).toBe(0.012);
    expect(engineProL({ ...DEFAULT_PRO_L, style: "bus", hold: null }).hold).toBe(0.015);
    expect(engineProL({ ...DEFAULT_PRO_L, style: "spit", hold: null }).hold).toBe(0);
  });

  it("is in the compiled song on the master's slot", () => {
    const compiled = compileSong(updateProL(song(), "fx_lim", { gain: 8 }), "pattern");
    const master = compiled.tracks.find((t) => t.id === MASTER_TRACK_ID)!;
    expect(master.effects[0].plugin.id).toBe("vaudio:pro-l");
    expect(master.effects[0].proL).toMatchObject({ gain: 8, ceiling: -0.1, oversampling: 4, truePeak: false, dither: 0 });
  });

  it("sends its dither's bit depth and noise shaping", () => {
    expect(engineProL({ ...DEFAULT_PRO_L, dither: 16, noiseShaping: "weighted" })).toMatchObject({ dither: 16, noiseShaping: "weighted" });
  });
});

describe("YT-L's presets, A/B and meter", () => {
  const proLOf = (s: ReturnType<typeof song>) => findProL(s, "fx_lim")!.proL;

  it("has presets whose settings are all valid, the default among them", () => {
    expect(PRO_L_PRESETS.map((p) => p.name)).toContain(DEFAULT_PRO_L.preset);
    expect(new Set(PRO_L_PRESETS.map((p) => p.name)).size).toBe(PRO_L_PRESETS.length);
    for (const preset of PRO_L_PRESETS) {
      const state = { ...normalizeProLState({}), ...preset.settings };
      expect(normalizeProLState(state), preset.name).toEqual(state);
    }
  });

  it("loads a preset over the default, its delivery settings only where it has them, its target with it", () => {
    let s = updateProL(song(), "fx_lim", { gain: 7, output: -0.5, truePeak: true, stereo: "ms" });
    s = chooseProLPreset(s, "fx_lim", "Master: Rock Punch");
    // No delivery settings of its own: the output and true peak stay; the rest is the preset's over the default.
    expect(proLOf(s)).toMatchObject({ preset: "Master: Rock Punch", style: "dynamic", gain: 0, stereo: "lr", output: -0.5, truePeak: true });
    s = chooseProLPreset(s, "fx_lim", "Master: Streaming −14");
    expect(proLOf(s)).toMatchObject({ output: -1, truePeak: true, meter: { target: -14 } });
    s = chooseProLPreset(s, "fx_lim", "CD Master");
    expect(proLOf(s)).toMatchObject({ dither: 16, oversampling: 8, meter: { target: -9 } });
  });

  it("keeps the delivery settings with Lock Output on", () => {
    let s = updateProL(song(), "fx_lim", { output: -2, truePeak: true, lockOutput: true });
    s = chooseProLPreset(s, "fx_lim", "Master: Rage / Hyperpop");
    const proL = proLOf(s);
    expect(proL).toMatchObject({ style: "aggressive", clip: true, output: -2, truePeak: true, preset: "Master: Rage / Hyperpop" });
    for (const key of PRO_L_DELIVERY) expect(proL[key]).toEqual({ ...DEFAULT_PRO_L, output: -2, truePeak: true }[key]);
  });

  it("switches and copies A/B, leaving the meter alone", () => {
    let s = updateProL(song(), "fx_lim", { gain: 4, meter: { target: -9 } });
    s = switchProLAB(s, "fx_lim");
    expect(proLOf(s)).toMatchObject({ slot: "b", gain: 4, meter: { target: -9 } });
    s = updateProL(s, "fx_lim", { gain: 10 });
    s = switchProLAB(s, "fx_lim");
    expect(proLOf(s)).toMatchObject({ slot: "a", gain: 4, other: { gain: 10 } });
    s = copyProLAB(s, "fx_lim");
    expect(proLOf(s).other).toMatchObject({ gain: 4 });
  });

  it("keeps the preset's name when only the meter or Lock Output changes", () => {
    const s = chooseProLPreset(song(), "fx_lim", "Master: Clean");
    expect(proLOf(updateProL(s, "fx_lim", { meter: { target: -16 }, lockOutput: true }))).toMatchObject({ preset: "Master: Clean", lockOutput: true, meter: { target: -16 } });
    expect(proLOf(updateProL(s, "fx_lim", { gain: 2 })).preset).toBeNull();
  });

  it("validates its meter settings", () => {
    expect(normalizeProL({ ...DEFAULT_PRO_L, meter: { scale: "99", target: -80, loudnessRange: 12, display: "fast" } }).meter).toEqual({ ...DEFAULT_PRO_L_METER, target: -40, display: "fast" });
  });
});

describe("YT-L's automation", () => {
  it("has specs that read and write every control, and targets that validate", () => {
    for (const control of PRO_L_CONTROLS) {
      const spec = PRO_L_CONTROL_SPECS[control];
      expect(spec.fromControl(spec.toControl(0.37)), control).toBeCloseTo(0.37, 6);
      expect(normalizeTarget({ kind: "proL", effect: "fx_lim", control })).toEqual({ kind: "proL", effect: "fx_lim", control });
      expect(PRO_L_LANES[control](engineProL(DEFAULT_PRO_L), DEFAULT_PRO_L)).toHaveLength(1);
    }
    expect(normalizeTarget({ kind: "proL", effect: "fx_lim", control: "lookahead" })).toBeNull();
    expect(controlOf(song(), { kind: "proL", effect: "fx_lim", control: "gain" })).toMatchObject({ name: "Gain", exists: true });
    expect(Object.values(PRO_L_TOOL_CONTROLS).sort()).toEqual([...PRO_L_CONTROLS].sort());
  });

  it("compiles an automated Gain to a limiter lane in dB", () => {
    let s = setProLControl(song(), "fx_lim", "gain", 6);
    s = editClips(s, (clips) => addClips(clips, [{ kind: "pattern", ref: FIRST_PATTERN_ID, track: 0, start: 0, length: 768 }]).clips);
    s = createAutomation(s, { kind: "proL", effect: "fx_lim", control: "gain" }, { start: 0, length: 384 }, { id: "auto_g" }).song;
    const lanes = compileSong(s, FIRST_PATTERN_ID, null, "song").lanes.filter((l) => l.target.kind === "limiter");
    expect(lanes.map((l) => (l.target as { control: string }).control)).toEqual(["gain"]);
    expect(lanes[0].values.length).toBeGreaterThan(0);
    for (const value of lanes[0].values) expect(value).toBeGreaterThanOrEqual(0);
    expect(lanes[0].values.every((v) => v <= 30)).toBe(true);
  });
});

