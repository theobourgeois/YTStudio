/**
 * A Classic gradient painted into a layer's pixels or mask (docs/photo/tools/gradient.md, "Classic"), by the tool's
 * drag or the assistant's `paint_gradient`: a tile stroke on the surface (`PhotoRenderer.beginTiles`), painted by
 * `render/gradient.ts`'s kernel, committed as one undo step.
 */
import { toast } from "sonner";
import type { GradientFillShape } from "@shared/photo/effects/gradient";
import type { GradientPaint } from "@shared/photo/reference/gradient";
import type { DocPoint, PhotoSelection, SurfaceId } from "@shared/photo/types";
import { liveRenderer } from "../live";
import { type SurfacePart, commitSurface } from "../paint-target";
import { gradientPainter } from "../render/gradient";
import type { PhotoRenderer } from "../render/renderer";
import { usePhoto } from "../store";
import type { GradientPaintRequest } from "./gradient-request";

/**
 * A Classic gradient from press to commit: a tile stroke on the layer's surface, painted again for the latest line
 * once a frame. A surface that isn't on the GPU yet is waited for (two seconds); the commit is one undo step.
 */
export class ClassicGradient {
  private renderer: PhotoRenderer | null = null;
  private begun = false;
  private ended = false;
  private line: { start: DocPoint; end: DocPoint } | null = null;
  private frame = 0;
  private readonly started = performance.now();

  constructor(
    readonly layerId: string,
    readonly part: SurfacePart,
    private readonly selection: PhotoSelection | null,
    private readonly shapeOf: (start: DocPoint, end: DocPoint) => GradientFillShape,
    private readonly paint: GradientPaint,
  ) {
    void liveRenderer()?.then((r) => {
      this.renderer = r;
      this.tryBegin();
    });
  }

  private tryBegin() {
    if (this.begun || this.ended || !this.renderer) return;
    this.begun = this.renderer.beginTiles(this.layerId, this.part, this.selection);
    if (this.begun) this.draw();
    else if (performance.now() - this.started < 2000) requestAnimationFrame(() => this.tryBegin());
  }

  private draw() {
    if (!this.begun || !this.line || !this.renderer) return;
    this.renderer.paintTiles(gradientPainter(this.shapeOf(this.line.start, this.line.end), this.paint));
  }

  /** The line now (document pixels): painted on the next frame. */
  setLine(start: DocPoint, end: DocPoint) {
    this.line = { start, end };
    if (!this.frame)
      this.frame = requestAnimationFrame(() => {
        this.frame = 0;
        if (!this.ended) this.draw();
      });
  }

  cancel() {
    this.ended = true;
    cancelAnimationFrame(this.frame);
    if (this.begun) this.renderer?.cancelStroke();
  }

  /** Paints the latest line and commits it (one undo step): the new surface's id, or null when nothing was kept. */
  async end(): Promise<SurfaceId | null> {
    while (!this.begun && !this.ended && performance.now() - this.started < 2000) await new Promise((r) => requestAnimationFrame(r));
    cancelAnimationFrame(this.frame);
    if (this.ended || !this.begun || !this.renderer) {
      this.ended = true;
      if (!this.begun) toast.error("That layer's pixels aren't ready yet", { description: "Draw the gradient again in a moment." });
      return null;
    }
    this.draw();
    this.ended = true;
    const result = await this.renderer.endStroke();
    if (!result) return null;
    usePhoto.getState().commit(commitSurface(this.layerId, this.part, result.id));
    return result.id;
  }
}

/** A Classic gradient painted at once (the assistant's): resolves with the new surface, or null when the selection missed it. */
export async function paintGradient(request: GradientPaintRequest, selection: PhotoSelection | null): Promise<SurfaceId | null> {
  const stroke = new ClassicGradient(request.layerId, request.part, selection, () => request.shape, request.paint);
  stroke.setLine(request.shape.start, request.shape.end);
  return stroke.end();
}
