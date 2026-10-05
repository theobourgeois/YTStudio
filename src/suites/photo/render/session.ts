/**
 * One photo on screen: the device, the context, the canvas, the source and a paint surface, and recovery when the
 * device is lost (docs/photo/rendering.md, "Device loss"). The view redraws on request, once per frame: bilinear
 * while it changes, then Mitchell once it has been still for a moment. Timings go in `marks` for the bench.
 */
import { sourceTransform } from "@shared/photo/colour.ts";
import { type View, fitView } from "@shared/photo/geometry.ts";
import type { SourceInfo, SourceLayout, TileSize } from "@shared/photo/lab.ts";
import { labApi, LAB_BASE } from "../api.ts";
import type { AtlasFormat } from "./atlas.ts";
import { RenderContext } from "./context.ts";
import { type Gpu, createGpu } from "./gpu.ts";
import { PaintSurface } from "./paint.ts";
import { SourceImage } from "./source.ts";
import { type Quality, ViewRenderer } from "./view.ts";

export interface SessionOptions {
  tile: TileSize;
  budgetBytes: number;
}

export interface OpenMarks {
  /** Asking the server for the layout (it decodes on first use). */
  layoutMs: number;
  decodeMs: number;
  /** Open → the coarse preview drawn and finished by the GPU. */
  coarseMs: number;
  /** Open → every tile converted, levels built. */
  loadedMs: number;
  /** Open → a final-quality frame of the view, with every tile it needs, finished by the GPU. */
  settledMs: number;
  bytes: number;
}

export interface FrameStat {
  cpuMs: number;
  gpuMs: number;
  quality: Quality;
}

const SETTLE_MS = 120;

export class PhotoSession {
  gpu!: Gpu;
  ctx!: RenderContext;
  renderer!: ViewRenderer;
  source: SourceImage | null = null;
  paint: PaintSurface | null = null;
  info: SourceInfo | null = null;
  layout: SourceLayout | null = null;
  view: View = { zoom: 1, x: 0, y: 0, width: 1, height: 1 };
  /** Every frame drawn, newest last (the bench reads and clears it). */
  frames: FrameStat[] = [];
  marks: Partial<OpenMarks> = {};
  /** Status for the page: loading progress, errors. */
  status = "";
  onChange: (() => void) | null = null;
  private frameRequested = false;
  private settleTimer: ReturnType<typeof setTimeout> | null = null;
  private quality: Quality = "final";
  private disposed = false;
  private recovering: Promise<void> | null = null;
  /** Above zero while the device, context or renderer is being replaced: frames already scheduled don't draw. */
  private paused = 0;
  recoveries = 0;

  private constructor(
    readonly canvas: HTMLCanvasElement,
    readonly options: SessionOptions,
  ) {}

  static async create(canvas: HTMLCanvasElement, options: SessionOptions): Promise<PhotoSession> {
    const session = new PhotoSession(canvas, options);
    await session.start();
    return session;
  }

  private async start() {
    this.gpu = await createGpu();
    this.ctx = await RenderContext.create(this.gpu, this.format, this.options.tile, this.options.budgetBytes);
    this.renderer = new ViewRenderer(this.ctx, this.canvas);
    const gpu = this.gpu;
    void gpu.lost.then((info) => {
      if (this.disposed || this.gpu !== gpu) return;
      this.status = `The GPU was lost (${info.reason}: ${info.message}); starting again.`;
      this.onChange?.();
      void this.recover();
    });
  }

  private get format(): AtlasFormat {
    return this.layout?.bits === 16 ? "rgba32float" : "rgba16float";
  }

  private notify(status?: string) {
    if (status !== undefined) this.status = status;
    this.onChange?.();
  }

  /** Opens `info` (its tiles at the session's tile size), fitting it in the canvas. */
  async open(info: SourceInfo): Promise<OpenMarks> {
    const started = performance.now();
    this.info = info;
    this.marks = {};
    this.notify(`Decoding ${info.name}…`);
    const layout = await labApi.layout(info.key, this.options.tile);
    this.marks.layoutMs = performance.now() - started;
    this.marks.decodeMs = layout.decodeMs;
    // 16-bit sources need f32 tiles: a different atlas.
    const needed = layout.bits === 16 ? "rgba32float" : "rgba16float";
    this.layout = layout;
    if (this.ctx.format !== needed) await this.restart();
    this.replaceSource(layout);
    this.view = fitView(layout, this.canvas.width, this.canvas.height);
    await this.source!.loadPreview();
    this.drawNow("interactive");
    await this.ctx.device.queue.onSubmittedWorkDone();
    this.marks.coarseMs = performance.now() - started;
    this.notify("Loading tiles…");
    await this.source!.loadAll((p) => {
      this.marks.bytes = p.bytes;
      this.notify(`Loading tiles… ${p.converted} / ${p.total}`);
      this.requestDraw();
    });
    await this.ctx.device.queue.onSubmittedWorkDone();
    this.marks.loadedMs = performance.now() - started;
    await this.settle();
    this.marks.settledMs = performance.now() - started;
    this.notify(`${info.name}: ${layout.width} × ${layout.height}, ${layout.bits}-bit`);
    return this.marks as OpenMarks;
  }

  private replaceSource(layout: SourceLayout) {
    this.source?.destroy();
    this.paint?.destroy();
    const icc = layout.icc ? Uint8Array.from(atob(layout.icc), (c) => c.charCodeAt(0)) : null;
    this.source = new SourceImage(this.ctx, layout, sourceTransform(icc), labApi.urls(layout.key, this.options.tile));
    this.paint = new PaintSurface(this.ctx, layout, LAB_BASE);
  }

  /** A new device and context (another atlas format). */
  private async restart() {
    this.paused++;
    try {
      await this.replaceDevice();
    } finally {
      this.paused--;
    }
  }

  private async replaceDevice() {
    this.renderer?.destroy();
    this.source?.destroy();
    this.paint?.destroy();
    this.source = null;
    this.paint = null;
    this.ctx?.destroy();
    const old = this.gpu;
    await this.start();
    old?.device.destroy();
  }

  /** Draws on the next animation frame (several requests make one frame). */
  requestDraw(quality: Quality = "interactive") {
    this.quality = quality;
    if (quality === "interactive") this.scheduleSettle();
    if (this.frameRequested) return;
    this.frameRequested = true;
    requestAnimationFrame(() => {
      this.frameRequested = false;
      this.drawNow(this.quality);
    });
  }

  private scheduleSettle() {
    if (this.settleTimer) clearTimeout(this.settleTimer);
    this.settleTimer = setTimeout(() => {
      this.settleTimer = null;
      void this.source?.ensureVisible(this.view).then((n) => n && this.requestDraw("final"));
      this.requestDraw("final");
    }, SETTLE_MS);
  }

  drawNow(quality: Quality) {
    if (this.disposed || this.paused > 0) return null;
    const timing = this.renderer.draw(this.view, this.source, this.paint, quality, 8 * devicePixelRatio);
    const stat: FrameStat = { cpuMs: timing.cpuMs, gpuMs: 0, quality };
    this.frames.push(stat);
    if (this.frames.length > 2000) this.frames.splice(0, 1000);
    void timing.gpuMs.then((ms) => (stat.gpuMs = ms));
    return timing;
  }

  /** Waits for every tile the view needs, then draws it at final quality and waits for the GPU. */
  async settle() {
    if (!this.source) return;
    while (!this.source.settled(this.view)) {
      const fetched = await this.source.ensureVisible(this.view);
      if (!fetched && !this.source.settled(this.view)) break;
    }
    const timing = this.drawNow("final");
    await timing?.gpuMs;
  }

  setView(view: View, quality: Quality = "interactive") {
    this.view = view;
    this.requestDraw(quality);
  }

  resize(width: number, height: number) {
    this.canvas.width = width;
    this.canvas.height = height;
    this.view = { ...this.view, width, height };
    this.requestDraw("final");
  }

  /** Destroys the device, as a GPU crash would, and measures how long until the view is back. */
  async simulateLoss(): Promise<number> {
    const started = performance.now();
    this.gpu.device.destroy();
    // The lost handler starts recovering; wait for it.
    while (!this.recovering) await new Promise((r) => setTimeout(r, 1));
    await this.recovering;
    return performance.now() - started;
  }

  /** Everything again on a new device: the source from the server's decoded tiles, the paint from its blobs. */
  private recover(): Promise<void> {
    this.recovering ??= (async () => {
      const oldPaint = this.paint;
      this.paused++;
      try {
        this.paint = null;
        this.source?.destroy();
        this.source = null;
        this.renderer.destroy();
        this.ctx.destroy();
        await this.start();
        this.recoveries++;
        if (this.layout) {
          this.replaceSource(this.layout);
          await this.source!.loadPreview();
          await this.source!.loadAll();
          if (oldPaint) await this.paint!.adopt(oldPaint);
        }
      } finally {
        oldPaint?.destroy();
        this.paused--;
      }
      await this.settle();
      this.notify(this.info ? `${this.info.name}: back after the GPU was lost.` : "");
    })().finally(() => {
      this.recovering = null;
    });
    return this.recovering;
  }

  dispose() {
    this.disposed = true;
    if (this.settleTimer) clearTimeout(this.settleTimer);
    this.renderer.destroy();
    this.source?.destroy();
    this.paint?.destroy();
    this.ctx.destroy();
    this.gpu.device.destroy();
  }
}
