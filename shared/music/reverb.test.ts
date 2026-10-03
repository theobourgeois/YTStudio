import { describe, expect, it } from "vitest";
import { controlOf, createAutomation } from "./automation.ts";
import { compileSong } from "./compile.ts";
import { addChannels } from "./edits.ts";
import { routeChannels, setEffect, setSend } from "./mixer.ts";
import { addClips, editClips } from "./playlist.ts";
import { FIRST_PATTERN_ID, MASTER_TRACK_ID, createMusicProject, normalizeMusicProject, normalizeTarget } from "./project.ts";
import {
  INFINITE_T60,
  MAX_EARLY_TAPS,
  REVERB_CONTROL_SPECS,
  REVERB_LANES,
  REVERB_LANES_OF,
  addDecayBand,
  askedT60,
  bandMultiplier,
  chooseReverbPreset,
  copyReverbAB,
  decayCurve,
  editDecayBands,
  engineReverb,
  findReverb,
  keyConnected,
  noteSeconds,
  parseNote,
  pasteReverb,
  postCurve,
  predelaySeconds,
  reverbMixGains,
  reverbSeed,
  reverbT60,
  reverbs,
  setReverbControl,
  setReverbKey,
  shapeEnvelope,
  sizeScale,
  switchReverbAB,
  updateReverb,
} from "./reverb.ts";
import { KHZ_BAND, REVERB_MODE_SPECS, REVERB_OCTAVES, naturalCurve, plateCurve } from "./reverb-modes.ts";
import { DEFAULT_REVERB, INIT_REVERB, INSERT_MIX, REVERB_INFINITE, REVERB_PLUGIN, REVERB_PRESETS, normalizeReverb, reverbPresetState } from "./reverb-presets.ts";
import { type MusicProject, REVERB_CONTROLS, REVERB_MODES, type ReverbState } from "./types.ts";

const FX = "fx_verb";
/** A song at 120 BPM with a Reverb in Insert 1's first slot, a channel playing into Insert 1. */
function withReverb(): MusicProject {
  let song = addChannels(createMusicProject("Verb", 120), [{ id: "chan_vox", name: "Vox", sampleId: "s" }]);
  song = routeChannels(song, ["chan_vox"], "insert_1");
  return setEffect(song, "insert_1", 0, REVERB_PLUGIN, FX);
}
const verb = (song: MusicProject) => findReverb(song, FX)!.reverb;
const state = (patch: Partial<ReverbState> = {}): ReverbState => ({ ...INIT_REVERB, ...patch });

describe("the Reverb's settings", () => {
  it("is put on a channel's track at an insert's Mix with the vocal default, and on a bus fully wet with Mix locked", () => {
    const song = withReverb();
    expect(verb(song)).toEqual(DEFAULT_REVERB);
    expect(verb(song)).toMatchObject({ preset: "Vocal Plate", mix: INSERT_MIX, mixLock: false, mode: "smoothPlate" });
    expect(reverbs(song).map((r) => r.effect.id)).toEqual([FX]);
    const bus = setEffect(song, "insert_2", 0, REVERB_PLUGIN, "fx_bus");
    expect(findReverb(bus, "fx_bus")!.reverb).toMatchObject({ mix: 1, mixLock: true });
    // The master isn't a bus: a reverb there mustn't take the dry mix away.
    expect(findReverb(setEffect(song, MASTER_TRACK_ID, 0, REVERB_PLUGIN, "fx_m"), "fx_m")!.reverb.mix).toBe(INSERT_MIX);
  });

  it("survives a save and load, and repairs what's wrong", () => {
    let song = updateReverb(withReverb(), FX, { decay: 3.2, mode: "hall", ducking: { attack: 0.02 }, output: { lowShelf: { gain: -3 } } });
    song = addDecayBand(song, FX, { shape: "highShelf", frequency: 6000, multiplier: 0.5 }).song;
    expect(verb(normalizeMusicProject(JSON.parse(JSON.stringify(song))))).toEqual(verb(song));
    const repaired = normalizeReverb({ decay: 900, size: 4, mode: "nope", duck: 6, bands: [{ id: 9 }, { id: 2, multiplier: 99 }, { id: 2 }], view: { display: "x" } });
    expect(repaired).toMatchObject({ decay: REVERB_INFINITE, size: 1, mode: "smoothPlate", duck: 0, view: { display: "decay" } });
    expect(repaired.bands).toEqual([{ id: 2, enabled: true, shape: "bell", frequency: 1000, multiplier: 4, q: 1 }]);
    expect(normalizeReverb({ decay: 0.001 }).decay).toBe(0.1);
  });

  it("forgets its preset once the sound changes, not when only its window does", () => {
    let song = chooseReverbPreset(withReverb(), FX, "Ballad Hall");
    expect(verb(song)).toMatchObject({ preset: "Ballad Hall", mode: "hall", decay: 3.2 });
    song = updateReverb(song, FX, { view: { display: "shape" } });
    expect(verb(song).preset).toBe("Ballad Hall");
    song = updateReverb(song, FX, { decay: 3 });
    expect(verb(song).preset).toBeNull();
    expect(updateReverb(song, FX, { decay: 3 })).toBe(song);
    expect(updateReverb(song, "fx_none", { decay: 1 })).toBe(song);
  });

  it("has presets that are valid, named once, and leave Mix alone (but Rap Room's insert Mix, unless locked)", () => {
    expect(new Set(REVERB_PRESETS.map((p) => p.name)).size).toBe(REVERB_PRESETS.length);
    expect(REVERB_PRESETS.length).toBeGreaterThanOrEqual(30);
    for (const preset of REVERB_PRESETS) {
      const s = reverbPresetState(preset.name)!;
      expect(normalizeReverb(s)).toMatchObject(s);
    }
    let song = updateReverb(withReverb(), FX, { mix: 0.3 });
    song = chooseReverbPreset(song, FX, "Vocal Chamber");
    expect(verb(song).mix).toBe(0.3);
    song = chooseReverbPreset(song, FX, "Rap Room");
    expect(verb(song).mix).toBe(0.15);
    song = updateReverb(song, FX, { mix: 0.4, mixLock: true });
    song = chooseReverbPreset(song, FX, "Rap Room");
    expect(verb(song).mix).toBe(0.4);
  });

  it("sends every lead-vocal preset at least 20 ms after the voice below 187 BPM (Griesinger), its loudness level-matched", () => {
    for (const preset of REVERB_PRESETS.filter((p) => p.folder === "Lead Vocal")) expect(predelaySeconds(reverbPresetState(preset.name)!, 186)).toBeGreaterThanOrEqual(0.015);
    for (const preset of REVERB_PRESETS.filter((p) => p.folder === "Lead Vocal" && p.name !== "Rap Room" && p.name !== "80s Rap Plate")) expect(predelaySeconds(reverbPresetState(preset.name)!, 186)).toBeGreaterThanOrEqual(0.02);
  });

  it("swaps A and B (Mix kept while locked), copies one to the other, and pastes a whole sound", () => {
    let song = switchReverbAB(withReverb(), FX);
    expect(verb(song).slot).toBe("b");
    song = updateReverb(song, FX, { decay: 4 });
    song = switchReverbAB(song, FX);
    expect(verb(song)).toMatchObject({ slot: "a", decay: 1.8 });
    song = switchReverbAB(song, FX);
    expect(verb(song).decay).toBe(4);
    song = copyReverbAB(song, FX);
    expect(verb(song).other!.decay).toBe(4);
    song = updateReverb(song, FX, { mixLock: true, mix: 0.5 });
    song = pasteReverb(song, FX, state({ mode: "room", mix: 1 }));
    expect(verb(song)).toMatchObject({ mode: "room", mix: 0.5, preset: null });
  });

  it("edits its Decay EQ, at most six bands", () => {
    let song = withReverb();
    for (let i = 0; i < 6; i++) song = addDecayBand(song, FX, { frequency: 200 * (i + 1) }).song;
    expect(addDecayBand(song, FX, {}).id).toBeNull();
    song = editDecayBands(song, FX, [2, 3], (b) => ({ ...b, multiplier: 0.5 }));
    expect(verb(song).bands.filter((b) => b.multiplier === 0.5).map((b) => b.id)).toEqual([2, 3]);
    song = editDecayBands(song, FX, [1], null);
    expect(verb(song).bands.map((b) => b.id)).toEqual([2, 3, 4, 5, 6]);
  });
});

describe("the Reverb's ducking key from another track", () => {
  it("makes the 0% send it needs, in the same edit, and keys from it", () => {
    const song = setReverbKey(withReverb(), FX, "insert_2");
    expect(verb(song).ducking.key).toBe("insert_2");
    expect(song.mixer.tracks.find((t) => t.id === "insert_2")!.sends.find((s) => s.to === "insert_1")!.level).toBe(0);
    expect(keyConnected(song, FX)).toBe(true);
    // Compiled to the key's track index, which runs before this one.
    const compiled = compileSong(song, FIRST_PATTERN_ID);
    const track = compiled.tracks.find((t) => t.id === "insert_1")!;
    const key = track.effects[0].reverb!.duck.key;
    expect(compiled.tracks[key].id).toBe("insert_2");
  });

  it("refuses its own track and a loop", () => {
    const song = withReverb();
    expect(setReverbKey(song, FX, "insert_1")).toBe(song);
    const looped = setSend(song, "insert_1", "insert_2", 1);
    expect(setReverbKey(looped, FX, "insert_2")).toBe(looped);
  });
});

describe("how long each frequency rings", () => {
  it("makes Decay the RT60 at 1 kHz, the mode's natural curve around it", () => {
    for (const mode of REVERB_MODES.filter((m) => m !== "ambience")) {
      const t = reverbT60(state({ mode, decay: 1.8 }));
      expect(t[KHZ_BAND]).toBeCloseTo(1.8 * naturalCurve(mode, 1.8, 1000), 3);
      expect(t).toHaveLength(10);
    }
    // Smooth Plate's bass a little shorter than its mids (the M7's VOX Plate); Hall's longer.
    expect(reverbT60(state({ mode: "smoothPlate" }))[2]).toBeCloseTo(1.8 * 0.85, 2);
    expect(reverbT60(state({ mode: "hall", decay: 2 }))[2]).toBeCloseTo(2.4, 2);
  });

  it("follows the EMT 140's damper in Plate: the bass from shorter than the mids to far longer, the top held", () => {
    expect(plateCurve(1.05, 100)).toBeCloseTo(0.75 / 1.05, 3);
    expect(plateCurve(4, 100)).toBeCloseTo(10.2 / 4, 3);
    expect(plateCurve(2.15, 10000)).toBeCloseTo(1.2 / 2.15, 3);
    const open = reverbT60(state({ mode: "plate", decay: 4 }));
    expect(open[2]).toBeGreaterThan(open[KHZ_BAND] * 2);
    expect(Math.max(open[8], open[9])).toBeLessThanOrEqual(1.3 * Math.sqrt(10000 / 8000) + 1e-3);
  });

  it("shapes it by the Decay EQ's bands as multipliers, averaged over each octave, neighbours within ×2.5", () => {
    const shelf = state({ bands: [{ id: 1, enabled: true, shape: "highShelf", frequency: 4000, multiplier: 0.5, q: 1 }] });
    const t = reverbT60(shelf);
    const flat = reverbT60(state());
    expect(t[9] / flat[9]).toBeCloseTo(0.5, 1);
    expect(t[2] / flat[2]).toBeCloseTo(1, 2);
    expect(reverbT60({ ...shelf, bandsBypass: true })).toEqual(flat);
    // A narrow notch becomes as deep a dip as an octave band can make.
    const notch = state({ bands: [{ id: 1, enabled: true, shape: "notch", frequency: 1000, multiplier: 0.25, q: 8 }] });
    expect(askedT60(notch, 1000)).toBeCloseTo(0.45, 2);
    expect(reverbT60(notch)[KHZ_BAND]).toBeGreaterThan(0.9);
    // A cliff is kept to what the bands can make.
    const cliff = reverbT60(state({ bands: [{ id: 1, enabled: true, shape: "lowShelf", frequency: 300, multiplier: 4, q: 4 }, { id: 2, enabled: true, shape: "highShelf", frequency: 600, multiplier: 0.25, q: 4 }] }));
    for (let b = 1; b < cliff.length; b++) expect(Math.max(cliff[b] / cliff[b - 1], cliff[b - 1] / cliff[b])).toBeLessThanOrEqual(2.5 * 1.001);
    expect(bandMultiplier({ id: 1, enabled: false, shape: "bell", frequency: 1000, multiplier: 4, q: 1 }, 1000)).toBe(1);
  });

  it("holds the loop at ∞, and draws a curve through the bands", () => {
    expect(reverbT60(state({ decay: REVERB_INFINITE }))).toEqual(REVERB_OCTAVES.map(() => INFINITE_T60));
    const t = reverbT60(state({ mode: "hall", decay: 2.6 }));
    REVERB_OCTAVES.forEach((f, b) => expect(Math.abs(decayCurve(t, f) / t[b] - 1)).toBeLessThan(0.01));
    // Ambience: almost no tail, whatever Decay says.
    expect(Math.max(...reverbT60(state({ mode: "ambience", decay: 4 })))).toBeLessThanOrEqual(0.8 * 1.1);
    expect(decayCurve(t, 10)).toBe(t[0]);
  });

  it("draws the Post EQ: its cuts 3 dB down at their corners, a shelf half its gain at its corner, Studio's filters", () => {
    expect(postCurve(state({ lowCut: 200 }), 200)).toBeCloseTo(-3.01, 1);
    expect(postCurve(state({ highCut: 8000, highCutSlope: 24 }), 8000)).toBeCloseTo(-3.01, 1);
    expect(postCurve(state({ highCut: 8000, highCutSlope: 24 }), 16000)).toBeLessThan(-20);
    expect(postCurve(state({ output: { ...INIT_REVERB.output, highShelf: { frequency: 8000, gain: 6 } } }), 8000)).toBeCloseTo(3, 1);
    expect(postCurve(state({ output: { ...INIT_REVERB.output, studio: true } }), 1000)).toBeGreaterThan(-1);
    expect(postCurve(state(), 1000)).toBe(0);
  });
});

describe("what the engine plays", () => {
  it("wires each mode as its table says: Dattorro's plate, the doubled plate, the 16-line FDN", () => {
    const counts = Object.fromEntries(REVERB_MODES.map((mode) => [mode, engineReverb(state({ mode }), 120, 1).network]));
    expect(counts.plate.lines).toHaveLength(4);
    expect(counts.plate.diffusers).toHaveLength(4);
    expect(counts.plate.taps).toHaveLength(14);
    expect(counts.smoothPlate.lines).toHaveLength(8);
    expect(counts.smoothPlate.matrix).toBe("ring");
    for (const mode of ["room", "chamber", "hall", "ambience"] as const) {
      expect(counts[mode].lines).toHaveLength(16);
      expect(counts[mode].matrix).toBe("hadamard");
      expect(counts[mode].taps.length).toBeLessThanOrEqual(64);
    }
    // Plate's second all-passes follow the decay (Dattorro: "decay + 0.15, floor 0.25, ceiling 0.50").
    expect(engineReverb(state({ mode: "plate", decay: 0.3 }), 120, 1).network.lines[1].apGain).toBeCloseTo(0.25, 2);
    expect(engineReverb(state({ mode: "plate", decay: 5 }), 120, 1).network.lines[1].apGain).toBe(0.5);
  });

  it("lays the velvet taps out seeded (the same every time), within the cap, a sequence a side", () => {
    const a = engineReverb(state({ mode: "hall" }), 120, reverbSeed("fx_a"));
    const b = engineReverb(state({ mode: "hall" }), 120, reverbSeed("fx_a"));
    const c = engineReverb(state({ mode: "hall" }), 120, reverbSeed("fx_b"));
    expect(a.early.left).toEqual(b.early.left);
    expect(a.early.left).not.toEqual(c.early.left);
    expect(a.early.left).not.toEqual(a.early.right);
    expect(a.early.left.length / 3).toBeLessThanOrEqual(MAX_EARLY_TAPS);
    // Diffusion is the fraction of them that play.
    expect(engineReverb(state({ mode: "hall", diffusion: 1 }), 120, 1).early.density).toBeGreaterThan(a.early.density);
    // A plate has no early energy; Smooth Plate's goes only into the loop.
    expect(engineReverb(state({ mode: "plate" }), 120, 1).early.left).toEqual([]);
    expect(engineReverb(state({ mode: "smoothPlate" }), 120, 1).early.level).toBe(0);
    // A new Variation, a new pattern.
    expect(engineReverb(state({ mode: "hall", late: { ...INIT_REVERB.late, variation: 7 } }), 120, reverbSeed("fx_a")).early.left).not.toEqual(a.early.left);
  });

  it("turns a synced pre-delay into seconds at the tempo, times its Offset", () => {
    expect(noteSeconds({ note: 64, feel: "straight" }, 120)).toBeCloseTo(0.03125, 6);
    expect(noteSeconds({ note: 16, feel: "dotted" }, 120)).toBeCloseTo(0.1875, 6);
    expect(noteSeconds({ note: 8, feel: "triplet" }, 120)).toBeCloseTo(1 / 6, 6);
    const synced = state({ sync: true, predelayNote: { note: 16, feel: "straight" }, predelayOffset: 0.5 });
    expect(engineReverb(synced, 120, 1).predelay).toBeCloseTo(0.0625, 6);
    expect(engineReverb({ ...synced, sync: false, predelay: 0.04 }, 120, 1).predelay).toBe(0.04);
    expect(parseNote("1/8 dot")).toEqual({ note: 8, feel: "dotted" });
    expect(parseNote("1/16t")).toEqual({ note: 16, feel: "triplet" });
    expect(parseNote("1/3")).toBeNull();
  });

  it("mixes at equal power, and lowers Size's top as Decay shortens", () => {
    const { dry, wet } = reverbMixGains(0.5);
    expect(dry * dry + wet * wet).toBeCloseTo(1, 9);
    expect(reverbMixGains(1).dry).toBeCloseTo(0, 9);
    const big = sizeScale(state({ mode: "hall", size: 1, decay: 4 }));
    expect(big).toBeCloseTo(REVERB_MODE_SPECS.hall.scale[1], 6);
    expect(sizeScale(state({ mode: "hall", size: 1, decay: 0.4 }))).toBeLessThan(big / 2);
  });

  it("says its shape over time: the pre-delay gap, the early taps after it, the late build", () => {
    const shape = shapeEnvelope(state({ mode: "room", predelay: 0.03, distance: 0 }), 120, 3);
    expect(shape.predelay).toBe(0.03);
    expect(shape.early.length).toBeGreaterThan(10);
    expect(Math.min(...shape.early.map((e) => e.at))).toBeGreaterThanOrEqual(0.03);
    expect(shape.lateBuilt).toBeGreaterThan(shape.lateStart);
    expect(shapeEnvelope(state({ mode: "plate" }), 120).early).toEqual([]);
  });
});

describe("the Reverb's automation", () => {
  it("has specs that read and write every control, and targets that validate", () => {
    for (const control of REVERB_CONTROLS) {
      const spec = REVERB_CONTROL_SPECS[control];
      if (control !== "freeze" && control !== "monoBelow" && control !== "decay") expect(spec.fromControl(spec.toControl(0.37))).toBeCloseTo(0.37, 6);
      expect(normalizeTarget({ kind: "reverb", effect: "fx_v", control })).toEqual({ kind: "reverb", effect: "fx_v", control });
      expect(REVERB_LANES_OF[control].length).toBeGreaterThan(0);
      for (const lane of REVERB_LANES_OF[control]) expect(REVERB_LANES[lane]).toBeTruthy();
      expect(spec.get(spec.set(INIT_REVERB, spec.toControl(0.6)))).toBeCloseTo(spec.toControl(0.6), 6);
    }
    expect(REVERB_CONTROL_SPECS.decay.toControl(1)).toBe(REVERB_INFINITE);
    expect(REVERB_CONTROL_SPECS.decay.fromControl(REVERB_CONTROL_SPECS.decay.toControl(0.5))).toBeCloseTo(0.5, 6);
    expect(REVERB_CONTROL_SPECS.mix.toControl(0.5)).toBeCloseTo(0.25, 6);
    expect(normalizeTarget({ kind: "reverb", effect: "fx_v", control: "loud" })).toBeNull();
    expect(controlOf(withReverb(), { kind: "reverb", effect: FX, control: "decay" })).toMatchObject({ name: "Decay", exists: true });
    expect(setReverbControl(withReverb(), FX, "decay", 2.5)).not.toBe(withReverb());
  });

  it("compiles an automated Decay to the T60 lane, every band moved together", () => {
    let song = withReverb();
    song = editClips(song, (clips) => addClips(clips, [{ kind: "pattern", ref: FIRST_PATTERN_ID, track: 0, start: 0, length: 768 }]).clips);
    song = createAutomation(song, { kind: "reverb", effect: FX, control: "decay" }, { start: 0, length: 384 }, { id: "auto_d" }).song;
    const lanes = compileSong(song, FIRST_PATTERN_ID, null, "song").lanes.filter((l) => l.target.kind === "verb");
    expect(lanes.map((l) => (l.target as { control: string }).control)).toEqual(["t60"]);
    expect(lanes[0].values.length % 10).toBe(0);
  });

  it("is in the compiled song with its settings in the engine's units", () => {
    const compiled = compileSong(withReverb(), FIRST_PATTERN_ID);
    const effect = compiled.tracks.find((t) => t.id === "insert_1")!.effects[0];
    expect(effect.plugin.id).toBe(REVERB_PLUGIN.id);
    expect(effect.reverb!.t60[KHZ_BAND]).toBeCloseTo(1.8, 3);
    expect(effect.reverb!.mix.wet).toBeCloseTo(Math.sin((INSERT_MIX * Math.PI) / 2), 4);
  });
});
