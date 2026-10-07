/**
 * YT-L (`docs/fabfilter/pro-l.md`): its edits, and what each style means to the sound (`engineProL`: the engine
 * knows no style, only the numbers here). Pure and tested.
 *
 * The engine (`engine/src/ProL.cpp`) runs what's decided here: the gain, an oversampled look-ahead limiter (a
 * main stage that guarantees the ceiling, a bass stage and a release stage that only lower it further), then a
 * sample-peak catch or two true peak passes at the song's rate.
 */
import { clamp } from "../math.ts";
import { findEffect } from "./automation.ts";
import {
  DEFAULT_PRO_L_STATE,
  FL_CLIP_KNEE,
  PRO_L_DELIVERY,
  PRO_L_GAIN_RANGE,
  PRO_L_MAX_CLIP_KNEE,
  PRO_L_MAX_CLIP_RANGE,
  PRO_L_MAX_HOLD,
  PRO_L_OUTPUT_RANGE,
  PRO_L_SIDE_FLOOR_RANGE,
  PRO_L_STYLE_SPECS,
  attackFromTurn,
  normalizeProL,
  normalizeProLState,
  proLPreset,
  releaseFromTurn,
  turnFromAttack,
  turnFromRelease,
} from "./pro-l-presets.ts";
import type { MusicProject, ProL, ProLControl, ProLMeter, ProLState } from "./types.ts";

// ---------------------------------------------------------------------------
// Finding and editing
// ---------------------------------------------------------------------------

/** A YT-L of the song, by its effect's id: its track, slot and settings. */
export function findProL(song: MusicProject, effectId: string) {
  const found = findEffect(song, effectId);
  if (!found?.effect?.proL) return null;
  return { track: found.track, slot: found.track.effects.indexOf(found.effect), effect: found.effect, proL: found.effect.proL };
}

/** The song's YT-Ls, each with its track. */
export function proLs(song: MusicProject) {
  return song.mixer.tracks.flatMap((track) => track.effects.flatMap((effect, slot) => (effect?.proL ? [{ track, slot, effect, proL: effect.proL }] : [])));
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
/** What's heard (not which preset is named, A/B's other side, Lock Output or the meter). */
const heard = (p: ProLState): ProLState => normalizeProLState(p);
const soundChanged = (a: ProLState, b: ProLState) => !same(heard(a), heard(b));

/** Change a YT-L's settings (kept valid); the same song when nothing changes. */
export function editProL(song: MusicProject, effectId: string, change: (proL: ProL) => ProL): MusicProject {
  const found = findProL(song, effectId);
  if (!found) return song;
  const next = normalizeProL(change(found.proL));
  if (same(next, found.proL)) return song;
  return {
    ...song,
    mixer: {
      ...song.mixer,
      tracks: song.mixer.tracks.map((track) =>
        track.id !== found.track.id ? track : { ...track, effects: track.effects.map((effect) => (effect?.id === effectId ? { ...effect, proL: next } : effect)) },
      ),
    },
  };
}

export type ProLPatch = Partial<ProLState> & { lockOutput?: boolean; meter?: Partial<ProLMeter> };

/** Set some of a YT-L's controls. Changing its sound by hand forgets the preset it came from. */
export function updateProL(song: MusicProject, effectId: string, patch: ProLPatch): MusicProject {
  return editProL(song, effectId, (proL) => {
    const { meter, ...rest } = patch;
    const next = { ...proL, ...rest, meter: meter ? { ...proL.meter, ...meter } : proL.meter };
    return soundChanged(proL, next) ? { ...next, preset: null } : next;
  });
}

/**
 * Load a preset (by name): its sound over the default's, its delivery settings where it has them (unless Lock Output
 * is on), its loudness target; A/B and the rest of the meter kept.
 */
export function chooseProLPreset(song: MusicProject, effectId: string, name: string): MusicProject {
  const preset = proLPreset(name);
  if (!preset) return song;
  return editProL(song, effectId, (proL) => {
    const sound: ProLState = { ...DEFAULT_PRO_L_STATE, ...preset.settings };
    const kept = Object.fromEntries(PRO_L_DELIVERY.flatMap((key) => (proL.lockOutput || preset.settings[key] === undefined ? [[key, proL[key]]] : []))) as Partial<ProLState>;
    const meter = preset.target === undefined ? proL.meter : { ...proL.meter, target: preset.target };
    return { ...proL, ...sound, ...kept, preset: preset.name, meter };
  });
}

/** A/B: swap to the other state (the first switch copies this one there). */
export function switchProLAB(song: MusicProject, effectId: string): MusicProject {
  return editProL(song, effectId, (proL) => {
    const here = heard(proL);
    const there = proL.other ?? here;
    return { ...proL, ...there, other: here, slot: proL.slot === "a" ? "b" : "a" };
  });
}

/** A/B's Copy: this state to the other. */
export function copyProLAB(song: MusicProject, effectId: string): MusicProject {
  return editProL(song, effectId, (proL) => ({ ...proL, other: heard(proL) }));
}

/** Choose a style: the knobs stay where they are (they're separate controls, as in Pro-L 2). */
export const chooseProLStyle = (song: MusicProject, effectId: string, style: ProLState["style"]) => updateProL(song, effectId, { style });

/**
 * The YT-L that finishes the song, if one does: the master's last enabled effect, at its full mix. The export
 * leaves its ceiling and its dither alone (`docs/fabfilter/pro-l.md` §8.8).
 */
export function finalProL(song: MusicProject): ProL | null {
  const master = song.mixer.tracks[0];
  const last = master?.effects.filter((e) => e?.enabled).at(-1);
  return last?.proL && last.mix >= 1 ? last.proL : null;
}

// ---------------------------------------------------------------------------
// What the engine plays
// ---------------------------------------------------------------------------

/** A YT-L as the engine runs it (`engine/src/ProL.h`'s `Settings`): levels in dB, times in seconds. */
export interface EngineProL {
  gain: number;
  ceiling: number;
  truePeak: boolean;
  oversampling: number;
  /** The ramp's look-ahead: the knob, at least the style's shortest ramp. */
  lookahead: number;
  /** The knob's range and the style's reserve: together, the main delay. */
  range: number;
  reserve: number;
  layers: number;
  /** Seconds; −1: Auto. */
  hold: number;
  fastRelease: number;
  slowRelease: number;
  releaseStage: { attack: number; release: number; strength: number; floor: number; delay: number } | null;
  bass: number;
  emphasis: number;
  linkTransients: number;
  linkRelease: number;
  /** Mid/side, the side first down to `sideFloor` (dB). */
  stereo: "lr" | "ms";
  sideFloor: number;
  /** The clip stage (null: off): its gap to the limiter (dB), curve, knee (dB) and place. */
  clip: { range: number; shape: ProLState["clipShape"]; knee: number; order: ProLState["clipOrder"] } | null;
  audition: ProLState["audition"];
  dcFilter: boolean;
  unityGain: boolean;
  /** Dither at the very end: the bit depth (0: none) and its noise shaping. */
  dither: number;
  noiseShaping: ProLState["noiseShaping"];
}

/** What a YT-L is to the engine: its style's numbers, its knobs in the engine's units. */
export function engineProL(proL: ProLState): EngineProL {
  const spec = PRO_L_STYLE_SPECS[proL.style];
  const lookahead = Math.min(Math.max(Math.min(proL.lookahead, spec.range), spec.ramp), spec.reserve + spec.range);
  const hold = proL.hold ?? spec.hold;
  return {
    gain: proL.gain,
    ceiling: proL.output,
    truePeak: proL.truePeak,
    oversampling: proL.oversampling,
    lookahead,
    range: spec.range,
    reserve: spec.reserve,
    layers: spec.layers,
    hold: hold === null ? -1 : hold,
    fastRelease: spec.fastRelease,
    slowRelease: spec.slowRelease,
    releaseStage: spec.releaseStage && { attack: proL.attack, release: proL.release, ...spec.releaseStage },
    bass: spec.bass,
    emphasis: spec.emphasis,
    linkTransients: proL.linkTransients,
    linkRelease: proL.linkRelease,
    stereo: proL.stereo,
    sideFloor: proL.sideFloor,
    // FL's curve keeps its own knee (Fruity Soft Clipper's, measured); the Knee knob is Smooth's.
    clip: proL.clip ? { range: proL.clipRange, shape: proL.clipShape, knee: proL.clipShape === "fl" ? FL_CLIP_KNEE : proL.clipKnee, order: proL.clipOrder } : null,
    audition: proL.audition,
    dcFilter: proL.dcFilter,
    unityGain: proL.unityGain,
    dither: proL.dither,
    noiseShaping: proL.noiseShaping,
  };
}

/**
 * About how late a YT-L's sound is (seconds), for the window and the assistant: the main delay, the
 * oversampling's filters and the last stage. The engine's own figure (in samples, from its real filters) is
 * what delay compensation uses.
 */
export function proLLatencySeconds(proL: ProLState = DEFAULT_PRO_L_STATE): number {
  const spec = PRO_L_STYLE_SPECS[proL.style];
  // The clip stage clips at 4x at least.
  const factor = proL.clip ? Math.max(4, proL.oversampling) : proL.oversampling;
  const filters = factor > 1 ? 0.0015 : 0;
  const last = proL.truePeak ? 2 * (72 / 48000 + 0.001) : factor > 1 ? 0.0005 : 0;
  const clip = (factor === 1 ? 2 : 1) / 48000;
  return spec.reserve + spec.range + filters + last + clip;
}

// ---------------------------------------------------------------------------
// Automation
// ---------------------------------------------------------------------------

/** What an automation lane of YT-L's sets in the engine (`EngineLaneTarget` "limiter", `limit::Lane`): one value. */
export const PRO_L_LANES: Record<ProLControl, (e: EngineProL, p: ProLState) => number[]> = {
  gain: (e) => [e.gain],
  output: (e) => [e.ceiling],
  attack: (_, p) => [p.attack],
  release: (_, p) => [p.release],
  hold: (e) => [e.hold],
  linkTransients: (e) => [e.linkTransients],
  linkRelease: (e) => [e.linkRelease],
  sideFloor: (e) => [e.sideFloor],
  clipRange: (_, p) => [p.clipRange],
  clipKnee: (_, p) => [p.clipShape === "fl" ? FL_CLIP_KNEE : p.clipKnee],
};

/** An automatable control: as Pro-C's (`ProCControlSpec`). */
export interface ProLControlSpec {
  name: string;
  get: (p: ProLState) => number;
  set: (p: ProLState, value: number) => ProLState;
  toControl: (fraction: number) => number;
  fromControl: (value: number) => number;
  defaultValue: number;
  format: (value: number) => string;
}

const linear = (min: number, max: number) => ({ toControl: (f: number) => min + clamp(f, 0, 1) * (max - min), fromControl: (v: number) => clamp((v - min) / (max - min), 0, 1) });
const db = (v: number) => `${v > 0 ? "+" : ""}${v.toFixed(1)} dB`;
const percent = (v: number) => `${Math.round(v * 100)}%`;
/** Milliseconds or seconds, as Pro-L shows a time. */
export const formatProLTime = (seconds: number) => (seconds < 0.01 ? `${(seconds * 1000).toFixed(2)} ms` : seconds < 1 ? `${Math.round(seconds * 1000)} ms` : `${seconds.toFixed(2)} s`);

export const PRO_L_CONTROL_SPECS: Record<ProLControl, ProLControlSpec> = {
  gain: { name: "Gain", get: (p) => p.gain, set: (p, gain) => ({ ...p, gain }), ...linear(PRO_L_GAIN_RANGE[0], PRO_L_GAIN_RANGE[1]), defaultValue: 0, format: db },
  output: { name: "Output Level", get: (p) => p.output, set: (p, output) => ({ ...p, output }), ...linear(PRO_L_OUTPUT_RANGE[0], PRO_L_OUTPUT_RANGE[1]), defaultValue: -0.1, format: db },
  attack: { name: "Attack", get: (p) => p.attack, set: (p, attack) => ({ ...p, attack }), toControl: attackFromTurn, fromControl: turnFromAttack, defaultValue: 0.275, format: formatProLTime },
  release: { name: "Release", get: (p) => p.release, set: (p, release) => ({ ...p, release }), toControl: releaseFromTurn, fromControl: turnFromRelease, defaultValue: 0.4, format: formatProLTime },
  hold: {
    name: "Hold",
    // Auto reads as its knob's start; automation holds a set time.
    get: (p) => p.hold ?? 0,
    set: (p, hold) => ({ ...p, hold }),
    ...linear(0, PRO_L_MAX_HOLD),
    defaultValue: 0,
    format: formatProLTime,
  },
  linkTransients: { name: "Transients Link", get: (p) => p.linkTransients, set: (p, linkTransients) => ({ ...p, linkTransients }), ...linear(0, 1), defaultValue: 0.75, format: percent },
  linkRelease: { name: "Release Link", get: (p) => p.linkRelease, set: (p, linkRelease) => ({ ...p, linkRelease }), ...linear(0, 1), defaultValue: 1, format: percent },
  sideFloor: { name: "Side Floor", get: (p) => p.sideFloor, set: (p, sideFloor) => ({ ...p, sideFloor }), ...linear(PRO_L_SIDE_FLOOR_RANGE[0], PRO_L_SIDE_FLOOR_RANGE[1]), defaultValue: -6, format: db },
  clipRange: { name: "Clip Range", get: (p) => p.clipRange, set: (p, clipRange) => ({ ...p, clipRange }), ...linear(0, PRO_L_MAX_CLIP_RANGE), defaultValue: 1.5, format: (v) => `${v.toFixed(1)} dB` },
  clipKnee: { name: "Clip Knee", get: (p) => p.clipKnee, set: (p, clipKnee) => ({ ...p, clipKnee }), ...linear(0, PRO_L_MAX_CLIP_KNEE), defaultValue: 1.5, format: (v) => `${v.toFixed(1)} dB` },
};

/** Set a YT-L's control to a value in its own units (a knob turned, an assistant's edit). */
export const setProLControl = (song: MusicProject, effectId: string, control: ProLControl, value: number) =>
  editProL(song, effectId, (proL) => {
    const next = { ...proL, ...PRO_L_CONTROL_SPECS[control].set(proL, value) };
    return soundChanged(proL, next) ? { ...next, preset: null } : proL;
  });
