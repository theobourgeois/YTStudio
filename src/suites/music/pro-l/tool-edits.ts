/**
 * The assistant's YT-L (`shared/music/tools.ts`: get_pro_l, update_pro_l, reset_pro_l_meter): pure
 * `(song, input) => { song, text }` edits like the rest of `tool-edits.ts`, and what get_pro_l says. Times in
 * milliseconds, as the tools describe them; errors say what's wrong and what would work.
 */
import { isFiniteNumber } from "@shared/math";
import type { EngineProLState } from "@shared/music/engine";
import { type ProLPatch, chooseProLPreset, copyProLAB, engineProL, findProL, formatProLTime, proLLatencySeconds, proLs, switchProLAB, updateProL } from "@shared/music/pro-l";
import {
  PRO_L_GAIN_RANGE,
  PRO_L_MAX_CLIP_KNEE,
  PRO_L_MAX_CLIP_RANGE,
  PRO_L_MAX_HOLD,
  PRO_L_MAX_TIME,
  PRO_L_OUTPUT_RANGE,
  PRO_L_PRESETS,
  PRO_L_SIDE_FLOOR_RANGE,
  PRO_L_STYLE_SPECS,
  PRO_L_TARGET_RANGE,
} from "@shared/music/pro-l-presets";
import { type MusicProject, PRO_L_CLIP_SHAPES, PRO_L_DITHER, PRO_L_NOISE_SHAPINGS, PRO_L_OVERSAMPLING, PRO_L_STYLES } from "@shared/music/types";
import { findTrack, trackLabel } from "../mixer/tool-edits";
import type { EditResult } from "../tool-edits";

type Input = Record<string, unknown>;

const round = (n: number, digits = 1) => Math.round(n * 10 ** digits) / 10 ** digits;
const db = (v: number) => `${v > 0 ? "+" : ""}${round(v)} dB`;
const percent = (v: number) => `${Math.round(v * 100)}%`;
/** A reading of the meter's (−120: nothing yet). */
const reading = (v: number, unit: string) => (v <= -119 ? "none yet" : `${round(v)} ${unit}`);

/**
 * The YT-L an input names: by `effect` (its id), by `track` (the track's YT-L; with `effectSlot`, the one in that
 * slot), or the song's only one. The error lists the song's.
 */
export function findProLRef(song: MusicProject, input: Input) {
  const all = proLs(song);
  const list = () =>
    all.length ? `The song's YT-L instances: ${all.map((p) => `${p.effect.id} (${trackLabel(song, p.track)}, slot ${p.slot + 1})`).join(", ")}.` : 'The song has none: add_mixer_effect with plugin "YT-L" puts one on a track (the master\'s last slot, for a master).';
  if (typeof input.effect === "string" && input.effect.trim()) {
    const found = findProL(song, input.effect.trim());
    if (!found) throw new Error(`There's no YT-L "${input.effect}". ${list()}`);
    return found;
  }
  if (input.track !== undefined && input.track !== "") {
    const track = findTrack(song, input.track);
    const on = all.filter((p) => p.track.id === track.id && (!Number.isInteger(input.effectSlot) || p.slot === (input.effectSlot as number) - 1));
    if (!on.length) throw new Error(`${trackLabel(song, track)} has no YT-L${Number.isInteger(input.effectSlot) ? ` in slot ${String(input.effectSlot)}` : ""}. ${list()}`);
    return on[0];
  }
  if (all.length === 1) return all[0];
  throw new Error(all.length ? `Say which YT-L ("effect", or "track"). ${list()}` : list());
}

/** get_pro_l: its style in numbers, its knobs, its clip stage and delivery; and its meters, if the engine has said them. */
export function describeProL(song: MusicProject, input: Input, live?: EngineProLState | null): string {
  const { effect, track, slot, proL } = findProLRef(song, input);
  const spec = PRO_L_STYLE_SPECS[proL.style];
  const engine = engineProL(proL);
  const lines = [
    `YT-L ${effect.id} on ${trackLabel(song, track)}, slot ${slot + 1}${effect.enabled ? "" : " (bypassed)"}${proL.preset ? `, preset "${proL.preset}"` : ""}${effect.mix < 1 ? `, slot mix ${percent(effect.mix)}` : ""}, A/B on ${proL.slot.toUpperCase()}${proL.lockOutput ? ", Lock Output on" : ""}.`,
    `Style ${proL.style}: ${spec.hint} Its ramp ${formatProLTime(engine.lookahead)}, hold ${engine.hold < 0 ? "Auto (half the bass's period)" : formatProLTime(engine.hold)}, transient release ${spec.fastRelease ? `${formatProLTime(spec.fastRelease)} to ${formatProLTime(spec.slowRelease)}` : "none (the ramp back up)"}${spec.bass ? `, a bass stage over ${formatProLTime(spec.bass)}` : ""}${spec.emphasis ? `, up to ${db(spec.emphasis)} of transient emphasis` : ""}.`,
    `Knobs: gain ${db(proL.gain)}, output ${db(proL.output)} (${proL.truePeak ? "dBTP: true peak limiting" : "sample peak"}), lookahead ${formatProLTime(proL.lookahead)}, ${spec.timed ? `attack ${formatProLTime(proL.attack)}, release ${formatProLTime(proL.release)}` : "attack and release unused by this style"}, hold ${proL.hold === null ? "auto" : formatProLTime(proL.hold)}.`,
    proL.stereo === "ms" ? `Stereo: mid/side, the side down to ${db(proL.sideFloor)} first.` : `Stereo: left/right, transients ${percent(proL.linkTransients)} linked, release ${percent(proL.linkRelease)}.`,
    proL.clip
      ? `Clip stage: on, ${proL.clipOrder === "first" ? `clipping ${db(proL.clipRange)} over the ceiling, before the limiter` : `after the limiter (which holds ${db(proL.clipRange)} over), clipping at the ceiling`}, ${proL.clipShape}${proL.clipShape === "smooth" ? ` (knee ${round(proL.clipKnee)} dB)` : ""}.`
      : "Clip stage: off.",
    `Oversampling ${proL.oversampling === 1 ? "off" : `${proL.oversampling}×`}${proL.clip && proL.oversampling < 4 ? " (the clip stage runs at 4×)" : ""}, dither ${proL.dither ? `${proL.dither} bits (${proL.noiseShaping})` : "off"}${proL.dcFilter ? ", DC filter" : ""}${proL.unityGain ? ", Unity Gain (heard at the level it came in)" : ""}${proL.audition !== "off" ? `, auditioning ${proL.audition === "all" ? "what it takes away" : `the ${proL.audition === "clip" ? "clip stage's" : "limiter's"} share`}` : ""}.`,
    `Latency about ${formatProLTime(proLLatencySeconds(proL))}${live ? ` (${live.latency} samples, compensated)` : ""}.`,
  ];
  if (live?.loudness) {
    const l = live.loudness;
    const plr = l.integrated > -119 && l.maxTruePeak > -119 ? `, PLR ${round(l.maxTruePeak - l.integrated)} dB` : "";
    lines.push(
      `Meter (target ${proL.meter.target} LUFS${l.paused ? ", paused" : ""}, ${round(l.seconds)} s measured): Momentary ${reading(l.momentary, "LUFS")}, Short-term ${reading(l.shortTerm, "LUFS")}, Integrated ${reading(l.integrated, "LUFS")}, ` +
        `range ${round(l.range)} LU${l.seconds < 60 ? " (settles after a minute)" : ""}, max Momentary ${reading(l.maxMomentary, "LUFS")}, max Short-term ${reading(l.maxShortTerm, "LUFS")}, max true peak ${reading(l.maxTruePeak, "dBTP")}${plr}.`,
      `Reduction: now ${db(-live.reduction)}, the most ${db(-live.maxReduction)} by the limiter and ${db(-live.maxClip)} by the clip stage; over the last 400 ms ${percent(live.clipped)} of samples clipped and ${percent(live.density)} within 0.5 dB of the ceiling${live.density > 0.05 ? " (dense: it may distort once encoded to MP3 or AAC; more true peak headroom helps)" : ""}.`,
    );
  } else lines.push("Meter: nothing measured yet (it measures while the song plays).");
  lines.push(`Styles: ${PRO_L_STYLES.join(", ")}.`);
  lines.push(`Presets: ${PRO_L_PRESETS.map((p) => p.name).join(", ")}.`);
  return lines.join("\n");
}

function number(input: Input, key: string, min: number, max: number): number | undefined {
  const value = input[key];
  if (value === undefined) return undefined;
  if (!isFiniteNumber(value) || value < min || value > max) throw new Error(`"${key}" must be a number from ${min} to ${max}.`);
  return value;
}
function choice<T extends string | number>(input: Input, key: string, list: readonly T[]): T | undefined {
  const value = input[key];
  if (value === undefined) return undefined;
  if (!list.includes(value as T)) throw new Error(`"${key}" must be one of: ${list.join(", ")}.`);
  return value as T;
}
const ms = (input: Input, key: string, min: number, max: number) => {
  const v = number(input, key, min * 1000, max * 1000);
  return v === undefined ? undefined : v / 1000;
};

/** update_pro_l: a preset, a style, knobs, the clip stage, delivery, A/B. */
export function updateProLTool(song: MusicProject, input: Input): EditResult {
  const { effect, proL } = findProLRef(song, input);
  const id = effect.id;
  let next = song;
  const done: string[] = [];
  // Lock Output first, so a preset loaded with it keeps the delivery settings.
  if (typeof input.lockOutput === "boolean") next = updateProL(next, id, { lockOutput: input.lockOutput });
  if (input.preset !== undefined) {
    const preset = PRO_L_PRESETS.find((p) => p.name.toLowerCase() === String(input.preset).toLowerCase());
    if (!preset) throw new Error(`There's no preset "${String(input.preset)}". The presets: ${PRO_L_PRESETS.map((p) => p.name).join(", ")}.`);
    next = chooseProLPreset(next, id, preset.name);
    done.push(`loaded "${preset.name}"`);
  }
  const patch: ProLPatch = {};
  const set = <K extends keyof ProLPatch>(key: K, value: ProLPatch[K] | undefined) => {
    if (value !== undefined) patch[key] = value;
  };
  set("style", choice(input, "style", PRO_L_STYLES));
  set("gain", number(input, "gain", PRO_L_GAIN_RANGE[0], PRO_L_GAIN_RANGE[1]));
  set("output", number(input, "output", PRO_L_OUTPUT_RANGE[0], PRO_L_OUTPUT_RANGE[1]));
  const style = patch.style ?? proL.style;
  const range = PRO_L_STYLE_SPECS[style].range;
  set("lookahead", ms(input, "lookahead", 0, range));
  set("attack", ms(input, "attack", 0, PRO_L_MAX_TIME));
  set("release", ms(input, "release", 0, PRO_L_MAX_TIME));
  if (input.hold !== undefined) patch.hold = input.hold === "auto" || input.hold === null ? null : ms(input, "hold", 0, PRO_L_MAX_HOLD);
  set("stereo", choice(input, "stereo", ["lr", "ms"] as const));
  set("linkTransients", number(input, "linkTransients", 0, 1));
  set("linkRelease", number(input, "linkRelease", 0, 1));
  set("sideFloor", number(input, "sideFloor", PRO_L_SIDE_FLOOR_RANGE[0], PRO_L_SIDE_FLOOR_RANGE[1]));
  set("clipRange", number(input, "clipRange", 0, PRO_L_MAX_CLIP_RANGE));
  set("clipShape", choice(input, "clipShape", PRO_L_CLIP_SHAPES));
  set("clipKnee", number(input, "clipKnee", 0, PRO_L_MAX_CLIP_KNEE));
  set("clipOrder", choice(input, "clipOrder", ["first", "last"] as const));
  set("oversampling", choice(input, "oversampling", PRO_L_OVERSAMPLING));
  set("dither", choice(input, "dither", PRO_L_DITHER));
  set("noiseShaping", choice(input, "noiseShaping", PRO_L_NOISE_SHAPINGS));
  set("audition", choice(input, "audition", ["off", "all", "clip", "limiter"] as const));
  for (const key of ["clip", "truePeak", "dcFilter", "unityGain"] as const) if (typeof input[key] === "boolean") patch[key] = input[key] as boolean;
  const target = number(input, "target", PRO_L_TARGET_RANGE[0], PRO_L_TARGET_RANGE[1]);
  if (target !== undefined) patch.meter = { target };
  if (Object.keys(patch).length) {
    next = updateProL(next, id, patch);
    done.push(`set ${Object.keys(patch).join(", ")}`);
  }
  const ab = choice(input, "ab", ["switch", "copy"] as const);
  if (ab === "switch") {
    next = switchProLAB(next, id);
    done.push(`switched to ${findProL(next, id)!.proL.slot.toUpperCase()}`);
  } else if (ab === "copy") {
    next = copyProLAB(next, id);
    done.push(`copied ${proL.slot.toUpperCase()} to the other side`);
  }
  if (typeof input.lockOutput === "boolean") done.unshift(`Lock Output ${input.lockOutput ? "on" : "off"}`);
  if (!done.length) throw new Error("Nothing to change: give a preset, a style, a knob or a switch (see the tool's fields).");
  return { song: next, text: `${done.join("; ")}.\n${describeProL(next, { effect: id })}` };
}
