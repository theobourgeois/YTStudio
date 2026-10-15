/**
 * The effects the player plays over the looks by itself (the "Effects" menu, docs/now-playing.md): the frame
 * (a mirror) and vaudio's distortions and feedback, chosen by the music, landing on its beats.
 *
 * - **Following the music**: every set has a feedback move (Théo's favourites: soft trails, smoke, a tunnel, a sinking
 *   echo, a colour echo), with others: calm, something gentle every 4 bars, eased over a bar (a mirror, a mirror fold,
 *   a slow warp); a groove every 4 bars, mutated after 2 (a swirl, ripples, a kaleidoscope); intense every 2 bars,
 *   mutated on the bar between (a kaleidoscope, a swirl, a lens, a deep tunnel). A build-up tightens bar by bar (more
 *   kaleidoscope and swirl, the echo drawn in); a drop is clean on its cut (the look's impact), then goes hard a bar
 *   on; a breakdown washes back to gentle. It never turns the picture, repeats it or zooms out (Théo: a mirror only
 *   mirrors).
 * - **Every bar**: a new set on each downbeat. **Every beat**: a new set on each downbeat, and on each beat between a
 *   mutation of it (a mirror on or off, the echo sinking or rising, its colour on, its trails longer or shorter, a
 *   kaleidoscope in or out).
 * - **By hand**: none (the panel, the keys).
 *
 * A chaos look has a world of its own, so it's played frames and light distortions only (no more feedback on its
 * own). Before the music's downbeats are known, bars are counted in beats. Every change says why. Pure
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
    { name: "mirrored", make: () => ({ frame: { mirror: true } }) },
    { name: "a mirror fold", make: (r) => ({ fx: { fold: rand(r, 0.3, 0.55) } }) },
    { name: "a slow warp", make: (r) => ({ fx: { warp: rand(r, 0.15, 0.3) } }) },
    { name: "a soft kaleidoscope", make: (r) => ({ fx: { kaleido: rand(r, 0.2, 0.35) } }) },
    { name: "soft trails", feeds: true, make: (r) => ({ fx: { feedback: rand(r, 0.45, 0.6), trails: 0.8, echoZoom: rand(r, 0.05, 0.12), echoFlow: rand(r, 0.2, 0.35) } }) },
    { name: "smoke", feeds: true, make: (r) => ({ fx: { feedback: rand(r, 0.5, 0.65), trails: 0.85, echoFlow: rand(r, 0.4, 0.6), echoZoom: rand(r, 0.02, 0.08) } }) },
  ],
  groove: [
    { name: "mirrored", make: () => ({ frame: { mirror: true } }) },
    { name: "a swirl", make: (r) => ({ fx: { swirl: rand(r, 0.3, 0.5) } }) },
    { name: "ripples", make: (r) => ({ fx: { ripple: rand(r, 0.25, 0.45) } }) },
    { name: "a kaleidoscope", make: (r) => ({ fx: { kaleido: rand(r, 0.35, 0.55) } }) },
    { name: "a warp", make: (r) => ({ fx: { warp: rand(r, 0.3, 0.5) } }) },
    { name: "a tunnel", feeds: true, make: (r) => ({ fx: { feedback: rand(r, 0.55, 0.72), echoZoom: rand(r, 0.15, 0.3), trails: 0.8 } }) },
    { name: "a sinking echo", feeds: true, make: (r) => ({ fx: { feedback: rand(r, 0.55, 0.7), echoZoom: -rand(r, 0.15, 0.25), trails: 0.8 } }) },
    { name: "smoke", feeds: true, make: (r) => ({ fx: { feedback: rand(r, 0.55, 0.7), trails: 0.85, echoFlow: rand(r, 0.4, 0.7) } }) },
    { name: "a colour echo", feeds: true, make: (r) => ({ fx: { feedback: rand(r, 0.55, 0.7), trails: 0.8, echoHue: rand(r, 0.08, 0.2), echoZoom: rand(r, 0.05, 0.15) } }) },
  ],
  intense: [
    { name: "mirrored", make: () => ({ frame: { mirror: true } }) },
    { name: "a kaleidoscope", make: (r) => ({ fx: { kaleido: rand(r, 0.5, 0.8) } }) },
    { name: "a swirl", make: (r) => ({ fx: { swirl: rand(r, 0.5, 0.8) } }) },
    { name: "a lens", make: (r) => ({ fx: { lens: rand(r, 0.3, 0.5) * side(r) } }) },
    { name: "a warp", make: (r) => ({ fx: { warp: rand(r, 0.45, 0.7) } }) },
    { name: "a deep tunnel", feeds: true, make: (r) => ({ fx: { feedback: rand(r, 0.68, MOST_FEEDBACK), echoZoom: rand(r, 0.3, 0.45), trails: 0.88 } }) },
    { name: "a colour tunnel", feeds: true, make: (r) => ({ fx: { feedback: rand(r, 0.65, 0.78), echoZoom: rand(r, 0.2, 0.35), echoHue: rand(r, 0.15, 0.3), trails: 0.85 } }) },
    { name: "a sinking echo", feeds: true, make: (r) => ({ fx: { feedback: rand(r, 0.65, 0.78), echoZoom: -rand(r, 0.25, 0.35), trails: 0.85 } }) },
    { name: "smoke", feeds: true, make: (r) => ({ fx: { feedback: rand(r, 0.65, 0.78), trails: 0.88, echoFlow: rand(r, 0.6, 0.9), echoZoom: rand(r, 0.05, 0.15) } }) },
  ],
};

/** How many moves a set has besides its feedback. */
const MOVES_IN_SET: Record<Tier, [number, number]> = { calm: [0, 1], groove: [1, 2], intense: [1, 3] };

/**
 * A set of effects for a tier: a feedback move (Théo's favourites; none on a chaos look, which has its own) and a few
 * of the others, none of `last`'s first. Never turning, nor repeated, nor zoomed out: mirrored is a mirror.
 */
export function composeSet(tier: Tier, look: LiveLook | null, r: () => number, last: readonly string[] = []): { effects: Effects; names: string[] } {
  const chaos = look?.kind === "chaos";
  const feeding = MOVES[tier].filter((m) => m.feeds && m.name !== last[0]);
  const others = MOVES[tier].filter((m) => !m.feeds);
  const picked: Move[] = chaos || !feeding.length ? [] : [feeding[Math.floor(r() * feeding.length)]];
  const [lo, hi] = MOVES_IN_SET[tier];
  // A chaos look gets a move more of the others, in place of the feedback it doesn't get.
  const count = lo + Math.floor(r() * (hi - lo + 1)) + (chaos ? 1 : 0);
  const fresh = others.filter((m) => m.name !== last[0]);
  const from = [...(fresh.length >= count ? fresh : others)];
  while (picked.length < count + (chaos ? 0 : 1) && from.length) picked.push(from.splice(Math.floor(r() * from.length), 1)[0]);
  const effects: Effects = { frame: { ...PLAIN_FRAME }, fx: { ...NO_FX } };
  for (const move of picked) {
    const { frame, fx } = move.make(r);
    Object.assign(effects.frame, frame);
    Object.assign(effects.fx, fx);
  }
  effects.fx.feedback = Math.min(effects.fx.feedback, MOST_FEEDBACK);
  return { effects, names: picked.map((m) => m.name) };
}

/**
 * A set a little changed (a beat, or a bar between sets): mirrored or not, the echo turned inside out (a tunnel
 * sinking, or back), its colour moved on, its trails longer or shorter, a kaleidoscope in or out. Not the one just
 * played (`avoid`: from the same set it'd look the same).
 */
export function mutateSet(effects: Effects, r: () => number, _look: LiveLook | null = null, avoid = ""): { effects: Effects; name: string } {
  const { frame, fx } = effects;
  const options: { name: string; frame?: Partial<Frame>; fx?: Partial<LiveFx> }[] = [
    { name: frame.mirror ? "the mirror off" : "mirrored", frame: { mirror: !frame.mirror } },
    { name: fx.kaleido > 0 ? "the kaleidoscope out" : "a kaleidoscope", fx: { kaleido: fx.kaleido > 0 ? 0 : 0.4 } },
    ...(fx.feedback > 0
      ? [
          { name: fx.echoZoom >= 0 ? "the echo sinking" : "the echo rising", fx: { echoZoom: fx.echoZoom === 0 ? -0.2 : -fx.echoZoom } },
          { name: "the echo's colour on", fx: { echoHue: (fx.echoHue + 0.12) % 1 } },
          { name: fx.trails > 0.82 ? "shorter trails" : "longer trails", fx: { trails: fx.trails > 0.82 ? 0.72 : 0.9 } },
        ]
      : []),
  ];
  const fresh = options.filter((o) => o.name !== avoid);
  const from = fresh.length ? fresh : options;
  const pick = from[Math.floor(r() * from.length)];
  return { effects: { frame: { ...frame, ...pick.frame }, fx: { ...fx, ...pick.fx } }, name: pick.name };
}

/** A build-up's next bar: tighter (more kaleidoscope, more swirl, mirrored, the echo drawn in), as it goes. */
function tighten(effects: Effects, step: number): Effects {
  return {
    frame: { ...PLAIN_FRAME, mirror: true },
    fx: {
      ...effects.fx,
      kaleido: Math.min(0.8, 0.2 + step * 0.12),
      swirl: Math.min(0.6, step * 0.1),
      feedback: Math.min(0.7, 0.4 + step * 0.05),
      echoZoom: -Math.min(0.35, 0.1 + step * 0.04),
      trails: 0.8,
    },
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
