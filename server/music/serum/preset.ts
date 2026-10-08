/**
 * Serum 2 preset files and the spec: `.SerumPreset` files (and Serum 2's own plugin state, which holds the same
 * settings) read into a spec, and a spec written as a `.SerumPreset` laid out as Serum lays out its own: the
 * same container, the same metadata keys, the same CBOR conventions (docs/serum/preset-format.md).
 */
import { type CborMap, decodeCbor, encodeCbor, isPlainMap } from "./cbor.ts";
import { isXferContainer, readXfer, writeXfer, type XferMetadata } from "./container.ts";
import { type BodyOptions, bodyToSpec, finalize, specToBody } from "./body.ts";
import { clone } from "./patch.ts";
import { isPluginState, PROCESSOR_ONLY_KEYS, readPluginState } from "./plugin-state.ts";
import type { SerumPresetSpec } from "./spec.ts";
import { PRESET_TEMPLATE } from "./template.ts";

/** The metadata a preset's header repeats from its settings, in Serum's order (sorted, as it writes JSON). */
const HEADER_KEYS = ["fileType", "presetAuthor", "presetDescription", "presetName", "product", "productVersion", "tags", "url", "vendor", "version"] as const;

/** Keys a preset has and a plugin state doesn't: the editor's view settings and the preset's own metadata. */
const PRESET_ONLY_KEYS = Object.keys(PRESET_TEMPLATE).filter((k) => !/\d$/.test(k) && !["lockOversampling", "lockTuning", "mpeConfig", "mpeEnabled", "mpePitchBendRange", "product", "productVersion", "scalars", "tags", "url", "vendor", "version"].includes(k));

export type SerumFileKind = "preset" | "state";

/** The settings in a `.SerumPreset` file or a Serum 2 plugin state, as a preset's body. */
export function readSerumSettings(bytes: Uint8Array): { kind: SerumFileKind; body: CborMap } {
  if (isXferContainer(bytes)) {
    const container = readXfer(bytes);
    const body = decodeCbor(container.settings);
    if (!isPlainMap(body)) throw new Error("The preset's settings aren't a map.");
    if (container.meta.fileType !== "SerumPreset") throw new Error(`Not a Serum preset (its fileType is ${JSON.stringify(container.meta.fileType)}).`);
    return { kind: "preset", body };
  }
  if (isPluginState(bytes)) {
    const state = readPluginState(bytes);
    const container = readXfer(state.component);
    const body = decodeCbor(container.settings);
    if (!isPlainMap(body)) throw new Error("The state's settings aren't a map.");
    const controller = state.controller ? readXfer(state.controller).meta : {};
    return { kind: "state", body: stateAsPreset(body, controller) };
  }
  throw new Error("Not a .SerumPreset file or a Serum 2 state.");
}

/**
 * A plugin state's settings as a preset's: without the processor's own fields, empty parameter lists as presets
 * write them ("default"), and the preset's keys a state doesn't have (the editor's view settings, its name...).
 */
export function stateAsPreset(settings: CborMap, controller: XferMetadata = {}): CborMap {
  const body = clone(settings);
  for (const key of PROCESSOR_ONLY_KEYS) delete body[key];
  finalize(body);
  for (const key of PRESET_ONLY_KEYS) if (!Object.hasOwn(body, key)) body[key] = clone(PRESET_TEMPLATE[key]);
  for (const [to, from] of [
    ["presetName", "presetName"],
    ["presetAuthor", "presetAuthor"],
    ["presetDescription", "presetDescription"],
  ] as const)
    if (typeof controller[from] === "string") body[to] = (controller[from] as string).trim();
  for (let r = 0; r < 3; r++) {
    const rack = body[`FXRack${r}`];
    if (isPlainMap(rack) && !Object.hasOwn(rack, "displayName")) rack.displayName = "";
  }
  return body;
}

/** A preset's body as a `.SerumPreset` file. */
export function presetFile(body: CborMap): Uint8Array {
  const meta: XferMetadata = {};
  for (const key of HEADER_KEYS) {
    const value = body[key];
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") meta[key] = value;
    else if (Array.isArray(value) && value.every((v) => typeof v === "string")) meta[key] = value as string[];
    else throw new Error(`The preset has no ${key} for its header.`);
  }
  return writeXfer(meta, encodeCbor(body));
}

/** A `.SerumPreset` file or a Serum 2 state as a spec. */
export function readSerumFile(bytes: Uint8Array, options: BodyOptions = {}): SerumPresetSpec {
  return bodyToSpec(readSerumSettings(bytes).body, options);
}

/** A spec as a `.SerumPreset` file. Throws `SpecError` listing every problem. */
export function writeSerumPreset(spec: SerumPresetSpec, options: BodyOptions = {}): Uint8Array {
  return presetFile(specToBody(spec, options));
}

export { SpecError, specToBody, bodyToSpec, type BodyOptions, type FileFacts } from "./body.ts";
export type { SerumPresetSpec } from "./spec.ts";
