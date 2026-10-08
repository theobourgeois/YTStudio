/**
 * Mod matrix destinations by name. A slot stores its destination as (module type, module id, parameter id,
 * parameter name), and Serum finds it by the name when the module has a parameter of that name, else by the id
 * (tried in the offline engine). The spec names a destination as Serum's control is named ("A WT Pos", "Filter 1
 * Freq", "Env 2 Decay", "Macro 3", "A>BUS1"), or, for a parameter without a control, as a module and Serum's
 * parameter name without "kParam" ("Main FX 2 Wet", "Bus 1 FX 1 Size", "LFO 1 Mode", "A PhaseMemory").
 *
 * What an oscillator's type-specific controls and an effect slot mean depends on the preset (oscillator A's
 * "A Warp" is a WTOsc's when A is a wavetable, a SampleOsc's when it's a sample), so names are resolved against
 * the preset's oscillator types and effect racks (`DestinationContext`).
 */
import { CONTROLS, FX_RACKS, MODULE_PARAMS, type ModuleType, type OscillatorType, OSCILLATOR_TYPES, isModuleType } from "./catalogue.ts";

export interface Destination {
  module: string;
  id: number;
  paramId: number;
  param: string;
}

export interface DestinationContext {
  /** Oscillator 0–2's type. */
  oscillatorType(index: number): OscillatorType;
  /** The effect module ("FXReverb") at this place of a rack (0 main, 1 and 2 the buses), if there's one. */
  effectAt(rack: number, position: number): string | undefined;
}

const CONTROL_CODES: Record<number, ModuleType> = {
  0: "Global",
  2: "VoiceFilter",
  3: "Env",
  4: "LFO",
  6: "ModSlot",
  7: "Macro",
  9: "RoutingSlot",
  10: "ClipPlayer",
  12: "Arp",
  14: "PitchQuantizer",
  15: "VoicePanel",
};

/** A control's name is a destination's unless it's one of the oscillators' unnamed slots ("A Param44"). */
const NAMED_CONTROLS = CONTROLS.filter(([, name]) => !/ Param\d+$/.test(name));
let byName: Map<string, number> | null = null;

function oscillatorModule(index: number, ctx: DestinationContext): ModuleType {
  if (index === 3) return "NoiseOsc";
  if (index === 4) return "SubOsc";
  return OSCILLATOR_TYPES[ctx.oscillatorType(index)].module;
}

function paramName(module: string, id: number): string | undefined {
  return isModuleType(module) ? (MODULE_PARAMS[module] as readonly string[])[id] : undefined;
}

function fromControl(id: number, ctx: DestinationContext): Destination | undefined {
  const code = Math.floor(id / 1_000_000);
  const index = Math.floor((id % 1_000_000) / 1_000);
  const p = id % 1_000;
  let module: ModuleType | undefined;
  let paramId = p;
  if (code === 1) {
    if (p < 33) module = "Oscillator";
    else {
      module = oscillatorModule(index, ctx);
      paramId = p - 33;
    }
  } else module = CONTROL_CODES[code];
  if (!module) return undefined;
  const param = paramName(module, paramId);
  return param ? { module, id: index, paramId, param } : undefined;
}

const OSC_LABELS = ["A", "B", "C", "Noise", "Sub"];
const RACK_LABELS = ["Main", "Bus 1", "Bus 2"];

/** Labels for modules in the fallback form, with what they resolve to. */
function labelled(label: string, ctx: DestinationContext): { modules: ModuleType[] | string[]; id: number } | undefined {
  const osc = OSC_LABELS.indexOf(label);
  if (osc >= 0) return { modules: ["Oscillator", oscillatorModule(osc, ctx)], id: osc };
  let m = /^(Filter|Env|LFO|Macro|LFO Point Bus) (\d+)$/.exec(label);
  if (m) {
    const n = Number(m[2]) - 1;
    const module = ({ Filter: "VoiceFilter", Env: "Env", LFO: "LFO", Macro: "Macro", "LFO Point Bus": "LFOPointModBus" } as const)[m[1] as "Filter"];
    return { modules: [module], id: n };
  }
  m = /^(Main|Bus 1|Bus 2) FX (\d+)$/.exec(label);
  if (m) {
    const rack = RACK_LABELS.indexOf(m[1]);
    const position = Number(m[2]) - 1;
    const module = ctx.effectAt(rack, position);
    return module ? { modules: [module], id: rack * 100 + position } : undefined;
  }
  const single: Record<string, ModuleType> = { Global: "Global", Arp: "Arp", "Clip Player": "ClipPlayer", "Pitch Quantizer": "PitchQuantizer", "Voice Panel": "VoicePanel" };
  if (single[label]) return { modules: [single[label]], id: 0 };
  return undefined;
}

/** The destination a name means in this preset, or why there's none. */
export function parseDestination(name: string, ctx: DestinationContext): Destination | string {
  byName ??= new Map(NAMED_CONTROLS.map(([id, n]) => [n, id]));
  const control = byName.get(name);
  if (control !== undefined) return fromControl(control, ctx) ?? `"${name}" is a control Serum can't modulate.`;
  // Serum's parameter names have no spaces: the module is everything before the last one.
  const cut = name.lastIndexOf(" ");
  const found = cut > 0 ? labelled(name.slice(0, cut), ctx) : undefined;
  if (found) {
    const param = `kParam${name.slice(cut + 1)}`;
    for (const module of found.modules) {
      const paramId = isModuleType(module) ? (MODULE_PARAMS[module] as readonly string[]).indexOf(param) : -1;
      if (paramId >= 0) return { module, id: found.id, paramId, param };
    }
    const known = found.modules.flatMap((m) => (isModuleType(m) ? (MODULE_PARAMS[m] as readonly string[]).map((p) => p.replace(/^kParam/, "")) : []));
    return `"${name}": ${name.slice(0, cut)} has no parameter "${name.slice(cut + 1)}"; its parameters are: ${known.join(", ")}.`;
  }
  return `"${name}" isn't a destination: use a control's name ("A WT Pos", "Filter 1 Freq", "Env 2 Decay", "Macro 1"), or a module and a parameter ("Main FX 1 Wet", "LFO 1 Mode").`;
}

function same(a: Destination, b: Destination) {
  return a.module === b.module && a.id === b.id && a.paramId === b.paramId && a.param === b.param;
}

/** A stored destination's name, if a name says exactly it in this preset. */
export function destinationName(dest: Destination, ctx: DestinationContext): string | undefined {
  if (paramName(dest.module, dest.paramId) !== dest.param) return undefined;
  const candidates: string[] = [];
  const control = NAMED_CONTROLS.find(([id]) => {
    const d = fromControl(id, ctx);
    return d !== undefined && same(d, dest);
  });
  if (control) candidates.push(control[1]);
  const short = dest.param.replace(/^kParam/, "");
  if (dest.module.startsWith("FX")) {
    const rack = Math.floor(dest.id / 100);
    if (rack < FX_RACKS.length) candidates.push(`${RACK_LABELS[rack]} FX ${(dest.id % 100) + 1} ${short}`);
  } else {
    const labels: Partial<Record<string, string>> = {
      VoiceFilter: `Filter ${dest.id + 1}`,
      Env: `Env ${dest.id + 1}`,
      LFO: `LFO ${dest.id + 1}`,
      Macro: `Macro ${dest.id + 1}`,
      LFOPointModBus: `LFO Point Bus ${dest.id + 1}`,
      Global: "Global",
      Arp: "Arp",
      ClipPlayer: "Clip Player",
      PitchQuantizer: "Pitch Quantizer",
      VoicePanel: "Voice Panel",
    };
    const label = dest.module === "Oscillator" || OSC_TYPES_AND_SUBS.has(dest.module) ? OSC_LABELS[dest.id] : labels[dest.module];
    if (label) candidates.push(`${label} ${short}`);
  }
  return candidates.find((name) => {
    const back = parseDestination(name, ctx);
    return typeof back !== "string" && same(back, dest);
  });
}

const OSC_TYPES_AND_SUBS = new Set<string>(["WTOsc", "SampleOsc", "MultiSampleOsc", "GranularOsc", "SpectralOsc", "NoiseOsc", "SubOsc"]);
