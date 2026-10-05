/**
 * The open photo on the GPU (docs/photo/architecture.md): the device, a source for each image the document shows
 * (decoded on the server, converted and levelled here), the compositor, and the screen. The document is compiled
 * into a render plan (`shared/photo/render-plan.ts`) and evaluated; exports, Home's cover and the assistant's
 * pictures render through the same evaluator at other views, with the canvas element or without one. A lost device
 * is replaced and everything fetched again from the server.
 *
 * The screen keeps the composite below each adjustment it last drew, so a slider drag on an adjustment re-runs only
 * that adjustment and what's above it. Below 100%, a plan that doesn't commute with reduction is drawn at the
 * view's level at once and then **refined**: rendered at full resolution and reduced (`refine`), in the
 * background, and shown only if it's still what the screen should show (`LatestOnly`).
 */
import { sourceTransform } from "@shared/photo/colour.ts";
import { type View, levelForScale } from "@shared/photo/geometry.ts";
import { fromHalf } from "@shared/photo/half.ts";
import { type Affine, apply, invert, layerMatrix, layerScale } from "@shared/photo/layers.ts";
import type { TileSize } from "@shared/photo/lab.ts";
import { DITHER_8BIT } from "@shared/photo/output.ts";
import {
  type ImageNode,
  type PlanFormat,
  type RenderPlan,
  type SourceFacts,
  backgroundLight,
  compileRender,
  keyBelow,
  needsRefinement,
  refinePlan,
} from "@shared/photo/render-plan.ts";
import type { PhotoProject } from "@shared/photo/types.ts";
import type { MediaAsset } from "@shared/types";
import { photoApi } from "../api.ts";
import type { AtlasFormat } from "./atlas.ts";
import { COMPOSITE_FORMATS, Compositor, type EvaluatorStats, type LayerDraw, type Quality, type WorkPair, compositeTexture } from "./compositor.ts";
import { RenderContext } from "./context.ts";
import { type Gpu, createGpu } from "./gpu.ts";
import { LatestOnly } from "./latest.ts";
import { SourceImage } from "./source.ts";

export { backgroundLight };

export const TILE: TileSize = 256;
/** The GPU memory the atlas may use, per format (Settings › Photo can change it). */
export const DEFAULT_BUDGET = 2 * 1024 ** 3;
/** Exports render regions this big at a time. */
const REGION = 512;
/** Refinements render level-0 regions up to this big. */
const REFINE_REGION = 2048;
/** How long the view stays still before it's refined. */
const REFINE_DELAY_MS = 150;
/** Composites kept below adjustments on the screen. */
const KEPT = 4;

export type SourceState = { state: "loading"; progress: number } | { state: "ready" } | { state: "missing" } | { state: "failed"; error: string };

/** What the screen shows of a refinement: none needed, a preview at the view's level while it's made, or it. */
export type RefineState = "none" | "refining" | "refined";

interface Source {
  mediaId: string;
  image: SourceImage | null;
  state: SourceState;
}

export interface FrameTiming {
  cpuMs: number;
  gpuMs: Promise<number>;
}

/** A frame on the screen, for the gate "a stale render never replaces a newer one". */
export interface Presented {
  /** The document's revision when it was drawn. */
  revision: number;
  /** The plan the picture shown was made for, and the plan current then. */
  key: string;
  current: string;
  refined: boolean;
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

interface Screen {
  context: GPUCanvasContext;
  width: number;
  height: number;
  format: PlanFormat;
  work: WorkPair;
  uniform: GPUBuffer;
  /** The last refinement shown, and the one being made (swapped when it's done). */
  refined: GPUTexture;
  pending: GPUTexture;
  refinedKey: string | null;
  /** Composites below adjustments, by what they are (`keptKey`), oldest first. */
  kept: Map<string, GPUTexture>;
  /** What the last frame showed (for checks). */
  last: GPUTexture | null;
}

export class PhotoRenderer {
  gpu!: Gpu;
  private contexts = new Map<AtlasFormat, RenderContext>();
  compositor!: Compositor;
  private readonly sources = new Map<string, Source>();
  private projectId: string | null = null;
  private doc: PhotoProject | null = null;
  private assets = new Map<string, MediaAsset>();
  private compiled: { doc: PhotoProject; assets: Map<string, MediaAsset>; plan: RenderPlan } | null = null;
  /** Bumped by every new document: what the screen's frames are stamped with. */
  revision = 0;
  /** Bumped whenever tiles arrive or go: kept composites made before then are out of date. */
  private residency = 0;
  private canvas: HTMLCanvasElement | null = null;
  private screen: Screen | null = null;
  private readonly refiner: LatestOnly<true>;
  private refineTimer: ReturnType<typeof setTimeout> | null = null;
  refineState: RefineState = "none";
  /** The screen's frames, newest last (bounded). */
  readonly presented: Presented[] = [];
  /** Around the canvas: the theme's stage colour (linear light), as Photoshop's grey pasteboard. */
  pasteboard: [number, number, number] = [0.05, 0.05, 0.055];
  /** Called when something the screen shows changes (a source's tiles arrived, a refinement, the device came back). */
  onChange: (() => void) | null = null;
  /** Called when an image starts loading, has loaded, or failed (the Layers panel says so). */
  onSourceState: ((mediaId: string, state: SourceState) => void) | null = null;
  /** Called when the screen starts or finishes refining. */
  onRefineState: ((state: RefineState) => void) | null = null;
  private destroyed = false;
  private recovering: Promise<void> | null = null;
  recoveries = 0;

  private constructor(readonly budgetBytes: number) {
    this.refiner = new LatestOnly<true>((key) => {
      const screen = this.screen;
      if (!screen) return;
      [screen.refined, screen.pending] = [screen.pending, screen.refined];
      screen.refinedKey = key;
      this.onChange?.();
    });
  }

  static async create(budgetBytes = DEFAULT_BUDGET): Promise<PhotoRenderer> {
    const renderer = new PhotoRenderer(budgetBytes);
    await renderer.start();
    return renderer;
  }

  private async start() {
    this.gpu = await createGpu();
    this.contexts = new Map([["rgba16float", await RenderContext.create(this.gpu, "rgba16float", TILE, this.budgetBytes)]]);
    const formats = this.gpu.float32Blendable ? COMPOSITE_FORMATS : (["rgba16float"] as const);
    this.compositor = await Compositor.create(this.contexts.get("rgba16float")!, this.gpu.canvasFormat, formats);
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

  /** The screen's counted work (image draws, adjustment passes, resumes from kept composites): pictures' isn't. */
  readonly stats: EvaluatorStats = { imageDraws: 0, adjustmentPasses: 0, resumed: 0 };

  /** What each image is doing (the Layers panel shows missing and failed ones). */
  sourceState(mediaId: string): SourceState {
    return this.sources.get(mediaId)?.state ?? { state: "loading", progress: 0 };
  }

  /** Follows the document: loads the images it shows (in the background), lets go of those it no longer does. */
  setDocument(projectId: string, doc: PhotoProject, assets: readonly MediaAsset[]) {
    if (doc !== this.doc) this.revision++;
    this.projectId = projectId;
    this.doc = doc;
    if (assets.length !== this.assets.size || assets.some((a) => this.assets.get(a.id) !== a)) this.assets = new Map(assets.map((a) => [a.id, a]));
    const wanted = new Set(doc.layers.flatMap((l) => (l.kind === "image" ? [l.mediaId] : [])));
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
      this.changed();
      await image.loadAll((p) => {
        this.setSourceState(source, { state: "loading", progress: p.converted / p.total });
        this.changed();
      });
      if (this.sources.get(source.mediaId) !== source) return;
      this.setSourceState(source, { state: "ready" });
      this.changed();
    } catch (error) {
      if (this.sources.get(source.mediaId) !== source) return;
      this.setSourceState(source, { state: "failed", error: error instanceof Error ? error.message : String(error) });
      this.changed();
    }
  }

  /** Tiles arrived or went: kept composites are out of date, and the screen draws again. */
  private changed() {
    this.residency++;
    this.onChange?.();
  }

  private setSourceState(source: Source, state: SourceState) {
    source.state = state;
    this.onSourceState?.(source.mediaId, state);
  }

  /** Resolves when every image the document shows has loaded (or failed). */
  async ready(): Promise<void> {
    while ([...this.sources.values()].some((s) => s.state.state === "loading")) await new Promise((r) => setTimeout(r, 20));
  }

  // --- the plan ---

  /** What the plan knows of each image: its upright size and depth, from the project's media. */
  private facts(): Map<string, SourceFacts> {
    const out = new Map<string, SourceFacts>();
    for (const a of this.assets.values()) {
      if (a.kind === "image" && a.width && a.height) out.set(a.id, { width: a.width, height: a.height, bits: a.image?.bits === 16 ? 16 : 8 });
    }
    return out;
  }

  /** `doc`'s render plan (the open document's is kept until it changes). */
  planFor(doc: PhotoProject): RenderPlan {
    if (this.compiled?.doc === doc && this.compiled.assets === this.assets) return this.compiled.plan;
    const plan = compileRender(doc, this.facts(), { float32: this.compositor.supports("rgba32float") });
    if (doc === this.doc) this.compiled = { doc, assets: this.assets, plan };
    return plan;
  }

  /** An image node as the compositor draws it, or null while its source isn't on the GPU. */
  private readonly drawOf = (node: ImageNode): LayerDraw | null => {
    const image = this.sources.get(node.mediaId)?.image;
    if (!image) return null;
    return { source: image, matrix: layerMatrix(node.transform, image.layout), transform: node.transform, opacity: node.opacity };
  };

  /** Whether every image the plan draws has loaded (or can't): only then is a refinement final. */
  private settledSources(plan: RenderPlan) {
    return plan.nodes.every((n) => n.kind !== "image" || this.sources.get(n.mediaId)?.state.state !== "loading");
  }

  /** Fetches the evicted tiles of every layer that `view` needs at full resolution. */
  async ensureVisible(view: View, doc = this.doc) {
    return doc ? this.ensurePlanVisible(this.planFor(doc), view) : 0;
  }

  private async ensurePlanVisible(plan: RenderPlan, view: View) {
    let fetched = 0;
    for (const node of plan.nodes) {
      if (node.kind !== "image") continue;
      const draw = this.drawOf(node);
      if (!draw) continue;
      const scale = layerScale(draw.transform);
      if (levelForScale(view.zoom * scale, draw.source.image.levels.length) !== 0) continue;
      const local = layerView(view, draw.matrix, scale, draw.source.layout);
      if (local) fetched += await draw.source.ensureVisible({ ...local, zoom: Math.max(1, local.zoom) });
    }
    if (fetched) this.residency++;
    return fetched;
  }

  // --- the screen ---

  /** Draws on this canvas element (sized in device pixels by the caller). */
  attach(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.dropScreen();
  }

  private dropScreen() {
    const s = this.screen;
    this.screen = null;
    this.refiner.want(null);
    this.refiner.reset();
    if (!s) return;
    for (const t of [s.work.a, s.work.b, s.refined, s.pending, ...s.kept.values()]) t.destroy();
    s.uniform.destroy();
  }

  private screenFor(width: number, height: number, format: PlanFormat): Screen {
    const s = this.screen;
    if (s && s.width === width && s.height === height && s.format === format) return s;
    const { device } = this;
    const context = (s?.context ?? (this.canvas!.getContext("webgpu") as GPUCanvasContext | null))!;
    this.dropScreen();
    context.configure({ device, format: this.gpu.canvasFormat, alphaMode: "opaque" });
    const texture = (label: string) => compositeTexture(device, width, height, format, label);
    this.screen = {
      context,
      width,
      height,
      format,
      work: { a: texture("screen a"), b: texture("screen b") },
      uniform: device.createBuffer({ size: 48, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST }),
      refined: texture("screen refined"),
      pending: texture("screen refining"),
      refinedKey: null,
      kept: new Map(),
      last: null,
    };
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
    const doc = this.doc;
    const plan = this.planFor(doc);
    const screen = this.screenFor(width, height, plan.format);
    const { device } = this;
    const at: View = { ...view, width, height };
    const viewKey = `${view.zoom}|${view.x}|${view.y}|${width}x${height}`;
    const refineKey = needsRefinement(plan, view.zoom) ? `${plan.key}|${viewKey}` : null;
    const encoder = device.createCommandEncoder({ label: "screen" });
    let composite: GPUTexture;
    const refined = refineKey !== null && screen.refinedKey === refineKey;
    if (refined) composite = screen.refined;
    else {
      // Resume from the highest kept composite below an adjustment that's still what it was.
      const keptKey = (index: number) => `${keyBelow(plan, index)}|${viewKey}|${quality}|${this.residency}`;
      let from: { index: number; texture: GPUTexture } | undefined;
      for (let i = plan.nodes.length - 1; i >= 0 && !from; i--) {
        const texture = plan.nodes[i].kind === "adjustment" ? screen.kept.get(keptKey(i)) : undefined;
        if (texture) {
          from = { index: i, texture };
          screen.kept.delete(keptKey(i));
          screen.kept.set(keptKey(i), texture);
        }
      }
      const counted = { ...this.compositor.stats };
      composite = this.compositor.evaluate(encoder, plan, at, quality, this.drawOf, screen.work, {
        from,
        beforeAdjustment: (index, below, enc) => {
          if (index === from?.index) return;
          const key = keptKey(index);
          let keep = screen.kept.get(key);
          if (!keep) {
            if (screen.kept.size >= KEPT) {
              const [oldest, texture] = screen.kept.entries().next().value!;
              screen.kept.delete(oldest);
              keep = texture;
            } else keep = compositeTexture(device, width, height, plan.format, "screen kept");
            screen.kept.set(key, keep);
          }
          enc.copyTextureToTexture({ texture: below }, { texture: keep }, [width, height]);
        },
      });
      for (const key of Object.keys(counted) as (keyof EvaluatorStats)[]) this.stats[key] += this.compositor.stats[key] - counted[key];
    }
    const u = new Float32Array(12);
    const x0 = (0 - view.x) * view.zoom;
    const y0 = (0 - view.y) * view.zoom;
    u.set([x0, y0, x0 + doc.canvas.width * view.zoom, y0 + doc.canvas.height * view.zoom, checker, DITHER_8BIT, 0, 0, ...this.pasteboard, 1]);
    device.queue.writeBuffer(screen.uniform, 0, u);
    this.compositor.present(encoder, composite, screen.uniform, screen.context.getCurrentTexture());
    device.queue.submit([encoder.finish()]);
    screen.last = composite;
    this.presented.push({ revision: this.revision, key: refined ? screen.refinedKey!.slice(0, screen.refinedKey!.indexOf("|")) : plan.key, current: plan.key, refined });
    if (this.presented.length > 600) this.presented.splice(0, 300);

    // Refining: wanted for this view once it's been still a moment, and all its images are in.
    if (this.refineTimer) clearTimeout(this.refineTimer);
    this.refineTimer = null;
    if (!refineKey) {
      this.refiner.want(null);
      this.setRefineState("none");
    } else if (refined) this.setRefineState("refined");
    else {
      this.setRefineState("refining");
      if (quality === "final" && this.settledSources(plan)) {
        if (!this.refiner.isRunning(refineKey)) this.refiner.want(null);
        this.refineTimer = setTimeout(() => {
          this.refineTimer = null;
          const s = this.screen;
          if (!s || s !== screen) return;
          // Wanted only while this screen is the one shown: a resized screen's textures are gone.
          this.refiner.want(refineKey, (isCurrent) => this.refine(plan, at, s.pending, () => isCurrent() && this.screen === s));
        }, REFINE_DELAY_MS);
      } else this.refiner.want(null);
    }
    return { cpuMs: performance.now() - started, gpuMs: device.queue.onSubmittedWorkDone().then(() => performance.now() - started) };
  }

  private setRefineState(state: RefineState) {
    if (state === this.refineState) return;
    this.refineState = state;
    this.onRefineState?.(state);
  }

  /**
   * The full-resolution render, reduced (rendering.md, "The render plan"): tile by tile, `plan` at level 0 over a
   * region, reduced by the pyramid's box down to the view's level, sampled at the view's pixels into `target`.
   * Gives up (null) as soon as it isn't wanted any more.
   */
  async refine(plan: RenderPlan, view: View, target: GPUTexture, isCurrent: () => boolean = () => true): Promise<true | null> {
    const { device } = this;
    const rp = refinePlan(view, plan.canvas, REFINE_REGION);
    const s = 2 ** rp.level;
    let maxW = 1;
    let maxH = 1;
    for (const t of rp.tiles) {
      maxW = Math.max(maxW, t.doc.x1 - t.doc.x0);
      maxH = Math.max(maxH, t.doc.y1 - t.doc.y0);
    }
    const work: WorkPair = { a: compositeTexture(device, maxW, maxH, plan.format, "refine a"), b: compositeTexture(device, maxW, maxH, plan.format, "refine b") };
    const levels: GPUTexture[] = [];
    for (let j = 1; j <= rp.level; j++) levels.push(compositeTexture(device, Math.ceil(maxW / 2 ** j), Math.ceil(maxH / 2 ** j), plan.format, `refine level ${j}`));
    try {
      const clear = device.createCommandEncoder({ label: "refine clear" });
      clear.beginRenderPass({ colorAttachments: [{ view: target.createView(), loadOp: "clear", storeOp: "store", clearValue: [0, 0, 0, 0] }] }).end();
      device.queue.submit([clear.finish()]);
      for (const tile of rp.tiles) {
        if (!isCurrent() || this.destroyed) return null;
        const width = tile.doc.x1 - tile.doc.x0;
        const height = tile.doc.y1 - tile.doc.y0;
        const region: View = { zoom: 1, x: tile.doc.x0, y: tile.doc.y0, width, height };
        await this.ensurePlanVisible(plan, region);
        if (!isCurrent() || this.destroyed) return null;
        const encoder = device.createCommandEncoder({ label: "refine" });
        let current = this.compositor.evaluate(encoder, plan, region, "final", this.drawOf, work);
        let size = { width, height };
        for (const next of levels) {
          this.compositor.reduce(encoder, plan.format, current, size, next);
          size = { width: Math.ceil(size.width / 2), height: Math.ceil(size.height / 2) };
          current = next;
        }
        this.compositor.sample(
          encoder,
          plan.format,
          current,
          { view, inv: 1 / s, origin: { x: tile.level.x0, y: tile.level.y0 }, size: { width: tile.level.x1 - tile.level.x0, height: tile.level.y1 - tile.level.y0 }, stretch: rp.stretch },
          target,
          tile.view,
        );
        device.queue.submit([encoder.finish()]);
        // Let frames through between tiles, and see whether it's still wanted.
        await device.queue.onSubmittedWorkDone();
      }
      return isCurrent() ? true : null;
    } finally {
      const all = [work.a, work.b, ...levels];
      void device.queue.onSubmittedWorkDone().then(() => all.forEach((t) => t.destroy()));
    }
  }

  // --- regions: exports and pictures ---

  /**
   * Renders the document at full size region by region, a band of rows at a time, through the output transform
   * into RGBA at `bits` (8 dithered, 16 not), handing each band to `onBand` (awaited, so bands go in order).
   */
  async renderBands(
    doc: PhotoProject,
    options: { bits?: 8 | 16; under: "none" | "matte" | "checker"; matte?: [number, number, number]; dither?: boolean },
    onBand: (from: number, rows: Uint8Array, width: number) => Promise<void> | void,
  ) {
    const { device } = this;
    const bits = options.bits ?? 8;
    const bytesPerPixel = bits === 16 ? 8 : 4;
    const plan = this.planFor(doc);
    const width = doc.canvas.width;
    const height = doc.canvas.height;
    const work: WorkPair = { a: compositeTexture(device, REGION, REGION, plan.format, "region a"), b: compositeTexture(device, REGION, REGION, plan.format, "region b") };
    const out = device.createBuffer({ size: REGION * REGION * bytesPerPixel, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC });
    const params = device.createBuffer({ size: 48, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    const matte = options.matte ?? [1, 1, 1];
    const groups = new Map<GPUTexture, GPUBindGroup>();
    const groupFor = (t: GPUTexture) => groups.get(t) ?? groups.set(t, this.compositor.quantizeGroup(t, out, params)).get(t)!;
    try {
      for (let y = 0; y < height; y += REGION) {
        const rows = Math.min(REGION, height - y);
        const band = new Uint8Array(width * rows * bytesPerPixel);
        for (let x = 0; x < width; x += REGION) {
          const cols = Math.min(REGION, width - x);
          const view: View = { zoom: 1, x, y, width: cols, height: rows };
          await this.ensurePlanVisible(plan, view);
          const p = new ArrayBuffer(48);
          new Uint32Array(p, 0, 4).set([x, y, cols, rows]);
          new Float32Array(p, 16, 1)[0] = options.dither === false ? 0 : DITHER_8BIT;
          new Uint32Array(p, 20, 1)[0] = options.under === "matte" ? 1 : options.under === "checker" ? 2 : 0;
          new Float32Array(p, 24, 1)[0] = 8;
          new Float32Array(p, 32, 4).set([...matte, 1]);
          device.queue.writeBuffer(params, 0, p);
          const readback = device.createBuffer({ size: cols * rows * bytesPerPixel, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
          const encoder = device.createCommandEncoder({ label: "region" });
          const composite = this.compositor.evaluate(encoder, plan, view, "final", this.drawOf, work);
          const pass = encoder.beginComputePass();
          pass.setPipeline(bits === 16 ? this.compositor.pipelines.quantize16 : this.compositor.pipelines.quantize8);
          pass.setBindGroup(0, groupFor(composite));
          pass.dispatchWorkgroups(Math.ceil(cols / 16), Math.ceil(rows / 16));
          pass.end();
          encoder.copyBufferToBuffer(out, 0, readback, 0, cols * rows * bytesPerPixel);
          device.queue.submit([encoder.finish()]);
          await readback.mapAsync(GPUMapMode.READ);
          const data = new Uint8Array(readback.getMappedRange());
          const rowBytes = cols * bytesPerPixel;
          for (let r = 0; r < rows; r++) band.set(data.subarray(r * rowBytes, (r + 1) * rowBytes), (r * width + x) * bytesPerPixel);
          readback.unmap();
          readback.destroy();
        }
        await onBand(y, band, width);
      }
    } finally {
      work.a.destroy();
      work.b.destroy();
      out.destroy();
      params.destroy();
    }
    return { width, height };
  }

  /**
   * The document as the screen would show it at `view` (a composite texture the caller destroys): evaluated at
   * the view's level, or refined when it needs to be (the assistant's pictures and covers are what's seen).
   */
  async renderView(doc: PhotoProject, view: View, options: { refine?: boolean } = {}): Promise<{ texture: GPUTexture; plan: RenderPlan; refined: boolean }> {
    const { device } = this;
    const plan = this.planFor(doc);
    const width = Math.max(1, Math.round(view.width));
    const height = Math.max(1, Math.round(view.height));
    const at = { ...view, width, height };
    const target = compositeTexture(device, width, height, plan.format, "view");
    const refine = options.refine ?? needsRefinement(plan, view.zoom);
    if (refine && view.zoom < 1) {
      await this.refine(plan, at, target);
      return { texture: target, plan, refined: true };
    }
    await this.ensurePlanVisible(plan, at);
    const work: WorkPair = { a: compositeTexture(device, width, height, plan.format, "view a"), b: compositeTexture(device, width, height, plan.format, "view b") };
    const encoder = device.createCommandEncoder({ label: "view" });
    const composite = this.compositor.evaluate(encoder, plan, at, "final", this.drawOf, work);
    encoder.copyTextureToTexture({ texture: composite }, { texture: target }, [width, height]);
    device.queue.submit([encoder.finish()]);
    await device.queue.onSubmittedWorkDone();
    work.a.destroy();
    work.b.destroy();
    return { texture: target, plan, refined: false };
  }

  /** The document as a picture `width` wide (Home's cover, the assistant's view, thumbnails), over the checkerboard. */
  async picture(doc: PhotoProject, width: number, type: "image/jpeg" | "image/png" = "image/jpeg"): Promise<Blob> {
    const { device } = this;
    const zoom = Math.min(1, width / doc.canvas.width);
    const w = Math.max(1, Math.round(doc.canvas.width * zoom));
    const h = Math.max(1, Math.round(doc.canvas.height * zoom));
    const { texture } = await this.renderView(doc, { zoom, x: 0, y: 0, width: w, height: h });
    const out = device.createBuffer({ size: w * h * 4, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC });
    const params = device.createBuffer({ size: 48, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    const readback = device.createBuffer({ size: w * h * 4, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
    try {
      const p = new ArrayBuffer(48);
      new Uint32Array(p, 0, 4).set([0, 0, w, h]);
      new Float32Array(p, 16, 1)[0] = DITHER_8BIT;
      new Uint32Array(p, 20, 1)[0] = 2;
      new Float32Array(p, 24, 1)[0] = 8;
      device.queue.writeBuffer(params, 0, p);
      const encoder = device.createCommandEncoder({ label: "picture" });
      const pass = encoder.beginComputePass();
      pass.setPipeline(this.compositor.pipelines.quantize8);
      pass.setBindGroup(0, this.compositor.quantizeGroup(texture, out, params));
      pass.dispatchWorkgroups(Math.ceil(w / 16), Math.ceil(h / 16));
      pass.end();
      encoder.copyBufferToBuffer(out, 0, readback, 0, w * h * 4);
      device.queue.submit([encoder.finish()]);
      await readback.mapAsync(GPUMapMode.READ);
      const pixels = new Uint8ClampedArray(readback.getMappedRange().slice(0));
      readback.unmap();
      const canvas = new OffscreenCanvas(w, h);
      canvas.getContext("2d")!.putImageData(new ImageData(pixels, w, h), 0, 0);
      return await canvas.convertToBlob({ type, quality: 0.85 });
    } finally {
      texture.destroy();
      out.destroy();
      params.destroy();
      readback.destroy();
    }
  }

  /**
   * Exports the document at its canvas size: PNG keeps transparency (8 or 16 bits), JPEG goes over the background
   * (or white). The server encodes it into `destination` (the save dialog's), or keeps it to download.
   */
  async export(
    projectId: string,
    doc: PhotoProject,
    request: { name: string; format: "png" | "jpeg"; bits?: 8 | 16; quality?: number; destination?: string | null },
    onProgress?: (fraction: number) => void,
  ) {
    const bits = request.format === "png" && request.bits === 16 ? 16 : 8;
    const { id } = await photoApi.beginExport({
      projectId,
      name: request.name,
      width: doc.canvas.width,
      height: doc.canvas.height,
      bits,
      format: request.format,
      quality: request.quality,
      destination: request.destination,
    });
    try {
      await this.renderBands(doc, { bits, under: request.format === "jpeg" ? "matte" : "none", matte: matteOf(doc) }, async (from, rows, width) => {
        await photoApi.exportRows(id, from, rows);
        onProgress?.((from + rows.length / (width * (bits === 16 ? 8 : 4))) / doc.canvas.height);
      });
      return { id, ...(await photoApi.finishExport(id)) };
    } catch (error) {
      void photoApi.cancelExport(id).catch(() => {});
      throw error;
    }
  }

  // --- checks ---

  /** A composite texture's top-left `width` × `height` as RGBA floats (the GPU's own numbers, for checks). */
  async readFloat(texture: GPUTexture, width: number, height: number): Promise<Float32Array> {
    const { device } = this;
    const half = texture.format === "rgba16float";
    const texel = half ? 8 : 16;
    const bytesPerRow = Math.ceil((width * texel) / 256) * 256;
    const buffer = device.createBuffer({ size: bytesPerRow * height, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
    const encoder = device.createCommandEncoder();
    encoder.copyTextureToBuffer({ texture }, { buffer, bytesPerRow }, [width, height]);
    device.queue.submit([encoder.finish()]);
    await buffer.mapAsync(GPUMapMode.READ);
    const mapped = buffer.getMappedRange();
    const out = new Float32Array(width * height * 4);
    for (let y = 0; y < height; y++) {
      if (half) {
        const row = new Uint16Array(mapped, y * bytesPerRow, width * 4);
        for (let i = 0; i < width * 4; i++) out[y * width * 4 + i] = fromHalf(row[i]);
      } else out.set(new Float32Array(mapped, y * bytesPerRow, width * 4), y * width * 4);
    }
    buffer.unmap();
    buffer.destroy();
    return out;
  }

  /** What the screen last showed, as floats (before the output transform), and whether it was refined. */
  async readScreen(): Promise<{ data: Float32Array; width: number; height: number; refined: boolean } | null> {
    const screen = this.screen;
    if (!screen?.last) return null;
    return { data: await this.readFloat(screen.last, screen.width, screen.height), width: screen.width, height: screen.height, refined: screen.last === screen.refined };
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
      this.dropScreen();
      this.compiled = null;
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
    if (this.refineTimer) clearTimeout(this.refineTimer);
    this.refiner.want(null);
    for (const s of this.sources.values()) s.image?.destroy();
    this.sources.clear();
    this.dropScreen();
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
