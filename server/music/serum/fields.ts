/**
 * The spec's named fields: each says where its value lives in Serum's settings (a module's `plainParams` key),
 * how the value is written in the spec, and the range Serum accepts (measured: Serum clamps a value past its
 * range when it saves, so writing ±10⁹ and reading back gave every limit). The same table reads a preset and
 * writes one, so the two can't drift apart.
 */
import { type CborMap, type CborValue, isPlainMap } from "./cbor.ts";
import { choiceOptions, optionText } from "./catalogue.ts";
import { BUS_PERCENT, CUTOFF_HZ, exactSpecValue, FILTER_DB, GAIN_PERCENT, MS, type NumberUnit, PERCENT, PLAIN } from "./units.ts";

export type FieldKind =
  | { kind: "number"; unit: NumberUnit; range?: readonly [number, number]; integer?: boolean }
  | { kind: "bool" }
  /** One of a choice parameter's options, as Serum stores it ("Module.kParamX" in `CHOICES`). */
  | { kind: "choice"; choice: string }
  /** A word of the spec's for each stored string. */
  | { kind: "words"; words: Readonly<Record<string, string>> };

export interface Field {
  /** Where it goes in the spec's object for the module: "level", "unison.voices". */
  path: string;
  /** Its key in the module's `plainParams`. */
  key: string;
  type: FieldKind;
  /** What it is, for the docs. */
  doc: string;
}

const num = (path: string, key: string, unit: NumberUnit, range: readonly [number, number] | undefined, doc: string, integer = false): Field => ({
  path,
  key,
  type: { kind: "number", unit, range, integer },
  doc,
});
const bool = (path: string, key: string, doc: string): Field => ({ path, key, type: { kind: "bool" }, doc });
const choice = (path: string, key: string, choiceKey: string, doc: string): Field => ({ path, key, type: { kind: "choice", choice: choiceKey }, doc });

// ---- The tables ----

export const GLOBAL_FIELDS: Field[] = [
  num("volume", "kParamMasterVolume", GAIN_PERCENT, [0, 100], "Main Vol, % of the knob (Serum shows 20·log10((v/100)²) + 3 dB beside it). Default 50."),
  num("polyphony", "kParamPolyCount", PLAIN, [1, 32], "Voices.", true),
  bool("mono", "kParamMonoToggle", "Mono."),
  bool("legato", "kParamLegato", "Legato."),
  num("portamento", "kParamPortamentoTime", MS, [0, 8000], "Porta Time, ms."),
  num("portamentoCurve", "kParamPortamentoCurve", PLAIN, [-100, 100], "Porta Curve (0 is straight)."),
  bool("portaAlways", "kParamPortaAlways", "Porta Always (glide without overlapping notes too)."),
  bool("portaScaled", "kParamPortaScaled", "Porta Scaled (time scales with the interval)."),
  num("bendUp", "kParamBendRangeUp", PLAIN, [-24, 24], "Bend Up, semitones. Default 2."),
  num("bendDown", "kParamBendRangeDn", PLAIN, [-24, 24], "Bend Down, semitones. Default -2."),
  num("transpose", "kParamTranspose", PLAIN, [-24, 24], "Transpose, semitones."),
  num("modWheel", "kParamModWheel", PLAIN, [0, 100], "Mod Wheel position, 0–100."),
  num("swing", "kParamSwing", PLAIN, [12.5, 87.5], "Swing, % (50 is off)."),
  num("directVolume", "kParamDirectVol", BUS_PERCENT, [0, 100], "Direct Vol, % of the knob (50 = 0 dB)."),
  num("bus1Volume", "kParamFXBus1Vol", BUS_PERCENT, [0, 100], "Bus 1 Vol, % of the knob (50 = 0 dB)."),
  num("bus2Volume", "kParamFXBus2Vol", BUS_PERCENT, [0, 100], "Bus 2 Vol, % of the knob (50 = 0 dB)."),
];

const LEVEL = (doc: string) => num("level", "kParamVolume", GAIN_PERCENT, [0, 100], doc);

/** An oscillator's own parameters (`OscillatorN.plainParams`), common to A, B and C. */
export const OSCILLATOR_FIELDS: Field[] = [
  bool("enabled", "kParamEnable", "On (A is on by default, B and C off)."),
  LEVEL("Level, % of the knob (Serum shows 20·log10((v/100)²) dB beside it). Default 75."),
  num("pan", "kParamPan", PLAIN, [-50, 50], "Pan, -50 (left) to 50 (right)."),
  num("octave", "kParamOctave", PLAIN, [-4, 4], "Octave.", true),
  num("semi", "kParamPitch", PLAIN, [-12, 12], "Semi, semitones (a harmonic number when pitchMode is Harmonics)."),
  num("fine", "kParamFine", PLAIN, [-100, 100], "Fine, cents."),
  num("coarse", "kParamCoarsePit", PLAIN, [-64, 64], "Coarse Pitch, semitones (continuous)."),
  bool("pitchTrack", "kParamPitchTrack", "Pitch Track (on by default)."),
  num("unison.voices", "kParamUnison", PLAIN, [1, 16], "Unison voices.", true),
  num("unison.detune", "kParamDetune", PLAIN, [0, 1], "Uni Detune, as Serum shows it (0–1, default 0.25)."),
  num("unison.blend", "kParamDetuneWid", PLAIN, [0, 100], "Uni Blend, % (default 75)."),
  num("unison.width", "kParamUnisonStereo", PLAIN, [-100, 100], "Uni Width, % (default 100)."),
  choice("unison.stack", "kParamUnisonStack", "Oscillator.kParamUnisonStack", "Uni Stack (default off)."),
  choice("unison.mode", "kParamDetuneMode", "Oscillator.kParamDetuneMode", "Unison detune mode (default linear)."),
  num("unison.range", "kParamUnisonRange", PLAIN, [0, 48], "Unison range, semitones."),
  num("unison.span", "kParamUnisonSpan", PLAIN, [-100, 100], "Uni Span."),
  num("unison.randomStart", "kParamRandomStart", PLAIN, [0, 100], "Uni Rand Start, %."),
  num("start", "kParamStart", PLAIN, [0, 100], "Start (sample oscillators), %."),
  num("end", "kParamEnd", PLAIN, [0, 100], "End (sample oscillators), % (default 100)."),
  choice("loop.mode", "kParamLoopMode", "Oscillator.kParamLoopMode", "Loop Mode (default one-shot)."),
  num("loop.start", "kParamLoopStart", PLAIN, [0, 100], "Loop Start, %."),
  num("loop.end", "kParamLoopEnd", PLAIN, [0, 100], "Loop End, % (default 100)."),
  num("loop.crossfade", "kParamLoopCrossfade", PLAIN, [0, 100], "Loop X-Fade, %."),
  num("scanRate", "kParamScanRate", PLAIN, [-200, 200], "Scan Rate, % (default 100)."),
  choice("pitchMode", "kParamPitchMode", "Oscillator.kParamPitchMode", "How Semi is read (default semitones)."),
];

const warp = (n: "" | "2", module: string): Field[] => {
  const at = n ? "warp2" : "warp";
  return [
    choice(`${at}.mode`, `kParamWarpMenu${n}`, `${module}.kParamWarpMenu${n}`, `Warp${n ? " 2" : ""} Mode (default off).`),
    num(`${at}.amount`, `kParamWarp${n}`, PERCENT, [0, 100], `Warp${n ? " 2" : ""} amount, % of the knob (some modes show it in their own units).`),
    num(`${at}.var`, `kParamWarpVar${n}`, PLAIN, [0, 1], `Warp${n ? " 2" : ""} Var, 0–1.`),
  ];
};

/** The wavetable oscillator's parameters (`WTOscN.plainParams`). */
export const WAVETABLE_FIELDS: Field[] = [
  num("position", "kParamTablePos", PLAIN, [1, 256], "WT Pos, 1–256 across the table: Serum shows frame round(1 + (v−1)/255·(frames−1))."),
  ...warp("", "WTOsc"),
  ...warp("2", "WTOsc"),
  num("unison.wtPos", "kParamUnisonWTPos", PLAIN, [-100, 100], "Uni WT Pos (unison voices spread across the table)."),
  num("phase", "kParamInitialPhase", PLAIN, [0, 360], "Phase, degrees (default 180)."),
  num("randomPhase", "kParamRandomPhase", PLAIN, [0, 100], "Rand Phase, % (default 100)."),
];

/** The other oscillator types' parameters the spec names (the rest are under `typeParams`). */
export const TYPE_FIELDS: Record<string, Field[]> = {
  WTOsc: WAVETABLE_FIELDS,
  SampleOsc: [...warp("", "SampleOsc"), ...warp("2", "SampleOsc")],
  MultiSampleOsc: [...warp("", "MultiSampleOsc"), ...warp("2", "MultiSampleOsc"), num("randomPhase", "kParamRandomPhase", PLAIN, [0, 100], "Rand Phase, %.")],
  GranularOsc: [...warp("", "GranularOsc"), ...warp("2", "GranularOsc")],
  SpectralOsc: [...warp("", "SpectralOsc"), ...warp("2", "SpectralOsc")],
};

/** The noise oscillator: `Oscillator3.plainParams`, then `NoiseOsc3.plainParams`. */
export const NOISE_FIELDS: Field[] = [
  bool("enabled", "kParamEnable", "On."),
  LEVEL("Level, % of the knob. Default 25."),
  num("pan", "kParamPan", PLAIN, [-50, 50], "Pan."),
  bool("pitchTrack", "kParamPitchTrack", "Pitch Track (off by default)."),
];
export const NOISE_TYPE_FIELDS: Field[] = [
  num("pitch", "kParamColor", PERCENT, [0, 100], "Pitch (the noise's colour), % (default 50; with Pitch Track Serum shows (v−50)·1.28 semitones)."),
  num("fine", "kParamFine", PLAIN, [-1, 1], "Fine."),
  num("phase", "kParamInitialPhase", PLAIN, [0, 100], "Phase, %."),
  num("randomPhase", "kParamRandomPhase", PLAIN, [0, 100], "Rand Phase, %."),
  bool("oneShot", "kParamOneShot", "One shot (plays the noise once instead of looping)."),
  choice("type", "kParamNoiseType", "NoiseOsc.kParamNoiseType", "Generated noise instead of a sample."),
];

/** The sub oscillator: `Oscillator4.plainParams`, then `SubOsc4.plainParams`. */
export const SUB_FIELDS: Field[] = [
  bool("enabled", "kParamEnable", "On."),
  LEVEL("Level, % of the knob. Default 75."),
  num("pan", "kParamPan", PLAIN, [-50, 50], "Pan."),
  num("octave", "kParamOctave", PLAIN, [-4, 4], "Octave.", true),
  num("coarse", "kParamCoarsePit", PLAIN, [-64, 64], "Coarse Pitch, semitones."),
  bool("pitchTrack", "kParamPitchTrack", "Pitch Track (on by default)."),
];
export const SUB_TYPE_FIELDS: Field[] = [
  choice("shape", "kParamShape", "SubOsc.kParamShape", "Shape (default sine)."),
  num("phase", "kParamInitialPhase", PLAIN, [0, 360], "Phase, degrees."),
];

export const FILTER_FIELDS: Field[] = [
  bool("enabled", "kParamEnable", "On (both filters are off by default)."),
  choice("type", "kParamType", "VoiceFilter.kParamType", "Type (default MgL12, \"MG Low 12\")."),
  num("cutoff", "kParamFreq", CUTOFF_HZ, [8.175798915643707, 22093.892373577563], "Freq, Hz (default 425). Serum shows it rounded, at most 22050."),
  num("resonance", "kParamReso", PLAIN, [0, 100], "Res, % (default 10)."),
  num("drive", "kParamDrive", PLAIN, [0, 100], "Drive, %."),
  num("var", "kParamVar", PLAIN, [0, 100], "Var (the type's extra knob), %."),
  num("mix", "kParamWet", PLAIN, [0, 100], "Wet, % (default 100)."),
  num("stereo", "kParamStereo", PLAIN, [0, 100], "Stereo, % (default 50)."),
  num("level", "kParamLevelOut", FILTER_DB, [-Infinity, 12.041199826559248], "Level, dB (default 0)."),
];

export const ROUTING_FIELDS: Field[] = [
  {
    path: "to",
    key: "kParamRoutingDest",
    type: { kind: "words", words: { filter: "kRoutingDestFilter", master: "kRoutingDestMaster", direct: "kRoutingDestDirect", none: "kRoutingDestNone" } },
    doc: "Where it goes: filter, master, direct or none. Serum stores it only when it isn't the default (the presets suggest A's default is the filter).",
  },
  num("filterBalance", "kParamFilterBalance", PLAIN, [-100, 100], ">Filter Balance: -100 is filter 1 only, 100 filter 2 only (default -100)."),
  num("bus1", "kParamFXBus1Level", PLAIN, [0, 100], ">BUS1 send, %."),
  num("bus2", "kParamFXBus2Level", PLAIN, [0, 100], ">BUS2 send, %."),
];

export const ENVELOPE_FIELDS: Field[] = [
  num("attack", "kParamAttack", MS, [0, 32000], "Attack, ms (default 1 for Env 1, 0.5 for the others)."),
  num("hold", "kParamHold", MS, [0, 32000], "Hold, ms."),
  num("decay", "kParamDecay", MS, [0, 32000], "Decay, ms (default 1000)."),
  num("sustain", "kParamSustain", PERCENT, [0, 100], "Sustain, % of the knob (default 100). Serum shows its gain, (v/100)²: Env 1's as 40·log10(v/100) dB, the others' as a %."),
  num("release", "kParamRelease", MS, [0, 32000], "Release, ms (default 15)."),
  num("attackCurve", "kParamCurve1", PLAIN, [0, 100], "Atk Curve (default 50)."),
  num("decayCurve", "kParamCurve2", PLAIN, [0, 100], "Dec Curve (default 66.6)."),
  num("releaseCurve", "kParamCurve3", PLAIN, [0, 100], "Rel Curve (default 66.6)."),
];

/** An LFO's parameters other than its rate (`rate` is read and written apart: a number or a division). */
export const LFO_FIELDS: Field[] = [
  bool("sync", "kParamBeatSync", "Rate synced to the tempo (default on)."),
  bool("dotted", "kParamDotted", "Dotted rates allowed."),
  bool("triplets", "kParamTriplets", "Triplet rates allowed."),
  bool("rate10x", "kParamRate10x", "Free rate × 10."),
  choice("mode", "kParamMode", "LFO.kParamMode", "Free or Envelope (default: restarts with each note)."),
  choice("type", "kParamType", "LFO.kParamType", "Path, Lorenz, Rossler or RandomSH instead of a drawn shape."),
  num("smooth", "kParamSmooth", PLAIN, [0, 100], "Smooth, %."),
  num("rise", "kParamRise", PLAIN, [0, 4], "Rise (seconds free, a fraction of bars synced)."),
  num("delay", "kParamDelay", PLAIN, [0, 4], "Delay (seconds free, a fraction of bars synced)."),
  num("phase", "kParamPhase", PLAIN, [0, 360], "Phase, degrees."),
  bool("mono", "kParamMono", "One LFO for every voice."),
];

export const MACRO_FIELDS: Field[] = [num("value", "kParamValue", PLAIN, [0, 100], "Its position, 0–100.")];

export const MOD_FIELDS: Field[] = [
  num("amount", "kParamAmount", PLAIN, [-100, 100], "Amount, % of the destination's range."),
  num("out", "kParamOut", PLAIN, [0, 100], "Out (the slot's output scale), % (default 100)."),
  bool("bipolar", "kParamBipolar", "Bipolar (the source swings both ways)."),
  bool("auxInverted", "kParamAuxInverted", "The aux source inverted."),
  bool("bypass", "kParamBypass", "The slot bypassed."),
];

// ---- Reading and writing them ----

export type SpecObject = Record<string, unknown>;

export function getPath(obj: SpecObject, path: string): unknown {
  let at: unknown = obj;
  for (const part of path.split(".")) {
    if (typeof at !== "object" || at === null) return undefined;
    at = (at as SpecObject)[part];
  }
  return at;
}

export function setPath(obj: SpecObject, path: string, value: unknown) {
  const parts = path.split(".");
  let at = obj;
  for (const part of parts.slice(0, -1)) {
    if (typeof at[part] !== "object" || at[part] === null) at[part] = {};
    at = at[part] as SpecObject;
  }
  at[parts[parts.length - 1]] = value;
}

/** A field's spec value for a stored one, or undefined if it can't be said exactly (it's kept as stored then). */
export function readValue(field: Field, stored: CborValue): unknown {
  const t = field.type;
  switch (t.kind) {
    case "number":
      return typeof stored === "number" ? exactSpecValue(stored, t.unit) : undefined;
    case "bool":
      return stored === 1 ? true : stored === 0 ? false : undefined;
    case "choice":
      return typeof stored === "string" ? stored : undefined;
    case "words": {
      const word = Object.entries(t.words).find(([, s]) => s === stored)?.[0];
      return word;
    }
  }
}

/** An option by its name, or by what Serum shows for it ("MG Low 24" → "MgL24"). */
function optionFor(choiceKey: string, value: string): string | undefined {
  const options = choiceOptions(choiceKey) ?? [];
  if (options.includes(value)) return value;
  return options.find((o) => optionText(choiceKey, o)?.toLowerCase() === value.toLowerCase());
}

function describeOptions(choiceKey: string): string {
  return (choiceOptions(choiceKey) ?? []).map((o) => (optionText(choiceKey, o) ? `${o} (${optionText(choiceKey, o)})` : o)).join(", ");
}

/** A spec value as Serum stores it; problems go in `errors` (with `where`, the field's place in the spec). */
export function writeValue(field: Field, value: unknown, where: string, errors: string[]): CborValue | undefined {
  const t = field.type;
  switch (t.kind) {
    case "number": {
      if (typeof value !== "number" || !Number.isFinite(value)) {
        errors.push(`${where} must be a number (${t.unit.label}).`);
        return undefined;
      }
      if (t.integer && !Number.isInteger(value)) errors.push(`${where} must be a whole number.`);
      if (t.range && (value < t.range[0] || value > t.range[1])) {
        errors.push(`${where} is ${value}; Serum's range is ${t.range[0]} to ${t.range[1]} (${t.unit.label}).`);
        return undefined;
      }
      return t.unit.toPlain(value);
    }
    case "bool":
      if (typeof value !== "boolean") {
        errors.push(`${where} must be true or false.`);
        return undefined;
      }
      return value ? 1 : 0;
    case "choice": {
      const option = typeof value === "string" ? optionFor(t.choice, value) : undefined;
      if (option === undefined) {
        errors.push(`${where} is ${JSON.stringify(value)}; it must be one of: ${describeOptions(t.choice)}.`);
        return undefined;
      }
      return option;
    }
    case "words": {
      const stored = typeof value === "string" ? t.words[value] : undefined;
      if (stored === undefined) errors.push(`${where} is ${JSON.stringify(value)}; it must be one of: ${Object.keys(t.words).join(", ")}.`);
      return stored;
    }
  }
}

/**
 * The named fields of a module's stored parameters, into `into`. A field is read when the key is stored, can be
 * said exactly, and differs from the template's (what a new preset has): the writer starts from the template,
 * so leaving it out writes the same thing. Returns the keys read.
 */
export function readFields(stored: CborValue | undefined, template: CborValue | undefined, fields: Field[], into: SpecObject): Set<string> {
  const used = new Set<string>();
  if (!isPlainMap(stored)) return used;
  const base = isPlainMap(template) ? template : {};
  for (const field of fields) {
    if (!Object.hasOwn(stored, field.key)) continue;
    if (Object.hasOwn(base, field.key) && base[field.key] === stored[field.key]) {
      used.add(field.key);
      continue;
    }
    const value = readValue(field, stored[field.key]);
    if (value === undefined) continue;
    setPath(into, field.path, value);
    used.add(field.key);
  }
  return used;
}

/**
 * The stored parameters that aren't named fields, as `params` (kParam names, values as stored). Only names Serum
 * knows for the module (`known`): anything else stays in `raw`.
 */
export function leftoverParams(
  stored: CborValue | undefined,
  template: CborValue | undefined,
  used: Set<string>,
  known: readonly string[],
): Record<string, number | string> | undefined {
  if (!isPlainMap(stored)) return undefined;
  const base = isPlainMap(template) ? template : {};
  const out: Record<string, number | string> = {};
  for (const [key, value] of Object.entries(stored)) {
    if (used.has(key) || !known.includes(key) || (typeof value !== "number" && typeof value !== "string")) continue;
    if (Object.hasOwn(base, key) && base[key] === value) continue;
    if (typeof value === "number" && !Number.isFinite(value)) continue;
    out[key] = value;
  }
  return Object.keys(out).length ? out : undefined;
}

/** A module's `plainParams` as a map to write into ("default" means none yet). */
export function paramsOf(module: CborMap): CborMap {
  if (!isPlainMap(module.plainParams)) module.plainParams = {};
  return module.plainParams as CborMap;
}

/** Write the named fields found in `spec` into `params`; returns the spec keys it knew. */
export function writeFields(spec: SpecObject, fields: Field[], params: () => CborMap, where: string, errors: string[]) {
  for (const field of fields) {
    const value = getPath(spec, field.path);
    if (value === undefined) continue;
    const stored = writeValue(field, value, `${where}.${field.path}`, errors);
    if (stored !== undefined) params()[field.key] = stored;
  }
}

/** Raw parameters (`params`, `typeParams`): kParam names Serum knows for the module, numbers or option names. */
export function writeRawParams(raw: unknown, known: readonly string[], params: () => CborMap, where: string, errors: string[]) {
  if (raw === undefined) return;
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    errors.push(`${where} must be an object of Serum's parameter names (kParam…) to values.`);
    return;
  }
  for (const [key, value] of Object.entries(raw)) {
    if (!known.includes(key)) {
      errors.push(`${where}.${key} isn't a parameter of this module; Serum's are: ${known.join(", ")}.`);
      continue;
    }
    if (typeof value !== "number" && typeof value !== "string") {
      errors.push(`${where}.${key} must be a number or an option's name.`);
      continue;
    }
    params()[key] = value;
  }
}

/** The spec keys a module's object may have: its fields' first parts, and these. */
export function allowedKeys(fields: Field[], ...extra: string[]): Set<string> {
  return new Set([...fields.map((f) => f.path.split(".")[0]), ...extra]);
}

/** Report keys of `obj` (and of its nested groups) that no field names. */
export function checkKeys(obj: SpecObject, fields: Field[], extra: string[], where: string, errors: string[]) {
  const allowed = allowedKeys(fields, ...extra);
  for (const key of Object.keys(obj)) {
    if (!allowed.has(key)) {
      errors.push(`${where}.${key} isn't a field here; the fields are: ${[...allowed].join(", ")}.`);
      continue;
    }
    const nested = fields.filter((f) => f.path.startsWith(`${key}.`));
    if (!nested.length) continue;
    const group = obj[key];
    if (typeof group !== "object" || group === null || Array.isArray(group)) {
      errors.push(`${where}.${key} must be an object.`);
      continue;
    }
    const inner = new Set(nested.map((f) => f.path.slice(key.length + 1)));
    for (const k of Object.keys(group)) if (!inner.has(k)) errors.push(`${where}.${key}.${k} isn't a field here; the fields are: ${[...inner].join(", ")}.`);
  }
}
