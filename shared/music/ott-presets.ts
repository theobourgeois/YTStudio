/**
 * OTT's constants, its default, how its settings are validated, and its presets (`docs/xfer/ott.md`).
 *
 * Only types and constants are imported, so `project.ts` can use this to normalise a song.
 */
import { clamp, isFiniteNumber } from "../math.ts";
import type { Ott, OttBand, OttControl, PluginRef } from "./types.ts";

/** What an OTT effect is, as a slot's plugin: one of ours, run by the engine itself. */
export const OTT_PLUGIN: PluginRef = { id: "vaudio:ott", name: "YT-Multiband", format: "Vaudio" };
export const isOtt = (plugin: Pick<PluginRef, "id">) => plugin.id === OTT_PLUGIN.id;

/** In Gain's and Out Gain's range (dB): OTT's top, and a bottom low enough (OTT's is −∞). */
export const OTT_GAIN_RANGE = [-24, 19.1] as const;
/** The H / M / L gains' range (dB). */
export const OTT_BAND_GAIN_RANGE = [-24, 6] as const;
/** Time's most (OTT's 1000%). */
export const MAX_OTT_TIME = 10;
/** Upwd%, Dnwd% and the thresholds' most (200%). */
export const MAX_OTT_STRENGTH = 2;

export const DEFAULT_OTT_BAND: OttBand = { threshold: 1, gain: 0, upward: true, downward: true };

/** A new OTT: Xfer's defaults (everything at 100%, the gains at 0 dB). */
export const DEFAULT_OTT: Ott = {
  preset: "Default",
  depth: 1,
  time: 1,
  input: 0,
  output: 0,
  upward: 1,
  downward: 1,
  bands: [DEFAULT_OTT_BAND, DEFAULT_OTT_BAND, DEFAULT_OTT_BAND],
};

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const num = (v: unknown, min: number, max: number, fallback: number) => (isFiniteNumber(v) ? clamp(v, min, max) : fallback);

function normalizeBand(input: unknown): OttBand {
  if (!isObject(input)) return DEFAULT_OTT_BAND;
  const band: OttBand = {
    threshold: num(input.threshold, 0, MAX_OTT_STRENGTH, 1),
    gain: num(input.gain, OTT_BAND_GAIN_RANGE[0], OTT_BAND_GAIN_RANGE[1], 0),
    upward: input.upward !== false,
    downward: input.downward !== false,
  };
  const d = DEFAULT_OTT_BAND;
  return band.threshold === d.threshold && band.gain === d.gain && band.upward && band.downward ? d : band;
}

/** An OTT's settings from anything (a saved song, the assistant): each value kept to its range, the rest defaults. */
export function normalizeOtt(input: unknown): Ott {
  if (!isObject(input)) return DEFAULT_OTT;
  const d = DEFAULT_OTT;
  const bands = Array.isArray(input.bands) ? input.bands : [];
  return {
    preset: typeof input.preset === "string" && OTT_PRESETS.some((p) => p.name === input.preset) ? input.preset : null,
    depth: num(input.depth, 0, 1, d.depth),
    time: num(input.time, 0, MAX_OTT_TIME, d.time),
    input: num(input.input, OTT_GAIN_RANGE[0], OTT_GAIN_RANGE[1], d.input),
    output: num(input.output, OTT_GAIN_RANGE[0], OTT_GAIN_RANGE[1], d.output),
    upward: num(input.upward, 0, MAX_OTT_STRENGTH, d.upward),
    downward: num(input.downward, 0, MAX_OTT_STRENGTH, d.downward),
    bands: [normalizeBand(bands[0]), normalizeBand(bands[1]), normalizeBand(bands[2])],
  };
}

/** A preset: what it sets (the rest is the default), and a line on what it's for. */
export interface OttPreset {
  name: string;
  detail: string;
  settings: Partial<Omit<Ott, "preset" | "bands">> & { bands?: [Partial<OttBand>, Partial<OttBand>, Partial<OttBand>] };
}

/**
 * Our starting points (OTT has no presets of its own): its default, and the ways producers set it,
 * lighter or one-sided. Bands are low, mid, high.
 */
export const OTT_PRESETS: readonly OttPreset[] = [
  { name: "Default", detail: "Xfer's: everything at 100%, over the top", settings: {} },
  { name: "Gentle", detail: "A third of it: glue and air without the squash", settings: { depth: 0.3 } },
  { name: "Half", detail: "Depth at 50%, the usual place to start", settings: { depth: 0.5 } },
  { name: "Upward only", detail: "Tails, reverbs and detail brought up, nothing pushed down", settings: { downward: 0 } },
  { name: "Downward only", detail: "A three-band leveller: the loud parts held, nothing lifted", settings: { upward: 0, depth: 0.7 } },
  { name: "Bright", detail: "The top band up: the EDM sheen", settings: { depth: 0.6, bands: [{}, { gain: -1 }, { gain: 3 }] } },
  { name: "Sub tamer", detail: "The low band left out, the rest squashed", settings: { depth: 0.6, bands: [{ upward: false, downward: false }, {}, {}] } },
  { name: "Vocal glue", detail: "Slow and light, the mids held", settings: { depth: 0.35, time: 2.5, upward: 0.7, bands: [{ gain: -3 }, {}, { gain: 1.5 }] } },
  { name: "Drum smash", detail: "Fast and hard, the transients flattened", settings: { depth: 0.8, time: 0.4, downward: 1.4, input: 3, output: -3 } },
  { name: "Pad bloom", detail: "Long release, quiet detail lifted", settings: { depth: 0.7, time: 4, downward: 0.5, upward: 1.3 } },
];

/** A preset's settings, whole. */
export function ottPreset(name: string): Ott | null {
  const preset = OTT_PRESETS.find((p) => p.name === name);
  if (!preset) return null;
  const { bands, ...rest } = preset.settings;
  return {
    ...DEFAULT_OTT,
    ...rest,
    preset: preset.name,
    bands: bands ? [{ ...DEFAULT_OTT_BAND, ...bands[0] }, { ...DEFAULT_OTT_BAND, ...bands[1] }, { ...DEFAULT_OTT_BAND, ...bands[2] }] : DEFAULT_OTT.bands,
  };
}

/** OTT's controls as the assistant names them (`add_automation`'s `control`), with the values it gives each. */
export const OTT_TOOL_CONTROLS = {
  "ott depth": "depth",
  "ott time": "time",
  "ott in gain": "input",
  "ott out gain": "output",
  "ott upward": "upward",
  "ott downward": "downward",
  "ott low threshold": "lowThreshold",
  "ott mid threshold": "midThreshold",
  "ott high threshold": "highThreshold",
  "ott low gain": "lowGain",
  "ott mid gain": "midGain",
  "ott high gain": "highGain",
} as const satisfies Record<string, OttControl>;
export type OttToolControl = keyof typeof OTT_TOOL_CONTROLS;
export const OTT_TOOL_CONTROL_NAMES = Object.keys(OTT_TOOL_CONTROLS) as OttToolControl[];

/** Each control's values, said for the model. */
export const OTT_HINTS: Record<OttControl, string> = {
  depth: "0 (untouched) to 1 (all of it)",
  time: "0 to 10 (1 is OTT's own release, 100%)",
  input: "dB, -24 to 19.1",
  output: "dB, -24 to 19.1",
  upward: "0 to 2 (1 is 100%)",
  downward: "0 to 2 (1 is 100%)",
  lowThreshold: "0 to 2 (1 is 100%; each 1 moves the band's knees about 23 dB)",
  midThreshold: "0 to 2 (1 is 100%; each 1 moves the band's knees about 24 dB)",
  highThreshold: "0 to 2 (1 is 100%; each 1 moves the band's knees about 24 dB)",
  lowGain: "dB, -24 to 6",
  midGain: "dB, -24 to 6",
  highGain: "dB, -24 to 6",
};
