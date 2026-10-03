/**
 * The assistant's Reverb (`shared/music/tools.ts`: get_reverb, update_reverb, set_reverb_decay,
 * add_vocal_reverb): pure `(song, input) => { song, text }` edits like the rest of `tool-edits.ts`, and
 * what get_reverb says. Values in units ("2.4 s", "-6 dB", "1/8 dot") or numbers in the control's own;
 * errors say what's wrong and what would work.
 */
import { createId } from "@shared/ids";
import { isFiniteNumber } from "@shared/math";
import { addMixerTracks, isFreeTrack, setEffect, setSend, trackName, updateMixerTrack } from "@shared/music/mixer";
import {
  type ReverbPatch,
  addDecayBand,
  chooseReverbPreset,
  copyReverbAB,
  editDecayBands,
  findReverb,
  formatDecay,
  formatHz,
  formatNote,
  formatSeconds,
  keyConnected,
  naturalT60,
  parseNote,
  predelaySeconds,
  releaseSeconds,
  reverbT60,
  reverbs,
  setReverbKey,
  switchReverbAB,
  updateReverb,
} from "@shared/music/reverb";
import { REVERB_ERA_SPECS, REVERB_MODE_SPECS, REVERB_OCTAVES } from "@shared/music/reverb-modes";
import {
  ATTACK_RANGE,
  BAND_FREQ_RANGE,
  BAND_Q_RANGE,
  DE_ESS_FREQ_RANGE,
  HIGH_CUT_RANGE,
  HIGH_SHELF_RANGE,
  LEVEL_RANGE,
  LOW_CUT_RANGE,
  LOW_SHELF_RANGE,
  MAX_AUTO_DECAY,
  MAX_DE_ESS,
  MAX_DUCK,
  MAX_HOLD,
  MAX_PREDELAY,
  MAX_SHELF_GAIN,
  MAX_VLF_CUT,
  MAX_WIDTH,
  MOD_RATE_RANGE,
  MONO_BELOW_RANGE,
  MULTIPLIER_RANGE,
  PRESET_LOUDNESS,
  PREDELAY_OFFSET_RANGE,
  RECOVERY_RANGE,
  RELEASE_RANGE,
  REVERB_BANDS,
  REVERB_DECAY_RANGE,
  REVERB_INFINITE,
  REVERB_PLUGIN,
  REVERB_PRESETS,
  THRESHOLD_RANGE,
  VARIATION_RANGE,
  isInfinite,
} from "@shared/music/reverb-presets";
import { MASTER_TRACK_ID } from "@shared/music/project";
import { type MixerTrack, type MusicProject, REVERB_BAND_SHAPES, REVERB_ERAS, REVERB_MODES, type ReverbBandShape, type ReverbDecayBand } from "@shared/music/types";
import { findTrack, trackLabel } from "../mixer/tool-edits";
import type { EditResult } from "../tool-edits";

type Input = Record<string, unknown>;

const round = (n: number, digits = 1) => Math.round(n * 10 ** digits) / 10 ** digits;
const db = (v: number) => `${v > 0 ? "+" : ""}${round(v)} dB`;
const percent = (v: number) => `${Math.round(v * 100)}%`;

/**
 * The Reverb an input names: by `effect` (its id), by `track` (the track's Reverb; with `effectSlot`, the
 * one in that slot), or the song's only one. The error lists the song's.
 */
export function findReverbRef(song: MusicProject, input: Input) {
  const all = reverbs(song);
  const list = () =>
    all.length
      ? `The song's Reverbs: ${all.map((r) => `${r.effect.id} (${trackLabel(song, r.track)}, slot ${r.slot + 1})`).join(", ")}.`
      : 'The song has none: add_vocal_reverb sets up a vocal\'s, add_mixer_effect with plugin "Reverb" puts one in a slot.';
  if (typeof input.effect === "string" && input.effect.trim()) {
    const found = findReverb(song, input.effect.trim());
    if (!found) throw new Error(`There's no Reverb "${input.effect}". ${list()}`);
    return found;
  }
  if (input.track !== undefined && input.track !== "") {
    const track = findTrack(song, input.track);
    const on = all.filter((r) => r.track.id === track.id && (!Number.isInteger(input.effectSlot) || r.slot === (input.effectSlot as number) - 1));
    if (!on.length) throw new Error(`${trackLabel(song, track)} has no Reverb${Number.isInteger(input.effectSlot) ? ` in slot ${String(input.effectSlot)}` : ""}. ${list()}`);
    return on[0];
  }
  if (all.length === 1) return all[0];
  throw new Error(all.length ? `Say which Reverb ("effect", or "track"). ${list()}` : list());
}

/** The pitch a modulation makes at its peak (cents): 1731 · 2π · f · A. */
const cents = (rate: number, depth: number) => 1731 * 2 * Math.PI * rate * 0.001 * depth * depth;

/** get_reverb: every setting in words and units, the T60 at each band, the modes, eras and presets. */
export function describeReverb(song: MusicProject, input: Input): string {
  const { effect, track, slot, reverb: r } = findReverbRef(song, input);
  const bpm = song.settings.tempo;
  const t60 = reverbT60(r);
  const key = r.ducking.key ? song.mixer.tracks.find((t) => t.id === r.ducking.key) : null;
  const pre = predelaySeconds(r, bpm);
  const lines = [
    `Reverb ${effect.id} on ${trackLabel(song, track)}, slot ${slot + 1}${effect.enabled ? "" : " (bypassed)"}${r.preset ? `, preset "${r.preset}"` : ", edited"}; A/B slot ${r.slot.toUpperCase()}.`,
    `${REVERB_MODE_SPECS[r.mode].name}, ${REVERB_ERA_SPECS[r.era].name}. Mix ${percent(r.mix)}${r.mixLock ? " (locked)" : ""}${effect.mix < 1 ? `, slot mix ${percent(effect.mix)}` : ""}${r.freeze ? ", FROZEN" : ""}.`,
    `Decay ${formatDecay(r.decay)} at 1 kHz; pre-delay ${r.sync ? `${formatNote(r.predelayNote)}${r.predelayOffset !== 1 ? ` × ${round(r.predelayOffset, 2)}` : ""} (${formatSeconds(pre)} at ${bpm} BPM)` : formatSeconds(pre)}; size ${percent(r.size)}, distance ${percent(r.distance)}, diffusion ${percent(r.diffusion)}.`,
    `Modulation ${r.late.modShape}, ${round(r.modRate, 2)} Hz at ${percent(r.modDepth)} (about ${round(cents(r.modRate, r.modDepth), 1)} cents); width ${percent(r.width)}.`,
    `Low cut ${r.lowCut <= LOW_CUT_RANGE[0] + 0.5 ? "off" : `${formatHz(r.lowCut)} (${r.lowCutSlope} dB/oct)`}, high cut ${r.highCut >= HIGH_CUT_RANGE[1] - 1 ? "off" : `${formatHz(r.highCut)} (${r.highCutSlope} dB/oct)`}.`,
    `De-ess ${round(r.deEss)} dB at ${formatHz(r.input.deEssFreq)}. Duck ${db(r.duck)}, keyed from ${key ? `${trackLabel(song, key)}${keyConnected(song, effect.id) ? "" : " (NOT sending here: it ducks under nothing)"}` : "this track's own input"}; threshold ${r.ducking.threshold === null ? "auto" : db(r.ducking.threshold)}, attack ${formatSeconds(r.ducking.attack)}, release ${r.ducking.releaseSync ? `${formatNote(r.ducking.releaseNote)} (${formatSeconds(releaseSeconds(r, bpm))})` : formatSeconds(r.ducking.release)}, hold ${formatSeconds(r.ducking.hold)}, ducking ${r.ducking.what === "tail" ? "the tail only" : "everything wet"}; auto-decay ${percent(r.ducking.autoDecay)} (recovery ${formatSeconds(r.ducking.recovery)}).`,
    `Input ${r.input.mode}, cross ${percent(r.input.cross)}, input cuts ${r.input.lowCut <= LOW_CUT_RANGE[0] + 0.5 ? "off" : formatHz(r.input.lowCut)} / ${r.input.highCut >= HIGH_CUT_RANGE[1] - 1 ? "off" : formatHz(r.input.highCut)}, VLF cut ${db(r.input.vlfCut)}. Early send ${percent(r.early.send)}, early cross ${percent(r.early.cross)}, late diffusion ${r.late.diffusion === null ? "the mode's" : percent(r.late.diffusion)}, variation ${r.late.variation}, tone lock ${r.late.toneLock ? "on" : "off"}.`,
    `Output: low shelf ${db(r.output.lowShelf.gain)} at ${formatHz(r.output.lowShelf.frequency)}, high shelf ${db(r.output.highShelf.gain)} at ${formatHz(r.output.highShelf.frequency)}${r.output.studio ? ", Studio filters (600 Hz, 10 kHz)" : ""}, mono below ${r.output.monoBelow ? formatHz(r.output.monoBelow) : "off"}, level ${db(r.output.level)}.`,
    `Decay EQ${r.bandsBypass ? " (BYPASSED)" : ""}: ${r.bands.length ? r.bands.map((b) => `band ${b.id} ${b.shape} ${formatHz(b.frequency)} ×${round(b.multiplier, 2)} Q ${round(b.q, 2)}${b.enabled ? "" : " (off)"}`).join("; ") : "no bands"}.`,
    `T60 by octave band: ${isInfinite(r.decay) ? "∞ everywhere" : REVERB_OCTAVES.map((f, b) => `${formatHz(f)} ${round(t60[b], 2)} s`).join(", ")}.`,
    `Modes: ${REVERB_MODES.map((m) => `${m} (${REVERB_MODE_SPECS[m].detail})`).join("; ")}.`,
    `Eras: ${REVERB_ERAS.map((e) => `${e} (${REVERB_ERA_SPECS[e].detail})`).join("; ")}.`,
    `Presets: ${REVERB_PRESETS.map((p) => p.name).join(", ")}.`,
  ];
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Values in units
// ---------------------------------------------------------------------------

type Unit = "s" | "ms" | "db" | "hz";

/** A value as a number in `unit`: a number as it is (its control's own), or "2.4 s", "40 ms", "-6 dB", "6.5 kHz". */
function unitValue(input: Input, key: string, unit: Unit, min: number, max: number, extra = ""): number | undefined {
  const raw = input[key];
  if (raw === undefined) return undefined;
  let value: number | null = null;
  if (isFiniteNumber(raw)) value = raw;
  else if (typeof raw === "string") {
    const m = /^\s*(-?\d+(?:\.\d+)?)\s*(ms|s|sec|seconds|db|hz|khz)?\s*$/i.exec(raw);
    if (m) {
      const n = Number(m[1]);
      const u = (m[2] ?? "").toLowerCase();
      value = u === "ms" ? (unit === "s" ? n / 1000 : n) : u === "s" || u === "sec" || u === "seconds" ? (unit === "ms" ? n * 1000 : n) : u === "khz" ? n * 1000 : n;
    }
  }
  if (value === null || value < min || value > max) throw new Error(`"${key}" must be ${unit === "s" ? "seconds" : unit === "ms" ? "milliseconds" : unit === "db" ? "dB" : "Hz"} from ${min} to ${max}${extra}.`);
  return value;
}

function number(input: Input, key: string, min: number, max: number): number | undefined {
  const value = input[key];
  if (value === undefined) return undefined;
  if (!isFiniteNumber(value) || value < min || value > max) throw new Error(`"${key}" must be a number from ${min} to ${max}.`);
  return value;
}

function choice<T extends string>(input: Input, key: string, list: readonly T[]): T | undefined {
  const value = input[key];
  if (value === undefined) return undefined;
  if (!list.includes(value as T)) throw new Error(`"${key}" must be one of ${list.join(", ")}.`);
  return value as T;
}

const flag = (input: Input, key: string) => (input[key] === undefined ? undefined : input[key] === true);

// ---------------------------------------------------------------------------
// update_reverb
// ---------------------------------------------------------------------------

export function updateReverbTool(song: MusicProject, input: Input): EditResult {
  const { effect, track } = findReverbRef(song, input);
  const id = effect.id;
  let next = song;
  const done: string[] = [];
  if (input.preset !== undefined) {
    const preset = REVERB_PRESETS.find((p) => p.name.toLowerCase() === String(input.preset).toLowerCase());
    if (!preset) throw new Error(`There's no preset "${String(input.preset)}". The presets: ${REVERB_PRESETS.map((p) => p.name).join(", ")}.`);
    next = chooseReverbPreset(next, id, preset.name);
    done.push(`loaded "${preset.name}"`);
  }
  const patch: ReverbPatch = {};
  const set = <K extends keyof ReverbPatch>(key: K, value: ReverbPatch[K] | undefined) => {
    if (value !== undefined) patch[key] = value;
  };
  set("mode", choice(input, "mode", REVERB_MODES));
  set("era", choice(input, "era", REVERB_ERAS));
  set("mix", number(input, "mix", 0, 1));
  set("mixLock", flag(input, "mixLock"));
  set("freeze", flag(input, "freeze"));
  if (input.decay !== undefined) {
    const raw = String(input.decay).trim().toLowerCase();
    set("decay", raw === "inf" || raw === "infinite" || raw === "∞" ? REVERB_INFINITE : unitValue(input, "decay", "s", REVERB_DECAY_RANGE[0], REVERB_DECAY_RANGE[1], ', or "inf"'));
  }
  if (input.predelay !== undefined) {
    const note = typeof input.predelay === "string" ? parseNote(input.predelay) : null;
    if (note) {
      set("sync", true);
      set("predelayNote", note);
    } else {
      const ms = unitValue(input, "predelay", "ms", 0, MAX_PREDELAY * 1000, ', or a note value ("1/64" .. "1/2", "1/16 dot", "1/8 tri")');
      set("sync", false);
      set("predelay", ms! / 1000);
    }
  }
  set("predelayOffset", number(input, "predelayOffset", PREDELAY_OFFSET_RANGE[0], PREDELAY_OFFSET_RANGE[1]));
  set("size", number(input, "size", 0, 1));
  set("distance", number(input, "distance", 0, 1));
  set("diffusion", number(input, "diffusion", 0, 1));
  set("modRate", unitValue(input, "modRate", "hz", MOD_RATE_RANGE[0], MOD_RATE_RANGE[1]));
  set("modDepth", number(input, "modDepth", 0, 1));
  set("width", number(input, "width", 0, MAX_WIDTH));
  set("lowCut", unitValue(input, "lowCut", "hz", LOW_CUT_RANGE[0], LOW_CUT_RANGE[1]));
  set("highCut", unitValue(input, "highCut", "hz", HIGH_CUT_RANGE[0], HIGH_CUT_RANGE[1]));
  if (input.cutSlope !== undefined) {
    if (input.cutSlope !== 12 && input.cutSlope !== 24) throw new Error('"cutSlope" must be 12 or 24.');
    set("lowCutSlope", input.cutSlope);
    set("highCutSlope", input.cutSlope);
  }
  set("deEss", unitValue(input, "deEss", "db", 0, MAX_DE_ESS));
  set("duck", unitValue(input, "duck", "db", -MAX_DUCK, 0));
  const shape = choice(input, "modShape", ["chorus", "random"] as const);
  const lateDiffusion = number(input, "lateDiffusion", -1, 1);
  const variation = number(input, "variation", VARIATION_RANGE[0], VARIATION_RANGE[1]);
  const toneLock = flag(input, "toneLock");
  if (shape !== undefined || lateDiffusion !== undefined || variation !== undefined || toneLock !== undefined)
    patch.late = {
      ...(shape !== undefined && { modShape: shape }),
      ...(lateDiffusion !== undefined && { diffusion: lateDiffusion < 0 ? null : lateDiffusion }),
      ...(variation !== undefined && { variation: Math.round(variation) }),
      ...(toneLock !== undefined && { toneLock }),
    };
  const inputPatch: ReverbPatch["input"] = {};
  const mode = choice(input, "input", ["auto", "mono", "stereo"] as const);
  if (mode) inputPatch.mode = mode;
  const cross = number(input, "inputCross", 0, 1);
  if (cross !== undefined) inputPatch.cross = cross;
  const inLow = unitValue(input, "inputLowCut", "hz", LOW_CUT_RANGE[0], LOW_CUT_RANGE[1]);
  if (inLow !== undefined) inputPatch.lowCut = inLow;
  const inHigh = unitValue(input, "inputHighCut", "hz", HIGH_CUT_RANGE[0], HIGH_CUT_RANGE[1]);
  if (inHigh !== undefined) inputPatch.highCut = inHigh;
  const deEssFreq = unitValue(input, "deEssFreq", "hz", DE_ESS_FREQ_RANGE[0], DE_ESS_FREQ_RANGE[1]);
  if (deEssFreq !== undefined) inputPatch.deEssFreq = deEssFreq;
  const vlf = unitValue(input, "vlfCut", "db", -MAX_VLF_CUT, 0);
  if (vlf !== undefined) inputPatch.vlfCut = vlf;
  if (Object.keys(inputPatch).length) patch.input = inputPatch;
  const send = number(input, "earlySend", 0, 1);
  const earlyCross = number(input, "earlyCross", 0, 1);
  if (send !== undefined || earlyCross !== undefined) patch.early = { ...(send !== undefined && { send }), ...(earlyCross !== undefined && { cross: earlyCross }) };
  const ducking: ReverbPatch["ducking"] = {};
  if (input.duckThreshold !== undefined) ducking.threshold = String(input.duckThreshold).toLowerCase() === "auto" ? null : unitValue(input, "duckThreshold", "db", THRESHOLD_RANGE[0], THRESHOLD_RANGE[1], ', or "auto"');
  const attack = unitValue(input, "duckAttack", "ms", ATTACK_RANGE[0] * 1000, ATTACK_RANGE[1] * 1000);
  if (attack !== undefined) ducking.attack = attack / 1000;
  if (input.duckRelease !== undefined) {
    const note = typeof input.duckRelease === "string" ? parseNote(input.duckRelease) : null;
    if (note) Object.assign(ducking, { releaseSync: true, releaseNote: note });
    else Object.assign(ducking, { releaseSync: false, release: unitValue(input, "duckRelease", "ms", RELEASE_RANGE[0] * 1000, RELEASE_RANGE[1] * 1000, ", or a note value")! / 1000 });
  }
  const hold = unitValue(input, "duckHold", "ms", 0, MAX_HOLD * 1000);
  if (hold !== undefined) ducking.hold = hold / 1000;
  const what = choice(input, "duckWhat", ["tail", "all"] as const);
  if (what) ducking.what = what;
  const autoDecay = number(input, "autoDecay", 0, MAX_AUTO_DECAY);
  if (autoDecay !== undefined) ducking.autoDecay = autoDecay;
  const recovery = unitValue(input, "autoDecayRecovery", "ms", RECOVERY_RANGE[0] * 1000, RECOVERY_RANGE[1] * 1000);
  if (recovery !== undefined) ducking.recovery = recovery / 1000;
  if (Object.keys(ducking).length) patch.ducking = ducking;
  const output: ReverbPatch["output"] = {};
  const shelf = (key: "lowShelf" | "highShelf", range: readonly [number, number]) => {
    const raw = input[key];
    if (raw === undefined) return;
    if (!raw || typeof raw !== "object") throw new Error(`"${key}" must be { frequency, gain }.`);
    const s = raw as Input;
    const frequency = number(s, "frequency", range[0], range[1]);
    const gain = number(s, "gain", -MAX_SHELF_GAIN, MAX_SHELF_GAIN);
    output[key] = { ...(frequency !== undefined && { frequency }), ...(gain !== undefined && { gain }) };
  };
  shelf("lowShelf", LOW_SHELF_RANGE);
  shelf("highShelf", HIGH_SHELF_RANGE);
  const studio = flag(input, "studio");
  if (studio !== undefined) output.studio = studio;
  if (input.monoBelow !== undefined) {
    const hz = unitValue(input, "monoBelow", "hz", 0, MONO_BELOW_RANGE[1]);
    output.monoBelow = hz! < MONO_BELOW_RANGE[0] ? 0 : hz;
  }
  const level = unitValue(input, "output", "db", LEVEL_RANGE[0], LEVEL_RANGE[1]);
  if (level !== undefined) output.level = level;
  if (Object.keys(output).length) patch.output = output;
  if (Object.keys(patch).length) {
    next = updateReverb(next, id, patch);
    done.push(Object.keys(patch).join(", "));
  }
  if (input.duckKey !== undefined) {
    const self = String(input.duckKey).toLowerCase() === "self" || input.duckKey === null;
    const keyTrack = self ? null : findTrack(next, input.duckKey);
    if (keyTrack && keyTrack.id === track.id) throw new Error(`The key can't be the Reverb's own track (${trackLabel(next, track)}): give another track, or "self" for its own input.`);
    const keyed = setReverbKey(next, id, keyTrack ? keyTrack.id : null);
    if (keyTrack && keyed === next && findReverb(next, id)!.reverb.ducking.key !== keyTrack.id)
      throw new Error(`${trackLabel(next, keyTrack)} can't send to ${trackLabel(next, track)} (it would make a loop): choose a track that comes before it.`);
    next = keyed;
    done.push(keyTrack ? `ducked by ${trackLabel(next, keyTrack)}` : "ducked by its own input");
  }
  if (input.ab !== undefined) {
    const ab = choice(input, "ab", ["switch", "copy"] as const);
    next = ab === "switch" ? switchReverbAB(next, id) : copyReverbAB(next, id);
    done.push(ab === "switch" ? "switched A/B" : "copied to the other A/B slot");
  }
  if (!done.length) throw new Error("Nothing to change: give a preset or a control (mode, decay, predelay, size, distance, diffusion, mix, the cuts, deEss, duck, ...).");
  return { song: next, text: `Reverb ${id}: ${done.join("; ")}.\n${describeReverb(next, { effect: id })}` };
}

// ---------------------------------------------------------------------------
// set_reverb_decay
// ---------------------------------------------------------------------------

export function setReverbDecayTool(song: MusicProject, input: Input): EditResult {
  const { effect, reverb } = findReverbRef(song, input);
  const id = effect.id;
  let next = song;
  const done: string[] = [];
  if (input.clear === true) {
    next = editDecayBands(next, id, reverb.bands.map((b) => b.id), null);
    done.push("cleared the bands");
  }
  if (input.bypass !== undefined) {
    next = updateReverb(next, id, { bandsBypass: input.bypass === true });
    done.push(input.bypass === true ? "bypassed the bands" : "the bands back on");
  }
  if (input.bands !== undefined) {
    if (!Array.isArray(input.bands)) throw new Error('"bands" must be a list of { band?, shape, frequency, multiplier or seconds, q, remove }.');
    for (const raw of input.bands) {
      const b = (raw && typeof raw === "object" ? raw : {}) as Input;
      const current = findReverb(next, id)!.reverb;
      const shape = choice(b, "shape", REVERB_BAND_SHAPES) as ReverbBandShape | undefined;
      const frequency = number(b, "frequency", BAND_FREQ_RANGE[0], BAND_FREQ_RANGE[1]);
      const q = number(b, "q", BAND_Q_RANGE[0], BAND_Q_RANGE[1]);
      let multiplier = number(b, "multiplier", MULTIPLIER_RANGE[0], MULTIPLIER_RANGE[1]);
      const enabled = flag(b, "enabled");
      const at = frequency ?? current.bands.find((x) => x.id === b.band)?.frequency ?? 1000;
      if (b.seconds !== undefined) {
        const seconds = number(b, "seconds", 0.05, 100)!;
        // The T60 wanted there, as a multiplier of what the mode (and Decay) make there without this band.
        multiplier = Math.min(MULTIPLIER_RANGE[1], Math.max(MULTIPLIER_RANGE[0], seconds / naturalT60(current, at)));
      }
      const change: Partial<ReverbDecayBand> = {
        ...(shape !== undefined && { shape }),
        ...(frequency !== undefined && { frequency }),
        ...(q !== undefined && { q }),
        ...(multiplier !== undefined && { multiplier }),
        ...(enabled !== undefined && { enabled }),
      };
      if (b.band === undefined) {
        const made = addDecayBand(next, id, change);
        if (made.id === null) throw new Error(`The Decay EQ has ${REVERB_BANDS} bands already: change one (give its "band") or remove one.`);
        next = made.song;
        done.push(`added band ${made.id}`);
        continue;
      }
      if (!current.bands.some((x) => x.id === b.band)) throw new Error(`There's no band ${String(b.band)}: the bands are ${current.bands.map((x) => x.id).join(", ") || "none (add one without \"band\")"}.`);
      next = editDecayBands(next, id, [b.band as number], b.remove === true ? null : (x) => ({ ...x, ...change }));
      done.push(b.remove === true ? `removed band ${String(b.band)}` : `changed band ${String(b.band)}`);
    }
  }
  if (!done.length) throw new Error('Nothing to change: give "bands", "clear" or "bypass".');
  const t60 = reverbT60(findReverb(next, id)!.reverb);
  return { song: next, text: `Reverb ${id}: ${done.join("; ")}. T60 by octave band now: ${REVERB_OCTAVES.map((f, b) => `${formatHz(f)} ${round(t60[b], 2)} s`).join(", ")}.` };
}

// ---------------------------------------------------------------------------
// add_vocal_reverb
// ---------------------------------------------------------------------------

/** How loud the wet sound sits under the voice (LU): De Man, McNally and Reiss's preferred amount. */
export const VOCAL_REVERB_LU = -14;
/** A send's level (0..1, as the mixer's send knob) for a gain in dB (`levelGain` is the level squared). */
export const sendLevel = (gainDb: number) => Math.min(1, 10 ** (gainDb / 40));

const KINDS: Record<string, string> = { lead: "Vocal Plate", rap: "Rap Room", ballad: "Ballad Hall", backing: "Harmony Plate" };

/**
 * add_vocal_reverb: an insert named after the vocal ("Vox Verb"), a Reverb on it fully wet with Mix Lock,
 * a vocal preset, a post-fader send from the vocal at about 14 LU under it, its Duck keyed from the vocal;
 * or the pair (short space and long tail), and a throw. One undo step. `ids`: the new tracks' and effects' ids (tests).
 */
export function addVocalReverbTool(song: MusicProject, input: Input, ids: string[] = []): EditResult {
  const vocal = findTrack(song, input.track);
  if (vocal.id === MASTER_TRACK_ID) throw new Error("Give the vocal's own mixer track, not the master: its reverb goes on a send from it.");
  const kind = typeof input.kind === "string" && input.kind.trim() ? input.kind.trim() : "lead";
  const preset = KINDS[kind.toLowerCase()] ?? REVERB_PRESETS.find((p) => p.name.toLowerCase() === kind.toLowerCase())?.name;
  if (!preset) throw new Error(`"kind" must be lead, rap, ballad, backing or a preset's name (${REVERB_PRESETS.map((p) => p.name).join(", ")}).`);
  const name = trackName(song, vocal.id);
  // Each send aims at its share of the 14 LU (a pair's two together; a throw starts silent).
  const sends: { preset: string; label: string; lu: number | null }[] = input.pair === true
    ? [
        { preset: "Pair A: Front Chamber", label: "Room", lu: VOCAL_REVERB_LU - 3 },
        { preset: "Pair B: Back Plate", label: "Verb", lu: VOCAL_REVERB_LU - 3 },
      ]
    : [{ preset, label: "Verb", lu: VOCAL_REVERB_LU }];
  if (input.throw === true) sends.push({ preset: "Throw Wash", label: "Throw", lu: null });
  let next = song;
  const made: string[] = [];
  let k = 0;
  for (const send of sends) {
    // A free insert after the vocal's, or a new one at the end.
    const after = next.mixer.tracks.findIndex((t) => t.id === vocal.id);
    let track: MixerTrack | undefined = next.mixer.tracks.slice(after + 1).find((t) => isFreeTrack(next, t));
    if (!track) {
      const trackId = ids[k * 2] ?? createId("insert");
      const added = addMixerTracks(next, null, 1, [trackId]);
      if (added === next) throw new Error("The mixer is full: remove a track (remove_mixer_track) to make room for the reverb's return.");
      next = added;
      track = next.mixer.tracks.find((t) => t.id === trackId)!;
    }
    const effectId = ids[k * 2 + 1] ?? createId("fx");
    next = updateMixerTrack(next, track.id, { name: `${name} ${send.label}` });
    next = setEffect(next, track.id, 0, REVERB_PLUGIN, effectId);
    next = updateReverb(next, effectId, { mix: 1, mixLock: true });
    next = chooseReverbPreset(next, effectId, send.preset);
    // The send's gain: the wet sound (at 100%) sits PRESET_LOUDNESS under what goes in.
    const gain = send.lu === null ? null : send.lu - PRESET_LOUDNESS;
    next = setSend(next, vocal.id, track.id, gain === null ? 0 : sendLevel(gain));
    next = setReverbKey(next, effectId, vocal.id);
    made.push(`${trackLabel(next, track)} (${track.id}) with Reverb ${effectId} "${send.preset}", ${gain === null ? "its send at 0 (automate it on the words to throw)" : `the send at ${db(gain)}`}`);
    k++;
  }
  return {
    song: next,
    text:
      `From ${trackLabel(next, vocal)}: ${made.join("; ")}. Each is fully wet with Mix Lock on, ducked by the vocal. ` +
      "The sends sit the reverb about 14 LU under the voice (err dry: turn a send down before up). update_reverb changes any of them, set_reverb_decay shapes their decay.",
  };
}

/** A line for the mixer's description (`describeMixer`): the Reverb's mode and decay. */
export const reverbLine = (song: MusicProject, effectId: string) => {
  const r = findReverb(song, effectId)?.reverb;
  return r ? `${REVERB_MODE_SPECS[r.mode].name} ${formatDecay(r.decay)}${r.preset ? `, preset "${r.preset}"` : ""}` : "";
};

