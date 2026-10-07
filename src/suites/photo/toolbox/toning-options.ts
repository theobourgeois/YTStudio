/**
 * Dodge's, Burn's and Sponge's options (docs/photo/tools/toning.md), Photoshop's options bar: each tool's own brush
 * and settings, kept in this browser across photos as the Brush's are. Pure helpers turn them into a stroke.
 */
import { create } from "zustand";
import type { BrushSettings } from "@shared/photo/brush";
import { type SpongeMode, TONE_SPACING, type ToneEffect, type ToneRange, strokeLaw } from "@shared/photo/reference/toning";
import { MAX_BRUSH, MIN_BRUSH } from "../brush-options";

const storage: Pick<Storage, "getItem" | "setItem"> = typeof localStorage !== "undefined" ? localStorage : { getItem: () => null, setItem: () => {} };
const KEY = "photo-toning";

export type ToningTool = "dodge" | "burn" | "sponge";

/** A tool's own brush: diameter in document pixels, hardness 0..1. */
export interface ToolBrush {
  size: number;
  hardness: number;
}

export interface DodgeBurnOptions extends ToolBrush {
  range: ToneRange;
  /** 0..1 (Photoshop's 1–100%). */
  exposure: number;
  airbrush: boolean;
  protectTones: boolean;
}

export interface SpongeOptions extends ToolBrush {
  mode: SpongeMode;
  /** 0..1. */
  flow: number;
  airbrush: boolean;
  vibrance: boolean;
}

export interface ToningOptions {
  dodge: DodgeBurnOptions;
  burn: DodgeBurnOptions;
  sponge: SpongeOptions;
}

/** Photoshop's defaults: Midtones at 50% with Protect Tones; Desaturate at 50% Flow with Vibrance; soft brushes. */
export const TONING_DEFAULTS: ToningOptions = {
  dodge: { size: 100, hardness: 0, range: "midtones", exposure: 0.5, airbrush: false, protectTones: true },
  burn: { size: 100, hardness: 0, range: "midtones", exposure: 0.5, airbrush: false, protectTones: true },
  sponge: { size: 100, hardness: 0, mode: "desaturate", flow: 0.5, airbrush: false, vibrance: true },
};

const RANGES: readonly ToneRange[] = ["shadows", "midtones", "highlights"];
const unit = (v: unknown, fallback: number) => (typeof v === "number" && Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : fallback);
const bool = (v: unknown, fallback: boolean) => (typeof v === "boolean" ? v : fallback);
const size = (v: unknown, fallback: number) => (typeof v === "number" && Number.isFinite(v) ? Math.max(MIN_BRUSH, Math.min(MAX_BRUSH, Math.round(v))) : fallback);
/** Exposure and Flow are 1–100%: never 0, which would do nothing. */
const percent = (v: unknown, fallback: number) => Math.max(0.01, unit(v, fallback));

type Loose<T> = Partial<Record<keyof T, unknown>>;

function dodgeBurn(o: Loose<DodgeBurnOptions> | undefined, d: DodgeBurnOptions): DodgeBurnOptions {
  return {
    size: size(o?.size, d.size),
    hardness: unit(o?.hardness, d.hardness),
    range: RANGES.includes(o?.range as ToneRange) ? (o!.range as ToneRange) : d.range,
    exposure: percent(o?.exposure, d.exposure),
    airbrush: bool(o?.airbrush, d.airbrush),
    protectTones: bool(o?.protectTones, d.protectTones),
  };
}

export function sanitizeToning(o: { dodge?: Loose<DodgeBurnOptions>; burn?: Loose<DodgeBurnOptions>; sponge?: Loose<SpongeOptions> }): ToningOptions {
  const s = o.sponge;
  const d = TONING_DEFAULTS.sponge;
  return {
    dodge: dodgeBurn(o.dodge, TONING_DEFAULTS.dodge),
    burn: dodgeBurn(o.burn, TONING_DEFAULTS.burn),
    sponge: {
      size: size(s?.size, d.size),
      hardness: unit(s?.hardness, d.hardness),
      mode: s?.mode === "saturate" || s?.mode === "desaturate" ? s.mode : d.mode,
      flow: percent(s?.flow, d.flow),
      airbrush: bool(s?.airbrush, d.airbrush),
      vibrance: bool(s?.vibrance, d.vibrance),
    },
  };
}

function load(): ToningOptions {
  try {
    return sanitizeToning(JSON.parse(storage.getItem(KEY) ?? "{}"));
  } catch {
    return TONING_DEFAULTS;
  }
}

interface ToningStore extends ToningOptions {
  setDodgeBurn: (tool: "dodge" | "burn", patch: Partial<DodgeBurnOptions>) => void;
  setSponge: (patch: Partial<SpongeOptions>) => void;
}

export const useToning = create<ToningStore>((set, get) => {
  const save = (next: ToningOptions) => {
    const clean = sanitizeToning(next);
    storage.setItem(KEY, JSON.stringify(clean));
    set(clean);
  };
  const now = (): ToningOptions => ({ dodge: get().dodge, burn: get().burn, sponge: get().sponge });
  return {
    ...load(),
    setDodgeBurn: (tool, patch) => save({ ...now(), [tool]: { ...get()[tool], ...patch } }),
    setSponge: (patch) => save({ ...now(), sponge: { ...get().sponge, ...patch } }),
  };
});

/** A tool's brush in the store, for the kit's `brush` (`[` and `]`). */
export const toningBrush = (tool: ToningTool) => ({
  get: (): ToolBrush => useToning.getState()[tool],
  set: (patch: Partial<ToolBrush>) => (tool === "sponge" ? useToning.getState().setSponge(patch) : useToning.getState().setDodgeBurn(tool, patch)),
});

/** What a toning stroke does: the tool's effect, its dabs' strength, its ceiling and whether it airbrushes. */
export interface ToningStroke {
  effect: ToneEffect;
  brush: BrushSettings;
  cap: number;
  airbrush: boolean;
}

/**
 * The stroke a tool's options make. `swap` (Alt held) turns Dodge into Burn and Burn into Dodge with the same
 * settings, as Photoshop's.
 */
export function toningStroke(options: ToningOptions, tool: ToningTool, swap = false): ToningStroke {
  if (tool === "sponge") {
    const o = options.sponge;
    const effect: ToneEffect = { tool: "sponge", mode: o.mode, vibrance: o.vibrance };
    const law = strokeLaw(effect, o.flow, o.airbrush, o.hardness);
    return { effect, brush: { radius: o.size / 2, hardness: o.hardness, strength: law.dab, spacing: TONE_SPACING }, cap: law.cap, airbrush: o.airbrush };
  }
  const o = options[tool];
  const effect: ToneEffect = { tool: swap ? (tool === "dodge" ? "burn" : "dodge") : tool, range: o.range, protect: o.protectTones };
  const law = strokeLaw(effect, o.exposure, o.airbrush, o.hardness);
  return { effect, brush: { radius: o.size / 2, hardness: o.hardness, strength: law.dab, spacing: TONE_SPACING }, cap: law.cap, airbrush: o.airbrush };
}
