/**
 * Pro-C (`docs/fabfilter/pro-c.md`, `pro-c-vocals.md`): its edits, what each style means to the sound
 * (`engineProC`: the engine knows no style, only blocks and numbers), the static curve the knee display
 * draws (`staticCurve`), its Auto Gain, and its automatable controls. Pure and tested.
 *
 * The engine (`engine/src/ProC.cpp`) runs what's decided here: a key (the input, another track, or
 * pulses) through the side chain EQ to a detector (peak and RMS), a gain computer (the curves below),
 * ballistics (one of the release shapes), lookahead, then the gain, colour, make-up, dry and mix.
 */
import { clamp } from "../math.ts";
import { findEffect } from "./automation.ts";
import { setEffect } from "./mixer.ts";
import { canKey, setSidechain } from "./sidechain.ts";
import { type EngineEqBand } from "./pro-q.ts";
import { DEFAULT_BAND } from "./pro-q-presets.ts";
import {
  DIODE_ATTACKS,
  DIODE_RECOVERIES,
  PRO_C_ATTACK_RANGE,
  PRO_C_BANDS,
  PRO_C_GAIN_RANGE,
  PRO_C_MAX_EMPHASIS,
  PRO_C_MAX_HOLD,
  PRO_C_MAX_KNEE,
  PRO_C_MAX_MIX,
  PRO_C_MAX_RANGE,
  PRO_C_RELEASE_RANGE,
  PRO_C_THRESHOLD_RANGE,
  VINTAGE_RATIOS,
  VINTAGE_TIMES,
  isVintage,
  normalizeProC,
  normalizeProCState,
  DUCK_PRESET,
  PRO_C_PLUGIN,
  proCPreset,
  ratioOf,
  slopeOf,
} from "./pro-c-presets.ts";
import type { EqBand, MusicProject, ProC, ProCControl, ProCState, ProCStyle, SidechainTap } from "./types.ts";

// ---------------------------------------------------------------------------
// Finding and editing
// ---------------------------------------------------------------------------

/** A Pro-C of the song, by its effect's id: its track, slot and settings. */
export function findProC(song: MusicProject, effectId: string) {
  const found = findEffect(song, effectId);
  if (!found?.effect?.proC) return null;
  return { track: found.track, slot: found.track.effects.indexOf(found.effect), effect: found.effect, proC: found.effect.proC };
}

/** The song's Pro-Cs, each with its track. */
export function proCs(song: MusicProject) {
  return song.mixer.tracks.flatMap((track) => track.effects.flatMap((effect, slot) => (effect?.proC ? [{ track, slot, effect, proC: effect.proC }] : [])));
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
/** What's heard (not which preset is named, A/B's other side, or how the window shows it). */
const heard = (p: ProC): ProCState => normalizeProCState(p);
const soundChanged = (a: ProC, b: ProC) => !same(heard(a), heard(b));

/** Change a Pro-C (`change` returning equal settings: the same song). What it returns is validated. */
export function editProC(song: MusicProject, effectId: string, change: (proC: ProC) => ProC): MusicProject {
  const found = findProC(song, effectId);
  if (!found) return song;
  const changed = change(found.proC);
  if (changed === found.proC) return song;
  const next = normalizeProC(changed);
  if (same(next, found.proC)) return song;
  const effects = found.track.effects.map((e) => (e === found.effect ? { ...e, proC: next } : e));
  return { ...song, mixer: { ...song.mixer, tracks: song.mixer.tracks.map((t) => (t === found.track ? { ...t, effects } : t)) } };
}

export type ProCPatch = Partial<Omit<ProC, "options" | "sidechain" | "character" | "view" | "other" | "slot">> & {
  options?: Partial<ProC["options"]>;
  sidechain?: Partial<Omit<ProC["sidechain"], "sync">> & { sync?: Partial<ProC["sidechain"]["sync"]> };
  character?: Partial<ProC["character"]>;
  view?: Partial<ProC["view"]>;
};

/** Merge a patch into settings (nested parts merged, not replaced). */
export function patched(proC: ProC, patch: ProCPatch): ProC {
  const { options, sidechain, character, view, ...rest } = patch;
  return {
    ...proC,
    ...rest,
    options: options ? { ...proC.options, ...options } : proC.options,
    sidechain: sidechain ? { ...proC.sidechain, ...sidechain, sync: sidechain.sync ? { ...proC.sidechain.sync, ...sidechain.sync } : proC.sidechain.sync } : proC.sidechain,
    character: character ? { ...proC.character, ...character } : proC.character,
    view: view ? { ...proC.view, ...view } : proC.view,
  };
}

/** Change Pro-C's settings. A preset chosen stays named until the sound is changed; a style changed snaps its knobs to the style's. */
export function updateProC(song: MusicProject, effectId: string, patch: ProCPatch): MusicProject {
  return editProC(song, effectId, (proC) => {
    let next = patched(proC, patch);
    if (patch.style && patch.style !== proC.style) next = { ...next, ...styleSnap(next, patch.style) };
    else next = { ...next, ...styleSnap(next, next.style) };
    // Lookahead can't be more than its maximum.
    next = { ...next, lookahead: Math.min(next.lookahead, next.maxLookahead) };
    return patch.preset === undefined && soundChanged(proC, next) ? { ...next, preset: null } : next;
  });
}

/**
 * What a style keeps its knobs to (its own ratio positions and times): a Vintage style's knobs are its
 * unit's buttons and dials. Returns the fields that change.
 */
export function styleSnap(state: ProCState, style: ProCStyle): Partial<ProCState> {
  const out: Partial<ProCState> = {};
  const ratios = VINTAGE_RATIOS[style];
  if (ratios) {
    const ratio = ratioOf(state.slope);
    const nearest = ratios.reduce((a, b) => (Math.abs(Math.log(Math.min(ratio, 1e4)) - Math.log(Math.min(b.ratio, 1e4))) < Math.abs(Math.log(Math.min(ratio, 1e4)) - Math.log(Math.min(a.ratio, 1e4))) ? b : a));
    const slope = slopeOf(nearest.ratio);
    if (Math.abs(slope - state.slope) > 1e-9) out.slope = slope;
  }
  const times = VINTAGE_TIMES[style];
  if (times) {
    const attack = clamp(state.attack, times.attack.min, times.attack.max);
    const release = clamp(state.release, times.release.min, times.release.max);
    if (attack !== state.attack) out.attack = attack;
    if (release !== state.release) out.release = release;
  }
  if (style === "diode609") {
    const attack = nearestOf(DIODE_ATTACKS, state.attack);
    const release = nearestOf(DIODE_RECOVERIES, state.release);
    if (attack !== state.attack) out.attack = attack;
    if (release !== state.release) out.release = release;
  }
  if (style === "optoTube") {
    const slope = clamp(state.slope, slopeOf(2), slopeOf(10));
    if (slope !== state.slope) out.slope = slope;
  }
  return out;
}

const nearestOf = (list: readonly number[], value: number) => list.reduce((a, b) => (Math.abs(Math.log(b / value)) < Math.abs(Math.log(a / value)) ? b : a));

/** Load a preset (by name): everything it sets, the window's view and A/B kept. */
export function chooseProCPreset(song: MusicProject, effectId: string, name: string): MusicProject {
  const preset = proCPreset(name);
  return preset ? editProC(song, effectId, (proC) => ({ ...proC, ...preset, preset: name })) : song;
}

/** A/B: swap to the other state (the first switch copies this one there). */
export function switchProCAB(song: MusicProject, effectId: string): MusicProject {
  return editProC(song, effectId, (proC) => {
    const here = heard(proC);
    const there = proC.other ?? here;
    return { ...proC, ...there, other: here, slot: proC.slot === "a" ? "b" : "a" };
  });
}

/** A/B's Copy: this state to the other. */
export function copyProCAB(song: MusicProject, effectId: string): MusicProject {
  return editProC(song, effectId, (proC) => ({ ...proC, other: heard(proC) }));
}

// ---------------------------------------------------------------------------
// The side chain
// ---------------------------------------------------------------------------

/** The next free side chain band number (1..6), or null. */
export function freeSidechainBand(bands: readonly EqBand[]): number | null {
  for (let id = 1; id <= PRO_C_BANDS; id++) if (!bands.some((b) => b.id === id)) return id;
  return null;
}

/** Add a side chain band (a Pro-Q band's fields): its number, or null if there's no room. */
export function addSidechainBand(song: MusicProject, effectId: string, band: Partial<Omit<EqBand, "id">>): { song: MusicProject; id: number | null } {
  const found = findProC(song, effectId);
  const id = found ? freeSidechainBand(found.proC.sidechain.bands) : null;
  if (!found || id === null) return { song, id: null };
  const made: EqBand = { ...DEFAULT_BAND, ...band, id, dynamics: false, range: 0, threshold: null };
  return { song: updateProC(song, effectId, { sidechain: { bands: [...found.proC.sidechain.bands, made] } }), id };
}

/** Change side chain bands (by number), or remove them (`null`). */
export function editSidechainBands(song: MusicProject, effectId: string, ids: Iterable<number>, change: ((band: EqBand) => EqBand) | null): MusicProject {
  const wanted = new Set(ids);
  const found = findProC(song, effectId);
  if (!found) return song;
  const bands = change === null ? found.proC.sidechain.bands.filter((b) => !wanted.has(b.id)) : found.proC.sidechain.bands.map((b) => (wanted.has(b.id) ? { ...change(b), id: b.id } : b));
  return updateProC(song, effectId, { sidechain: { bands } });
}

/**
 * Key a Pro-C from another track: its slot's key (`setSidechain`, `docs/sidechain.md`), External on. No
 * send is made (a key orders the tracks itself). Refused (the same song) where it would make a loop, or the
 * track is the Pro-C's own. Null takes the key off (the trigger stays as it is: External then hears nothing).
 */
export function setProCSidechain(song: MusicProject, effectId: string, trackId: string | null, tap?: SidechainTap): MusicProject {
  if (!findProC(song, effectId)) return song;
  return setSidechain(song, effectId, trackId, tap);
}

/** Whether a Pro-C has a key to hear (External without one hears silence). */
export function sidechainConnected(song: MusicProject, effectId: string): boolean {
  return !!findProC(song, effectId)?.effect.sidechain;
}

/**
 * The quickest duck (`docs/sidechain.md`, "From the kick"): a Pro-C in `trackId`'s first free slot with
 * the *Sidechain – Duck to Kick* preset, keyed by `source`. Null when there's no free slot or the key
 * would make a loop.
 */
export function duckWithProC(song: MusicProject, source: string, trackId: string, effectId: string, tap?: SidechainTap): MusicProject | null {
  const track = song.mixer.tracks.find((t) => t.id === trackId);
  const slot = track?.effects.findIndex((e) => !e) ?? -1;
  if (!track || slot < 0 || !canKey(song, source, trackId)) return null;
  let next = setEffect(song, trackId, slot, PRO_C_PLUGIN, effectId);
  next = chooseProCPreset(next, effectId, DUCK_PRESET);
  return setProCSidechain(next, effectId, source, tap);
}

// ---------------------------------------------------------------------------
// What a style is, for the engine
// ---------------------------------------------------------------------------

/** The gain computer's curve (`staticCurve`), in dB. */
export interface EngineProCCurve {
  /**
   * standard: Giannoulis' soft knee at the slope; progressive: the slope reached gradually over about
   * twice `knee` above the threshold (the ratio rising with level: opto, diode, vari-mu); upward: a boost
   * below the threshold, faded out under a floor 40 dB lower; vocal: ∞:1 with a knee that widens as it works.
   */
  kind: "standard" | "progressive" | "upward" | "vocal";
  threshold: number;
  slope: number;
  knee: number;
  /** The most reduction (or boost). */
  range: number;
}

/** How the gain follows the curve. Seconds unless said. */
export interface EngineProCBallistics {
  attack: number;
  release: number;
  hold: number;
  /**
   * decoupled: Giannoulis' smooth decoupled peak detector on the gain reduction; second: its attack stage
   * as two poles (no overshoot, smoother); smoothstep: a release that starts slow and finishes fast (the
   * swell heard); dual: two decoupled followers, `dualWeight` of it at the release and the rest
   * `dualFactor` times slower (Nuke, the SSL's auto); rate: dbx's RMS law, the attack faster the bigger the
   * step and the release a constant dB/s; opto: the light and the cell (`EngineProC.opto`); fixMan: the
   * CL 1B's two detectors.
   */
  shape: "decoupled" | "second" | "smoothstep" | "dual" | "rate" | "opto" | "fixMan";
  /** Program dependency: after `programTime` of sustained compression the release is `program` times longer. */
  program: number;
  programTime: number;
  autoRelease: boolean;
  dualWeight: number;
  dualFactor: number;
  /** rate: dB/s of release, and whether the attack follows dbx's law (Auto) or `attack`. */
  rate: number;
  rateAttack: boolean;
  /** The first attack held back (the 1176's all buttons: a "reverse look-ahead"). */
  attackDelay: number;
}

/** The opto cell (`docs/fabfilter/pro-c.md` 5.13, 4.3): the light, then a fast part and a slow part with a memory. Seconds. */
export interface EngineProCOpto {
  light: number;
  fastRise: number;
  fastFall: number;
  slowRise: number;
  /** The slow part's fall: `slowFall` plus `memory` times how long and hard it's been lit (0..1). */
  slowFall: number;
  memory: number;
  /** The fast part's share. */
  split: number;
}

/** A style's own colour, after the gain: none, or a shaper whose drive rises with the reduction. */
export interface EngineProCColour {
  kind: "none" | "even" | "odd" | "tape" | "diode";
  /** How much at 0 dB of reduction, and how much more per dB of it (or, for diode, at its peak). */
  base: number;
  perDb: number;
  /** diode: where the distortion peaks (dB of reduction) and how wide the bell is. */
  peak: number;
  width: number;
  /** A high shelf (dB) that rises with the reduction (the 1176's tilt), reaching it at 6 dB. */
  tilt: number;
  /** The level into the shaper (linear): how hard the unit is driven. */
  drive: number;
}

/** The side chain as the engine runs it. */
export interface EngineProCSidechain {
  /** External hears its slot's key (`EngineEffect.key`; none: silence). */
  source: "internal" | "external" | "sync";
  /** Linear. */
  level: number;
  /** Its EQ, and the style's own detector filters, as Pro-Q's bands (placement stereo, mid or side). */
  bands: EngineEqBand[];
  /** Host Sync: the period in beats, and the pulse's length as a fraction of it. */
  syncBeats: number;
  syncLength: number;
}

/** A Pro-C as the engine plays it (`EngineEffect.proC`). Gains linear unless said. */
export interface EngineProC {
  /** Feedback: the detector hears the output (its loop gain `loop`), solved each sample so it's stable at any attack. */
  feedback: boolean;
  loop: number;
  /** The detector: its RMS share (0 peak .. 1 RMS) and window; "linear" smooths in the linear domain before the curve (Punch); "light" is the LA-2A's panel (no rectifier). */
  rms: number;
  rmsTime: number;
  detector: "log" | "linear" | "light";
  curve: EngineProCCurve;
  autoThreshold: boolean;
  ballistics: EngineProCBallistics;
  opto: EngineProCOpto | null;
  /** TTM: three bands (crossovers in Hz), each also boosting below `upward[b]` dB under the threshold, its times scaled. */
  ttm: { crossovers: [number, number]; upward: [number, number, number]; times: [number, number, number] } | null;
  /** Vox's gate (dB threshold; a 1:`ratio` expander below it, at most `range` dB), and a limiter at the end (Vox's ceiling, Diode 609's). */
  gate: { threshold: number; ratio: number; range: number } | null;
  limiter: { threshold: number; attack: number; release: number } | null;
  colour: EngineProCColour;
  /** Character: 0 off, 1 tube, 2 diode, 3 bright; its drive (linear gain into it), before or after the gain. */
  character: { mode: number; drive: number; post: boolean };
  /** The Distress's audio high-pass (after the colour), as bands. */
  post: EngineEqBand[];
  /** Opto 2A's emphasis (dB, a high shelf on the key), automatable. */
  emphasis: number;
  /** dB after the compression (Wet, Auto Gain and a Vintage style's unlinked drive in it); its mid / side balance. */
  makeup: number;
  wetPan: number;
  /** The dry sound added back (0 none), per side. */
  dry: [number, number];
  mix: number;
  input: [number, number];
  output: [number, number];
  /** 0..1 linked, then 0..1 on towards `linkMode`. */
  link: number;
  toward: number;
  linkMode: "mid" | "side" | "midToSide" | "sideToMid";
  sidechain: EngineProCSidechain;
  /** Seconds: how far ahead it looks, and the most it can (the latency). */
  lookahead: number;
  maxLookahead: number;
  oversampling: number;
}

const dbGain = (db: number) => 10 ** (db / 20);
/** A balance: each side's gain for a pan (-1..1). */
const balance = (gain: number, pan: number): [number, number] => [gain * Math.min(1, 1 - pan), gain * Math.min(1, 1 + pan)];

/** A side chain or post band, in the engine's form (Pro-Q's). */
const eqBand = (b: Pick<EqBand, "id" | "shape" | "frequency" | "gain" | "q" | "slope" | "placement">): EngineEqBand => ({
  id: b.id,
  shape: b.shape,
  frequency: b.frequency,
  gain: b.gain,
  q: b.q,
  slope: b.slope === "brickwall" ? 0 : b.slope,
  placement: b.placement,
  range: 0,
  threshold: null,
});
/** A style's own key filter, numbered past the user's. */
const fixed = (id: number, band: Partial<EqBand>) => eqBand({ ...DEFAULT_BAND, placement: "stereo", ...band, id: 100 + id });

/** A Vintage style's unit drives at Input 18 (the threshold the knob shows); more or less drives its colour and, unlinked, its level. */
const VINTAGE_REFERENCE = 18;

/** FET 76's threshold above 4:1's for each of its ratios (a measured 1176LN), and its knee. */
const FET_OFFSETS: Record<number, { offset: number; knee: number }> = { 4: { offset: 0, knee: 10 }, 8: { offset: 4.7, knee: 8 }, 12: { offset: 7.9, knee: 6 }, 20: { offset: 9.1, knee: 4 } };
/** Distress's curve per ratio position: its threshold offset, knee, whether the ratio keeps rising, and times. */
const DISTRESS: Record<string, { offset: number; knee: number; progressive: boolean; fast: boolean }> = {
  "1": { offset: 0, knee: 0, progressive: false, fast: false },
  "2": { offset: 0, knee: 15, progressive: true, fast: true },
  "3": { offset: 0, knee: 10, progressive: true, fast: true },
  "4": { offset: 2, knee: 6, progressive: true, fast: true },
  "6": { offset: 2, knee: 4, progressive: true, fast: false },
  "10": { offset: 0, knee: 5, progressive: true, fast: false },
  "20": { offset: 4, knee: 1, progressive: false, fast: false },
  nuke: { offset: 4, knee: 0, progressive: false, fast: false },
};
const distressKey = (slope: number) => {
  const ratio = ratioOf(slope);
  return !Number.isFinite(ratio) ? "nuke" : String(Math.round(ratio));
};
/** A feedback loop's gain for a ratio: `R - 1` (THAT's design note), capped (∞ is out of a feedback loop's reach). */
export const loopGain = (slope: number) => Math.min(30, slope >= 1 ? 30 : slope / (1 - slope));

const DEFAULT_BALLISTICS: Omit<EngineProCBallistics, "attack" | "release" | "hold" | "autoRelease"> = {
  shape: "decoupled",
  program: 2,
  programTime: 0.5,
  dualWeight: 1,
  dualFactor: 1,
  rate: 120,
  rateAttack: false,
  attackDelay: 0,
};
const NO_COLOUR: EngineProCColour = { kind: "none", base: 0, perDb: 0, peak: 0, width: 1, tilt: 0, drive: 1 };

/** The Vox style's fader as a curve: the ratio rises as it's pulled down (RVox's one fader), with its own make-up. */
export function voxCurve(compression: number) {
  const depth = Math.max(0, -compression);
  const ratio = Math.min(12, 1 + depth / 4);
  return { threshold: compression, slope: slopeOf(ratio), makeup: 0.6 * depth * (1 - 1 / ratio) };
}

/** What the engine plays for a Pro-C's settings. */
export function engineProC(p: ProCState): EngineProC {
  const style = p.style;
  const vintage = isVintage(style);
  const o = p.options;
  const attack = p.attack;
  const release = p.release;
  const userBands = p.sidechain.bands.filter((b) => b.enabled).map(eqBand);
  const styleBands: EngineEqBand[] = [];
  let curve: EngineProCCurve = { kind: "standard", threshold: p.threshold, slope: p.slope, knee: p.knee, range: p.range };
  let ballistics: EngineProCBallistics = { ...DEFAULT_BALLISTICS, attack, release, hold: p.hold, autoRelease: p.autoRelease };
  let feedback = false;
  let loop = 0;
  let rms = 0;
  let rmsTime = 0.005;
  let detector: EngineProC["detector"] = "log";
  let opto: EngineProCOpto | null = null;
  let ttm: EngineProC["ttm"] = null;
  let gate: EngineProC["gate"] = null;
  let limiter: EngineProC["limiter"] = null;
  let colour: EngineProCColour = NO_COLOUR;
  const post: EngineEqBand[] = [];
  let makeup = p.wet;
  let emphasis = 0;
  // A Vintage unit's drive: Input against its reference.
  const input = -p.threshold;
  const drive = vintage ? dbGain(input - VINTAGE_REFERENCE) : 1;
  if (vintage && !o.link) makeup += input - VINTAGE_REFERENCE;

  switch (style) {
    case "clean":
      break;
    case "versatile":
      rms = 0.3;
      ballistics = { ...ballistics, shape: attack < 0.005 ? "second" : "decoupled", program: 2.5 };
      break;
    case "smooth":
      rms = 0.7;
      rmsTime = 0.01;
      curve = { ...curve, knee: Math.max(6, p.knee) };
      ballistics = { ...ballistics, shape: "second", program: 3, attack: attack * 1.5, release: release * 1.5 };
      break;
    case "punch":
      rms = 0.2;
      rmsTime = 0.003;
      detector = "linear";
      break;
    case "upward":
      // Its boost hears an RMS level: sample by sample a waveform dips under its floor at every zero crossing.
      rms = 1;
      rmsTime = 0.01;
      curve = { ...curve, kind: "upward" };
      ballistics = { ...ballistics, program: 1 };
      break;
    case "ttm":
      rms = 0.5;
      rmsTime = 0.01;
      ttm = { crossovers: [90, 2500], upward: [30, 24, 30], times: [2, 1, 0.5] };
      ballistics = { ...ballistics, program: 1 };
      break;
    case "opEl":
      feedback = true;
      rms = 0.5;
      rmsTime = 0.01;
      curve = { ...curve, kind: "progressive", knee: Math.max(12, p.knee) / 2 };
      opto = { light: attack, fastRise: 0.005, fastFall: 0.02 * (release / 0.1) ** 0.5, slowRise: 0.005, slowFall: 0.2 * (release / 0.1) ** 0.5, memory: 1.8 * (release / 0.1) ** 0.5, split: 0.5 };
      ballistics = { ...ballistics, shape: "opto" };
      colour = { ...NO_COLOUR, kind: "odd", base: 0.002, perDb: 0.0002 };
      break;
    case "variMu":
      feedback = true;
      rms = 0.8;
      rmsTime = 0.02;
      curve = { ...curve, kind: "progressive", knee: 10, range: Math.min(p.range, 18) };
      ballistics = { ...ballistics, attack: attack * 0.3, program: 4 };
      colour = { ...NO_COLOUR, kind: "even", base: 0.001, perDb: 0.0008 };
      break;
    case "classic":
      feedback = true;
      rms = 0.4;
      ballistics = { ...ballistics, program: 4 };
      break;
    case "opto":
      rms = 0.5;
      rmsTime = 0.01;
      curve = { ...curve, knee: Math.max(18, p.knee) };
      opto = { light: attack * 3, fastRise: 0.005, fastFall: 0.02 * (release / 0.1) ** 0.5, slowRise: 0.005, slowFall: 0.2 * (release / 0.1) ** 0.5, memory: 1.8 * (release / 0.1) ** 0.5, split: 0.5 };
      ballistics = { ...ballistics, shape: "opto" };
      break;
    case "vocal":
      rms = 0.6;
      rmsTime = 0.008;
      curve = { ...curve, kind: "vocal", slope: 1 };
      ballistics = { ...ballistics, program: 3 };
      break;
    case "vox": {
      rms = 0.4;
      const v = voxCurve(p.threshold);
      curve = { kind: "standard", threshold: v.threshold, slope: v.slope, knee: 6, range: p.range };
      ballistics = { ...ballistics, attack: 0.001, release: 0.08, hold: 0, autoRelease: true, program: 3 };
      makeup += v.makeup;
      gate = o.gate === null ? null : { threshold: o.gate, ratio: 4, range: 40 };
      limiter = { threshold: o.ceiling, attack: 0, release: 0.06 };
      break;
    }
    case "mastering":
      ballistics = { ...ballistics, shape: "second", hold: Math.max(p.hold, 0.01) };
      break;
    case "bus": {
      // The SSL: the threshold moves with the ratio, the knee hardens with it; its Auto is two stacked networks (100 ms, 12 s).
      const ratio = Math.min(ratioOf(p.slope), 20);
      curve = { ...curve, threshold: p.threshold + 2.5 * Math.log2(ratio / 4), knee: clamp(6 - (ratio - 2) * 0.6, 0, 6) + Math.max(0, p.knee - 6) };
      ballistics = p.autoRelease ? { ...ballistics, shape: "dual", release: 0.1, dualWeight: 0.85, dualFactor: 120, autoRelease: false, program: 1 } : { ...ballistics, program: 2 };
      break;
    }
    case "pumping":
      ballistics = { ...ballistics, shape: "smoothstep", attack: attack * 0.5, program: 1, autoRelease: false };
      break;

    // The Vintage group: each one's unit (`docs/fabfilter/pro-c.md` 4).
    case "fet": {
      feedback = true;
      const ratio = Math.round(ratioOf(p.slope));
      const unit = FET_OFFSETS[ratio] ?? FET_OFFSETS[4];
      const all = o.allButtons;
      curve = { kind: "standard", threshold: p.threshold + (all ? 11 : unit.offset), slope: all ? slopeOf(16) : p.slope, knee: all ? 4 : unit.knee, range: p.range };
      loop = loopGain(curve.slope);
      // Its distortion grows with the reduction and the release's speed (fastest at 50 ms), worse all buttons in.
      const fast = clamp(Math.log(1.1 / release) / Math.log(1.1 / 0.05), 0, 1);
      colour = { ...NO_COLOUR, kind: "even", base: 0.0005, perDb: (0.0002 + 0.0006 * fast) * (all ? 6 : 1), tilt: 0.5, drive };
      ballistics = { ...ballistics, program: 2.5, programTime: 0.5, release: release * (all ? 1.5 : 1), attackDelay: all ? 0.0015 : 0, autoRelease: false };
      rms = 0;
      break;
    }
    case "opto2a": {
      feedback = true;
      detector = "light";
      curve = { kind: "progressive", threshold: p.threshold, slope: o.limit ? 0.97 : 0.85, knee: o.limit ? 2.5 : 5, range: p.range };
      emphasis = o.emphasis;
      // The panel lights more for highs.
      styleBands.push(fixed(1, { shape: "highShelf", frequency: 5000, gain: 3, q: 0.7, slope: 12 }));
      opto = { light: 0.002, fastRise: 0.01, fastFall: 0.02, slowRise: 0.5, slowFall: 0.2, memory: 1.8, split: 0.5 };
      ballistics = { ...ballistics, shape: "opto", autoRelease: false, hold: 0 };
      colour = { ...NO_COLOUR, kind: "odd", base: 0.002, perDb: 0.0006, drive };
      break;
    }
    case "optoTube": {
      rms = 0.5;
      rmsTime = 0.01;
      curve = { kind: "standard", threshold: p.threshold, slope: p.slope, knee: 10, range: p.range };
      if (o.timeMode === "fixed") ballistics = { ...ballistics, attack: 0.001, release: 0.05, program: 1, autoRelease: false };
      else if (o.timeMode === "fixMan") ballistics = { ...ballistics, shape: "fixMan", autoRelease: false };
      else {
        opto = { light: attack, fastRise: 0.003, fastFall: 0.05, slowRise: attack, slowFall: release * 0.6, memory: release * 0.8, split: 0.4 };
        ballistics = { ...ballistics, shape: "opto", autoRelease: false };
      }
      colour = { ...NO_COLOUR, kind: "odd", base: 0.001, perDb: 0.0001, drive };
      break;
    }
    case "distress": {
      feedback = true;
      const key = distressKey(p.slope);
      const unit = DISTRESS[key] ?? DISTRESS["4"];
      const nuke = key === "nuke";
      curve = { kind: unit.progressive ? "progressive" : "standard", threshold: p.threshold + unit.offset, slope: key === "1" ? 0 : p.slope, knee: unit.knee, range: p.range };
      loop = loopGain(curve.slope);
      ballistics = { ...ballistics, attack: unit.fast ? attack * 0.5 : attack, program: 2, autoRelease: false };
      if (nuke) ballistics = { ...ballistics, shape: "dual", dualWeight: 0.6, dualFactor: 8, program: 1 };
      if (key === "10") {
        opto = { light: Math.max(attack, 0.01), fastRise: 0.005, fastFall: 0.03, slowRise: 0.02, slowFall: release, memory: release * 5, split: 0.5 };
        ballistics = { ...ballistics, shape: "opto" };
      }
      if (o.british) ballistics = { ...ballistics, attackDelay: 0.0015, release: ballistics.release * 1.5 };
      if (o.detector === "hp" || o.detector === "hpBand") styleBands.push(fixed(1, { shape: "lowCut", frequency: 90, slope: 6 }));
      if (o.detector === "band" || o.detector === "hpBand") styleBands.push(fixed(2, { shape: "bell", frequency: 6000, gain: 6, q: 0.7 }));
      const dist2 = o.audio === "dist2" || o.audio === "dist2hp";
      const dist3 = o.audio === "dist3" || o.audio === "dist3hp";
      colour = dist3
        ? { ...NO_COLOUR, kind: "tape", base: 0.01, perDb: 0.008, drive }
        : dist2
          ? { ...NO_COLOUR, kind: "even", base: 0.006, perDb: 0.0025, drive }
          : { ...NO_COLOUR, kind: "even", base: 0.0005, perDb: 0.0002, drive };
      if (o.british) colour = { ...colour, perDb: colour.perDb * 4 };
      if (o.audio === "hp" || o.audio === "dist2hp" || o.audio === "dist3hp") post.push(fixed(3, { shape: "lowCut", frequency: 80, slope: 18 }));
      break;
    }
    case "vca160": {
      rms = 1;
      rmsTime = 0.003;
      curve = { kind: "standard", threshold: p.threshold, slope: p.slope, knee: o.overEasy ? 10 : 0, range: p.range };
      ballistics = o.auto ? { ...ballistics, shape: "rate", rate: 120, rateAttack: true, program: 1, autoRelease: false } : { ...ballistics, shape: "rate", rate: 20 / release, rateAttack: false, program: 1, autoRelease: false };
      colour = { ...NO_COLOUR, kind: "even", base: 0.0005, perDb: 0, drive: 1 };
      break;
    }
    case "diode609": {
      feedback = true;
      rms = 0.3;
      curve = { kind: "progressive", threshold: p.threshold, slope: p.slope, knee: 3, range: p.range };
      loop = loopGain(curve.slope);
      const slow = attack > 0.0045;
      if (slow) styleBands.push(fixed(1, { shape: "lowCut", frequency: 100, slope: 6 }));
      ballistics =
        o.recovery === "a1"
          ? { ...ballistics, release: 0.1, program: 20, programTime: 0.5, autoRelease: false }
          : o.recovery === "a2"
            ? { ...ballistics, release: 0.05, program: 100, programTime: 0.7, autoRelease: false }
            : { ...ballistics, program: 1.5, autoRelease: false };
      limiter = o.limiter === null ? null : { threshold: o.limiter, attack: 0.002, release: 0.1 };
      colour = { ...NO_COLOUR, kind: "diode", base: 0.0003, perDb: 0.012, peak: 5, width: 4, drive };
      break;
    }
  }

  // An opto cell is the timing: in a feedback loop its lags (light, fast and slow parts) would ring at a
  // high loop gain, so opto styles run feedforward at the loop's ratio (the same static curve at a hard knee).
  if (ballistics.shape === "opto") {
    feedback = false;
    loop = 0;
  }
  if (feedback && loop === 0) loop = loopGain(curve.slope);
  if (p.autoGain && !vintage && style !== "vox") makeup += autoGain(p);

  const link = clamp(p.sidechain.link, 0, 2);
  const s = p.sidechain;
  const maxLookahead = p.maxLookahead;
  return {
    feedback,
    loop,
    rms,
    rmsTime,
    detector,
    curve,
    autoThreshold: p.autoThreshold,
    ballistics,
    opto,
    ttm,
    gate,
    limiter,
    colour,
    character: { mode: ["off", "tube", "diode", "bright"].indexOf(p.character.mode), drive: dbGain(p.character.drive * 24), post: p.character.post },
    post,
    emphasis,
    makeup,
    wetPan: p.wetPan,
    dry: p.dry === null ? [0, 0] : balance(dbGain(p.dry), p.dryPan),
    mix: p.mix,
    input: balance(dbGain(p.input), p.inputPan),
    output: balance(dbGain(p.output), p.outputPan),
    link: Math.min(1, link),
    toward: Math.max(0, link - 1),
    linkMode: s.linkMode,
    sidechain: {
      source: s.trigger,
      level: dbGain(s.level),
      bands: [...userBands, ...styleBands],
      syncBeats: (4 / s.sync.note) * s.sync.offset,
      syncLength: s.sync.length,
    },
    lookahead: Math.min(p.lookahead, maxLookahead),
    maxLookahead,
    oversampling: p.oversampling,
  };
}

// ---------------------------------------------------------------------------
// The static curve: what the knee display draws, and what the engine's gain computer does
// ---------------------------------------------------------------------------

/** Giannoulis' soft knee as gain reduction, slope 1 above it: 0 below `-W/2`, `o` (less nothing) well above. */
export function kneeOver(o: number, width: number): number {
  if (width <= 0) return Math.max(0, o);
  if (o <= -width / 2) return 0;
  if (o >= width / 2) return o;
  return ((o + width / 2) * (o + width / 2)) / (2 * width);
}

/** The progressive curve's rise: its slope grows from 0 to 1 over about `2W` above `-W/2`. */
export function progressiveOver(o: number, width: number): number {
  const w = Math.max(0.5, width);
  const x = Math.max(0, o + w / 2);
  return x - w * (1 - Math.exp(-x / w));
}

/** Range's corner: the reduction held to `range`, rounded over `Wg`. */
export function limitRange(gr: number, range: number, width: number): number {
  const wg = Math.max(1, Math.min(width, range));
  if (gr <= range - wg / 2) return gr;
  if (gr >= range + wg / 2) return range;
  return range - (range + wg / 2 - gr) ** 2 / (2 * wg);
}

/** The vocal curve's knee (dB) after `average` dB of compression (`docs/fabfilter/pro-c.md` 5.4). */
export const vocalKnee = (average: number) => clamp(12 + 1.5 * average, 12, 30);

/** The gain reduction (dB, positive down; negative is a boost) for a level, as the gain computer works it out (feedforward). */
export function curveReduction(curve: EngineProCCurve, level: number, vocalAverage = 0): number {
  const o = level - curve.threshold;
  switch (curve.kind) {
    case "standard":
      return limitRange(curve.slope * kneeOver(o, curve.knee), curve.range, curve.knee);
    case "progressive":
      return limitRange(curve.slope * progressiveOver(o, curve.knee), curve.range, curve.knee);
    case "vocal": {
      const knee = vocalKnee(vocalAverage);
      return limitRange(kneeOver(o, knee), curve.range, knee);
    }
    case "upward": {
      // A boost below the threshold at the slope, at most `range`, faded out over the 12 dB above a floor 40 dB under it.
      const boost = Math.min(curve.range, curve.slope * kneeOver(-o, curve.knee));
      const floor = curve.threshold - 40;
      const fade = clamp((level - floor) / 12, 0, 1);
      return -boost * fade;
    }
  }
}

/** A feedback loop's law: the reduction it asks for when its output is `out` dB (`k · f(out − threshold)`, the shape's slope 1, held to Range). */
export function feedbackLaw(curve: EngineProCCurve, loop: number, out: number): number {
  const o = out - curve.threshold;
  const shaped = curve.kind === "progressive" ? progressiveOver(o, curve.knee) : kneeOver(o, curve.knee);
  return limitRange(loop * shaped, curve.range, curve.knee);
}

/** The reduction a feedback loop settles at: `GR = law(level − GR)`, solved by bisection (the engine solves the same each sample). */
export function feedbackReduction(curve: EngineProCCurve, loop: number, level: number): number {
  let low = 0;
  let high = Math.max(0, level - curve.threshold + curve.knee) + 1;
  for (let i = 0; i < 60; i++) {
    const mid = (low + high) / 2;
    if (feedbackLaw(curve, loop, level - mid) > mid) low = mid;
    else high = mid;
  }
  return (low + high) / 2;
}

/**
 * The static curve: the gain reduction (dB) a steady level (dB) gets once it's settled. The knee display
 * draws `level - reduction + makeup`; the tests hold the engine to it.
 */
export function staticReduction(engine: Pick<EngineProC, "curve" | "feedback" | "loop">, level: number): number {
  if (engine.feedback && engine.curve.kind !== "upward") return feedbackReduction(engine.curve, engine.loop, level);
  if (engine.curve.kind === "vocal") {
    // Its knee widens with the compression: the steady curve is the fixed point.
    let gr = curveReduction(engine.curve, level, 0);
    for (let i = 0; i < 40; i++) gr = curveReduction(engine.curve, level, gr);
    return gr;
  }
  return curveReduction(engine.curve, level);
}

/** A Pro-C's static curve at a level (dB in → dB of reduction). */
export const staticCurve = (p: ProCState, level: number) => staticReduction(engineProC(p), level);

/**
 * Auto Gain: Pro-C's "educated guess" (it never measures, so it never pumps): half the reduction a 0 dBFS
 * level would get, less for a long attack (which lets more through).
 */
export function autoGain(p: ProCState): number {
  if (p.style === "upward" || p.style === "ttm") return 0;
  const engine = engineProC({ ...p, autoGain: false });
  const atZero = staticReduction(engine, 0);
  const a = 1 - 0.3 * clamp(Math.log(p.attack / 0.0001) / Math.log(2500), 0, 1);
  return Math.round(0.5 * atZero * a * 100) / 100;
}

/** The latency (samples at a rate): the most lookahead, and the oversampling filters' (`oversamplingLatency`, the engine's). */
export const lookaheadSamples = (p: ProCState, rate: number) => Math.round(p.maxLookahead * rate);

// ---------------------------------------------------------------------------
// Automation
// ---------------------------------------------------------------------------

/** What an automation lane of Pro-C's sets in the engine (`EngineLaneTarget` "comp"): its values, from the settings at a moment. */
export const PRO_C_LANES = {
  threshold: (e: EngineProC) => [e.curve.threshold],
  slope: (e: EngineProC) => [e.curve.slope, e.loop],
  knee: (e: EngineProC) => [e.curve.knee],
  range: (e: EngineProC) => [e.curve.range],
  attack: (e: EngineProC) => [e.ballistics.attack],
  release: (e: EngineProC) => [e.ballistics.release],
  hold: (e: EngineProC) => [e.ballistics.hold],
  makeup: (e: EngineProC) => [e.makeup],
  dry: (e: EngineProC) => e.dry,
  mix: (e: EngineProC) => [e.mix],
  level: (e: EngineProC) => [e.sidechain.level],
  drive: (e: EngineProC) => [e.character.drive],
  input: (e: EngineProC) => e.input,
  output: (e: EngineProC) => e.output,
  emphasis: (e: EngineProC) => [e.emphasis],
} as const;
export type ProCLane = keyof typeof PRO_C_LANES;

/** Which engine lanes each automatable control moves (the make-up too, where Auto Gain follows it). */
export const PRO_C_LANES_OF: Record<ProCControl, readonly ProCLane[]> = {
  threshold: ["threshold", "makeup"],
  ratio: ["slope", "makeup", "knee", "threshold"],
  knee: ["knee", "makeup"],
  range: ["range", "makeup"],
  attack: ["attack", "makeup"],
  release: ["release"],
  hold: ["hold"],
  wet: ["makeup"],
  dry: ["dry"],
  mix: ["mix"],
  sidechainLevel: ["level"],
  drive: ["drive"],
  input: ["input"],
  output: ["output"],
  emphasis: ["emphasis"],
};

/** An automatable control: as OTT's (`OttControlSpec`). */
export interface ProCControlSpec {
  name: string;
  get: (p: ProCState) => number;
  set: (p: ProCState, value: number) => ProCState;
  toControl: (fraction: number) => number;
  fromControl: (value: number) => number;
  defaultValue: number;
  format: (value: number) => string;
}

const linear = (min: number, max: number) => ({ toControl: (f: number) => min + clamp(f, 0, 1) * (max - min), fromControl: (v: number) => clamp((v - min) / (max - min), 0, 1) });
const logTaper = (min: number, max: number) => ({
  toControl: (f: number) => min * (max / min) ** clamp(f, 0, 1),
  fromControl: (v: number) => clamp(Math.log(Math.max(v, min) / min) / Math.log(max / min), 0, 1),
});
const db = (v: number) => `${v > 0 ? "+" : ""}${v.toFixed(1)} dB`;
/** Milliseconds or seconds, as Pro-C shows a time. */
export const formatTime = (seconds: number) => (seconds < 0.001 ? `${(seconds * 1000).toFixed(3)} ms` : seconds < 0.01 ? `${(seconds * 1000).toFixed(2)} ms` : seconds < 1 ? `${(seconds * 1000).toFixed(seconds < 0.1 ? 1 : 0)} ms` : `${seconds.toFixed(2)} s`);
/** A ratio said: "4.0:1", "∞:1". */
export const formatRatio = (slope: number) => {
  const r = ratioOf(slope);
  return Number.isFinite(r) ? `${r < 10 ? r.toFixed(1) : Math.round(r)}:1` : "∞:1";
};
/** The ratio knob's taper: along the slope, so 4:1 sits three quarters of the way and ∞ at the end. */
const ratioTaper = { toControl: (f: number) => clamp(f, 0, 1), fromControl: (v: number) => clamp(v, 0, 1) };
/** Dry's knob: off at its bottom. */
const DRY_OFF = PRO_C_GAIN_RANGE[0];

export const PRO_C_CONTROL_SPECS: Record<ProCControl, ProCControlSpec> = {
  threshold: { name: "Threshold", get: (p) => p.threshold, set: (p, threshold) => ({ ...p, threshold }), ...linear(PRO_C_THRESHOLD_RANGE[0], PRO_C_THRESHOLD_RANGE[1]), defaultValue: -18, format: db },
  ratio: { name: "Ratio", get: (p) => p.slope, set: (p, slope) => ({ ...p, slope }), ...ratioTaper, defaultValue: 0.75, format: formatRatio },
  knee: { name: "Knee", get: (p) => p.knee, set: (p, knee) => ({ ...p, knee }), ...linear(0, PRO_C_MAX_KNEE), defaultValue: 6, format: (v) => `${v.toFixed(1)} dB` },
  range: { name: "Range", get: (p) => p.range, set: (p, range) => ({ ...p, range }), ...linear(0, PRO_C_MAX_RANGE), defaultValue: 40, format: (v) => `${v.toFixed(1)} dB` },
  attack: { name: "Attack", get: (p) => p.attack, set: (p, attack) => ({ ...p, attack }), ...logTaper(PRO_C_ATTACK_RANGE[0], PRO_C_ATTACK_RANGE[1]), defaultValue: 0.005, format: formatTime },
  release: { name: "Release", get: (p) => p.release, set: (p, release) => ({ ...p, release }), ...logTaper(PRO_C_RELEASE_RANGE[0], PRO_C_RELEASE_RANGE[1]), defaultValue: 0.1, format: formatTime },
  hold: { name: "Hold", get: (p) => p.hold, set: (p, hold) => ({ ...p, hold }), ...linear(0, PRO_C_MAX_HOLD), defaultValue: 0, format: formatTime },
  wet: { name: "Wet Gain", get: (p) => p.wet, set: (p, wet) => ({ ...p, wet }), ...linear(PRO_C_GAIN_RANGE[0], PRO_C_GAIN_RANGE[1]), defaultValue: 0, format: db },
  dry: {
    name: "Dry Gain",
    get: (p) => p.dry ?? DRY_OFF,
    set: (p, v) => ({ ...p, dry: v <= DRY_OFF + 1e-9 ? null : v }),
    ...linear(DRY_OFF, PRO_C_GAIN_RANGE[1]),
    defaultValue: DRY_OFF,
    format: (v) => (v <= DRY_OFF + 1e-9 ? "Off" : db(v)),
  },
  mix: { name: "Mix", get: (p) => p.mix, set: (p, mix) => ({ ...p, mix }), ...linear(0, PRO_C_MAX_MIX), defaultValue: 1, format: (v) => `${Math.round(v * 100)}%` },
  sidechainLevel: {
    name: "Side Chain Level",
    get: (p) => p.sidechain.level,
    set: (p, level) => ({ ...p, sidechain: { ...p.sidechain, level } }),
    ...linear(PRO_C_GAIN_RANGE[0], PRO_C_GAIN_RANGE[1]),
    defaultValue: 0,
    format: db,
  },
  drive: { name: "Drive", get: (p) => p.character.drive, set: (p, drive) => ({ ...p, character: { ...p.character, drive } }), ...linear(0, 1), defaultValue: 0.3, format: (v) => `${Math.round(v * 100)}%` },
  input: { name: "Input", get: (p) => p.input, set: (p, input) => ({ ...p, input }), ...linear(PRO_C_GAIN_RANGE[0], PRO_C_GAIN_RANGE[1]), defaultValue: 0, format: db },
  output: { name: "Output", get: (p) => p.output, set: (p, output) => ({ ...p, output }), ...linear(PRO_C_GAIN_RANGE[0], PRO_C_GAIN_RANGE[1]), defaultValue: 0, format: db },
  emphasis: {
    name: "Emphasis",
    get: (p) => p.options.emphasis,
    set: (p, emphasis) => ({ ...p, options: { ...p.options, emphasis } }),
    ...linear(0, PRO_C_MAX_EMPHASIS),
    defaultValue: 0,
    format: (v) => `${v.toFixed(1)} dB`,
  },
};

/** Set a Pro-C's control to a value in its own units (a knob turned, an assistant's edit). */
export const setProCControl = (song: MusicProject, effectId: string, control: ProCControl, value: number) =>
  editProC(song, effectId, (proC) => {
    const next = { ...proC, ...PRO_C_CONTROL_SPECS[control].set(proC, value) };
    const snapped = { ...next, ...styleSnap(next, next.style) };
    return soundChanged(proC, snapped) ? { ...snapped, preset: null } : proC;
  });
