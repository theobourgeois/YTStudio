/**
 * Links and custom signals (the visualizer's V3, docs/visualizer/README.md): their defaults and
 * limits, their validation (they come from storage and from the assistant), a link's maths, and the
 * edits on a video's own signals. What a signal reads at a moment is `audio-signals.ts`'s: this file is
 * pure data, so `effects.ts` and `normalize.ts` can use it without importing the sound.
 */
import { clamp, isFiniteNumber, roundTime } from "./math.ts";
import { ONSET_SCALARS, SCALARS } from "./signals/format.ts";
import type { Clip, Effect, HitShape, LinkDepth, ParamLink, Project, SignalDef, SignalEvent, SignalResponse, SignalRole, SignalSource, SignalRef, Vec2 } from "./types.ts";

/** The song's beat as hits: each beat, and each bar's first. */
export const BEAT_SIGNALS = ["beat", "downbeat"] as const;

/** Signals worked out from the sound's (`audio-signals.ts`): how much is going on (`mood.ts`). */
export const DERIVED_SIGNALS = ["intensity"] as const;

/** Every built-in signal a link can follow: the sound's own (`BUILT_IN_SIGNALS`), then the beat's. */
export const LINK_SIGNAL_NAMES: readonly string[] = [...SCALARS, ...DERIVED_SIGNALS, ...BEAT_SIGNALS];
const LINKABLE = new Set(LINK_SIGNAL_NAMES);
export const isLinkSignalName = (name: string) => LINKABLE.has(name);

/** Built-in signals that are hits (a link to one takes a `HitShape`): onsets and the beat. */
const HIT_NAMES = new Set<string>([...ONSET_SCALARS, ...BEAT_SIGNALS]);
export const isHitSignal = (name: string) => HIT_NAMES.has(name);

export const SIGNAL_ROLES: readonly SignalRole[] = ["kick", "snare", "hats", "bass", "vocal", "lead", "mix"];

/** A link's response when nothing says otherwise: straight, quick to rise, a little slower to fall. */
export const DEFAULT_RESPONSE: SignalResponse = { threshold: 0, curve: 1, attack: 0.01, release: 0.12, invert: false };
/** What a hit does when nothing says otherwise: a punch that's gone in a quarter of a second. */
export const DEFAULT_HIT: HitShape = { attack: 0.005, hold: 0, decay: 0.25 };

/** The longest a response or a hit's part can take (seconds). */
export const MAX_RESPONSE_SECONDS = 10;
export const MAX_SIGNALS = 64;
export const MAX_EVENTS = 20_000;
export const MAX_SIGNAL_NAME = 60;

/** Colours new signals take in turn. */
export const SIGNAL_COLORS = ["#f97316", "#22d3ee", "#a3e635", "#f472b6", "#facc15", "#818cf8", "#34d399", "#fb7185"];

const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const num = (v: unknown, fallback: number, min: number, max: number) => (isFiniteNumber(v) ? clamp(v, min, max) : fallback);
const seconds = (v: unknown, fallback: number) => roundTime(num(v, fallback, 0, MAX_RESPONSE_SECONDS));

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export function normalizeSource(raw: unknown): SignalSource | undefined {
  if (!isObject(raw)) return undefined;
  if (raw.kind === "master") return { kind: "master" };
  if (raw.kind === "track" && typeof raw.trackId === "string" && raw.trackId) return { kind: "track", trackId: raw.trackId };
  if (raw.kind === "clip" && typeof raw.clipId === "string" && raw.clipId) return { kind: "clip", clipId: raw.clipId };
  return undefined;
}

export function normalizeResponse(raw: unknown): SignalResponse {
  const r = isObject(raw) ? raw : {};
  return {
    threshold: num(r.threshold, DEFAULT_RESPONSE.threshold, 0, 0.99),
    curve: num(r.curve, DEFAULT_RESPONSE.curve, 0.1, 10),
    attack: seconds(r.attack, DEFAULT_RESPONSE.attack),
    release: seconds(r.release, DEFAULT_RESPONSE.release),
    invert: r.invert === true,
  };
}

export function normalizeHit(raw: unknown): HitShape | undefined {
  if (!isObject(raw)) return undefined;
  return { attack: seconds(raw.attack, DEFAULT_HIT.attack), hold: seconds(raw.hold, DEFAULT_HIT.hold), decay: seconds(raw.decay, DEFAULT_HIT.decay) };
}

export function normalizeSignalRef(raw: unknown): SignalRef | undefined {
  if (!isObject(raw)) return undefined;
  if (typeof raw.id === "string" && raw.id) return { id: raw.id };
  if (typeof raw.name !== "string" || !isLinkSignalName(raw.name)) return undefined;
  const source = normalizeSource(raw.source);
  return source && source.kind !== "master" ? { name: raw.name, source } : { name: raw.name };
}

/** A link's amount: a number, or for a point a number or a point. */
function amountOf(raw: unknown, point: boolean): number | Vec2 | undefined {
  if (isFiniteNumber(raw)) return clamp(raw, -1e6, 1e6);
  if (point && Array.isArray(raw) && raw.length === 2 && raw.every(isFiniteNumber)) return [clamp(raw[0], -1e6, 1e6), clamp(raw[1], -1e6, 1e6)];
  return undefined;
}

/** A link from storage or a tool, for a number (`point` false) or a point; undefined when it isn't one. */
export function normalizeLink(raw: unknown, point: boolean): ParamLink | undefined {
  if (!isObject(raw)) return undefined;
  const signal = normalizeSignalRef(raw.signal);
  const amount = amountOf(raw.amount, point);
  if (!signal || amount === undefined) return undefined;
  const to = amountOf(raw.to, point);
  const mode = raw.mode === "multiply" ? "multiply" : raw.mode === "map" && to !== undefined ? "map" : "add";
  const link: ParamLink = { signal, mode, amount, response: normalizeResponse(raw.response) };
  if (mode === "map") link.to = to;
  const hit = normalizeHit(raw.hit);
  if (hit) link.hit = hit;
  const depth = normalizeDepth(raw.depth);
  if (depth) link.depth = depth;
  return link;
}

/** A link's depth (`LinkDepth`), or undefined when it isn't one. */
export function normalizeDepth(raw: unknown): LinkDepth | undefined {
  if (!isObject(raw)) return undefined;
  const signal = normalizeSignalRef(raw.signal);
  if (!signal) return undefined;
  return { signal, floor: num(raw.floor, 0, 0, 1), threshold: num(raw.threshold, 0, 0, 0.99) };
}

/** How much of its amount a link with this depth moves, `level` being its signal's (0..1). */
export const depthOf = (depth: LinkDepth, level: number) => depth.floor + (1 - depth.floor) * shapeValue(level, depth.threshold, 1);

function normalizeEvents(raw: unknown): SignalEvent[] {
  const events: SignalEvent[] = [];
  for (const e of Array.isArray(raw) ? raw : []) {
    if (!isObject(e) || !isFiniteNumber(e.time) || e.time < 0) continue;
    const event: SignalEvent = { time: roundTime(e.time), velocity: num(e.velocity, 1, 0, 1) };
    if (isFiniteNumber(e.length) && e.length > 0) event.length = roundTime(Math.min(e.length, 3600));
    if (isFiniteNumber(e.key)) event.key = clamp(Math.round(e.key), 0, 127);
    events.push(event);
    if (events.length >= MAX_EVENTS) break;
  }
  return events.sort((a, b) => a.time - b.time);
}

/** A band signal's settings when nothing says otherwise (relative to its sound's loud parts: auto-gain). */
export const BAND_DEFAULTS = { gain: 0, threshold: 0, attack: 0.005, release: 0.1, curve: 1, autoGain: true, onsets: false };

/** One custom signal, or undefined when it isn't one. Its name is checked against others by `normalizeSignalDefs`. */
export function normalizeSignalDef(raw: unknown, index = 0): SignalDef | undefined {
  if (!isObject(raw) || typeof raw.id !== "string" || !raw.id) return undefined;
  const name = typeof raw.name === "string" && raw.name.trim() ? raw.name.trim().slice(0, MAX_SIGNAL_NAME) : `Signal ${index + 1}`;
  const color = typeof raw.color === "string" && /^#[0-9a-f]{6}$/i.test(raw.color) ? raw.color.toLowerCase() : SIGNAL_COLORS[index % SIGNAL_COLORS.length];
  const base = { id: raw.id, name, color, ...(SIGNAL_ROLES.includes(raw.role as SignalRole) && { role: raw.role as SignalRole }) };
  if (raw.kind === "band") {
    const a = num(raw.low, 40, 20, 20_000);
    const b = num(raw.high, 120, 20, 20_000);
    const [low, high] = [Math.min(a, b), Math.max(a, b, Math.min(a, b) * 1.01)];
    return {
      ...base,
      kind: "band",
      source: normalizeSource(raw.source) ?? { kind: "master" },
      low: Math.round(low),
      high: Math.round(Math.min(20_000, high)),
      gain: num(raw.gain, BAND_DEFAULTS.gain, -24, 24),
      threshold: num(raw.threshold, BAND_DEFAULTS.threshold, 0, 0.99),
      attack: seconds(raw.attack, BAND_DEFAULTS.attack),
      release: seconds(raw.release, BAND_DEFAULTS.release),
      curve: num(raw.curve, BAND_DEFAULTS.curve, 0.1, 10),
      autoGain: raw.autoGain !== false,
      onsets: raw.onsets === true,
    };
  }
  if (raw.kind === "events") return { ...base, kind: "events", events: normalizeEvents(raw.events) };
  if (raw.kind === "curve") {
    const points = (Array.isArray(raw.points) ? raw.points : [])
      .filter((p): p is { time: number; value: number } => isObject(p) && isFiniteNumber(p.time) && p.time >= 0 && isFiniteNumber(p.value))
      .slice(0, MAX_EVENTS)
      .map((p) => ({ time: roundTime(p.time), value: clamp(p.value, 0, 1) }))
      .sort((a, b) => a.time - b.time);
    return { ...base, kind: "curve", points };
  }
  return undefined;
}

/** A name not taken (case aside) by `taken`: "Kick", else "Kick 2"... */
export function uniqueSignalName(name: string, taken: Iterable<string>): string {
  const used = new Set([...taken].map((n) => n.toLowerCase()));
  if (!used.has(name.toLowerCase())) return name;
  for (let n = 2; ; n++) if (!used.has(`${name} ${n}`.toLowerCase())) return `${name} ${n}`;
}

/** A video's signals from storage: valid ones, ids and names unique. */
export function normalizeSignalDefs(raw: unknown): SignalDef[] {
  const out: SignalDef[] = [];
  const ids = new Set<string>();
  for (const item of Array.isArray(raw) ? raw : []) {
    const def = normalizeSignalDef(item, out.length);
    if (!def || ids.has(def.id)) continue;
    ids.add(def.id);
    out.push({ ...def, name: uniqueSignalName(def.name, out.map((d) => d.name)) });
    if (out.length >= MAX_SIGNALS) break;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Maths
// ---------------------------------------------------------------------------

/** A 0..1 value through a response's threshold and curve (its attack and release are the series'). */
export function shapeValue(x: number, threshold: number, curve: number): number {
  const above = threshold > 0 ? (x - threshold) / (1 - threshold) : x;
  if (!(above > 0)) return 0;
  return curve === 1 ? Math.min(1, above) : Math.min(1, above) ** curve;
}

/** One step of a follower that rises in `attack` and falls in `release` seconds (time constants), `dt` later. */
export function follow(previous: number, x: number, attack: number, release: number, dt: number): number {
  const tau = x > previous ? attack : release;
  return tau <= 0 ? x : previous + (x - previous) * (1 - Math.exp(-dt / tau));
}

/** How high a hit is `since` seconds after it (0..1, before its velocity). */
export function hitLevel(since: number, shape: HitShape): number {
  if (since < 0) return 0;
  if (since < shape.attack) return since / shape.attack;
  const after = since - shape.attack - shape.hold;
  if (after <= 0) return 1;
  return shape.decay > 0 && after < shape.decay ? 1 - after / shape.decay : 0;
}

/** How long a hit's shape lasts. */
export const hitSpan = (shape: HitShape) => shape.attack + shape.hold + shape.decay;

const component = (amount: number | Vec2, i: number) => (typeof amount === "number" ? amount : amount[i] ?? 0);

/** A parameter's value moved by a link whose signal reads `s` (0..1, after its response). */
export function applyLink<T extends number | number[]>(value: T, link: ParamLink, s: number): T {
  const one = (v: number, i: number) => {
    const amount = component(link.amount, i);
    if (link.mode === "multiply") return v * (1 + amount * s);
    if (link.mode === "map") return v + (component(link.to ?? v, i) - v) * s;
    return v + amount * s;
  };
  return (typeof value === "number" ? one(value, 0) : value.map(one)) as T;
}

// ---------------------------------------------------------------------------
// Edits (the same project when nothing changes)
// ---------------------------------------------------------------------------

const sameJson = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** Add a custom signal, or replace the one with its id. Its name is made unique among the others. */
export function defineSignal(project: Project, raw: SignalDef): Project {
  const list = project.signals ?? [];
  const i = list.findIndex((d) => d.id === raw.id);
  if (i < 0 && list.length >= MAX_SIGNALS) return project;
  const def = normalizeSignalDef(raw, i < 0 ? list.length : i);
  if (!def) return project;
  const named = { ...def, name: uniqueSignalName(def.name, list.filter((d) => d.id !== def.id).map((d) => d.name)) };
  if (i >= 0 && sameJson(list[i], named)) return project;
  const signals = i < 0 ? [...list, named] : list.map((d, k) => (k === i ? named : d));
  return { ...project, signals };
}

/** Rewrite every effect of every clip (all sequences) that `update` changes. */
function mapEffects(project: Project, update: (effect: Effect, clip: Clip) => Effect): Project {
  const mapClips = (clips: Clip[]) => {
    let changed = false;
    const next = clips.map((clip) => {
      let clipChanged = false;
      const effects = clip.effects.map((e) => {
        const n = update(e, clip);
        if (n !== e) clipChanged = true;
        return n;
      });
      if (!clipChanged) return clip;
      changed = true;
      return { ...clip, effects };
    });
    return changed ? next : clips;
  };
  const clips = mapClips(project.clips);
  let sequencesChanged = false;
  const sequences = project.sequences?.map((s) => {
    const c = mapClips(s.clips);
    if (c === s.clips) return s;
    sequencesChanged = true;
    return { ...s, clips: c };
  });
  if (clips === project.clips && !sequencesChanged) return project;
  return { ...project, clips, ...(sequences && { sequences }) };
}

/** Delete a custom signal, and every link to it. */
export function deleteSignal(project: Project, id: string): Project {
  if (!project.signals?.some((d) => d.id === id)) return project;
  const signals = project.signals.filter((d) => d.id !== id);
  const next = mapEffects(project, (effect) => {
    if (!effect.links || !Object.values(effect.links).some((l) => "id" in l.signal && l.signal.id === id)) return effect;
    const links = Object.fromEntries(Object.entries(effect.links).filter(([, l]) => !("id" in l.signal && l.signal.id === id)));
    const { links: _, ...rest } = effect;
    return Object.keys(links).length ? { ...rest, links } : rest;
  });
  const out: Project = { ...next, signals };
  if (!signals.length) delete out.signals;
  return out;
}

/** Replace an events signal's hits. */
export function setSignalEvents(project: Project, id: string, events: SignalEvent[]): Project {
  const def = project.signals?.find((d) => d.id === id);
  if (!def || def.kind !== "events") return project;
  return defineSignal(project, { ...def, events });
}

/** A custom signal by id, or by name (case aside). */
export function findSignal(project: Pick<Project, "signals">, idOrName: string): SignalDef | undefined {
  const list = project.signals ?? [];
  const lower = idOrName.toLowerCase();
  return list.find((d) => d.id === idOrName) ?? list.find((d) => d.name.toLowerCase() === lower);
}
