/**
 * The sampler's playing settings beyond its volume envelope (`docs/fl-studio/channel-rack.md`, FL's
 * Channel settings' Instrument and Misc tabs): its loop, its filter (FL's Mod X and Mod Y: cutoff and
 * resonance), an envelope and an LFO for each of pan, cutoff, resonance and pitch, an LFO for its volume,
 * and how much of the song's swing it takes. Each is absent from a channel while it's at its default
 * (`samplerOf` fills them in), so songs from before them are unchanged.
 *
 * The maths here (`envelopeLevel`, `lfoValue`, `tensionCurve`, `cutoffHz`, `resonanceQ`) is what the
 * engine plays (`engine/src/Sequencer.cpp`'s sampler voices): keep the two the same.
 */
import { clamp, isFiniteNumber } from "../math.ts";

export const LFO_SHAPES = ["sine", "triangle", "square", "saw"] as const;
export type LfoShape = (typeof LFO_SHAPES)[number];

/** An LFO (FL's): a wave moving its target from where it's set, once its delay has passed, fading in over its attack. */
export interface Lfo {
  enabled: boolean;
  shape: LfoShape;
  /** Cycles a second; with `sync`, beats a cycle. */
  speed: number;
  sync: boolean;
  /** -1..1: how far it moves its target (the volume's: 0..1, how deep it dips). */
  amount: number;
  /** Seconds from the note's start before it moves, then seconds it takes to reach its amount. */
  delay: number;
  attack: number;
}

/** An envelope for one of the sampler's targets (FL's DAHDSR, with tensions), and how far it moves it (-1..1). */
export interface ModEnvelope {
  enabled: boolean;
  delay: number;
  attack: number;
  hold: number;
  decay: number;
  /** 0..1 of its peak. */
  sustain: number;
  release: number;
  /** -1..1: how each stage bends (0 straight; above 0 quick at first). */
  attackTension: number;
  decayTension: number;
  releaseTension: number;
  amount: number;
}

export const MOD_TARGETS = ["pan", "cutoff", "resonance", "pitch"] as const;
export type ModTarget = (typeof MOD_TARGETS)[number];

export interface Modulation {
  envelope: ModEnvelope;
  lfo: Lfo;
}

/** Every target's envelope and LFO, and the volume's LFO (its envelope is `Channel.envelope`). */
export interface SamplerMods {
  volumeLfo: Lfo;
  pan: Modulation;
  cutoff: Modulation;
  resonance: Modulation;
  pitch: Modulation;
}

export const FILTER_TYPES = ["off", "lowpass", "bandpass", "highpass"] as const;
export type FilterType = (typeof FILTER_TYPES)[number];

/** The sampler's filter: its kind, and its cutoff and resonance, 0..1 (`cutoffHz`, `resonanceQ`). */
export interface SamplerFilter {
  type: FilterType;
  cutoff: number;
  resonance: number;
}

/**
 * The sampler's loop (FL's sample loop): while a note is held, its sample goes round from `end` back to
 * `start` (fractions of the prepared sample), crossfading over `crossfade` of the loop's length.
 */
export interface SampleLoop {
  enabled: boolean;
  start: number;
  end: number;
  crossfade: number;
}

/** The longest an envelope's stage, or an LFO's delay or attack, lasts (seconds). */
export const MAX_MOD_TIME = 10;
/** How far a pitch envelope or LFO at full amount moves the note, in semitones. */
export const PITCH_MOD_RANGE = 24;
/** An LFO's speed: cycles a second, or beats a cycle with sync. */
export const MIN_LFO_HZ = 0.01;
export const MAX_LFO_HZ = 30;
export const MIN_LFO_BEATS = 1 / 16;
export const MAX_LFO_BEATS = 32;
/** The shortest loop, as a fraction of the sample. */
export const MIN_LOOP = 0.001;

export const DEFAULT_LFO: Lfo = { enabled: false, shape: "sine", speed: 4, sync: false, amount: 0.5, delay: 0, attack: 0 };
export const DEFAULT_MOD_ENVELOPE: ModEnvelope = {
  enabled: false,
  delay: 0,
  attack: 0,
  hold: 0,
  decay: 0.3,
  sustain: 0,
  release: 0.1,
  attackTension: 0,
  decayTension: 0,
  releaseTension: 0,
  amount: 0.5,
};
const DEFAULT_MODULATION: Modulation = { envelope: DEFAULT_MOD_ENVELOPE, lfo: DEFAULT_LFO };
export const DEFAULT_MODS: SamplerMods = { volumeLfo: DEFAULT_LFO, pan: DEFAULT_MODULATION, cutoff: DEFAULT_MODULATION, resonance: DEFAULT_MODULATION, pitch: DEFAULT_MODULATION };
export const DEFAULT_FILTER: SamplerFilter = { type: "off", cutoff: 1, resonance: 0 };
export const DEFAULT_LOOP: SampleLoop = { enabled: false, start: 0, end: 1, crossfade: 0 };
export const DEFAULT_SWING_MIX = 1;

/** A sampler's settings, its defaults filled in. */
export interface SamplerSettings {
  swingMix: number;
  loop: SampleLoop;
  filter: SamplerFilter;
  mods: SamplerMods;
}

/** What a channel keeps of these (each absent at its default). */
export interface SamplerFields {
  swingMix?: number;
  loop?: SampleLoop;
  filter?: SamplerFilter;
  mods?: Partial<SamplerMods>;
}

/** A channel's sampler settings, with their defaults where it has none. */
export function samplerOf(channel: SamplerFields): SamplerSettings {
  return {
    swingMix: channel.swingMix ?? DEFAULT_SWING_MIX,
    loop: channel.loop ?? DEFAULT_LOOP,
    filter: channel.filter ?? DEFAULT_FILTER,
    mods: { ...DEFAULT_MODS, ...channel.mods },
  };
}

// ---------------------------------------------------------------------------
// Checking (untrusted input: a saved song, a patch)
// ---------------------------------------------------------------------------

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const num = (v: unknown, min: number, max: number, fallback: number) => (isFiniteNumber(v) ? clamp(v, min, max) : fallback);
const same = <T extends object>(a: T, b: T) => (Object.keys(a) as (keyof T)[]).every((k) => a[k] === b[k]);

export function normalizeLfo(input: unknown, base: Lfo = DEFAULT_LFO): Lfo {
  const raw = isObject(input) ? input : {};
  const sync = typeof raw.sync === "boolean" ? raw.sync : base.sync;
  const speed = raw.speed === undefined ? base.speed : num(raw.speed, sync ? MIN_LFO_BEATS : MIN_LFO_HZ, sync ? MAX_LFO_BEATS : MAX_LFO_HZ, base.speed);
  return {
    enabled: typeof raw.enabled === "boolean" ? raw.enabled : base.enabled,
    shape: LFO_SHAPES.includes(raw.shape as LfoShape) ? (raw.shape as LfoShape) : base.shape,
    speed: clamp(speed, sync ? MIN_LFO_BEATS : MIN_LFO_HZ, sync ? MAX_LFO_BEATS : MAX_LFO_HZ),
    sync,
    amount: num(raw.amount, -1, 1, base.amount),
    delay: num(raw.delay, 0, MAX_MOD_TIME, base.delay),
    attack: num(raw.attack, 0, MAX_MOD_TIME, base.attack),
  };
}

export function normalizeModEnvelope(input: unknown, base: ModEnvelope = DEFAULT_MOD_ENVELOPE): ModEnvelope {
  const raw = isObject(input) ? input : {};
  const time = (key: "delay" | "attack" | "hold" | "decay" | "release") => num(raw[key], 0, MAX_MOD_TIME, base[key]);
  const tension = (key: "attackTension" | "decayTension" | "releaseTension") => num(raw[key], -1, 1, base[key]);
  return {
    enabled: typeof raw.enabled === "boolean" ? raw.enabled : base.enabled,
    delay: time("delay"),
    attack: time("attack"),
    hold: time("hold"),
    decay: time("decay"),
    sustain: num(raw.sustain, 0, 1, base.sustain),
    release: time("release"),
    attackTension: tension("attackTension"),
    decayTension: tension("decayTension"),
    releaseTension: tension("releaseTension"),
    amount: num(raw.amount, -1, 1, base.amount),
  };
}

export function normalizeFilter(input: unknown, base: SamplerFilter = DEFAULT_FILTER): SamplerFilter {
  const raw = isObject(input) ? input : {};
  return {
    type: FILTER_TYPES.includes(raw.type as FilterType) ? (raw.type as FilterType) : base.type,
    cutoff: num(raw.cutoff, 0, 1, base.cutoff),
    resonance: num(raw.resonance, 0, 1, base.resonance),
  };
}

export function normalizeLoop(input: unknown, base: SampleLoop = DEFAULT_LOOP): SampleLoop {
  const raw = isObject(input) ? input : {};
  let start = num(raw.start, 0, 1 - MIN_LOOP, base.start);
  let end = num(raw.end, MIN_LOOP, 1, base.end);
  if (end - start < MIN_LOOP) {
    if (raw.end !== undefined && raw.start === undefined) start = Math.max(0, end - MIN_LOOP);
    else end = Math.min(1, start + MIN_LOOP);
  }
  return { enabled: typeof raw.enabled === "boolean" ? raw.enabled : base.enabled, start, end, crossfade: num(raw.crossfade, 0, 0.5, base.crossfade) };
}

/** A patch of a channel's sampler settings: each part partly, merged into what it has. */
export interface SamplerPatch {
  swingMix?: number;
  loop?: Partial<SampleLoop>;
  filter?: Partial<SamplerFilter>;
  mods?: { volumeLfo?: Partial<Lfo> } & Partial<Record<ModTarget, { envelope?: Partial<ModEnvelope>; lfo?: Partial<Lfo> }>>;
}

/**
 * A channel's sampler fields after `patch` (checked), or from untrusted `input` (`patch` absent: what's
 * there is read). Only what differs from its default is kept, so an untouched channel has none.
 */
export function samplerFields(current: SamplerFields, patch: SamplerPatch): SamplerFields {
  const now = samplerOf(current);
  const out: SamplerFields = {};
  const swingMix = patch.swingMix === undefined ? now.swingMix : num(patch.swingMix, 0, 1, now.swingMix);
  if (swingMix !== DEFAULT_SWING_MIX) out.swingMix = swingMix;
  const loop = patch.loop ? normalizeLoop(patch.loop, now.loop) : now.loop;
  if (!same(loop, DEFAULT_LOOP)) out.loop = same(loop, now.loop) && current.loop ? current.loop : loop;
  const filter = patch.filter ? normalizeFilter(patch.filter, now.filter) : now.filter;
  if (!same(filter, DEFAULT_FILTER)) out.filter = same(filter, now.filter) && current.filter ? current.filter : filter;
  const mods: Partial<SamplerMods> = {};
  const volumeLfo = patch.mods?.volumeLfo ? normalizeLfo(patch.mods.volumeLfo, now.mods.volumeLfo) : now.mods.volumeLfo;
  if (!same(volumeLfo, DEFAULT_LFO)) mods.volumeLfo = same(volumeLfo, now.mods.volumeLfo) ? now.mods.volumeLfo : volumeLfo;
  for (const target of MOD_TARGETS) {
    const was = now.mods[target];
    const change = patch.mods?.[target];
    const envelope = change?.envelope ? normalizeModEnvelope(change.envelope, was.envelope) : was.envelope;
    const lfo = change?.lfo ? normalizeLfo(change.lfo, was.lfo) : was.lfo;
    if (same(envelope, DEFAULT_MOD_ENVELOPE) && same(lfo, DEFAULT_LFO)) continue;
    mods[target] = same(envelope, was.envelope) && same(lfo, was.lfo) ? was : { envelope, lfo };
  }
  if (Object.keys(mods).length) out.mods = mods;
  return out;
}

/** A channel's sampler fields from a saved song (anything that isn't right is dropped). */
export function normalizeSamplerFields(raw: Record<string, unknown>): SamplerFields {
  const mods = isObject(raw.mods) ? raw.mods : {};
  const targets = Object.fromEntries(
    MOD_TARGETS.flatMap((t) => (isObject(mods[t]) ? [[t, { envelope: normalizeModEnvelope((mods[t] as Record<string, unknown>).envelope), lfo: normalizeLfo((mods[t] as Record<string, unknown>).lfo) }]] : [])),
  );
  return samplerFields(
    {},
    {
      swingMix: isFiniteNumber(raw.swingMix) ? raw.swingMix : undefined,
      loop: isObject(raw.loop) ? normalizeLoop(raw.loop) : undefined,
      filter: isObject(raw.filter) ? normalizeFilter(raw.filter) : undefined,
      mods: { ...(isObject(mods.volumeLfo) ? { volumeLfo: normalizeLfo(mods.volumeLfo) } : {}), ...targets },
    },
  );
}

/** Whether two channels' sampler fields are the same (an edit that changes none of them keeps the channel). */
export const sameSampler = (a: SamplerFields, b: SamplerFields) => a.swingMix === b.swingMix && a.loop === b.loop && a.filter === b.filter && sameMods(a.mods, b.mods);
function sameMods(a: Partial<SamplerMods> | undefined, b: Partial<SamplerMods> | undefined): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return a.volumeLfo === b.volumeLfo && MOD_TARGETS.every((t) => a[t] === b[t]);
}

// ---------------------------------------------------------------------------
// What they do (the engine plays the same)
// ---------------------------------------------------------------------------

/** A stage's shape at `x` (0..1 of the way through), bent by `tension` (-1..1; above 0 quick at first). */
export const tensionCurve = (x: number, tension: number) => clamp(x, 0, 1) ** (2 ** (-2 * tension));

/** The envelope's fields a level needs (the volume envelope has no delay, hold or tensions until they're set). */
export type EnvelopeShape = Pick<ModEnvelope, "attack" | "decay" | "sustain" | "release"> & Partial<Pick<ModEnvelope, "delay" | "hold" | "attackTension" | "decayTension" | "releaseTension">>;

/** An envelope's level (0..1) `seconds` into its note, the note let go at `releasedAt` seconds (null: still held). */
export function envelopeLevel(env: EnvelopeShape, seconds: number, releasedAt: number | null): number {
  const held = (t: number): number => {
    const delay = env.delay ?? 0;
    const hold = env.hold ?? 0;
    if (t < delay) return 0;
    let at = t - delay;
    if (at < env.attack) return tensionCurve(at / env.attack, env.attackTension ?? 0);
    at -= env.attack;
    if (at < hold) return 1;
    at -= hold;
    if (at < env.decay) return 1 - (1 - env.sustain) * tensionCurve(at / env.decay, env.decayTension ?? 0);
    return env.sustain;
  };
  if (releasedAt === null || seconds < releasedAt) return held(seconds);
  const from = held(releasedAt);
  const after = seconds - releasedAt;
  if (after >= env.release) return 0;
  return from * (1 - tensionCurve(after / env.release, env.releaseTension ?? 0));
}

/** An LFO's value (-1..1, before its amount) `seconds` into its note, at `tempo` (for sync), faded in by its delay and attack. */
export function lfoValue(lfo: Lfo, seconds: number, tempo: number): number {
  if (!lfo.enabled || seconds < lfo.delay) return 0;
  const t = seconds - lfo.delay;
  const hz = lfo.sync ? tempo / 60 / lfo.speed : lfo.speed;
  const phase = (t * hz) % 1;
  return lfoWave(lfo.shape, phase) * (lfo.attack > 0 ? Math.min(1, t / lfo.attack) : 1);
}

/** A wave at `phase` (0..1 of its cycle), -1..1: each starts at 0 rising (the square high, the saw from -1). */
export function lfoWave(shape: LfoShape, phase: number): number {
  if (shape === "sine") return Math.sin(2 * Math.PI * phase);
  if (shape === "triangle") return phase < 0.25 ? 4 * phase : phase < 0.75 ? 2 - 4 * phase : 4 * phase - 4;
  if (shape === "square") return phase < 0.5 ? 1 : -1;
  return 2 * phase - 1;
}

/** The filter's cutoff (0..1) in Hz: 20 Hz to 20 kHz, evenly by octave. */
export const cutoffHz = (x: number) => 20 * 1000 ** clamp(x, 0, 1);
/** The filter's resonance (0..1) as its Q: 0.7 (none to speak of) to about 22. */
export const resonanceQ = (x: number) => Math.SQRT1_2 * 2 ** (5 * clamp(x, 0, 1));
