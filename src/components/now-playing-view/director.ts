/**
 * What the visualizer shows over time (docs/now-playing.md): the looks one after another on a track, each switch
 * through one of the editor's transitions, the keys' punches and the perform layer's hue, as the project the preview
 * engine plays (`liveProject`). Looks already past are let go. Times are the listening session's seconds.
 */
import {
  type Frame,
  type FrameMove,
  type FxMove,
  type LiveFx,
  type LiveLook,
  type LookContext,
  type Pad,
  type PadHit,
  type Showing,
  NO_FX,
  PLAIN_FRAME,
  endShow,
  frameAngle,
  fxAt,
  liveProject,
  lookSequence,
  padSignals,
  performLayer,
  showClip,
} from "@shared/live-looks";
import type { SignalData } from "@shared/signals/format";
import type { Project, Transition } from "@shared/types";

/** Seconds a pad's hit is kept (long after its punch has died away). */
const PAD_MEMORY = 4;

export class LiveDirector {
  private shows: Showing[] = [];
  private hueDegrees = 0;
  private move: FrameMove | null = null;
  private morphing: { at: number; seconds: number } | null = null;
  private play: FxMove | null = null;
  private perform = performLayer(0);
  private hits: PadHit[] = [];
  private padData: SignalData = padSignals([]);
  private next = 1;
  private cached: Project | null = null;

  /** The project to draw now (the same object until something changes). */
  get project(): Project {
    return (this.cached ??= liveProject(this.shows, this.perform));
  }

  /** The look shown last (or coming in). */
  get look(): string | null {
    return this.shows.at(-1)?.look ?? null;
  }

  /** When the look shown last starts (session seconds), or null. */
  get lookStart(): number | null {
    return this.shows.at(-1)?.clip.start ?? null;
  }

  get hue(): number {
    return this.hueDegrees;
  }

  /** How the picture's framed (repeated, mirrored, turning, zoomed), as last asked. */
  get frame(): Frame {
    return this.move?.to ?? PLAIN_FRAME;
  }

  /**
   * Frame the picture as `frame` says, from `at` over `seconds` (eased; carrying on from where the last left it,
   * turned as it was), `upright` turning it back to straight as it goes.
   */
  setFrame(frame: Frame, at: number, seconds: number, upright = false): void {
    this.move = { from: this.frame, to: frame, at, seconds, angle: frameAngle(this.move, at), upright };
    this.rebuildPerform();
  }

  /** The player's distortions and feedback as last asked (where they're going). */
  get fx(): LiveFx {
    return this.play?.to ?? NO_FX;
  }

  /** Where the player's values have got to by `time` (a change eases there). */
  fxNow(time: number): LiveFx {
    return fxAt(this.play, time);
  }

  /**
   * The player's distortions and feedback over every look (vaudio's Distort and Feedback panels): from where they
   * are at `at`, eased over `seconds`.
   */
  setFx(fx: LiveFx, at: number, seconds: number): void {
    const from = fxAt(this.play, at);
    const none = (v: LiveFx) => (Object.keys(NO_FX) as (keyof LiveFx)[]).every((k) => v[k] === NO_FX[k]);
    this.play = none(from) && none(fx) ? null : { from, to: fx, at, seconds };
    this.rebuildPerform();
  }

  /** A feedback morph about a switch at `at` (`seconds` long): the looks melt into each other. */
  morph(at: number, seconds: number): void {
    this.morphing = { at, seconds };
    this.rebuildPerform();
  }

  private rebuildPerform(): void {
    this.perform = performLayer(this.hueDegrees, this.move, this.morphing, this.play);
    this.cached = null;
  }

  /** The pads' hits, as a sound's signals. */
  get pads(): SignalData {
    return this.padData;
  }

  /**
   * Show `look` (made for `ctx`) from `at`: through `transition` from what's shown, or at once. What's shown keeps
   * going until then.
   */
  show(look: LiveLook, ctx: LookContext, at: number, transition: Transition | null): void {
    const id = `seq_live${this.next++}`;
    const sequence = lookSequence(look, ctx, id);
    const clip = showClip(sequence, at, this.shows.length ? transition : null);
    const shows = this.shows.filter((s) => s.clip.start < at);
    const last = shows.at(-1);
    if (last) shows[shows.length - 1] = { ...last, clip: endShow(last.clip, at) };
    this.shows = [...shows, { look: look.id, sequence, clip }];
    this.cached = null;
  }

  /**
   * The looks on screen at `time`, oldest first: each from when it starts showing (half its transition before its
   * cut) until the next has come in, and when it's fully in.
   */
  shownAt(time: number): { look: string; from: number; full: number }[] {
    const on: { look: string; from: number; full: number }[] = [];
    this.shows.forEach((s, i) => {
      const half = (s.clip.transitionIn?.duration ?? 0) / 2;
      const next = this.shows[i + 1];
      const until = next ? next.clip.start + (next.clip.transitionIn?.duration ?? 0) / 2 : Infinity;
      if (time >= s.clip.start - half && time < until) on.push({ look: s.look, from: s.clip.start - half, full: s.clip.start + half });
    });
    return on;
  }

  /** Let go of looks that ended before `now` (a second's grace), of pads' hits long past, and of a morph played out. */
  prune(now: number): void {
    if (this.morphing && now > this.morphing.at + this.morphing.seconds + 2) {
      this.morphing = null;
      this.rebuildPerform();
    }
    const keep = this.shows.filter((s, i) => i === this.shows.length - 1 || s.clip.start + (s.clip.out - s.clip.in) > now - 1);
    if (keep.length !== this.shows.length) {
      this.shows = keep;
      this.cached = null;
    }
    if (this.hits.length && this.hits[0].time < now - PAD_MEMORY) {
      this.hits = this.hits.filter((h) => h.time >= now - PAD_MEMORY);
      this.padData = padSignals(this.hits);
    }
  }

  /** A key hit a pad at `time`. */
  hit(pad: Pad, time: number, velocity = 1): void {
    this.hits = [...this.hits, { pad, time, velocity }];
    this.padData = padSignals(this.hits);
  }

  /** Turn the colours by `degrees` (the hue keys). */
  setHue(degrees: number): void {
    this.hueDegrees = ((degrees % 360) + 360) % 360;
    this.rebuildPerform();
  }

  /** Start again from nothing (a new listening session: its time starts again at 0). */
  reset(): void {
    this.shows = [];
    this.hits = [];
    this.move = null;
    this.morphing = null;
    this.rebuildPerform();
    this.padData = padSignals([]);
    this.cached = null;
  }
}
