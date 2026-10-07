/**
 * A stroke of a brush that reads its pixels (Dodge, Burn, Sponge, the Background Eraser) from press to commit, as
 * `StrokeController` is the Brush's: samples in document pixels; one undo step when it's let go; Escape (or a lost
 * pointer) drops it. Toning's dabs are stamped by the GPU (`renderer.strokeTo`), with Airbrush laying more where the
 * pointer rests; the Background Eraser's are decided by the CPU (`ColourEraseStroke`) and wait for their tiles.
 */
import { toast } from "sonner";
import type { BrushSettings } from "@shared/photo/brush";
import { AIRBRUSH_RATE } from "@shared/photo/reference/toning";
import { apply } from "@shared/photo/layers";
import type { PhotoSelection, SurfaceId } from "@shared/photo/types";
import { type SurfacePart, commitSurface } from "../paint-target";
import type { BrushEffect } from "../render/brush-effects";
import { type ColourErase, ColourEraseStroke } from "../render/colour-erase";
import type { PhotoRenderer } from "../render/renderer";
import { usePhoto } from "../store";

/** The stroke ending before this one (a new press waits for it: the Background Eraser finishes its dabs first). */
let ending: Promise<unknown> = Promise.resolve();

export class EffectStroke {
  private pending: { x: number; y: number }[] = [];
  private begun = false;
  private ended = false;
  private readonly started = performance.now();
  private renderer: PhotoRenderer | null = null;
  /** The renderer's lost strokes when this one began: more at its end means it was lost with the device. */
  private lostBefore = 0;
  private cpu: ColourEraseStroke | null = null;
  private last: { x: number; y: number } | null = null;
  private airbrush: ReturnType<typeof setInterval> | null = null;
  private readonly erase: ColourErase | null;

  constructor(
    renderer: PhotoRenderer | Promise<PhotoRenderer>,
    readonly layerId: string,
    readonly part: SurfacePart,
    private readonly selection: PhotoSelection | null,
    /** In document pixels. */
    private readonly brush: BrushSettings,
    private readonly effect: BrushEffect,
    options: { erase?: ColourErase; airbrush?: boolean } = {},
  ) {
    this.erase = options.erase ?? null;
    if (options.airbrush && effect.kind === "tone") {
      this.airbrush = setInterval(() => {
        if (this.begun && this.last && !this.ended) this.renderer?.strokeDab([this.last]);
      }, 1000 / AIRBRUSH_RATE);
    }
    void Promise.all([renderer, ending]).then(([r]) => {
      this.renderer = r;
      this.lostBefore = r.lostStrokes;
      this.tryBegin();
    });
  }

  private tryBegin() {
    const renderer = this.renderer;
    if (this.begun || this.ended || !renderer) return;
    this.begun = renderer.beginEffectStroke(this.layerId, this.part, this.brush, this.effect, this.selection);
    if (this.begun) {
      const target = renderer.strokeTarget;
      if (this.erase && target) this.cpu = new ColourEraseStroke(target.surface, { ...this.brush, radius: this.brush.radius / target.scale }, this.erase);
      this.send(this.pending);
      this.pending = [];
    } else if (performance.now() - this.started < 2000) requestAnimationFrame(() => this.tryBegin());
  }

  private send(points: { x: number; y: number }[]) {
    if (!points.length) return;
    const target = this.renderer?.strokeTarget;
    if (this.cpu) {
      if (target) this.cpu.add(points.map((p) => apply(target.toSurface, p.x, p.y)));
    } else this.renderer?.strokeTo(points);
  }

  /** Samples in document pixels (coalesced pointer events, in order). */
  add(points: { x: number; y: number }[]) {
    if (this.ended || !points.length) return;
    this.last = points[points.length - 1];
    if (this.begun) this.send(points);
    else this.pending.push(...points);
  }

  private stopAirbrush() {
    if (this.airbrush) clearInterval(this.airbrush);
    this.airbrush = null;
  }

  cancel() {
    this.ended = true;
    this.stopAirbrush();
    this.cpu?.stop();
    if (this.begun) this.renderer?.cancelStroke();
  }

  /** Ends it and commits its surface (one undo step). Resolves with the new surface's id, or null. */
  end(): Promise<SurfaceId | null> {
    const done = this.finish();
    ending = done.catch(() => null);
    return done;
  }

  private async finish(): Promise<SurfaceId | null> {
    this.stopAirbrush();
    // A click: the stroke is its one dab, laid once the surface is there.
    while (!this.begun && !this.ended && performance.now() - this.started < 2000) await new Promise((r) => requestAnimationFrame(r));
    if (this.ended) return null;
    this.ended = true;
    const renderer = this.renderer;
    if (!this.begun || !renderer) return null;
    if (this.cpu) {
      await this.cpu.idle();
      if (this.cpu.failure) {
        renderer.cancelStroke();
        toast.error("Couldn't erase there", { description: this.cpu.failure instanceof Error ? this.cpu.failure.message : String(this.cpu.failure) });
        return null;
      }
    }
    const result = await renderer.endStroke();
    if (renderer.lostStrokes > this.lostBefore) {
      toast.error("The GPU stopped mid-stroke", { description: "That stroke couldn't be kept: paint it again. Everything before it is safe." });
      return null;
    }
    if (!result) return null;
    usePhoto.getState().commit(commitSurface(this.layerId, this.part, result.id));
    return result.id;
  }
}
