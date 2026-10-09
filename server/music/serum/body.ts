/**
 * Serum's settings (the CBOR body of a preset) to and from the spec.
 *
 * Writing starts from the template (Serum's init patch, `template.ts`), sets the spec's named fields, then
 * applies `raw`. Reading takes the named fields out of a body, writes them onto the template the same way, and
 * keeps the difference from the body as `raw`: so `specToBody(bodyToSpec(body))` is `body`, key for key and
 * number for number (the units round-trip exactly, `units.ts`), and the writer and the reader can't disagree,
 * because the reader uses the writer to know what's left over.
 */
import { fxParamName } from "../../../shared/music/serum-effects.ts";
import { type CborMap, type CborValue, isPlainMap } from "./cbor.ts";
import { choiceOptions, FX_RACKS, FX_TYPES, MOD_SOURCES, MODULE_PARAMS, OSCILLATOR_TYPES, type OscillatorType } from "./catalogue.ts";
import { type DestinationContext, destinationName, parseDestination } from "./destinations.ts";
import {
  checkKeys,
  ENVELOPE_FIELDS,
  type Field,
  FILTER_FIELDS,
  GLOBAL_FIELDS,
  LFO_FIELDS,
  leftoverParams,
  MACRO_FIELDS,
  MOD_FIELDS,
  NOISE_FIELDS,
  NOISE_TYPE_FIELDS,
  OSCILLATOR_FIELDS,
  paramsOf,
  readFields,
  ROUTING_FIELDS,
  type SpecObject,
  SUB_FIELDS,
  SUB_TYPE_FIELDS,
  TYPE_FIELDS,
  writeFields,
  writeRawParams,
} from "./fields.ts";
import { applyPatch, clone, diff, fromJson, type JsonValue, toJson } from "./patch.ts";
import { OSCILLATOR_KEYS, ROUTING_KEYS, type SerumPresetSpec } from "./spec.ts";
import { PRESET_TEMPLATE } from "./template.ts";
import { divisionOf, LFO_DIVISIONS } from "./units.ts";

/** What Serum records about a file it loads by path (it works them out again on load: these only match its own files). */
export interface FileFacts {
  numFrames: number;
  numChannels: number;
  sampleRate: number;
}

export interface BodyOptions {
  /** The facts of a wavetable or sample by its path in one of Serum's folders, when this computer has it. */
  fileFacts?: (folder: "Tables" | "Samples", path: string) => FileFacts | undefined;
}

/** A spec Serum can't take: every problem found, each saying where and what would do. */
export class SpecError extends Error {
  constructor(readonly problems: string[]) {
    super(`The preset spec has ${problems.length} problem${problems.length === 1 ? "" : "s"}:\n- ${problems.join("\n- ")}`);
    this.name = "SpecError";
  }
}

const TOP_KEYS = ["name", "author", "description", "tags", "serum", "global", "oscillators", "filters", "routing", "envelopes", "lfos", "modulation", "macros", "fx", "raw"];

function isObject(value: unknown): value is SpecObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function mod(body: CborMap, key: string): CborMap {
  const m = body[key];
  if (!isPlainMap(m)) throw new Error(`The template has no module ${key}.`);
  return m;
}

/** A module's stored parameters, or none. */
function storedParams(module: CborValue | undefined): CborMap | undefined {
  return isPlainMap(module) && isPlainMap(module.plainParams) ? module.plainParams : undefined;
}

/** Each of a spec section's numbered entries ("1".."n") with its index (0-based). */
function numbered(section: unknown, count: number, where: string, errors: string[]): [number, SpecObject][] {
  if (section === undefined) return [];
  if (!isObject(section)) {
    errors.push(`${where} must be an object keyed "1" to "${count}".`);
    return [];
  }
  const out: [number, SpecObject][] = [];
  for (const [key, value] of Object.entries(section)) {
    const n = Number(key);
    if (!Number.isInteger(n) || n < 1 || n > count || String(n) !== key) {
      errors.push(`${where}.${key}: the keys are "1" to "${count}".`);
      continue;
    }
    if (!isObject(value)) {
      errors.push(`${where}.${key} must be an object.`);
      continue;
    }
    out.push([n - 1, value]);
  }
  return out;
}

/** A module with named fields and `params`. */
function writeModule(module: CborMap, spec: SpecObject, fields: Field[], known: readonly string[], where: string, errors: string[], extra: string[] = []) {
  checkKeys(spec, fields, ["params", ...extra], where, errors);
  writeFields(spec, fields, () => paramsOf(module), where, errors);
  writeRawParams(spec.params, known, () => paramsOf(module), `${where}.params`, errors);
}

function readModule(module: CborValue | undefined, template: CborValue | undefined, fields: Field[], known: readonly string[], into: SpecObject = {}): SpecObject {
  const stored = storedParams(module);
  const base = storedParams(template);
  const used = readFields(stored, base, fields, into);
  const params = leftoverParams(stored, base, used, known);
  if (params) into.params = params;
  return into;
}

/** Point a module at a file by path; the facts Serum keeps about the old file go (Serum works them out again). */
function setFile(module: CborMap, key: string, path: unknown, folder: "Tables" | "Samples" | null, where: string, errors: string[], options: BodyOptions, stale: string[] = []) {
  if (path === undefined) return;
  if (typeof path !== "string" || !path) {
    errors.push(`${where} must be a file's path, relative to Serum's ${folder ?? "preset"} folder.`);
    return;
  }
  if (module[key] === path) return;
  module[key] = path;
  for (const fact of ["numFrames", "numChannels", "sampleRate", ...stale]) delete module[fact];
  const facts = folder ? options.fileFacts?.(folder, path) : undefined;
  if (facts) Object.assign(module, facts);
}

// ---- Effects ----

export { fxParamName };

const FX_RESERVED = new Set(["effect", "enabled", "ir", "params", "module", "entry"]);
const FX_NAMES = new Map(
  FX_TYPES.map(({ module }) => {
    const names = new Map<string, string>();
    for (const param of MODULE_PARAMS[module] as readonly string[]) {
      if (param === "kParamEnable") continue;
      const name = fxParamName(param);
      if (names.has(name) || FX_RESERVED.has(name)) throw new Error(`Two of ${module}'s parameters are both "${name}".`);
      names.set(name, param);
    }
    return [module, names] as const;
  }),
);

/** An effect of a spec (`{ effect, enabled?, …parameters }`) as a rack's entry, or undefined with its problems in `errors`. */
export function writeEffect(spec: unknown, where: string, errors: string[]): CborMap | undefined {
  if (!isObject(spec)) {
    errors.push(`${where} must be an object with "effect".`);
    return undefined;
  }
  const kind = FX_TYPES.find((t) => t.effect === spec.effect);
  if (!kind) {
    errors.push(`${where}.effect is ${JSON.stringify(spec.effect)}; it must be one of: ${FX_TYPES.map((t) => t.effect).join(", ")}.`);
    return undefined;
  }
  const names = FX_NAMES.get(kind.module)!;
  const params: CborMap = {};
  for (const [key, value] of Object.entries(spec)) {
    if (key === "effect" || key === "params" || key === "module" || key === "entry" || key === "ir") continue;
    if (key === "enabled") {
      if (typeof value !== "boolean") errors.push(`${where}.enabled must be true or false.`);
      else params.kParamEnable = value ? 1 : 0;
      continue;
    }
    const param = names.get(key);
    if (!param) {
      errors.push(`${where}.${key} isn't a parameter of ${kind.effect}; its parameters are: ${[...names.keys()].join(", ")}.`);
      continue;
    }
    const choice = `${kind.module}.${param}`;
    const options = choiceOptions(choice);
    if (options && typeof value === "string" && !options.includes(value)) {
      errors.push(`${where}.${key} is ${JSON.stringify(value)}; it must be one of: ${options.join(", ")}.`);
      continue;
    }
    if (typeof value !== "number" && typeof value !== "string") {
      errors.push(`${where}.${key} must be a number${options ? " or an option's name" : ""}.`);
      continue;
    }
    params[param] = value;
  }
  writeRawParams(spec.params, MODULE_PARAMS[kind.module], () => params, `${where}.params`, errors);
  const moduleFields = rawFields(spec.module, `${where}.module`, errors);
  const entryFields = rawFields(spec.entry, `${where}.entry`, errors);
  const module: CborMap = { ...moduleFields, plainParams: params };
  if (spec.ir !== undefined) {
    if (kind.effect !== "convolve" || typeof spec.ir !== "string") errors.push(`${where}.ir is a convolve effect's impulse: a path relative to Serum's Impulses folder.`);
    else module.relativePathToIR = spec.ir;
  }
  return { ...entryFields, [kind.module]: module, type: kind.type };
}

function rawFields(value: unknown, where: string, errors: string[]): CborMap {
  if (value === undefined) return {};
  if (!isObject(value)) {
    errors.push(`${where} must be an object.`);
    return {};
  }
  try {
    const out = fromJson(value as JsonValue, where);
    return isPlainMap(out) ? out : {};
  } catch (e) {
    errors.push((e as Error).message);
    return {};
  }
}

function readEffect(entry: CborValue): SpecObject | undefined {
  if (!isPlainMap(entry)) return undefined;
  const kinds = FX_TYPES.filter((t) => Object.hasOwn(entry, t.module));
  if (kinds.length !== 1 || entry.type !== kinds[0].type) return undefined;
  const kind = kinds[0];
  const module = entry[kind.module];
  if (!isPlainMap(module)) return undefined;
  const stored = module.plainParams === "default" ? {} : module.plainParams;
  if (!isPlainMap(stored)) return undefined;
  const fx: SpecObject = { effect: kind.effect };
  const params: Record<string, number | string> = {};
  const known = MODULE_PARAMS[kind.module] as readonly string[];
  for (const [param, value] of Object.entries(stored)) {
    if (typeof value !== "number" && typeof value !== "string") return undefined;
    if (typeof value === "number" && !Number.isFinite(value)) return undefined;
    if (param === "kParamEnable" && (value === 0 || value === 1)) fx.enabled = value === 1;
    else if (param !== "kParamEnable" && known.includes(param)) fx[fxParamName(param)] = value;
    else if (known.includes(param)) params[param] = value;
    else return undefined;
  }
  if (Object.keys(params).length) fx.params = params;
  const moduleFields: Record<string, JsonValue> = {};
  for (const [key, value] of Object.entries(module)) {
    if (key === "plainParams") continue;
    if (key === "relativePathToIR" && kind.effect === "convolve" && typeof value === "string") fx.ir = value;
    else moduleFields[key] = toJson(value);
  }
  if (Object.keys(moduleFields).length) fx.module = moduleFields;
  const entryFields: Record<string, JsonValue> = {};
  for (const [key, value] of Object.entries(entry)) if (key !== kind.module && key !== "type") entryFields[key] = toJson(value);
  if (Object.keys(entryFields).length) fx.entry = entryFields;
  return fx;
}

// ---- LFOs ----

/** Whether points make a shape Serum stores: two or more, x from 0 rising to 1, every value 0–1. */
function shapeProblem(points: unknown): string | undefined {
  if (!Array.isArray(points) || points.length < 2) return "points must be a list of at least two [x, y] or [x, y, curve].";
  let last = -Infinity;
  for (const [i, p] of points.entries()) {
    if (!Array.isArray(p) || (p.length !== 2 && p.length !== 3) || !p.every((v) => typeof v === "number" && v >= 0 && v <= 1))
      return `points[${i}] must be [x, y] or [x, y, curve], each 0–1.`;
    if (p[0] < last) return `points[${i}]: x must not go back (it's ${p[0]} after ${last}).`;
    last = p[0];
  }
  if (points[0][0] !== 0 || points[points.length - 1][0] !== 1) return "points must start at x 0 and end at x 1.";
  return undefined;
}

function writeShape(lfo: CborMap, shape: unknown, where: string, errors: string[]) {
  if (shape === undefined) return;
  if (!isObject(shape)) {
    errors.push(`${where} must be { "points": [[x, y], ...] }.`);
    return;
  }
  for (const key of Object.keys(shape)) if (!["points", "name", "loopback"].includes(key)) errors.push(`${where}.${key} isn't a field here; the fields are: points, name, loopback.`);
  const problem = shapeProblem(shape.points);
  if (problem) {
    errors.push(`${where}.${problem}`);
    return;
  }
  const points = shape.points as number[][];
  const data: CborMap = {
    curveVals: points.map((p) => (p.length === 3 ? p[2] : 0.5)),
    numPoints: points.length - 1,
    xVals: points.map((p) => p[0]),
    yVals: points.map((p) => p[1]),
  };
  if (shape.loopback !== undefined) {
    if (!Number.isInteger(shape.loopback)) errors.push(`${where}.loopback must be a whole number.`);
    else data.loopbackPointNum = shape.loopback as number;
  }
  lfo.curveData = data;
  if (shape.name !== undefined) {
    if (typeof shape.name !== "string") errors.push(`${where}.name must be text.`);
    else lfo.curveDisplayName = shape.name;
  }
}

function readShape(lfo: CborMap): SpecObject | undefined {
  const data = lfo.curveData;
  if (!isPlainMap(data) || !Object.keys(data).length) return undefined;
  const { numPoints, xVals, yVals, curveVals } = data;
  if (!Object.keys(data).every((k) => ["numPoints", "xVals", "yVals", "curveVals", "loopbackPointNum"].includes(k))) return undefined;
  if (!Number.isInteger(numPoints) || !Array.isArray(xVals) || !Array.isArray(yVals) || !Array.isArray(curveVals)) return undefined;
  const n = (numPoints as number) + 1;
  if (xVals.length !== n || yVals.length !== n || curveVals.length !== n) return undefined;
  const points = xVals.map((x, i) => (curveVals[i] === 0.5 ? [x, yVals[i]] : [x, yVals[i], curveVals[i]]));
  if (shapeProblem(points)) return undefined;
  const shape: SpecObject = { points };
  if (data.loopbackPointNum !== undefined) {
    if (!Number.isInteger(data.loopbackPointNum)) return undefined;
    shape.loopback = data.loopbackPointNum;
  }
  if (typeof lfo.curveDisplayName === "string") shape.name = lfo.curveDisplayName;
  return shape;
}

function writeLfo(lfo: CborMap, spec: SpecObject, where: string, errors: string[]) {
  writeModule(lfo, spec, LFO_FIELDS, MODULE_PARAMS.LFO, where, errors, ["rate", "shape"]);
  const rate = spec.rate;
  if (typeof rate === "number") {
    if (!Number.isFinite(rate) || rate < 0 || rate > 100) errors.push(`${where}.rate is ${rate}; Serum's range is 0 to 100 (Hz when free).`);
    else paramsOf(lfo).kParamRate = rate;
  } else if (typeof rate === "string") {
    const division = LFO_DIVISIONS.get(rate);
    if (!division) errors.push(`${where}.rate is "${rate}"; a synced rate is one of: ${[...LFO_DIVISIONS.keys()].join(", ")} (or a number).`);
    else if (spec.sync === false) errors.push(`${where}.rate "${rate}" is a division, but sync is false: give a number (Hz) or sync: true.`);
    else {
      const flag = division.kind === "dotted" ? "dotted" : division.kind === "triplet" ? "triplets" : null;
      if (flag && spec[flag] === false) errors.push(`${where}.rate "${rate}" needs ${flag}: true.`);
      else {
        if (flag && spec[flag] === undefined) paramsOf(lfo)[flag === "dotted" ? "kParamDotted" : "kParamTriplets"] = 1;
        paramsOf(lfo).kParamRate = division.plain;
      }
    }
  } else if (rate !== undefined) errors.push(`${where}.rate must be a division ("1/4") or a number.`);
  writeShape(lfo, spec.shape, `${where}.shape`, errors);
}

function readLfo(lfo: CborValue, template: CborValue): SpecObject {
  const out: SpecObject = {};
  if (!isPlainMap(lfo)) return out;
  const stored = storedParams(lfo);
  const base = storedParams(template);
  const used = readFields(stored, base, LFO_FIELDS, out);
  if (stored && typeof stored.kParamRate === "number" && Number.isFinite(stored.kParamRate) && base?.kParamRate !== stored.kParamRate) {
    const synced = stored.kParamBeatSync === undefined || stored.kParamBeatSync === 1;
    const division = synced ? divisionOf(stored.kParamRate) : undefined;
    const kind = division ? LFO_DIVISIONS.get(division)!.kind : undefined;
    const shown = kind === "straight" || (kind === "dotted" && stored.kParamDotted === 1) || (kind === "triplet" && stored.kParamTriplets === 1);
    out.rate = division && shown ? division : stored.kParamRate;
    used.add("kParamRate");
  }
  const params = leftoverParams(stored, base, used, MODULE_PARAMS.LFO);
  if (params) out.params = params;
  const shape = readShape(lfo);
  if (shape) out.shape = shape;
  return out;
}

// ---- Modulation ----

/** A mod source by its name (`MOD_SOURCES`, any case) or number; why not in `errors`. */
export function sourceIndex(value: unknown, where: string, errors: string[]): number | undefined {
  if (typeof value === "number" && Number.isInteger(value) && value >= 0) return value;
  if (typeof value === "string") {
    const exact = (MOD_SOURCES as readonly string[]).indexOf(value);
    if (exact >= 0) return exact;
    const loose = MOD_SOURCES.findIndex((s) => s.toLowerCase() === value.toLowerCase());
    if (loose >= 0) return loose;
  }
  errors.push(`${where} is ${JSON.stringify(value)}; a source is one of: ${MOD_SOURCES.slice(1).join(", ")} (or its number).`);
  return undefined;
}

const sourceName = (index: number): string | number => (index < MOD_SOURCES.length ? MOD_SOURCES[index] : index);

function writeModulation(body: CborMap, list: unknown, ctx: DestinationContext, errors: string[]) {
  if (list === undefined) return;
  if (!Array.isArray(list)) {
    errors.push("modulation must be a list of { source, to, amount }.");
    return;
  }
  const slots: (number | undefined)[] = list.map(() => undefined);
  const taken = new Set<number>();
  list.forEach((entry, i) => {
    if (!isObject(entry) || entry.slot === undefined) return;
    const slot = entry.slot;
    if (typeof slot !== "number" || !Number.isInteger(slot) || slot < 1 || slot > 64) errors.push(`modulation[${i}].slot must be 1 to 64.`);
    else if (taken.has(slot)) errors.push(`modulation[${i}].slot ${slot} is already used.`);
    else {
      taken.add(slot);
      slots[i] = slot - 1;
    }
  });
  let next = 0;
  list.forEach((entry, i) => {
    const where = `modulation[${i}]`;
    if (!isObject(entry)) {
      errors.push(`${where} must be { source, to, amount }.`);
      return;
    }
    if (slots[i] === undefined && entry.slot === undefined) {
      while (taken.has(next + 1)) next++;
      if (next >= 64) {
        errors.push(`${where}: Serum has 64 mod slots.`);
        return;
      }
      slots[i] = next;
      taken.add(next + 1);
    }
    const slot = slots[i];
    if (slot === undefined) return;
    checkKeys(entry, MOD_FIELDS, ["slot", "source", "aux", "to", "params", "curve"], where, errors);
    const source = entry.source === undefined ? (errors.push(`${where}.source is required.`), undefined) : sourceIndex(entry.source, `${where}.source`, errors);
    const aux = entry.aux === undefined ? 0 : sourceIndex(entry.aux, `${where}.aux`, errors);
    let dest: ReturnType<typeof parseDestination> | undefined;
    if (typeof entry.to === "string") dest = parseDestination(entry.to, ctx);
    else if (isObject(entry.to)) {
      const { module, id, param, paramId } = entry.to;
      if (typeof module !== "string" || typeof param !== "string" || !Number.isInteger(id) || !Number.isInteger(paramId))
        dest = `${where}.to as an object is { module, id, param, paramId } (e.g. { "module": "WTOsc", "id": 0, "param": "kParamTablePos", "paramId": 6 }).`;
      else dest = { module, id: id as number, param, paramId: paramId as number };
    } else dest = `${where}.to is required: a control's name ("A WT Pos") or { module, id, param, paramId }.`;
    if (typeof dest === "string") errors.push(dest.startsWith(where) ? dest : `${where}.to: ${dest}`);
    const module: CborMap = { plainParams: {} };
    writeFields(entry, MOD_FIELDS, () => module.plainParams as CborMap, where, errors);
    writeRawParams(entry.params, MODULE_PARAMS.ModSlot, () => module.plainParams as CborMap, `${where}.params`, errors);
    if (entry.curve !== undefined) module.flex = rawValue(entry.curve, `${where}.curve`, errors);
    if (source === undefined || aux === undefined || typeof dest !== "object") return;
    Object.assign(module, {
      source: [source, aux],
      destModuleTypeString: dest.module,
      destModuleID: dest.id,
      destModuleParamID: dest.paramId,
      destModuleParamName: dest.param,
    });
    body[`ModSlot${slot}`] = module;
  });
}

function rawValue(value: unknown, where: string, errors: string[]): CborValue {
  try {
    return fromJson(value as JsonValue, where);
  } catch (e) {
    errors.push((e as Error).message);
    return null;
  }
}

function readModulation(body: CborMap, ctx: DestinationContext): SpecObject[] {
  const entries: [number, SpecObject][] = [];
  for (let n = 0; n < 64; n++) {
    const slot = body[`ModSlot${n}`];
    if (!isPlainMap(slot)) continue;
    const { source, destModuleTypeString: module, destModuleID: id, destModuleParamID: paramId, destModuleParamName: param } = slot;
    if (!Array.isArray(source) || source.length !== 2 || !source.every((s) => Number.isInteger(s) && (s as number) >= 0)) continue;
    if (typeof module !== "string" || typeof param !== "string" || !Number.isInteger(id) || !Number.isInteger(paramId)) continue;
    if (!Object.keys(slot).every((k) => ["source", "destModuleTypeString", "destModuleID", "destModuleParamID", "destModuleParamName", "plainParams", "flex"].includes(k))) continue;
    if (slot.plainParams !== "default" && !isPlainMap(slot.plainParams)) continue;
    const dest = { module, id: id as number, paramId: paramId as number, param };
    const entry: SpecObject = { source: sourceName(source[0] as number) };
    if (source[1] !== 0) entry.aux = sourceName(source[1] as number);
    entry.to = destinationName(dest, ctx) ?? dest;
    readModule(slot, undefined, MOD_FIELDS, MODULE_PARAMS.ModSlot, entry);
    if (slot.flex !== undefined) entry.curve = toJson(slot.flex);
    entries.push([n, entry]);
  }
  const inOrder = entries.every(([n], i) => n === i);
  return entries.map(([n, entry]) => (inOrder ? entry : { slot: n + 1, ...entry }));
}

// ---- The whole body ----

/** What a destination's name means in a body as it is (its oscillators' types, its racks' effects): for editing a sound that's playing. */
export function bodyContext(body: CborMap): DestinationContext {
  return {
    oscillatorType: (i) => {
      const type = storedParams(body[`Oscillator${i}`])?.kParamType;
      return (Object.keys(OSCILLATOR_TYPES) as OscillatorType[]).find((t) => OSCILLATOR_TYPES[t].value === type) ?? "wavetable";
    },
    effectAt: (rack, position) => {
      const list = isPlainMap(body[`FXRack${rack}`]) ? (body[`FXRack${rack}`] as CborMap).FX : undefined;
      const entry = Array.isArray(list) ? list[position] : undefined;
      return isPlainMap(entry) ? FX_TYPES.find((t) => Object.hasOwn(entry, t.module))?.module : undefined;
    },
  };
}

/**
 * A spec's envelopes and LFOs written onto a body as it is (a sound that's playing, edited by the Serum player:
 * `sound.ts`), everything else left alone. Problems go in `errors`.
 */
export function writeEnvelopesAndLfos(body: CborMap, parts: Pick<SerumPresetSpec, "envelopes" | "lfos">, errors: string[]): void {
  for (const [i, e] of numbered(parts.envelopes, 4, "envelopes", errors)) writeModule(mod(body, `Env${i}`), e, ENVELOPE_FIELDS, MODULE_PARAMS.Env, `envelopes.${i + 1}`, errors);
  for (const [i, l] of numbered(parts.lfos, 10, "lfos", errors)) writeLfo(mod(body, `LFO${i}`), l, `lfos.${i + 1}`, errors);
}

function contextOf(spec: SerumPresetSpec): DestinationContext {
  return {
    oscillatorType: (i) => {
      const type = (spec.oscillators as Record<string, { type?: string } | undefined> | undefined)?.[OSCILLATOR_KEYS[i]]?.type;
      return type && Object.hasOwn(OSCILLATOR_TYPES, type) ? (type as OscillatorType) : "wavetable";
    },
    effectAt: (rack, position) => {
      const effect = (spec.fx?.[FX_RACKS[rack]]?.[position] as { effect?: string } | undefined)?.effect;
      return FX_TYPES.find((t) => t.effect === effect)?.module;
    },
  };
}

function writeOscillator(body: CborMap, i: number, spec: SpecObject, where: string, errors: string[], options: BodyOptions) {
  const osc = mod(body, `Oscillator${i}`);
  const typeName = (spec.type ?? "wavetable") as string;
  if (!Object.hasOwn(OSCILLATOR_TYPES, typeName)) {
    errors.push(`${where}.type is ${JSON.stringify(spec.type)}; it must be one of: ${Object.keys(OSCILLATOR_TYPES).join(", ")}.`);
    return;
  }
  const type = OSCILLATOR_TYPES[typeName as OscillatorType];
  const sub = mod(osc, `${type.module}${i}`);
  const typeFields = TYPE_FIELDS[type.module];
  checkKeys(spec, [...OSCILLATOR_FIELDS, ...typeFields], ["type", "wavetable", "wavetableName", "sample", "multisample", "params", "typeParams"], where, errors);
  if (spec.type !== undefined && type.value) {
    paramsOf(osc).kParamType = type.value;
    // As Serum saves an oscillator that isn't a wavetable: its wavetable module keeps no table.
    const wt = mod(osc, `WTOsc${i}`);
    for (const key of Object.keys(wt)) if (key !== "plainParams") delete wt[key];
  }
  writeFields(spec, OSCILLATOR_FIELDS, () => paramsOf(osc), where, errors);
  writeFields(spec, typeFields, () => paramsOf(sub), where, errors);
  const fileKey = { WTOsc: "wavetable", SampleOsc: "sample", GranularOsc: "sample", SpectralOsc: "sample", MultiSampleOsc: "multisample" }[type.module];
  for (const key of ["wavetable", "sample", "multisample"])
    if (spec[key] !== undefined && key !== fileKey) errors.push(`${where}.${key} isn't for a ${typeName} oscillator${fileKey ? `: it takes ${fileKey}` : ""}.`);
  if (fileKey === "wavetable") setFile(sub, "relativePathToWT", spec.wavetable, "Tables", `${where}.wavetable`, errors, options);
  if (spec.wavetableName !== undefined) {
    if (fileKey !== "wavetable" || typeof spec.wavetableName !== "string") errors.push(`${where}.wavetableName is a wavetable oscillator's table name (text).`);
    else sub.tableDisplayName = spec.wavetableName;
  }
  if (fileKey === "sample") setFile(sub, "samplePathRelative", spec.sample, "Samples", `${where}.sample`, errors, options);
  if (fileKey === "multisample") setFile(sub, "sfzPathRelative", spec.multisample, null, `${where}.multisample`, errors, options);
  writeRawParams(spec.params, MODULE_PARAMS.Oscillator, () => paramsOf(osc), `${where}.params`, errors);
  writeRawParams(spec.typeParams, MODULE_PARAMS[type.module], () => paramsOf(sub), `${where}.typeParams`, errors);
}

function readOscillator(body: CborMap, i: number): SpecObject {
  const osc = body[`Oscillator${i}`];
  const template = PRESET_TEMPLATE[`Oscillator${i}`] as CborMap;
  const out: SpecObject = {};
  if (!isPlainMap(osc)) return out;
  const stored = storedParams(osc);
  const base = storedParams(template);
  let typeName: OscillatorType | undefined = "wavetable";
  const used = readFields(stored, base, OSCILLATOR_FIELDS, out);
  if (stored?.kParamType !== undefined) {
    typeName = (Object.keys(OSCILLATOR_TYPES) as OscillatorType[]).find((t) => OSCILLATOR_TYPES[t].value === stored.kParamType);
    if (typeName) {
      out.type = typeName;
      used.add("kParamType");
    }
  }
  const params = leftoverParams(stored, base, used, MODULE_PARAMS.Oscillator);
  if (typeName) {
    const subName = OSCILLATOR_TYPES[typeName].module;
    const sub = osc[`${subName}${i}`];
    const subTemplate = template[`${subName}${i}`] as CborMap;
    const subStored = storedParams(sub);
    const subBase = storedParams(subTemplate);
    const subUsed = readFields(subStored, subBase, TYPE_FIELDS[subName], out);
    const typeParams = leftoverParams(subStored, subBase, subUsed, MODULE_PARAMS[subName]);
    if (isPlainMap(sub)) {
      const file = subName === "WTOsc" ? ["wavetable", "relativePathToWT"] : subName === "MultiSampleOsc" ? ["multisample", "sfzPathRelative"] : ["sample", "samplePathRelative"];
      const path = sub[file[1]];
      if (typeof path === "string" && path && path !== subTemplate[file[1]]) out[file[0]] = path;
      if (subName === "WTOsc" && typeof sub.tableDisplayName === "string") out.wavetableName = sub.tableDisplayName;
    }
    if (typeParams) out.typeParams = typeParams;
  }
  if (params) out.params = params;
  return out;
}

function writeNoise(body: CborMap, spec: SpecObject, errors: string[]) {
  const osc = mod(body, "Oscillator3");
  const sub = mod(osc, "NoiseOsc3");
  checkKeys(spec, [...NOISE_FIELDS, ...NOISE_TYPE_FIELDS], ["sample", "params", "typeParams"], "oscillators.noise", errors);
  writeFields(spec, NOISE_FIELDS, () => paramsOf(osc), "oscillators.noise", errors);
  writeFields(spec, NOISE_TYPE_FIELDS, () => paramsOf(sub), "oscillators.noise", errors);
  setFile(sub, "relativePathToNoiseSample", spec.sample, null, "oscillators.noise.sample", errors, {}, ["detuneFactor"]);
  writeRawParams(spec.params, MODULE_PARAMS.Oscillator, () => paramsOf(osc), "oscillators.noise.params", errors);
  writeRawParams(spec.typeParams, MODULE_PARAMS.NoiseOsc, () => paramsOf(sub), "oscillators.noise.typeParams", errors);
}

function readNoise(body: CborMap): SpecObject {
  const template = PRESET_TEMPLATE.Oscillator3 as CborMap;
  const out = readModule(body.Oscillator3, template, NOISE_FIELDS, MODULE_PARAMS.Oscillator);
  const sub = isPlainMap(body.Oscillator3) ? body.Oscillator3.NoiseOsc3 : undefined;
  const typed = readModule(sub, template.NoiseOsc3, NOISE_TYPE_FIELDS, MODULE_PARAMS.NoiseOsc);
  if (typed.params) {
    out.typeParams = typed.params;
    delete typed.params;
  }
  Object.assign(out, typed);
  const path = isPlainMap(sub) ? sub.relativePathToNoiseSample : undefined;
  if (typeof path === "string" && path && path !== (template.NoiseOsc3 as CborMap).relativePathToNoiseSample) out.sample = path;
  return out;
}

function writeSub(body: CborMap, spec: SpecObject, errors: string[]) {
  const osc = mod(body, "Oscillator4");
  const sub = mod(osc, "SubOsc4");
  checkKeys(spec, [...SUB_FIELDS, ...SUB_TYPE_FIELDS], ["params", "typeParams"], "oscillators.sub", errors);
  writeFields(spec, SUB_FIELDS, () => paramsOf(osc), "oscillators.sub", errors);
  writeFields(spec, SUB_TYPE_FIELDS, () => paramsOf(sub), "oscillators.sub", errors);
  writeRawParams(spec.params, MODULE_PARAMS.Oscillator, () => paramsOf(osc), "oscillators.sub.params", errors);
  writeRawParams(spec.typeParams, MODULE_PARAMS.SubOsc, () => paramsOf(sub), "oscillators.sub.typeParams", errors);
}

function readSub(body: CborMap): SpecObject {
  const template = PRESET_TEMPLATE.Oscillator4 as CborMap;
  const out = readModule(body.Oscillator4, template, SUB_FIELDS, MODULE_PARAMS.Oscillator);
  const sub = isPlainMap(body.Oscillator4) ? body.Oscillator4.SubOsc4 : undefined;
  const typed = readModule(sub, template.SubOsc4, SUB_TYPE_FIELDS, MODULE_PARAMS.SubOsc);
  if (typed.params) {
    out.typeParams = typed.params;
    delete typed.params;
  }
  return Object.assign(out, typed);
}

/** The spec's named fields written onto `body` (a copy of the template); problems go in `errors`. */
function applyNamed(body: CborMap, spec: SerumPresetSpec, errors: string[], options: BodyOptions, reading = false) {
  if (!isObject(spec)) {
    errors.push("The spec must be a JSON object.");
    return;
  }
  for (const key of Object.keys(spec)) if (!TOP_KEYS.includes(key)) errors.push(`${key} isn't a field of a preset spec; the fields are: ${TOP_KEYS.join(", ")}.`);
  // A preset read from a file may have no name (Serum's init patch hasn't); one being written needs one.
  if (typeof spec.name !== "string" || (!reading && !spec.name.trim())) errors.push("name is required: the preset's name.");
  else body.presetName = spec.name;
  const text = (key: "author" | "description", to: string) => {
    if (spec[key] === undefined) return;
    if (typeof spec[key] !== "string") errors.push(`${key} must be text.`);
    else body[to] = spec[key];
  };
  text("author", "presetAuthor");
  text("description", "presetDescription");
  if (spec.tags !== undefined) {
    if (!Array.isArray(spec.tags) || !spec.tags.every((t) => typeof t === "string")) errors.push('tags must be a list of words ("Lead", "Poly"...).');
    else body.tags = [...spec.tags];
  }
  if (spec.serum !== undefined) {
    if (!isObject(spec.serum) || typeof spec.serum.version !== "number" || typeof spec.serum.product !== "string")
      errors.push('serum must be { "version": 11, "product": "2.1.5" } (the Serum that wrote the settings).');
    else {
      body.version = spec.serum.version;
      body.productVersion = spec.serum.product;
    }
  }
  if (spec.global !== undefined) {
    if (!isObject(spec.global)) errors.push("global must be an object.");
    else writeModule(mod(body, "Global0"), spec.global, GLOBAL_FIELDS, MODULE_PARAMS.Global, "global", errors);
  }
  const oscillators = spec.oscillators as unknown;
  if (oscillators !== undefined) {
    if (!isObject(oscillators)) errors.push("oscillators must be an object with A, B, C, noise and sub.");
    else
      for (const [key, value] of Object.entries(oscillators)) {
        const where = `oscillators.${key}`;
        if (!isObject(value)) {
          errors.push(`${where} must be an object.`);
          continue;
        }
        const i = (OSCILLATOR_KEYS as readonly string[]).indexOf(key);
        if (i >= 0) writeOscillator(body, i, value, where, errors, options);
        else if (key === "noise") writeNoise(body, value, errors);
        else if (key === "sub") writeSub(body, value, errors);
        else errors.push(`${where}: the oscillators are A, B, C, noise and sub.`);
      }
  }
  for (const [i, f] of numbered(spec.filters, 2, "filters", errors)) writeModule(mod(body, `VoiceFilter${i}`), f, FILTER_FIELDS, MODULE_PARAMS.VoiceFilter, `filters.${i + 1}`, errors);
  const routing = spec.routing as unknown;
  if (routing !== undefined) {
    if (!isObject(routing)) errors.push(`routing must be an object with ${ROUTING_KEYS.join(", ")}.`);
    else
      for (const [key, value] of Object.entries(routing)) {
        const i = (ROUTING_KEYS as readonly string[]).indexOf(key);
        if (i < 0 || !isObject(value)) errors.push(`routing.${key}: routing is by ${ROUTING_KEYS.join(", ")}, each an object.`);
        else writeModule(mod(body, `RoutingSlot${i}`), value, ROUTING_FIELDS, MODULE_PARAMS.RoutingSlot, `routing.${key}`, errors);
      }
  }
  for (const [i, e] of numbered(spec.envelopes, 4, "envelopes", errors)) writeModule(mod(body, `Env${i}`), e, ENVELOPE_FIELDS, MODULE_PARAMS.Env, `envelopes.${i + 1}`, errors);
  for (const [i, l] of numbered(spec.lfos, 10, "lfos", errors)) writeLfo(mod(body, `LFO${i}`), l, `lfos.${i + 1}`, errors);
  for (const [i, m] of numbered(spec.macros, 8, "macros", errors)) {
    const macro = mod(body, `Macro${i}`);
    writeModule(macro, m, MACRO_FIELDS, MODULE_PARAMS.Macro, `macros.${i + 1}`, errors, ["name"]);
    if (m.name !== undefined) {
      if (typeof m.name !== "string") errors.push(`macros.${i + 1}.name must be text.`);
      else macro.name = m.name;
    }
  }
  const fx = spec.fx as unknown;
  if (fx !== undefined) {
    if (!isObject(fx)) errors.push(`fx must be an object with ${FX_RACKS.join(", ")}, each a list of effects.`);
    else
      for (const [key, list] of Object.entries(fx)) {
        const r = (FX_RACKS as readonly string[]).indexOf(key);
        if (r < 0 || !Array.isArray(list)) {
          errors.push(`fx.${key}: the racks are ${FX_RACKS.join(", ")}, each a list of effects.`);
          continue;
        }
        const entries = list.map((e, j) => writeEffect(e, `fx.${key}[${j}]`, errors));
        mod(body, `FXRack${r}`).FX = entries.filter((e): e is CborMap => e !== undefined);
      }
  }
  writeModulation(body, spec.modulation, contextOf(spec), errors);
}

/** Empty parameter lists as Serum writes them in a preset. */
export function finalize(value: CborValue): void {
  if (Array.isArray(value)) value.forEach(finalize);
  else if (isPlainMap(value))
    for (const [key, v] of Object.entries(value)) {
      if (key === "plainParams" && isPlainMap(v) && !Object.keys(v).length) value[key] = "default";
      else finalize(v);
    }
}

/** A spec as Serum's settings (a preset's body). Throws `SpecError` with every problem found. */
export function specToBody(spec: SerumPresetSpec, options: BodyOptions = {}): CborMap {
  const errors: string[] = [];
  const body = clone(PRESET_TEMPLATE);
  applyNamed(body, spec, errors, options);
  const raw = (spec as { raw?: unknown }).raw;
  if (raw !== undefined) {
    if (!isObject(raw)) errors.push("raw must be an object: a merge patch on the settings, by module.");
    else
      for (const [key, value] of Object.entries(raw)) {
        const patch = rawValue(value, `raw.${key}`, errors);
        if (patch === null) delete body[key];
        else body[key] = applyPatch(body[key], patch);
      }
  }
  if (errors.length) throw new SpecError(errors);
  finalize(body);
  return body;
}

/** Serum's settings (a preset's body) as a spec: named fields where they say it exactly, the rest in `raw`. */
export function bodyToSpec(body: CborMap, options: BodyOptions = {}): SerumPresetSpec {
  const t = PRESET_TEMPLATE;
  const spec: SerumPresetSpec = { name: typeof body.presetName === "string" ? body.presetName : "" };
  if (typeof body.presetAuthor === "string" && body.presetAuthor) spec.author = body.presetAuthor;
  if (typeof body.presetDescription === "string" && body.presetDescription) spec.description = body.presetDescription;
  if (Array.isArray(body.tags) && body.tags.every((x) => typeof x === "string")) spec.tags = body.tags as string[];
  if (typeof body.version === "number" && typeof body.productVersion === "string") spec.serum = { version: body.version, product: body.productVersion };
  const some = (o: SpecObject) => (Object.keys(o).length ? o : undefined);
  const global = some(readModule(body.Global0, t.Global0, GLOBAL_FIELDS, MODULE_PARAMS.Global));
  if (global) spec.global = global;
  const oscillators: SpecObject = {};
  OSCILLATOR_KEYS.forEach((key, i) => {
    const o = some(readOscillator(body, i));
    if (o) oscillators[key] = o;
  });
  const noise = some(readNoise(body));
  if (noise) oscillators.noise = noise;
  const sub = some(readSub(body));
  if (sub) oscillators.sub = sub;
  if (some(oscillators)) spec.oscillators = oscillators;
  const section = (count: number, key: string, fields: Field[], known: readonly string[], extra?: (m: CborMap, o: SpecObject) => void) => {
    const out: SpecObject = {};
    for (let i = 0; i < count; i++) {
      const m = body[`${key}${i}`];
      const o = readModule(m, t[`${key}${i}`], fields, known);
      if (extra && isPlainMap(m)) extra(m, o);
      if (some(o)) out[String(i + 1)] = o;
    }
    return some(out);
  };
  const filters = section(2, "VoiceFilter", FILTER_FIELDS, MODULE_PARAMS.VoiceFilter);
  if (filters) spec.filters = filters;
  const routing: SpecObject = {};
  ROUTING_KEYS.forEach((key, i) => {
    const o = some(readModule(body[`RoutingSlot${i}`], t[`RoutingSlot${i}`], ROUTING_FIELDS, MODULE_PARAMS.RoutingSlot));
    if (o) routing[key] = o;
  });
  if (some(routing)) spec.routing = routing;
  const envelopes = section(4, "Env", ENVELOPE_FIELDS, MODULE_PARAMS.Env);
  if (envelopes) spec.envelopes = envelopes;
  const lfos: SpecObject = {};
  for (let i = 0; i < 10; i++) {
    const o = some(readLfo(body[`LFO${i}`], t[`LFO${i}`]));
    if (o) lfos[String(i + 1)] = o;
  }
  if (some(lfos)) spec.lfos = lfos as SerumPresetSpec["lfos"];
  const macros = section(8, "Macro", MACRO_FIELDS, MODULE_PARAMS.Macro, (m, o) => {
    if (typeof m.name === "string") o.name = m.name;
  });
  if (macros) spec.macros = macros as SerumPresetSpec["macros"];
  const fx: SpecObject = {};
  FX_RACKS.forEach((rack, r) => {
    const list = isPlainMap(body[`FXRack${r}`]) ? (body[`FXRack${r}`] as CborMap).FX : undefined;
    if (!Array.isArray(list) || !list.length) return;
    const entries = list.map(readEffect);
    if (entries.every((e) => e !== undefined)) fx[rack] = entries;
  });
  if (some(fx)) spec.fx = fx as SerumPresetSpec["fx"];
  const modulation = readModulation(body, contextOf(spec));
  if (modulation.length) spec.modulation = modulation as unknown as SerumPresetSpec["modulation"];
  // What the named fields don't say: the difference between what they write and the body.
  const errors: string[] = [];
  const synth = clone(t);
  applyNamed(synth, spec, errors, options, true);
  if (errors.length) throw new Error(`Reading the preset made a spec its own writer refuses (a bug):\n- ${errors.join("\n- ")}`);
  finalize(synth);
  const patch = diff(synth, body);
  if (isPlainMap(patch)) spec.raw = Object.fromEntries(Object.entries(patch).map(([k, v]) => [k, toJson(v)]));
  return spec;
}

