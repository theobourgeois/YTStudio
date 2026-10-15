/**
 * The preview engine's source for the visualizer (`PreviewSource`): the director's project at the listening
 * session's time, and its sound's signals as they grow (`LiveSignals`).
 *
 * Sync (`latencyOf`): the picture of a moment is seen a little after the app hears it (the analysis, the sound
 * arriving in chunks, drawing; and macOS capturing it before that), while the ears hear it when the speakers or
 * headphones play it (Bluetooth: ~150-250 ms after the computer sends it: Settings' delay, measured by tapping along).
 * What's known ahead of time (the beat, and kicks on it) is shown early by the difference (`LiveSignals.lead`);
 * when the ears are the later ones, everything waits for them instead.
 */
import type { SignalReader } from "@shared/audio-signals";
import { LIVE_ASSET, PADS_ASSET, coverAsset } from "@shared/live-looks";
import { previewSlots, sequenceAssets } from "@shared/sequences";
import type { LiveSignals } from "@shared/signals/live";
import type { MediaAsset, Project } from "@shared/types";
import type { PreviewEngine, PreviewSource } from "@/components/preview/engine";
import type { LiveDirector } from "./director";

/** Where the picture's delay comes from (seconds), and what's done about it. */
export interface Latency {
  /** The analysis needs this much sound after a moment. */
  analysis: number;
  /** Sound arrives in chunks this long. */
  chunks: number;
  /** A frame waits for its turn (half a frame, on average), then is seen a frame later (one on the GPU at a time). */
  drawing: number;
  /** macOS hands the app the sound this late (a guess). */
  capture: number;
  /** The ears hear it this much later than the computer sends it (Settings: headphones). */
  ears: number;
  /** The picture's delay against the ears: positive, it's late. */
  total: number;
  /** What's known ahead (the beat, kicks on it) is shown this early. */
  lead: number;
  /** Everything waits this long for the ears (headphones slower than the picture). */
  wait: number;
}

/** The latency model: the picture's own delay, against the ears' (see the file's comment). */
export function latencyOf(parts: Pick<Latency, "analysis" | "chunks" | "drawing" | "capture" | "ears">): Latency {
  const picture = parts.analysis + parts.chunks / 2 + parts.drawing + parts.capture;
  const total = picture - parts.ears;
  return { ...parts, total, lead: Math.max(0, total), wait: Math.max(0, -total) };
}

/** Seconds macOS takes to hand the app the sound it's sending to the speakers (a guess: it can't be asked). */
export const CAPTURE_SECONDS = 0.01;
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
  /** The window whose frames it ticks on: the one the picture is in (`drawIn`). */
  private frames: Window = window;
  private tickFrame: (() => void) | null = null;
  /** A frame's length, smoothed (seconds). */
  private frameSeconds = 1 / 60;
  /** The newest sound's moment and when it was seen here (for taps). */
  private received = { at: 0, sound: 0 };
  /** The latency as of the last frame. */
  latency: Latency = latencyOf({ analysis: 0, chunks: 0, drawing: 1.5 / 60, capture: CAPTURE_SECONDS, ears: 0 });

  constructor(
    private readonly director: LiveDirector,
    private readonly live: () => { signals: LiveSignals; session: string } | null,
    /** How much later the ears hear the sound than the computer sends it (seconds; Settings). */
    private readonly ears: () => number,
    /** Seconds of sound each chunk from the audio thread carries. */
    private readonly chunkSeconds: number,
    /** Each frame, before it's drawn, with the time it's drawn at. */
    private readonly onTick: (time: number) => void,
    /** The song's cover (a URL), for looks that show it. */
    private readonly cover: () => string | null,
  ) {}

  private assets: { project: Project | null; cover: string | null; list: MediaAsset[] } = { project: null, cover: null, list: [] };

  /** The time the picture is at (session seconds). */
  get now(): number {
    return this.time;
  }

  get() {
    const project = this.director.project;
    const cover = this.cover();
    // The same list while nothing in it changes (the engine indexes it again when it does).
    if (this.assets.project !== project || this.assets.cover !== cover) {
      this.assets = { project, cover, list: [...sequenceAssets(project), ...(cover ? [coverAsset(cover)] : [])] };
    }
    return { project, assets: this.assets.list, time: this.time, playing: true };
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
      this.frame = this.frames.requestAnimationFrame(tick);
      const live = this.live();
      if (!live) return;
      const now = performance.now();
      const dt = Math.min(0.1, (now - this.last) / 1000);
      this.last = now;
      if (dt > 0) this.frameSeconds += (dt - this.frameSeconds) * 0.05;
      const newest = live.signals.seconds;
      this.received = { at: now, sound: newest + live.signals.delay };
      this.latency = latencyOf({ analysis: live.signals.delay, chunks: this.chunkSeconds, drawing: 1.5 * this.frameSeconds, capture: CAPTURE_SECONDS, ears: this.ears() });
      // In 5 ms steps: a new lead rebuilds the signals' header.
      live.signals.lead = Math.round(this.latency.lead * 200) / 200;
      const target = Math.max(0, newest - this.latency.wait);
      this.time = Math.abs(target - this.time) > JUMP ? target : this.time + dt + (target - this.time) * CATCH_UP;
      // Never past what's been measured.
      this.time = Math.max(0, Math.min(this.time, newest));
      this.onTick(this.time);
      for (const listener of this.listeners) listener();
    };
    this.tickFrame = tick;
    this.frame = this.frames.requestAnimationFrame(tick);
  }

  stop(): void {
    this.running = false;
    this.cancelFrame();
  }

  /**
   * Tick on `win`'s frames: the window the picture is in (its own, popped out of the app). A window only has frames
   * while it's seen, and one that's closed has none.
   */
  drawIn(win: Window): void {
    if (win === this.frames) return;
    this.cancelFrame();
    this.frames = win;
    if (this.running && this.tickFrame) this.frame = win.requestAnimationFrame(this.tickFrame);
  }

  private cancelFrame() {
    try {
      this.frames.cancelAnimationFrame(this.frame);
    } catch {
      // its window is gone
    }
  }

  /** A new session starts at 0. */
  restart(): void {
    this.time = 0;
  }

  /**
   * A tap on the beat at `at` (performance.now): how much later than the computer sends the sound the tapper
   * heard its nearest beat (seconds), or null without a beat. Headphones' delay is the taps' median.
   */
  tap(at: number): number | null {
    const beats = this.live()?.signals.beats ?? [];
    if (beats.length < 2) return null;
    const heard = this.received.sound + (at - this.received.at) / 1000;
    let nearest = beats[0];
    for (const b of beats) if (Math.abs(b - heard) < Math.abs(nearest - heard)) nearest = b;
    return heard - nearest;
  }
}

/**
 * The hidden images the engine draws pictures from (the song's cover, in looks that show it): a pair per video track
 * of the project, nested ones too (`previewSlots`), made and let go as looks come and go. Read across origins
 * (Spotify's covers are served with CORS), so the GPU may draw them.
 */
export class ImageSlots {
  private attached = new Map<string, { els: HTMLImageElement[]; release: (() => void)[] }>();
  private of: readonly string[] | null = null;

  constructor(private readonly box: HTMLElement) {}

  sync(engine: PreviewEngine, project: Project): void {
    const slots = previewSlots(project).video;
    if (slots === this.of) return;
    this.of = slots;
    for (const [id, slot] of this.attached) {
      if (slots.includes(id)) continue;
      for (const release of slot.release) release();
      for (const el of slot.els) el.remove();
      this.attached.delete(id);
    }
    for (const id of slots) {
      if (this.attached.has(id)) continue;
      const els = [0, 1].map(() => {
        const img = document.createElement("img");
        img.crossOrigin = "anonymous";
        img.decoding = "async";
        img.alt = "";
        this.box.append(img);
        return img;
      });
      this.attached.set(id, { els, release: els.map((el, i) => engine.attachImage(id, i as 0 | 1, el)) });
    }
  }

  dispose(): void {
    for (const slot of this.attached.values()) {
      for (const release of slot.release) release();
      for (const el of slot.els) el.remove();
    }
    this.attached.clear();
  }
}
