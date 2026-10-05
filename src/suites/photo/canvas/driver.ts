/**
 * Drives the canvas element outside React: a frame on the next animation frame whenever the document, the view or
 * the images change, bilinear while things move (the view, a layer's place) and Mitchell once they've been still a
 * moment (after fetching any evicted tiles the view needs). Edits that move nothing (an adjustment's slider,
 * opacity) stay final, so the composite kept below an adjustment is reused while it's dragged. Several requests in a
 * frame make one frame.
 */
import type { PhotoProject } from "@shared/photo/types";
import type { PhotoRenderer, FrameTiming } from "../render/renderer";
import type { Quality } from "../render/compositor";
import { usePhoto } from "../store";
import { usePhotoUi } from "../ui";

const SETTLE_MS = 120;

/** Whether an image layer moved between two documents (its transform is a new object only when it changed). */
export function layersMoved(prev: PhotoProject | undefined, next: PhotoProject | undefined): boolean {
  if (!prev || !next) return false;
  const before = new Map(prev.layers.map((l) => [l.id, l]));
  return next.layers.some((l) => {
    const was = before.get(l.id);
    return l.kind === "image" && was?.kind === "image" && was.transform !== l.transform;
  });
}

export class CanvasDriver {
  private frame: number | null = null;
  private quality: Quality = "final";
  private settleTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly unsubscribe: (() => void)[] = [];
  /** The last frames' timings, newest last (for the bench). */
  readonly timings: FrameTiming[] = [];

  constructor(readonly renderer: PhotoRenderer) {
    renderer.onChange = () => this.request("final");
    this.unsubscribe.push(
      usePhoto.subscribe((s, prev) => {
        const doc = s.history?.doc;
        if (doc !== prev.history?.doc) this.request(s.history?.gestureBase && layersMoved(prev.history?.doc, doc) ? "interactive" : "final");
      }),
      usePhotoUi.subscribe((s, prev) => {
        if (s.view !== prev.view) this.request("interactive");
      }),
    );
  }

  /** Draws on the next frame; "interactive" frames are followed by a final one once things are still. */
  request(quality: Quality = "final") {
    if (quality === "interactive") {
      this.quality = "interactive";
      if (this.settleTimer) clearTimeout(this.settleTimer);
      this.settleTimer = setTimeout(() => {
        this.settleTimer = null;
        void this.settle();
      }, SETTLE_MS);
    } else if (!this.settleTimer) this.quality = "final";
    if (this.frame !== null) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = null;
      this.draw(this.quality);
    });
  }

  private async settle() {
    const view = usePhotoUi.getState().view;
    if (!view) return;
    await this.renderer.ensureVisible(view);
    this.request("final");
  }

  draw(quality: Quality) {
    const view = usePhotoUi.getState().view;
    if (!view) return null;
    const timing = this.renderer.drawScreen(view, quality, 8 * devicePixelRatio);
    if (timing) {
      this.timings.push(timing);
      if (this.timings.length > 500) this.timings.splice(0, 250);
    }
    return timing;
  }

  dispose() {
    if (this.frame !== null) cancelAnimationFrame(this.frame);
    if (this.settleTimer) clearTimeout(this.settleTimer);
    for (const stop of this.unsubscribe) stop();
    this.renderer.onChange = null;
  }
}
