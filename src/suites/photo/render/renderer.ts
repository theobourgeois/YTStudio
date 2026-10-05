/**
 * The open photo on the GPU (docs/photo/architecture.md): the device, a source for each image the document shows
 * (decoded on the server, converted and levelled here), the compositor, and the screen. The workspace draws with
 * it; exports, Home's cover and the assistant's pictures render through the same compositor at other views, with
 * the canvas element or without one. A lost device is replaced and everything fetched again from the server.
 */
import { srgbToLinear, sourceTransform } from "@shared/photo/colour.ts";
import { type View, levelForScale } from "@shared/photo/geometry.ts";
import { type Affine, apply, invert, layerMatrix, layerScale } from "@shared/photo/layers.ts";
import type { TileSize } from "@shared/photo/lab.ts";
import { DITHER_8BIT } from "@shared/photo/output.ts";
import type { PhotoProject } from "@shared/photo/types.ts";
import type { MediaAsset } from "@shared/types";
import { photoApi } from "../api.ts";
import type { AtlasFormat } from "./atlas.ts";
import { ACCUMULATOR_FORMAT, Compositor, type LayerDraw, type Quality } from "./compositor.ts";
import { RenderContext } from "./context.ts";
import { type Gpu, createGpu } from "./gpu.ts";
import { SourceImage } from "./source.ts";

export const TILE: TileSize = 256;
/** The GPU memory the atlas may use, per format (Settings › Photo can change it). */
export const DEFAULT_BUDGET = 2 * 1024 ** 3;
/** Exports and pictures render regions this big at a time. */
const REGION = 512;

export type SourceState = { state: "loading"; progress: number } | { state: "ready" } | { state: "missing" } | { state: "failed"; error: string };

interface Source {
  mediaId: string;
  image: SourceImage | null;
  state: SourceState;
}

export interface FrameTiming {
  cpuMs: number;
  gpuMs: Promise<number>;
}

/** sRGB "#rrggbb" as premultiplied linear light, or transparent. */
export function backgroundLight(hex: string | null): [number, number, number, number] {
  if (!hex) return [0, 0, 0, 0];
  const n = Number.parseInt(hex.slice(1), 16);
  return [srgbToLinear(((n >> 16) & 255) / 255), srgbToLinear(((n >> 8) & 255) / 255), srgbToLinear((n & 255) / 255), 1];
}

/** A pseudo-view of a layer's own pixels covering what `view` shows of it, for fetching its evicted tiles. */
export function layerView(view: View, matrix: Affine, transformScale: number, size: { width: number; height: number }): View | null {
  const inv = invert(matrix);
  const pts = [
    apply(inv, view.x, view.y),
    apply(inv, view.x + view.width / view.zoom, view.y),
    apply(inv, view.x, view.y + view.height / view.zoom),
    apply(inv, view.x + view.width / view.zoom, view.y + view.height / view.zoom),
  ];
  const x0 = Math.max(0, Math.min(...pts.map((p) => p.x)));
  const y0 = Math.max(0, Math.min(...pts.map((p) => p.y)));
  const x1 = Math.min(size.width, Math.max(...pts.map((p) => p.x)));
  const y1 = Math.min(size.height, Math.max(...pts.map((p) => p.y)));
  if (x1 <= x0 || y1 <= y0) return null;
  const zoom = view.zoom * transformScale;
  return { zoom, x: x0, y: y0, width: (x1 - x0) * zoom, height: (y1 - y0) * zoom };
}

export class PhotoRenderer {
  gpu!: Gpu;
  private contexts = new Map<AtlasFormat, RenderContext>();
  compositor!: Compositor;
  private readonly sources = new Map<string, Source>();
  private projectId: string | null = null;
  private doc: PhotoProject | null = null;
  private assets = new Map<string, MediaAsset>();
  private canvas: HTMLCanvasElement | null = null;
  private screen: { context: GPUCanvasContext; accumulator: GPUTexture; width: number; height: number; group: GPUBindGroup; uniform: GPUBuffer } | null = null;
  /** Around the canvas: the theme's stage colour (linear light), as Photoshop's grey pasteboard. */
  pasteboard: [number, number, number] = [0.05, 0.05, 0.055];
  /** Called when something the screen shows changes (a source's tiles arrived, the device came back). */
  onChange: (() => void) | null = null;
  /** Called when an image starts loading, has loaded, or failed (the Layers panel says so). */
  onSourceState: ((mediaId: string, state: SourceState) => void) | null = null;
  private destroyed = false;
  private recovering: Promise<void> | null = null;
  recoveries = 0;

  private constructor(readonly budgetBytes: number) {}

  static async create(budgetBytes = DEFAULT_BUDGET): Promise<PhotoRenderer> {
    const renderer = new PhotoRenderer(budgetBytes);
    await renderer.start();
    return renderer;
  }

  private async start() {
    this.gpu = await createGpu();
    this.contexts = new Map([["rgba16float", await RenderContext.create(this.gpu, "rgba16float", TILE, this.budgetBytes)]]);
    this.compositor = await Compositor.create(this.contexts.get("rgba16float")!, this.gpu.canvasFormat);
    const gpu = this.gpu;
    void gpu.lost.then(() => {
      if (!this.destroyed && this.gpu === gpu) void this.recover();
    });
  }

  /** The context for a source's samples: 16-bit sources keep f32 tiles (rendering.md, "Storage formats"). */
  private async contextFor(bits: 8 | 16): Promise<RenderContext> {
    const format: AtlasFormat = bits === 16 ? "rgba32float" : "rgba16float";
    let ctx = this.contexts.get(format);
    if (!ctx) {
      ctx = await RenderContext.create(this.gpu, format, TILE, this.budgetBytes);
      this.contexts.set(format, ctx);
    }
    return ctx;
  }

  get device() {
    return this.gpu.device;
  }

  /** What each image is doing (the Layers panel shows missing and failed ones). */
  sourceState(mediaId: string): SourceState {
    return this.sources.get(mediaId)?.state ?? { state: "loading", progress: 0 };
  }

  /** Follows the document: loads the images it shows (in the background), lets go of those it no longer does. */
  setDocument(projectId: string, doc: PhotoProject, assets: readonly MediaAsset[]) {
    this.projectId = projectId;
    this.doc = doc;
    this.assets = new Map(assets.map((a) => [a.id, a]));
    const wanted = new Set(doc.layers.map((l) => l.mediaId));
    for (const [mediaId, source] of this.sources) {
      if (!wanted.has(mediaId)) {
        source.image?.destroy();
        this.sources.delete(mediaId);
      }
    }
    for (const mediaId of wanted) {
      const known = this.sources.get(mediaId);
      if (known && !(known.state.state === "missing" && this.assets.has(mediaId))) continue;
      const source: Source = { mediaId, image: null, state: { state: "loading", progress: 0 } };
      this.sources.set(mediaId, source);
      this.onSourceState?.(mediaId, source.state);
      if (!this.assets.has(mediaId)) this.setSourceState(source, { state: "missing" });
      else void this.load(projectId, source);
    }
  }

  private async load(projectId: string, source: Source) {
    try {
      const layout = await photoApi.layout(projectId, source.mediaId, TILE);
      if (this.sources.get(source.mediaId) !== source || this.destroyed) return;
      const ctx = await this.contextFor(layout.bits);
      const icc = layout.icc ? Uint8Array.from(atob(layout.icc), (c) => c.charCodeAt(0)) : null;
      const image = new SourceImage(ctx, layout, sourceTransform(icc), photoApi.urls(projectId, source.mediaId, TILE));
      source.image = image;
      await image.loadPreview();
      this.onChange?.();
      await image.loadAll((p) => {
        this.setSourceState(source, { state: "loading", progress: p.converted / p.total });
        this.onChange?.();
      });
      if (this.sources.get(source.mediaId) !== source) return;
      this.setSourceState(source, { state: "ready" });
      this.onChange?.();
    } catch (error) {
      if (this.sources.get(source.mediaId) !== source) return;
      this.setSourceState(source, { state: "failed", error: error instanceof Error ? error.message : String(error) });
      this.onChange?.();
    }
  }

  private setSourceState(source: Source, state: SourceState) {
    source.state = state;
    this.onSourceState?.(source.mediaId, state);
  }

  /** Resolves when every image the document shows has loaded (or failed). */
  async ready(): Promise<void> {
    while ([...this.sources.values()].some((s) => s.state.state === "loading")) await new Promise((r) => setTimeout(r, 20));
  }

  /** The visible layers that can be drawn, bottom to top. */
  private draws(doc: PhotoProject): LayerDraw[] {
    const out: LayerDraw[] = [];
    for (const layer of doc.layers) {
      if (!layer.visible || layer.opacity <= 0) continue;
      const image = this.sources.get(layer.mediaId)?.image;
      if (!image) continue;
      out.push({ source: image, matrix: layerMatrix(layer.transform, image.layout), transform: layer.transform, opacity: layer.opacity });
    }
    return out;
  }

  /** Fetches the evicted tiles of every layer that `view` needs at full resolution. */
  async ensureVisible(view: View, doc = this.doc) {
    if (!doc) return 0;
    let fetched = 0;
    for (const draw of this.draws(doc)) {
      const scale = layerScale(draw.transform);
      if (levelForScale(view.zoom * scale, draw.source.image.levels.length) !== 0) continue;
      const local = layerView(view, draw.matrix, scale, draw.source.layout);
      if (local) fetched += await draw.source.ensureVisible({ ...local, zoom: Math.max(1, local.zoom) });
    }
    return fetched;
  }

  // --- the screen ---

  /** Draws on this canvas element (sized in device pixels by the caller). */
  attach(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.screen = null;
  }

  private screenFor(width: number, height: number) {
    if (this.screen && this.screen.width === width && this.screen.height === height) return this.screen;
    const { device } = this;
    const context = (this.screen?.context ?? (this.canvas!.getContext("webgpu") as GPUCanvasContext | null))!;
    context.configure({ device, format: this.gpu.canvasFormat, alphaMode: "opaque" });
    this.screen?.accumulator.destroy();
    this.screen?.uniform.destroy();
    const accumulator = device.createTexture({ label: "screen accumulator", size: [width, height], format: ACCUMULATOR_FORMAT, usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING });
    const uniform = device.createBuffer({ size: 48, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    const group = device.createBindGroup({
      layout: this.compositor.presentPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: accumulator.createView() },
        { binding: 1, resource: { buffer: uniform } },
      ],
    });
    this.screen = { context, accumulator, width, height, group, uniform };
    return this.screen;
  }

  /** One frame of `view` on the canvas: the canvas's area over the checkerboard, the pasteboard around it. */
  drawScreen(view: View, quality: Quality, checker = 8): FrameTiming | null {
    if (!this.canvas || !this.doc || this.recovering || this.destroyed) return null;
    const started = performance.now();
    const width = Math.max(1, Math.round(view.width));
    const height = Math.max(1, Math.round(view.height));
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
    }
    const screen = this.screenFor(width, height);
    const { device } = this;
    const doc = this.doc;
    const encoder = device.createCommandEncoder({ label: "screen" });
    this.compositor.render(encoder, screen.accumulator.createView(), { ...view, width, height }, this.draws(doc), backgroundLight(doc.canvas.background), quality);
    const u = new Float32Array(12);
    const x0 = (0 - view.x) * view.zoom;
    const y0 = (0 - view.y) * view.zoom;
    u.set([x0, y0, x0 + doc.canvas.width * view.zoom, y0 + doc.canvas.height * view.zoom, checker, DITHER_8BIT, 0, 0, ...this.pasteboard, 1]);
    device.queue.writeBuffer(screen.uniform, 0, u);
    const pass = encoder.beginRenderPass({
      colorAttachments: [{ view: screen.context.getCurrentTexture().createView(), loadOp: "clear", storeOp: "store", clearValue: [0, 0, 0, 1] }],
    });
    pass.setPipeline(this.compositor.presentPipeline);
    pass.setBindGroup(0, screen.group);
    pass.draw(3);
    pass.end();
    device.queue.submit([encoder.finish()]);
    return { cpuMs: performance.now() - started, gpuMs: device.queue.onSubmittedWorkDone().then(() => performance.now() - started) };
  }

  // --- regions: exports and pictures ---

  /**
   * Renders the document at `zoom` (1 for an export) region by region, a band of rows at a time, through the
   * output transform into 8-bit RGBA, handing each band to `onBand` (awaited, so bands go in order).
   */
  async renderBands(
    doc: PhotoProject,
    options: { zoom: number; under: "none" | "matte" | "checker"; matte?: [number, number, number]; dither?: boolean },
    onBand: (from: number, rows: Uint8Array, width: number) => Promise<void> | void,
  ) {
    const { device } = this;
    const width = Math.max(1, Math.round(doc.canvas.width * options.zoom));
    const height = Math.max(1, Math.round(doc.canvas.height * options.zoom));
    const accumulator = device.createTexture({ label: "region accumulator", size: [REGION, REGION], format: ACCUMULATOR_FORMAT, usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING });
    const out = device.createBuffer({ size: REGION * REGION * 4, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC });
    const params = device.createBuffer({ size: 48, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    const group = device.createBindGroup({
      layout: this.compositor.quantizePipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: accumulator.createView() },
        { binding: 1, resource: { buffer: out } },
        { binding: 2, resource: { buffer: params } },
      ],
    });
    const draws = this.draws(doc);
    const clear = backgroundLight(doc.canvas.background);
    const matte = options.matte ?? [1, 1, 1];
    try {
      for (let y = 0; y < height; y += REGION) {
        const rows = Math.min(REGION, height - y);
        const band = new Uint8Array(width * rows * 4);
        for (let x = 0; x < width; x += REGION) {
          const cols = Math.min(REGION, width - x);
          const view: View = { zoom: options.zoom, x: x / options.zoom, y: y / options.zoom, width: cols, height: rows };
          await this.ensureVisible(view, doc);
          const p = new ArrayBuffer(48);
          new Uint32Array(p, 0, 4).set([x, y, cols, rows]);
          new Float32Array(p, 16, 1)[0] = options.dither === false ? 0 : DITHER_8BIT;
          new Uint32Array(p, 20, 1)[0] = options.under === "matte" ? 1 : options.under === "checker" ? 2 : 0;
          new Float32Array(p, 24, 1)[0] = 8;
          new Float32Array(p, 32, 4).set([...matte, 1]);
          device.queue.writeBuffer(params, 0, p);
          const readback = device.createBuffer({ size: cols * rows * 4, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
          const encoder = device.createCommandEncoder({ label: "region" });
          this.compositor.render(encoder, accumulator.createView(), view, draws, clear, "final");
          const pass = encoder.beginComputePass();
          pass.setPipeline(this.compositor.quantizePipeline);
          pass.setBindGroup(0, group);
          pass.dispatchWorkgroups(Math.ceil(cols / 16), Math.ceil(rows / 16));
          pass.end();
          encoder.copyBufferToBuffer(out, 0, readback, 0, cols * rows * 4);
          device.queue.submit([encoder.finish()]);
          await readback.mapAsync(GPUMapMode.READ);
          const data = new Uint8Array(readback.getMappedRange());
          for (let r = 0; r < rows; r++) band.set(data.subarray(r * cols * 4, (r + 1) * cols * 4), (r * width + x) * 4);
          readback.unmap();
          readback.destroy();
        }
        await onBand(y, band, width);
      }
    } finally {
      accumulator.destroy();
      out.destroy();
      params.destroy();
    }
    return { width, height };
  }

  /** The document as a picture `width` wide (Home's cover, the assistant's view), JPEG over the checkerboard. */
  async picture(doc: PhotoProject, width: number, type: "image/jpeg" | "image/png" = "image/jpeg"): Promise<Blob> {
    const zoom = Math.min(1, width / doc.canvas.width);
    const w = Math.max(1, Math.round(doc.canvas.width * zoom));
    const h = Math.max(1, Math.round(doc.canvas.height * zoom));
    const pixels = new Uint8ClampedArray(w * h * 4);
    await this.renderBands(doc, { zoom, under: "checker" }, (from, rows) => pixels.set(rows, from * w * 4));
    const canvas = new OffscreenCanvas(w, h);
    canvas.getContext("2d")!.putImageData(new ImageData(pixels, w, h), 0, 0);
    return canvas.convertToBlob({ type, quality: 0.85 });
  }

  /**
   * Exports the document at its canvas size: PNG keeps transparency, JPEG goes over the background (or white).
   * The server encodes it into `destination` (the save dialog's), or keeps it to download.
   */
  async export(projectId: string, doc: PhotoProject, request: { name: string; format: "png" | "jpeg"; quality?: number; destination?: string | null }, onProgress?: (fraction: number) => void) {
    const { id } = await photoApi.beginExport({
      projectId,
      name: request.name,
      width: doc.canvas.width,
      height: doc.canvas.height,
      bits: 8,
      format: request.format,
      quality: request.quality,
      destination: request.destination,
    });
    try {
      await this.renderBands(doc, { zoom: 1, under: request.format === "jpeg" ? "matte" : "none", matte: matteOf(doc) }, async (from, rows, width) => {
        await photoApi.exportRows(id, from, rows);
        onProgress?.((from + rows.length / (width * 4)) / doc.canvas.height);
      });
      return { id, ...(await photoApi.finishExport(id)) };
    } catch (error) {
      void photoApi.cancelExport(id).catch(() => {});
      throw error;
    }
  }

  /** Destroys the device, as a GPU crash would; resolves when the renderer is back. */
  async simulateLoss() {
    this.gpu.device.destroy();
    while (!this.recovering) await new Promise((r) => setTimeout(r, 1));
    await this.recovering;
  }

  private recover(): Promise<void> {
    this.recovering ??= (async () => {
      for (const s of this.sources.values()) s.image?.destroy();
      this.sources.clear();
      this.screen = null;
      this.compositor.destroy();
      for (const ctx of this.contexts.values()) ctx.destroy();
      await this.start();
      this.recoveries++;
      if (this.projectId && this.doc) this.setDocument(this.projectId, this.doc, [...this.assets.values()]);
    })().finally(() => {
      this.recovering = null;
      this.onChange?.();
    });
    return this.recovering;
  }

  destroy() {
    this.destroyed = true;
    for (const s of this.sources.values()) s.image?.destroy();
    this.sources.clear();
    this.screen?.accumulator.destroy();
    this.screen?.uniform.destroy();
    this.compositor?.destroy();
    for (const ctx of this.contexts.values()) ctx.destroy();
    this.gpu?.device.destroy();
  }
}

/** A JPEG's matte: the canvas's background, or white when it's transparent (linear light). */
function matteOf(doc: PhotoProject): [number, number, number] {
  const [r, g, b, a] = backgroundLight(doc.canvas.background);
  return a ? [r, g, b] : [1, 1, 1];
}
