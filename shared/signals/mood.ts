/**
 * The mood of a sound heard live (Now Playing; `live.ts` keeps one): how intense it is now, which bands are getting
 * busier or quieter, where the song is (a build-up, a drop, a breakdown), and what kind of song it is (chill, groove,
 * hype, heavy), so the visualizer can pick and drive its looks to match (docs/now-playing.md, step 2 of the plan).
 *
 * Intensity is Synesthesia's idea: not how loud this instant is, but how much is going on over the last few seconds
 * (loudness against full scale and against the song's own loud parts, hits a second in each band, kicks a second, the
 * sub-bass's share), rising fast and falling slowly. Presence is a band's activity rising or falling, not each sound. The song's
 * character is what its intensity, density, beat and tone have been since it started, settled after ~20 s and steady;
 * how slow it is (`slowness`) is apart from it: a slow song is never hype, and the visualizer flows on one.
 * Pure: the tests feed it made-up music.
 */
import { SCALARS, SIGNAL_RATE, type Hit, type IntensitySeries, type ScalarName, type SignalData } from "./format.ts";

export type SongCharacter = "chill" | "groove" | "hype" | "heavy";
export const SONG_CHARACTERS: readonly SongCharacter[] = ["chill", "groove", "hype", "heavy"];

/** Where the song is: before anything much (`intro`), going along (`steady`), building, dropped, broken down. */
export type Section = "intro" | "steady" | "build" | "drop" | "breakdown";

export interface MoodEvent {
  kind: "build" | "drop" | "breakdown";
  /** Seconds (the listening session's). */
  time: number;
}

export interface Mood {
  /** How much is going on over the last few seconds, 0..1 (rising fast, falling slowly). */
  intensity: number;
  /** Each band's activity rising (up to 1) or falling (down to -1), over the last couple of seconds. */
  presence: { low: number; mid: number; high: number };
  section: Section;
  /** When the section started (seconds). */
  sectionSince: number;
  /** What kind of song this is (null until a few seconds of it are heard). */
  character: SongCharacter | null;
  /** How sure of it, 0..1 (low for the song's first seconds, and between close calls). */
  sure: number;
  /** Each character's score, 0..1 (what `character` is the highest of). */
  scores: Record<SongCharacter, number>;
  /** How slow the song is, 0..1 (`slowness`; 0 until its beat is known): a slow one flows (`isSlow`). */
  slow: number;
  /** The section changes so far, newest last (the last few). */
  events: MoodEvent[];
  /**
   * What intensity and character are made of, over the last few seconds (the visualizer's readout shows them):
   * loudness (dB), hits a second (each band's), kicks a second, the sub-bass's share (0..1), brightness (Hz).
   */
  heard: { loudness: number; hits: number; kicks: number; sub: number; brightness: number };
}

/** Seconds of sound intensity looks at, presence compares, and a build-up's rise is measured over. */
const INTENSITY_SECONDS = 3;
const PRESENCE_RECENT = 2;
const PRESENCE_BEFORE = 6;
const BUILD_SECONDS = 4;
/** Intensity follows its measure up over this long, down over this long (seconds). */
const RISE = 0.6;
const FALL = 2;
/** A build-up: intensity rising this much a second over `BUILD_SECONDS`, below this. */
const BUILD_SLOPE = 0.03;
const BUILD_BELOW = 0.85;
/** Or the low end gone and the highs rising this much (`presence.high`): a riser, a snare roll. */
const RISER = 0.35;
/** A breakdown: intensity this far under the last 12 s's highest, with next to no kicks for 2 s. */
const BREAKDOWN_FALL = 0.22;
/** A drop, then this long, is just how the song goes. */
const DROP_HOLDS = 12;
/** A song's character settles over its first seconds, and another must lead this long to take over. */
const SETTLE_SECONDS = 20;
const CHARACTER_PATIENCE = 6;
const MAX_EVENTS = 8;

const S = SCALARS.length;
const INDEX = Object.fromEntries(SCALARS.map((s, i) => [s, i])) as Record<ScalarName, number>;
/** Hits a second (all bands) that are a busy track, kicks a second that are a driving one. */
const BUSY = 10;
const DRIVING = 2.2;
/** A song this much slow or more is a slow one (`slowness`). */
export const SLOW = 0.5;
/** Tempos (BPM, as felt) from not slow to all slow; and hits a second from sparse (slow) to too busy to be. */
const SLOW_BPM = [98, 78] as const;
const SLOW_HITS = [7, 14] as const;
/** Seconds a song's slowness takes to follow what's heard (most of the way). */
const SLOW_FOLLOWS = 6;
/** Fewer kicks than this on each of the beat's beats: it's half time (a ballad's beat read at double speed). */
const HALF_TIME_KICKS = 0.35;

/**
 * How slow a song feels, 0..1: its tempo as felt (the beat's halved when it's fast with few kicks on it, as a ballad's
 * at 70 is read at 140), and only if it's sparse (a busy track at 90 isn't slow). 0 while the tempo isn't known.
 */
export function slowness(bpm: number, kicksPerSecond: number, hitsPerSecond: number): number {
  if (!(bpm > 0)) return 0;
  const felt = bpm >= 120 && kicksPerSecond / (bpm / 60) < HALF_TIME_KICKS ? bpm / 2 : bpm;
  const tempo = clamp01((SLOW_BPM[0] - felt) / (SLOW_BPM[0] - SLOW_BPM[1]));
  const sparse = 1 - clamp01((hitsPerSecond - SLOW_HITS[0]) / (SLOW_HITS[1] - SLOW_HITS[0]));
  return Math.round(tempo * sparse * 100) / 100;
}

/** Whether a song is a slow one: its looks flow, and change by blending into each other. */
export const isSlow = (mood: Pick<Mood, "slow">) => mood.slow >= SLOW;

/** Seconds of kicks that say whether there are any lately (a breakdown has none). */
const KICKS_LATELY = 1.5;
/** No build-up in listening's first seconds (intensity rises from nothing). */
const WARM_UP = 8;
const LOW_BANDS: ScalarName[] = ["sub", "bass"];
const MID_BANDS: ScalarName[] = ["lowMid", "mid", "upperMid"];
const HIGH_BANDS: ScalarName[] = ["presence", "air"];
const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/** The energy mean of some dB scalars (summed as energies) over frames [from, to), in dB. */
function meanDb(data: SignalData, names: readonly ScalarName[], from: number, to: number): number {
  const a = Math.max(0, Math.floor(from));
  const b = Math.min(data.header.frames, Math.floor(to));
  if (b <= a) return -120;
  let power = 0;
  for (let f = a; f < b; f++) for (const n of names) power += 10 ** (data.scalars[f * S + INDEX[n]] / 10);
  return 10 * Math.log10(power / (b - a) + 1e-12);
}

/** The mean of a scalar over frames [from, to). */
function mean(data: SignalData, name: ScalarName, from: number, to: number): number {
  const a = Math.max(0, Math.floor(from));
  const b = Math.min(data.header.frames, Math.floor(to));
  if (b <= a) return 0;
  let sum = 0;
  for (let f = a; f < b; f++) sum += data.scalars[f * S + INDEX[name]];
  return sum / (b - a);
}

/** Hits at least `velocity` hard between two moments, a second. */
function rate(hits: readonly Hit[], from: number, to: number, velocity: number): number {
  let n = 0;
  for (let i = hits.length - 1; i >= 0 && hits[i][0] >= from; i--) if (hits[i][0] <= to && hits[i][1] >= velocity) n++;
  return n / Math.max(0.001, to - from);
}

/** What a song has sounded like so far (for its character). */
interface SongTally {
  since: number;
  updates: number;
  intensity: number[];
  density: number;
  kicks: number;
  steadyBeat: number;
  sub: number;
  bright: number;
  loud: number;
  bpm: number;
  /** How slow it's been lately (`slowness`, followed over `SLOW_FOLLOWS` while the beat's known). */
  slow: number;
}

const newTally = (since: number): SongTally => ({
  since,
  updates: 0,
  intensity: [],
  density: 0,
  kicks: 0,
  steadyBeat: 0,
  sub: 0,
  bright: 0,
  loud: 0,
  bpm: 0,
  slow: 0,
});

/** Follows a sound's mood (see the file's comment): `update` every quarter of a second or so. */
export class LiveMood {
  private intensity = 0;
  private history: { time: number; intensity: number; kicks: number }[] = [];
  private section: Section = "intro";
  private sectionSince = 0;
  private events: MoodEvent[] = [];
  private lastDrop = -Infinity;
  private song = newTally(0);
  private character: SongCharacter | null = null;
  private challenger: { character: SongCharacter; since: number } | null = null;
  private scores: Record<SongCharacter, number> = { chill: 0, groove: 0, hype: 0, heavy: 0 };
  private sure = 0;
  private slow = 0;
  private presence = { low: 0, mid: 0, high: 0 };
  private heard = { loudness: -120, hits: 0, kicks: 0, sub: 0, brightness: 0 };
  private started = -Infinity;
  private last = -Infinity;

  /** A new song started at `time`: its character is found afresh (the sections go on). */
  newSong(time: number): void {
    this.song = newTally(time);
    this.challenger = null;
    this.sure = 0;
    this.slow = 0;
  }

  /** The mood as of the last update. */
  get mood(): Mood {
    return {
      intensity: Math.round(this.intensity * 1000) / 1000,
      presence: this.presence,
      section: this.section,
      sectionSince: this.sectionSince,
      character: this.character,
      sure: Math.round(this.sure * 100) / 100,
      scores: this.scores,
      slow: this.slow,
      events: this.events,
      heard: this.heard,
    };
  }

  /** Read the sound heard up to `now` (seconds): `data` its signals, `steadyBeat` whether hits are expected on the beat. */
  update(data: SignalData, now: number, steadyBeat: boolean): void {
    const dt = Number.isFinite(this.last) ? Math.max(0, now - this.last) : 0;
    this.last = now;
    if (!Number.isFinite(this.started)) this.started = now;
    const f = (t: number) => t * SIGNAL_RATE;
    const reference = data.header.reference;
    const hits = data.header.hits;

    // How much is going on lately.
    const loud = meanDb(data, ["level"], f(now - INTENSITY_SECONDS), f(now));
    const loudAgainstSong = clamp01(1 + (loud - (reference.level ?? -20)) / 12);
    const loudAgainstFull = clamp01((loud + 32) / 24);
    // Each band's own hits (the loudest band's would hide the others' in all of them together).
    const from = now - INTENSITY_SECONDS;
    const density = rate(hits.onsetLow, from, now, 0.25) + rate(hits.onsetMid, from, now, 0.25) + rate(hits.onsetHigh, from, now, 0.25);
    const kicks = rate(hits.onsetLow, from, now, 0.3);
    const kicksLately = rate(hits.onsetLow, now - KICKS_LATELY, now, 0.3);
    // The sub-bass against everything: near 0 dB in heavy music, ~ -4 dB under a club bassline, nothing in a pad.
    const sub = clamp01((meanDb(data, ["sub"], f(from), f(now)) - loud + 6) / 6);
    const brightness = mean(data, "brightness", f(from), f(now));
    this.heard = { loudness: round2(loud), hits: round2(density), kicks: round2(kicks), sub: round2(sub), brightness: Math.round(brightness) };
    const measured = clamp01(0.25 * loudAgainstFull + 0.15 * loudAgainstSong + 0.35 * clamp01(density / BUSY) + 0.15 * clamp01(kicks / DRIVING) + 0.1 * sub);
    const silent = loud < -60;
    const target = silent ? 0 : measured;
    if (dt === 0) this.intensity = target;
    else this.intensity += (target - this.intensity) * (1 - Math.exp(-dt / (target > this.intensity ? RISE : FALL)));

    // Each band rising or falling.
    const band = (names: ScalarName[]) =>
      Math.max(-1, Math.min(1, (meanDb(data, names, f(now - PRESENCE_RECENT), f(now)) - meanDb(data, names, f(now - PRESENCE_RECENT - PRESENCE_BEFORE), f(now - PRESENCE_RECENT))) / 8));
    this.presence = { low: round2(band(LOW_BANDS)), mid: round2(band(MID_BANDS)), high: round2(band(HIGH_BANDS)) };

    this.history.push({ time: now, intensity: this.intensity, kicks: kicksLately });
    while (this.history.length && this.history[0].time < now - 16) this.history.shift();
    this.followSections(now, data.header.rhythm?.drops ?? [], silent);

    // The song so far.
    if (!silent) {
      const t = this.song;
      t.updates++;
      t.intensity.push(this.intensity);
      const blend = 1 / t.updates;
      t.density += (clamp01(density / BUSY) - t.density) * blend;
      t.kicks += (clamp01(kicks / DRIVING) - t.kicks) * blend;
      t.steadyBeat += ((steadyBeat ? 1 : 0) - t.steadyBeat) * blend;
      t.sub += (sub - t.sub) * blend;
      t.bright += (clamp01(Math.log(Math.max(1, brightness) / 300) / Math.log(30)) - t.bright) * blend;
      t.loud += (loudAgainstFull - t.loud) * blend;
      if (data.header.rhythm?.bpm) {
        t.bpm = data.header.rhythm.bpm;
        // Followed, not taken as it is: the beat's tempo can be wrong for a while (read at 3:2), or for a moment.
        // (What's heard lately, not the song's means, which are capped: a busy song is never sparse.)
        t.slow += (slowness(t.bpm, kicks, density) - t.slow) * (1 - Math.exp(-dt / SLOW_FOLLOWS));
      }
    }
    this.judgeCharacter(now);
  }

  /** Build-ups, drops and breakdowns, from the intensity's course (and the drops the signals found). */
  private followSections(now: number, drops: readonly { time: number }[], silent: boolean): void {
    const enter = (section: Section, time = now) => {
      if (section === this.section) return;
      this.section = section;
      this.sectionSince = time;
      if (section === "build" || section === "drop" || section === "breakdown") {
        this.events = [...this.events, { kind: section, time }].slice(-MAX_EVENTS);
      }
    };
    const drop = drops.at(-1);
    if (drop && drop.time > this.lastDrop) {
      this.lastDrop = drop.time;
      enter("drop", drop.time);
      return;
    }
    if (silent) return;
    const ago = (seconds: number) => this.history.find((h) => h.time >= now - seconds) ?? this.history[0];
    const then = ago(BUILD_SECONDS);
    const slope = then && now > then.time ? (this.intensity - then.intensity) / (now - then.time) : 0;
    const highest = Math.max(...this.history.filter((h) => h.time >= now - 12).map((h) => h.intensity));
    const noKicks = (this.history.at(-1)?.kicks ?? 0) < 0.3;
    const warm = now - this.started >= WARM_UP;

    // A build-up: the intensity climbing, or the low end gone and the highs rising (a riser, a roll); not a drop's
    // intensity catching up with it.
    const climbing = slope >= BUILD_SLOPE && this.intensity < BUILD_BELOW;
    const rising = this.presence.low <= -0.3 && this.presence.high >= RISER && this.intensity >= 0.25;
    const building = warm && (climbing || rising) && (this.section !== "drop" || rising) && now - this.lastDrop > 4;

    if (this.section !== "breakdown" && highest - this.intensity >= BREAKDOWN_FALL && noKicks && !rising) enter("breakdown");
    else if (this.section !== "build" && building) enter("build");
    // A build-up lasts until the drop, unless it stops building for a while (a false start).
    else if (this.section === "build" && !building && slope < BUILD_SLOPE / 3 && now - this.sectionSince > 4) enter("steady");
    else if (this.section === "drop" && now - this.sectionSince > DROP_HOLDS) enter("steady");
    else if (this.section === "breakdown" && !noKicks && slope >= 0) enter("steady");
    else if (this.section === "intro" && this.intensity >= 0.45 && now > 6) enter("steady");
  }

  /** What kind of song it's been, settling over its first seconds and steady after (see the file's comment). */
  private judgeCharacter(now: number): void {
    const t = this.song;
    if (t.updates < 8) return;
    const sorted = [...t.intensity].sort((a, b) => a - b);
    const typical = sorted[Math.floor(sorted.length / 2)];
    const fast = clamp01((t.bpm - 95) / 45) || 0;
    this.slow = round2(t.slow);
    // Each kind scored on what makes it that kind (each 0..1): calm and sparse; a steady beat, in the middle;
    // intense, busy and driving; intense with the sub-bass on top and dark. A slow song (however loud it's mastered)
    // leans calm, and is never hype.
    const scores: Record<SongCharacter, number> = {
      chill: clamp01((1 - typical) * (1 - t.density) * 1.5 + 0.3 * this.slow),
      groove: clamp01(t.steadyBeat * (1 - Math.abs(typical - 0.55) * 2.2) * (1 - t.sub * 0.5) * (1 - 0.4 * this.slow)),
      hype: clamp01(typical * (0.2 + 0.8 * t.density) * (0.6 + 0.4 * Math.max(fast, t.kicks)) * 1.4 * (1 - 0.7 * this.slow)),
      heavy: clamp01(typical * t.sub * (1 - t.bright * 0.5) * (0.5 + 0.5 * t.loud) * 2),
    };
    this.scores = Object.fromEntries(SONG_CHARACTERS.map((c) => [c, round2(scores[c])])) as Record<SongCharacter, number>;
    const ranked = [...SONG_CHARACTERS].sort((a, b) => scores[b] - scores[a]);
    const leader = ranked[0];
    const settled = clamp01((now - t.since) / SETTLE_SECONDS);
    const margin = scores[leader] > 0 ? (scores[leader] - scores[ranked[1]]) / scores[leader] : 0;
    // Early in a song (and with no character yet) the leader is taken as it is; later another has to keep leading.
    if (this.character === null || settled < 0.5) {
      this.character = leader;
      this.challenger = null;
    } else if (leader !== this.character) {
      if (this.challenger?.character !== leader) this.challenger = { character: leader, since: now };
      else if (now - this.challenger.since >= CHARACTER_PATIENCE) {
        this.character = leader;
        this.challenger = null;
      }
    } else this.challenger = null;
    // Sure: heard long enough, well ahead of the next, and a good fit at all (a weak leader isn't much of a call).
    this.sure = clamp01(settled * (0.4 + margin * 1.5) * clamp01(scores[leader] / 0.6)) * (this.character === leader ? 1 : 0.5);
  }
}

const round2 = (v: number) => Math.round(v * 100) / 100;

/** How often intensity is worked out (a second). */
export const INTENSITY_RATE = 4;

const fileSeries = new WeakMap<SignalData, IntensitySeries>();

/**
 * A sound's intensity over time: a live sound's as it was heard (`SignalData.intensity`), a file's worked out the
 * same way (only what came before each moment counts), once, when first read.
 */
export function intensitySeries(data: SignalData): IntensitySeries {
  if (data.intensity) return data.intensity;
  let series = fileSeries.get(data);
  if (!series) {
    const mood = new LiveMood();
    const values: number[] = [];
    const end = data.header.frames / SIGNAL_RATE;
    for (let k = 0; k / INTENSITY_RATE <= end; k++) {
      mood.update(data, k / INTENSITY_RATE, false);
      values.push(mood.mood.intensity);
    }
    fileSeries.set(data, (series = { rate: INTENSITY_RATE, values }));
  }
  return series;
}

/** A series' value at `t` seconds (between values linearly; past the ends, the end's). */
export function intensityAt(series: IntensitySeries, t: number): number {
  const n = series.values.length;
  if (!n) return 0;
  const x = Math.min(n - 1, Math.max(0, t * series.rate));
  const i = Math.floor(x);
  const a = series.values[i];
  return i + 1 < n ? a + (series.values[i + 1] - a) * (x - i) : a;
}
