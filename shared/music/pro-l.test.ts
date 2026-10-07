import { describe, expect, it } from "vitest";
import { compileSong } from "./compile.ts";
import { setEffect } from "./mixer.ts";
import { DEFAULT_PRO_L, PRO_L_PLUGIN, PRO_L_STYLE_SPECS, attackFromTurn, normalizeProL, releaseFromTurn, turnFromAttack, turnFromRelease } from "./pro-l-presets.ts";
import { engineProL, findProL, updateProL } from "./pro-l.ts";
import { MASTER_TRACK_ID, createMusicProject, normalizeMusicProject } from "./project.ts";
import { PRO_L_STYLES } from "./types.ts";

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
