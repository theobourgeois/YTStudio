/**
 * Painting from the tab (ux.md, "Selections, masks and brushes"): what a brush press paints (`paintTargetOf`, pure:
 * the active layer's pixels or mask; an image asks first, never rasterised silently; an adjustment paints its mask,
 * given one as Photoshop's always have), and a stroke from press to commit: samples in document pixels go to the
 * renderer, its surface's new id is committed at the end as one undo step, Escape or a lost pointer drops it.
 */
import { toast } from "sonner";
import type { PhotoSelection, SurfaceId } from "@shared/photo/types";
import { brushSettings, strokeColour, useBrush } from "./brush-options";
import { useColours } from "./colours";
import { type SurfacePart, commitSurface } from "./paint-target";
import type { PhotoRenderer } from "./render/renderer";
import { usePhoto } from "./store";

/**
 * One stroke. Samples that arrive before the surface is on the GPU (a layer or mask made a moment ago) wait and are
 * painted when it is; a surface that never comes cancels the stroke. One the GPU loses midway (a device lost: its
 * drafts were on it) isn't kept, and the user is told: everything committed before it is safe.
 */
export class StrokeController {
  private pending: { x: number; y: number }[] = [];
  private begun = false;
  private ended = false;
  private readonly started = performance.now();
  /** The renderer's lost strokes when this one began: more at its end means it was lost with the device. */
  private readonly lostBefore: number;

  constructor(
    private readonly renderer: PhotoRenderer,
    readonly layerId: string,
    readonly part: SurfacePart,
    private readonly selection: PhotoSelection | null,
    /** The Eraser: painted pixels go transparent; a mask is painted the background colour (Photoshop's). */
    private readonly erase = false,
  ) {
    this.lostBefore = renderer.lostStrokes;
    this.tryBegin();
  }

  private tryBegin() {
    if (this.begun || this.ended) return;
    const { foreground, background } = useColours.getState();
    const onMask = this.part === "mask";
    const colour = strokeColour(this.erase ? background : foreground, onMask ? "mask" : "pixels");
    this.begun = this.renderer.beginStroke(this.layerId, this.part, brushSettings(useBrush.getState()), colour, this.selection, this.erase && !onMask);
    if (this.begun) {
      this.renderer.strokeTo(this.pending);
      this.pending = [];
    } else if (performance.now() - this.started < 2000) requestAnimationFrame(() => this.tryBegin());
  }

  /** Samples in document pixels (coalesced pointer events, in order). */
  add(points: { x: number; y: number }[]) {
    if (this.ended) return;
    if (this.begun) this.renderer.strokeTo(points);
    else this.pending.push(...points);
  }

  cancel() {
    this.ended = true;
    if (this.begun) this.renderer.cancelStroke();
  }

  /** Ends it and commits its surface (one undo step). Resolves with the new surface's id, or null. */
  async end(): Promise<SurfaceId | null> {
    // A click: the stroke is its one dab, painted once the surface is there.
    while (!this.begun && !this.ended && performance.now() - this.started < 2000) await new Promise((r) => requestAnimationFrame(r));
    this.ended = true;
    if (!this.begun) return null;
    const result = await this.renderer.endStroke();
    if (this.renderer.lostStrokes > this.lostBefore) {
      toast.error("The GPU stopped mid-stroke", { description: "That stroke couldn't be kept: paint it again. Everything before it is safe." });
      return null;
    }
    if (!result) return null;
    usePhoto.getState().commit(commitSurface(this.layerId, this.part, result.id));
    return result.id;
  }
}
