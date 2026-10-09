/**
 * Serum 2's state as the engine keeps it (a plugin channel's `plugins/<channel>.bin`), as either of its plugins
 * gives it: the VST3's in JUCE's wrapper, "VC2!" + u32 LE length + XML + NUL, the XML holding the plugin's component
 * (processor) and controller states as JUCE MemoryBlocks (its own base64); the Audio Unit's as its ClassInfo, a
 * binary property list with them as "Processor State" and "Controller State" (`plist.ts`). Each of those is an Xfer
 * container (`container.ts`).
 *
 * A preset is loaded by putting its settings in the processor's place (`presetAsState`): that's how the
 * verification loads presets into Serum without its window. Its names (the preset's, its macros', its racks') go in
 * the controller's, which also holds the effect knobs linked to the host's slots (`docs/serum/player.md` §2.1).
 */
import { type CborMap, decodeCbor, encodeCbor, isPlainMap } from "./cbor.ts";
import { readXfer, writeXfer } from "./container.ts";
import { isBinaryPlist, type PlistDict, readPlist, writePlist } from "./plist.ts";

const MAGIC = "VC2!";
const ALPHABET = ".ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+";

/** JUCE's `MemoryBlock::fromBase64Encoding`: "<size>." then 6 bits a character, least significant first. */
export function memoryBlockDecode(text: string): Uint8Array {
  const dot = text.indexOf(".");
  const size = Number(text.slice(0, dot));
  if (dot < 0 || !Number.isInteger(size)) throw new Error("Not a JUCE MemoryBlock.");
  const out = new Uint8Array(size);
  let bit = 0;
  for (let i = dot + 1; i < text.length; i++) {
    const v = ALPHABET.indexOf(text[i]);
    if (v < 0) throw new Error(`"${text[i]}" isn't in JUCE's base64.`);
    for (let b = 0; b < 6; b++, bit++) if ((v >> b) & 1 && bit >> 3 < size) out[bit >> 3] |= 1 << (bit & 7);
  }
  return out;
}

export function memoryBlockEncode(bytes: Uint8Array): string {
  const bits = bytes.length * 8;
  let text = `${bytes.length}.`;
  for (let i = 0; i < bits; i += 6) {
    let v = 0;
    for (let b = 0; b < 6; b++) {
      const at = i + b;
      if (at < bits && (bytes[at >> 3] >> (at & 7)) & 1) v |= 1 << b;
    }
    text += ALPHABET[v];
  }
  return text;
}

export type PluginState =
  /** The VST3's: JUCE's XML. */
  | { format: "vst3"; xml: string; component: Uint8Array; controller: Uint8Array | null }
  /** The Audio Unit's: its ClassInfo property list (the rest of it kept as it is). */
  | { format: "au"; plist: PlistDict; component: Uint8Array; controller: Uint8Array | null };

const AU_COMPONENT = "Processor State";
const AU_CONTROLLER = "Controller State";

/** Whether `bytes` is a plugin's state this reads: a VST3's (JUCE's wrapper) or an Audio Unit's (a binary property list). */
export function isPluginState(bytes: Uint8Array): boolean {
  return Buffer.from(bytes.subarray(0, 4)).toString("latin1") === MAGIC || isBinaryPlist(bytes);
}

export function readPluginState(bytes: Uint8Array): PluginState {
  if (isBinaryPlist(bytes)) {
    const plist = readPlist(bytes);
    const component = plist instanceof Map ? plist.get(AU_COMPONENT) : undefined;
    if (!(plist instanceof Map) || !(component instanceof Uint8Array)) throw new Error(`The Audio Unit's state has no "${AU_COMPONENT}": it isn't Serum 2's.`);
    const controller = plist.get(AU_CONTROLLER);
    return { format: "au", plist, component, controller: controller instanceof Uint8Array ? controller : null };
  }
  const buf = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (Buffer.from(bytes.subarray(0, 4)).toString("latin1") !== MAGIC) throw new Error('Not a plugin state: it doesn\'t start with "VC2!" (a VST3\'s) or "bplist00" (an Audio Unit\'s).');
  const length = buf.readUInt32LE(4);
  const xml = buf.subarray(8, 8 + length).toString("utf8");
  const component = /<IComponent>([^<]*)<\/IComponent>/.exec(xml);
  if (!component) throw new Error("The plugin state has no component.");
  const controller = /<IEditController>([^<]*)<\/IEditController>/.exec(xml);
  return { format: "vst3", xml, component: memoryBlockDecode(component[1]), controller: controller ? memoryBlockDecode(controller[1]) : null };
}

/** `template`'s state with its component replaced, and its controller if one is given, in the template's own format. */
export function writePluginState(template: PluginState, component: Uint8Array, controller?: Uint8Array): Uint8Array {
  if (template.format === "au") {
    const plist: PlistDict = new Map(template.plist);
    plist.set(AU_COMPONENT, component);
    if (controller) plist.set(AU_CONTROLLER, controller);
    return writePlist(plist);
  }
  let xml = template.xml.replace(/<IComponent>[^<]*<\/IComponent>/, `<IComponent>${memoryBlockEncode(component)}</IComponent>`);
  if (controller) xml = xml.replace(/<IEditController>[^<]*<\/IEditController>/, `<IEditController>${memoryBlockEncode(controller)}</IEditController>`);
  const data = Buffer.from(xml, "utf8");
  const length = Buffer.alloc(4);
  length.writeUInt32LE(data.length);
  return new Uint8Array(Buffer.concat([Buffer.from(MAGIC, "latin1"), length, data, Buffer.from([0])]));
}

/**
 * The processor's own top-level fields, which a preset doesn't have: without them Serum silently ignores
 * the state it's given.
 */
export const PROCESSOR_ONLY_KEYS = ["component", "modMatrixLocked", "scalarCurvesLocked"] as const;

/**
 * An effect knob linked to one of a rack's 16 host slots, which then sets it live (`docs/serum/player.md` §2.1):
 * the effect by its place in the rack (`fxID`), the knob by its place in that effect's parameters (`paramIndex`).
 */
export interface FxLink {
  fxID: number;
  paramIndex: number;
}
/** Each rack's links by slot (`[slot 0, slot 1…]`, null: none), the racks by number: 0 main, 1 and 2 the buses. */
export type FxLinks = Partial<Record<0 | 1 | 2, (FxLink | null)[]>>;

/** How many slots a rack has for its effects' knobs. */
export const FX_SLOTS = 16;

/**
 * A preset's settings (CBOR) as Serum 2's state, from a state of Serum's (`template`, e.g. its init state):
 * the template's processor metadata and processor-only fields around the preset's settings, and the template's
 * controller with the preset's names in it (preset, author, description, macros, racks) and `links` (none given:
 * none at all).
 */
export function presetAsState(template: Uint8Array, presetSettings: Uint8Array, links: FxLinks = {}): Uint8Array {
  const state = readPluginState(template);
  const processor = readXfer(state.component);
  const base = decodeCbor(processor.settings);
  const settings = decodeCbor(presetSettings);
  if (!isPlainMap(base) || !isPlainMap(settings)) throw new Error("Serum's settings must be a map.");
  for (const key of PROCESSOR_ONLY_KEYS) if (key in base) settings[key] = base[key];
  const meta = { ...processor.meta };
  delete meta.hash;
  const component = writeXfer(meta, encodeCbor(settings));
  return writePluginState(state, component, state.controller ? presetController(state.controller, settings, links) : undefined);
}

/** The controller's state (`template`'s) with a preset's names and the effect knobs' links. */
function presetController(template: Uint8Array, settings: CborMap, links: FxLinks): Uint8Array {
  const container = readXfer(template);
  const controller = decodeCbor(container.settings);
  if (!isPlainMap(controller)) throw new Error("Serum's controller settings must be a map.");
  const meta = { ...container.meta };
  delete meta.hash;
  for (const key of ["presetName", "presetAuthor", "presetDescription"] as const) {
    const value = settings[key];
    if (typeof value !== "string") continue;
    controller[key] = value;
    meta[key] = value;
  }
  for (let i = 0; i < 8; i++) {
    const macro = settings[`Macro${i}`];
    const own = controller[`Macro${i}`];
    const name = isPlainMap(macro) && typeof macro.name === "string" ? macro.name : "";
    controller[`Macro${i}`] = { ...(isPlainMap(own) ? own : {}), name };
  }
  for (const rack of [0, 1, 2] as const) {
    const from = settings[`FXRack${rack}`];
    const own = isPlainMap(controller[`FXRack${rack}`]) ? { ...(controller[`FXRack${rack}`] as CborMap) } : {};
    own.displayName = isPlainMap(from) && typeof from.displayName === "string" ? from.displayName : "";
    const slots = (links[rack] ?? []).slice(0, FX_SLOTS);
    const proxy: CborMap = {};
    slots.forEach((link, slot) => {
      if (link) proxy[String(slot)] = { fxID: link.fxID, paramIndex: link.paramIndex };
    });
    if (Object.keys(proxy).length) own.proxyParams = proxy;
    else delete own.proxyParams;
    controller[`FXRack${rack}`] = own;
  }
  return writeXfer(meta, encodeCbor(controller));
}

/** The effect knobs a state's controller has linked to the host's slots (`presetAsState` writes them; a reload must keep them). */
export function fxLinksOf(state: Uint8Array): FxLinks {
  const { controller } = readPluginState(state);
  if (!controller) return {};
  const settings = decodeCbor(readXfer(controller).settings);
  if (!isPlainMap(settings)) return {};
  const links: FxLinks = {};
  for (const rack of [0, 1, 2] as const) {
    const proxy = isPlainMap(settings[`FXRack${rack}`]) ? (settings[`FXRack${rack}`] as CborMap).proxyParams : undefined;
    if (!isPlainMap(proxy)) continue;
    const slots: (FxLink | null)[] = Array.from({ length: FX_SLOTS }, () => null);
    for (const [slot, link] of Object.entries(proxy)) {
      const n = Number(slot);
      if (!Number.isInteger(n) || n < 0 || n >= FX_SLOTS || !isPlainMap(link)) continue;
      if (typeof link.fxID === "number" && typeof link.paramIndex === "number") slots[n] = { fxID: link.fxID, paramIndex: link.paramIndex };
    }
    if (slots.some(Boolean)) links[rack] = slots;
  }
  return links;
}

/** The processor's settings (CBOR) in a Serum 2 state. */
export function stateSettings(state: Uint8Array): Uint8Array {
  return readXfer(readPluginState(state).component).settings;
}
