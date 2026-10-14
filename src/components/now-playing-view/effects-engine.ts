/**
 * The effects the player plays over the looks by itself (the "Effects" menu, docs/now-playing.md): the frame
 * (repeat, mirror, turn, zoom) and vaudio's distortions and feedback, chosen by the music, landing on its beats.
 *
 * - **Following the music**: calm, something gentle every 4 bars, eased over a bar (a mirror fold, a slow warp, soft
 *   trails); a groove, mirrored copies, swirls, ripples, a kaleidoscope every 4 bars, mutated after 2; intense, more
 *   copies, a feedback tunnel, pixels, a lens, a quick turn every 2 bars, mutated on the bar between. A build-up tightens bar by bar (more copies, more kaleidoscope,
 *   zooming in); a drop is clean on its cut (the look's impact), then goes hard a bar on; a breakdown washes back to
 *   gentle.
 * - **Every bar**: a new set on each downbeat. **Every beat**: a new set on each downbeat, and on each beat between a
 *   mutation of it (a mirror on or off, a copy more or fewer, a zoom, the turn reversed).
 * - **By hand**: none (the panel, the keys).
 *
 * A chaos look has a world of its own, so it's played frames and light distortions only (no more feedback on its
 * own); a look that's a thing in the middle of black (a spectrum, chaos) isn't zoomed out or copied past 2×2 (it'd be
 * specks in the dark). Before the music's downbeats are known, bars are counted in beats. Every change says why. Pure
 * (its random given), and tested.
 */
import { type Frame, type LiveFx, type LiveLook, NO_FX, PLAIN_FRAME } from "@shared/live-looks";
import type { Mood } from "@shared/signals/mood";

/** How the effects change by themselves: following the music, every beat, every bar, or by hand. */
export type EffectsMode = "music" | "beat" | "bar" | "hand";

export const EFFECTS_MODES: { id: EffectsMode; label: string }[] = [
  { id: "music", label: "Follow the music" },
  { id: "beat", label: "Every beat" },
  { id: "bar", label: "Every bar" },
  { id: "hand", label: "By hand" },
];

/** The frame and the distortions and feedback over the looks. */
export interface Effects {
  frame: Frame;
  fx: LiveFx;
}

export const PLAIN_EFFECTS: Effects = { frame: PLAIN_FRAME, fx: NO_FX };

export interface EffectsChange {
  effects: Effects;
  /** When it lands (session seconds: on a beat or a downbeat), and over how long it eases there. */
  at: number;
  seconds: number;
  /** Turned back upright as it goes. */
  upright?: boolean;
  /** Said in the log and the readout; `often` changes (every beat) only at debug. */
  why: string;
  often?: boolean;
}

/**
 * What the engine goes by: the time, what's heard, a beat's length, the next beat and downbeat (null: no downbeat
 * known yet), the latest drop, the look.
 */
export interface Pulse {
  time: number;
  mood: Mood;
  beat: number;
  nextBeat: number;
  nextBar: number | null;
  drop?: number;
  look: LiveLook | null;
}

type Tier = "calm" | "groove" | "intense";

/** How much is going on: calm (or a chill song), a groove, intense. */
export function tierOf(mood: Pick<Mood, "intensity" | "character" | "sure">): Tier {
  if (mood.intensity < 0.35 || (mood.character === "chill" && mood.sure >= 0.4 && mood.intensity < 0.7)) return "calm";
  return mood.intensity < 0.7 ? "groove" : "intense";
}

/** Feedback the engine never goes past: a look's own brightness on top of more whitens it out. */
export const MOST_FEEDBACK = 0.8;
/** Bars between new sets following the music, and between their mutations (none for calm). */
const EVERY_BARS: Record<Tier, number> = { calm: 4, groove: 4, intense: 2 };
const MUTATE_BARS: Record<Tier, number> = { calm: Infinity, groove: 2, intense: 1 };

/** A look that's a thing in the middle of black: zoomed out or copied much, it's specks in the dark. */
const sparse = (look: LiveLook | null) => look?.kind === "spectrum" || look?.kind === "chaos";
/** A change is decided this early (seconds), so it's ready when its beat lands. */
const LEAD = 0.08;

const rand = (r: () => number, a: number, b: number) => Math.round((a + (b - a) * r()) * 100) / 100;
const side = (r: () => number) => (r() < 0.5 ? 1 : -1);

/** A move: some of a set (frame and values), and its name for the log. */
interface Move {
  name: string;
  /** Feedback of its own: not on a chaos look (it has a world of its own). */
  feeds?: true;
  make(r: () => number): { frame?: Partial<Frame>; fx?: Partial<LiveFx> };
}

const MOVES: Record<Tier, Move[]> = {
  calm: [
    { name: "a mirror fold", make: (r) => ({ fx: { fold: rand(r, 0.3, 0.55) } }) },
    { name: "a slow warp", make: (r) => ({ fx: { warp: rand(r, 0.15, 0.3) } }) },
    { name: "a slow turn", make: (r) => ({ frame: { spin: 6 * side(r) } }) },
    { name: "soft trails", feeds: true, make: (r) => ({ fx: { feedback: rand(r, 0.4, 0.6), trails: 0.75, echoZoom: rand(r, 0.05, 0.15) } }) },
    { name: "a soft kaleidoscope", make: (r) => ({ fx: { kaleido: rand(r, 0.2, 0.35) } }) },
    { name: "mirrored", make: () => ({ frame: { mirror: true } }) },
  ],
  groove: [
    { name: "mirrored copies", make: () => ({ frame: { repeat: 2, mirror: true } }) },
    { name: "a swirl", make: (r) => ({ fx: { swirl: rand(r, 0.3, 0.5) } }) },
    { name: "ripples", make: (r) => ({ fx: { ripple: rand(r, 0.25, 0.45) } }) },
    { name: "a kaleidoscope", make: (r) => ({ fx: { kaleido: rand(r, 0.35, 0.55) } }) },
    { name: "a tunnel", feeds: true, make: (r) => ({ fx: { feedback: rand(r, 0.55, 0.7), echoZoom: rand(r, 0.15, 0.3), trails: 0.8 } }) },
    { name: "a warp", make: (r) => ({ fx: { warp: rand(r, 0.3, 0.5) } }) },
    { name: "zoomed out, mirrored", make: () => ({ frame: { zoom: 0.8, mirror: true } }) },
    { name: "a turning echo", feeds: true, make: (r) => ({ fx: { feedback: rand(r, 0.5, 0.65), echoSpin: rand(r, 0.1, 0.2) * side(r) } }) },
  ],
  intense: [
    { name: "copies", make: (r) => ({ frame: { repeat: r() < 0.5 ? 2 : 3, mirror: r() < 0.5 } }) },
    { name: "a tunnel", feeds: true, make: (r) => ({ fx: { feedback: rand(r, 0.65, MOST_FEEDBACK), echoZoom: rand(r, 0.25, 0.45), trails: 0.85 } }) },
    { name: "a kaleidoscope", make: (r) => ({ fx: { kaleido: rand(r, 0.5, 0.8) } }) },
    { name: "a swirl", make: (r) => ({ fx: { swirl: rand(r, 0.5, 0.8) } }) },
    { name: "pixels", make: (r) => ({ fx: { pixelate: rand(r, 0.2, 0.4) } }) },
    { name: "a lens", make: (r) => ({ fx: { lens: rand(r, 0.3, 0.5) * side(r) } }) },
    { name: "a quick turn", make: (r) => ({ frame: { spin: (r() < 0.5 ? 20 : 45) * side(r), zoom: 0.85, mirror: true } }) },
    { name: "a warp", make: (r) => ({ fx: { warp: rand(r, 0.45, 0.7) } }) },
    { name: "a colour echo", feeds: true, make: (r) => ({ fx: { feedback: rand(r, 0.6, 0.75), echoHue: rand(r, 0.1, 0.25) } }) },
  ],
};

/** How many moves a set has. */
const MOVES_IN_SET: Record<Tier, [number, number]> = { calm: [1, 2], groove: [2, 3], intense: [2, 4] };

/** A set of effects for a tier: a few of its moves (none of `last`'s first, none feeding back on a chaos look). */
export function composeSet(tier: Tier, look: LiveLook | null, r: () => number, last: readonly string[] = []): { effects: Effects; names: string[] } {
  const pool = MOVES[tier].filter((m) => !(m.feeds && look?.kind === "chaos"));
  const [lo, hi] = MOVES_IN_SET[tier];
  const count = lo + Math.floor(r() * (hi - lo + 1));
  const fresh = pool.filter((m) => m.name !== last[0]);
  const picked: Move[] = [];
  const from = [...(fresh.length >= count ? fresh : pool)];
  while (picked.length < count && from.length) picked.push(from.splice(Math.floor(r() * from.length), 1)[0]);
  const effects: Effects = { frame: { ...PLAIN_FRAME }, fx: { ...NO_FX } };
  for (const move of picked) {
    const { frame, fx } = move.make(r);
    Object.assign(effects.frame, frame);
    Object.assign(effects.fx, fx);
  }
  effects.fx.feedback = Math.min(effects.fx.feedback, MOST_FEEDBACK);
  if (sparse(look)) {
    effects.frame.zoom = Math.max(1, effects.frame.zoom);
    effects.frame.repeat = Math.min(2, effects.frame.repeat) as Frame["repeat"];
  }
  return { effects, names: picked.map((m) => m.name) };
}

/**
 * A set a little changed (a beat, or a bar between sets): a mirror on or off, a copy more or fewer, a zoom, the turn
 * reversed. A sparse look isn't zoomed out, nor copied past 2×2.
 */
export function mutateSet(effects: Effects, r: () => number, look: LiveLook | null = null, avoid = ""): { effects: Effects; name: string } {
  const f = effects.frame;
  const most = sparse(look) ? 2 : 3;
  const options: { name: string; frame: Partial<Frame> }[] = [
    { name: f.mirror ? "the mirror off" : "mirrored", frame: { mirror: !f.mirror } },
    { name: f.repeat >= most ? "a copy fewer" : "a copy more", frame: { repeat: (f.repeat >= most ? f.repeat - 1 : f.repeat + 1) as Frame["repeat"] } },
    ...(sparse(look) ? [] : [{ name: f.zoom < 1 ? "zoomed back in" : "zoomed out", frame: { zoom: f.zoom < 1 ? 1 : 0.8 } }]),
    ...(f.spin !== 0 ? [{ name: "the turn reversed", frame: { spin: -f.spin } }] : [{ name: "a turn", frame: { spin: 20 * side(r) } }]),
  ];
  // Not the one just played (from the same set it'd look the same: no change on the beat).
  const fresh = options.filter((o) => o.name !== avoid);
  const from = fresh.length ? fresh : options;
  const pick = from[Math.floor(r() * from.length)];
  return { effects: { frame: { ...f, ...pick.frame }, fx: effects.fx }, name: pick.name };
}

/** A build-up's next bar: tighter (a copy more, more kaleidoscope, zoomed in a little), feedback let go of. */
function tighten(effects: Effects, step: number): Effects {
  return {
    frame: { ...effects.frame, repeat: Math.min(3, 1 + Math.floor(step / 2)) as Frame["repeat"], mirror: true, spin: 0, zoom: Math.min(1.25, 1 + step * 0.05) },
    fx: { ...effects.fx, kaleido: Math.min(0.8, 0.2 + step * 0.12), feedback: 0, swirl: Math.min(0.6, step * 0.1) },
  };
}

const describe = (names: readonly string[]) => names.join(", ");

/** The effects over the looks, by the music: what, when, and why. */
export class EffectsEngine {
  private current: Effects = PLAIN_EFFECTS;
  /** The last set (what mutations vary), when the next set's due, and the next mutation of it. */
  private set: Effects = PLAIN_EFFECTS;
  private next = 0;
  private nextMutation = Infinity;
  private beats = 0;
  private lastMutation = "";
  private lastDrop = -Infinity;
  private lastEvent = -Infinity;
  private building = 0;
  private lastNames: string[] = [];

  constructor(private readonly random: () => number = Math.random) {}

  /** The effects as last decided. */
  get effects(): Effects {
    return this.current;
  }

  /** Taken over from where they are (by hand, or the assistant): the engine carries on from there. */
  from(effects: Effects, time: number): void {
    this.current = effects;
    this.set = effects;
    this.next = time;
    this.nextMutation = Infinity;
  }

  /** Each frame: a change of effects, or null (most frames). */
  step(p: Pulse, mode: EffectsMode): EffectsChange | null {
    if (mode === "hand") return null;
    const { mood, time } = p;
    const bar = 4 * p.beat;
    // The next downbeat: the music's, or (none known yet) the next beat, its bars counted in beats.
    const nextBar = p.nextBar ?? p.nextBeat;
    // A drop: clean on the cut (the new look's impact), then hard a bar on.
    if (p.drop !== undefined && p.drop > this.lastDrop) {
      this.lastDrop = p.drop;
      this.building = 0;
      if (time - p.drop < 1) {
        this.next = p.drop + bar - LEAD;
        this.nextMutation = Infinity;
        return this.land(PLAIN_EFFECTS, [], p.drop, 0.01, "the drop: clean on its cut", true);
      }
    }
    // A breakdown: back to something gentle, slowly.
    const event = mood.events.at(-1);
    if (event && event.time > this.lastEvent) {
      this.lastEvent = event.time;
      if (event.kind === "breakdown" && time - event.time < 2) {
        const set = composeSet("calm", p.look, this.random, this.lastNames);
        this.next = nextBar + EVERY_BARS.calm * bar;
        this.nextMutation = Infinity;
        return this.land(set.effects, set.names, nextBar, bar, `a breakdown: ${describe(set.names)}`, true);
      }
    }
    // A mutation of the set between new ones (following the music).
    if (mode === "music" && time >= this.nextMutation - LEAD && this.nextMutation < this.next - LEAD) {
      const tier = tierOf(mood);
      this.nextMutation += MUTATE_BARS[tier] * bar;
      const m = mutateSet(this.set, this.random, p.look, this.lastMutation);
      this.current = m.effects;
      this.lastMutation = m.name;
      return { effects: m.effects, at: nextBar, seconds: tier === "intense" ? p.beat / 4 : p.beat, why: `a bar between (${tier}): ${m.name}` };
    }
    if (time < this.next - LEAD) return null;
    // A build-up tightens bar by bar (it lands on the drop).
    if (mood.section === "build") {
      this.building++;
      this.next = nextBar + bar;
      this.nextMutation = Infinity;
      this.set = this.current = tighten(this.current, this.building);
      return { effects: this.current, at: nextBar, seconds: p.beat, why: `the build-up tightening (bar ${this.building})` };
    }
    this.building = 0;
    const tier = tierOf(mood);
    if (mode === "beat") {
      // A new set on the downbeat, a mutation of it (the bar's set, not the last beat's) on each beat between.
      const downbeat = p.nextBar !== null ? Math.abs(p.nextBar - p.nextBeat) < 0.05 : this.beats % 4 === 0;
      this.beats++;
      this.next = p.nextBeat + p.beat;
      if (!downbeat) {
        const m = mutateSet(this.set, this.random, p.look, this.lastMutation);
        this.current = m.effects;
        this.lastMutation = m.name;
        return { effects: m.effects, at: p.nextBeat, seconds: p.beat / 4, why: `a beat: ${m.name}`, often: true };
      }
      const set = composeSet(tier, p.look, this.random, this.lastNames);
      return { ...this.land(set.effects, set.names, p.nextBeat, p.beat / 4, `a bar (${tier}): ${describe(set.names)}`, true), often: true };
    }
    const bars = mode === "bar" ? 1 : EVERY_BARS[tier];
    this.next = nextBar + bars * bar;
    this.nextMutation = mode === "music" && MUTATE_BARS[tier] < bars ? nextBar + MUTATE_BARS[tier] * bar : Infinity;
    const set = composeSet(tier, p.look, this.random, this.lastNames);
    // Calm eases over a bar; a groove over a beat; intense snaps in half of one.
    const seconds = tier === "calm" && mode === "music" ? bar : tier === "groove" ? p.beat : p.beat / 2;
    return this.land(set.effects, set.names, nextBar, seconds, `${mode === "bar" ? "a bar" : `${bars} bars, ${tier}`} (${mood.intensity.toFixed(2)}): ${describe(set.names)}`, true);
  }

  private land(effects: Effects, names: string[], at: number, seconds: number, why: string, upright: boolean): EffectsChange {
    this.current = effects;
    this.set = effects;
    this.lastNames = names;
    return { effects, at, seconds, why, ...(upright && effects.frame.spin === 0 && { upright }) };
  }
}
