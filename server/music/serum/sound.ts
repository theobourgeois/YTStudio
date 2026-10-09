/**
 * A Serum 2 channel's sound as the Serum player shows and edits it (`docs/serum/player.md` §3.4, §3.5), pure: its
 * mod matrix, envelopes and LFOs read out of Serum's settings (the processor's CBOR, as the engine saves it), with
 * the live controls' positions as the engine reports them, and the edits that need a reload written onto those
 * settings as they are (everything else, Serum's own fields included, left alone).
 */
import type { EngineParameter } from "../../../shared/music/engine.ts";
import {
  envelopeValueOf,
  lfoValueOf,
  modAmountToValue,
  SERUM_ENVELOPE_FIELDS,
  SERUM_ENVELOPES,
  SERUM_LFO_FIELDS,
  SERUM_LFOS,
  SERUM_MOD_SLOTS,
  SERUM_MOD_SOURCES,
  SERUM_OSCILLATORS,
  SERUM_DEFAULT_LFO_SHAPE,
  type SerumControl,
  type SerumEnvelope,
  type SerumEnvelopeField,
  type SerumLfo,
  type SerumLfoField,
  type SerumLfoPoint,
  type SerumModRoute,
  type SerumOscillator,
  type SerumSoundEdit,
  serumEnvelopeParam,
  serumLfoParam,
  serumModAmountParam,
  serumOscillatorParam,
  sourceUsed,
} from "../../../shared/music/serum-sound.ts";
import { bodyContext, SpecError, sourceIndex, writeEnvelopesAndLfos } from "./body.ts";
import { CONTROLS, FX_RACKS, isModuleType, MODULE_PARAMS, OSCILLATOR_TYPES, type OscillatorType } from "./catalogue.ts";
import { type CborMap, type CborValue, isPlainMap } from "./cbor.ts";
import { type Destination, destinationName, parseDestination } from "./destinations.ts";
import { paramsOf } from "./fields.ts";
import { clone } from "./patch.ts";
import { LFO_DIVISIONS } from "./units.ts";

/** What a module stores, or nothing ("default", absent). */
function stored(module: CborValue | undefined): CborMap {
  return isPlainMap(module) && isPlainMap(module.plainParams) ? module.plainParams : {};
}

const number = (value: CborValue | undefined, fallback: number) => (typeof value === "number" && Number.isFinite(value) ? value : fallback);

/** A mod slot with a route in it: a source and a destination. */
function isRouted(slot: CborValue | undefined): slot is CborMap {
  return isPlainMap(slot) && Array.isArray(slot.source) && slot.source.length === 2 && typeof slot.destModuleTypeString === "string" && typeof slot.destModuleParamName === "string";
}

const sourceName = (index: CborValue) => (typeof index === "number" ? (SERUM_MOD_SOURCES[index] ?? `Source ${index}`) : "None");

/** The engine's controls by id, for their live positions. */
export type LiveControls = ReadonlyMap<string, Pick<EngineParameter, "value" | "text">>;

export function liveControls(parameters: readonly EngineParameter[]): LiveControls {
  return new Map(parameters.map((p) => [p.id, p]));
}

/** A control at the engine's position when it reports one (Serum's own), else where the settings put it. */
function control(param: string, fromSettings: number, live: LiveControls): SerumControl {
  const own = live.get(param);
  return own ? { param, value: own.value, text: own.text } : { param, value: fromSettings };
}

/** A destination's name for people: Serum's control's, else module and parameter. */
function destinationLabel(dest: Destination, body: CborMap): string {
  return destinationName(dest, bodyContext(body)) ?? `${dest.module} ${dest.id + 1} ${dest.param.replace(/^kParam/, "")}`;
}

/** The mod matrix's routes, by slot. */
export function readRoutes(body: CborMap, live: LiveControls = new Map()): SerumModRoute[] {
  const routes: SerumModRoute[] = [];
  for (let n = 0; n < SERUM_MOD_SLOTS; n++) {
    const slot = body[`ModSlot${n}`];
    if (!isRouted(slot)) continue;
    const [source, aux] = slot.source as CborValue[];
    const params = stored(slot);
    const dest: Destination = { module: slot.destModuleTypeString as string, id: number(slot.destModuleID, 0), paramId: number(slot.destModuleParamID, 0), param: slot.destModuleParamName as string };
    routes.push({
      slot: n + 1,
      source: sourceName(source),
      aux: aux === 0 || aux === undefined ? null : sourceName(aux),
      to: destinationLabel(dest, body),
      amount: control(serumModAmountParam(n + 1), modAmountToValue(number(params.kParamAmount, 0)), live),
      bipolar: params.kParamBipolar === 1,
      bypass: params.kParamBypass === 1,
    });
  }
  return routes;
}

/** What Serum stores for an envelope control it leaves out (its default): seconds, the sustain knob, curves. */
function envelopeDefault(index: number, field: SerumEnvelopeField): number {
  switch (field) {
    case "attack":
      return index === 1 ? 0.001 : 0.0005;
    case "hold":
      return 0;
    case "decay":
      return 1;
    case "sustain":
      return 1;
    case "release":
      return 0.015;
    case "attackCurve":
      return 50;
    default:
      return 66.6;
  }
}

const ENVELOPE_KEYS: Record<SerumEnvelopeField, string> = {
  attack: "kParamAttack",
  hold: "kParamHold",
  decay: "kParamDecay",
  sustain: "kParamSustain",
  release: "kParamRelease",
  attackCurve: "kParamCurve1",
  decayCurve: "kParamCurve2",
  releaseCurve: "kParamCurve3",
};

export function readEnvelopes(body: CborMap, routes: readonly SerumModRoute[], live: LiveControls = new Map()): SerumEnvelope[] {
  return Array.from({ length: SERUM_ENVELOPES }, (_, i) => {
    const index = i + 1;
    const params = stored(body[`Env${i}`]);
    const controls = Object.fromEntries(
      SERUM_ENVELOPE_FIELDS.map((field) => [field, control(serumEnvelopeParam(index, field), envelopeValueOf(field, number(params[ENVELOPE_KEYS[field]], envelopeDefault(index, field))), live)]),
    ) as Record<SerumEnvelopeField, SerumControl>;
    return { index, used: index === 1 || sourceUsed(routes, `Env ${index}`), controls };
  });
}

const LFO_KEYS: Record<SerumLfoField, string> = { rate: "kParamRate", smooth: "kParamSmooth", rise: "kParamRise", delay: "kParamDelay", phase: "kParamPhase" };
/** A synced 1/4, Serum's default rate (the knob's middle). */
const DEFAULT_RATE = LFO_DIVISIONS.get("1/4")!.plain;

/** An LFO's drawn shape, if it has one of its own that reads cleanly. */
function shapeOf(lfo: CborValue | undefined): SerumLfoPoint[] | null {
  const data = isPlainMap(lfo) ? lfo.curveData : undefined;
  if (!isPlainMap(data)) return null;
  const { numPoints, xVals, yVals, curveVals } = data;
  if (typeof numPoints !== "number" || !Array.isArray(xVals) || !Array.isArray(yVals)) return null;
  const n = numPoints + 1;
  if (n < 2 || xVals.length !== n || yVals.length !== n) return null;
  const points: SerumLfoPoint[] = [];
  for (let i = 0; i < n; i++) {
    const [x, y] = [xVals[i], yVals[i]];
    const curve = Array.isArray(curveVals) ? curveVals[i] : 0.5;
    if (typeof x !== "number" || typeof y !== "number") return null;
    points.push(typeof curve === "number" && curve !== 0.5 ? [x, y, curve] : [x, y]);
  }
  return points;
}

export function readLfos(body: CborMap, routes: readonly SerumModRoute[], live: LiveControls = new Map()): SerumLfo[] {
  return Array.from({ length: SERUM_LFOS }, (_, i) => {
    const index = i + 1;
    const module = body[`LFO${i}`];
    const params = stored(module);
    const defaults: Record<SerumLfoField, number> = { rate: DEFAULT_RATE, smooth: 0, rise: 0, delay: 0, phase: 0 };
    const controls = Object.fromEntries(
      SERUM_LFO_FIELDS.map((field) => [field, control(serumLfoParam(index, field), lfoValueOf(field, number(params[LFO_KEYS[field]], defaults[field])), live)]),
    ) as Record<SerumLfoField, SerumControl>;
    const shape = shapeOf(module);
    return {
      index,
      used: sourceUsed(routes, `LFO ${index}`),
      sync: params.kParamBeatSync !== 0,
      dotted: params.kParamDotted === 1,
      triplets: params.kParamTriplets === 1,
      rate10x: params.kParamRate10x === 1,
      mode: params.kParamMode === "Free" ? "free" : params.kParamMode === "Envelope" ? "envelope" : "retrigger",
      type: typeof params.kParamType === "string" ? params.kParamType : null,
      shape: shape ?? SERUM_DEFAULT_LFO_SHAPE,
      customShape: shape !== null,
      controls,
    };
  });
}

/** A file's name without its folders or extension ("S2 Tables/Default Shapes.wav" → "Default Shapes"). */
const fileName = (path: unknown) => (typeof path === "string" && path ? (path.split(/[\\/]/).pop() ?? path).replace(/\.[^.]+$/, "") : "");

const KIND_NAMES: Record<OscillatorType, string> = { wavetable: "Wavetable", sample: "Sample", multisample: "Multisample", granular: "Granular", spectral: "Spectral" };
const SUB_SHAPES: Record<string, string> = { kRoundRect: "Round rect", kTriangle: "Triangle", kSaw: "Saw", kSquare: "Square", kPulse: "Pulse" };

/**
 * Serum's five oscillators: what each plays, whether it's on (Serum's switch: A is on by default, the others off) and
 * its level (the knob's place, its gain the square: A, B, C and the sub at 75%, the noise at 25% by default).
 */
export function readOscillators(body: CborMap, live: LiveControls = new Map()): SerumOscillator[] {
  return SERUM_OSCILLATORS.map((name, index) => {
    const osc = isPlainMap(body[`Oscillator${index}`]) ? (body[`Oscillator${index}`] as CborMap) : {};
    const params = stored(osc);
    let kind: string;
    let plays: string;
    if (index === 3) {
      kind = "Noise";
      plays = fileName(isPlainMap(osc.NoiseOsc3) ? osc.NoiseOsc3.relativePathToNoiseSample : undefined) || "Noise";
    } else if (index === 4) {
      kind = "Sub";
      const shape = stored(osc.SubOsc4).kParamShape;
      plays = (typeof shape === "string" && SUB_SHAPES[shape]) || "Sine";
    } else {
      const type = (Object.keys(OSCILLATOR_TYPES) as OscillatorType[]).find((t) => OSCILLATOR_TYPES[t].value === (params.kParamType ?? null)) ?? "wavetable";
      const module = osc[`${OSCILLATOR_TYPES[type].module}${index}`];
      kind = KIND_NAMES[type];
      plays = isPlainMap(module)
        ? (typeof module.tableDisplayName === "string" && module.tableDisplayName) || fileName(module.relativePathToWT ?? module.samplePathRelative ?? module.sfzPathRelative)
        : "";
    }
    const enabled = number(params.kParamEnable, index === 0 ? 1 : 0) >= 0.5 ? 1 : 0;
    const gain = number(params.kParamVolume, index === 3 ? 0.0625 : 0.5625);
    return {
      index,
      name,
      kind,
      plays,
      enabled: control(serumOscillatorParam(index, "enable"), enabled, live),
      level: control(serumOscillatorParam(index, "level"), Math.sqrt(Math.max(0, gain)), live),
      octave: number(params.kParamOctave, 0),
      semi: number(params.kParamPitch, 0),
    };
  });
}

/** The routes, envelopes, LFOs and oscillators of Serum's settings, at the engine's live positions. */
export function readSoundParts(body: CborMap, live: LiveControls = new Map()): { modulation: SerumModRoute[]; envelopes: SerumEnvelope[]; lfos: SerumLfo[]; oscillators: SerumOscillator[] } {
  const modulation = readRoutes(body, live);
  return { modulation, envelopes: readEnvelopes(body, modulation, live), lfos: readLfos(body, modulation, live), oscillators: readOscillators(body, live) };
}

/** Every destination a route can have in this sound, by name: Serum's controls, then its effects' parameters. */
export function destinationNames(body: CborMap): string[] {
  const ctx = bodyContext(body);
  const names = new Set<string>();
  for (const [, name] of CONTROLS) {
    if (/ Param\d+$/.test(name) || /^FX (Main|Bus \d) Param/.test(name)) continue;
    if (typeof parseDestination(name, ctx) !== "string") names.add(name);
  }
  FX_RACKS.forEach((_, rack) => {
    for (let position = 0; ; position++) {
      const module = ctx.effectAt(rack, position);
      if (!module) break;
      if (!isModuleType(module)) continue;
      for (const param of MODULE_PARAMS[module] as readonly string[]) {
        const name = `${["Main", "Bus 1", "Bus 2"][rack]} FX ${position + 1} ${param.replace(/^kParam/, "")}`;
        if (typeof parseDestination(name, ctx) !== "string") names.add(name);
      }
    }
  });
  return [...names];
}

/** The macro names a preset gave (`names`, "" for none) written where Serum reads them on a load: they're lost on Serum's own re-save. */
export function withMacroNames(body: CborMap, names: readonly string[]): CborMap {
  const out = { ...body };
  names.slice(0, 8).forEach((name, i) => {
    const macro = out[`Macro${i}`];
    if (!name || !isPlainMap(macro)) return;
    out[`Macro${i}`] = { ...macro, name };
  });
  return out;
}

/** A body's macro names (a preset's, "" where it names none). */
export function macroNamesOf(body: CborMap): string[] {
  return Array.from({ length: 8 }, (_, i) => {
    const macro = body[`Macro${i}`];
    return isPlainMap(macro) && typeof macro.name === "string" ? macro.name : "";
  });
}

const inRange = (value: unknown, from: number, to: number): value is number => typeof value === "number" && Number.isInteger(value) && value >= from && value <= to;

function routedSlots(body: CborMap): number[] {
  return Array.from({ length: SERUM_MOD_SLOTS }, (_, n) => n).filter((n) => isRouted(body[`ModSlot${n}`])).map((n) => n + 1);
}

function editRoute(body: CborMap, edit: Extract<SerumSoundEdit, { kind: "route" }>, where: string, errors: string[]) {
  if (edit.slot !== undefined && !inRange(edit.slot, 1, SERUM_MOD_SLOTS)) {
    errors.push(`${where}.slot must be 1 to ${SERUM_MOD_SLOTS}.`);
    return;
  }
  const existing = edit.slot !== undefined && isRouted(body[`ModSlot${edit.slot - 1}`]);
  let n: number;
  if (existing) n = edit.slot! - 1;
  else {
    if (edit.source === undefined || edit.to === undefined) {
      const routed = routedSlots(body);
      errors.push(
        `${where}: a new route needs "source" and "to"${edit.slot !== undefined ? ` (slot ${edit.slot} has no route${routed.length ? `; the routed slots are ${routed.join(", ")}` : ""})` : ""}.`,
      );
      return;
    }
    const free = edit.slot !== undefined ? edit.slot - 1 : Array.from({ length: SERUM_MOD_SLOTS }, (_, i) => i).find((i) => !isRouted(body[`ModSlot${i}`]));
    if (free === undefined) {
      errors.push(`${where}: all ${SERUM_MOD_SLOTS} of Serum's mod slots are in use; remove a route first.`);
      return;
    }
    n = free;
  }
  const module: CborMap = existing ? clone(body[`ModSlot${n}`] as CborMap) : { plainParams: {} };
  const [oldSource, oldAux] = existing ? (module.source as number[]) : [0, 0];
  const source = edit.source === undefined ? oldSource : sourceIndex(edit.source, `${where}.source`, errors);
  const aux = edit.aux === undefined ? oldAux : edit.aux === null || edit.aux === "None" ? 0 : sourceIndex(edit.aux, `${where}.aux`, errors);
  if (source === 0 && edit.source !== undefined) errors.push(`${where}.source can't be "None": remove the route instead.`);
  if (edit.to !== undefined) {
    const dest = typeof edit.to === "string" ? parseDestination(edit.to, bodyContext(body)) : `${where}.to must be a destination's name ("Filter 1 Freq").`;
    if (typeof dest === "string") errors.push(dest.startsWith(where) ? dest : `${where}.to: ${dest}`);
    else Object.assign(module, { destModuleTypeString: dest.module, destModuleID: dest.id, destModuleParamID: dest.paramId, destModuleParamName: dest.param });
  }
  if (source !== undefined && aux !== undefined) module.source = [source, aux];
  const params = paramsOf(module);
  const amount = edit.amount ?? (existing ? undefined : 50);
  if (amount !== undefined) {
    if (typeof amount !== "number" || !Number.isFinite(amount) || amount < -100 || amount > 100) errors.push(`${where}.amount must be −100 to 100 (%).`);
    else params.kParamAmount = amount;
  }
  for (const [key, param] of [
    ["bipolar", "kParamBipolar"],
    ["bypass", "kParamBypass"],
  ] as const) {
    const value = edit[key];
    if (value === undefined) continue;
    if (typeof value !== "boolean") errors.push(`${where}.${key} must be true or false.`);
    else if (value) params[param] = 1;
    else delete params[param];
  }
  body[`ModSlot${n}`] = module;
}

const ENVELOPE_EDIT_KEYS = new Set<string>(["kind", "envelope", ...SERUM_ENVELOPE_FIELDS]);
const LFO_EDIT_KEYS = new Set(["kind", "lfo", "rate", "sync", "mode", "smooth", "rise", "delay", "phase", "shape"]);

function editLfo(body: CborMap, edit: Extract<SerumSoundEdit, { kind: "lfo" }>, where: string, errors: string[]) {
  if (!inRange(edit.lfo, 1, SERUM_LFOS)) {
    errors.push(`${where}.lfo must be 1 to ${SERUM_LFOS}.`);
    return;
  }
  for (const key of Object.keys(edit)) if (!LFO_EDIT_KEYS.has(key)) errors.push(`${where}.${key} isn't an LFO's; they are: ${[...LFO_EDIT_KEYS].slice(2).join(", ")}.`);
  const { kind: _, lfo: index, mode, shape, ...rest } = edit;
  const spec: Record<string, unknown> = { ...rest };
  // A division is a synced rate, a number a free one, unless said otherwise.
  if (typeof rest.rate === "string" && rest.sync === undefined) spec.sync = true;
  if (typeof rest.rate === "number" && rest.sync === undefined) spec.sync = false;
  if (shape !== undefined && shape !== null) spec.shape = { points: shape };
  writeEnvelopesAndLfos(body, { lfos: { [String(index)]: spec } }, errors);
  const lfo = body[`LFO${index - 1}`];
  if (!isPlainMap(lfo)) return;
  if (mode !== undefined) {
    if (mode === "retrigger") delete paramsOf(lfo).kParamMode;
    else if (mode === "free") paramsOf(lfo).kParamMode = "Free";
    else if (mode === "envelope") paramsOf(lfo).kParamMode = "Envelope";
    else errors.push(`${where}.mode must be "retrigger", "free" or "envelope".`);
  }
  if (shape === null) {
    lfo.curveData = {};
    delete lfo.curveDisplayName;
  }
}

/**
 * `edits` applied to Serum's settings (a copy): routes added, changed and removed, envelopes and LFOs set. Values in
 * the spec's units (`preset-format.md`). Throws `SpecError` with every problem, each saying what would do.
 */
export function editSerumBody(body: CborMap, edits: unknown): CborMap {
  if (!Array.isArray(edits) || !edits.length) throw new SpecError(['"edits" must be a list of changes: { "kind": "route" | "removeRoute" | "envelope" | "lfo", … }.']);
  const out = clone(body);
  const errors: string[] = [];
  edits.forEach((edit: SerumSoundEdit, i) => {
    const where = edits.length > 1 ? `edits[${i}]` : "edit";
    if (!isPlainMap(edit as unknown as CborValue)) {
      errors.push(`${where} must be an object with "kind".`);
      return;
    }
    switch (edit.kind) {
      case "route":
        return editRoute(out, edit, where, errors);
      case "removeRoute": {
        if (!inRange(edit.slot, 1, SERUM_MOD_SLOTS) || !isRouted(out[`ModSlot${edit.slot - 1}`])) {
          const routed = routedSlots(out);
          errors.push(`${where}.slot ${JSON.stringify(edit.slot)} has no route to remove; ${routed.length ? `the routed slots are ${routed.join(", ")}` : "there are no routes"}.`);
          return;
        }
        out[`ModSlot${edit.slot - 1}`] = { plainParams: "default" };
        return;
      }
      case "envelope": {
        if (!inRange(edit.envelope, 1, SERUM_ENVELOPES)) {
          errors.push(`${where}.envelope must be 1 to ${SERUM_ENVELOPES}.`);
          return;
        }
        for (const key of Object.keys(edit)) if (!ENVELOPE_EDIT_KEYS.has(key)) errors.push(`${where}.${key} isn't an envelope's; they are: ${SERUM_ENVELOPE_FIELDS.join(", ")}.`);
        const { kind: _, envelope, ...fields } = edit;
        writeEnvelopesAndLfos(out, { envelopes: { [String(envelope)]: fields } as never }, errors);
        return;
      }
      case "lfo":
        return editLfo(out, edit, where, errors);
      default:
        errors.push(`${where}.kind is ${JSON.stringify((edit as { kind?: unknown }).kind)}; it must be "route", "removeRoute", "envelope" or "lfo".`);
    }
  });
  if (errors.length) throw new SpecError(errors);
  return out;
}
