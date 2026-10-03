/**
 * The assistant's OTT (`shared/music/tools.ts`: get_ott, update_ott): pure `(song, input) => { song, text }`
 * edits like the rest of `tool-edits.ts`, and what get_ott says. Values as the tools describe them (depth
 * 0..1, time 0..10, strengths and thresholds 0..2, gains dB). Errors say what's wrong and what would work.
 */
import { isFiniteNumber } from "@shared/math";
import { OTT_CONTROL_SPECS, type OttPatch, chooseOttPreset, engineOtt, findOtt, ottGainDb, otts, updateOtt, updateOttBand } from "@shared/music/ott";
import { MAX_OTT_STRENGTH, MAX_OTT_TIME, OTT_BAND_GAIN_RANGE, OTT_GAIN_RANGE, OTT_PRESETS } from "@shared/music/ott-presets";
import { type MusicProject, OTT_BANDS, type OttBand } from "@shared/music/types";
import { findTrack, trackLabel } from "../mixer/tool-edits";
import type { EditResult } from "../tool-edits";

type Input = Record<string, unknown>;

const round = (n: number, digits = 1) => Math.round(n * 10 ** digits) / 10 ** digits;
const percent = (v: number) => `${Math.round(v * 100)}%`;
const db = (v: number) => `${v > 0 ? "+" : ""}${round(v)} dB`;
const BAND_NAMES = { low: "Low (below 88 Hz)", mid: "Mid (88 Hz to 2.5 kHz)", high: "High (above 2.5 kHz)" } as const;

/**
 * The OTT an input names: by `effect` (its id), by `track` (the track's OTT; with `effectSlot`, the one in
 * that slot), or the song's only one. The error lists the song's.
 */
export function findOttRef(song: MusicProject, input: Input) {
  const all = otts(song);
  const list = () =>
    all.length ? `The song's YT-Multiband instances: ${all.map((o) => `${o.effect.id} (${trackLabel(song, o.track)}, slot ${o.slot + 1})`).join(", ")}.` : 'The song has none: add_mixer_effect with plugin "YT-Multiband" puts one on a track.';
  if (typeof input.effect === "string" && input.effect.trim()) {
    const found = findOtt(song, input.effect.trim());
    if (!found) throw new Error(`There's no YT-Multiband "${input.effect}". ${list()}`);
    return found;
  }
  if (input.track !== undefined && input.track !== "") {
    const track = findTrack(song, input.track);
    const on = all.filter((o) => o.track.id === track.id && (!Number.isInteger(input.effectSlot) || o.slot === (input.effectSlot as number) - 1));
    if (!on.length) throw new Error(`${trackLabel(song, track)} has no YT-Multiband${Number.isInteger(input.effectSlot) ? ` in slot ${String(input.effectSlot)}` : ""}. ${list()}`);
    return on[0];
  }
  if (all.length === 1) return all[0];
  throw new Error(all.length ? `Say which YT-Multiband ("effect", or "track"). ${list()}` : list());
}

/** get_ott: its knobs, its bands, and what each band does at a few levels. */
export function describeOtt(song: MusicProject, input: Input): string {
  const { effect, track, slot, ott } = findOttRef(song, input);
  const engine = engineOtt(ott);
  const lines = [`YT-Multiband ${effect.id} on ${trackLabel(song, track)}, slot ${slot + 1}${effect.enabled ? "" : " (bypassed)"}${ott.preset ? `, preset "${ott.preset}"` : ""}${effect.mix < 1 ? `, slot mix ${percent(effect.mix)}` : ""}.`];
  lines.push(
    `Depth ${round(ott.depth, 2)} (${percent(ott.depth)}), time ${round(ott.time, 2)} (${OTT_CONTROL_SPECS.time.format(ott.time)}), in gain ${db(ott.input)}, out gain ${db(ott.output)}, ` +
      `upward ${round(ott.upward, 2)} (${percent(ott.upward)}), downward ${round(ott.downward, 2)} (${percent(ott.downward)}).`,
  );
  OTT_BANDS.forEach((name, k) => {
    const b = ott.bands[k];
    const e = engine.bands[k];
    const at = [-60, -40, -20, -6].map((level) => `${level} dB → ${db(ottGainDb(e, level) + 20 * Math.log10(e.gain))}`).join(", ");
    lines.push(
      `${BAND_NAMES[name]}: threshold ${round(b.threshold, 2)} (${percent(b.threshold)}), gain ${db(b.gain)}, upward ${b.upward ? `on below ${db(e.upKnee)}` : "off"}, ` +
        `downward ${b.downward ? `on above ${db(e.downKnee)}` : "off"}, release ${Math.round(e.release * 1000)} ms. Its gain at levels in: ${at}.`,
    );
  });
  lines.push(`Presets: ${OTT_PRESETS.map((p) => `${p.name} (${p.detail})`).join("; ")}.`);
  return lines.join("\n");
}

function number(input: Input, key: string, min: number, max: number): number | undefined {
  const value = input[key];
  if (value === undefined) return undefined;
  if (!isFiniteNumber(value) || value < min || value > max) throw new Error(`"${key}" must be a number from ${min} to ${max}.`);
  return value;
}

/** update_ott: a preset, the knobs, the bands. */
export function updateOttTool(song: MusicProject, input: Input): EditResult {
  const { effect } = findOttRef(song, input);
  const id = effect.id;
  let next = song;
  const done: string[] = [];
  if (input.preset !== undefined) {
    const preset = OTT_PRESETS.find((p) => p.name.toLowerCase() === String(input.preset).toLowerCase());
    if (!preset) throw new Error(`There's no preset "${String(input.preset)}". The presets: ${OTT_PRESETS.map((p) => p.name).join(", ")}.`);
    next = chooseOttPreset(next, id, preset.name);
    done.push(`loaded "${preset.name}"`);
  }
  const patch: OttPatch = {};
  const knobs = {
    depth: number(input, "depth", 0, 1),
    time: number(input, "time", 0, MAX_OTT_TIME),
    input: number(input, "input", OTT_GAIN_RANGE[0], OTT_GAIN_RANGE[1]),
    output: number(input, "output", OTT_GAIN_RANGE[0], OTT_GAIN_RANGE[1]),
    upward: number(input, "upward", 0, MAX_OTT_STRENGTH),
    downward: number(input, "downward", 0, MAX_OTT_STRENGTH),
  };
  for (const [key, value] of Object.entries(knobs)) if (value !== undefined) patch[key as keyof typeof knobs] = value;
  if (Object.keys(patch).length) {
    next = updateOtt(next, id, patch);
    done.push(Object.keys(patch).join(", "));
  }
  if (input.bands !== undefined) {
    if (!Array.isArray(input.bands)) throw new Error('"bands" must be a list of { band: "low" | "mid" | "high", threshold, gain, upward, downward }.');
    for (const raw of input.bands) {
      const b = (raw && typeof raw === "object" ? raw : {}) as Input;
      const k = OTT_BANDS.indexOf(b.band as (typeof OTT_BANDS)[number]);
      if (k < 0) throw new Error('Each band needs "band": "low", "mid" or "high".');
      const change: Partial<OttBand> = {};
      const threshold = number(b, "threshold", 0, MAX_OTT_STRENGTH);
      const gain = number(b, "gain", OTT_BAND_GAIN_RANGE[0], OTT_BAND_GAIN_RANGE[1]);
      if (threshold !== undefined) change.threshold = threshold;
      if (gain !== undefined) change.gain = gain;
      for (const key of ["upward", "downward"] as const) if (b[key] !== undefined) change[key] = b[key] === true;
      next = updateOttBand(next, id, k, change);
      done.push(`the ${b.band} band's ${Object.keys(change).join(", ") || "nothing"}`);
    }
  }
  if (!done.length) throw new Error("Nothing to change: give a preset, a knob (depth, time, input, output, upward, downward) or bands.");
  return { song: next, text: `YT-Multiband ${id}: ${done.join("; ")}.\n${describeOtt(next, { effect: id })}` };
}
