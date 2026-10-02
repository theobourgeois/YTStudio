/**
 * The assistant's EchoBoy (`shared/music/tools.ts`: get_echo_boy, update_echo_boy): pure `(song, input) =>
 * { song, text }` edits like the rest of `tool-edits.ts`, and what get_echo_boy says. For the model, times
 * are "1/8", "1/8 dot", "1/16 tri" or ms; levels are dB; frequencies Hz; knobs 0 to 1 or -1 to 1 as their
 * ends say. Errors say what's wrong and what would work.
 */
import { isFiniteNumber } from "@shared/math";
import {
  type EchoBoyPatch,
  RHYTHM_PATTERNS,
  echoBoys,
  echoMs,
  echoTempo,
  editStyle,
  editTaps,
  feedbackGain,
  findEchoBoy,
  heardTaps,
  layOutRhythm,
  parseEchoTime,
  revertStyle,
  styleLabel,
  styleOf,
  timeText,
  updateEchoBoy,
  updateRhythm,
  usePattern,
} from "@shared/music/echo-boy";
import { ECHO_PRESETS, PRESET_FOLDERS, loadPreset } from "@shared/music/echo-boy-library";
import { HIGH_CUT_RANGE, LOW_CUT_RANGE, normalizeEchoStyle } from "@shared/music/echo-boy-presets";
import { ECHO_STYLES, decayDb } from "@shared/music/echo-boy-styles";
import { ECHO_MODES, ECHO_NOTES, type EchoBoy, type EchoRhythm, type EchoTime, type MusicProject, PAN_SHAPES, RHYTHM_SHAPES } from "@shared/music/types";
import { findTrack, trackLabel } from "../mixer/tool-edits";
import type { EditResult } from "../tool-edits";

type Input = Record<string, unknown>;

const round = (n: number, digits = 2) => Math.round(n * 10 ** digits) / 10 ** digits;
const percent = (v: number) => `${Math.round(v * 100)}%`;
const db = (v: number) => `${v > 0 ? "+" : ""}${round(v, 1)} dB`;
const hz = (v: number) => (v >= 1000 ? `${round(v / 1000, 2)} kHz` : `${Math.round(v)} Hz`);

/**
 * The EchoBoy an input names: by `effect` (its id), by `track` (the track's EchoBoy; with `effectSlot`,
 * the one in that slot), or the song's only one. The error lists the song's.
 */
export function findEcho(song: MusicProject, input: Input) {
  const all = echoBoys(song);
  const list = () =>
    all.length ? `The song's EchoBoys: ${all.map((e) => `${e.effect.id} (${trackLabel(song, e.track)}, slot ${e.slot + 1})`).join(", ")}.` : 'The song has none: add_mixer_effect with plugin "EchoBoy" puts one on a track.';
  if (typeof input.effect === "string" && input.effect.trim()) {
    const found = findEchoBoy(song, input.effect.trim());
    if (!found) throw new Error(`There's no EchoBoy "${input.effect}". ${list()}`);
    return found;
  }
  if (input.track !== undefined && input.track !== "") {
    const track = findTrack(song, input.track);
    const on = all.filter((e) => e.track.id === track.id && (!Number.isInteger(input.effectSlot) || e.slot === (input.effectSlot as number) - 1));
    if (!on.length) throw new Error(`${trackLabel(song, track)} has no EchoBoy${Number.isInteger(input.effectSlot) ? ` in slot ${String(input.effectSlot)}` : ""}. ${list()}`);
    return on[0];
  }
  if (all.length === 1) return all[0];
  throw new Error(`Say which EchoBoy ("effect" or "track"). ${list()}`);
}

const MODE_NAMES = { single: "Single Echo", dual: "Dual Echo", pingPong: "Ping-Pong", rhythm: "Rhythm Echo" } as const;

/** An echo's time said with what it is at the tempo: "1/8 dot (375 ms)". */
const said = (time: EchoTime, bpm: number) => (time.sync === "time" ? timeText(time) : `${timeText(time)} (${round(echoMs(time, bpm), 1)} ms)`);

/** What get_echo_boy says: the whole EchoBoy, its mode's own controls, its style (and its settings), the styles and presets to choose from. */
export function describeEchoBoy(song: MusicProject, input: Input): string {
  const { effect, track, slot, echoBoy: eb } = findEcho(song, input);
  const bpm = echoTempo(eb, song.settings.tempo);
  const lines = [`EchoBoy ${effect.id} on ${trackLabel(song, track)}, slot ${slot + 1}${effect.enabled ? "" : " (bypassed)"}${eb.preset ? `, preset "${eb.preset}"` : ""}.`];
  lines.push(`Mode: ${MODE_NAMES[eb.mode]}.`);
  if (eb.mode === "single") lines.push(`Echo time: ${said(eb.echo1, bpm)}.`);
  if (eb.mode === "dual") lines.push(`Echo 1 (left): ${said(eb.echo1, bpm)}. Echo 2 (right): ${said(eb.echo2, bpm)}.`);
  if (eb.mode === "pingPong") lines.push(`Ping (left): ${said(eb.echo1, bpm)}. Pong (right, after Ping): ${said(eb.echo2, bpm)}.`);
  lines.push(
    `Mix ${percent(eb.mix)} (0.5: dry and echo both full; above, less dry), feedback ${percent(eb.feedback)} (each repeat ${percent(feedbackGain(eb.feedback))} of the last), ` +
      `low cut ${eb.lowCut <= LOW_CUT_RANGE[0] + 0.5 ? "off" : hz(eb.lowCut)}, high cut ${eb.highCut >= HIGH_CUT_RANGE[1] - 1 ? "off" : hz(eb.highCut)}, prime numbers ${eb.primeNumbers ? "on" : "off"}.`,
  );
  lines.push(`Saturation ${percent(eb.saturation)} (50% is the style as made), input ${db(eb.input)}, output ${db(eb.output)} (the echo only).`);
  lines.push(`Tempo: ${eb.followTempo ? `the song's (${song.settings.tempo} BPM)` : `its own, ${eb.bpm} BPM`}. Groove ${round(eb.groove)} (-1 shuffle .. 1 swing), feel ${round(eb.feel)} (-1 rushin' .. 1 draggin', ±30 ms).`);
  const tweak: Record<EchoBoy["mode"], string> = {
    single: `width ${percent(eb.width)}, L/R offset ${round(eb.offset, 1)} ms, accent ${round(eb.accent)}`,
    dual: `balance ${round(eb.balance)}, width ${percent(eb.width)}, L/R offset ${round(eb.offset, 1)} ms, accent 1 ${round(eb.accent)}, accent 2 ${round(eb.accent2)}, FB mix ${round(eb.feedbackMix)}, FB balance ${round(eb.feedbackBalance)}`,
    pingPong: `width ${percent(eb.width)}, balance ${round(eb.balance)}, accent ${round(eb.accent)}`,
    rhythm: `width ${percent(eb.width)}, L/R offset ${round(eb.offset, 1)} ms`,
  };
  lines.push(`Tweak: ${tweak[eb.mode]}.`);
  if (eb.mode === "rhythm") {
    const r = eb.rhythm;
    const heard = heardTaps(eb, bpm);
    lines.push(
      `Rhythm: pattern "${r.pattern}", ${r.length} beats long (fed back whole), the Rhythm knob at ${said(r.time, bpm)}, ${r.repeats} repeats; grid 1/${r.grid}; shape ${r.shape} at ${percent(r.shapeAmount)}; ` +
        `pan shape ${r.panShape}; ${r.time.sync === "time" ? "warp" : "accent"} ${round(r.accent)}.`,
    );
    lines.push(`  taps (beat: level as stored → as heard): ${r.taps.map((t, i) => `${round(t.beat, 3)}: ${round(t.level)} → ${round(heard[i]?.level ?? 0)}${t.beat === 0 ? " (the One)" : ""}`).join("; ")}`);
  }
  const style = ECHO_STYLES.find((s) => s.name === eb.style);
  lines.push(`Style: ${styleLabel(eb)}${eb.custom ? ` (edited from ${eb.style})` : style ? `: ${style.about}` : ""}.`);
  if (eb.custom || input.style === true) {
    const s = styleOf(eb);
    const band = (name: string, b: { freq: number; gain: number; decay: number }) => `${name} ${hz(b.freq)} gain ${db(b.gain)} decay ${round(b.decay, 1)} (${db(decayDb(b.decay))} a repeat)`;
    lines.push(`  EQ: ${band("low shelf", s.low)}; ${band("mid peak", s.mid)} res ${round(s.mid.res, 1)}; ${band("high shelf", s.high)}.`);
    lines.push(`  Diffusion ${percent(s.diffusion.amount)}, size ${round(s.diffusion.size, 1)}, ${s.diffusion.loop ? "in the loop" : "after it"}.`);
    lines.push(`  Wobble ${round(s.wobble.depth, 1)} cents at ${round(s.wobble.rate)} Hz, ${s.wobble.shape}, sync ${round(s.wobble.sync)}, on the repeats ${s.wobble.feedback ? "yes" : "no"}, on the output ${s.wobble.out ? "yes" : "no"}.`);
    lines.push(`  Saturation ${s.saturation.type}: decay sat ${db(s.saturation.decay)}, out sat ${db(s.saturation.out)}.`);
  }
  lines.push(`Styles: ${ECHO_STYLES.map((s) => s.name).join(", ")}.`);
  lines.push(`Presets: ${PRESET_FOLDERS.map((f) => `${f}: ${ECHO_PRESETS.filter((p) => p.folder === f).map((p) => p.name).join(", ")}`).join("; ")}.`);
  return lines.join("\n");
}

const unit = (name: string, v: unknown, min: number, max: number) => {
  if (v === undefined) return undefined;
  if (!isFiniteNumber(v) || v < min || v > max) throw new Error(`"${name}" must be a number from ${min} to ${max}.`);
  return v;
};

/** An echo time from the model: "1/8", "1/8 dot", "1/16 tri", "350 ms", or a number of ms. */
function timeOf(name: string, v: unknown): Partial<EchoTime> | undefined {
  if (v === undefined) return undefined;
  const parsed = typeof v === "number" ? parseEchoTime(String(v)) : typeof v === "string" ? parseEchoTime(v) : null;
  if (!parsed) throw new Error(`"${name}" must be a note value ("1/8", "1/8 dot", "1/16 tri": 1/2 to 1/64) or milliseconds ("350 ms", up to 15000).`);
  return parsed;
}

/** A cut from the model: Hz, or "off". */
function cutOf(name: string, v: unknown, range: readonly [number, number], off: number): number | undefined {
  if (v === undefined) return undefined;
  if (v === "off" || v === null) return off;
  if (!isFiniteNumber(v) || v < range[0] || v > range[1]) throw new Error(`"${name}" must be Hz, ${range[0]} to ${range[1]}, or "off".`);
  return v;
}

/** update_echo_boy: a preset (first), then the controls given, the rhythm and the Style Editor's changes. */
export function updateEchoBoyTool(song: MusicProject, input: Input): EditResult {
  const { effect } = findEcho(song, input);
  const id = effect.id;
  const done: string[] = [];
  let next = song;
  if (input.preset !== undefined) {
    const preset = ECHO_PRESETS.find((p) => p.name.toLowerCase() === String(input.preset).toLowerCase());
    if (!preset) throw new Error(`There's no preset "${String(input.preset)}". The presets: ${ECHO_PRESETS.map((p) => p.name).join(", ")}.`);
    next = loadPreset(next, id, preset.name);
    done.push(`loaded "${preset.name}"`);
  }
  if (input.mode !== undefined && !ECHO_MODES.includes(input.mode as EchoBoy["mode"])) throw new Error(`"mode" must be one of: ${ECHO_MODES.join(", ")}.`);
  if (input.style !== undefined && !ECHO_STYLES.some((s) => s.name.toLowerCase() === String(input.style).toLowerCase()))
    throw new Error(`There's no style "${String(input.style)}". The styles: ${ECHO_STYLES.map((s) => s.name).join(", ")}.`);
  let tempo: Pick<EchoBoyPatch, "followTempo" | "bpm"> = {};
  if (input.tempo !== undefined) {
    if (input.tempo === "song") tempo = { followTempo: true };
    else if (isFiniteNumber(input.tempo) && input.tempo >= 30 && input.tempo <= 300) tempo = { followTempo: false, bpm: input.tempo };
    else throw new Error('"tempo" must be "song" (follow the song\'s) or EchoBoy\'s own BPM, 30 to 300.');
  }
  const patch: EchoBoyPatch = {
    mode: input.mode as EchoBoy["mode"] | undefined,
    echo1: timeOf("echo1", input.echo1),
    echo2: timeOf("echo2", input.echo2),
    mix: unit("mix", input.mix, 0, 1),
    feedback: unit("feedback", input.feedback, 0, 1),
    lowCut: cutOf("lowCut", input.lowCut, LOW_CUT_RANGE, LOW_CUT_RANGE[0]),
    highCut: cutOf("highCut", input.highCut, HIGH_CUT_RANGE, HIGH_CUT_RANGE[1]),
    primeNumbers: typeof input.primeNumbers === "boolean" ? input.primeNumbers : undefined,
    saturation: unit("saturation", input.saturation, 0, 1),
    input: unit("input", input.input, -24, 24),
    output: unit("output", input.output, -24, 24),
    style: input.style !== undefined ? ECHO_STYLES.find((s) => s.name.toLowerCase() === String(input.style).toLowerCase())!.name : undefined,
    groove: unit("groove", input.groove, -1, 1),
    feel: unit("feel", input.feel, -1, 1),
    width: unit("width", input.width, 0, 1),
    offset: unit("offset", input.offset, 0, 25),
    accent: unit("accent", input.accent, -1, 1),
    accent2: unit("accent2", input.accent2, -1, 1),
    balance: unit("balance", input.balance, -1, 1),
    feedbackMix: unit("feedbackMix", input.feedbackMix, 0, 1),
    feedbackBalance: unit("feedbackBalance", input.feedbackBalance, -1, 1),
    ...tempo,
  };
  const given = Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)) as EchoBoyPatch;
  if (Object.keys(given).length) {
    next = updateEchoBoy(next, id, given);
    done.push(`set ${Object.keys(given).join(", ")}`);
  }
  if (input.rhythm !== undefined) {
    next = rhythmEdit(next, id, input.rhythm);
    done.push("set the rhythm");
  }
  if (input.revertStyle === true) {
    next = revertStyle(next, id);
    done.push("dropped the style's edits");
  }
  if (input.styleEdit !== undefined) {
    if (!input.styleEdit || typeof input.styleEdit !== "object") throw new Error('"styleEdit" must be the style settings to change, e.g. { "high": { "decay": -20 }, "wobble": { "depth": 8 } }.');
    const changes = input.styleEdit as Input;
    next = editStyle(next, id, (st) => {
      const merged: Input = { ...st };
      for (const [key, value] of Object.entries(changes)) merged[key] = value && typeof value === "object" ? { ...(st as unknown as Input)[key] as object, ...value } : value;
      return normalizeEchoStyle(merged, st);
    });
    done.push("edited the style (it's Custom now)");
  }
  if (!done.length) throw new Error("Nothing to change: give a preset, the controls to set, `rhythm` or `styleEdit`.");
  return { song: next, text: `${done.join("; ")}.\n${describeEchoBoy(next, { effect: id })}` };
}

/** Rhythm Echo from the model: a pattern, the Rhythm knob and repeats (taps laid out evenly), taps of its own, its shapes. */
function rhythmEdit(song: MusicProject, id: string, raw: unknown): MusicProject {
  if (!raw || typeof raw !== "object") throw new Error('"rhythm" must be an object: { pattern, time, repeats, taps, length, shape, shapeAmount, panShape, accent, grid }.');
  const r = raw as Input;
  return updateRhythm(song, id, (rhythm, bpm) => {
    let next: EchoRhythm = { ...rhythm };
    if (r.length !== undefined) next.length = unit("rhythm.length", r.length, 1, 8)!;
    if (r.pattern !== undefined) {
      const found = RHYTHM_PATTERNS.find((p) => p.name.toLowerCase() === String(r.pattern).toLowerCase());
      if (!found) throw new Error(`There's no pattern "${String(r.pattern)}". The patterns: ${RHYTHM_PATTERNS.map((p) => p.name).join(", ")}.`);
      next = usePattern(next, found);
    }
    if (r.time !== undefined || r.repeats !== undefined) {
      const time = timeOf("rhythm.time", r.time);
      const repeats = r.repeats !== undefined ? Math.round(unit("rhythm.repeats", r.repeats, 1, 16)!) : undefined;
      next = layOutRhythm(next, bpm, { ...(time && { time: { ...next.time, ...time } }), ...(repeats !== undefined && { repeats }) });
    }
    if (r.taps !== undefined) {
      if (!Array.isArray(r.taps)) throw new Error('"rhythm.taps" must be a list of { beat, level }: beat 0 (the One) up to the pattern\'s length, level 0 to 1.');
      const taps = r.taps.map((t, i) => {
        const tap = (t ?? {}) as Input;
        if (!isFiniteNumber(tap.beat) || tap.beat < 0 || tap.beat >= next.length) throw new Error(`Tap ${i + 1}: "beat" must be 0 to under the pattern's length (${next.length} beats).`);
        return { beat: tap.beat, level: isFiniteNumber(tap.level) ? Math.min(1, Math.max(0, tap.level)) : 1 };
      });
      next = editTaps(next, taps);
    }
    if (r.shape !== undefined) {
      if (!RHYTHM_SHAPES.includes(r.shape as never)) throw new Error(`"rhythm.shape" must be one of: ${RHYTHM_SHAPES.join(", ")}.`);
      next.shape = r.shape as EchoRhythm["shape"];
    }
    if (r.shapeAmount !== undefined) next.shapeAmount = unit("rhythm.shapeAmount", r.shapeAmount, 0, 1)!;
    if (r.panShape !== undefined) {
      if (!PAN_SHAPES.includes(r.panShape as never)) throw new Error(`"rhythm.panShape" must be one of: ${PAN_SHAPES.join(", ")}.`);
      next.panShape = r.panShape as EchoRhythm["panShape"];
    }
    if (r.accent !== undefined) next.accent = unit("rhythm.accent", r.accent, -1, 1)!;
    if (r.grid !== undefined) {
      if (!ECHO_NOTES.includes(r.grid as never)) throw new Error(`"rhythm.grid" must be a note value's denominator: ${ECHO_NOTES.join(", ")}.`);
      next.grid = r.grid as EchoRhythm["grid"];
    }
    return next;
  });
}
