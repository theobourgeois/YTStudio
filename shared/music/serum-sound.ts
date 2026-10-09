/**
 * The Serum player's sound panel (`docs/serum/player.md` §3.4, §3.5), pure: a Serum 2 channel's mod matrix,
 * envelopes and LFOs as the player shows them, the edits it sends, and Serum's live controls for them: their
 * parameter ids and how a control's position (0 to 1, as a host sets it) maps to what Serum stores and shows.
 * The mappings were measured on Serum 2.1.5 in the offline engine (a position set, the state saved and read).
 */
import { clamp } from "../math.ts";
import type { SerumEffectKind, SerumFxRack, SerumFxRackId } from "./serum-effects.ts";

/**
 * Modulation sources by their id (a mod slot's `source: [main, aux]`; 0 is none). From the presets studied:
 * Serum names them so in its matrix.
 */
export const SERUM_MOD_SOURCES = [
  "None",
  "Mod Wheel",
  ...[1, 2, 3, 4].map((n) => `Env ${n}`),
  ...[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => `LFO ${n}`),
  "Velo",
  "Note#",
  "Aftertouch",
  "Poly AT",
  "Noise Osc",
  "NoteOn Rand1",
  "NoteOn Rand2",
  "NoteOn Alt",
  "NoteOn Alt2",
  ...[1, 2, 3, 4, 5, 6, 7, 8].map((n) => `Macro ${n}`),
  "Pitch Bend",
  "Expr X",
  "Expr Y",
  "Expr Z",
  "Release Velo",
  "Fixed",
  ...[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => `LFO ${n} Y`),
  "Osc A",
  "Osc B",
  "Osc C",
  "Sub Osc",
  "Filter 1",
  "Filter 2",
  "Active Voices",
  "Voice Mod 1",
  "Voice Mod 2",
  "Voice Index",
  "NoteOn Rand (Discrete)",
] as const;

/** Serum has 64 mod slots, 4 envelopes and 10 LFOs. */
export const SERUM_MOD_SLOTS = 64;
export const SERUM_ENVELOPES = 4;
export const SERUM_LFOS = 10;

/** An envelope's live controls, in the order of their parameter ids (`Env 1 Attack` is 3000000, `Env 1 Hold` 3000001…). */
export const SERUM_ENVELOPE_FIELDS = ["attack", "hold", "decay", "sustain", "release", "attackCurve", "decayCurve", "releaseCurve"] as const;
export type SerumEnvelopeField = (typeof SERUM_ENVELOPE_FIELDS)[number];
/** An LFO's live controls, in the order of their parameter ids (`LFO 1 Rate` is 4000000…). Its shape, mode and sync aren't controls. */
export const SERUM_LFO_FIELDS = ["rate", "smooth", "rise", "delay", "phase"] as const;
export type SerumLfoField = (typeof SERUM_LFO_FIELDS)[number];

/** Mod slot `slot`'s amount (1 to 64): `Mod 1 Amount` is slot 1, as Serum's state numbers it from 0 (`ModSlot0`). Measured. */
export const serumModAmountParam = (slot: number) => String(6_000_000 + (slot - 1) * 1000);
/** Envelope `index`'s (1 to 4) control. */
export const serumEnvelopeParam = (index: number, field: SerumEnvelopeField) => String(3_000_000 + (index - 1) * 1000 + SERUM_ENVELOPE_FIELDS.indexOf(field));
/** LFO `index`'s (1 to 10) control. */
export const serumLfoParam = (index: number, field: SerumLfoField) => String(4_000_000 + (index - 1) * 1000 + SERUM_LFO_FIELDS.indexOf(field));

/** A live control of Serum's: its parameter, and where it is (0 to 1, as the host sets it). */
export interface SerumControl {
  param: string;
  value: number;
  /** What Serum shows for it, when the engine said (the player formats its own; a synced rise or delay is Serum's). */
  text?: string;
}

/** A route of the mod matrix, as the player lists it. */
export interface SerumModRoute {
  /** 1 to 64. */
  slot: number;
  /** A name of `SERUM_MOD_SOURCES` ("LFO 1"), or "Source 71" for one we don't know. */
  source: string;
  /** Its aux source (scaling the amount), or null. */
  aux: string | null;
  /** The destination as Serum's control is named ("Filter 1 Freq", "A WT Pos"), else module and parameter ("Main FX 2 Wet"). */
  to: string;
  /** Its amount control (`Mod N Amount`), live: value 0.5 is 0%. */
  amount: SerumControl;
  bipolar: boolean;
  bypass: boolean;
}

export interface SerumEnvelope {
  /** 1 to 4: Env 1 is the amplitude's. */
  index: number;
  /** Something is routed from it (Env 1 always is: it shapes every note). */
  used: boolean;
  controls: Record<SerumEnvelopeField, SerumControl>;
}

/** How an LFO runs: restarting with each note (Serum's default), free running, or once as an envelope. */
export type SerumLfoMode = "retrigger" | "free" | "envelope";

/** A point of an LFO's shape: [x, y] or [x, y, curve], each 0 to 1, y from the top (0 is the full value). */
export type SerumLfoPoint = [number, number] | [number, number, number];

/** Serum's default LFO shape, a triangle (what an LFO with no shape of its own plays). */
export const SERUM_DEFAULT_LFO_SHAPE: SerumLfoPoint[] = [
  [0, 1],
  [0.5, 0],
  [1, 1],
];

export interface SerumLfo {
  /** 1 to 10. */
  index: number;
  used: boolean;
  sync: boolean;
  dotted: boolean;
  triplets: boolean;
  rate10x: boolean;
  mode: SerumLfoMode;
  /** Path, Lorenz, Rossler or RandomSH: not a drawn shape. Null for a drawn one. */
  type: string | null;
  shape: SerumLfoPoint[];
  /** False: Serum's default shape (`SERUM_DEFAULT_LFO_SHAPE`). */
  customShape: boolean;
  controls: Record<SerumLfoField, SerumControl>;
}

/**
 * A change of a Serum channel's sound that needs Serum to load it (`docs/serum/player.md` §2.2): the engine fades
 * it out, loads, plays held notes again and fades in. Values are in the spec's units (`preset-format.md`): ms, %.
 */
export type SerumSoundEdit =
  /** A route changed (`slot` given and routed), or a new one (`slot` free or left out: the first free slot; `source` and `to` needed). */
  | { kind: "route"; slot?: number; source?: string; aux?: string | null; to?: string; amount?: number; bipolar?: boolean; bypass?: boolean }
  | { kind: "removeRoute"; slot: number }
  | ({ kind: "envelope"; envelope: number } & Partial<Record<SerumEnvelopeField, number>>)
  | {
      kind: "lfo";
      lfo: number;
      /** A division ("1/4", "1/8.", "1/16 t") when synced, else Hz. */
      rate?: number | string;
      sync?: boolean;
      mode?: SerumLfoMode;
      smooth?: number;
      rise?: number;
      delay?: number;
      phase?: number;
      /** Its points; null: back to Serum's default. */
      shape?: SerumLfoPoint[] | null;
    }
  /**
   * An effect's settings (`docs/serum/player.md` §3.6): its switch, and parameters by their spec names (`drive`, `wet`),
   * in what Serum stores (`SERUM_EFFECTS`' scales; a choice by its name or Serum's). `position` counts from 1.
   */
  | { kind: "effect"; rack: SerumFxRackId; position: number; enabled?: boolean; settings?: Record<string, number | string | boolean> }
  /** A new effect at `at` (1 is first; left out: last), Serum's defaults but for `settings`. */
  | { kind: "addEffect"; rack: SerumFxRackId; effect: SerumEffectKind; at?: number; enabled?: boolean; settings?: Record<string, number | string | boolean> }
  /** An effect taken out; routes to it go, routes to those after follow them. */
  | { kind: "removeEffect"; rack: SerumFxRackId; position: number }
  /** An effect moved to `at` in its rack, or in `toRack`; routes follow it. */
  | { kind: "moveEffect"; rack: SerumFxRackId; position: number; at: number; toRack?: SerumFxRackId }
  /** One of Serum's saved effects (`.SerumFX`, put in at `at`, else last) or racks (`.SerumFXRack`, the rack's effects replaced), by its path. */
  | { kind: "effectChain"; rack: SerumFxRackId; path: string; at?: number };

/** The player's history of a channel's sound: what Undo and Redo would undo and redo, or null. */
export interface SerumHistory {
  undo: string | null;
  redo: string | null;
}

/** What a mod source drives, from the routes: the destinations of those it's the source or aux of. */
export function sourceDrives(routes: readonly SerumModRoute[], source: string): string[] {
  return routes.filter((r) => !r.bypass && (r.source === source || r.aux === source)).map((r) => r.to);
}

/** Whether something is routed from a source (an LFO's Y counts as the LFO). */
export function sourceUsed(routes: readonly SerumModRoute[], source: string): boolean {
  return routes.some((r) => [r.source, r.aux].some((s) => s === source || s === `${source} Y`));
}

/** The routes grouped by their source, in the matrix's order of first appearance. */
export function routesBySource(routes: readonly SerumModRoute[]): { source: string; routes: SerumModRoute[] }[] {
  const groups = new Map<string, SerumModRoute[]>();
  for (const route of routes) groups.set(route.source, [...(groups.get(route.source) ?? []), route]);
  return [...groups].map(([source, list]) => ({ source, routes: list }));
}

// ---- Live controls: a position (0 to 1) and Serum's values ----

/** A mod amount (−100 to 100 %) as its control's position, and back. */
export const modAmountToValue = (amount: number) => clamp((amount / 100 + 1) / 2, 0, 1);
export const modAmountOf = (value: number) => (value * 2 - 1) * 100;

/** An envelope's time (stored in seconds) is 32·v⁵ seconds: 0.5 is one second. */
const ENV_MAX_SECONDS = 32;

/**
 * An envelope control's position from what Serum stores: times in seconds, sustain the knob's place (0 to 1, its
 * gain the square), curves 0 to 100.
 */
export function envelopeValueOf(field: SerumEnvelopeField, stored: number): number {
  if (field === "sustain") return clamp(stored, 0, 1);
  if (field.endsWith("Curve")) return clamp(stored / 100, 0, 1);
  return clamp((Math.max(0, stored) / ENV_MAX_SECONDS) ** (1 / 5), 0, 1);
}

/** An envelope's time at a control's position, in seconds. */
export const envelopeSeconds = (value: number) => ENV_MAX_SECONDS * clamp(value, 0, 1) ** 5;

/** An LFO control's position from what Serum stores: a rate in Hz (free) or a division's free rate (synced); smooth 0–100; rise and delay 0–4; phase 0–360°. */
export function lfoValueOf(field: SerumLfoField, stored: number): number {
  switch (field) {
    case "rate":
      return clamp((Math.max(0, stored) / 100) ** (1 / 4), 0, 1);
    case "smooth":
      return clamp(stored / 100, 0, 1);
    case "rise":
    case "delay":
      return clamp(stored / 4, 0, 1);
    case "phase":
      return clamp(stored / 360, 0, 1);
  }
}

const STRAIGHT = ["32 bar", "16 bar", "8 bar", "4 bar", "2 bar", "bar", "1/2", "1/4", "1/8", "1/16", "1/32", "1/64", "1/128", "1/256"];
const DOTTED = ["24 bar", "12 bar", "6 bar", "3 bar", "1.5 bar", "1/2.", "1/4.", "1/8.", "1/16.", "1/32.", "1/64.", "1/128.", "1/256.", "1/512."];

/**
 * A synced LFO rate's division at a control's position: the knob is cut into 14 bands, one per straight division
 * from 32 bars to 1/256 (1/4 at the middle); with dotted or triplet rates allowed each band is shared, a third each
 * (`server/music/serum/units.ts`).
 */
export function lfoDivision(value: number, flags: { dotted?: boolean; triplets?: boolean } = {}): string {
  const band = clamp(value, 0, 1) * 14;
  const k = Math.min(13, Math.floor(band + 1e-9));
  if (flags.dotted || flags.triplets) {
    const share = Math.min(2, Math.floor((band - k) * 3 + 1e-9));
    if (share === 1 && flags.dotted) return DOTTED[k];
    if (share === 2 && flags.triplets) return `${STRAIGHT[k]} t`;
  }
  return STRAIGHT[k];
}

const trimmed = (n: number, digits: number) => n.toFixed(digits);

/** A time as Serum shows one: "0.3 ms", "31 ms", "1.00 s", "18.9 s". */
export function serumTimeText(seconds: number): string {
  if (seconds < 0.01) return `${trimmed(seconds * 1000, 1)} ms`;
  if (seconds < 1) return `${Math.round(seconds * 1000)} ms`;
  if (seconds < 10) return `${trimmed(seconds, 2)} s`;
  return `${trimmed(seconds, 1)} s`;
}

/** An envelope control's text at a position, as Serum shows it (Env 1's sustain in dB, the others' as their gain in %). */
export function envelopeText(index: number, field: SerumEnvelopeField, value: number): string {
  if (field === "sustain") {
    const gain = clamp(value, 0, 1) ** 2;
    if (index === 1) return gain <= 0 ? "-∞ dB" : `${trimmed(20 * Math.log10(gain), 1)} dB`;
    return gain <= 0 ? "--" : `${Math.round(gain * 100)}%`;
  }
  if (field.endsWith("Curve")) return String(Math.round(value * 100));
  return serumTimeText(envelopeSeconds(value));
}

/** An LFO control's text at a position, or null where only Serum knows it (a synced rise or delay: its own bands). */
export function lfoText(lfo: Pick<SerumLfo, "sync" | "dotted" | "triplets" | "rate10x">, field: SerumLfoField, value: number): string | null {
  switch (field) {
    case "rate": {
      if (lfo.sync) return lfoDivision(value, lfo);
      const hz = 100 * clamp(value, 0, 1) ** 4 * (lfo.rate10x ? 10 : 1);
      return `${hz < 10 ? trimmed(hz, 2) : trimmed(hz, 1)} Hz`;
    }
    case "smooth":
      return String(Math.round(value * 100));
    case "rise":
    case "delay":
      if (value <= 0) return "Off";
      return lfo.sync ? null : `${trimmed(value * 4, 1)} s`;
    case "phase":
      return `${Math.round(value * 360)}°`;
  }
}

/** A mod amount's text: "−40%", "--" at none, as Serum shows it. */
export function modAmountText(value: number): string {
  const amount = Math.round(modAmountOf(value));
  return amount === 0 ? "0%" : `${amount}%`;
}

/**
 * The envelope as a line to draw, each stage as wide as its control's position (the controls are already
 * perceptual: a time's position is its fifth root): [x, y] points from 0, y 1 at full level. `stage` is the
 * width a stage takes at full position.
 */
export function envelopeOutline(env: Pick<SerumEnvelope, "controls">, stage: number): { points: [number, number][]; sustainEnd: number } {
  const c = env.controls;
  const level = c.sustain.value ** 2;
  const a = c.attack.value * stage;
  const h = c.hold.value * stage;
  const d = c.decay.value * stage;
  const sustainEnd = a + h + d + stage * 0.6;
  const r = c.release.value * stage;
  return {
    points: [
      [0, 0],
      [a, 1],
      [a + h, 1],
      [a + h + d, level],
      [sustainEnd, level],
      [sustainEnd + r, 0],
    ],
    sustainEnd,
  };
}

/** A sound's control moved to a position: the routes', envelopes', LFOs' and macros' copies of it (none if it isn't one of them). */
export function withControl<
  S extends { modulation: SerumModRoute[] | null; envelopes: SerumEnvelope[]; lfos: SerumLfo[]; macros: { param: string; value: number }[]; oscillators?: SerumOscillator[]; effects?: SerumFxRack[] },
>(
  sound: S,
  param: string,
  value: number,
): S {
  const set = (c: SerumControl) => (c.param === param ? { ...c, value, text: undefined } : c);
  const setAll = <T extends string>(controls: Record<T, SerumControl>) => {
    const hit = Object.values<SerumControl>(controls).some((c) => c.param === param);
    return hit ? (Object.fromEntries(Object.entries<SerumControl>(controls).map(([k, c]) => [k, set(c)])) as Record<T, SerumControl>) : controls;
  };
  return {
    ...sound,
    modulation: sound.modulation?.map((r) => (r.amount.param === param ? { ...r, amount: set(r.amount) } : r)) ?? null,
    envelopes: sound.envelopes.map((e) => {
      const controls = setAll(e.controls);
      return controls === e.controls ? e : { ...e, controls };
    }),
    lfos: sound.lfos.map((l) => {
      const controls = setAll(l.controls);
      return controls === l.controls ? l : { ...l, controls };
    }),
    macros: sound.macros.map((m) => (m.param === param ? { ...m, value } : m)),
    ...(sound.oscillators && {
      oscillators: sound.oscillators.map((o) => (o.enabled.param === param ? { ...o, enabled: set(o.enabled) } : o.level.param === param ? { ...o, level: set(o.level) } : o)),
    }),
    ...(sound.effects && {
      effects: sound.effects.map((rack) =>
        rack.effects.some((e) => e.enabled?.param === param || e.controls.some((c) => c.param === param))
          ? {
              ...rack,
              effects: rack.effects.map((e) => ({
                ...e,
                enabled: e.enabled?.param === param ? { ...e.enabled, value, text: undefined } : e.enabled,
                controls: e.controls.map((c) => (c.param === param ? { ...c, value, text: undefined } : c)),
              })),
            }
          : rack,
      ),
    }),
  };
}

// ---- Oscillators ----

/** Serum's five oscillators, by their number in its state (`Oscillator0`…`Oscillator4`). */
export const SERUM_OSCILLATORS = ["A", "B", "C", "Noise", "Sub"] as const;

/** An oscillator's live control: on or off, its level (the knob's place: its gain is the square), its pan. */
export const serumOscillatorParam = (index: number, field: "enable" | "level" | "pan") => String(1_000_000 + index * 1000 + { enable: 0, level: 1, pan: 2 }[field]);

export interface SerumOscillator {
  /** 0 to 4: A, B, C, Noise, Sub. */
  index: number;
  name: (typeof SERUM_OSCILLATORS)[number];
  /** What kind it is: Wavetable, Sample, Multisample, Granular, Spectral, Noise or Sub. */
  kind: string;
  /** What it plays: its wavetable's or sample's name, the sub's shape. */
  plays: string;
  /** On (1) or off (0): Serum's own switch, which mute and solo set. */
  enabled: SerumControl;
  level: SerumControl;
  octave: number;
  semi: number;
}

/** A solo in place: the oscillator soloed, and every oscillator's switch as it was before (put back when it ends). */
export interface SerumSolo {
  index: number;
  before: Record<string, number>;
}

/**
 * Soloing an oscillator (as a mixer's solo): it on, the others off, until it's soloed again, which puts every switch
 * back as it was. Soloing another meanwhile moves the solo, still putting back the first state when it ends. Answers
 * the switches to set and the solo after.
 */
export function soloOscillator(oscillators: readonly SerumOscillator[], index: number, solo: SerumSolo | null): { values: Record<string, number>; solo: SerumSolo | null } {
  if (solo?.index === index) return { values: { ...solo.before }, solo: null };
  const before = solo?.before ?? Object.fromEntries(oscillators.map((o) => [o.enabled.param, o.enabled.value >= 0.5 ? 1 : 0]));
  const values = Object.fromEntries(oscillators.map((o) => [o.enabled.param, o.index === index ? 1 : 0]));
  return { values, solo: { index, before } };
}
