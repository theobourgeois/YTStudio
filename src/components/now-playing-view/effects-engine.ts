/**
 * The effects the player plays over the looks by itself (the "Effects" menu, docs/now-playing.md): the frame
 * (a mirror) and vaudio's distortions and feedback, chosen by the music, landing on its beats.
 *
 * - **Following the music**: every set has a feedback move, half the echo kept at least (Théo's favourites: soft
 *   trails, smoke, a tunnel, a sinking echo, a colour echo; over every look, MilkDrop's too: Théo, "it should at least
 *   be at 50% pretty much all the time"), with others: calm, something gentle every 4 bars, eased over a bar (a mirror
 *   fold, a slow warp); a groove every 4 bars, mutated after 2 (a swirl, ripples, a kaleidoscope, now and then tiled);
 *   intense every 2 bars, mutated on the bar between (a kaleidoscope, a swirl, a lens, a deep tunnel). The picture's
 *   seldom mirrored (Théo: "sometimes we don't want to split it at all"): a mirror's a rarer pick, and a change of a
 *   mirrored set more likely takes it off than a plain one's puts it on. A build-up tightens bar by bar (more
 *   kaleidoscope and swirl, the echo drawn in); a drop is clean on its cut (the look's impact), then goes hard a bar
 *   on; a breakdown washes back to gentle. A slow song is calm throughout, its drop not cut (`isSlow`). It never
 *   turns the picture or zooms out.
 * - **Every bar**: a new set on each downbeat. **Every beat**: a new set on each downbeat, and on each beat between a
 *   mutation of it (a mirror on or off, the echo sinking or rising, its colour on, its trails longer or shorter, a
 *   kaleidoscope in or out).
 * - **By hand**: none (the panel, the keys).
 *
 * A chaos look has a world of its own (a MilkDrop one too): no kaleidoscope over it (many of MilkDrop's are one
 * already, and Théo found it too much), and its feedback held a little lower (its own piles up with it). Over the rest
 * a kaleidoscope is a gentle one. Before the music's downbeats are known, bars are counted in beats. Every change
 * says why. Pure (its random given), and tested.
 */
import { type Frame, type LiveFx, type LiveLook, NO_FX, PLAIN_FRAME } from "@shared/live-looks";
import { type Mood, isSlow } from "@shared/signals/mood";

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
export function tierOf(mood: Pick<Mood, "intensity" | "character" | "sure" | "slow">): Tier {
  // A slow song is calm however loud it's mastered: its effects ease in and stay.
  if (isSlow(mood) || mood.intensity < 0.35 || (mood.character === "chill" && mood.sure >= 0.4 && mood.intensity < 0.7)) return "calm";
  return mood.intensity < 0.7 ? "groove" : "intense";
}

/** Feedback the engine never goes past: a look's own brightness on top of more whitens it out. */
export const MOST_FEEDBACK = 0.8;
/** Over a look of its own world (it feeds back into itself already): MilkDrop's, and chaos's World Loop. */
export const OWN_WORLD_FEEDBACK = { milkdrop: 0.7, chaos: 0.6 };
/** The echo kept at least, in every set but a drop's clean cut (Théo: at least 50%, pretty much all the time). */
export const LEAST_FEEDBACK = 0.5;
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
  /** How likely it's picked against the others (1, unless said: a mirror's rarer). */
  weight?: number;
  /** Feedback of its own: not on a chaos look (it has a world of its own). */
  feeds?: true;
  /** A kaleidoscope: not on a chaos look either. */
  kaleido?: true;
  make(r: () => number): { frame?: Partial<Frame>; fx?: Partial<LiveFx> };
}

/** A mirror's chance against another move's (Théo: "sometimes we don't want to split it at all"). */
const MIRROR_WEIGHT = 0.2;

/** One of `list` at random, by their weights (1 each, unless said). */
function weighted<T extends { weight?: number }>(list: readonly T[], r: () => number): number {
  const total = list.reduce((a, m) => a + (m.weight ?? 1), 0);
  let left = r() * total;
  for (let i = 0; i < list.length; i++) if ((left -= list[i].weight ?? 1) <= 0) return i;
  return list.length - 1;
}

const MOVES: Record<Tier, Move[]> = {
  calm: [
    { name: "mirrored", weight: MIRROR_WEIGHT, make: () => ({ frame: { mirror: true } }) },
    { name: "a mirror fold", weight: 0.5, make: (r) => ({ fx: { fold: rand(r, 0.3, 0.55) } }) },
    { name: "a slow warp", make: (r) => ({ fx: { warp: rand(r, 0.15, 0.3) } }) },
    { name: "a soft kaleidoscope", kaleido: true, make: (r) => ({ fx: { kaleido: rand(r, 0.15, 0.25) } }) },
    { name: "soft trails", feeds: true, make: (r) => ({ fx: { feedback: rand(r, 0.5, 0.6), trails: 0.8, echoZoom: rand(r, 0.05, 0.12), echoFlow: rand(r, 0.2, 0.35) } }) },
    { name: "smoke", feeds: true, make: (r) => ({ fx: { feedback: rand(r, 0.5, 0.65), trails: 0.85, echoFlow: rand(r, 0.4, 0.6), echoZoom: rand(r, 0.02, 0.08) } }) },
  ],
  groove: [
    { name: "mirrored", weight: MIRROR_WEIGHT, make: () => ({ frame: { mirror: true } }) },
    { name: "tiled 2×2", weight: 0.35, make: () => ({ frame: { repeat: 2 } }) },
    { name: "a swirl", make: (r) => ({ fx: { swirl: rand(r, 0.3, 0.5) } }) },
    { name: "ripples", make: (r) => ({ fx: { ripple: rand(r, 0.25, 0.45) } }) },
    { name: "a kaleidoscope", kaleido: true, make: (r) => ({ fx: { kaleido: rand(r, 0.2, 0.35) } }) },
    { name: "a warp", make: (r) => ({ fx: { warp: rand(r, 0.3, 0.5) } }) },
    { name: "a tunnel", feeds: true, make: (r) => ({ fx: { feedback: rand(r, 0.55, 0.72), echoZoom: rand(r, 0.15, 0.3), trails: 0.8 } }) },
    { name: "a sinking echo", feeds: true, make: (r) => ({ fx: { feedback: rand(r, 0.55, 0.7), echoZoom: -rand(r, 0.15, 0.25), trails: 0.8 } }) },
    { name: "smoke", feeds: true, make: (r) => ({ fx: { feedback: rand(r, 0.55, 0.7), trails: 0.85, echoFlow: rand(r, 0.4, 0.7) } }) },
    { name: "a colour echo", feeds: true, make: (r) => ({ fx: { feedback: rand(r, 0.55, 0.7), trails: 0.8, echoHue: rand(r, 0.08, 0.2), echoZoom: rand(r, 0.05, 0.15) } }) },
  ],
  intense: [
    { name: "mirrored", weight: MIRROR_WEIGHT, make: () => ({ frame: { mirror: true } }) },
    { name: "tiled 2×2", weight: 0.35, make: () => ({ frame: { repeat: 2 } }) },
    { name: "tiled 3×3", weight: 0.12, make: () => ({ frame: { repeat: 3 } }) },
    { name: "a kaleidoscope", kaleido: true, make: (r) => ({ fx: { kaleido: rand(r, 0.3, 0.45) } }) },
    { name: "a swirl", make: (r) => ({ fx: { swirl: rand(r, 0.5, 0.8) } }) },
    { name: "a lens", make: (r) => ({ fx: { lens: rand(r, 0.3, 0.5) * side(r) } }) },
    { name: "a warp", make: (r) => ({ fx: { warp: rand(r, 0.45, 0.7) } }) },
    { name: "a deep tunnel", feeds: true, make: (r) => ({ fx: { feedback: rand(r, 0.68, MOST_FEEDBACK), echoZoom: rand(r, 0.3, 0.45), trails: 0.88 } }) },
    { name: "a colour tunnel", feeds: true, make: (r) => ({ fx: { feedback: rand(r, 0.65, 0.78), echoZoom: rand(r, 0.2, 0.35), echoHue: rand(r, 0.15, 0.3), trails: 0.85 } }) },
    { name: "a sinking echo", feeds: true, make: (r) => ({ fx: { feedback: rand(r, 0.65, 0.78), echoZoom: -rand(r, 0.25, 0.35), trails: 0.85 } }) },
    { name: "smoke", feeds: true, make: (r) => ({ fx: { feedback: rand(r, 0.65, 0.78), trails: 0.88, echoFlow: rand(r, 0.6, 0.9), echoZoom: rand(r, 0.05, 0.15) } }) },
  ],
};

/** A look with a world of its own (chaos's, MilkDrop's presets: they feed back into themselves). */
const ownWorld = (look: LiveLook | null) => look?.kind === "chaos" || look?.kind === "milkdrop";

/** The most feedback over `look`: less over one of its own world. */
const mostFeedback = (look: LiveLook | null) => (look?.kind === "milkdrop" ? OWN_WORLD_FEEDBACK.milkdrop : look?.kind === "chaos" ? OWN_WORLD_FEEDBACK.chaos : MOST_FEEDBACK);

/** How many moves a set has besides its feedback. */
const MOVES_IN_SET: Record<Tier, [number, number]> = { calm: [0, 1], groove: [1, 2], intense: [1, 3] };

/**
 * A set of effects for a tier: a feedback move (Théo's favourites, half the echo kept at least, over every look; held
 * lower over one of its own world) and a few of the others by their weights (a mirror seldom, tiles now and then), none
 * of `last`'s first. Never turning, nor zoomed out.
 */
export function composeSet(tier: Tier, look: LiveLook | null, r: () => number, last: readonly string[] = []): { effects: Effects; names: string[] } {
  const own = ownWorld(look);
  const feeding = MOVES[tier].filter((m) => m.feeds && m.name !== last[0]);
  const others = MOVES[tier].filter((m) => !m.feeds && !(own && m.kaleido));
  const picked: Move[] = feeding.length ? [feeding[Math.floor(r() * feeding.length)]] : [];
  const [lo, hi] = MOVES_IN_SET[tier];
  const count = lo + Math.floor(r() * (hi - lo + 1));
  const fresh = others.filter((m) => m.name !== last[0]);
  const from = [...(fresh.length >= count ? fresh : others)];
  for (let i = 0; i < count && from.length; i++) picked.push(...from.splice(weighted(from, r), 1));
  const effects: Effects = { frame: { ...PLAIN_FRAME }, fx: { ...NO_FX } };
  for (const move of picked) {
    const { frame, fx } = move.make(r);
    Object.assign(effects.frame, frame);
    Object.assign(effects.fx, fx);
  }
  effects.fx.feedback = Math.min(Math.max(effects.fx.feedback, LEAST_FEEDBACK), mostFeedback(look));
  return { effects, names: picked.map((m) => m.name) };
}

/**
 * A set a little changed (a beat, or a bar between sets): the mirror off (likely) or on (seldom), tiles in or out, the
 * echo turned inside out (a tunnel sinking, or back), its colour moved on, its trails longer or shorter, a kaleidoscope
 * in or out (only out over a look of its own world). Not the one just played (`avoid`: from the same set it'd look the
 * same).
 */
export function mutateSet(effects: Effects, r: () => number, look: LiveLook | null = null, avoid = ""): { effects: Effects; name: string } {
  const { frame, fx } = effects;
  const options: { name: string; weight?: number; frame?: Partial<Frame>; fx?: Partial<LiveFx> }[] = [
    { name: frame.mirror ? "the mirror off" : "mirrored", weight: frame.mirror ? 1.5 : MIRROR_WEIGHT, frame: { mirror: !frame.mirror } },
    { name: frame.repeat > 1 ? "the tiles out" : "tiled 2×2", weight: frame.repeat > 1 ? 1.2 : 0.2, frame: { repeat: frame.repeat > 1 ? 1 : 2 } },
    ...(fx.kaleido > 0 || !ownWorld(look) ? [{ name: fx.kaleido > 0 ? "the kaleidoscope out" : "a kaleidoscope", fx: { kaleido: fx.kaleido > 0 ? 0 : 0.25 } }] : []),
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
  const pick = from[weighted(from, r)];
  return { effects: { frame: { ...frame, ...pick.frame }, fx: { ...fx, ...pick.fx } }, name: pick.name };
}

/**
 * A build-up's next bar: tighter (more kaleidoscope, more swirl, the echo drawn in), as it goes, framed as it was (not
 * mirrored for it: Théo found the picture split too often); no kaleidoscope over a look of its own world.
 */
function tighten(effects: Effects, step: number, look: LiveLook | null): Effects {
  return {
    frame: { ...effects.frame, spin: 0, zoom: 1 },
    fx: {
      ...effects.fx,
      kaleido: ownWorld(look) ? 0 : Math.min(0.45, 0.15 + step * 0.06),
      swirl: Math.min(0.6, step * 0.1),
      feedback: Math.min(mostFeedback(look), LEAST_FEEDBACK + step * 0.04),
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
    // A drop: clean on the cut (the new look's impact), then hard a bar on. (A slow song's isn't cut: it flows on.)
    if (p.drop !== undefined && p.drop > this.lastDrop) {
      this.lastDrop = p.drop;
      this.building = 0;
      if (time - p.drop < 1 && !isSlow(mood)) {
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
      this.set = this.current = tighten(this.current, this.building, p.look);
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
