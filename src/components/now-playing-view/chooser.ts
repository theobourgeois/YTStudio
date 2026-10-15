/**
 * Which look plays when looks change by themselves (docs/now-playing.md, step 5): one that suits the music, by
 * what each look suits (`LookSuits`: the kinds of song, the intensities it reads well at) and what's heard
 * (`Mood`). Following the music: something minimal while a new song's kind isn't known yet, then a look for it; an
 * intense one on a drop, a calm one in a breakdown, none changed in a build-up (it lands on the drop); every 8-bar
 * phrase the look's checked against the music (and changed when it no longer suits, sooner when it's far off), a
 * chaos look mutated each phrase and changed after 32 bars, another changed after 16 (the effects over it evolve it
 * meanwhile: `effects-engine.ts`; it doesn't evolve as chaos does: longer, it's a loop). A drop is the kick it lands
 * on, heard at once (`Moment.drop`), and cut to there. A slow song (`isSlow`) only has looks that flow, its loudness
 * not taken for intensity, and nothing cut: its drop blends in too. Every choice says why, and its reason picks its
 * transition (`switches.ts`).
 * Pure, and tested: the view acts on what it's told.
 */
import type { LiveLook } from "@shared/live-looks";
import { type Mood, SLOW, SONG_CHARACTERS, isSlow } from "@shared/signals/mood";
import type { SwitchReason } from "./switches";

/** How a choice comes in: cut (at `at`), soon, on the next bar, or the same look mutated (chaos) or varied. */
export type ChoiceHow = "cut" | "now" | "bar" | "mutate" | "vary";

export interface Choice {
  look: string;
  how: ChoiceHow;
  /** Why it changes, which picks how (`switchFor`). */
  reason: SwitchReason;
  /** Why, in words, for the log and the readout (I). */
  why: string;
  /** When it cuts (a drop's kick), if not now. */
  at?: number;
}

/**
 * What the chooser goes by at a moment: the session's time, what's heard, how long a bar is (seconds), and the
 * latest drop (the kick it landed on, heard at once: the signals' drops, not the mood's quarter-second reading).
 */
export interface Moment {
  time: number;
  mood: Mood;
  bar: number;
  drop?: number;
}

/** What a look wants of the music when it's picked. */
type Want = "fit" | "minimal" | "intense" | "calm";

/** How far outside its range the intensity may stray before a look no longer suits it. */
export const MARGIN = 0.08;
/** Farther out than this, a look's changed within a couple of bars, not at the phrase's end. */
export const FAR = 0.2;
/** Bars in a phrase: when a look's checked, mutated or varied. */
export const PHRASE_BARS = 8;
/** Phrases a look plays at most, following the music: chaos evolves (it's mutated each phrase), the rest don't. */
const MOST_PHRASES = { chaos: 4, other: 2 };
/** How sure of the song's kind before it counts (`Mood.sure`). */
const SURE = 0.4;
/** Seconds into a song when its kind is taken as known anyway. */
const SETTLE_SECONDS = 15;
/** Seconds a look stays before a drop or a breakdown may change it. */
const SETTLE_LOOK = 4;
/** Intensity under this for a while: between songs (or a silence). */
const QUIET = 0.06;
/** Looks shown lately, not picked again soon. */
const RECENT = 6;
/** A slow song's intensity, as its looks take it: however loud it's mastered, it's never more than this. */
export const SLOW_MOST = 0.65;

/** The intensity a look's range is held to: a slow song's held down (see `SLOW_MOST`). */
const felt = (mood: Mood, intensity = mood.intensity) => (isSlow(mood) ? Math.min(intensity, SLOW_MOST) : intensity);
/** How far under `SLOW` a song falls before slow motion stops (it doesn't flicker on the line). */
const SLOW_MOTION_OFF = 0.1;

/** Whether the looks play in slow motion now, given whether they did: from a slow song on, until it's clearly not. */
export function slowMotionOn(mood: Pick<Mood, "slow">, was: boolean): boolean {
  return was ? mood.slow >= SLOW - SLOW_MOTION_OFF : isSlow(mood);
}

/**
 * What's heard, taken as a slow song's whatever plays (the Slow motion setting, `Pace`: for when the music's vibe is
 * too much): everything flows and moves at half speed, as on a slow song. A slow song is never hype (`mood.ts`), so a
 * hype one is taken as the kind it most is after that.
 */
export function slowedDown(mood: Mood): Mood {
  const character =
    mood.character === "hype" ? SONG_CHARACTERS.filter((c) => c !== "hype").reduce((a, b) => (mood.scores[b] > mood.scores[a] ? b : a)) : mood.character;
  return { ...mood, slow: Math.max(mood.slow, 1), character };
}

/** Whether a look moves as the song does: on a slow song, only one that flows. */
const paced = (look: LiveLook, mood: Mood) => !isSlow(mood) || !!look.suits.flows;

/** How far the intensity is outside a look's range (0: inside). */
export function outOfRange(look: LiveLook, intensity: number): number {
  const [lo, hi] = look.suits.energy;
  return Math.max(0, lo - intensity, intensity - hi);
}

/** Whether the song's kind is known well enough to go by. */
const known = (mood: Mood) => mood.character !== null && mood.sure >= SURE;

/**
 * Whether a look suits what's heard: the intensity within its range (and margin), the song's kind if it's known, and
 * flowing on a slow song.
 */
export function suits(look: LiveLook, mood: Mood, margin = MARGIN): boolean {
  if (!paced(look, mood) || outOfRange(look, felt(mood)) > margin) return false;
  return !known(mood) || look.suits.characters.includes(mood.character!);
}

const range = (look: LiveLook) => `${look.suits.energy[0]}–${look.suits.energy[1]}`;
const heard = (mood: Mood) => `${known(mood) ? mood.character : "not sure yet"}${isSlow(mood) ? ", slow" : ""}, intensity ${mood.intensity.toFixed(2)}`;

/**
 * A look for the moment: one that suits it (minimal, or for an intense or calm moment, if asked), not shown lately,
 * picked at random weighted by how near the middle of its range the intensity is, each kind as likely as another. A calm moment (a breakdown) or an
 * intense one (a drop) goes by the intensity alone, not the song's kind (a hype song's breakdown is calm, a song with a
 * quiet intro reads chill until its drop), and prefers looks made for it. A slow song has only looks that flow. Short
 * of any, the preferences are let go, then what was shown lately, then all but the nearest range.
 */
export function pickLook(looks: readonly LiveLook[], mood: Mood, recent: readonly string[], random: () => number, want: Want = "fit"): LiveLook {
  // What it's picked for: a drop is intense even before the intensity has caught up, a breakdown calm.
  const intensity = felt(mood, want === "intense" ? Math.max(mood.intensity, 0.7) : want === "calm" ? Math.min(mood.intensity, 0.35) : mood.intensity);
  const inRange = (l: LiveLook) => outOfRange(l, intensity) <= MARGIN;
  const wanted = (l: LiveLook) => want !== "minimal" || !!l.suits.minimal;
  // A drop or a breakdown goes by the moment, not the song's kind (a quiet intro reads chill; its drop isn't).
  const kind = (l: LiveLook) => want !== "fit" || !known(mood) || l.suits.characters.includes(mood.character!);
  // Made for the moment: calm looks top out low, intense ones start high, a look picked to fit isn't a minimal one.
  const made = (l: LiveLook) =>
    (want !== "calm" || l.suits.energy[1] <= 0.8) && (want !== "intense" || l.suits.energy[0] >= 0.3) && (want === "minimal" || !l.suits.minimal);
  const fresh = (l: LiveLook) => !recent.includes(l.id);
  const pace = (l: LiveLook) => paced(l, mood);
  const tries: ((l: LiveLook) => boolean)[] = [
    (l) => pace(l) && wanted(l) && inRange(l) && kind(l) && made(l) && fresh(l),
    (l) => pace(l) && wanted(l) && inRange(l) && kind(l) && made(l),
    (l) => pace(l) && wanted(l) && inRange(l) && kind(l) && fresh(l),
    (l) => pace(l) && wanted(l) && inRange(l) && kind(l),
    (l) => pace(l) && wanted(l) && inRange(l),
    (l) => pace(l) && inRange(l),
  ];
  for (const ok of tries) {
    const pool = looks.filter(ok);
    if (!pool.length) continue;
    // Each kind as likely as another, however many looks it has (MilkDrop's are many).
    const ofKind = new Map<string, number>();
    for (const l of pool) ofKind.set(l.kind, (ofKind.get(l.kind) ?? 0) + 1);
    const weights = pool.map((l) => {
      const [lo, hi] = l.suits.energy;
      return (1.2 - Math.min(1, Math.abs(intensity - (lo + hi) / 2) / Math.max(0.1, (hi - lo) / 2))) / ofKind.get(l.kind)!;
    });
    let left = random() * weights.reduce((a, b) => a + b, 0);
    for (let i = 0; i < pool.length; i++) if ((left -= weights[i]) <= 0) return pool[i];
    return pool[pool.length - 1];
  }
  const flowing = looks.filter(pace);
  return [...(flowing.length ? flowing : looks)].sort((a, b) => outOfRange(a, intensity) - outOfRange(b, intensity))[0];
}

/** Following the music: which look, when, and why. */
export class LookChooser {
  private current: LiveLook | null = null;
  private since = 0;
  private phraseAt = Infinity;
  private phrases = 0;
  private songAt = 0;
  private settled = true;
  private lastEvent = -Infinity;
  private lastDrop = -Infinity;
  private farSince: number | null = null;
  private quietSince: number | null = null;
  private recent: string[] = [];

  constructor(
    private readonly looks: readonly LiveLook[],
    private readonly random: () => number = Math.random,
  ) {}

  /** The look shown, whoever chose it (a key, the assistant): its phrases count from `time`. */
  shown(look: string, time: number, bar: number): void {
    const next = this.looks.find((l) => l.id === look) ?? null;
    if (next?.id !== this.current?.id) {
      this.current = next;
      this.since = time;
      this.phrases = 0;
      this.farSince = null;
      this.recent = [...this.recent.filter((id) => id !== look), look].slice(-RECENT);
    }
    this.phraseAt = time + PHRASE_BARS * bar;
  }

  /** The look playing (as last shown). */
  get look(): string | null {
    return this.current?.id ?? null;
  }

  /** A new song: something minimal until its kind is known (it has just started: nothing much is). */
  song(m: Moment): Choice {
    this.songAt = m.time;
    this.settled = false;
    this.lastEvent = Math.max(this.lastEvent, ...m.mood.events.map((e) => e.time));
    this.lastDrop = Math.max(this.lastDrop, m.drop ?? -Infinity);
    const look = pickLook(this.looks, m.mood, this.recent, this.random, "minimal");
    return { look: look.id, how: "now", reason: "song", why: `a new song: ${look.name}, minimal, until it's known what kind of song it is` };
  }

  /** A look for the moment, the rest left as it is (the every-so-many-bars switches). */
  pick(m: Moment, why: string): Choice {
    const look = pickLook(this.looks, m.mood, this.recent, this.random);
    return { look: look.id, how: "bar", reason: "schedule", why: `${why}: ${look.name} (${heard(m.mood)}; it suits ${look.suits.characters.join("/")}, ${range(look)})` };
  }

  /** Each frame, following the music: a change, or null (most frames). */
  follow(m: Moment): Choice | null {
    const { mood, time } = m;
    const look = this.current;
    if (!look) return { ...this.pick(m, "nothing shown"), reason: "fit" };
    // Between songs (or a long silence): something minimal.
    this.quietSince = mood.intensity < QUIET ? (this.quietSince ?? time) : null;
    if (this.quietSince !== null && time - this.quietSince > 2 && !look.suits.minimal) {
      const next = pickLook(this.looks, mood, this.recent, this.random, "minimal");
      return { look: next.id, how: "bar", reason: "quiet", why: `quiet (between songs): ${next.name}, minimal` };
    }
    // The song's kind known: a look for it.
    if (!this.settled && ((known(mood) && time - this.songAt > 4) || time - this.songAt > SETTLE_SECONDS)) {
      this.settled = true;
      if (!suits(look, mood) || look.suits.minimal) {
        const next = pickLook(this.looks, mood, this.recent, this.random);
        return { look: next.id, how: "bar", reason: "fit", why: `the song is ${heard(mood)}: ${next.name} (suits ${next.suits.characters.join("/")}, ${range(next)})` };
      }
    }
    // A drop, heard as its kick lands: cut to an intense look there (a slow song's blends in).
    if (m.drop !== undefined && m.drop > this.lastDrop) {
      this.lastDrop = m.drop;
      if (time - this.since > SETTLE_LOOK && time - m.drop < 1) {
        const next = pickLook(this.looks, mood, this.recent, this.random, "intense");
        if (isSlow(mood)) return { look: next.id, how: "now", reason: "drop", why: `the drop (${heard(mood)}): ${next.name} (${range(next)}), blended in` };
        return { look: next.id, how: "cut", reason: "drop", at: m.drop, why: `the drop (${heard(mood)}): ${next.name} (${range(next)}), cut on its kick` };
      }
    }
    // A breakdown just heard: a calm look (a build-up keeps its look: it lands on the drop).
    const event = mood.events.at(-1);
    if (event && event.time > this.lastEvent) {
      this.lastEvent = event.time;
      if (event.kind === "breakdown" && time - this.since > SETTLE_LOOK && time - event.time < 2) {
        const next = pickLook(this.looks, mood, this.recent, this.random, "calm");
        return { look: next.id, how: "bar", reason: "breakdown", why: `a breakdown (${heard(mood)}): ${next.name} (${range(next)})` };
      }
    }
    // Far outside its range (or not flowing, on a slow song) for a couple of bars: changed now, not at the phrase's end.
    const still = !paced(look, mood);
    const off = still ? 1 : outOfRange(look, felt(mood));
    this.farSince = off > FAR ? (this.farSince ?? time) : null;
    if (this.farSince !== null && time - this.farSince > 2 * m.bar && mood.section !== "build") {
      const next = pickLook(this.looks, mood, this.recent, this.random);
      const why = still ? "doesn't flow, and the song is slow" : `is far from the music (intensity ${mood.intensity.toFixed(2)}, it suits ${range(look)})`;
      return { look: next.id, how: "bar", reason: "fit", why: `${look.name} ${why}: ${next.name}` };
    }
    // A phrase's end: checked against the music, else mutated, varied, or after a while another look.
    if (time >= this.phraseAt) {
      this.phrases++;
      this.phraseAt = time + PHRASE_BARS * m.bar;
      if (mood.section === "build") return null;
      if (!suits(look, mood)) {
        const next = pickLook(this.looks, mood, this.recent, this.random);
        return { look: next.id, how: "bar", reason: "fit", why: `${look.name} no longer suits the music (${heard(mood)}; it suits ${look.suits.characters.join("/")}, ${range(look)}): ${next.name}` };
      }
      const most = look.kind === "chaos" ? MOST_PHRASES.chaos : MOST_PHRASES.other;
      if (this.phrases >= most) {
        const next = pickLook(this.looks, mood, this.recent.length ? this.recent : [look.id], this.random);
        return { look: next.id, how: "bar", reason: "phrase", why: `${most * PHRASE_BARS} bars of ${look.name}: ${next.name} (${heard(mood)})` };
      }
      if (look.kind === "chaos") return { look: look.id, how: "mutate", reason: "phrase", why: `a phrase: ${look.name} mutated` };
    }
    return null;
  }
}
