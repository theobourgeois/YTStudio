/**
 * Serum 2's state as the engine keeps it (a plugin channel's `plugins/<channel>.bin`): JUCE's VST3 wrapper,
 * "VC2!" + u32 LE length + XML + NUL, the XML holding the plugin's component (processor) and controller
 * states as JUCE MemoryBlocks (its own base64). Each of those is an Xfer container (`container.ts`).
 *
 * A preset is loaded by putting its settings in the processor's place (`presetAsState`): that's how the
 * verification loads presets into Serum without its window.
 */
import { decodeCbor, encodeCbor, isPlainMap } from "./cbor.ts";
import { readXfer, writeXfer } from "./container.ts";

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

export interface PluginState {
  xml: string;
  component: Uint8Array;
  controller: Uint8Array | null;
}

export function isPluginState(bytes: Uint8Array): boolean {
  return Buffer.from(bytes.subarray(0, 4)).toString("latin1") === MAGIC;
}

export function readPluginState(bytes: Uint8Array): PluginState {
  const buf = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (!isPluginState(buf)) throw new Error('Not a VST3 plugin state: it doesn\'t start with "VC2!".');
  const length = buf.readUInt32LE(4);
  const xml = buf.subarray(8, 8 + length).toString("utf8");
  const component = /<IComponent>([^<]*)<\/IComponent>/.exec(xml);
  if (!component) throw new Error("The plugin state has no component.");
  const controller = /<IEditController>([^<]*)<\/IEditController>/.exec(xml);
  return { xml, component: memoryBlockDecode(component[1]), controller: controller ? memoryBlockDecode(controller[1]) : null };
}

/** `template`'s state with its component replaced. */
export function writePluginState(template: PluginState, component: Uint8Array): Uint8Array {
  const xml = template.xml.replace(/<IComponent>[^<]*<\/IComponent>/, `<IComponent>${memoryBlockEncode(component)}</IComponent>`);
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
 * A preset's settings (CBOR) as Serum 2's state, from a state of Serum's (`template`, e.g. its init state):
 * the template's processor metadata and processor-only fields around the preset's settings, the template's
 * controller (name, author...).
 */
export function presetAsState(template: Uint8Array, presetSettings: Uint8Array): Uint8Array {
  const state = readPluginState(template);
  const processor = readXfer(state.component);
  const base = decodeCbor(processor.settings);
  const settings = decodeCbor(presetSettings);
  if (!isPlainMap(base) || !isPlainMap(settings)) throw new Error("Serum's settings must be a map.");
  for (const key of PROCESSOR_ONLY_KEYS) if (key in base) settings[key] = base[key];
  const meta = { ...processor.meta };
  delete meta.hash;
  return writePluginState(state, writeXfer(meta, encodeCbor(settings)));
}

/** The processor's settings (CBOR) in a Serum 2 state. */
export function stateSettings(state: Uint8Array): Uint8Array {
  return readXfer(readPluginState(state).component).settings;
}
