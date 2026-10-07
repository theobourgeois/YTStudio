/**
 * The open photo on the GPU (docs/photo/architecture.md): the device, a source for each image the document shows
 * (decoded on the server, converted and levelled here), a surface for each pixel layer and mask (tiles by hash,
 * painted here: `surface.ts`), the compositor, and the screen. The document is compiled
 * into a render plan (`shared/photo/render-plan.ts`) and evaluated; exports, Home's cover and the assistant's
 * pictures render through the same evaluator at other views, with the canvas element or without one. A lost device
 * is replaced and everything fetched again from the server.
 *
 * The screen keeps the composite below each adjustment it last drew, so a slider drag on an adjustment re-runs only
 * that adjustment and what's above it. Below 100%, a plan that doesn't commute with reduction is drawn at the
 * view's level at once and then **refined**: rendered at full resolution and reduced (`refine`), in the
 * background, and shown only if it's still what the screen should show (`LatestOnly`).
 */
import { sourceTransform, srgbToLinear } from "@shared/photo/colour.ts";
import { type View, levelForScale } from "@shared/photo/geometry.ts";
import { fromHalf, toHalf } from "@shared/photo/half.ts";
import { coverageIn } from "@shared/photo/selection.ts";
import type { BrushSettings } from "@shared/photo/brush.ts";
import { type Affine, IDENTITY, apply, invert, layerMatrix, layerScale } from "@shared/photo/layers.ts";
import type { TileSize } from "@shared/photo/lab.ts";
import { DITHER_8BIT, type Highlights } from "@shared/photo/output.ts";
import { type PixelSample, sampleSize } from "@shared/photo/pixel-sample.ts";
import {
  type DrawNode,
  type PatternRef,
  type PlanFormat,
  type RenderPlan,
  type SourceFacts,
  backgroundLight,
  type CameraRawNeed,
  type CameraRawResolver,
  type SceneNeed,
  type SceneResolver,
  type CompileOptions,
  compileRender,
  filtersReach,
  isDrawNode,
  keyBelow,
  needsRefinement,
  refinePlan,
} from "@shared/photo/render-plan.ts";
import { type SurfaceManifest, emptySurface, withTiles } from "@shared/photo/surfaces.ts";
import { type LayerStyle, type LayerTransform, PHOTO_VERSION, type PhotoLayer, type PhotoPattern, type PhotoProject, type PhotoSelection, type SurfaceId, isPlaced } from "@shared/photo/types.ts";
import type { MediaAsset } from "@shared/types";
import { photoApi } from "../api.ts";
import type { SurfacePart } from "../paint-target.ts";
import { type SurfaceUploads, uploadsFor } from "../uploads.ts";
import { type AtlasFormat, AtlasFullError } from "./atlas.ts";
import { planFields } from "./style.ts";
import { readSurface, surfaceFromPixels } from "../surface-pixels.ts";
import { COMPOSITE_FORMATS, Compositor, type Drawable, type EvaluatorStats, type LayerDraw, type PlanSources, type Quality, type WorkPair, compositeTexture, needsPass } from "./compositor.ts";
import { RenderContext } from "./context.ts";
import type { BrushEffect } from "./brush-effects.ts";
import { GlowCaches } from "./glow-cache.ts";
import { type AnalysisHost, CameraRawAnalyses } from "./camera-raw-analysis.ts";
import { SceneMapStore } from "./scene-maps.ts";
import { type Gpu, createGpu } from "./gpu.ts";
import { LatestOnly } from "./latest.ts";
import { SourceImage } from "./source.ts";
import { CanvasImages } from "./canvas-content.ts";
import { SurfaceImage, type SurfaceKind } from "./surface.ts";
import { shapeBounds } from "@shared/photo/shape-drawing.ts";
import { type PatternImage, builtInPatternLevels, patternFromLinear, patternMips } from "@shared/photo/style/patterns.ts";

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
/** A pattern's key among the loaded ones. */
const patternKey = (ref: PatternRef) => ("builtin" in ref ? ref.builtin : `${ref.surface}|${ref.width}x${ref.height}`);

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

export type { SurfacePart };

/**
 * The side of a glow cache's build regions for a GPU budget: a power of two whose tiles (and a tile around them)
 * take at most a quarter of the f32 atlas the budget allows, from a tile up (2048 at every budget Settings offers).
 */
export function glowBuildRegion(budgetBytes: number): number {
  const tiles = budgetBytes / (TILE * TILE * 16) / 4;
  const side = Math.max(1, Math.floor(Math.sqrt(tiles)) - 2) * TILE;
  return 2 ** Math.max(Math.log2(TILE), Math.min(11, Math.floor(Math.log2(side))));
}

/** How many passes in a row `ensurePlanVisible` fetches before deciding a view needs more than the budget holds. */
const MAX_RESIDENCY_PASSES = 3;
/** How many times it waits (4 ms each) for tiles another render is fetching. */
const MAX_RESIDENCY_WAITS = 2500;

/** What a view needs resident: a surface's tiles over a region of its pixels (null: all), or an image's for a view. */
type ResidencyNeed = { image?: undefined; surface: SurfaceImage; region: { x: number; y: number; width: number; height: number } | null } | { image: SourceImage; view: View; surface?: undefined };

/** A layer's surface on the GPU, and what it's made for (a different size or atlas makes a new one). */
interface LayerSurface {
  /** Null while its atlas is made (a 16-bit image's mask lives in the f32 one, beside its source). */
  image: SurfaceImage | null;
  /** `kind|width×height|format`. */
  shape: string;
  /** What the document says it shows. */
  wanted: SurfaceId | null;
  /** Why it can't show that (its manifest or tiles couldn't be fetched): it's drawn as it is, and waited for no more. */
  failed: string | null;
}

/** A stroke in progress: its surface, and how document points reach its pixels. */
interface Stroke {
  key: string;
  surface: SurfaceImage;
  /** Document pixels → the surface's pixels, and its scale (a dab's radius is in document pixels). */
  toSurface: Affine;
  scale: number;
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
  /** When it was drawn (`performance.now()`), its quality, and whether any image's pixels were on the GPU for it. */
  at: number;
  quality: Quality;
  drawn: boolean;
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
  /** Pixel layers' pixels and masks, by `layerId:part`. */
  private readonly surfaces = new Map<string, LayerSurface>();
  private uploads: SurfaceUploads | null = null;
  /** Document patterns' levels by surface and size (`patternOf`). */
  private readonly patternLevels = new Map<string, { levels: PatternImage[] | null; failed: boolean; loaded: Promise<void> }>();
  private stroke: Stroke | null = null;
  /** Layers the 2D canvas draws (text), drawn once per raster (`canvas-content.ts`). */
  private readonly canvasImages = new CanvasImages();
  private projectId: string | null = null;
  private doc: PhotoProject | null = null;
  private assets = new Map<string, MediaAsset>();
  private compiled: { doc: PhotoProject; assets: Map<string, MediaAsset>; analyses: string; plan: RenderPlan; pending: boolean } | null = null;
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
  /** Strokes lost with the device (counted: a stroke's controller tells the user its stroke wasn't kept). */
  lostStrokes = 0;

  /** Each glow's contributions over its layer, from level-0 renders (`glow-cache.ts`). */
  readonly glows: GlowCaches;

  /** How analyses and scene maps are made: a picture rendered coarsely and read back, once what it shows is in. */
  private readonly analysisHost: AnalysisHost = {
    settled: async (doc) => {
      const plan = compileRender(doc, this.facts(), { cameraRaw: () => null, scene: () => null });
      while (!this.destroyed && (this.recovering || !this.settledSources(plan))) await new Promise((r) => setTimeout(r, 20));
    },
    renderFloats: async (doc, view) => {
      const { texture } = await this.renderView(doc, view, { quick: true });
      const data = await this.readFloat(texture, view.width, view.height);
      texture.destroy();
      return data;
    },
    built: () => this.changed(),
  };

  /** Camera Raw's analyses, by what each develops (`camera-raw-analysis.ts`). */
  readonly cameraRaw = new CameraRawAnalyses(this.analysisHost);

  /** Filters' scene maps (depth, subject), by the picture each is of (`scene-maps.ts`). */
  readonly scene = new SceneMapStore(this.analysisHost);

  /** What the analyses and maps the plans read are now: a plan compiled before they changed is compiled again. */
  private analyses() {
    return `${this.cameraRaw.generation}|${this.scene.generation}`;
  }

  private constructor(readonly budgetBytes: number) {
    this.glows = new GlowCaches({
      compositor: () => this.compositor,
      device: () => this.device,
      sources: this.planSources,
      whenResident: (plan, view, draw) => this.whenResident(plan, view, draw),
      buildRegion: () => glowBuildRegion(this.budgetBytes),
      settled: (plan) => this.settledSources(plan),
      built: () => this.changed(),
    });
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
  readonly stats: EvaluatorStats = { imageDraws: 0, adjustmentPasses: 0, blendPasses: 0, stylePasses: 0, resumed: 0 };

  /** Tiles evicted from the atlases to stay within the budget, since this device started (the budget tests'). */
  get evictions(): number {
    return [...this.contexts.values()].reduce((n, ctx) => n + ctx.atlas.evictions, 0);
  }

  /** What each image is doing (the Layers panel shows missing and failed ones). */
  sourceState(mediaId: string): SourceState {
    return this.sources.get(mediaId)?.state ?? { state: "loading", progress: 0 };
  }

  /** Follows the document: loads the images it shows (in the background), lets go of those it no longer does. */
  setDocument(projectId: string, doc: PhotoProject, assets: readonly MediaAsset[]) {
    const changed = doc !== this.doc;
    if (changed) this.revision++;
    this.projectId = projectId;
    this.doc = doc;
    if (assets.length !== this.assets.size || assets.some((a) => this.assets.get(a.id) !== a)) this.assets = new Map(assets.map((a) => [a.id, a]));
    this.uploads = uploadsFor(projectId);
    this.syncSurfaces(doc);
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
    // The screen draws what it's shown: a document the store doesn't hold (the Filter Gallery's preview) too.
    if (changed) this.onChange?.();
  }

  /**
   * Follows the document's surfaces: a pixel layer's pixels (f16), a mask in its layer's pixels (an image's source
   * pixels, in its source's atlas; a pixel layer's; an adjustment's: the canvas), each showing what the document
   * says. A surface whose size or atlas changed is made afresh; one no layer has any more goes.
   */
  private syncSurfaces(doc: PhotoProject) {
    const wanted = new Map<string, { kind: SurfaceKind; size: { width: number; height: number }; bits: 8 | 16; id: SurfaceId | null }>();
    for (const l of doc.layers) {
      if (l.kind === "pixel") wanted.set(`${l.id}:content`, { kind: "pixels", size: l.size, bits: 8, id: l.surface });
      if (!l.mask) continue;
      if (l.kind === "image") {
        const asset = this.assets.get(l.mediaId);
        if (!asset?.width || !asset.height) continue;
        wanted.set(`${l.id}:mask`, { kind: "mask", size: { width: asset.width, height: asset.height }, bits: asset.image?.bits === 16 ? 16 : 8, id: l.mask.surface });
      } else wanted.set(`${l.id}:mask`, { kind: "mask", size: l.kind === "pixel" ? l.size : doc.canvas, bits: 8, id: l.mask.surface });
    }
    for (const [key, s] of this.surfaces) {
      if (wanted.has(key)) continue;
      if (this.stroke?.key === key) this.stroke = null;
      s.image?.destroy();
      this.surfaces.delete(key);
    }
    for (const [key, want] of wanted) {
      const shape = `${want.kind}|${want.size.width}x${want.size.height}|${want.bits}`;
      let s = this.surfaces.get(key);
      if (s && s.shape !== shape) {
        if (this.stroke?.key === key) this.stroke = null;
        s.image?.destroy();
        s = undefined;
      }
      if (!s) {
        const made: LayerSurface = { image: null, shape, wanted: want.id, failed: null };
        this.surfaces.set(key, made);
        void this.contextFor(want.bits).then((ctx) => {
          if (this.surfaces.get(key) !== made || this.destroyed) return;
          const image = new SurfaceImage(ctx, want.size, want.kind, this.uploads!);
          image.onChange = () => this.changed();
          made.image = image;
          void this.showSurface(made);
        });
        continue;
      }
      if (s.wanted !== want.id) {
        s.wanted = want.id;
        s.failed = null;
        void this.showSurface(s);
      }
    }
  }

  private async showSurface(s: LayerSurface) {
    if (!s.image || s.image.painting) return;
    const wanted = s.wanted;
    try {
      await s.image.show(wanted);
      await s.image.ensureResident();
    } catch (error) {
      if (s.wanted === wanted) s.failed = error instanceof Error ? error.message : String(error);
      console.error("[photo] couldn't show a surface", error);
    }
    this.changed();
  }

  /** A layer's surface on the GPU, when it's there and shows what the document says. */
  private surfaceOf(layerId: string, part: SurfacePart): SurfaceImage | null {
    const s = this.surfaces.get(`${layerId}:${part}`);
    return s?.image ?? null;
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
      if ([...this.sources.values()].every((s) => s.state.state !== "loading")) this.loadedAt = performance.now();
      this.changed();
    } catch (error) {
      if (this.sources.get(source.mediaId) !== source) return;
      this.setSourceState(source, { state: "failed", error: error instanceof Error ? error.message : String(error) });
      this.changed();
    }
  }

  /**
   * A pattern's levels for the style pass: a built-in one's, made by code; a document's, read once from its surface's
   * tiles (null meanwhile: the screen draws again when it's in).
   */
  private patternOf(ref: PatternRef): PatternImage[] | null {
    if ("builtin" in ref) return builtInPatternLevels(ref.builtin);
    const key = patternKey(ref);
    const kept = this.patternLevels.get(key);
    if (kept) return kept.levels;
    const uploads = this.uploads;
    if (!uploads) return null;
    const entry: { levels: PatternImage[] | null; failed: boolean; loaded: Promise<void> } = { levels: null, failed: false, loaded: Promise.resolve() };
    this.patternLevels.set(key, entry);
    entry.loaded = readSurface(uploads, ref.surface, ref.width, ref.height)
      .then((linear) => {
        if (this.patternLevels.get(key) !== entry || this.destroyed) return;
        entry.levels = patternMips(patternFromLinear(ref.width, ref.height, linear));
        this.changed();
      })
      .catch(() => {
        entry.failed = true;
        this.changed();
      });
    return null;
  }

  /** Waits until every pattern the plan's styles read is in (or failed): a view, an export or a picture shows them. */
  private async ensurePatterns(plan: RenderPlan) {
    const refs = plan.nodes.flatMap((n) => (isDrawNode(n) && n.style ? Object.values(n.style.patterns) : []));
    for (const ref of refs) if (this.patternOf(ref) === null) await this.patternLevels.get(patternKey(ref))?.loaded;
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

  /** When the last image the document shows finished loading (`performance.now()`), for the bench. */
  loadedAt: number | null = null;

  /** Resolves when every image the document shows has loaded (or failed), and every surface shows its pixels. */
  async ready(): Promise<void> {
    const surfacesDone = () =>
      [...this.surfaces.values()].every((s) => s.failed !== null || (s.image && (s.image.painting || (s.image.shown === s.wanted && s.image.settled))));
    while ([...this.sources.values()].some((s) => s.state.state === "loading") || !surfacesDone()) {
      await new Promise((r) => setTimeout(r, 20));
      for (const s of this.surfaces.values()) {
        if (!s.image || s.failed !== null || s.image.shown !== s.wanted || s.image.settled) continue;
        void s.image.ensureResident().catch((error: unknown) => (s.failed = error instanceof Error ? error.message : String(error)));
      }
    }
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

  /**
   * `doc`'s render plan (the open document's is kept until it changes), for the screen: a Camera Raw analysis not
   * there yet is started, and the plan draws without it meanwhile (its keys say so).
   */
  planFor(doc: PhotoProject): RenderPlan {
    if (this.compiled?.doc === doc && this.compiled.assets === this.assets && this.compiled.analyses === this.analyses()) return this.compiled.plan;
    const analyses = this.analyses();
    const missing: CameraRawNeed[] = [];
    const missingMaps: SceneNeed[] = [];
    const plan = this.compile(doc, this.cameraRaw.resolver(doc, { build: true, missing }), this.scene.resolver(doc, { build: true, missing: missingMaps }));
    if (doc === this.doc) this.compiled = { doc, assets: this.assets, analyses, plan, pending: missing.length + missingMaps.length > 0 };
    return plan;
  }

  /** `doc`'s render plan with every Camera Raw analysis it reads in (built first): what's drawn for keeps. */
  async settledPlan(doc: PhotoProject, float32 = this.compositor.supports("rgba32float"), region?: CompileOptions["region"]): Promise<RenderPlan> {
    // The open document's, when the screen's is complete.
    const c = this.compiled;
    if (!region && c && c.doc === doc && c.assets === this.assets && c.analyses === this.analyses() && !c.pending && float32 === this.compositor.supports("rgba32float")) return c.plan;
    // Compiled until every analysis and map it reads is there (each built after what's below it), or can't be.
    for (let round = 0; ; round++) {
      const missing: CameraRawNeed[] = [];
      const missingMaps: SceneNeed[] = [];
      const plan = this.compile(doc, this.cameraRaw.resolver(doc, { missing }), this.scene.resolver(doc, { missing: missingMaps }), float32, region);
      if ((!missing.length && !missingMaps.length) || round >= 8) return plan;
      const built = await Promise.all([...missing.map((need) => this.cameraRaw.build(need, doc)), ...missingMaps.map((need) => this.scene.build(need, doc))]);
      // Maps that can't be made (a model isn't here) leave their filters out: nothing to wait for.
      if (built.every((b) => b === null)) return plan;
    }
  }

  private compile(doc: PhotoProject, cameraRaw: CameraRawResolver, scene: SceneResolver, float32 = this.compositor.supports("rgba32float"), region?: CompileOptions["region"]): RenderPlan {
    const plan = compileRender(doc, this.facts(), { float32, cameraRaw, scene, region });
    // The glows' caches are found by node: say which this plan's are.
    this.glows.glowsOf(plan);
    return plan;
  }

  /** What the compositor reads: each layer's pixels and mask, each adjustment's mask (null while not on the GPU). */
  private readonly planSources: PlanSources = {
    draw: (node: DrawNode): LayerDraw | null => {
      const mask = node.mask ? this.surfaceOf(node.layerId, "mask") : null;
      if (node.mask && !mask) return null;
      if (node.kind === "pixel") {
        const pixels = this.surfaceOf(node.layerId, "content");
        if (!pixels) return null;
        return { source: pixels, matrix: node.matrix, transform: node.transform, opacity: node.opacity, mask, crop: node.crop };
      }
      if (node.kind === "canvas") {
        // Drawn now if it isn't kept, in the 8-bit atlas (beside its mask, in document pixels).
        const image = this.canvasImages.get(this.contexts.get("rgba16float")!, node.raster);
        if (mask && mask.ctx !== image.ctx) return null;
        return { source: image, matrix: node.matrix, transform: node.transform, opacity: node.opacity, mask };
      }
      const image = this.sources.get(node.mediaId)?.image;
      if (!image) return null;
      // A mask lives in its source's atlas (a 16-bit source's is f32): one made for another isn't drawn with it.
      if (mask && mask.ctx !== image.ctx) return null;
      return { source: image, matrix: layerMatrix(node.transform, image.layout), transform: node.transform, opacity: node.opacity, mask, crop: node.crop };
    },
    mask: (node: { layerId: string }): Drawable | null => this.surfaceOf(node.layerId, "mask"),
    glowCache: (node, index) => this.glows.lookup(node, index),
    // A styled layer's fields follow its pixels and mask as they change (strokes, tiles arriving).
    revision: (node: DrawNode) => `${this.residency}|${this.surfaceOf(node.layerId, "content")?.revision ?? ""}|${this.surfaceOf(node.layerId, "mask")?.revision ?? ""}`,
    pattern: (ref) => this.patternOf(ref),
  };

  /** Whether every image the plan draws has loaded (or can't), and every surface shows its pixels: only then is a refinement final. */
  private settledSources(plan: RenderPlan) {
    const surfaceDone = (layerId: string, part: SurfacePart) => {
      const s = this.surfaces.get(`${layerId}:${part}`);
      return !s || s.failed !== null || (!!s.image && s.image.shown === s.wanted && s.image.settled);
    };
    return plan.nodes.every(
      (n) =>
        (n.kind !== "image" || this.sources.get(n.mediaId)?.state.state !== "loading") &&
        (n.kind !== "pixel" || surfaceDone(n.layerId, "content")) &&
        (!n.mask || surfaceDone(n.layerId, "mask")) &&
        // A style's patterns are in (or failed), asked for now if they haven't been.
        (!isDrawNode(n) || !n.style || Object.values(n.style.patterns).every((ref) => this.patternOf(ref) !== null || this.patternLevels.get(patternKey(ref))?.failed === true)),
    );
  }

  /** Fetches the evicted tiles of every layer that `view` needs at full resolution. */
  async ensureVisible(view: View, doc = this.doc) {
    return doc ? this.ensurePlanVisible(this.planFor(doc), view) : 0;
  }

  /**
   * Fetches what `view` needs at full resolution, until it's all resident at once: each pass marks what's there as
   * just used before fetching the rest, so the atlas evicts other tiles; a pass that fetches nothing and finds it all
   * there is the end (one waits a moment while another render fetches some of the same tiles). A view needing more
   * than the budget holds never gets there: that's an error, never wrong pixels. Callers that draw at once check
   * `planResident` again first, with no await between it and drawing (`whenResident`).
   */
  private async ensurePlanVisible(plan: RenderPlan, view: View) {
    let fetched = 0;
    for (let fetching = 0, waiting = 0; ; ) {
      const needs = this.planNeeds(plan, view);
      let now = 0;
      for (const need of needs) now += need.image ? await need.image.ensureVisible(need.view) : await need.surface.ensureResident(need.region);
      fetched += now;
      if (now) {
        if (++fetching > MAX_RESIDENCY_PASSES) {
          throw new AtlasFullError(`This photo needs more GPU memory for one region than Settings › Photo allows (${Math.round(this.budgetBytes / 1024 ** 2)} MB): choose more there.`);
        }
        continue;
      }
      fetching = 0;
      if (this.planResident(plan, view)) break;
      // Some are being fetched by another render: wait for them.
      if (++waiting > MAX_RESIDENCY_WAITS) throw new Error("The photo's tiles took too long to arrive.");
      await new Promise((r) => setTimeout(r, 4));
    }
    if (fetched) this.residency++;
    return fetched;
  }

  /**
   * Makes what `view` needs resident, then runs `draw` (synchronous: it encodes and submits) the moment it all is,
   * with nothing awaited between the check and the drawing, so no other render can evict a tile it reads.
   */
  private async whenResident<T>(plan: RenderPlan, view: View, draw: () => T): Promise<T> {
    for (;;) {
      await this.ensurePlanVisible(plan, view);
      if (this.planResident(plan, view)) return draw();
    }
  }

  /** Whether every tile `view` needs at full resolution is resident now. */
  private planResident(plan: RenderPlan, view: View): boolean {
    return this.planNeeds(plan, view).every((need) => (need.image ? need.image.residentFor(need.view) : need.surface.residentOver(need.region)));
  }

  /**
   * The tiles `view` needs at full resolution: each surface's under it (its pixels: the layer's matrix takes them to
   * the document; all of them when it's shown at a reduced level, whose tiles are made from them, or when its style's
   * fields are made from all of it), and each image's level-0 tiles under it (all of them for a style's fields).
   */
  private planNeeds(plan: RenderPlan, view: View): ResidencyNeed[] {
    const needs: ResidencyNeed[] = [];
    const doc = { width: plan.canvas.width, height: plan.canvas.height };
    const surface = (layerId: string, part: SurfacePart, matrix: Affine, scale: number, size: { width: number; height: number }, whole = false) => {
      const image = this.surfaceOf(layerId, part);
      if (!image) return;
      if (whole || levelForScale(view.zoom * scale, image.image.levels.length) !== 0) return void needs.push({ surface: image, region: null });
      const local = layerView(view, matrix, scale, size);
      if (local) needs.push({ surface: image, region: { x: local.x, y: local.y, width: local.width / local.zoom, height: local.height / local.zoom } });
    };
    for (const node of plan.nodes) {
      if (node.kind === "pixel") {
        const scale = layerScale(node.transform);
        const levels = this.surfaceOf(node.layerId, "content")?.image.levels.length ?? 1;
        surface(node.layerId, "content", node.matrix, scale, node.size, !!node.style && planFields(node, levels).level === 0);
        if (node.mask) surface(node.layerId, "mask", node.matrix, scale, node.size);
      } else if (node.kind === "image") {
        const image = this.sources.get(node.mediaId)?.image;
        if (node.mask && image) surface(node.layerId, "mask", layerMatrix(node.transform, image.layout), layerScale(node.transform), image.layout);
      } else if (node.mask) {
        // An adjustment's or a generator's mask is in document pixels.
        surface(node.layerId, "mask", IDENTITY, 1, doc);
      }
    }
    for (const node of plan.nodes) {
      if (node.kind !== "image") continue;
      const image = this.sources.get(node.mediaId)?.image;
      if (!image) continue;
      // A styled image's fields are made from all of it, at their level: level 0's tiles are fetched (the rest are
      // always there).
      if (node.style && planFields(node, image.image.levels.length).level === 0) {
        needs.push({ image, view: { x: 0, y: 0, width: image.layout.width, height: image.layout.height, zoom: 1 } });
      }
      const scale = layerScale(node.transform);
      if (levelForScale(view.zoom * scale, image.image.levels.length) !== 0) continue;
      const local = layerView(view, layerMatrix(node.transform, image.layout), scale, image.layout);
      if (local) needs.push({ image, view: { ...local, zoom: Math.max(1, local.zoom) } });
    }
    return needs;
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
    // Pipelines past the first picture's are still compiling: the frame comes once they have.
    if (!this.compositor.canEvaluate(plan)) {
      const compositor = this.compositor;
      void compositor.ready.then(() => {
        if (this.compositor === compositor) this.onChange?.();
      });
      return null;
    }
    const screen = this.screenFor(width, height, plan.format);
    const { device } = this;
    const at: View = { ...view, width, height };
    const viewKey = `${view.zoom}|${view.x}|${view.y}|${width}x${height}`;
    // A stroke paints without changing the plan, and tiles arriving change what's drawn: neither may show an old refinement.
    const refineKey = needsRefinement(plan, view.zoom) ? `${plan.key}|${viewKey}|${this.residency}` : null;
    const encoder = device.createCommandEncoder({ label: "screen" });
    let composite: GPUTexture;
    const refined = refineKey !== null && screen.refinedKey === refineKey;
    if (refined) composite = screen.refined;
    else {
      // Resume from the highest kept composite below an adjustment that's still what it was.
      const keptKey = (index: number) => `${keyBelow(plan, index)}|${viewKey}|${quality}|${this.residency}`;
      let from: { index: number; texture: GPUTexture } | undefined;
      for (let i = plan.nodes.length - 1; i >= 0 && !from; i--) {
        const texture = needsPass(plan.nodes[i]) ? screen.kept.get(keptKey(i)) : undefined;
        if (texture) {
          from = { index: i, texture };
          screen.kept.delete(keptKey(i));
          screen.kept.set(keptKey(i), texture);
        }
      }
      const counted = { ...this.compositor.stats };
      composite = this.compositor.evaluate(encoder, plan, at, quality, this.planSources, screen.work, {
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
    u.set([x0, y0, x0 + doc.canvas.width * view.zoom, y0 + doc.canvas.height * view.zoom, checker, DITHER_8BIT, doc.output.highlights === "film" ? 1 : 0, 0, ...this.pasteboard, 1]);
    device.queue.writeBuffer(screen.uniform, 0, u);
    this.compositor.present(encoder, composite, screen.uniform, screen.context.getCurrentTexture());
    device.queue.submit([encoder.finish()]);
    screen.last = composite;
    this.presented.push({
      revision: this.revision,
      key: refined ? screen.refinedKey!.slice(0, screen.refinedKey!.indexOf("|")) : plan.key,
      current: plan.key,
      refined,
      at: started,
      quality,
      drawn: plan.nodes.some((n) => isDrawNode(n) && this.planSources.draw(n) !== null),
    });
    if (this.presented.length > 600) this.presented.splice(0, 300);

    // Refining: wanted for this view once it's been still a moment, and all its images are in.
    if (this.refineTimer) clearTimeout(this.refineTimer);
    this.refineTimer = null;
    // A glow's cache is built once the plan has been still a moment (the screen reads previews of it until then).
    this.glows.want(quality === "final" ? plan : null);
    if (!refineKey) {
      this.refiner.want(null);
      this.setRefineState(this.glows.complete(plan) ? "none" : "refining");
    } else if (refined) this.setRefineState("refined");
    else {
      this.setRefineState("refining");
      if (quality === "final" && this.settledSources(plan) && this.compositor.canEvaluate(plan, true)) {
        if (!this.refiner.isRunning(refineKey)) this.refiner.want(null);
        this.refineTimer = setTimeout(() => {
          this.refineTimer = null;
          const s = this.screen;
          if (!s || s !== screen) return;
          // Wanted only while this screen is the one shown: a resized screen's textures are gone.
          this.refiner.want(refineKey, (isCurrent) =>
            this.refine(plan, at, s.pending, () => isCurrent() && this.screen === s).catch((error: unknown) => {
              console.error("[photo] refining the view failed", error);
              return null;
            }),
          );
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
    await this.compositor.ready;
    await this.glows.ensure(plan, isCurrent);
    if (!isCurrent() || this.destroyed) return null;
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
        const drawn = await this.whenResident(plan, region, () => {
          if (!isCurrent() || this.destroyed) return false;
          const encoder = device.createCommandEncoder({ label: "refine" });
          let current = this.compositor.evaluate(encoder, plan, region, "final", this.planSources, work);
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
          return true;
        });
        if (!drawn) return null;
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
    options: { bits?: 8 | 16; under: "none" | "matte" | "checker"; matte?: [number, number, number]; dither?: boolean; origin?: { x: number; y: number } },
    onBand: (from: number, rows: Uint8Array, width: number) => Promise<void> | void,
  ) {
    await this.compositor.ready;
    const { device } = this;
    const bits = options.bits ?? 8;
    const bytesPerPixel = bits === 16 ? 8 : 4;
    // A render elsewhere than the canvas (a merge's box) says where, for what's drawn by the 2D canvas.
    const o = options.origin;
    const plan = await this.settledPlan(doc, undefined, o ? { x0: o.x, y0: o.y, x1: o.x + doc.canvas.width, y1: o.y + doc.canvas.height } : undefined);
    await this.glows.ensure(plan);
    await this.ensurePatterns(plan);
    const width = doc.canvas.width;
    const height = doc.canvas.height;
    const work: WorkPair = { a: compositeTexture(device, REGION, REGION, plan.format, "region a"), b: compositeTexture(device, REGION, REGION, plan.format, "region b") };
    const out = device.createBuffer({ size: REGION * REGION * bytesPerPixel, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC });
    const params = device.createBuffer({ size: 48, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    const matte = options.matte ?? [1, 1, 1];
    const groups = new Map<GPUTexture, GPUBindGroup>();
    const groupFor = (t: GPUTexture) => groups.get(t) ?? groups.set(t, this.compositor.quantizeGroup(t, out, params)).get(t)!;
    // The document point at the render's top-left (a merge renders a box of the document where it is).
    const ox = options.origin?.x ?? 0;
    const oy = options.origin?.y ?? 0;
    try {
      for (let y = 0; y < height; y += REGION) {
        const rows = Math.min(REGION, height - y);
        const band = new Uint8Array(width * rows * bytesPerPixel);
        for (let x = 0; x < width; x += REGION) {
          const cols = Math.min(REGION, width - x);
          const view: View = { zoom: 1, x: ox + x, y: oy + y, width: cols, height: rows };
          const readback = await this.whenResident(plan, view, () => {
            const p = new ArrayBuffer(48);
            new Uint32Array(p, 0, 4).set([ox + x, oy + y, cols, rows]);
            new Float32Array(p, 16, 1)[0] = options.dither === false ? 0 : DITHER_8BIT;
            new Uint32Array(p, 20, 1)[0] = options.under === "matte" ? 1 : options.under === "checker" ? 2 : 0;
            new Float32Array(p, 24, 1)[0] = 8;
            new Uint32Array(p, 28, 1)[0] = doc.output.highlights === "film" ? 1 : 0;
            new Float32Array(p, 32, 4).set([...matte, 1]);
            device.queue.writeBuffer(params, 0, p);
            const readback = device.createBuffer({ size: cols * rows * bytesPerPixel, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
            const encoder = device.createCommandEncoder({ label: "region" });
            const composite = this.compositor.evaluate(encoder, plan, view, "final", this.planSources, work);
            const pass = encoder.beginComputePass();
            pass.setPipeline(bits === 16 ? this.compositor.pipelines.quantize16! : this.compositor.pipelines.quantize8);
            pass.setBindGroup(0, groupFor(composite));
            pass.dispatchWorkgroups(Math.ceil(cols / 16), Math.ceil(rows / 16));
            pass.end();
            encoder.copyBufferToBuffer(out, 0, readback, 0, cols * rows * bytesPerPixel);
            device.queue.submit([encoder.finish()]);
            return readback;
          });
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
  async renderView(doc: PhotoProject, view: View, options: { refine?: boolean; quick?: boolean } = {}): Promise<{ texture: GPUTexture; plan: RenderPlan; refined: boolean }> {
    await this.compositor.ready;
    const { device } = this;
    const plan = await this.settledPlan(doc);
    const width = Math.max(1, Math.round(view.width));
    const height = Math.max(1, Math.round(view.height));
    const at = { ...view, width, height };
    // Quick: the view's own level, as the screen's first response (a thumbnail needs no full-resolution work).
    if (!options.quick) await this.glows.ensure(plan);
    await this.ensurePatterns(plan);
    const target = compositeTexture(device, width, height, plan.format, "view");
    const refine = !options.quick && (options.refine ?? needsRefinement(plan, view.zoom));
    if (refine && view.zoom < 1) {
      await this.refine(plan, at, target);
      return { texture: target, plan, refined: true };
    }
    const work: WorkPair = { a: compositeTexture(device, width, height, plan.format, "view a"), b: compositeTexture(device, width, height, plan.format, "view b") };
    await this.whenResident(plan, at, () => {
      const encoder = device.createCommandEncoder({ label: "view" });
      const composite = this.compositor.evaluate(encoder, plan, at, "final", this.planSources, work);
      encoder.copyTextureToTexture({ texture: composite }, { texture: target }, [width, height]);
      device.queue.submit([encoder.finish()]);
    });
    await device.queue.onSubmittedWorkDone();
    work.a.destroy();
    work.b.destroy();
    return { texture: target, plan, refined: false };
  }

  /**
   * The document as a picture `width` wide (Home's cover, the assistant's view, thumbnails), over the checkerboard.
   * `quick`: evaluated at its own level, never refined and building no glow's cache (the Layers thumbnails, redrawn
   * while a slider is dragged): a preview, as the screen's first response is.
   */
  async picture(doc: PhotoProject, width: number, type: "image/jpeg" | "image/png" = "image/jpeg", options: { quick?: boolean } = {}): Promise<Blob> {
    const zoom = Math.min(1, width / doc.canvas.width);
    const w = Math.max(1, Math.round(doc.canvas.width * zoom));
    const h = Math.max(1, Math.round(doc.canvas.height * zoom));
    const { texture } = await this.renderView(doc, { zoom, x: 0, y: 0, width: w, height: h }, { quick: options.quick });
    return this.encodePicture(texture, w, h, type, doc.output.highlights);
  }

  /**
   * A layer's mask as a picture `width` wide (its Layers thumbnail): black where it hides, white where it reveals,
   * in its own pixels. Null while it isn't on the GPU.
   */
  async maskPicture(layerId: string, width: number): Promise<Blob | null> {
    await this.compositor.ready;
    const mask = this.surfaceOf(layerId, "mask");
    if (!mask) return null;
    await mask.ensureResident();
    const size = mask.size;
    const transform = { x: size.width / 2, y: size.height / 2, scaleX: 1, scaleY: 1, rotation: 0 };
    const matrix = layerMatrix(transform, size);
    // The mask drawn as light over black (it holds its value in every channel): its grey.
    const plan: RenderPlan = {
      canvas: size,
      compositing: "linear",
      background: [0, 0, 0, 1],
      nodes: [{ kind: "pixel", layerId, surface: mask.shown, transform, size, matrix, opacity: 1, mask: null, blend: null, style: null, filters: [], contentKey: "mask", commutesFrom: 0, commutes: true, key: "mask", crop: null }],
      baseKey: "mask",
      prefixKeys: ["mask"],
      key: "mask",
      commutes: true,
      commutesFrom: 0,
      format: "rgba16float",
      skipped: [],
    };
    const zoom = Math.min(1, width / size.width);
    const w = Math.max(1, Math.round(size.width * zoom));
    const h = Math.max(1, Math.round(size.height * zoom));
    const { device } = this;
    const work: WorkPair = { a: compositeTexture(device, w, h, "rgba16float", "mask a"), b: compositeTexture(device, w, h, "rgba16float", "mask b") };
    const target = compositeTexture(device, w, h, "rgba16float", "mask picture");
    const encoder = device.createCommandEncoder({ label: "mask picture" });
    const sources: PlanSources = { draw: () => ({ source: mask, matrix, transform, opacity: 1, mask: null }), mask: () => null };
    const composite = this.compositor.evaluate(encoder, plan, { zoom, x: 0, y: 0, width: w, height: h }, "final", sources, work);
    encoder.copyTextureToTexture({ texture: composite }, { texture: target }, [w, h]);
    device.queue.submit([encoder.finish()]);
    await device.queue.onSubmittedWorkDone();
    work.a.destroy();
    work.b.destroy();
    return this.encodePicture(target, w, h, "image/png");
  }

  /**
   * A style on a rounded square (the Styles panel's swatch, New Style's preview): the real compositor's picture of
   * it, `size` pixels square, the photo's patterns available to it. Waits for patterns it reads to load.
   */
  async stylePicture(style: LayerStyle, blending: Pick<PhotoLayer, "blend" | "fill" | "blending">, patterns: PhotoPattern[], size = 64): Promise<Blob | null> {
    await this.compositor.ready;
    const shape = await this.swatchShape();
    if (!shape) return null;
    // Its tiles back in the atlas if the photo's drawing has since evicted them.
    await shape.ensureResident();
    for (let i = 0; i < 300 && !shape.settled; i++) await new Promise((r) => setTimeout(r, 10));
    const side = shape.size.width;
    const layer: PhotoLayer = { id: "swatch", kind: "pixel", name: "swatch", visible: true, opacity: 1, surface: shape.shown, size: shape.size, transform: { x: side / 2 + side * 0.25, y: side / 2 + side * 0.25, scaleX: 1, scaleY: 1, rotation: 0 }, ...blending, style };
    const doc: PhotoProject = { version: PHOTO_VERSION, name: "swatch", canvas: { width: side * 1.5, height: side * 1.5, background: "#ffffff" }, compositing: "photoshop", output: { highlights: "film" }, patterns, layers: [layer] };
    const plan = compileRender(doc, new Map());
    const node = plan.nodes[0];
    if (!node || !isDrawNode(node)) return null;
    // Its patterns in first.
    await this.ensurePatterns(plan);
    const zoom = size / doc.canvas.width;
    const w = size;
    const h = size;
    const { device } = this;
    const work: WorkPair = { a: compositeTexture(device, w, h, plan.format, "swatch a"), b: compositeTexture(device, w, h, plan.format, "swatch b") };
    const target = compositeTexture(device, w, h, plan.format, "swatch");
    const encoder = device.createCommandEncoder({ label: "style picture" });
    const sources: PlanSources = { draw: () => ({ source: shape, matrix: node.matrix, transform: node.transform, opacity: node.opacity, mask: null }), mask: () => null, pattern: (ref) => this.patternOf(ref), revision: () => "swatch" };
    const composite = this.compositor.evaluate(encoder, plan, { zoom, x: 0, y: 0, width: w, height: h }, "final", sources, work);
    encoder.copyTextureToTexture({ texture: composite }, { texture: target }, [w, h]);
    device.queue.submit([encoder.finish()]);
    await device.queue.onSubmittedWorkDone();
    work.a.destroy();
    work.b.destroy();
    return this.encodePicture(target, w, h, "image/png", "film");
  }

  private swatch: Promise<SurfaceImage | null> | null = null;

  /** The swatch's rounded square (a surface of this photo's, made once). */
  private swatchShape(): Promise<SurfaceImage | null> {
    this.swatch ??= (async () => {
      const uploads = this.uploads;
      if (!uploads) return null;
      const side = 40;
      const pixels = new Float32Array(side * side * 4);
      const fill = srgbToLinear(0.72);
      for (let y = 0; y < side; y++)
        for (let x = 0; x < side; x++) {
          // A rounded square: coverage of the corner circles, a pixel's width of edge.
          const dx = Math.max(0, Math.abs(x + 0.5 - side / 2) - (side / 2 - 8));
          const dy = Math.max(0, Math.abs(y + 0.5 - side / 2) - (side / 2 - 8));
          const a = Math.min(1, Math.max(0, 8 - Math.hypot(dx, dy) + 0.5));
          pixels.set([fill * a, fill * a, fill * a, a], (y * side + x) * 4);
        }
      const id = await surfaceFromPixels(uploads, side, side, pixels);
      const ctx = await this.contextFor(8);
      const image = new SurfaceImage(ctx, { width: side, height: side }, "pixels", uploads);
      await image.show(id);
      // (Showing starts fetching its tiles: wait until they're in.)
      for (let i = 0; i < 300 && !image.settled; i++) await new Promise((r) => setTimeout(r, 10));
      return image;
    })().catch(() => null);
    return this.swatch;
  }

  /** A composite through the output transform into an image file (it destroys the texture). */
  private async encodePicture(texture: GPUTexture, w: number, h: number, type: "image/jpeg" | "image/png", highlights: Highlights = "clip"): Promise<Blob> {
    const pixels = await this.quantize(texture, w, h, { under: "checker", dither: true, highlights });
    const canvas = new OffscreenCanvas(w, h);
    canvas.getContext("2d")!.putImageData(new ImageData(pixels, w, h), 0, 0);
    return await canvas.convertToBlob({ type, quality: 0.85 });
  }

  /**
   * The photo's pixels for the selection tools (docs/photo/selections.md): as it shows, or layer `layerId` alone (its
   * pixels and filters, at full opacity, without its style or blending), at `scale`, as 8-bit sRGB with straight
   * alpha through the output transform. Rendered in blocks the GPU holds.
   */
  async samplePixels(doc: PhotoProject, scale: number, layerId: string | null = null): Promise<PixelSample> {
    await this.compositor.ready;
    let source = doc;
    const layer = layerId ? doc.layers.find((l) => l.id === layerId) : undefined;
    if (layer) {
      const plain = { ...layer, opacity: 1, visible: true };
      delete plain.blend;
      delete plain.fill;
      delete plain.blending;
      delete plain.style;
      source = { ...doc, canvas: { ...doc.canvas, background: null }, layers: [plain] };
    }
    const { width, height } = sampleSize(doc.canvas, scale);
    const data = new Uint8ClampedArray(width * height * 4);
    const block = 2048;
    for (let by = 0; by < height; by += block) {
      for (let bx = 0; bx < width; bx += block) {
        const w = Math.min(block, width - bx);
        const h = Math.min(block, height - by);
        const { texture } = await this.renderView(source, { zoom: scale, x: bx / scale, y: by / scale, width: w, height: h });
        const pixels = await this.quantize(texture, w, h, { under: "none", dither: false, highlights: doc.output.highlights });
        for (let row = 0; row < h; row++) data.set(pixels.subarray(row * w * 4, (row + 1) * w * 4), ((by + row) * width + bx) * 4);
      }
    }
    return { width, height, data, scale };
  }

  /**
   * What `doc` shows over `view` (document pixels from its x, y at its zoom: a refined reduction below 1) as 8-bit
   * sRGB with straight alpha through the output transform, undithered: what Content-Aware Fill's model reads.
   */
  async sampleView(doc: PhotoProject, view: View): Promise<PixelSample> {
    const { texture } = await this.renderView(doc, view, { refine: view.zoom < 1 });
    const width = Math.max(1, Math.round(view.width));
    const height = Math.max(1, Math.round(view.height));
    const data = await this.quantize(texture, width, height, { under: "none", dither: false, highlights: doc.output.highlights });
    return { width, height, data, scale: view.zoom };
  }

  /** A composite through the output transform into 8-bit RGBA (it destroys the texture). */
  private async quantize(texture: GPUTexture, w: number, h: number, o: { under: "none" | "checker"; dither: boolean; highlights: Highlights }): Promise<Uint8ClampedArray<ArrayBuffer>> {
    const { device } = this;
    const out = device.createBuffer({ size: w * h * 4, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC });
    const params = device.createBuffer({ size: 48, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    const readback = device.createBuffer({ size: w * h * 4, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
    try {
      const p = new ArrayBuffer(48);
      new Uint32Array(p, 0, 4).set([0, 0, w, h]);
      new Float32Array(p, 16, 1)[0] = o.dither ? DITHER_8BIT : 0;
      new Uint32Array(p, 20, 1)[0] = o.under === "checker" ? 2 : 0;
      new Float32Array(p, 24, 1)[0] = 8;
      new Uint32Array(p, 28, 1)[0] = o.highlights === "film" ? 1 : 0;
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
      return pixels;
    } finally {
      texture.destroy();
      out.destroy();
      params.destroy();
      readback.destroy();
    }
  }

  /**
   * Exports the document at its canvas size: PNG keeps transparency (8 or 16 bits), JPEG goes over the background
   * (or white). The server encodes it into `destination` (the save dialog's), or keeps it to download. `signal`
   * cancels it between bands (an `AbortError`): the server lets go of what it was sent, and nothing is written.
   * Once every band is sent (progress 1) the helper encodes, which can't be cancelled.
   */
  async export(
    projectId: string,
    doc: PhotoProject,
    request: { name: string; format: "png" | "jpeg"; bits?: 8 | 16; quality?: number; destination?: string | null; origin?: { x: number; y: number } },
    onProgress?: (fraction: number) => void,
    signal?: AbortSignal,
  ) {
    signal?.throwIfAborted();
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
      await this.renderBands(doc, { bits, under: request.format === "jpeg" ? "matte" : "none", matte: matteOf(doc), origin: request.origin }, async (from, rows, width) => {
        signal?.throwIfAborted();
        await photoApi.exportRows(id, from, rows);
        onProgress?.((from + rows.length / (width * (bits === 16 ? 8 : 4))) / doc.canvas.height);
      });
      signal?.throwIfAborted();
      return { id, ...(await photoApi.finishExport(id)) };
    } catch (error) {
      void photoApi.cancelExport(id).catch(() => {});
      throw error;
    }
  }

  // --- painting ---

  /** Where a layer's surface is: its pixels → document pixels, and how many document pixels one covers. */
  private placeOf(layerId: string, part: SurfacePart): { matrix: Affine; scale: number } | null {
    const layer = this.doc?.layers.find((l) => l.id === layerId);
    if (!layer) return null;
    // An adjustment's, a generator's, a text's or a shape's pixels (its mask's) are the document's.
    if (!isPlaced(layer) || layer.kind === "text" || layer.kind === "shape") return { matrix: IDENTITY, scale: 1 };
    const surface = this.surfaceOf(layerId, part);
    const size = layer.kind === "pixel" ? layer.size : surface?.size;
    if (!size) return null;
    return { matrix: layerMatrix(layer.transform, size), scale: layerScale(layer.transform) };
  }

  /**
   * Starts a stroke on a layer's pixels or mask: `brush` in document pixels (its radius is scaled into the surface's
   * own), `colour` premultiplied linear light (a mask's: its value in every channel), limited by `selection`. False
   * when that surface isn't on the GPU yet.
   */
  beginStroke(layerId: string, part: SurfacePart, brush: BrushSettings, colour: readonly number[], selection: PhotoSelection | null, erase = false): boolean {
    this.cancelStroke();
    const surface = this.surfaceOf(layerId, part);
    const place = this.placeOf(layerId, part);
    if (!surface || !place) return false;
    surface.begin({ ...brush, radius: brush.radius / place.scale }, colour, { matrix: place.matrix }, selection, erase);
    this.stroke = { key: `${layerId}:${part}`, surface, toSurface: invert(place.matrix), scale: place.scale };
    return true;
  }

  /**
   * Starts a stroke painted a whole tile at a time on a layer's pixels or mask (the Gradient tool's Classic mode),
   * limited by `selection`: `paintTiles` paints it (again as it changes), `endStroke` and `cancelStroke` end it as
   * any stroke. False when that surface isn't on the GPU yet.
   */
  beginTiles(layerId: string, part: SurfacePart, selection: PhotoSelection | null): boolean {
    this.cancelStroke();
    const surface = this.surfaceOf(layerId, part);
    const place = this.placeOf(layerId, part);
    if (!surface || !place) return false;
    surface.beginTiles({ matrix: place.matrix }, selection);
    this.stroke = { key: `${layerId}:${part}`, surface, toSurface: invert(place.matrix), scale: place.scale };
    return true;
  }

  /** Paints the stroke `beginTiles` began with `run`'s pass (`SurfaceImage.paintTiles`). */
  paintTiles(run: Parameters<SurfaceImage["paintTiles"]>[0]) {
    this.stroke?.surface.paintTiles(run);
  }

  /** Paints the stroke through these pointer samples (document pixels). */
  strokeTo(points: readonly { x: number; y: number }[]) {
    const s = this.stroke;
    if (!s) return;
    s.surface.add(points.map((p) => apply(s.toSurface, p.x, p.y)));
  }

  get stroking() {
    return this.stroke !== null;
  }

  /** Drops the stroke in progress: nothing changes. */
  cancelStroke() {
    const s = this.stroke;
    this.stroke = null;
    s?.surface.cancel();
  }

  /** Ends the stroke: resolves with the surface it made (the caller commits it), or null when nothing was painted. */
  async endStroke(): Promise<{ id: SurfaceId; tiles: number; readbackMs: number; hashMs: number } | null> {
    const s = this.stroke;
    this.stroke = null;
    if (!s) return null;
    const result = await s.surface.end();
    const entry = this.surfaces.get(s.key);
    // The document will name it next: it shows already.
    if (result && entry) entry.wanted = result.id;
    return result;
  }

  /**
   * Fills what `selection` covers of a layer's pixels or mask with `colour` (premultiplied; transparent clears), as
   * a new surface the caller commits. Null when that surface isn't on the GPU, or the selection misses it.
   */
  async fillSelection(layerId: string, part: SurfacePart, colour: readonly number[], selection: PhotoSelection): Promise<SurfaceId | null> {
    this.cancelStroke();
    const surface = this.surfaceOf(layerId, part);
    const place = this.placeOf(layerId, part);
    if (!surface || !place) return null;
    const entry = this.surfaces.get(`${layerId}:${part}`);
    const id = await surface.fillSelection(colour, selection, { matrix: place.matrix });
    if (id && entry) entry.wanted = id;
    return id;
  }

  /**
   * Starts a stroke that reads the pixels it changes (Dodge, Burn, Sponge, the Background Eraser: `brush-effects.ts`)
   * on a layer's pixels or mask, as `beginStroke` does: `brush` in document pixels. False when that surface isn't on
   * the GPU yet. Toning's samples go through `strokeTo`; the Background Eraser works on `strokeTarget`.
   */
  beginEffectStroke(layerId: string, part: SurfacePart, brush: BrushSettings, effect: BrushEffect, selection: PhotoSelection | null): boolean {
    this.cancelStroke();
    const surface = this.shownSurface(layerId, part);
    const place = this.placeOf(layerId, part);
    if (!surface || !place) return false;
    surface.beginEffect({ ...brush, radius: brush.radius / place.scale }, effect, { matrix: place.matrix }, selection);
    this.stroke = { key: `${layerId}:${part}`, surface, toSurface: invert(place.matrix), scale: place.scale };
    return true;
  }

  /**
   * A layer's surface only once it shows what the document says (a layer converted to pixels a moment ago is still
   * fetching them): a stroke that reads its pixels must start from them, never from an empty surface.
   */
  private shownSurface(layerId: string, part: SurfacePart): SurfaceImage | null {
    const s = this.surfaces.get(`${layerId}:${part}`);
    return s?.image && s.failed === null && s.image.shown === s.wanted ? s.image : null;
  }

  /** Dabs at these points (document pixels) whatever the spacing: Airbrush's, where the pointer rests. */
  strokeDab(points: readonly { x: number; y: number }[]) {
    const s = this.stroke;
    if (s) s.surface.dabAt(points.map((p) => apply(s.toSurface, p.x, p.y)));
  }

  /** The stroke in progress: its surface, and document pixels → its pixels and their scale. */
  get strokeTarget(): { readonly surface: SurfaceImage; readonly toSurface: Affine; readonly scale: number } | null {
    return this.stroke;
  }

  /**
   * Applies `effect` to what `selection` covers of a layer's pixels or mask (all of it: null) at once, as a new
   * surface the caller commits (the assistant's toning and colour removal; `accumulate` writes the Background
   * Eraser's from the pixels). Null when nothing there changes; undefined while that surface isn't on the GPU (or doesn't
   * show what the document says yet).
   */
  async applyEffect(
    layerId: string,
    part: SurfacePart,
    effect: BrushEffect,
    selection: PhotoSelection | null,
    accumulate?: (surface: SurfaceImage, toSurface: Affine, tiles: { tx: number; ty: number }[]) => Promise<void>,
  ): Promise<SurfaceId | null | undefined> {
    this.cancelStroke();
    const surface = this.shownSurface(layerId, part);
    const place = this.placeOf(layerId, part);
    if (!surface || !place) return undefined;
    const entry = this.surfaces.get(`${layerId}:${part}`);
    const toSurface = invert(place.matrix);
    const id = await surface.effectFill(effect, selection, { matrix: place.matrix }, accumulate && ((tiles) => accumulate(surface, toSurface, tiles)));
    if (id && entry) entry.wanted = id;
    return id;
  }

  /** The size and place of a layer's mask, as the document has it now. */
  private maskShape(doc: PhotoProject, layerId: string): { size: { width: number; height: number }; matrix: Affine; bits: 8 | 16 } | null {
    const layer = doc.layers.find((l) => l.id === layerId);
    if (!layer) return null;
    if (!isPlaced(layer) || layer.kind === "text" || layer.kind === "shape") return { size: doc.canvas, matrix: IDENTITY, bits: 8 };
    if (layer.kind === "pixel") return { size: layer.size, matrix: layerMatrix(layer.transform, layer.size), bits: 8 };
    const asset = this.assets.get(layer.mediaId);
    if (!asset?.width || !asset.height) return null;
    const size = { width: asset.width, height: asset.height };
    return { size, matrix: layerMatrix(layer.transform, size), bits: asset.image?.bits === 16 ? 16 : 8 };
  }

  /**
   * A mask for layer `layerId` from a selection (Photoshop's Add Layer Mask › Reveal Selection): the selection's
   * coverage of each of the layer's pixels, as a new surface (uploaded as a stroke is). Resolves with its id.
   */
  async maskFromSelection(doc: PhotoProject, layerId: string, selection: PhotoSelection): Promise<SurfaceId> {
    const { surface, id } = await this.selectionMask(doc, layerId, selection);
    surface.destroy();
    return id;
  }

  /** A mask for a layer from a selection, on the GPU (the caller destroys it), and its id. */
  private async selectionMask(doc: PhotoProject, layerId: string, selection: PhotoSelection): Promise<{ surface: SurfaceImage; id: SurfaceId }> {
    const shape = this.maskShape(doc, layerId);
    if (!shape || !this.uploads) throw new Error("That layer has no pixels on the GPU to make a mask for.");
    const ctx = await this.contextFor(shape.bits);
    const surface = new SurfaceImage(ctx, shape.size, "mask", this.uploads);
    try {
      return { surface, id: await surface.fillFromSelection(selection, { matrix: shape.matrix }) };
    } catch (error) {
      surface.destroy();
      throw error;
    }
  }

  /**
   * A layer as pixels (Photoshop's Rasterize: an image's transform, filters and mask baked in; a generator's content
   * over the canvas): rendered alone at 100% over the box around it (grown by its filters' reach), into tiles of a
   * new pixel surface (uploaded as a stroke is). Resolves with the surface (null:
   * nothing showed) and the pixel layer's size and place.
   */
  async rasterize(
    doc: PhotoProject,
    layerId: string,
    options: { selection?: PhotoSelection | null } = {},
  ): Promise<{ surface: SurfaceId | null; size: { width: number; height: number }; transform: LayerTransform }> {
    await this.compositor.ready;
    let layer = doc.layers.find((l) => l.id === layerId);
    // A copy is what the selection covers of the layer's own pixels (not through the mask the layer has): each
    // tile rendered plain, then multiplied by the selection's coverage of its document pixels. No mask surface is
    // made for it, so nothing of it can be evicted while the tiles render.
    if (layer && options.selection) {
      layer = { ...layer };
      delete layer.mask;
    }
    return this.rasterizeLayer(doc, layer, options.selection ?? null);
  }

  private async rasterizeLayer(
    doc: PhotoProject,
    layer: PhotoProject["layers"][number] | undefined,
    selection: PhotoSelection | null,
  ): Promise<{ surface: SurfaceId | null; size: { width: number; height: number }; transform: LayerTransform }> {
    const layerId = layer?.id ?? "";
    if (!layer || layer.kind === "adjustment" || !this.uploads) throw new Error("Only an image, pixel or generator layer can be made pixels.");
    // A generator's content is everywhere: what the canvas shows of it. Filters reach past a layer's box.
    const shape = layer.kind === "generator" ? doc.canvas : layer.kind === "pixel" || layer.kind === "text" || layer.kind === "shape" ? layer.size : this.maskShape(doc, layerId)?.size;
    if (!shape) throw new Error("That image isn't loaded yet.");
    const matrix = layer.kind === "generator" ? IDENTITY : layerMatrix(layer.transform, shape);
    // A text's glyphs may reach a little past its frame.
    const reach = layer.kind === "generator" ? 0 : filtersReach(layer) + (layer.kind === "text" ? Math.ceil(0.25 * layer.font.size * layerScale(layer.transform)) + 2 : 0);
    let corners = [apply(matrix, 0, 0), apply(matrix, shape.width, 0), apply(matrix, 0, shape.height), apply(matrix, shape.width, shape.height)];
    // A shape's pixels are what it draws: its stroke and heads reach past its box.
    if (layer.kind === "shape") {
      const drawn = shapeBounds(layer);
      if (!drawn) throw new Error("That shape draws nothing (no stroke, no fill): there are no pixels to make.");
      corners = [{ x: drawn.x0, y: drawn.y0 }, { x: drawn.x1, y: drawn.y1 }];
    }
    const s = selection;
    const x0 = Math.floor(Math.max(Math.min(...corners.map((p) => p.x)) - reach, s ? s.x : -Infinity) + 1e-6);
    const y0 = Math.floor(Math.max(Math.min(...corners.map((p) => p.y)) - reach, s ? s.y : -Infinity) + 1e-6);
    const width = Math.max(1, Math.min(30_000, Math.ceil(Math.min(Math.max(...corners.map((p) => p.x)) + reach, s ? s.x + s.width : Infinity) - 1e-6) - x0));
    const height = Math.max(1, Math.min(30_000, Math.ceil(Math.min(Math.max(...corners.map((p) => p.y)) + reach, s ? s.y + s.height : Infinity) - 1e-6) - y0));
    // The layer alone, opaque (its opacity stays the layer's), in an f16 composite: the surface's own format.
    // Plain and in linear light: its pixels as they are, whatever its blending (which stays the layer's).
    const plain = { ...layer, opacity: 1, visible: true };
    delete plain.blend;
    delete plain.fill;
    delete plain.blending;
    // A text or a shape is drawn only near its canvas: it's moved onto this one (its box's top-left at 0, 0), and so are the regions.
    const shift = plain.kind === "text" || plain.kind === "shape" ? { x: x0, y: y0 } : { x: 0, y: 0 };
    if (plain.kind === "text" || plain.kind === "shape") plain.transform = { ...plain.transform, x: plain.transform.x - x0, y: plain.transform.y - y0 };
    const alone: PhotoProject = { ...doc, compositing: "linear", canvas: { width, height, background: null }, layers: [plain] };
    const plan = await this.settledPlan(alone, false);
    await this.glows.ensure(plan);
    const { device } = this;
    const tile = TILE;
    const work: WorkPair = { a: compositeTexture(device, tile, tile, "rgba16float", "rasterize a"), b: compositeTexture(device, tile, tile, "rgba16float", "rasterize b") };
    const tilesX = Math.ceil(width / tile);
    const tilesY = Math.ceil(height / tile);
    const sources = this.planSources;
    const entries: [number, number, string][] = [];
    try {
      for (let ty = 0; ty < tilesY; ty++) {
        for (let tx = 0; tx < tilesX; tx++) {
          const region: View = { zoom: 1, x: x0 - shift.x + tx * tile, y: y0 - shift.y + ty * tile, width: tile, height: tile };
          // What the selection covers of this tile's document pixels: none, and the tile is left out.
          const cover = selection ? coverageIn(selection, { x: region.x + shift.x, y: region.y + shift.y, width: tile, height: tile }) : null;
          if (cover && !cover.some((v) => v > 0)) continue;
          const readback = await this.whenResident(plan, region, () => {
            const readback = device.createBuffer({ size: tile * tile * 8, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
            const encoder = device.createCommandEncoder({ label: "rasterize" });
            const composite = this.compositor.evaluate(encoder, plan, region, "final", sources, work);
            encoder.copyTextureToBuffer({ texture: composite }, { buffer: readback, bytesPerRow: tile * 8 }, [tile, tile]);
            device.queue.submit([encoder.finish()]);
            return readback;
          });
          await readback.mapAsync(GPUMapMode.READ);
          const bytes = readback.getMappedRange().slice(0);
          readback.unmap();
          readback.destroy();
          if (cover) {
            // Premultiplied: every channel scaled by the coverage.
            const halves = new Uint16Array(bytes);
            for (let i = 0; i < cover.length; i++) {
              if (cover[i] === 255) continue;
              const k = cover[i] / 255;
              for (let c = 0; c < 4; c++) halves[i * 4 + c] = k === 0 ? 0 : toHalf(fromHalf(halves[i * 4 + c]) * k);
            }
          }
          const { refs } = await this.uploads.hash([bytes], 4);
          entries.push([tx, ty, refs[0]]);
        }
      }
    } finally {
      work.a.destroy();
      work.b.destroy();
    }
    const manifest: SurfaceManifest = withTiles(emptySurface("rgba16f", tile, [0, 0, 0, 0]), entries);
    const surface = manifest.tiles.length ? await this.uploads.add(manifest, entries.map((e) => e[2])) : null;
    return { surface, size: { width, height }, transform: { x: x0 + width / 2, y: y0 + height / 2, scaleX: 1, scaleY: 1, rotation: 0 } };
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

  /**
   * A layer's surface's level-0 tile as the GPU holds it, as floats (its RGBA; a mask's value in every channel), or
   * null when it shows no slot there (its fill, or not resident): the checks compare strokes by it.
   */
  async readSurfaceTile(layerId: string, part: SurfacePart, tx: number, ty: number): Promise<{ shown: SurfaceId | null; data: Float32Array | null }> {
    const surface = this.surfaceOf(layerId, part);
    if (!surface) return { shown: null, data: null };
    await surface.ensureResident();
    const slot = surface.image.slotOf(0, tx, ty);
    if (slot === null) return { shown: surface.shown, data: null };
    const { ctx } = surface;
    const { texture, layer } = ctx.atlas.location(slot);
    const tile = ctx.tile;
    const buffer = this.device.createBuffer({ size: ctx.atlas.tileBytes, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
    const encoder = this.device.createCommandEncoder();
    encoder.copyTextureToBuffer({ texture, origin: [0, 0, layer] }, { buffer, bytesPerRow: ctx.rowBytes }, [tile, tile, 1]);
    this.device.queue.submit([encoder.finish()]);
    await buffer.mapAsync(GPUMapMode.READ);
    const mapped = buffer.getMappedRange();
    const data = ctx.format === "rgba16float" ? Float32Array.from(new Uint16Array(mapped), fromHalf) : new Float32Array(mapped.slice(0));
    buffer.unmap();
    buffer.destroy();
    return { shown: surface.shown, data };
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
      // A stroke in progress is lost with the device (its drafts were on it); committed ones are the Worker's and the server's.
      if (this.stroke) this.lostStrokes++;
      this.stroke = null;
      for (const s of this.surfaces.values()) s.image?.destroy();
      this.surfaces.clear();
      for (const s of this.sources.values()) s.image?.destroy();
      this.sources.clear();
      this.canvasImages.clear();
      this.dropScreen();
      this.compiled = null;
      this.glows.destroy();
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
    for (const s of this.surfaces.values()) s.image?.destroy();
    this.surfaces.clear();
    for (const s of this.sources.values()) s.image?.destroy();
    this.sources.clear();
    this.canvasImages.clear();
    this.dropScreen();
    this.glows.destroy();
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
