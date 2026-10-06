/**
 * The glows' caches (docs/photo/f4-light.md, "Evaluation"): for each glow a plan reads, its layer's contributions
 * over the layer's extent (clipped to the canvas grown by the glow's reach) from level `GLOW_CACHED_FROM` up,
 * made from level-0 renders region by region, so any view at or past that level reads the full-resolution result
 * and exports are cheap whatever the radius.
 *
 * Built in the background for the screen (once the plan has been still a moment, its images loaded), and awaited
 * by exports, refinements and pictures. A build stops between regions once nothing wants it. Rebuildable, so
 * they're the first to go: a byte budget, least recently used first, and all of them with the device.
 */
import { GLOW_CACHED_FROM, glowOctaves } from "@shared/photo/effects/glow.ts";
import type { View } from "@shared/photo/geometry.ts";
import { bounds } from "@shared/photo/layers.ts";
import { type ContentNode, type RenderPlan, hashKey, isContentNode, isDrawNode } from "@shared/photo/render-plan.ts";
import type { Compositor, PlanSources } from "./compositor.ts";
import { type GlowCache, glowCacheKey } from "./isolated.ts";

/** Level-0 regions a build renders at a time, in document pixels. */
const BUILD_REGION = 2048;
/** A cache's finest level is the first at or past `GLOW_CACHED_FROM` no wider or taller than this. */
const MAX_SIDE = 4096;
/** Bytes of caches kept. */
const BUDGET = 768 * 1024 ** 2;
/** How long the screen's plan stays still before its glows are built. */
const DELAY_MS = 150;

interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** A glow a plan reads: its node, which filter, what its cache covers (from which level) and is called. */
export interface PlannedGlow {
  node: ContentNode;
  index: number;
  extent: Box;
  from: number;
  key: string;
}

export interface GlowHost {
  compositor: () => Compositor;
  device: () => GPUDevice;
  sources: PlanSources;
  /** Fetches what a level-0 region of the plan needs. */
  ensureVisible: (plan: RenderPlan, view: View) => Promise<unknown>;
  /** Whether every image and surface the plan reads has loaded (only then is a cache final). */
  settled: (plan: RenderPlan) => boolean;
  /** A cache was built: the screen draws again. */
  built: () => void;
}

export class GlowCaches {
  private readonly caches = new Map<string, GlowCache>();
  /** Cache keys by `node key # filter index`, for the evaluator's lookups. */
  private readonly keys = new Map<string, string>();
  private readonly builds = new Map<string, { promise: Promise<GlowCache | null>; pins: number }>();
  /** What the screen wants built. */
  private wanted = new Set<string>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private generation = 0;

  constructor(private readonly host: GlowHost) {}

  /** The glows `plan` reads, each with its cache's key (indexed for `lookup`). */
  glowsOf(plan: RenderPlan): PlannedGlow[] {
    const out: PlannedGlow[] = [];
    for (const node of plan.nodes) {
      if (!isContentNode(node)) continue;
      let before = 0;
      node.filters.forEach((f, index) => {
        if (f.type === "glow") {
          const placed = extentOf(node, before, f.reach, f.params.radius as number, plan.canvas);
          if (placed) {
            const key = hashKey(`${glowCacheKey(node, index, placed.extent)}|${plan.format}`);
            this.keys.set(`${node.key}#${index}`, key);
            out.push({ node, index, ...placed, key });
          }
        }
        before += f.reach;
      });
    }
    if (this.keys.size > 512) this.keys.clear();
    return out;
  }

  /** A built cache for filter `index` of `node` (of a plan `glowsOf` has seen), or null. */
  lookup(node: ContentNode, index: number): GlowCache | null {
    const key = this.keys.get(`${node.key}#${index}`);
    const cache = key ? this.caches.get(key) : undefined;
    if (!cache) return null;
    this.caches.delete(cache.key);
    this.caches.set(cache.key, cache);
    return cache;
  }

  /** Whether every glow of the plan has its cache. */
  complete(plan: RenderPlan): boolean {
    return this.glowsOf(plan).every((g) => this.caches.has(g.key));
  }

  /** The screen's plan: its glows are built once it's been still a moment (the others stop being wanted). */
  want(plan: RenderPlan | null) {
    const glows = plan ? this.glowsOf(plan) : [];
    const missing = glows.filter((g) => !this.caches.has(g.key));
    const keys = new Set(missing.map((g) => g.key));
    const same = keys.size === this.wanted.size && [...keys].every((k) => this.wanted.has(k));
    if (same && (this.timer || keys.size === 0)) return;
    this.wanted = keys;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    if (!plan || keys.size === 0) return;
    const generation = ++this.generation;
    this.timer = setTimeout(() => {
      this.timer = null;
      if (generation !== this.generation || !this.host.settled(plan)) return;
      void this.ensure(plan, false).then((built) => {
        if (built) this.host.built();
      });
    }, DELAY_MS);
  }

  /**
   * Builds every glow of `plan` that isn't (in filter order: a later glow's content reads the earlier one's
   * cache). `pin`: wanted however the screen changes meanwhile (an export, a refinement). Resolves with whether
   * anything new was built.
   */
  async ensure(plan: RenderPlan, pin = true): Promise<boolean> {
    let any = false;
    for (const g of this.glowsOf(plan)) {
      if (this.caches.has(g.key)) continue;
      let build = this.builds.get(g.key);
      if (!build) {
        const entry = { promise: Promise.resolve<GlowCache | null>(null), pins: 0 };
        entry.promise = this.build(plan, g, () => entry.pins > 0 || this.wanted.has(g.key)).finally(() => this.builds.delete(g.key));
        this.builds.set(g.key, entry);
        build = entry;
      }
      if (pin) build.pins++;
      try {
        const cache = await build.promise;
        if (cache) any = true;
        else if (pin) return any;
      } finally {
        if (pin) build.pins--;
      }
    }
    return any;
  }

  private async build(plan: RenderPlan, g: PlannedGlow, wanted: () => boolean): Promise<GlowCache | null> {
    const compositor = this.host.compositor();
    const device = this.host.device();
    await compositor.ready;
    const isolation = compositor.isolation;
    const format = plan.format;
    const width = g.extent.x1 - g.extent.x0;
    const height = g.extent.y1 - g.extent.y0;
    const from = g.from;
    const s = 2 ** from;
    const levelTexture = device.createTexture({
      label: "glow cache",
      size: [Math.max(1, width / s), Math.max(1, height / s)],
      format,
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_SRC | GPUTextureUsage.COPY_DST,
    });
    const region = Math.max(BUILD_REGION, s);
    try {
      for (let y = g.extent.y0; y < g.extent.y1; y += region) {
        for (let x = g.extent.x0; x < g.extent.x1; x += region) {
          if (!wanted() || this.host.compositor() !== compositor) {
            levelTexture.destroy();
            return null;
          }
          const box = { x0: x, y0: y, x1: Math.min(x + region, g.extent.x1), y1: Math.min(y + region, g.extent.y1) };
          await this.host.ensureVisible(plan, { zoom: 1, x: box.x0, y: box.y0, width: box.x1 - box.x0, height: box.y1 - box.y0 });
          if (this.host.compositor() !== compositor) return null;
          const encoder = device.createCommandEncoder({ label: "glow cache" });
          let level = isolation.contribution(encoder, g.node, g.index, box, 0, "final", this.host.sources, format);
          if (!level) {
            levelTexture.destroy();
            return null;
          }
          let size = { width: box.x1 - box.x0, height: box.y1 - box.y0 };
          for (let k = 1; k <= from; k++) {
            const next = isolation.pool.take(Math.ceil(size.width / 2), Math.ceil(size.height / 2), format, "glow cache reduce");
            compositor.reduce(encoder, format, level, size, next);
            size = { width: Math.ceil(size.width / 2), height: Math.ceil(size.height / 2) };
            level = next;
          }
          encoder.copyTextureToTexture({ texture: level }, { texture: levelTexture, origin: [(x - g.extent.x0) / s, (y - g.extent.y0) / s] }, [size.width, size.height]);
          device.queue.submit([encoder.finish()]);
          // Let frames through between regions.
          await device.queue.onSubmittedWorkDone();
        }
      }
    } catch (error) {
      levelTexture.destroy();
      throw error;
    }
    const cache: GlowCache = {
      key: g.key,
      origin: { x: g.extent.x0, y: g.extent.y0 },
      from,
      levels: [levelTexture],
      blurred: new Map(),
      bytes: levelTexture.width * levelTexture.height * (format === "rgba16float" ? 8 : 16),
    };
    this.caches.set(g.key, cache);
    this.trim();
    return cache;
  }

  /** Least recently used first, past the budget. */
  private trim() {
    let total = [...this.caches.values()].reduce((sum, c) => sum + c.bytes, 0);
    for (const [key, cache] of this.caches) {
      if (total <= BUDGET || this.caches.size <= 1) break;
      this.caches.delete(key);
      total -= cache.bytes;
      dispose(this.host.device(), cache);
    }
  }

  destroy() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.wanted.clear();
    for (const cache of this.caches.values()) for (const t of [...cache.levels, ...cache.blurred.values()]) t.destroy();
    this.caches.clear();
    this.keys.clear();
  }
}

function dispose(device: GPUDevice, cache: GlowCache) {
  void device.queue.onSubmittedWorkDone().then(() => {
    for (const t of [...cache.levels, ...cache.blurred.values()]) t.destroy();
  });
}

/**
 * What a glow's cache covers: where its layer's content can be (its box grown by the filters before it; a
 * generator's is everywhere), within the canvas grown by the glow's reach, on its coarsest octave's grid (or its
 * finest kept level's, when that's coarser: a cache's levels are never wider or taller than `MAX_SIDE`).
 */
function extentOf(node: ContentNode, reachBefore: number, reach: number, radius: number, canvas: { width: number; height: number }): { extent: Box; from: number } | null {
  let box: Box = { x0: -reach, y0: -reach, x1: canvas.width + reach, y1: canvas.height + reach };
  if (isDrawNode(node)) {
    const b = bounds(node.transform, node.size);
    box = { x0: Math.max(box.x0, b.x0 - reachBefore), y0: Math.max(box.y0, b.y0 - reachBefore), x1: Math.min(box.x1, b.x1 + reachBefore), y1: Math.min(box.y1, b.y1 + reachBefore) };
  }
  if (box.x1 <= box.x0 || box.y1 <= box.y0) return null;
  let from = GLOW_CACHED_FROM;
  while (Math.max(box.x1 - box.x0, box.y1 - box.y0) / 2 ** from > MAX_SIDE) from++;
  const s = 2 ** Math.max(from, ...glowOctaves(radius).map((o) => o.level));
  return { extent: { x0: Math.floor(box.x0 / s) * s, y0: Math.floor(box.y0 / s) * s, x1: Math.ceil(box.x1 / s) * s, y1: Math.ceil(box.y1 / s) * s }, from };
}
