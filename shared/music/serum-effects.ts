/**
 * Serum 2's effects as the Serum player shows and turns them (`docs/serum/player.md` §3.6), pure: the three racks,
 * each of the 14 effects' parameters in Serum's own order (a parameter's place is its `paramIndex` when it's linked
 * to one of a rack's 16 host slots), what a knob's position (0 to 1, as a host sets the slot) stores and shows, the
 * few controls each effect's card shows, and which knobs get the slots.
 *
 * Measured on Serum 2.1.5 in the offline engine (2026-10-09, `data/serum-research/generated/probes/player/fxunits.mts`
 * and `fxtext.mts`): every parameter linked to a slot, the slot set across its travel, the state saved and read, and
 * Serum's own text read back. A choice's or a count's position is its index over the count less one (Serum reports
 * that), and any position in its band picks it.
 */
import { clamp } from "../math.ts";
import { serumTimeText } from "./serum-sound.ts";

export const SERUM_FX_RACKS = ["main", "bus1", "bus2"] as const;
export type SerumFxRackId = (typeof SERUM_FX_RACKS)[number];
export const SERUM_FX_RACK_LABELS: Record<SerumFxRackId, string> = { main: "Main", bus1: "Bus 1", bus2: "Bus 2" };

/** How many of a rack's effect knobs Serum lets a host turn at once (its slots, `FX Main Param 1–16`). */
export const SERUM_FX_SLOTS = 16;

/** A rack's slot (0 to 15) as Serum's control: `FX Main Param 1` is 17000000, the buses 17001000 and 17002000. */
export const serumFxSlotParam = (rack: number, slot: number) => String(17_000_000 + rack * 1000 + slot);

/** What a stored number is, for its text. */
type Unit = "%" | "Hz" | "dB" | "ms" | "s" | "°" | "";

/**
 * What a knob's position means: what Serum stores for it and shows. `linear`, `power` and `log` store a number from
 * `min` to `max` (straight, as the position to `exp`, or evenly in octaves); `position` stores the position itself,
 * shown its own way; `options` stores one of `values`; `count` a whole number.
 */
export type SerumFxScale =
  | { kind: "linear"; min: number; max: number; unit: Unit; digits?: number }
  | { kind: "power"; min: number; max: number; exp: number; unit: Unit; digits?: number }
  | { kind: "log"; min: number; max: number; unit: Unit }
  | { kind: "position"; show: "level" | "cutoff" | "threshold" | "fraction" }
  /** The compressor's ratio: 1 / (1 − position), "Limit" at the top. */
  | { kind: "ratio" }
  /** The compressor's gain: 1 + 30·position², a factor, shown in dB. */
  | { kind: "makeup" }
  /** The delay's offsets: 0.5 to 1.5 of its time, the dotted and triplet ones named. */
  | { kind: "offset" }
  | { kind: "switch"; labels?: readonly [string, string] }
  | { kind: "options"; values: readonly (string | number)[]; labels: readonly string[] }
  | { kind: "count"; min: number; max: number };

export interface SerumFxParam {
  /** Serum's name for it ("kParamDrive"). */
  key: string;
  /** Its name in a preset spec and the assistant's edits ("drive": `preset-format.md`). */
  spec: string;
  /** Its name in the player ("Drive"). */
  label: string;
  scale: SerumFxScale;
  /** Where Serum puts it in a new effect (what an effect stores nothing for). */
  default: number;
  /** Left out of the player: it reshapes the rack (a splitter's band counts). */
  hidden?: boolean;
  /** A time or rate that's a division of the beat while its effect's `by` switch is on: `divisions`, evenly along the knob. */
  synced?: { by: string; divisions: readonly string[] };
}

export const SERUM_EFFECT_KINDS = ["distortion", "flanger", "phaser", "chorus", "delay", "compressor", "reverb", "eq", "filter", "hyper", "bode", "convolve", "utility", "split"] as const;
export type SerumEffectKind = (typeof SERUM_EFFECT_KINDS)[number];

export interface SerumEffectSpec {
  kind: SerumEffectKind;
  /** Its name in the player. */
  name: string;
  /** Every parameter, in Serum's order (its place is its `paramIndex`); `kParamEnable` first. */
  params: SerumFxParam[];
  /** The choice its card shows beside its name (the distortion's mode, the reverb's type), if it has one. */
  mode?: string;
  /** The knobs its card shows, in order (the rest are under its expand). */
  main: string[];
  /** Its controls are named as Serum names its slots (the reverb's change with its type). */
  serumNames?: boolean;
}

// ---- Scales ----

const pct = (): SerumFxScale => ({ kind: "linear", min: 0, max: 100, unit: "%" });
const bipolar = (): SerumFxScale => ({ kind: "linear", min: -100, max: 100, unit: "" });
const hz = (min: number, max: number): SerumFxScale => ({ kind: "log", min, max, unit: "Hz" });
const onOff = (labels?: readonly [string, string]): SerumFxScale => ({ kind: "switch", ...(labels && { labels }) });
const level = (): SerumFxScale => ({ kind: "position", show: "level" });
const fraction = (): SerumFxScale => ({ kind: "position", show: "fraction" });
/** An LFO-like rate: 20·position⁴ Hz (a division when synced, which only Serum's text says). */
const rate = (): SerumFxScale => ({ kind: "power", min: 0, max: 20, exp: 4, unit: "Hz", digits: 2 });
const options = (values: readonly (string | number)[], labels: readonly string[]): SerumFxScale => ({ kind: "options", values, labels });

/** A parameter: its key without "kParam", label, scale and default position. */
function p(key: string, label: string, scale: SerumFxScale, defaultValue: number, hidden?: boolean): SerumFxParam {
  const full = `kParam${key}`;
  return { key: full, spec: fxParamName(full), label, scale, default: defaultValue, ...(hidden && { hidden }) };
}

/** `param` shown as a division while its effect's `by` switch is on. */
const synced = (param: SerumFxParam, by: string, divisions: readonly string[]): SerumFxParam => ({ ...param, synced: { by: `kParam${by}`, divisions } });

/** Serum's divisions along a synced knob (measured: `fxsync.mts`), each an even share of its travel, the ends half one. */
const RATE_DIVISIONS = ["32 bar", "24 bar", "32 bar t", "16 bar", "12 bar", "16 bar t", "8 bar", "6 bar", "8 bar t", "4 bar", "3 bar", "4 bar t", "2 bar", "1.5 bar", "2 bar t", "bar", "1/2.", "bar t", "1/2", "1/4.", "1/2 t", "1/4", "1/8.", "1/4 t", "1/8", "1/16.", "1/8 t", "1/16", "1/32.", "1/16 t", "1/32"];
const DELAY_DIVISIONS = ["fast", "1/256", "1/128", "1/64", "1/32", "1/16", "1/8", "1/4", "1/2", "bar", "2 bar", "4 bar"];
const PREDELAY_DIVISIONS = ["1/256 t", "1/512.", "1/256", "1/128 t", "1/256.", "1/128", "1/64 t", "1/128.", "1/64", "1/32 t", "1/64.", "1/32", "1/16 t", "1/32.", "1/16", "1/8 t", "1/16.", "1/8", "1/4 t", "1/8.", "1/4", "1/2 t", "1/4.", "1/2", "bar t", "1/2.", "bar", "2 bar t", "1.5 bar"];
const syncedRate = () => synced(p("Rate", "Rate", rate(), 0.25), "BeatSync", RATE_DIVISIONS);

/** An effect's parameter as the spec names it: kParam dropped, the leading capital (or acronym) lower case. */
export function fxParamName(param: string): string {
  const s = param.replace(/^kParam/, "");
  const caps = /^[A-Z]*/.exec(s)![0].length;
  if (caps >= s.replace(/[0-9]/g, "").length) return s.toLowerCase();
  if (caps <= 1) return s.charAt(0).toLowerCase() + s.slice(1);
  return s.slice(0, caps - 1).toLowerCase() + s.slice(caps - 1);
}

const enable = () => p("Enable", "On", onOff(), 1);
const mix = (at: number) => p("Wet", "Mix", pct(), at);
const output = () => p("LevelOut", "Output", level(), 0.5);

const DISTORTION_MODES = ["kTube", "kSoftClip", "kHardClip", "kDiode1", "kDiode2", "kLinFold", "kSinFold", "kZeroSquare", "kDownsample", "kAsym", "kRectify", "kXShaper", "kXShaperAsym", "kSineShaper", "kStompBox", "kTapeSat", "kOverdrive", "kSoftSat"];
const DISTORTION_MODE_LABELS = ["Tube", "SoftClip", "HardClip", "Diode 1", "Diode 2", "Linear Fold", "Sin Fold", "Zero-Square", "Downsample", "Asym", "Rectify", "X-Shaper", "X-Shaper (Asym)", "Sine Shaper", "Stomp Box", "Tape Sat.", "Overdrive", "Soft Sat."];
const FILTER_TYPES = ["MgL6", "MgL12", "MgL18", "MgL24", "L6", "L12", "L18", "L24", "H6", "H12", "H18", "H24", "B12", "B24", "P12", "P24", "N12", "N24", "LH6", "LH12", "LB12", "LP12", "LN12", "HB12", "HP12", "HN12", "BP12", "BN12", "PP12", "PN12", "NN12", "LBH12", "LBH24", "LPH12", "LPH24", "LNH12", "LNH24", "BPN12", "BPN24", "CombP", "CombN", "CombL6P", "CombL6N", "CombH6P", "CombH6N", "CombHL6P", "CombHL6N", "FlangeP", "FlangeN", "FlangeL6P", "FlangeL6N", "FlangeH6P", "FlangeH6N", "FlangeHL6P", "FlangeHL6N", "Phase12P", "Phase12N", "Phase24P", "Phase24N", "Phase36P", "Phase36N", "Phase48P", "Phase48N", "Phase48L6P", "Phase48L6N", "Phase48H6P", "Phase48H6N", "Phase48HL6P", "Phase48HL6N", "FlangePhase12HL6P", "FlangePhase12HL6N", "LEQ6", "LEQ12", "BEQ12", "HEQ6", "HEQ12", "RM", "RMT", "SNH1", "SNH2", "Combs", "Allpasses", "Reverb1", "Scream", "ZDF_A", "ADD_BASS", "FormantONE", "FormantTWO", "FormantTWB", "BandReject", "DistComb1LP", "DistComb1BP", "DistComb2LP", "DistComb2BP", "Scream3LP", "Scream3BP", "Wsp", "DJMixer", "Diffuser", "LadderMg", "LadderAcid", "LadderEMS", "DirtyMg", "PZ_SVF", "Comb2", "Exp", "ExpBPF", "K35"];
const FILTER_TYPE_LABELS = ["MG Low 6", "MG Low 12", "MG Low 18", "MG Low 24", "Low 6", "Low 12", "Low 18", "Low 24", "High 6", "High 12", "High 18", "High 24", "Band 12", "Band 24", "Peak 12", "Peak 24", "Notch 12", "Notch 24", "LH 6", "LH 12", "LB 12", "LP 12", "LN 12", "HB 12", "HP 12", "HN 12", "BP 12", "BN 12", "PP 12", "PN 12", "NN 12", "L/B/H 12", "L/B/H 24", "L/P/H 12", "L/P/H 24", "L/N/H 12", "L/N/H 24", "B/P/N 12", "B/P/N 24", "Cmb +", "Cmb -", "Cmb L6+", "Cmb L6-", "Cmb H6+", "Cmb H6-", "Cmb HL6+", "Cmb HL6-", "Flg +", "Flg -", "Flg L6+", "Flg L6-", "Flg H6+", "Flg H6-", "Flg HL6+", "Flg HL6-", "Phs 12+", "Phs 12-", "Phs 24+", "Phs 24-", "Phs 36+", "Phs 36-", "Phs 48+", "Phs 48-", "Phs 48L6+", "Phs 48L6-", "Phs 48H6+", "Phs 48H6-", "Phs 48HL6+", "Phs 48HL6-", "FPhs 12HL6+", "FPhs 12HL6-", "Low EQ 6", "Low EQ 12", "Band EQ 12", "High EQ 6", "High EQ 12", "Ring Mod", "Ring Modx2", "SampHold", "SampHold-", "Combs", "Allpasses", "Reverb", "French LP", "German LP", "Add Bass", "Formant-I", "Formant-II", "Formant-III", "Bandreject", "Dist.Comb 1 LP", "Dist.Comb 1 BP", "Dist.Comb 2 LP", "Dist.Comb 2 BP", "Scream LP", "Scream BP", "Wsp", "DJ Mixer", "Diffusor", "MG Ladder", "Acid Ladder", "EMS Ladder", "MG Dirty", "PZ SVF", "Comb 2", "Exp MM", "Exp BPF", "K35"];
/** A three-band compressor's per-band controls (Serum's OTT-like multiband). */
const bands = (key: string, label: string, scale: () => SerumFxScale, defaults: number[], from = 0) => defaults.map((d, i) => p(`${key}${i + from}`, `${label} ${i + 1}`, scale(), d));

/** Every effect Serum 2 has, as the player shows it. */
export const SERUM_EFFECTS: Record<SerumEffectKind, SerumEffectSpec> = {
  distortion: {
    kind: "distortion",
    name: "Distortion",
    mode: "kParamMode",
    main: ["kParamDrive", "kParamWet"],
    params: [
      enable(),
      mix(1),
      p("Drive", "Drive", pct(), 0.25),
      p("LPHP", "LP/HP", pct(), 0),
      p("Mode", "Mode", options(DISTORTION_MODES, DISTORTION_MODE_LABELS), 0),
      p("Freq", "Freq", { kind: "position", show: "cutoff" }, 0.5),
      p("BW", "Width", { kind: "power", min: 0.075, max: 7.575, exp: 2, unit: "", digits: 1 }, 0.5),
      p("PrePost", "Filter", options([0, 1, 2], ["Off", "Pre", "Post"]), 0),
      output(),
      p("NumStages", "Stages", { kind: "count", min: 1, max: 16 }, 0),
      p("KeyTrack", "Key track", onOff(), 0),
    ],
  },
  flanger: {
    kind: "flanger",
    name: "Flanger",
    main: ["kParamRate", "kParamDepth", "kParamFeedback", "kParamWet"],
    params: [enable(), mix(1), p("BeatSync", "Sync", onOff(), 0), syncedRate(), p("Depth", "Depth", pct(), 1), p("Feedback", "Feedback", pct(), 0.5), p("Width", "Phase", { kind: "linear", min: 0, max: 360, unit: "°" }, 0.5), output(), p("Swing", "Swing", onOff(), 0)],
  },
  phaser: {
    kind: "phaser",
    name: "Phaser",
    main: ["kParamRate", "kParamFreq", "kParamFeedback", "kParamWet"],
    params: [
      enable(),
      mix(1),
      p("BeatSync", "Sync", onOff(), 0),
      syncedRate(),
      p("Depth", "Depth", pct(), 0.5),
      p("Depth2", "Depth 2", fraction(), 0.5),
      p("Freq", "Freq", hz(20, 18000), 0.5),
      p("Feedback", "Feedback", pct(), 0.8),
      p("Width", "Phase", { kind: "linear", min: 0, max: 360, unit: "°" }, 0.5),
      output(),
      p("NumPoles", "Poles", { kind: "count", min: 1, max: 18 }, 3 / 17),
      p("Swing", "Swing", onOff(), 0),
    ],
  },
  chorus: {
    kind: "chorus",
    name: "Chorus",
    main: ["kParamRate", "kParamDepth", "kParamFeedback", "kParamWet"],
    params: [
      enable(),
      mix(0.5),
      p("BeatSync", "Sync", onOff(), 0),
      syncedRate(),
      p("Delay", "Delay 1", { kind: "power", min: 0, max: 20, exp: 2, unit: "ms", digits: 1 }, 0.5),
      p("Delay2", "Delay 2", { kind: "power", min: 0, max: 20, exp: 2, unit: "ms", digits: 1 }, 0),
      p("Depth", "Depth", { kind: "power", min: 0, max: 26, exp: 2, unit: "ms", digits: 1 }, 1),
      p("Feedback", "Feedback", { kind: "linear", min: 0, max: 95, unit: "%" }, 0.1),
      p("Filt", "Filter", hz(50, 20000), 0.5),
      output(),
      p("FiltMode", "Filter type", options([0, 1], ["LPF", "HPF"]), 0),
      p("Swing", "Swing", onOff(), 0),
    ],
  },
  delay: {
    kind: "delay",
    name: "Delay",
    mode: "kParamMode",
    main: ["kParamTimeL", "kParamFeedback", "kParamWet"],
    params: [
      enable(),
      mix(0.3),
      p("Freq", "Freq", hz(40, 18000), 0.5),
      p("BW", "Width", { kind: "linear", min: 0.75, max: 8.25, unit: "", digits: 1 }, 0.8),
      p("BeatSync", "Sync", onOff(), 1),
      p("Link", "Link", onOff(), 0),
      synced(p("TimeL", "Time", { kind: "power", min: 0.001, max: 0.501, exp: 4, unit: "s" }, 0.625), "BeatSync", DELAY_DIVISIONS),
      synced(p("TimeR", "Time R", { kind: "power", min: 0.001, max: 0.501, exp: 4, unit: "s" }, 0.625), "BeatSync", DELAY_DIVISIONS),
      p("Mode", "Mode", options([0, 1, 2], ["Normal", "Ping-Pong", "Tap → Delay"]), 0),
      p("Feedback", "Feedback", pct(), 0.4),
      p("OffsetL", "Offset L", { kind: "offset" }, 0.5),
      p("OffsetR", "Offset R", { kind: "offset" }, 0.5),
      output(),
      p("HQ", "HQ", onOff(), 1),
    ],
  },
  compressor: {
    kind: "compressor",
    name: "Compressor",
    mode: "kParamMultiband",
    main: ["kParamThresh", "kParamRatio", "kParamMakeup", "kParamWet"],
    params: [
      enable(),
      mix(1),
      p("Thresh", "Threshold", { kind: "position", show: "threshold" }, 0.5),
      p("Ratio", "Ratio", { kind: "ratio" }, 0.75),
      p("Attack", "Attack", { kind: "power", min: 0.1, max: 1000, exp: 2, unit: "ms", digits: 1 }, 0.3),
      p("Release", "Release", { kind: "power", min: 0.1, max: 1000, exp: 2, unit: "ms", digits: 1 }, 0.3),
      p("Makeup", "Gain", { kind: "makeup" }, 0),
      p("Multiband", "Mode", options([0, 1], ["Normal", "Multiband"]), 0),
      ...bands("ThreshUD", "Band depth", () => ({ kind: "linear", min: 0, max: 200, unit: "%" }), [0.5, 0.5, 0.5]),
      output(),
      p("XoverLow", "Low split", hz(20, 5000), 0.3366),
      p("XoverHi", "High split", hz(300, 18000), 0.5179),
      ...bands("Gain", "Band gain", () => ({ kind: "linear", min: -24, max: 24, unit: "dB" }), [0.5, 0.5, 0.5]),
      p("RatioBelow", "Upward", fraction(), 0),
      ...bands("Ratio", "Band ratio", fraction, [1, 1, 1]),
      ...bands("RatioBelow", "Band upward", fraction, [1, 1, 1]),
      ...bands("Deadband", "Band deadband", () => ({ kind: "linear", min: 3, max: 24, unit: "dB" }), [0.1905, 0.4095, 0.1095]),
      ...bands("BypassDown", "Band down off", () => onOff(), [0, 0, 0], 1),
      ...bands("BypassUp", "Band up off", () => onOff(), [0, 0, 0], 1),
      p("LimiterLatencyComp", "Lookahead", onOff(), 0),
      p("CompensatedWetDry", "Matched mix", onOff(), 1),
    ],
  },
  reverb: {
    kind: "reverb",
    name: "Reverb",
    mode: "kParamType",
    main: ["kParamSize", "kParamFeedback", "kParamWet"],
    serumNames: true,
    params: [
      enable(),
      mix(0.2),
      p("Size", "Size", pct(), 0.35),
      p("Delay", "Predelay", { kind: "power", min: 0, max: 250, exp: 2, unit: "ms", digits: 1 }, 0.35),
      p("Freq", "Low cut", pct(), 0),
      p("Feedback", "Damp", pct(), 0.25),
      p("FreqB", "High cut", pct(), 0.35),
      p("Width", "Width", pct(), 0.2),
      p("FreqC", "Tone", pct(), 0.7),
      p("Mode", "Mode", { kind: "count", min: 0, max: 100 }, 0.7),
      output(),
      p("VintageScale", "Scale", pct(), 0.7),
      p("VintageScaleB", "Scale 2", pct(), 0.7),
      synced(p("PreDelay", "Pre-delay", { kind: "power", min: 0, max: 2.5, exp: 5, unit: "s" }, 0), "PreDelayBeatSync", PREDELAY_DIVISIONS),
      p("PreDelayBeatSync", "Sync", onOff(), 0),
      p("Type", "Type", options(["kPlate", "kHall", "kVintage", "kAbyss", "kSpace"], ["Plate", "Hall", "Vintage", "Nitrous", "Basin"]), 0),
    ],
  },
  eq: {
    kind: "eq",
    name: "EQ",
    main: ["kParamFreq1", "kParamGain1", "kParamFreq2", "kParamGain2"],
    params: [
      enable(),
      p("Freq1", "Low freq", hz(21.5332, 20000), 0.333),
      p("Freq2", "High freq", hz(21.5332, 20000), 0.666),
      p("Reso1", "Low Q", pct(), 0.6),
      p("Reso2", "High Q", pct(), 0.6),
      p("Gain1", "Low gain", { kind: "linear", min: -24, max: 24, unit: "dB" }, 0.5),
      p("Gain2", "High gain", { kind: "linear", min: -24, max: 24, unit: "dB" }, 0.5),
      p("Type1", "Low type", options([0, 1, 2], ["Shelf", "Peak", "HPF"]), 0),
      p("Type2", "High type", options([0, 1, 2], ["Shelf", "Peak", "LPF"]), 0),
      output(),
    ],
  },
  filter: {
    kind: "filter",
    name: "Filter",
    mode: "kParamType",
    main: ["kParamFreq", "kParamReso", "kParamWet"],
    params: [
      enable(),
      mix(1),
      p("Type", "Type", options(FILTER_TYPES, FILTER_TYPE_LABELS), 0),
      p("Freq", "Cutoff", { kind: "position", show: "cutoff" }, 0.5),
      p("Reso", "Res", pct(), 0),
      p("Drive", "Drive", pct(), 0),
      p("Var", "Var", pct(), 0),
      p("Stereo", "Pan", pct(), 0.5),
      output(),
      p("X", "X", fraction(), 0),
      p("Y", "Y", fraction(), 0),
      p("KeyTrack", "Key track", onOff(), 0),
      p("Pad", "Clean", onOff(), 0),
    ],
  },
  hyper: {
    kind: "hyper",
    name: "Hyper / Dimension",
    main: ["kParamRate", "kParamDetune", "kParamUnison", "kParamWet"],
    params: [
      enable(),
      mix(0.5),
      p("Rate", "Rate", pct(), 0.4),
      p("Detune", "Detune", pct(), 0.25),
      p("Unison", "Unison", { kind: "linear", min: 0, max: 7, unit: "", digits: 0 }, 4 / 7),
      p("Retrig", "Retrig", onOff(), 0),
      output(),
      p("DimESize", "Dim size", pct(), 0.5),
      p("DimEWet", "Dim mix", pct(), 0),
      p("DimELevelOut", "Dim output", level(), 0.5),
    ],
  },
  bode: {
    kind: "bode",
    name: "Frequency shifter",
    main: ["kParamShift", "kParamFeedback", "kParamWet"],
    params: [
      enable(),
      mix(1),
      p("BeatSync", "Sync", onOff(), 0),
      p("Shift", "Shift", bipolar(), 0.5),
      p("Range", "Range", hz(0.1, 5000), 0.5),
      output(),
      synced(p("DelayTime", "Delay", { kind: "power", min: 0.0005, max: 5, exp: 5, unit: "s" }, 0), "BeatSync", PREDELAY_DIVISIONS),
      p("Feedback", "Feedback", pct(), 0),
      p("DelayBalance", "Pan", bipolar(), 0.5),
      p("SwapAB", "Swap", onOff(), 0),
      p("OutputMix", "Up / down", bipolar(), 0.5),
      p("OutputWidth", "Width", pct(), 1),
      p("Blur", "Blur", pct(), 0),
      p("Retrig", "Retrig", onOff(), 0),
      p("MonoInput", "Mono in", onOff(), 0),
    ],
  },
  convolve: {
    kind: "convolve",
    name: "Convolve",
    main: ["kParamDecay", "kParamTone", "kParamWet"],
    params: [
      enable(),
      mix(0.2),
      p("MinPhase", "Min phase", onOff(), 0),
      output(),
      p("Size", "Size", { kind: "log", min: 10, max: 1000, unit: "%" }, 0.5),
      p("Attack", "Attack", { kind: "power", min: 0, max: 3, exp: 5, unit: "s" }, 0),
      p("Decay", "Decay", { kind: "power", min: 0, max: 40, exp: 5, unit: "s" }, 1),
      p("IpTrim", "IR gain", { kind: "linear", min: -34, max: 6, unit: "dB" }, 0.4),
      p("Tone", "Tone", bipolar(), 0.5),
      synced(p("Predelay", "Pre-delay", { kind: "power", min: 0, max: 2.5, exp: 5, unit: "s" }, 0), "PredelayBeatSync", PREDELAY_DIVISIONS),
      p("PredelayBeatSync", "Sync", onOff(), 0),
      p("Damping", "Damping", pct(), 0),
    ],
  },
  utility: {
    kind: "utility",
    name: "Utility",
    main: ["kParamWidth", "kParamBalance", "kParamLevelOut"],
    params: [
      enable(),
      mix(1),
      p("LevelOut", "Gain", level(), 0.5),
      p("Width", "Width", { kind: "power", min: 0, max: 800, exp: 3, unit: "%" }, 0.5),
      p("Balance", "Balance", bipolar(), 0.5),
      p("LFMono", "Mono bass", onOff(), 0),
      p("LFXover", "Mono below", hz(20.25, 400), 0.5),
      p("HPF", "Low cut", hz(1, 400), 0),
      p("LPF", "High cut", hz(50, 20000), 1),
      p("PolarityL", "Flip L", onOff(), 0),
      p("PolarityR", "Flip R", onOff(), 0),
    ],
  },
  split: {
    kind: "split",
    name: "Splitter",
    main: ["kParamFreq"],
    params: [
      enable(),
      p("Freq", "Split", hz(21.5332, 20000), 0.333),
      p("Band1Bypass", "Band 1 off", onOff(), 0),
      p("Band2Bypass", "Band 2 off", onOff(), 0),
      p("Solo", "Solo", options([-1, 0, 1], ["Off", "Band 1", "Band 2"]), 0),
      p("ModuleCount1", "Band 1 effects", { kind: "count", min: 0, max: 99 }, 0, true),
      p("ModuleCount2", "Band 2 effects", { kind: "count", min: 0, max: 99 }, 0, true),
    ],
  },
};

export function fxParam(kind: SerumEffectKind, key: string): SerumFxParam | undefined {
  return SERUM_EFFECTS[kind].params.find((p) => p.key === key);
}

// ---- Positions, stored values and text ----

const stepsOf = (scale: Extract<SerumFxScale, { kind: "options" | "count" }>) => (scale.kind === "options" ? scale.values.length : scale.max - scale.min + 1);
/** A choice's or count's index at a position: any position in its band. */
const indexAt = (n: number, v: number) => Math.min(n - 1, Math.floor(clamp(v, 0, 1) * n + 1e-9));

/** What Serum stores for a knob at a position (0 to 1). */
export function fxStored(scale: SerumFxScale, value: number): number | string {
  const v = clamp(value, 0, 1);
  switch (scale.kind) {
    case "linear":
      return scale.min + (scale.max - scale.min) * v;
    case "power":
      return scale.min + (scale.max - scale.min) * v ** scale.exp;
    case "log":
      return scale.min * (scale.max / scale.min) ** v;
    case "position":
      return v;
    case "ratio":
      return v >= 1 ? 1_000_000 : 1 / (1 - v);
    case "makeup":
      return 1 + 30 * v * v;
    case "offset":
      return 0.5 + v;
    case "switch":
      return v >= 0.5 ? 1 : 0;
    case "options":
      return scale.values[indexAt(scale.values.length, v)];
    case "count":
      return scale.min + indexAt(stepsOf(scale), v);
  }
}

/** A knob's position for what Serum stores (`undefined`: it stores nothing, so it's at `fallback`, its default). */
export function fxPosition(scale: SerumFxScale, stored: unknown, fallback: number): number {
  if (scale.kind === "options") {
    const i = scale.values.indexOf(stored as string | number);
    return i < 0 ? fallback : scale.values.length > 1 ? i / (scale.values.length - 1) : 0;
  }
  if (typeof stored !== "number" || !Number.isFinite(stored)) return fallback;
  const s = stored;
  switch (scale.kind) {
    case "linear":
      return clamp((s - scale.min) / (scale.max - scale.min), 0, 1);
    case "power":
      return clamp(Math.max(0, (s - scale.min) / (scale.max - scale.min)) ** (1 / scale.exp), 0, 1);
    case "log":
      return clamp(Math.log(Math.max(s, scale.min) / scale.min) / Math.log(scale.max / scale.min), 0, 1);
    case "position":
      return clamp(s, 0, 1);
    case "ratio":
      return s >= 1_000_000 ? 1 : clamp(1 - 1 / Math.max(1, s), 0, 1);
    case "makeup":
      return clamp(Math.sqrt(Math.max(0, s - 1) / 30), 0, 1);
    case "offset":
      return clamp(s - 0.5, 0, 1);
    case "switch":
      return s >= 0.5 ? 1 : 0;
    case "count": {
      const n = stepsOf(scale);
      return n > 1 ? clamp((Math.round(s) - scale.min) / (n - 1), 0, 1) : 0;
    }
  }
}

/** Where a choice or count of `n` steps sits for its `index` (what Serum reports, and sets it to). */
export const stepPosition = (n: number, index: number) => (n > 1 ? clamp(index / (n - 1), 0, 1) : 0);

/** A choice's or count's steps: their positions and names (for a menu). */
export function fxSteps(scale: SerumFxScale): { value: number; label: string }[] | null {
  if (scale.kind === "switch") return [0, 1].map((i) => ({ value: i, label: (scale.labels ?? ["Off", "On"])[i] }));
  if (scale.kind === "options") return scale.labels.map((label, i) => ({ value: stepPosition(scale.labels.length, i), label }));
  return null;
}

const fixed = (n: number, digits: number) => (Object.is(Number(n.toFixed(digits)), -0) ? 0 : n).toFixed(digits);

function hzText(f: number): string {
  if (f < 10) return `${fixed(f, 1)} Hz`;
  if (f < 1000) return `${Math.round(f)} Hz`;
  return `${fixed(f / 1000, f < 10_000 ? 2 : 1)} kHz`;
}

function dbText(db: number, digits = 1): string {
  return Number.isFinite(db) ? `${fixed(db, digits)} dB` : "-∞ dB";
}

function numberText(n: number, unit: Unit, digits?: number): string {
  switch (unit) {
    case "Hz":
      return digits !== undefined ? `${fixed(n, digits)} Hz` : hzText(n);
    case "s":
      return serumTimeText(n);
    case "ms":
      return n >= 1000 ? serumTimeText(n / 1000) : `${fixed(n, digits ?? 1)} ms`;
    case "dB":
      return dbText(n, digits ?? 1);
    case "%":
    case "°":
      return `${fixed(n, digits ?? 0)}${unit}`;
    default:
      return fixed(n, digits ?? 0);
  }
}

/** The delay offsets' named places, as Serum names them. */
const OFFSETS: [number, string][] = [
  [2 / 3, "Trip 1/2"],
  [0.75, "Dot 1/2"],
  [1, "Off"],
  [4 / 3, "Trip"],
  [1.5, "Dot"],
];

/** A knob's text at a position, as Serum shows it (near enough: Serum's own, when it says, is shown at rest). */
export function fxText(scale: SerumFxScale, value: number): string {
  const v = clamp(value, 0, 1);
  switch (scale.kind) {
    case "linear":
    case "power":
      return numberText(fxStored(scale, v) as number, scale.unit, scale.digits);
    case "log":
      return numberText(fxStored(scale, v) as number, scale.unit, scale.unit === "%" ? 0 : undefined);
    case "position":
      switch (scale.show) {
        case "level":
          return v <= 0 ? "-∞ dB" : dbText(40 * Math.log10(2 * v));
        case "cutoff":
          return hzText(8.1758 * (22050 / 8.1758) ** v);
        case "threshold":
          return v >= 1 ? "-120.0 dB" : dbText(Math.max(-120, 60 * Math.log10(1 - v)));
        case "fraction":
          return `${Math.round(v * 100)}%`;
      }
      return "";
    case "ratio": {
      if (v >= 1) return "Limit";
      const r = 1 / (1 - v);
      return r < 2 ? `${fixed(r, 1)}:1` : `${Math.round(r)}:1`;
    }
    case "makeup":
      return dbText(20 * Math.log10(1 + 30 * v * v));
    case "offset": {
      const s = 0.5 + v;
      const named = OFFSETS.find(([at]) => Math.abs(at - s) < 0.02);
      return named ? named[1] : fixed(s, 2);
    }
    case "switch":
      return (scale.labels ?? ["Off", "On"])[v >= 0.5 ? 1 : 0];
    case "options":
      return scale.labels[indexAt(scale.labels.length, v)];
    case "count":
      return String(fxStored(scale, v));
  }
}

/**
 * A parameter's text at a position for an effect (whose sync switch makes a time or rate a division: Serum's, as
 * measured), as Serum shows it.
 */
export function fxParamText(param: SerumFxParam, value: number, effect?: Pick<SerumEffectState, "controls"> | null): string {
  const sync = param.synced && effect?.controls.find((c) => c.key === param.synced!.by);
  if (param.synced && sync && sync.value >= 0.5) {
    const { divisions } = param.synced;
    // A synced rate's very bottom stops it.
    if (value <= 0 && param.scale.kind === "power" && param.scale.unit === "Hz") return "Off";
    return divisions[Math.round(clamp(value, 0, 1) * (divisions.length - 1))];
  }
  return fxText(param.scale, value);
}

/** What a stored value can be, for an error: "0 to 100 (%)", or the options. */
export function fxRange(scale: SerumFxScale): string {
  switch (scale.kind) {
    case "options":
      return `one of ${scale.labels.map((l, i) => `"${l}"${String(scale.values[i]) !== l ? ` (${JSON.stringify(scale.values[i])})` : ""}`).join(", ")}`;
    case "switch":
      return "0 (off) or 1 (on)";
    case "count":
      return `a whole number from ${scale.min} to ${scale.max}`;
    case "position":
      return "0 to 1 (the knob's place)";
    case "ratio":
      return "1 or more (1000000 limits)";
    case "makeup":
      return "1 to 31 (a gain factor)";
    case "offset":
      return "0.5 to 1.5";
    default:
      return `${scale.min} to ${scale.max}${scale.unit ? ` (${scale.unit})` : ""}`;
  }
}

/** A value given for a parameter (Serum's stored value, or an option's name) as what Serum stores, or null if it can't be one. */
export function fxInput(scale: SerumFxScale, value: unknown): number | string | null {
  if (scale.kind === "options") {
    const i = scale.values.findIndex((v, j) => v === value || (typeof value === "string" && (String(v).toLowerCase() === value.toLowerCase() || scale.labels[j].toLowerCase() === value.toLowerCase())));
    return i < 0 ? null : scale.values[i];
  }
  if (scale.kind === "switch" && typeof value === "boolean") return value ? 1 : 0;
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  switch (scale.kind) {
    case "switch":
      return value === 0 || value === 1 ? value : null;
    case "count":
      return Number.isInteger(value) && value >= scale.min && value <= scale.max ? value : null;
    case "position":
      return value >= 0 && value <= 1 ? value : null;
    case "ratio":
      return value >= 1 ? Math.min(value, 1_000_000) : null;
    case "makeup":
      return value >= 1 && value <= 31 ? value : null;
    case "offset":
      return value >= 0.5 && value <= 1.5 ? value : null;
    default:
      return value >= Math.min(scale.min, scale.max) && value <= Math.max(scale.min, scale.max) ? value : null;
  }
}

// ---- What the player shows ----

/** One of an effect's controls: its knob's place (0 to 1), and the rack's slot that turns it live, if it's linked to one. */
export interface SerumFxControl {
  key: string;
  /** The slot's parameter (`serumFxSlotParam`) when the knob is linked to one: turned live. Null: a reload sets it. */
  param: string | null;
  value: number;
  /** Serum's own text for it, when the engine said. */
  text?: string;
  /** Serum's own name for it, where its meaning follows the effect's type (the reverb's). */
  name?: string;
}

export interface SerumEffectState {
  /** 1 and up: its place in its rack. */
  position: number;
  /** Null: an effect the player doesn't know (kept as it is). */
  effect: SerumEffectKind | null;
  enabled: SerumFxControl | null;
  /** Every control but its switch, in Serum's order. */
  controls: SerumFxControl[];
  /** A convolve's impulse (the file's name), if it has one. */
  impulse?: string;
}

export interface SerumFxRack {
  rack: SerumFxRackId;
  effects: SerumEffectState[];
}

/** An effect's control by its key. */
export const controlOf = (effect: SerumEffectState, key: string) => (key === "kParamEnable" ? effect.enabled : effect.controls.find((c) => c.key === key)) ?? null;

/**
 * Which knobs get a rack's 16 slots (`docs/serum/player.md` §3.6: the knobs shown, turned live): every effect's switch,
 * then each effect's first card knob, its mode, then the next knobs, round by round, while slots last. Answers each
 * slot's effect (0 up, its place in the rack) and parameter.
 */
export function planFxSlots(effects: readonly (SerumEffectKind | null)[]): { position: number; key: string }[] {
  const wanted = effects.map((kind) => {
    if (!kind) return [];
    const spec = SERUM_EFFECTS[kind];
    return [...new Set(["kParamEnable", spec.main[0], spec.mode, ...spec.main.slice(1)].filter((k): k is string => Boolean(k)))];
  });
  const slots: { position: number; key: string }[] = [];
  for (let round = 0; slots.length < SERUM_FX_SLOTS && wanted.some((keys) => keys.length > round); round++)
    wanted.forEach((keys, position) => {
      if (round < keys.length && slots.length < SERUM_FX_SLOTS) slots.push({ position, key: keys[round] });
    });
  return slots;
}

/** An effect as a line for the model: its controls by their spec names, in Serum's stored units ("drive 25, wet 100"). */
export function describeEffect(effect: SerumEffectState): string {
  if (!effect.effect) return "an effect the player doesn't know";
  const spec = SERUM_EFFECTS[effect.effect];
  const on = !effect.enabled || effect.enabled.value >= 0.5;
  const settings = spec.params
    .filter((p) => p.key !== "kParamEnable" && !p.hidden)
    .map((p) => {
      const control = effect.controls.find((c) => c.key === p.key);
      const value = control?.value ?? p.default;
      const stored = fxStored(p.scale, value);
      const shown = typeof stored === "number" ? Number(stored.toPrecision(4)) : JSON.stringify(stored);
      return `${p.spec} ${shown} (${control?.text?.trim() || fxParamText(p, value, effect)})`;
    });
  return `${effect.effect}${on ? "" : " (off)"}${effect.impulse ? `, impulse "${effect.impulse}"` : ""}: ${settings.join(", ")}`;
}

/** A saved effect or rack of Serum's (`Effect Chains` in its preset folder): `.SerumFX` is one effect, `.SerumFXRack` a whole rack. */
export interface SerumChainEntry {
  /** Where it is (what an edit names it by). */
  path: string;
  name: string;
  /** Its folder in `Effect Chains` ("Reverb/Factory"). */
  folder: string;
  kind: "effect" | "rack";
  /** A `.SerumFX`'s effect. */
  effect?: SerumEffectKind;
}
