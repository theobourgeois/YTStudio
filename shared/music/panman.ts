/**
 * PanMan (`docs/soundtoys/panman.md`): what its patterns are, its edits, and what the engine is sent.
 *
 * A position is -1 (the left of its range: Offset - Width / 2) to 1 (the right), turned into degrees by
 * `panDegrees`. The pattern modes (LFO, Rhythm Step, Rhythm Shape) are a function of where the pattern is
 * (`panPattern`): decided here, drawn by the window from it, and sent to the engine as straight lines.
 * Random and the trigger modes are the engine's to play (they hang on the sound and on chance), with the
 * rules written down in the doc.
 */
import { clamp } from "../math.ts";
import { findEffect } from "./automation.ts";
import {
  MAX_PAN_BARS,
  MAX_PAN_BEATS_PER_BAR,
  PANMAN_PRESETS,
  PAN_FEEL_TICKS,
  PAN_LIMIT,
  normalizePanMan,
  normalizeShapeEvents,
  normalizeStepPoints,
  panPreset,
  panRhythm,
  patternTicks,
} from "./panman-presets.ts";
import { sampleLane } from "./sampling.ts";
import { type MusicProject, type PanCurve, type PanDirection, type PanMan, type PanManMode, type PanShapeEvent, type PanStepPoint, type PanStyle, PPQ } from "./types.ts";

// ---------------------------------------------------------------------------
// Shapes
// ---------------------------------------------------------------------------

/** The Smoothing Mode's curves: how far (0..1) a move from one point to the next is at `x` (0..1) of its time. */
export function panCurve(curve: PanCurve, x: number): number {
  const t = clamp(x, 0, 1);
  switch (curve) {
    case "linear":
      return t;
    case "sine":
      return (1 - Math.cos(Math.PI * t)) / 2;
    case "exp":
      // Quickly at first, then levelling off.
      return (1 - Math.exp(-5 * t)) / (1 - Math.exp(-5));
    case "rev":
      // Slowly at first, then faster and faster.
      return (Math.exp(5 * t) - 1) / (Math.exp(5) - 1);
    case "sym":
      // An even S, steeper in the middle than a sine's.
      return t * t * t * (t * (t * 6 - 15) + 10);
  }
}

/**
 * One cycle of a direction's shape at `p` (0..1 of it), smoothed by `smoothing` (0..1). A ramp (right to
 * left, or left to right) goes across in a straight line and snaps back: Smoothing gives the snap-back up
 * to half the cycle, in a sine's shape. Back and forth is a triangle from the left, rounded into a sine.
 */
export function cycleValue(direction: PanDirection, smoothing: number, p: number): number {
  const s = clamp(smoothing, 0, 1);
  const x = p - Math.floor(p);
  if (direction === "both") {
    const triangle = x < 0.5 ? -1 + 4 * x : 3 - 4 * x;
    return (1 - s) * triangle + s * -Math.cos(2 * Math.PI * x);
  }
  const back = s / 2;
  const down = x < 1 - back ? 1 - (2 * x) / (1 - back) : -1 + 2 * panCurve("sine", (x - (1 - back)) / back);
  return direction === "down" ? down : -down;
}

/** The positions the knobs make in Rhythm Step: `steps` of them across the width, in the direction's order (back and forth: there and back). */
export function generatedSteps(direction: PanDirection, steps: number): number[] {
  const n = Math.max(2, Math.round(steps));
  const across = Array.from({ length: n }, (_, k) => -1 + (2 * k) / (n - 1));
  if (direction === "up") return across;
  if (direction === "down") return across.reverse();
  return [...across, ...across.slice(1, -1).reverse()];
}

/**
 * A step pattern's position at `tick` (it repeats every `length` ticks): each point's value, held, and the
 * move into the next taking the last `smoothing` of the time between them, in `curve`'s shape (Hard: a
 * jump on the point).
 */
export function stepValue(points: readonly PanStepPoint[], length: number, smoothing: number, curve: PanCurve, tick: number): number {
  const n = points.length;
  if (!n) return 0;
  if (n === 1) return points[0].value;
  const t = tick - Math.floor(tick / length) * length;
  // The last point at or before `t` (before the first: the last, a pattern back).
  let i = n - 1;
  for (let k = 0; k < n; k++) if (points[k].tick <= t) i = k;
  const from = points[i];
  const fromTick = from.tick <= t ? from.tick : from.tick - length;
  const next = points[(i + 1) % n];
  const nextTick = next.tick > fromTick ? next.tick : next.tick + length;
  const glide = clamp(smoothing, 0, 1) * (nextTick - fromTick);
  const start = nextTick - glide;
  if (t < start || glide <= 0) return from.value;
  return from.value + (next.value - from.value) * panCurve(curve, (t - start) / glide);
}

/** The events' shape at `tick` (inside one: its cycle; between them: where a cycle starts; none at all: the centre). */
export function shapeValue(events: readonly PanShapeEvent[], direction: PanDirection, smoothing: number, tick: number): number {
  if (!events.length) return 0;
  for (const event of events) if (tick >= event.tick && tick < event.tick + event.length) return cycleValue(direction, smoothing, (tick - event.tick) / event.length);
  return cycleValue(direction, smoothing, 0);
}

/**
 * Groove: every second rhythm event moved later (Swing, `groove` > 0) or earlier (Shuffle), at the ends to
 * a triplet. Where a tick of the grooved pattern is in the straight one: each pair of events (`rhythm`
 * ticks each) has its middle moved to `rhythm × (1 + groove / 3)`.
 */
export function ungroove(tick: number, rhythm: number, groove: number): number {
  if (!groove || rhythm <= 0) return tick;
  const pair = 2 * rhythm;
  const start = Math.floor(tick / pair) * pair;
  const into = tick - start;
  const middle = rhythm * (1 + clamp(groove, -1, 1) / 3);
  return start + (into < middle ? (into * rhythm) / middle : rhythm + ((into - middle) * rhythm) / (pair - middle));
}

/** A pattern the engine plays: its length (ticks; LFO: a cycle is `PPQ`), its position at a tick of it, and where it may jump. */
export interface PanPattern {
  length: number;
  value: (tick: number) => number;
  breaks: number[];
}

/** The modes whose movement is a pattern (rather than chance or the sound's hits). */
export const isPatternMode = (mode: PanManMode) => mode === "lfo" || mode === "rhythmStep" || mode === "rhythmShape";
/** The modes moved by triggers. */
export const isTriggerMode = (mode: PanManMode) => mode === "pingPong" || mode === "step";
/** The modes in time with a rhythm (and so with Tap Tempo and the MIDI switch). */
export const isRhythmMode = (mode: PanManMode) => mode === "rhythmStep" || mode === "rhythmShape" || mode === "random";

/** The Rhythm Step pattern the knobs make: the steps a rhythm apart, from the start. */
export function generatedStepPattern(pm: Pick<PanMan, "direction" | "steps" | "rhythm">): { length: number; points: PanStepPoint[] } {
  const step = panRhythm(pm.rhythm).beats * PPQ;
  const values = generatedSteps(pm.direction, pm.steps);
  return { length: values.length * step, points: values.map((value, k) => ({ tick: k * step, value })) };
}

/** The Rhythm Shape events the knobs make: two a rhythm long (a pair, for Groove). */
export function generatedShapePattern(pm: Pick<PanMan, "rhythm">): { length: number; events: PanShapeEvent[] } {
  const length = panRhythm(pm.rhythm).beats * PPQ;
  return { length: 2 * length, events: [{ tick: 0, length }, { tick: length, length }] };
}

/** What the Rhythm Step Editor shows: its own points, or (not custom) the knobs' pattern repeated across its bars. */
export function editorSteps(pm: PanMan): PanStepPoint[] {
  if (pm.custom) return pm.stepPattern.points;
  const { length, points } = generatedStepPattern(pm);
  const end = patternTicks(pm.stepPattern);
  const shown: PanStepPoint[] = [];
  for (let at = 0; at < end && shown.length < 4096; at += length) for (const p of points) if (at + p.tick < end - 1e-9) shown.push({ tick: at + p.tick, value: p.value });
  return shown;
}

/** What the Rhythm Editor shows: its own events, or (not custom) one a rhythm long after another across its bars. */
export function editorEvents(pm: PanMan): PanShapeEvent[] {
  if (pm.custom) return pm.shapePattern.events;
  const step = panRhythm(pm.rhythm).beats * PPQ;
  const end = patternTicks(pm.shapePattern);
  const shown: PanShapeEvent[] = [];
  for (let at = 0; at < end - 1e-9 && shown.length < 4096; at += step) shown.push({ tick: at, length: Math.min(step, end - at) });
  return shown;
}

/** A pattern mode's pattern (`PanPattern`), or null for Random and the trigger modes. */
export function panPattern(pm: PanMan): PanPattern | null {
  const s = pm.smoothing;
  if (pm.mode === "lfo") return { length: PPQ, value: (tick) => cycleValue(pm.direction, s, tick / PPQ), breaks: [] };
  if (pm.mode === "rhythmStep") {
    const { length, points } = pm.custom ? { length: patternTicks(pm.stepPattern), points: pm.stepPattern.points } : generatedStepPattern(pm);
    const curve = pm.stepPattern.curve;
    // Feel moves the whole pattern, what passes an end wrapping round.
    const shift = pm.feel * PAN_FEEL_TICKS;
    const wrap = (t: number) => t - Math.floor(t / length) * length;
    return {
      length,
      value: (tick) => stepValue(points, length, s, curve, tick - shift),
      breaks: s > 0 ? [] : points.map((p) => wrap(p.tick + shift)).sort((a, b) => a - b),
    };
  }
  if (pm.mode === "rhythmShape") {
    const { length, events } = pm.custom ? { length: patternTicks(pm.shapePattern), events: pm.shapePattern.events } : generatedShapePattern(pm);
    const rhythm = panRhythm(pm.rhythm).beats * PPQ;
    const regroove = (tick: number) => {
      // The inverse of `ungroove`, for where an event's edges land.
      if (!pm.groove) return tick;
      const pair = 2 * rhythm;
      const start = Math.floor(tick / pair) * pair;
      const into = tick - start;
      const middle = rhythm * (1 + pm.groove / 3);
      return start + (into < rhythm ? (into * middle) / rhythm : middle + ((into - rhythm) * (pair - middle)) / rhythm);
    };
    const edges = new Set<number>();
    for (const e of events) {
      edges.add(regroove(e.tick));
      edges.add(regroove(e.tick + e.length));
    }
    return {
      length,
      value: (tick) => shapeValue(events, pm.direction, s, ungroove(tick, rhythm, pm.groove)),
      breaks: [...edges].filter((t) => t > 0 && t < length).sort((a, b) => a - b),
    };
  }
  return null;
}

/** Degrees for a position (-1..1) around the offset over the width, held to ±105 (`docs/soundtoys/panman.md`). */
export const panDegrees = (offset: number, width: number, position: number) => clamp(offset + (position * width) / 2, -PAN_LIMIT, PAN_LIMIT);

/**
 * The pan law (as the engine has it): sine / cosine over the angle, carried past ±90° (the far side's gain
 * turns negative), scaled by √2 so the centre is unity and the power is the same everywhere. [left, right].
 */
export function panGains(degrees: number): [number, number] {
  const angle = ((clamp(degrees, -PAN_LIMIT, PAN_LIMIT) + 90) / 180) * (Math.PI / 2);
  return [Math.SQRT2 * Math.cos(angle), Math.SQRT2 * Math.sin(angle)];
}

// ---------------------------------------------------------------------------
// Edits
// ---------------------------------------------------------------------------

/** The PanMan an effect id names, and where it is. */
export function findPanMan(song: MusicProject, effectId: string) {
  const found = findEffect(song, effectId);
  if (!found?.effect?.panMan) return null;
  return { track: found.track, slot: found.track.effects.indexOf(found.effect), effect: found.effect, panMan: found.effect.panMan };
}

/** Every PanMan in the song, in the mixer's order. */
export function panMans(song: MusicProject) {
  return song.mixer.tracks.flatMap((track) => track.effects.flatMap((effect, slot) => (effect?.panMan ? [{ track, slot, effect, panMan: effect.panMan }] : [])));
}

const same = (a: PanMan, b: PanMan) => JSON.stringify(a) === JSON.stringify(b);

/** Change a PanMan's settings (validated as a song's are). The same song when nothing changes. */
export function editPanMan(song: MusicProject, effectId: string, change: (pm: PanMan) => PanMan): MusicProject {
  const found = findPanMan(song, effectId);
  if (!found) return song;
  const changed = change(found.panMan);
  if (changed === found.panMan) return song;
  const next = normalizePanMan(changed);
  if (same(next, found.panMan)) return song;
  const effects = found.track.effects.map((e) => (e === found.effect ? { ...e, panMan: next } : e));
  return { ...song, mixer: { ...song.mixer, tracks: song.mixer.tracks.map((t) => (t === found.track ? { ...t, effects } : t)) } };
}

export type PanManPatch = Partial<Omit<PanMan, "stepPattern" | "shapePattern">> & {
  stepPattern?: Partial<PanMan["stepPattern"]>;
  shapePattern?: Partial<PanMan["shapePattern"]>;
};

/** Set some of a PanMan's settings (each held to its range). */
export function updatePanMan(song: MusicProject, effectId: string, patch: PanManPatch): MusicProject {
  return editPanMan(song, effectId, (pm) => ({
    ...pm,
    ...patch,
    stepPattern: { ...pm.stepPattern, ...patch.stepPattern },
    shapePattern: { ...pm.shapePattern, ...patch.shapePattern },
  }));
}

/** Load a factory preset (by name): all its settings, the editors' patterns too. */
export function loadPanPreset(song: MusicProject, effectId: string, name: string): MusicProject {
  const found = panPreset(name);
  return found ? editPanMan(song, effectId, () => found.settings) : song;
}

/** Whether a PanMan's settings differ from its preset's (the preset bar's Revert lights up). */
export function panEdited(pm: PanMan): boolean {
  const found = panPreset(pm.preset);
  return !found || !same(found.settings, pm);
}

/** The preset before or after the PanMan's (‹ ›), round the list. */
export function adjacentPreset(pm: PanMan, step: 1 | -1): string {
  const index = PANMAN_PRESETS.findIndex((p) => p.name === pm.preset);
  const n = PANMAN_PRESETS.length;
  return PANMAN_PRESETS[(((index < 0 ? (step > 0 ? -1 : 0) : index) + step) % n + n) % n].name;
}

/**
 * Edit the Rhythm Step Editor's points: from what it shows (the knobs' pattern, the first time), made the
 * PanMan's own (custom: Direction and Steps then do nothing, as the manual says).
 */
export function editStepPoints(song: MusicProject, effectId: string, change: (points: PanStepPoint[]) => PanStepPoint[]): MusicProject {
  return editPanMan(song, effectId, (pm) => {
    const shown = editorSteps(pm);
    const points = change(shown);
    if (points === shown) return pm;
    return { ...pm, custom: true, stepPattern: { ...pm.stepPattern, points: normalizeStepPoints(points, patternTicks(pm.stepPattern)) } };
  });
}

/** Edit the Rhythm Editor's events likewise. */
export function editShapeEvents(song: MusicProject, effectId: string, change: (events: PanShapeEvent[]) => PanShapeEvent[]): MusicProject {
  return editPanMan(song, effectId, (pm) => {
    const shown = editorEvents(pm);
    const events = change(shown);
    if (events === shown) return pm;
    return { ...pm, custom: true, shapePattern: { ...pm.shapePattern, events: normalizeShapeEvents(events, patternTicks(pm.shapePattern)) } };
  });
}

/** A point added at `tick` (on a tick no other point has; else the points as they were). */
export function addStepPoint(points: readonly PanStepPoint[], tick: number, value: number): PanStepPoint[] {
  const at = Math.round(tick);
  if (points.some((p) => p.tick === at)) return points as PanStepPoint[];
  return [...points, { tick: at, value: clamp(value, -1, 1) }].sort((a, b) => a.tick - b.tick);
}

/** A point moved (two can't share a tick: dropped on another, it stays where it was). */
export function moveStepPoint(points: readonly PanStepPoint[], index: number, tick: number, value: number): PanStepPoint[] {
  const at = Math.round(tick);
  if (!points[index] || points.some((p, i) => i !== index && p.tick === at)) return points as PanStepPoint[];
  return points.map((p, i) => (i === index ? { tick: at, value: clamp(value, -1, 1) } : p)).sort((a, b) => a.tick - b.tick);
}

export const deleteStepPoint = (points: readonly PanStepPoint[], index: number): PanStepPoint[] => points.filter((_, i) => i !== index);

/** An event added at `tick`, `length` long (no further than the next one; none inside another). */
export function addShapeEvent(events: readonly PanShapeEvent[], tick: number, length: number): PanShapeEvent[] {
  const at = Math.round(tick);
  if (events.some((e) => at >= e.tick && at < e.tick + e.length)) return events as PanShapeEvent[];
  const next = events.find((e) => e.tick > at);
  const fits = Math.max(1, Math.min(Math.round(length), next ? next.tick - at : Infinity));
  return [...events, { tick: at, length: fits }].sort((a, b) => a.tick - b.tick);
}

export const deleteShapeEvent = (events: readonly PanShapeEvent[], index: number): PanShapeEvent[] => events.filter((_, i) => i !== index);

/**
 * An event's start and end set (a resize from either side, or a move), held between its neighbours and
 * inside the pattern, at least a tick long.
 */
export function setShapeEvent(events: readonly PanShapeEvent[], index: number, start: number, end: number, length: number): PanShapeEvent[] {
  const event = events[index];
  if (!event) return events as PanShapeEvent[];
  const before = index > 0 ? events[index - 1].tick + events[index - 1].length : 0;
  const after = index + 1 < events.length ? events[index + 1].tick : length;
  const from = clamp(Math.round(start), before, after - 1);
  const to = clamp(Math.round(end), from + 1, after);
  if (from === event.tick && to - from === event.length) return events as PanShapeEvent[];
  return events.map((e, i) => (i === index ? { tick: from, length: to - from } : e));
}

/** An editor's bars and beats in a bar changed (its points or events past its new end go). */
export function setPatternLayout(song: MusicProject, effectId: string, editor: "step" | "shape", layout: { bars?: number; beatsPerBar?: number }): MusicProject {
  const fit = (v: number | undefined, was: number, max: number) => (v !== undefined && Number.isFinite(v) ? clamp(Math.round(v), 1, max) : was);
  return editPanMan(song, effectId, (pm) => {
    const key = editor === "step" ? "stepPattern" : "shapePattern";
    const was = pm[key];
    const bars = fit(layout.bars, was.bars, MAX_PAN_BARS);
    const beatsPerBar = fit(layout.beatsPerBar, was.beatsPerBar, MAX_PAN_BEATS_PER_BAR);
    return { ...pm, [key]: { ...was, bars, beatsPerBar } };
  });
}

// ---------------------------------------------------------------------------
// What the engine plays
// ---------------------------------------------------------------------------

/** PanMan as the engine plays it (`engine/src/PanMan.cpp`): its settings in the engine's units, and its pattern as lines. */
export interface EnginePanMan {
  mode: PanManMode;
  /** Degrees. */
  offset: number;
  width: number;
  smoothing: number;
  /** The LFO's Hz. */
  rate: number;
  /**
   * The pattern modes' pattern: its length in beats (the LFO's: one cycle, 1) and its position (-1..1) as
   * straight lines over it (`at`: 0..1 of the pattern; two points at one place are a jump). Null in the
   * other modes.
   */
  beats: number;
  shape: { at: number[]; values: number[] } | null;
  /** Random: a new position every this many beats. */
  stepBeats: number;
  /** In time with the song; else at `tempo` BPM from when play starts. */
  sync: boolean;
  tempo: number;
  /** Chance's seed (from the effect's id): Random's and Step's positions are the same every time. */
  seed: number;
  /** dB (0: no triggering from the sound), triggers to a move, the trigger's filter (Hz, dB) and Monitor. */
  trigger: number;
  divider: number;
  filter: "hpf" | "off" | "lpf";
  cutoff: number;
  filterGain: number;
  monitor: boolean;
  /** The dynamics, if this mode has them: threshold (dB), attack and release (s), Gate, and the mods (degrees, degrees, octaves). */
  dynamics: boolean;
  threshold: number;
  attack: number;
  release: number;
  gate: boolean;
  offsetMod: number;
  widthMod: number;
  rateMod: number;
  style: PanStyle;
  /** dB. */
  input: number;
  output: number;
}

/** A 32-bit seed from an id (FNV-1a): chance that's the same every time for the same effect. */
export function panSeed(id: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < id.length; i++) {
    hash ^= id.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** How close the lines keep to the pattern: a 1000th of the width (a fifth of a degree at full width). */
const SHAPE_TOLERANCE = 2e-3;

export function enginePanMan(pm: PanMan, effectId: string): EnginePanMan {
  const pattern = isPatternMode(pm.mode) ? panPattern(pm) : null;
  // A pattern sampled finely enough for its curves (an LFO's sine, a smoothed step), its jumps exact.
  const shape = pattern ? sampleLane((tick) => [pattern.value(tick)], pattern.breaks, 0, pattern.length, Math.min(PPQ / 4, pattern.length / 16), SHAPE_TOLERANCE) : null;
  return {
    mode: pm.mode,
    offset: pm.offset,
    width: pm.width,
    smoothing: pm.smoothing,
    rate: pm.rate,
    beats: pattern ? pattern.length / PPQ : 1,
    shape: shape && pattern && { at: shape.ticks.map((t) => t / pattern.length), values: shape.values },
    stepBeats: panRhythm(pm.rhythm).beats,
    sync: pm.sync,
    tempo: pm.tempo,
    seed: panSeed(effectId),
    trigger: pm.trigger,
    divider: pm.divider,
    filter: pm.filter,
    cutoff: pm.cutoff,
    filterGain: pm.filterGain,
    monitor: pm.monitor,
    dynamics: isPatternMode(pm.mode),
    threshold: pm.threshold,
    attack: pm.attack,
    release: pm.release,
    gate: pm.gate,
    offsetMod: pm.offsetMod,
    widthMod: pm.widthMod,
    rateMod: pm.rateMod,
    style: pm.style,
    input: pm.input,
    output: pm.output,
  };
}
