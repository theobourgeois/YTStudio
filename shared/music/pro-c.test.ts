import { describe, expect, it } from "vitest";
import { controlOf, createAutomation } from "./automation.ts";
import { compileSong } from "./compile.ts";
import { setEffect } from "./mixer.ts";
import {
  PRO_C_CONTROL_SPECS,
  PRO_C_LANES,
  PRO_C_LANES_OF,
  addSidechainBand,
  autoGain,
  chooseProCPreset,
  copyProCAB,
  editSidechainBands,
  engineProC,
  feedbackReduction,
  findProC,
  kneeOver,
  limitRange,
  progressiveOver,
  proCs,
  setProCControl,
  setProCSidechain,
  sidechainConnected,
  staticCurve,
  styleSnap,
  switchProCAB,
  updateProC,
  voxCurve,
} from "./pro-c.ts";
import {
  DEFAULT_PRO_C,
  DEFAULT_PRO_C_STATE,
  PRO_C_GROUPS,
  PRO_C_PLUGIN,
  PRO_C_PRESETS,
  PRO_C_STYLE_INFO,
  VINTAGE_TIMES,
  dialOf,
  normalizeProC,
  proCPreset,
  ratioOf,
  secondsOfDial,
  slopeOf,
} from "./pro-c-presets.ts";
import { addClips, editClips } from "./playlist.ts";
import { FIRST_PATTERN_ID, createMusicProject, normalizeMusicProject, normalizeTarget } from "./project.ts";
import { type MusicProject, PRO_C_CONTROLS, PRO_C_STYLES, type ProCState } from "./types.ts";

const close = (v: number, digits = 6) => Math.round(v * 10 ** digits) / 10 ** digits;

/** A song with a Pro-C in Insert 1's first slot. */
function withProC(): MusicProject {
  return setEffect(createMusicProject("Squash", 120), "insert_1", 0, PRO_C_PLUGIN, "fx_c");
}
const proC = (song: MusicProject) => findProC(song, "fx_c")!.proC;
const state = (patch: Partial<ProCState> = {}): ProCState => ({ ...DEFAULT_PRO_C_STATE, ...patch });

describe("Pro-C's settings", () => {
  it("is put in a slot with its default (the Vocal style), and found", () => {
    const song = withProC();
    expect(proC(song)).toEqual(DEFAULT_PRO_C);
    expect(proC(song).style).toBe("vocal");
    expect(proCs(song).map((p) => p.effect.id)).toEqual(["fx_c"]);
    // Its default is its preset, whole.
    expect({ ...DEFAULT_PRO_C_STATE }).toEqual(proCPreset(DEFAULT_PRO_C.preset!));
  });

  it("survives a save and load, and repairs what's wrong", () => {
    const song = updateProC(withProC(), "fx_c", { style: "fet", threshold: -24, options: { allButtons: true }, sidechain: { level: 6 } });
    const loaded = normalizeMusicProject(JSON.parse(JSON.stringify(song)));
    expect(proC(loaded)).toEqual(proC(song));
    const repaired = normalizeProC({ style: "loud", threshold: 9, slope: 2, attack: -1, maxLookahead: 0.5, lookahead: 1, oversampling: 3, sidechain: { bands: [{ id: 9, shape: "bell" }, { id: 2, placement: "left" }] } });
    expect(repaired).toMatchObject({ style: "vocal", threshold: 0, slope: 1, attack: 0.000005, maxLookahead: 0.02, lookahead: 0.02, oversampling: 1 });
    // Band 9 is past the six; left becomes stereo.
    expect(repaired.sidechain.bands.map((b) => [b.id, b.placement])).toEqual([[2, "stereo"]]);
  });

  it("has a name, a group and a line for every style", () => {
    expect(PRO_C_GROUPS.flatMap((g) => g.styles).sort()).toEqual([...PRO_C_STYLES].sort());
    for (const style of PRO_C_STYLES) expect(PRO_C_STYLE_INFO[style].name.length).toBeGreaterThan(0);
  });

  it("forgets its preset once the sound changes, and loads one whole", () => {
    let song = chooseProCPreset(withProC(), "fx_c", "Vocal – FET Catch");
    expect(proC(song)).toMatchObject({ preset: "Vocal – FET Catch", style: "fet" });
    song = updateProC(song, "fx_c", { threshold: -25 });
    expect(proC(song).preset).toBeNull();
    expect(updateProC(song, "fx_c", { threshold: -25 })).toBe(song);
    // The view isn't the sound.
    expect(proC(updateProC(chooseProCPreset(song, "fx_c", "Vocal – FET Catch"), "fx_c", { view: { compact: true } })).preset).toBe("Vocal – FET Catch");
  });

  it("has presets that are valid and named", () => {
    expect(new Set(PRO_C_PRESETS.map((p) => p.name)).size).toBe(PRO_C_PRESETS.length);
    for (const preset of PRO_C_PRESETS) {
      const settings = proCPreset(preset.name)!;
      expect(settings).not.toBeNull();
      // A preset on its style keeps to its style's knobs.
      expect(styleSnap(settings, settings.style)).toEqual({});
    }
  });

  it("swaps A and B, and copies one to the other", () => {
    let song = updateProC(withProC(), "fx_c", { threshold: -30 });
    song = switchProCAB(song, "fx_c");
    expect(proC(song).slot).toBe("b");
    song = updateProC(song, "fx_c", { threshold: -10 });
    song = switchProCAB(song, "fx_c");
    expect(proC(song)).toMatchObject({ slot: "a", threshold: -30 });
    song = switchProCAB(song, "fx_c");
    expect(proC(song).threshold).toBe(-10);
    song = copyProCAB(song, "fx_c");
    expect(proC(song).other?.threshold).toBe(-10);
  });

  it("keeps a Vintage style to its unit's ratios and times", () => {
    let song = updateProC(withProC(), "fx_c", { style: "fet", slope: slopeOf(6), attack: 0.1, release: 3 });
    // 6:1 isn't a button: the nearest is 4:1 or 8:1; the times are the 1176's.
    expect([4, 8]).toContain(Math.round(ratioOf(proC(song).slope)));
    expect(proC(song).attack).toBe(0.0008);
    expect(proC(song).release).toBe(1.1);
    song = updateProC(song, "fx_c", { style: "diode609", attack: 0.004 });
    expect([0.003, 0.006]).toContain(proC(song).attack);
    expect([1.5, 2, 3, 4, 6]).toContain(Math.round(ratioOf(proC(song).slope) * 2) / 2);
  });

  it("reads a unit's dial both ways (the 1176's 7 is its fastest)", () => {
    const attack = VINTAGE_TIMES.fet!.attack;
    expect(secondsOfDial(attack, 7)).toBeCloseTo(0.00002, 9);
    expect(secondsOfDial(attack, 1)).toBeCloseTo(0.0008, 9);
    expect(dialOf(attack, secondsOfDial(attack, 3))).toBeCloseTo(3, 9);
  });

  it("edits its side chain bands, at most six", () => {
    let song = withProC();
    for (let i = 0; i < 5; i++) song = addSidechainBand(song, "fx_c", { shape: "bell", frequency: 1000 * (i + 1) }).song;
    expect(proC(song).sidechain.bands.map((b) => b.id)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(addSidechainBand(song, "fx_c", { shape: "bell" }).id).toBeNull();
    song = editSidechainBands(song, "fx_c", [3], (b) => ({ ...b, gain: 6 }));
    expect(proC(song).sidechain.bands.find((b) => b.id === 3)!.gain).toBe(6);
    song = editSidechainBands(song, "fx_c", [1, 2], null);
    expect(proC(song).sidechain.bands.map((b) => b.id)).toEqual([3, 4, 5, 6]);
  });
});

describe("Pro-C's side chain from another track", () => {
  /** Insert 1 has the Pro-C; Insert 2 is the kick. */
  const song0 = () => withProC();

  it("makes the 0% send it needs, in the same edit, and keys from it", () => {
    let song = song0();
    expect(sidechainConnected(song, "fx_c")).toBe(false);
    song = setProCSidechain(song, "fx_c", "insert_2");
    expect(proC(song).sidechain).toMatchObject({ trigger: "external", track: "insert_2" });
    expect(song.mixer.tracks.find((t) => t.id === "insert_2")!.sends).toContainEqual({ to: "insert_1", level: 0 });
    expect(sidechainConnected(song, "fx_c")).toBe(true);
    // The compiled song has the key's index (a track that runs first).
    const compiled = compileSong(song, FIRST_PATTERN_ID, null, "pattern");
    const ti = compiled.tracks.findIndex((t) => t.id === "insert_1");
    const ki = compiled.tracks.findIndex((t) => t.id === "insert_2");
    const effect = compiled.tracks[ti].effects.find((e) => e.id === "fx_c")!;
    expect(effect.proC!.sidechain).toMatchObject({ source: "external", key: ki });
    expect(ki).toBeLessThan(ti);
  });

  it("refuses its own track and a loop", () => {
    const song = song0();
    expect(setProCSidechain(song, "fx_c", "insert_1")).toBe(song);
    // Insert 1 sending to Insert 2 already: Insert 2 can't send back.
    const looped = setProCSidechain({ ...song, mixer: { ...song.mixer, tracks: song.mixer.tracks.map((t) => (t.id === "insert_1" ? { ...t, sends: [...t.sends, { to: "insert_2", level: 1 }] } : t)) } }, "fx_c", "insert_2");
    expect(proC(looped).sidechain.track).toBeNull();
  });
});

describe("Pro-C's curves", () => {
  it("has Giannoulis' soft knee, continuous across it", () => {
    expect(kneeOver(-10, 12)).toBe(0);
    expect(kneeOver(10, 12)).toBe(10);
    expect(kneeOver(0, 12)).toBeCloseTo(1.5, 9);
    for (let o = -8; o < 8; o += 0.01) expect(Math.abs(kneeOver(o + 0.001, 12) - kneeOver(o, 12))).toBeLessThan(0.0011);
    expect(kneeOver(3, 0)).toBe(3);
  });

  it("works out section 5.6's example", () => {
    const clean = state({ style: "clean", threshold: -20, slope: 0.75, knee: 12, range: 60, autoGain: false });
    expect(staticCurve(clean, -10)).toBeCloseTo(7.5, 9);
    expect(staticCurve(clean, -22)).toBeCloseTo(0.5, 9);
    expect(staticCurve(clean, -26)).toBe(0);
  });

  it("holds the reduction to Range, round its corner", () => {
    expect(limitRange(3, 12, 6)).toBe(3);
    expect(limitRange(40, 12, 6)).toBe(12);
    expect(limitRange(12, 12, 6)).toBeLessThan(12);
    const clean = state({ style: "clean", threshold: -40, slope: 1, knee: 0, range: 12 });
    expect(staticCurve(clean, 0)).toBe(12);
  });

  it("rises gradually in the progressive curve (the ratio climbing with level)", () => {
    const w = 5;
    const slope = (o: number) => (progressiveOver(o + 0.01, w) - progressiveOver(o, w)) / 0.01;
    expect(progressiveOver(-10, w)).toBe(0);
    expect(slope(0)).toBeLessThan(slope(5));
    expect(slope(5)).toBeLessThan(slope(20));
    expect(slope(40)).toBeCloseTo(1, 2);
  });

  it("settles a feedback loop at its ratio (k = R − 1)", () => {
    const curve = { kind: "standard" as const, threshold: -20, slope: 0.75, knee: 0, range: 60 };
    // 4:1 is a loop gain of 3: 20 dB over comes out 5 dB over.
    expect(feedbackReduction(curve, 3, 0)).toBeCloseTo(15, 6);
    expect(staticCurve(state({ style: "classic", threshold: -20, slope: 0.75, knee: 0 }), 0)).toBeCloseTo(15, 6);
  });

  it("gives Vocal a knee that widens as it works (∞:1, 2:1 at the threshold)", () => {
    const vocal = state({ style: "vocal", threshold: -20 });
    // Under its knee nothing; at the threshold about 2:1 (a slope of a half); far over, holding hard.
    expect(staticCurve(vocal, -27)).toBe(0);
    expect(staticCurve(vocal, -19.9) - staticCurve(vocal, -20.1)).toBeLessThan(0.2 * 0.65);
    expect(staticCurve(vocal, 0) / 20).toBeGreaterThan(0.6);
  });

  it("boosts below the threshold in Upward, never under its floor", () => {
    const up = state({ style: "upward", threshold: -30, slope: 0.5, knee: 0, range: 12 });
    expect(staticCurve(up, -20)).toBe(-0);
    expect(staticCurve(up, -40)).toBeCloseTo(-5, 9);
    expect(staticCurve(up, -100)).toBe(-0);
  });

  it("gives FET 76 a higher threshold at a higher ratio (the measured 1176)", () => {
    const at = (ratio: number) => engineProC(state({ style: "fet", threshold: -18, slope: slopeOf(ratio) })).curve.threshold;
    expect(at(4)).toBe(-18);
    expect(close(at(20) - at(4))).toBeCloseTo(9.1, 6);
    expect(engineProC(state({ style: "fet", options: { ...DEFAULT_PRO_C_STATE.options, allButtons: true } })).ballistics.attackDelay).toBeGreaterThan(0);
  });

  it("moves the Bus's threshold with its ratio, as the SSL's does", () => {
    const at = (ratio: number) => engineProC(state({ style: "bus", threshold: -20, slope: slopeOf(ratio) })).curve.threshold;
    expect(at(2)).toBeLessThan(at(4));
    expect(at(10)).toBeGreaterThan(at(4));
  });

  it("makes Vox's one fader a threshold, a ratio and a make-up", () => {
    expect(voxCurve(0)).toMatchObject({ threshold: 0, makeup: 0 });
    const deep = voxCurve(-24);
    expect(ratioOf(deep.slope)).toBeCloseTo(7, 6);
    expect(deep.makeup).toBeGreaterThan(5);
    const engine = engineProC(state({ style: "vox", threshold: -24, options: { ...DEFAULT_PRO_C_STATE.options, gate: -50, ceiling: -1 } }));
    expect(engine.gate).toMatchObject({ threshold: -50 });
    expect(engine.limiter).toMatchObject({ threshold: -1, attack: 0 });
  });

  it("guesses a make-up from the curve (half the reduction at 0 dBFS, less for a long attack)", () => {
    const fast = state({ style: "clean", threshold: -20, slope: 0.75, knee: 0, attack: 0.0001 });
    expect(autoGain(fast)).toBeCloseTo(7.5, 2);
    expect(autoGain({ ...fast, attack: 0.25 })).toBeLessThan(autoGain(fast));
    expect(engineProC(fast).makeup).toBeCloseTo(7.5, 2);
    expect(engineProC({ ...fast, autoGain: false }).makeup).toBe(0);
  });

  it("drives a Vintage unit by its Input, louder only when Output isn't linked", () => {
    const linked = engineProC(state({ style: "fet", threshold: -30 }));
    expect(linked.makeup).toBe(0);
    expect(linked.colour.drive).toBeCloseTo(10 ** (12 / 20), 9);
    const unlinked = engineProC(state({ style: "fet", threshold: -30, options: { ...DEFAULT_PRO_C_STATE.options, link: false } }));
    expect(unlinked.makeup).toBeCloseTo(12, 9);
  });

  it("gives every style an engine form", () => {
    for (const style of PRO_C_STYLES) {
      const e = engineProC(state({ style }));
      expect(Number.isFinite(e.curve.threshold)).toBe(true);
      expect(e.loop).toBeGreaterThanOrEqual(0);
      if (e.feedback) expect(e.loop).toBeGreaterThan(0);
    }
  });
});

describe("Pro-C's automation", () => {
  it("has specs that read and write every control, and targets that validate", () => {
    for (const control of PRO_C_CONTROLS) {
      const spec = PRO_C_CONTROL_SPECS[control];
      const v = spec.toControl(0.37);
      expect(spec.fromControl(v)).toBeCloseTo(0.37, 6);
      expect(normalizeTarget({ kind: "proC", effect: "fx_c", control })).toEqual({ kind: "proC", effect: "fx_c", control });
      expect(PRO_C_LANES_OF[control].length).toBeGreaterThan(0);
      for (const lane of PRO_C_LANES_OF[control]) expect(PRO_C_LANES[lane]).toBeTruthy();
    }
    expect(normalizeTarget({ kind: "proC", effect: "fx_c", control: "loud" })).toBeNull();
    const song = withProC();
    expect(controlOf(song, { kind: "proC", effect: "fx_c", control: "threshold" })).toMatchObject({ name: "Threshold", exists: true });
    expect(PRO_C_CONTROL_SPECS.dry.set(DEFAULT_PRO_C_STATE, -36).dry).toBeNull();
  });

  it("compiles an automated threshold to lanes in the engine's units (the make-up following it)", () => {
    let song = setProCControl(withProC(), "fx_c", "threshold", -20);
    song = editClips(song, (clips) => addClips(clips, [{ kind: "pattern", ref: FIRST_PATTERN_ID, track: 0, start: 0, length: 768 }]).clips);
    const made = createAutomation(song, { kind: "proC", effect: "fx_c", control: "threshold" }, { start: 0, length: 384 }, { id: "auto_t" });
    song = made.song;
    const lanes = compileSong(song, FIRST_PATTERN_ID, null, "song").lanes.filter((l) => l.target.kind === "comp");
    const controls = lanes.map((l) => (l.target as { control: string }).control).sort();
    expect(controls).toEqual(["makeup", "threshold"]);
  });
});
