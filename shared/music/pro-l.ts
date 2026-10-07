/**
 * YT-L (`docs/fabfilter/pro-l.md`): its edits, and what each style means to the sound (`engineProL`: the engine
 * knows no style, only the numbers here). Pure and tested.
 *
 * The engine (`engine/src/ProL.cpp`) runs what's decided here: the gain, an oversampled look-ahead limiter (a
 * main stage that guarantees the ceiling, a bass stage and a release stage that only lower it further), then a
 * sample-peak catch or two true peak passes at the song's rate.
 */
import { findEffect } from "./automation.ts";
import { DEFAULT_PRO_L_STATE, FL_CLIP_KNEE, PRO_L_STYLE_SPECS, normalizeProL } from "./pro-l-presets.ts";
import type { MusicProject, ProL, ProLState } from "./types.ts";

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

export type ProLPatch = Partial<ProLState>;

/** Set some of a YT-L's controls. Changing its sound by hand forgets the preset it came from. */
export function updateProL(song: MusicProject, effectId: string, patch: ProLPatch): MusicProject {
  return editProL(song, effectId, (proL) => {
    const next = { ...proL, ...patch };
    return same(next, proL) ? proL : { ...next, preset: null };
  });
}

/** Choose a style: the knobs stay where they are (they're separate controls, as in Pro-L 2). */
export const chooseProLStyle = (song: MusicProject, effectId: string, style: ProLState["style"]) => updateProL(song, effectId, { style });

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
