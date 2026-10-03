/**
 * The assistant's PanMan (`shared/music/tools.ts`: get_panman, update_panman, set_panman_pattern): pure
 * `(song, input) => { song, text }` edits like the rest of `tool-edits.ts`, and what get_panman says. For
 * the model, positions are degrees (0 the centre, ±90 hard, ±105 beyond the speakers), times beats and
 * milliseconds. Errors say what's wrong and what would work.
 */
import type { EnginePanState } from "@shared/music/engine";
import { isFiniteNumber } from "@shared/math";
import { findPanMan, isPatternMode, isRhythmMode, isTriggerMode, loadPanPreset, panEdited, panMans, type PanManPatch, updatePanMan } from "@shared/music/panman";
import {
  MAX_PAN_BARS,
  MAX_PAN_BEATS_PER_BAR,
  MAX_PAN_CUTOFF,
  MAX_PAN_DIVIDER,
  MAX_PAN_FILTER_GAIN,
  MAX_PAN_GAIN,
  MAX_PAN_RATE,
  MAX_PAN_RATE_MOD,
  MAX_PAN_STEPS,
  MAX_PAN_TEMPO,
  MAX_PAN_TIME,
  MAX_PAN_WIDTH,
  MIN_PAN_CUTOFF,
  MIN_PAN_LEVEL,
  MIN_PAN_RATE,
  MIN_PAN_STEPS,
  MIN_PAN_TEMPO,
  PANMAN_PRESETS,
  PAN_CURVES,
  PAN_LIMIT,
  PAN_MODES,
  PAN_RHYTHMS,
  PAN_STYLES,
  degreesText,
  panPreset,
  panRhythm,
  patternTicks,
} from "@shared/music/panman-presets";
import { type MusicProject, type PanCurve, type PanManMode, type PanStyle, PPQ } from "@shared/music/types";
import { findTrack, trackLabel } from "../mixer/tool-edits";
import type { EditResult } from "../tool-edits";

type Input = Record<string, unknown>;

const round = (n: number, digits = 2) => Math.round(n * 10 ** digits) / 10 ** digits;
const modeName = (mode: PanManMode) => PAN_MODES.find((m) => m.id === mode)!.name;

/**
 * The PanMan an input names: by `effect` (its id), by `track` (the track's PanMan; with `effectSlot`, the
 * one in that slot), or the song's only one. The error lists the song's.
 */
export function findPan(song: MusicProject, input: Input) {
  const all = panMans(song);
  const list = () =>
    all.length ? `The song's PanMen: ${all.map((p) => `${p.effect.id} (${trackLabel(song, p.track)}, slot ${p.slot + 1})`).join(", ")}.` : 'The song has none: add_mixer_effect with plugin "YT-Pan" puts one on a track.';
  if (typeof input.effect === "string" && input.effect.trim()) {
    const found = findPanMan(song, input.effect.trim());
    if (!found) throw new Error(`There's no YT-Pan "${input.effect}". ${list()}`);
    return found;
  }
  if (input.track !== undefined && input.track !== "") {
    const track = findTrack(song, input.track);
    const on = all.filter((p) => p.track.id === track.id && (!Number.isInteger(input.effectSlot) || p.slot === (input.effectSlot as number) - 1));
    if (!on.length) throw new Error(`${trackLabel(song, track)} has no YT-Pan${Number.isInteger(input.effectSlot) ? ` in slot ${String(input.effectSlot)}` : ""}. ${list()}`);
    return on[0];
  }
  if (all.length === 1) return all[0];
  throw new Error(`Say which YT-Pan ("effect" or "track"). ${list()}`);
}

/** What a PanMan does, said for the model (and its knobs, and where it is now if the engine has said). */
export function describePanMan(song: MusicProject, input: Input, now?: EnginePanState): string {
  const { track, slot, effect, panMan: pm } = findPan(song, input);
  const rhythm = panRhythm(pm.rhythm).name;
  const moves =
    pm.mode === "lfo"
      ? `an LFO at ${round(pm.rate)} Hz, ${pm.direction === "both" ? "back and forth" : pm.direction === "down" ? "right to left" : "left to right"}`
      : pm.mode === "rhythmStep"
        ? pm.custom
          ? `its own step pattern (${pm.stepPattern.points.length} points over ${pm.stepPattern.bars} bar(s) of ${pm.stepPattern.beatsPerBar} beats)`
          : `${pm.steps} steps ${pm.direction === "both" ? "back and forth" : pm.direction === "down" ? "right to left" : "left to right"}, a ${rhythm} each`
        : pm.mode === "rhythmShape"
          ? pm.custom
            ? `its own rhythm (${pm.shapePattern.events.length} events over ${pm.shapePattern.bars} bar(s)), each a cycle ${pm.direction === "both" ? "there and back" : pm.direction === "down" ? "right to left" : "left to right"}`
            : `a cycle ${pm.direction === "both" ? "there and back" : pm.direction === "down" ? "right to left" : "left to right"} every ${rhythm}`
          : pm.mode === "random"
            ? `a random place every ${rhythm}`
            : pm.mode === "pingPong"
              ? `side to side on every ${pm.divider === 1 ? "" : `${pm.divider}th `}hit over ${pm.trigger >= -0.01 ? "(off)" : `${round(pm.trigger, 1)} dB`}`
              : `a random place on every ${pm.divider === 1 ? "" : `${pm.divider}th `}hit over ${pm.trigger >= -0.01 ? "(off)" : `${round(pm.trigger, 1)} dB`}`;
  const lines = [
    `YT-Pan ${effect.id}, slot ${slot + 1} of ${trackLabel(song, track)}${effect.enabled ? "" : " (bypassed)"}. Preset "${pm.preset}"${panEdited(pm) ? " (changed)" : ""}.`,
    `Mode ${pm.mode} (${modeName(pm.mode)}): ${moves}${isRhythmMode(pm.mode) ? (pm.sync ? ", in time with the song" : ` at ${round(pm.tempo, 1)} BPM`) : ""}.`,
    `Offset ${degreesText(pm.offset)}, width ${Math.round(pm.width)}°, smoothing ${Math.round(pm.smoothing * 100)}%` +
      (pm.mode === "rhythmStep" ? `, feel ${round(pm.feel)}, smoothing mode ${pm.stepPattern.curve}` : pm.mode === "rhythmShape" ? `, groove ${round(pm.groove)}` : "") +
      `. Style ${pm.style}, input ${round(pm.input, 1)} dB, output ${round(pm.output, 1)} dB.`,
  ];
  if (isPatternMode(pm.mode) && (pm.offsetMod || pm.widthMod || pm.rateMod))
    lines.push(
      `Dynamics (${pm.gate ? "gate" : "env"}, threshold ${round(pm.threshold, 1)} dB, attack ${Math.round(pm.attack * 1000)} ms, release ${Math.round(pm.release * 1000)} ms): offset ${round(pm.offsetMod)}°, width ${round(pm.widthMod)}°, rate ${round(pm.rateMod)} octaves at full level.`,
    );
  if (isTriggerMode(pm.mode)) lines.push(`Trigger filter ${pm.filter}${pm.filter === "off" ? "" : ` at ${Math.round(pm.cutoff)} Hz`}, gain ${round(pm.filterGain, 1)} dB${pm.monitor ? ", monitoring the filter" : ""}.`);
  if (pm.custom && pm.mode === "rhythmStep") lines.push(`Points: ${pm.stepPattern.points.map((p) => `{ beat ${round(p.tick / PPQ, 3)}, position ${round(p.value)} }`).join(" ")}`);
  if (pm.custom && pm.mode === "rhythmShape") lines.push(`Events: ${pm.shapePattern.events.map((e) => `{ beat ${round(e.tick / PPQ, 3)}, length ${round(e.length / PPQ, 3)} }`).join(" ")}`);
  if (now) lines.push(`Now: at ${degreesText(now.position)}, between ${degreesText(now.least)} and ${degreesText(now.most)} lately.`);
  lines.push(`Presets: ${PANMAN_PRESETS.map((p) => p.name).join(", ")}.`);
  return lines.join("\n");
}

/** update_panman: a preset first, then each control given (in its units, checked against its range). */
export function updatePanManTool(song: MusicProject, input: Input): EditResult {
  const { effect } = findPan(song, input);
  let next = song;
  if (input.preset !== undefined) {
    const found = typeof input.preset === "string" ? panPreset(input.preset) : null;
    if (!found) throw new Error(`There's no preset "${String(input.preset)}". The presets: ${PANMAN_PRESETS.map((p) => p.name).join(", ")}.`);
    next = loadPanPreset(next, effect.id, found.name);
  }
  const patch: PanManPatch = {};
  const number = (key: string, min: number, max: number, scale = 1): number | undefined => {
    const v = input[key];
    if (v === undefined) return undefined;
    if (!isFiniteNumber(v) || v < min || v > max) throw new Error(`"${key}" must be a number from ${min} to ${max}.`);
    return v * scale;
  };
  const choice = <T extends string>(key: string, list: readonly T[]): T | undefined => {
    const v = input[key];
    if (v === undefined) return undefined;
    if (!list.includes(v as T)) throw new Error(`"${key}" must be one of: ${list.join(", ")}.`);
    return v as T;
  };
  const flag = (key: string): boolean | undefined => {
    const v = input[key];
    if (v === undefined) return undefined;
    if (typeof v !== "boolean") throw new Error(`"${key}" must be true or false.`);
    return v;
  };
  const whole = (key: string, min: number, max: number) => {
    const v = number(key, min, max);
    if (v !== undefined && !Number.isInteger(v)) throw new Error(`"${key}" must be a whole number from ${min} to ${max}.`);
    return v;
  };
  patch.mode = choice("mode", PAN_MODES.map((m) => m.id));
  patch.offset = number("offset", -PAN_LIMIT, PAN_LIMIT);
  patch.width = number("width", 0, MAX_PAN_WIDTH);
  patch.smoothing = number("smoothing", 0, 1);
  patch.feel = number("feel", -1, 1);
  patch.groove = number("groove", -1, 1);
  patch.rate = number("rate", MIN_PAN_RATE, MAX_PAN_RATE);
  patch.direction = choice("direction", ["down", "both", "up"] as const);
  patch.rhythm = choice("rhythm", PAN_RHYTHMS.map((r) => r.id));
  patch.steps = whole("steps", MIN_PAN_STEPS, MAX_PAN_STEPS);
  patch.custom = flag("custom");
  patch.sync = flag("sync");
  patch.tempo = number("tempo", MIN_PAN_TEMPO, MAX_PAN_TEMPO);
  patch.trigger = number("trigger", MIN_PAN_LEVEL, 0);
  patch.divider = whole("divider", 1, MAX_PAN_DIVIDER);
  patch.filter = choice("filter", ["hpf", "off", "lpf"] as const);
  patch.cutoff = number("cutoff", MIN_PAN_CUTOFF, MAX_PAN_CUTOFF);
  patch.filterGain = number("filterGain", -MAX_PAN_FILTER_GAIN, MAX_PAN_FILTER_GAIN);
  patch.monitor = flag("monitor");
  patch.threshold = number("threshold", MIN_PAN_LEVEL, 0);
  patch.attack = number("attack", 0, MAX_PAN_TIME * 1000, 1 / 1000);
  patch.release = number("release", 0, MAX_PAN_TIME * 1000, 1 / 1000);
  patch.gate = flag("gate");
  patch.offsetMod = number("offsetMod", -PAN_LIMIT, PAN_LIMIT);
  patch.widthMod = number("widthMod", -MAX_PAN_WIDTH, MAX_PAN_WIDTH);
  patch.rateMod = number("rateMod", -MAX_PAN_RATE_MOD, MAX_PAN_RATE_MOD);
  patch.style = choice<PanStyle>("style", PAN_STYLES.map((s) => s.id));
  patch.input = number("input", -MAX_PAN_GAIN, MAX_PAN_GAIN);
  patch.output = number("output", -MAX_PAN_GAIN, MAX_PAN_GAIN);
  const curve = choice<PanCurve>("smoothingMode", PAN_CURVES.map((c) => c.id));
  if (curve) patch.stepPattern = { curve };
  // A rhythm chosen plays the knobs' pattern (as PanMan's Rhythm menu does), unless `custom` says.
  if (patch.rhythm !== undefined && patch.custom === undefined) patch.custom = false;
  const defined = Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)) as PanManPatch;
  if (!Object.keys(defined).length && input.preset === undefined) throw new Error("Nothing to change: give a preset, a mode or a control.");
  next = updatePanMan(next, effect.id, defined);
  return { song: next, text: describePanMan(next, { effect: effect.id }).split("\n").slice(0, 3).join("\n") };
}

/** set_panman_pattern: a Rhythm Step pattern's points or a Rhythm Shape's events, played as the PanMan's own. */
export function setPanPatternTool(song: MusicProject, input: Input): EditResult {
  const { effect, panMan: pm } = findPan(song, input);
  if (input.editor !== "step" && input.editor !== "shape") throw new Error('"editor" must be "step" (points, Rhythm Step) or "shape" (events, Rhythm Shape).');
  const editor = input.editor;
  const was = editor === "step" ? pm.stepPattern : pm.shapePattern;
  const layout = (key: "bars" | "beatsPerBar", max: number) => {
    const v = input[key];
    if (v === undefined) return was[key];
    if (!Number.isInteger(v) || (v as number) < 1 || (v as number) > max) throw new Error(`"${key}" must be a whole number from 1 to ${max}.`);
    return v as number;
  };
  const bars = layout("bars", MAX_PAN_BARS);
  const beatsPerBar = layout("beatsPerBar", MAX_PAN_BEATS_PER_BAR);
  const beats = bars * beatsPerBar;
  const length = patternTicks({ bars, beatsPerBar });
  const items = (key: string) => {
    const list = input[key];
    if (!Array.isArray(list) || !list.length) throw new Error(`"${key}" must be a list (${key === "points" ? "{ beat, position }" : "{ beat, length }"}), for ${editor === "step" ? "the step" : "the shape"} editor.`);
    return list.map((raw) => (raw && typeof raw === "object" ? raw : {}) as Input);
  };
  let patch: PanManPatch;
  if (editor === "step") {
    const points = items("points").map((p, i) => {
      if (!isFiniteNumber(p.beat) || p.beat < 0 || p.beat >= beats) throw new Error(`Point ${i + 1}: "beat" must be from 0 to under ${beats} (${bars} bar(s) of ${beatsPerBar} beats).`);
      if (!isFiniteNumber(p.position) || Math.abs(p.position) > 1) throw new Error(`Point ${i + 1}: "position" must be -1 (left of the width) to 1 (right).`);
      return { tick: Math.round(p.beat * PPQ), value: p.position };
    });
    const ticks = new Set(points.map((p) => p.tick));
    if (ticks.size < points.length) throw new Error("Two points are on one beat: each needs its own.");
    patch = { mode: "rhythmStep", custom: true, stepPattern: { bars, beatsPerBar, points } };
  } else {
    const events = items("events")
      .map((e, i) => {
        if (!isFiniteNumber(e.beat) || e.beat < 0 || e.beat >= beats) throw new Error(`Event ${i + 1}: "beat" must be from 0 to under ${beats}.`);
        if (!isFiniteNumber(e.length) || e.length <= 0) throw new Error(`Event ${i + 1}: "length" must be more than 0 beats.`);
        return { tick: Math.round(e.beat * PPQ), length: Math.round(e.length * PPQ) };
      })
      .sort((a, b) => a.tick - b.tick);
    for (let i = 1; i < events.length; i++) if (events[i - 1].tick + events[i - 1].length > events[i].tick) throw new Error(`Event ${i} runs into event ${i + 1}: events can't overlap.`);
    if (events.some((e) => e.tick + e.length > length)) throw new Error(`An event runs past the pattern's end (${beats} beats).`);
    patch = { mode: "rhythmShape", custom: true, shapePattern: { bars, beatsPerBar, events } };
  }
  const next = updatePanMan(song, effect.id, patch);
  return { song: next, text: describePanMan(next, { effect: effect.id }) };
}

