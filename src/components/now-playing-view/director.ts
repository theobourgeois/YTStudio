/**
 * What the visualizer shows over time (docs/now-playing.md): the looks one after another on a track, each switch
 * through one of the editor's transitions, the keys' punches and the perform layer's hue, as the project the preview
 * engine plays (`liveProject`). Looks already past are let go. Times are the listening session's seconds.
 */
import {
  type LiveLook,
  type LookContext,
  type Pad,
  type PadHit,
  type Showing,
  endShow,
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

  /** Let go of looks that ended before `now` (a second's grace), and of pads' hits long past. */
  prune(now: number): void {
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
    this.perform = performLayer(this.hueDegrees);
    this.cached = null;
  }

  /** Start again from nothing (a new listening session: its time starts again at 0). */
  reset(): void {
    this.shows = [];
    this.hits = [];
    this.padData = padSignals([]);
    this.cached = null;
  }
}
