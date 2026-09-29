import { playbackCorrection } from "./sync";

/** Paused elements closer than this to their target aren't re-seeked. */
const SEEK_EPS = 1e-3;
/** Upper bound for the look-ahead added to seeks made during playback. */
const MAX_SEEK_LEAD = 0.5;

/**
 * Wraps one <video>/<audio> element and makes it cheap to drive every frame:
 * `src` is only reassigned when it changes, seeks wait for metadata and are
 * coalesced while a seek is in flight (the last requested target always wins),
 * and property writes are skipped when the value is already right.
 */
export class MediaSlot {
  private src: string | null = null;
  /** Seek target waiting for metadata or for the in-flight seek to finish. */
  private pending: number | null = null;
  private seekStartedAt = 0;
  /** Recent seek latency, added as look-ahead when seeking while playing. */
  private seekLead = 0;
  failed = false;
  private frameCallback: number | null = null;

  constructor(
    readonly el: HTMLMediaElement,
    private readonly onChange: () => void,
    /** A video presented a new frame (the preview draws it). */
    private readonly onFrame?: () => void,
  ) {
    el.addEventListener("loadedmetadata", this.flush);
    el.addEventListener("loadeddata", this.onChange);
    el.addEventListener("seeked", this.onSeeked);
    el.addEventListener("error", this.onError);
    if (onFrame && el instanceof HTMLVideoElement && "requestVideoFrameCallback" in el) this.watchFrames();
  }

  private watchFrames = () => {
    const video = this.el as HTMLVideoElement;
    this.frameCallback = video.requestVideoFrameCallback(() => {
      this.onFrame?.();
      this.watchFrames();
    });
  };

  private get ready() {
    return this.src !== null && this.el.readyState >= HTMLMediaElement.HAVE_METADATA;
  }

  setSrc(src: string | null) {
    if (src === this.src) return;
    this.src = src;
    this.pending = null;
    this.failed = false;
    // Assigning a src restarts the load algorithm, which also pauses the element.
    if (src) this.el.src = src;
    else {
      this.el.removeAttribute("src");
      this.el.load();
    }
  }

  /** `keepPitch`: at a rate other than 1, time-stretch the sound rather than let its pitch follow. */
  setAudio(volume: number, muted: boolean, keepPitch = true) {
    if (this.el.volume !== volume) this.el.volume = volume;
    if (this.el.muted !== muted) this.el.muted = muted;
    if (this.el.preservesPitch !== keepPitch) this.el.preservesPitch = keepPitch;
  }

  /** Paused at exactly `time` (scrubbing, stepping, stopped). */
  hold(time: number) {
    if (!this.el.paused) this.el.pause();
    this.setRate(1);
    this.seek(time);
  }

  /**
   * Playing in step with the clock, which says we should be at `time` now,
   * moving `speed` media seconds per second (a clip's speed).
   */
  follow(time: number, speed = 1) {
    const el = this.el;
    if (!this.ready) {
      // Keep the target fresh; `loadedmetadata` seeks there, a later tick starts playback.
      this.pending = time;
      return;
    }
    // While playing, seeks are issued here with look-ahead; drop any stale scrub target.
    this.pending = null;
    if (el.seeking) return;
    const audible = !el.muted && el.volume > 0;
    // Drift in timeline seconds, so a fast clip isn't re-seeked any sooner.
    const { seek, rate } = playbackCorrection((el.currentTime - time) / speed, audible);
    if (seek) this.seekNow(time + this.seekLead * speed);
    this.setRate(rate * speed);
    // An element that ran into the end of its media would restart from 0 on play().
    if (el.paused && !el.ended) {
      el.play().catch((err: unknown) => {
        if (!(err instanceof DOMException && err.name === "AbortError")) console.warn(err);
      });
    }
  }

  pause() {
    if (!this.el.paused) this.el.pause();
  }

  dispose() {
    if (this.frameCallback !== null) (this.el as HTMLVideoElement).cancelVideoFrameCallback(this.frameCallback);
    this.frameCallback = null;
    this.el.removeEventListener("loadedmetadata", this.flush);
    this.el.removeEventListener("loadeddata", this.onChange);
    this.el.removeEventListener("seeked", this.onSeeked);
    this.el.removeEventListener("error", this.onError);
    this.setSrc(null);
  }

  private seek(time: number) {
    if (!this.ready || this.el.seeking) {
      this.pending = time;
      return;
    }
    this.pending = null;
    if (Math.abs(this.el.currentTime - time) > SEEK_EPS) this.seekNow(time);
  }

  private seekNow(time: number) {
    this.seekStartedAt = performance.now();
    this.el.currentTime = time;
  }

  private setRate(rate: number) {
    if (this.el.playbackRate !== rate) this.el.playbackRate = rate;
  }

  private flush = () => {
    if (this.pending !== null) this.seek(this.pending);
  };

  private onSeeked = () => {
    this.seekLead = Math.min(MAX_SEEK_LEAD, (performance.now() - this.seekStartedAt) / 1000);
    this.flush();
    this.onChange();
  };

  private onError = () => {
    // Removing the src (setSrc(null)) raises an error event too; only real failures count.
    if (this.src === null) return;
    this.failed = true;
    this.onChange();
  };
}

/** Wraps the <img> showing a still-image clip: `src` is only reassigned when it changes. */
export class ImageSlot {
  private src: string | null = null;
  failed = false;

  constructor(
    readonly el: HTMLImageElement,
    private readonly onChange: () => void,
  ) {
    el.addEventListener("error", this.onError);
    // The preview draws the image itself, so it needs to know when there's something to draw.
    el.addEventListener("load", this.onChange);
  }

  setSrc(src: string | null) {
    if (src === this.src) return;
    this.src = src;
    this.failed = false;
    if (src) this.el.src = src;
    else this.el.removeAttribute("src");
  }

  dispose() {
    this.el.removeEventListener("error", this.onError);
    this.el.removeEventListener("load", this.onChange);
    this.setSrc(null);
  }

  private onError = () => {
    if (this.src === null) return;
    this.failed = true;
    this.onChange();
  };
}
