/**
 * The preview engine's source for the visualizer (`PreviewSource`): the director's project at the listening
 * session's time, and its sound's signals as they grow (`LiveSignals`). The time follows the clock smoothly and
 * stays a little behind the newest sound measured (a waveform is read either side of its moment), plus the sync
 * offset Settings gives (headphones play later than the computer sends).
 */
import type { SignalReader } from "@shared/audio-signals";
import { LIVE_ASSET, PADS_ASSET } from "@shared/live-looks";
import { sequenceAssets } from "@shared/sequences";
import type { LiveSignals } from "@shared/signals/live";
import type { PreviewSource } from "@/components/preview/engine";
import type { LiveDirector } from "./director";

/** Seconds the picture stays behind the newest sound measured: half a visualizer's waveform window, and a little. */
const BEHIND = 0.045;
/** How much of the gap to where it should be the clock closes each frame (smooth, but never far off). */
const CATCH_UP = 0.08;
/** Further off than this, it jumps there. */
const JUMP = 0.4;

export class LiveSource implements PreviewSource {
  private listeners = new Set<() => void>();
  private time = 0;
  private last = 0;
  private frame = 0;
  private running = false;

  constructor(
    private readonly director: LiveDirector,
    private readonly live: () => { signals: LiveSignals; session: string } | null,
    /** The sync offset, seconds (the picture this much later). */
    private readonly offset: () => number,
    /** Each frame, before it's drawn, with the time it's drawn at. */
    private readonly onTick: (time: number) => void,
  ) {}

  /** The time the picture is at (session seconds). */
  get now(): number {
    return this.time;
  }

  get() {
    const project = this.director.project;
    return { project, assets: sequenceAssets(project), time: this.time, playing: true };
  }

  subscribe(listener: () => void) {
    this.listeners.add(listener);
    return () => void this.listeners.delete(listener);
  }

  signals(): SignalReader | null {
    const live = this.live();
    if (!live) return null;
    return {
      document: this.director.project,
      // A new store each frame: what's read from it never goes stale (the session keeps simulations' states).
      store: new Map([
        [LIVE_ASSET, live.signals.data()],
        [PADS_ASSET, this.director.pads],
      ]),
      live: live.session,
    };
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.last = performance.now();
    const tick = () => {
      if (!this.running) return;
      this.frame = requestAnimationFrame(tick);
      const live = this.live();
      if (!live) return;
      const now = performance.now();
      const dt = Math.min(0.1, (now - this.last) / 1000);
      this.last = now;
      const newest = live.signals.seconds;
      const target = Math.max(0, newest - BEHIND - this.offset());
      this.time = Math.abs(target - this.time) > JUMP ? target : this.time + dt + (target - this.time) * CATCH_UP;
      // Never past what's been heard.
      this.time = Math.max(0, Math.min(this.time, newest - 0.02));
      this.onTick(this.time);
      for (const listener of this.listeners) listener();
    };
    this.frame = requestAnimationFrame(tick);
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.frame);
  }

  /** A new session starts at 0. */
  restart(): void {
    this.time = 0;
  }
}
