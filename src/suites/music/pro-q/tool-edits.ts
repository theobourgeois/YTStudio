/**
 * The assistant's Pro-Q (`shared/music/tools.ts`: get_pro_q, set_pro_q_bands, update_pro_q): pure
 * `(song, input) => { song, text }` edits like the rest of `tool-edits.ts`, and what get_pro_q says,
 * including what the curve does at the usual frequencies, so a model can see the EQ it's shaping.
 * Errors say what's wrong and what would work.
 */
import { clamp, isFiniteNumber } from "@shared/math";
import {
  MODE_NAMES,
  PLACEMENT_NAMES,
  RESOLUTION_NAMES,
  SHAPE_NAMES,
  addBand,
  applyPreset,
  copyAB,
  editProQ,
  findProQ,
  fitBand,
  frequencyText,
  gainText,
  proQs,
  qText,
  removeBands,
  slopeText,
  switchAB,
  updateProQ,
  type ProQPatch,
} from "@shared/music/pro-q";
import { autoGain, bandCurve, playedBand } from "@shared/music/pro-q-filters";
import {
  EQ_BANDS,
  EQ_DISPLAY_RANGES,
  EQ_MAX_FREQUENCY,
  EQ_MAX_GAIN,
  EQ_MAX_GAIN_SCALE,
  EQ_MAX_OUTPUT,
  EQ_MAX_Q,
  EQ_MIN_FREQUENCY,
  EQ_MIN_OUTPUT,
  EQ_MIN_Q,
  EQ_MIN_THRESHOLD,
  LINEAR_PHASE_LATENCY,
  PRO_Q_PRESETS,
  canBeDynamic,
  dynamicsInLinearPhase,
  hasGain,
  shapeSlopes,
} from "@shared/music/pro-q-presets";
import { EQ_MODES, EQ_PLACEMENTS, EQ_RESOLUTIONS, EQ_SHAPES, type EqBand, type EqPlacement, type EqShape, type EqSlope, type MusicProject, type ProQ } from "@shared/music/types";
import { findTrack, trackLabel } from "../mixer/tool-edits";
import type { EditResult } from "../tool-edits";

type Input = Record<string, unknown>;
const round = (n: number, digits = 2) => Math.round(n * 10 ** digits) / 10 ** digits;

/** The Pro-Q an input names: by `effect`, by `track` (and `effectSlot`), or the song's only one. The error lists them. */
export function findEq(song: MusicProject, input: Input) {
  const all = proQs(song);
  const list = () =>
    all.length ? `The song's Pro-Qs: ${all.map((q) => `${q.effect.id} (${trackLabel(song, q.track)}, slot ${q.slot + 1})`).join(", ")}.` : 'The song has none: add_mixer_effect with plugin "Pro-Q" puts one on a track.';
  if (typeof input.effect === "string" && input.effect.trim()) {
    const found = findProQ(song, input.effect.trim());
    if (!found) throw new Error(`There's no Pro-Q "${input.effect}". ${list()}`);
    return found;
  }
  if (input.track !== undefined && input.track !== "") {
    const track = findTrack(song, input.track);
    const on = all.filter((q) => q.track.id === track.id && (!Number.isInteger(input.effectSlot) || q.slot === (input.effectSlot as number) - 1));
    if (!on.length) throw new Error(`${trackLabel(song, track)} has no Pro-Q${Number.isInteger(input.effectSlot) ? ` in slot ${String(input.effectSlot)}` : ""}. ${list()}`);
    return on[0];
  }
  if (all.length === 1) return all[0];
  throw new Error(`Say which Pro-Q ("effect" or "track"). ${list()}`);
}

/** A band said in a line: "Band 2: Bell at 1.20 kHz, +4.50 dB, Q 1.40, 12 dB/oct". */
export function bandText(band: EqBand): string {
  const parts = [`${SHAPE_NAMES[band.shape]} at ${frequencyText(band.frequency)}`];
  if (hasGain(band.shape)) parts.push(gainText(band.gain));
  if (band.shape !== "flatTilt" && band.slope !== 6 && band.slope !== "brickwall") parts.push(`Q ${qText(band.q)}`);
  if (band.shape !== "flatTilt") parts.push(slopeText(band.slope));
  if (band.placement !== "stereo") parts.push(`on the ${PLACEMENT_NAMES[band.placement].toLowerCase()}`);
  if (band.range !== 0) parts.push(`dynamic: ${band.range > 0 ? "up" : "down"} to ${gainText(band.gain + band.range)} when loud, threshold ${band.threshold === null ? "auto" : `${band.threshold} dB`}${band.dynamics ? "" : " (dynamics bypassed)"}`);
  if (!band.enabled) parts.push("bypassed");
  return `Band ${band.id}: ${parts.join(", ")}`;
}

/** Where a Pro-Q's curve stands at the octaves' centres (stereo bands; each placement separately when there are others). */
const OCTAVES = [31.5, 63, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];
function curveText(pq: ProQ): string {
  const bands = pq.bands.filter((b) => b.enabled).map((b) => playedBand(b, pq));
  if (!bands.length) return "flat";
  const groups = new Set<EqPlacement>(["stereo", ...bands.map((b) => b.placement)]);
  const lines: string[] = [];
  for (const group of groups) {
    const total = new Float64Array(OCTAVES.length);
    for (const b of bands) {
      if (b.placement !== "stereo" && b.placement !== group) continue;
      const curve = bandCurve(b, OCTAVES);
      for (let i = 0; i < total.length; i++) total[i] += curve[i];
    }
    const said = OCTAVES.map((hz, i) => `${hz >= 1000 ? `${hz / 1000}k` : hz} ${total[i] >= 0 ? "+" : ""}${round(total[i], 1)}`).join(", ");
    lines.push(group === "stereo" ? said : `${PLACEMENT_NAMES[group]}: ${said}`);
  }
  return lines.join("; ");
}

/** get_pro_q: where it is, its mode, output and analyzer, its bands, and its curve. */
export function describeProQ(song: MusicProject, input: Input): string {
  const { track, slot, effect, proQ: pq } = findEq(song, input);
  const latency = pq.mode === "zeroLatency" ? "no latency" : pq.mode === "naturalPhase" ? "7.3 ms latency" : `${round((LINEAR_PHASE_LATENCY[pq.resolution] / 44100) * 1000, 1)} ms latency`;
  const lines = [
    `Pro-Q ${effect.id} on ${trackLabel(song, track)}, slot ${slot + 1}${effect.enabled ? "" : " (bypassed)"}${effect.mix < 1 ? `, mix ${Math.round(effect.mix * 100)}%` : ""}.`,
    `Mode: ${MODE_NAMES[pq.mode]}${pq.mode === "linearPhase" ? `, ${RESOLUTION_NAMES[pq.resolution]} resolution` : ""} (${latency}).`,
    `Output: ${pq.output <= EQ_MIN_OUTPUT ? "silent" : gainText(pq.output)}${pq.autoGain ? `, Auto Gain on (${gainText(autoGain(pq))})` : ""}${pq.pan ? `, pan ${round(pq.pan)} (${pq.panMode === "lr" ? "left/right" : "mid/side"})` : ""}${pq.invert ? ", phase inverted" : ""}; Gain Scale ${Math.round(pq.gainScale * 100)}%${pq.gainQ ? "; Gain-Q interaction on" : ""}. Editing ${pq.ab.toUpperCase()} of A/B.`,
    `Analyzer: ${[pq.analyzer.pre && "pre", pq.analyzer.post && "post"].filter(Boolean).join(" and ") || "off"}, range ${pq.analyzer.range} dB, tilt ${pq.analyzer.tilt} dB/oct.`,
  ];
  if (pq.mode === "linearPhase" && !dynamicsInLinearPhase(pq.resolution) && pq.bands.some((b) => b.range !== 0)) lines.push("Warning: dynamic bands don't play in Linear Phase above High resolution.");
  lines.push(pq.bands.length ? `${pq.bands.length} band${pq.bands.length === 1 ? "" : "s"} (of ${EQ_BANDS}):` : "No bands: it leaves the sound as it is.");
  for (const band of [...pq.bands].sort((a, b) => a.frequency - b.frequency)) lines.push(`  ${bandText(band)}`);
  lines.push(`Curve (dB at each octave's centre, Hz): ${curveText(pq)}.`);
  return lines.join("\n");
}

const oneOfText = (list: readonly string[]) => list.join(", ");

/** A band's fields from an input (what's given), checked. */
function bandPatch(raw: Input, at: string): Partial<Omit<EqBand, "id">> {
  const patch: Partial<Omit<EqBand, "id">> = {};
  if (raw.shape !== undefined) {
    if (!EQ_SHAPES.includes(raw.shape as EqShape)) throw new Error(`${at}: "shape" must be one of ${oneOfText(EQ_SHAPES)}.`);
    patch.shape = raw.shape as EqShape;
  }
  const num = (key: string, min: number, max: number) => {
    if (raw[key] === undefined) return undefined;
    if (!isFiniteNumber(raw[key])) throw new Error(`${at}: "${key}" must be a number (${min} to ${max}).`);
    return clamp(raw[key] as number, min, max);
  };
  const frequency = num("frequency", EQ_MIN_FREQUENCY, EQ_MAX_FREQUENCY);
  if (frequency !== undefined) patch.frequency = frequency;
  const gain = num("gain", -EQ_MAX_GAIN, EQ_MAX_GAIN);
  if (gain !== undefined) patch.gain = gain;
  const q = num("q", EQ_MIN_Q, EQ_MAX_Q);
  if (q !== undefined) patch.q = q;
  const range = num("range", -EQ_MAX_GAIN, EQ_MAX_GAIN);
  if (range !== undefined) patch.range = range;
  if (raw.slope !== undefined) {
    const slope = raw.slope === "brickwall" ? "brickwall" : Number(raw.slope);
    if (!(["brickwall", 6, 12, 18, 24, 30, 36, 48, 72, 96] as unknown[]).includes(slope)) throw new Error(`${at}: "slope" must be 6, 12, 18, 24, 30, 36, 48, 72 or 96 (dB/oct), or "brickwall" (cuts only).`);
    patch.slope = slope as EqSlope;
  }
  if (raw.placement !== undefined) {
    if (!EQ_PLACEMENTS.includes(raw.placement as EqPlacement)) throw new Error(`${at}: "placement" must be one of ${oneOfText(EQ_PLACEMENTS)}.`);
    patch.placement = raw.placement as EqPlacement;
  }
  if (raw.threshold !== undefined) {
    if (raw.threshold === "auto" || raw.threshold === null) patch.threshold = null;
    else if (isFiniteNumber(raw.threshold)) patch.threshold = clamp(raw.threshold, EQ_MIN_THRESHOLD, 0);
    else throw new Error(`${at}: "threshold" must be "auto" or a level in dB (${EQ_MIN_THRESHOLD} to 0).`);
  }
  if (raw.enabled !== undefined) patch.enabled = raw.enabled === true;
  if (raw.dynamics !== undefined) patch.dynamics = raw.dynamics === true;
  return patch;
}

/** set_pro_q_bands: add bands, change them by number, remove them, or start again (`clear`). */
export function setProQBandsTool(song: MusicProject, input: Input): EditResult {
  const { effect, proQ } = findEq(song, input);
  if (input.bands !== undefined && !Array.isArray(input.bands)) throw new Error('"bands" must be a list of bands.');
  let pq: ProQ = input.clear === true ? { ...proQ, bands: [] } : proQ;
  const said: string[] = [];
  for (const [i, raw] of ((input.bands as unknown[]) ?? []).entries()) {
    if (!raw || typeof raw !== "object") throw new Error(`Band ${i + 1} of the list must be an object.`);
    const item = raw as Input;
    const at = item.band !== undefined ? `Band ${String(item.band)}` : `The new band (${i + 1} of the list)`;
    if (item.band !== undefined) {
      const id = Number(item.band);
      const band = pq.bands.find((b) => b.id === id);
      if (!band) throw new Error(`There's no band ${String(item.band)}. Its bands: ${pq.bands.map((b) => b.id).join(", ") || "none"} (leave "band" out to add one).`);
      if (item.remove === true) {
        pq = removeBands(pq, [id]);
        said.push(`removed band ${id}`);
        continue;
      }
      const patch = bandPatch(item, at);
      const next = fitBand({ ...band, ...patch });
      if (patch.range && !canBeDynamic(next.shape)) throw new Error(`${at}: a ${SHAPE_NAMES[next.shape]} can't be dynamic (only Bell, the shelves and Tilt Shelf).`);
      if (patch.slope !== undefined && !shapeSlopes(next.shape).includes(patch.slope)) throw new Error(`${at}: a ${SHAPE_NAMES[next.shape]} takes slopes ${shapeSlopes(next.shape).join(", ")}.`);
      pq = { ...pq, bands: pq.bands.map((b) => (b.id === id ? next : b)) };
      said.push(bandText(next));
    } else {
      const patch = bandPatch(item, at);
      if (patch.frequency === undefined) throw new Error(`${at}: give its "frequency" (Hz).`);
      if (patch.range && !canBeDynamic(patch.shape ?? "bell")) throw new Error(`${at}: a ${SHAPE_NAMES[patch.shape ?? "bell"]} can't be dynamic (only Bell, the shelves and Tilt Shelf).`);
      const added = addBand(pq, patch);
      if (!added) throw new Error(`It has ${EQ_BANDS} bands already: remove one first.`);
      pq = added.proQ;
      said.push(`added ${bandText(pq.bands.find((b) => b.id === added.id)!)}`);
    }
  }
  const next = editProQ(song, effect.id, () => pq);
  if (next === song) return { song, text: "Nothing changed." };
  return { song: next, text: `${said.join("; ")}.\nCurve now (dB at each octave's centre): ${curveText(pq)}.` };
}

/** update_pro_q: its mode, output, Gain Scale, analyzer and display; a preset; A/B. */
export function updateProQTool(song: MusicProject, input: Input): EditResult {
  const { effect } = findEq(song, input);
  const patch: ProQPatch = {};
  if (input.mode !== undefined) {
    if (!EQ_MODES.includes(input.mode as ProQ["mode"])) throw new Error(`"mode" must be one of ${oneOfText(EQ_MODES)}.`);
    patch.mode = input.mode as ProQ["mode"];
  }
  if (input.resolution !== undefined) {
    if (!EQ_RESOLUTIONS.includes(input.resolution as ProQ["resolution"])) throw new Error(`"resolution" must be one of ${oneOfText(EQ_RESOLUTIONS)}.`);
    patch.resolution = input.resolution as ProQ["resolution"];
  }
  const num = (key: string, min: number, max: number) => {
    if (input[key] === undefined) return undefined;
    if (!isFiniteNumber(input[key])) throw new Error(`"${key}" must be a number (${min} to ${max}).`);
    return clamp(input[key] as number, min, max);
  };
  const output = num("output", EQ_MIN_OUTPUT, EQ_MAX_OUTPUT);
  if (output !== undefined) patch.output = output;
  const pan = num("pan", -1, 1);
  if (pan !== undefined) patch.pan = pan;
  const gainScale = num("gainScale", 0, EQ_MAX_GAIN_SCALE * 100);
  if (gainScale !== undefined) patch.gainScale = gainScale / 100;
  if (input.panMode !== undefined) patch.panMode = input.panMode === "ms" ? "ms" : "lr";
  for (const key of ["invert", "autoGain", "gainQ"] as const) if (typeof input[key] === "boolean") patch[key] = input[key] as boolean;
  if (input.displayRange !== undefined) {
    if (!EQ_DISPLAY_RANGES.includes(input.displayRange as never)) throw new Error(`"displayRange" must be one of ${EQ_DISPLAY_RANGES.join(", ")} (dB).`);
    patch.displayRange = input.displayRange as ProQ["displayRange"];
  }
  let next = updateProQ(song, effect.id, patch);
  const done: string[] = [];
  if (typeof input.preset === "string") {
    const preset = PRO_Q_PRESETS.find((p) => p.name.toLowerCase() === (input.preset as string).trim().toLowerCase());
    if (!preset) throw new Error(`There's no preset "${input.preset}". Its presets: ${PRO_Q_PRESETS.map((p) => p.name).join(", ")}.`);
    next = editProQ(next, effect.id, (pq) => applyPreset(pq, preset));
    done.push(`loaded the preset ${preset.name}`);
  }
  if (input.ab === "switch") {
    next = editProQ(next, effect.id, switchAB);
    done.push("switched A/B");
  } else if (input.ab === "copy") {
    next = editProQ(next, effect.id, copyAB);
    done.push("copied this state to the other A/B");
  }
  if (next === song) return { song, text: "Nothing changed." };
  return { song: next, text: `${done.length ? `${done.join(", ")}. ` : ""}${describeProQ(next, { effect: effect.id })}` };
}
