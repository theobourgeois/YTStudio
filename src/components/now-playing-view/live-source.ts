/**
 * The preview engine's source for the visualizer (`PreviewSource`): the director's project at the listening
 * session's time, and its sound's signals as they grow (`LiveSignals`). The time follows the clock smoothly and
 * stays a little behind the newest sound measured (a waveform is read either side of its moment), plus the sync
 * offset Settings gives (headphones play later than the computer sends).
 */
import type { SignalReader } from "@shared/audio-signals";
import { LIVE_ASSET, PADS_ASSET, coverAsset } from "@shared/live-looks";
import { previewSlots, sequenceAssets } from "@shared/sequences";
import type { LiveSignals } from "@shared/signals/live";
import type { MediaAsset, Project } from "@shared/types";
import type { PreviewEngine, PreviewSource } from "@/components/preview/engine";
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
