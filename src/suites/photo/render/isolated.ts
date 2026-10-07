/**
 * Layers evaluated alone before they join the stack (docs/photo/f4-light.md, "Evaluation"): a layer with filters,
 * and a generator. Its content (the layer drawn without its mask, or the generator's) is made on the target's grid,
 * its filters run on it in linear light, and the composite pass blends the result over what's below through the
 * layer's opacity and mask: by the GPU's own blending for Normal and light added in linear light (exact), otherwise
 * `prepare`d (through its mask, in the values it blends in) for the compositor's blend or style pass (Layer Style).
 *
 * The glow needs its layer's contributions around what's shown. Its fine octaves (levels below
 * `GLOW_CACHED_FROM`) are made here from a render of the content on a document-aligned grid a little larger than
 * the target; its coarse ones come from the glow's cache (`GlowCache`: the contributions of the layer's whole
 * extent, from level-0 renders, built by the renderer) or, until that's built, from renders at their own levels: a
 * preview. Any grid reads the octaves by their B-spline, so the screen, export regions and refinements agree.
 */
import { GLOW_CACHED_FROM, type GlowShape, glowParamsOf, glowShape } from "@shared/photo/effects/glow.ts";
import { type View, levelForScale } from "@shared/photo/geometry.ts";
import { invert, layerScale } from "@shared/photo/layers.ts";
import { type ContentNode, type FilterNode, type PlanFormat, addsLight } from "@shared/photo/render-plan.ts";
import type { Compositor, Drawable, LayerDraw, PlanSources, Quality } from "./compositor.ts";
import { FLARE_SHADER, packFlare } from "./flare.ts";
import { GRADIENT_FILL, gradientFillShape } from "@shared/photo/effects/gradient.ts";
import { GRADIENT_FILL_SHADER, packGradientFill } from "./gradient.ts";
import { APPLY, APPLY_OCTAVES, BLUR, CONTRIBUTION, type OctaveRead, type PlacedOctave, applyUniform, blurUniform, placeOctaves, placedReach } from "./glow.ts";
import { ROUND_FOR_STORE } from "./kernels.ts";
import { FILTER_KERNELS } from "./filters/index.ts";
import { type FilterKernel, kernelHeader, kernelShader } from "./kernel.ts";
import { applyToCode } from "@shared/photo/effects/kernel.ts";
import { type SceneMaps, packScene, sceneOf } from "@shared/photo/scene.ts";
import { ATLAS, IMAGE_STRUCTS, MASK_SAMPLE, MATHS, imageFunctions } from "./wgsl.ts";

const USAGE = GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_SRC | GPUTextureUsage.COPY_DST;

/** Bytes of free scratch textures a pool keeps for reuse; past it, the least recently freed go. */
const POOL_BUDGET = 256 * 1024 ** 2;

const bytesOf = (t: GPUTexture) => t.width * t.height * (t.format === "rgba32float" ? 16 : 8);

/**
 * Scratch textures by size and format, handed back to the pool once the GPU has done the work submitted after
 * they were taken (every evaluation is submitted in the task that made it, so a timeout's `onSubmittedWorkDone`
 * covers it). What's free is held to a byte budget: a radius dragged through many values asks for many sizes, and
 * keeping each would fill the GPU's memory.
 */
export class TexturePool {
  /** Free textures by size and format, least recently freed first (a Map keeps insertion order). */
  private readonly free = new Map<string, GPUTexture[]>();
  private freeBytes = 0;
  private pending: GPUTexture[] = [];
  private scheduled = false;
  private destroyed = false;

  constructor(private readonly device: GPUDevice) {}

  /** A texture for this evaluation only: it returns to the pool by itself. */
  take(width: number, height: number, format: PlanFormat, label: string): GPUTexture {
    const w = Math.max(1, Math.ceil(width));
    const h = Math.max(1, Math.ceil(height));
    const kept = this.free.get(`${w}x${h}|${format}`)?.pop();
    if (kept) this.freeBytes -= bytesOf(kept);
    const texture = kept ?? this.device.createTexture({ label, size: [w, h], format, usage: USAGE });
    this.pending.push(texture);
    if (!this.scheduled) {
      this.scheduled = true;
      setTimeout(() => {
        this.scheduled = false;
        const batch = this.pending;
        this.pending = [];
        void this.device.queue.onSubmittedWorkDone().then(() => batch.forEach((t) => this.put(t)));
      }, 0);
    }
    return texture;
  }

  private put(t: GPUTexture) {
    if (this.destroyed) return t.destroy();
    const key = `${t.width}x${t.height}|${t.format}`;
    const list = this.free.get(key) ?? [];
    if (list.length >= 3) return t.destroy();
    list.push(t);
    // Most recently freed last.
    this.free.delete(key);
    this.free.set(key, list);
    this.freeBytes += bytesOf(t);
    for (const [k, old] of this.free) {
      if (this.freeBytes <= POOL_BUDGET) break;
      for (const o of old) {
        this.freeBytes -= bytesOf(o);
        o.destroy();
      }
      this.free.delete(k);
    }
  }

  destroy() {
    this.destroyed = true;
    for (const list of this.free.values()) for (const t of list) t.destroy();
    this.free.clear();
    this.freeBytes = 0;
  }
}

/**
 * A glow's contributions over its layer's extent, from level-0 renders (exact), from level `from` up, with their
 * blurred octaves, kept by the renderer for as long as the glow and its layer stay as they are.
 */
/** Kernel tables kept on the GPU by their key. */
const KEPT_TABLES = 8;

export interface GlowCache {
  key: string;
  /** The document point at every level's texel (0, 0)'s top-left (aligned to the coarsest level's spacing). */
  origin: { x: number; y: number };
  /** The finest level kept. */
  from: number;
  /** The contributions at `from`, `from + 1`… (more are reduced as they're asked for). */
  levels: GPUTexture[];
  /** Blurred octaves, by level, σ and taps. */
  blurred: Map<string, GPUTexture>;
  bytes: number;
}

/** A rectangle of document pixels. */
interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

const snap = (b: Box, s: number): Box => ({ x0: Math.floor(b.x0 / s) * s, y0: Math.floor(b.y0 / s) * s, x1: Math.ceil(b.x1 / s) * s, y1: Math.ceil(b.y1 / s) * s });

/** The document pixels a view shows. */
export const viewBox = (view: View): Box => ({ x0: view.x, y0: view.y, x1: view.x + view.width / view.zoom, y1: view.y + view.height / view.zoom });

/** A view over a document box at level `level` (its corners on that level's grid). */
const levelView = (box: Box, level: number): View => {
  const s = 2 ** level;
  return { zoom: 1 / s, x: box.x0, y: box.y0, width: (box.x1 - box.x0) / s, height: (box.y1 - box.y0) / s };
};

/** What the glow's cache is keyed by: the content it reads (the layer, the filters before it), threshold, knee, extent. */
export const glowCacheKey = (node: ContentNode, index: number, extent: Box) => {
  const f = node.filters[index];
  return `${node.contentKey}|${node.filters
    .slice(0, index)
    .map((x) => x.key)
    .join(",")}|${f.params.threshold}|${f.params.knee}|${extent.x0},${extent.y0},${extent.x1},${extent.y1}`;
};

/**
 * The composite pass: an isolated layer's content over what's below, × opacity × its mask (layer or document pixels);
 * \`p0\` encodes the result (premultiplied, sRGB's curve extended past 1: blend.ts's premult_encode) for an encoded
 * composite's blend pass.
 */
const COMPOSITE = (format: PlanFormat) => /* wgsl */ `
${ROUND_FOR_STORE(format)}
${ATLAS}
${IMAGE_STRUCTS}
${MATHS}
${imageFunctions("mask", 1)}
${MASK_SAMPLE}
struct Params { inv0: vec4f, inv1: vec4f, origin: vec2f, zoom: f32, opacity: f32, level: u32, hasMask: u32, p0: u32, p1: u32 }
@group(2) @binding(0) var content: texture_2d<f32>;
@group(2) @binding(1) var<uniform> params: Params;

@vertex
fn vs(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f { return full_screen(i); }

@fragment
fn fs(@builtin(position) pos: vec4f) -> @location(0) vec4f {
  let c = textureLoad(content, vec2i(pos.xy), 0);
  let doc = params.origin + pos.xy / params.zoom;
  let u = vec2f(dot(params.inv0.xy, doc) + params.inv0.z, dot(params.inv1.xy, doc) + params.inv1.z);
  let m = mask_at(params.hasMask == 1u, params.level, u * exp2(-f32(params.level)));
  var out = c * (params.opacity * m);
  if (params.p0 == 1u && out.a > 0.0) {
    let s = out.rgb / out.a;
    out = vec4f(vec3f(enc(s.r), enc(s.g), enc(s.b)) * out.a, out.a);
  }
  return round_for_store(out);
}
fn enc(l: f32) -> f32 {
  let a = abs(l);
  var v = a * 12.92;
  if (a > 0.0031308049535603713) { v = 1.055 * pow(a, 1.0 / 2.4) - 0.055; }
  return select(v, -v, l < 0.0);
}
`;

type Blend = "normal" | "add";

interface Pipelines {
  composite: Map<string, GPURenderPipeline>;
  /** Kernel filters', by `type:format`. */
  kernels: Map<string, GPURenderPipeline>;
  flare: Map<PlanFormat, GPURenderPipeline>;
  /** The Gradient Fill's (the flare's layout: a uniform and a storage buffer). */
  gradient: Map<PlanFormat, GPURenderPipeline>;
  contribution: Map<PlanFormat, GPURenderPipeline>;
  blur: Map<PlanFormat, GPURenderPipeline>;
  apply: Map<PlanFormat, GPURenderPipeline>;
}

/** The glow's shape, cached by its filter node's key (a node's parameters never change under its key). */
const shapes = new Map<string, GlowShape>();
const shapeOf = (f: FilterNode) => {
  let s = shapes.get(f.key);
  if (!s) {
    s = glowShape(glowParamsOf(f.params));
    if (shapes.size > 64) shapes.clear();
    shapes.set(f.key, s);
  }
  return s;
};

export class Isolation {
  readonly pool: TexturePool;
  private readonly sampler: GPUSampler;
  private readonly dummy: GPUTexture;
  private readonly flares = new Map<string, { buffer: GPUBuffer; count: number }>();
  /** Gradient Fills' tables, by content key. */
  private readonly gradients = new Map<string, GPUBuffer>();
  private readonly layouts: { composite: GPUBindGroupLayout; flare: GPUBindGroupLayout; textureUniform: GPUBindGroupLayout; apply: GPUBindGroupLayout; kernel: GPUBindGroupLayout };
  /** A placeholder for kernels that read no table. */
  private readonly noTable: GPUBuffer;
  /** Tables kept by their key (Camera Raw's, with its analysis's grid), most recently used last. */
  private readonly tables = new Map<string, GPUBuffer>();
  /** Scene maps on the GPU by their id (`shared/photo/scene.ts`), most recently used last. */
  private readonly scenes = new Map<string, GPUBuffer>();

  private constructor(
    private readonly compositor: Compositor,
    readonly pipelines: Pipelines,
    layouts: Isolation["layouts"],
  ) {
    const { device } = compositor.ctx;
    this.pool = new TexturePool(device);
    this.sampler = device.createSampler();
    this.dummy = device.createTexture({ label: "no octave", size: [1, 1], format: "rgba16float", usage: GPUTextureUsage.TEXTURE_BINDING });
    // Zeros: as a table, nothing; as scene maps, a grid of no cells (they read 0).
    this.noTable = device.createBuffer({ label: "no table", size: 16, usage: GPUBufferUsage.STORAGE });
    this.layouts = layouts;
  }

  /** WGSL modules, for compilation checks. */
  static modules(formats: readonly PlanFormat[]): [string, string][] {
    return formats.flatMap((f): [string, string][] => [
      [`composite ${f}`, COMPOSITE(f)],
      [`flare ${f}`, FLARE_SHADER(f)],
      [`gradient fill ${f}`, GRADIENT_FILL_SHADER(f)],
      [`contribution ${f}`, CONTRIBUTION(f)],
      [`blur ${f}`, BLUR(f)],
      [`apply ${f}`, APPLY(f)],
      ...Object.entries(FILTER_KERNELS).map(([type, k]): [string, string] => [`${type} ${f}`, kernelShader(k, f)]),
    ]);
  }

  /** Its pipelines, compiled in the background (`ready` resolves when they have). */
  static create(compositor: Compositor, formats: readonly PlanFormat[], textureUniform: GPUBindGroupLayout): { isolation: Isolation; ready: Promise<void> } {
    const { device, kernels } = compositor.ctx;
    const FRAG = GPUShaderStage.FRAGMENT;
    const composite = device.createBindGroupLayout({
      label: "composite",
      entries: [
        { binding: 0, visibility: FRAG, texture: { sampleType: "unfilterable-float" } },
        { binding: 1, visibility: FRAG, buffer: { type: "uniform" } },
      ],
    });
    const flare = device.createBindGroupLayout({
      label: "flare",
      entries: [
        { binding: 0, visibility: FRAG, buffer: { type: "uniform" } },
        { binding: 1, visibility: FRAG, buffer: { type: "read-only-storage" } },
      ],
    });
    const apply = device.createBindGroupLayout({
      label: "glow apply",
      entries: [
        { binding: 0, visibility: FRAG, texture: { sampleType: "unfilterable-float" } },
        { binding: 1, visibility: FRAG, buffer: { type: "uniform" } },
        ...Array.from({ length: APPLY_OCTAVES }, (_, i): GPUBindGroupLayoutEntry => ({ binding: i + 2, visibility: FRAG, texture: { sampleType: "unfilterable-float" } })),
      ],
    });
    const kernel = device.createBindGroupLayout({
      label: "kernel filter",
      entries: [
        { binding: 0, visibility: FRAG, texture: { sampleType: "unfilterable-float" } },
        { binding: 1, visibility: FRAG, buffer: { type: "uniform" } },
        { binding: 2, visibility: FRAG, buffer: { type: "uniform" } },
        { binding: 3, visibility: FRAG, buffer: { type: "read-only-storage" } },
        { binding: 4, visibility: FRAG, buffer: { type: "read-only-storage" } },
      ],
    });
    const blendOf = (b: Blend): GPUBlendState => ({
      color: { srcFactor: "one", dstFactor: b === "add" ? "one" : "one-minus-src-alpha", operation: "add" },
      alpha: { srcFactor: "one", dstFactor: "one-minus-src-alpha", operation: "add" },
    });
    const render = (label: string, code: string, layouts: GPUBindGroupLayout[], format: GPUTextureFormat, blend?: GPUBlendState) => {
      const module = device.createShaderModule({ label, code });
      return device.createRenderPipelineAsync({
        label,
        layout: device.createPipelineLayout({ bindGroupLayouts: layouts }),
        vertex: { module, entryPoint: "vs" },
        fragment: { module, entryPoint: "fs", targets: [{ format, ...(blend ? { blend } : {}) }] },
        primitive: { topology: "triangle-list" },
      });
    };
    const pipelines: Pipelines = { composite: new Map(), kernels: new Map(), flare: new Map(), gradient: new Map(), contribution: new Map(), blur: new Map(), apply: new Map() };
    const work: Promise<unknown>[] = [];
    for (const f of formats) {
      for (const b of ["normal", "add"] as const) work.push(render(`composite ${b} ${f}`, COMPOSITE(f), [kernels.atlasLayout, kernels.imageLayout, composite], f, blendOf(b)).then((p) => pipelines.composite.set(`${b}:${f}`, p)));
      work.push(
        render(`flare ${f}`, FLARE_SHADER(f), [flare], f).then((p) => pipelines.flare.set(f, p)),
        render(`gradient fill ${f}`, GRADIENT_FILL_SHADER(f), [flare], f).then((p) => pipelines.gradient.set(f, p)),
        render(`contribution ${f}`, CONTRIBUTION(f), [textureUniform], f).then((p) => pipelines.contribution.set(f, p)),
        render(`blur ${f}`, BLUR(f), [textureUniform], f).then((p) => pipelines.blur.set(f, p)),
        render(`apply ${f}`, APPLY(f), [apply], f).then((p) => pipelines.apply.set(f, p)),
        // One filter that doesn't compile is left out (its layers aren't drawn), not the renderer.
        ...Object.entries(FILTER_KERNELS).map(([type, k]) =>
          render(`${type} ${f}`, kernelShader(k, f), [kernel], f).then(
            (p) => void pipelines.kernels.set(`${type}:${f}`, p),
            (error: unknown) => console.error(`[photo] the ${type} filter's shader doesn't compile`, error),
          ),
        ),
      );
    }
    const isolation = new Isolation(compositor, pipelines, { composite, flare, textureUniform, apply, kernel });
    return { isolation, ready: Promise.all(work).then(() => {}) };
  }

  /** Whether everything `node` needs, in `format`, has compiled. */
  canEvaluate(node: ContentNode, format: PlanFormat): boolean {
    const p = this.pipelines;
    if (!p.composite.has(`normal:${format}`) || !p.composite.has(`add:${format}`)) return false;
    if (node.kind === "generator" && !(node.type === GRADIENT_FILL ? p.gradient : p.flare).has(format)) return false;
    return node.filters.every((f) => (FILTER_KERNELS[f.type] ? p.kernels.has(`${f.type}:${format}`) : p.contribution.has(format) && p.blur.has(format) && p.apply.has(format)));
  }

  private uniform(data: ArrayBuffer | Float32Array, label: string): GPUBuffer {
    const { device } = this.compositor.ctx;
    const buffer = device.createBuffer({ label, size: Math.max(16, Math.ceil(data.byteLength / 16) * 16), usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    device.queue.writeBuffer(buffer, 0, data);
    void device.queue.onSubmittedWorkDone().then(() => setTimeout(() => buffer.destroy(), 0));
    return buffer;
  }

  private pass(encoder: GPUCommandEncoder, target: GPUTexture, pipeline: GPURenderPipeline, groups: GPUBindGroup[], size?: { width: number; height: number }) {
    const pass = encoder.beginRenderPass({ colorAttachments: [{ view: target.createView(), loadOp: "clear", storeOp: "store", clearValue: [0, 0, 0, 0] }] });
    pass.setPipeline(pipeline);
    groups.forEach((g, i) => pass.setBindGroup(i, g));
    if (size) pass.setViewport(0, 0, Math.max(1, size.width), Math.max(1, size.height), 0, 1);
    pass.draw(3);
    pass.end();
  }

  private textureGroup(texture: GPUTexture, uniform: GPUBuffer) {
    return this.compositor.ctx.device.createBindGroup({
      layout: this.layouts.textureUniform,
      entries: [
        { binding: 0, resource: texture.createView() },
        { binding: 1, resource: { buffer: uniform } },
      ],
    });
  }

  /**
   * `node`'s content on `view`'s grid with its first `upTo` filters run: a texture of the pool (transparent where
   * there's nothing), premultiplied linear light. Null while its pixels aren't on the GPU.
   */
  content(encoder: GPUCommandEncoder, node: ContentNode, view: View, quality: Quality, sources: PlanSources, format: PlanFormat, upTo = node.filters.length): GPUTexture | null {
    const width = Math.max(1, Math.round(view.width));
    const height = Math.max(1, Math.round(view.height));
    const at: View = { ...view, width, height };
    let current = this.pool.take(width, height, format, "isolated content");
    if (node.kind === "generator") this.generate(encoder, node, at, current, format);
    else {
      const draw = sources.draw(node);
      if (!draw) return null;
      this.compositor.drawLayerAlone(encoder, { ...draw, opacity: 1, mask: null }, at, quality, current, format);
    }
    for (let i = 0; i < upTo; i++) {
      const f = node.filters[i];
      const kernel = FILTER_KERNELS[f.type];
      const next = kernel ? this.kernel(encoder, node, i, kernel, current, at, quality, sources, format) : f.type === "glow" ? this.glow(encoder, node, i, current, at, quality, sources, format) : current;
      if (!next) return null;
      current = next;
    }
    return current;
  }

  /**
   * A kernel filter (filter `index` of `node`) on `input` (`view`'s grid): a new texture of the pool. One that reads
   * around a point gets its content again over the view grown by its reach (its earlier filters run on it), so
   * what it reads near the view's edges is there.
   */
  private kernel(encoder: GPUCommandEncoder, node: ContentNode, index: number, kernel: FilterKernel, input: GPUTexture, view: View, quality: Quality, sources: PlanSources, format: PlanFormat): GPUTexture | null {
    const f = node.filters[index];
    const grow = f.reach > 0 ? Math.ceil(f.reach * view.zoom) + 1 : 0;
    let source = input;
    if (grow > 0) {
      const grown: View = { zoom: view.zoom, x: view.x - grow / view.zoom, y: view.y - grow / view.zoom, width: view.width + 2 * grow, height: view.height + 2 * grow };
      const content = this.content(encoder, node, grown, quality, sources, format, index);
      if (!content) return null;
      source = content;
    }
    const { device } = this.compositor.ctx;
    const packed = kernel.pack(f.params, f.canvas);
    let table = this.noTable;
    const kept = packed.tableKey ? this.tables.get(packed.tableKey) : undefined;
    if (kept && packed.tableKey) {
      // Most recently used last.
      this.tables.delete(packed.tableKey);
      this.tables.set(packed.tableKey, kept);
      table = kept;
    } else if (packed.table) {
      table = device.createBuffer({ label: "kernel table", size: Math.max(16, packed.table.byteLength), usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
      device.queue.writeBuffer(table, 0, packed.table);
      const made = table;
      if (packed.tableKey) {
        this.tables.set(packed.tableKey, made);
        while (this.tables.size > KEPT_TABLES) {
          const [oldest, old] = this.tables.entries().next().value!;
          this.tables.delete(oldest);
          void device.queue.onSubmittedWorkDone().then(() => setTimeout(() => old.destroy(), 0));
        }
      } else void device.queue.onSubmittedWorkDone().then(() => setTimeout(() => made.destroy(), 0));
    }
    const group = device.createBindGroup({
      layout: this.layouts.kernel,
      entries: [
        { binding: 0, resource: source.createView() },
        { binding: 1, resource: { buffer: this.uniform(kernelHeader(view, grow, ((f.params.mix as number | undefined) ?? 100) / 100, f.canvas, applyToCode(f.params)), "kernel header") } },
        { binding: 2, resource: { buffer: this.uniform(packed.uniform, "kernel params") } },
        { binding: 3, resource: { buffer: table } },
        { binding: 4, resource: { buffer: this.sceneBuffer(sceneOf(f.params)) } },
      ],
    });
    const out = this.pool.take(view.width, view.height, format, f.type);
    this.pass(encoder, out, this.pipelines.kernels.get(`${f.type}:${format}`)!, [group]);
    return out;
  }

  /** A filter's scene maps on the GPU (kept by their id), or the placeholder when it reads none. */
  private sceneBuffer(maps: SceneMaps | null): GPUBuffer {
    if (!maps) return this.noTable;
    const kept = this.scenes.get(maps.id);
    if (kept) {
      // Most recently used last.
      this.scenes.delete(maps.id);
      this.scenes.set(maps.id, kept);
      return kept;
    }
    const { device } = this.compositor.ctx;
    const data = packScene(maps);
    const buffer = device.createBuffer({ label: "scene maps", size: data.byteLength, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
    device.queue.writeBuffer(buffer, 0, data);
    this.scenes.set(maps.id, buffer);
    while (this.scenes.size > KEPT_TABLES) {
      const [oldest, old] = this.scenes.entries().next().value!;
      this.scenes.delete(oldest);
      void device.queue.onSubmittedWorkDone().then(() => setTimeout(() => old.destroy(), 0));
    }
    return buffer;
  }

  /** A generator's content: a flare's elements at every target pixel. */
  private generate(encoder: GPUCommandEncoder, node: Extract<ContentNode, { kind: "generator" }>, view: View, target: GPUTexture, format: PlanFormat) {
    if (node.type === GRADIENT_FILL) return this.gradientFill(encoder, node, view, target, format);
    const { device } = this.compositor.ctx;
    let packed = this.flares.get(node.contentKey);
    if (!packed) {
      const { data, count } = packFlare(node.params, node.canvas);
      const buffer = device.createBuffer({ label: "flare elements", size: Math.max(64, data.byteLength), usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
      device.queue.writeBuffer(buffer, 0, data);
      packed = { buffer, count };
      this.flares.set(node.contentKey, packed);
      if (this.flares.size > 16) {
        const [oldest, old] = this.flares.entries().next().value!;
        this.flares.delete(oldest);
        void device.queue.onSubmittedWorkDone().then(() => setTimeout(() => old.buffer.destroy(), 0));
      }
    }
    const u = new ArrayBuffer(16);
    new Float32Array(u, 0, 3).set([view.x, view.y, view.zoom]);
    new Uint32Array(u, 12, 1)[0] = packed.count;
    const group = device.createBindGroup({
      layout: this.layouts.flare,
      entries: [
        { binding: 0, resource: { buffer: this.uniform(u, "flare params") } },
        { binding: 1, resource: { buffer: packed.buffer } },
      ],
    });
    this.pass(encoder, target, this.pipelines.flare.get(format)!, [group], { width: view.width, height: view.height });
  }

  /** A Gradient Fill's content: its gradient at every target pixel (render/gradient.ts). */
  private gradientFill(encoder: GPUCommandEncoder, node: Extract<ContentNode, { kind: "generator" }>, view: View, target: GPUTexture, format: PlanFormat) {
    const { device } = this.compositor.ctx;
    const { uniform, table } = packGradientFill(gradientFillShape(node.params), view);
    let buffer = this.gradients.get(node.contentKey);
    if (!buffer) {
      buffer = device.createBuffer({ label: "gradient table", size: table.byteLength, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
      device.queue.writeBuffer(buffer, 0, table);
      this.gradients.set(node.contentKey, buffer);
      if (this.gradients.size > 16) {
        const [oldest, old] = this.gradients.entries().next().value!;
        this.gradients.delete(oldest);
        void device.queue.onSubmittedWorkDone().then(() => setTimeout(() => old.destroy(), 0));
      }
    }
    const group = device.createBindGroup({
      layout: this.layouts.flare,
      entries: [
        { binding: 0, resource: { buffer: this.uniform(uniform, "gradient fill params") } },
        { binding: 1, resource: { buffer } },
      ],
    });
    this.pass(encoder, target, this.pipelines.gradient.get(format)!, [group], { width: view.width, height: view.height });
  }

  // --- the glow ---

  /** The glow (filter `index` of `node`) added to `input`, `view`'s grid: a new texture of the pool. */
  private glow(encoder: GPUCommandEncoder, node: ContentNode, index: number, input: GPUTexture, view: View, quality: Quality, sources: PlanSources, format: PlanFormat): GPUTexture | null {
    const shape = shapeOf(node.filters[index]);
    // The level the view reads layers at: there, a contribution is a preview unless it's level 0 (or the cache's).
    const base = view.zoom >= 1 ? 0 : levelForScale(view.zoom, 32);
    const placed = placeOctaves(shape, base);
    const cache = sources.glowCache?.(node, index) ?? null;
    const reads: OctaveRead[] = [];
    const cached = (o: PlacedOctave) => cache !== null && o.at >= cache.from;
    const fine = placed.filter((o) => o.at < GLOW_CACHED_FROM && !cached(o));
    if (fine.length) {
      const r = this.localShared(encoder, node, index, view, base, fine, quality, sources, format);
      if (!r) return null;
      reads.push(...r);
    }
    for (const o of placed) {
      if (fine.includes(o)) continue;
      const r = cached(o) ? this.fromCache(encoder, cache!, o, format) : this.localOwn(encoder, node, index, view, o, quality, sources, format);
      if (!r) return null;
      reads.push(r);
    }
    const out = this.pool.take(Math.round(view.width), Math.round(view.height), format, "glow");
    const { device } = this.compositor.ctx;
    const group = device.createBindGroup({
      layout: this.layouts.apply,
      entries: [
        { binding: 0, resource: input.createView() },
        { binding: 1, resource: { buffer: this.uniform(applyUniform(view, shape, reads), "glow apply") } },
        ...Array.from({ length: APPLY_OCTAVES }, (_, i): GPUBindGroupEntry => ({ binding: i + 2, resource: (reads[i]?.texture ?? this.dummyFor(format)).createView() })),
      ],
    });
    this.pass(encoder, out, this.pipelines.apply.get(format)!, [group]);
    return out;
  }

  private dummies = new Map<PlanFormat, GPUTexture>();
  private dummyFor(format: PlanFormat) {
    if (format === "rgba16float") return this.dummy;
    let t = this.dummies.get(format);
    if (!t) {
      t = this.compositor.ctx.device.createTexture({ label: "no octave", size: [1, 1], format, usage: GPUTextureUsage.TEXTURE_BINDING });
      this.dummies.set(format, t);
    }
    return t;
  }

  /** Contributions of `node` (its filters before `index`) at `level` over `box` (on that level's grid): a pool texture. */
  contribution(encoder: GPUCommandEncoder, node: ContentNode, index: number, box: Box, level: number, quality: Quality, sources: PlanSources, format: PlanFormat): GPUTexture | null {
    const v = levelView(box, level);
    const content = this.content(encoder, node, v, quality, sources, format, index);
    if (!content) return null;
    const f = node.filters[index];
    const shape = shapeOf(f);
    const out = this.pool.take(v.width, v.height, format, "glow contribution");
    const u = new Float32Array([shape.threshold, shape.knee, 0, 0]);
    this.pass(encoder, out, this.pipelines.contribution.get(format)!, [this.textureGroup(content, this.uniform(u, "contribution"))]);
    return out;
  }

  /** A Gaussian over a level's region of `width × height`: into `target` (or a pool texture). */
  blur(encoder: GPUCommandEncoder, src: GPUTexture, width: number, height: number, o: PlacedOctave, format: PlanFormat, target?: GPUTexture): GPUTexture {
    const across = this.pool.take(src.width, src.height, format, "glow blur");
    this.pass(encoder, across, this.pipelines.blur.get(format)!, [this.textureGroup(src, this.uniform(blurUniform(width, height, true, o), "blur"))], { width, height });
    const out = target ?? this.pool.take(src.width, src.height, format, "glow octave");
    this.pass(encoder, out, this.pipelines.blur.get(format)!, [this.textureGroup(across, this.uniform(blurUniform(width, height, false, o), "blur"))], { width, height });
    return out;
  }

  /**
   * Fine octaves from one render of the content at `base` over the view's box grown by their reach (on the grid of
   * the coarsest of them), reduced level by level: exact when `base` is 0.
   */
  private localShared(encoder: GPUCommandEncoder, node: ContentNode, index: number, view: View, base: number, octaves: PlacedOctave[], quality: Quality, sources: PlanSources, format: PlanFormat): OctaveRead[] | null {
    const top = Math.max(...octaves.map((o) => o.at));
    const halo = Math.max(...octaves.map(placedReach));
    const vb = viewBox(view);
    const box = snap({ x0: vb.x0 - halo, y0: vb.y0 - halo, x1: vb.x1 + halo, y1: vb.y1 + halo }, 2 ** top);
    let level = this.contribution(encoder, node, index, box, base, quality, sources, format);
    if (!level) return null;
    const sizeAt = (k: number) => ({ width: (box.x1 - box.x0) / 2 ** k, height: (box.y1 - box.y0) / 2 ** k });
    const levels = new Map<number, GPUTexture>([[base, level]]);
    for (let k = base + 1; k <= top; k++) {
      const next = this.pool.take(sizeAt(k).width, sizeAt(k).height, format, "glow level");
      this.compositor.reduce(encoder, format, level, sizeAt(k - 1), next);
      levels.set(k, next);
      level = next;
    }
    return octaves.map((o) => {
      const { width, height } = sizeAt(o.at);
      return { texture: this.blur(encoder, levels.get(o.at)!, width, height, o, format), origin: { x: box.x0, y: box.y0 }, spacing: 2 ** o.at, width, height, weight: o.weight, mitchell: o.at > o.level };
    });
  }

  /** A coarse octave before its cache is built: its contributions rendered at its own level (a preview). */
  private localOwn(encoder: GPUCommandEncoder, node: ContentNode, index: number, view: View, o: PlacedOctave, quality: Quality, sources: PlanSources, format: PlanFormat): OctaveRead | null {
    const vb = viewBox(view);
    const halo = placedReach(o);
    const s = 2 ** o.at;
    const box = snap({ x0: vb.x0 - halo, y0: vb.y0 - halo, x1: vb.x1 + halo, y1: vb.y1 + halo }, s);
    const c = this.contribution(encoder, node, index, box, o.at, quality, sources, format);
    if (!c) return null;
    const width = (box.x1 - box.x0) / s;
    const height = (box.y1 - box.y0) / s;
    return { texture: this.blur(encoder, c, width, height, o, format), origin: { x: box.x0, y: box.y0 }, spacing: s, width, height, weight: o.weight, mitchell: o.at > o.level };
  }

  /** A coarse octave from its glow's cache: its level reduced and blurred once, then kept. */
  private fromCache(encoder: GPUCommandEncoder, cache: GlowCache, o: PlacedOctave, format: PlanFormat): OctaveRead {
    const { device } = this.compositor.ctx;
    while (cache.from + cache.levels.length <= o.at) {
      const prev = cache.levels[cache.levels.length - 1];
      const next = device.createTexture({ label: "glow cache level", size: [Math.ceil(prev.width / 2), Math.ceil(prev.height / 2)], format, usage: USAGE });
      this.compositor.reduce(encoder, format, prev, { width: prev.width, height: prev.height }, next);
      cache.levels.push(next);
      cache.bytes += next.width * next.height * (format === "rgba16float" ? 8 : 16);
    }
    const level = cache.levels[o.at - cache.from];
    const key = `${o.at}|${o.atTexels}|${o.atTaps}`;
    let blurred = cache.blurred.get(key);
    if (!blurred) {
      blurred = device.createTexture({ label: "glow cache octave", size: [level.width, level.height], format, usage: USAGE });
      this.blur(encoder, level, level.width, level.height, o, format, blurred);
      cache.blurred.set(key, blurred);
      cache.bytes += level.width * level.height * (format === "rgba16float" ? 8 : 16);
      // Radii dragged through many values: keep the latest dozen.
      if (cache.blurred.size > 12) {
        const [oldest, old] = cache.blurred.entries().next().value!;
        cache.blurred.delete(oldest);
        void device.queue.onSubmittedWorkDone().then(() => setTimeout(() => old.destroy(), 0));
      }
    }
    return { texture: blurred, origin: cache.origin, spacing: 2 ** o.at, width: level.width, height: level.height, weight: o.weight, mitchell: o.at > o.level };
  }

  // --- compositing ---

  /** `content` (on `view`'s grid) over `target` through the node's opacity, mask and blend (Normal, or Add). */
  composite(encoder: GPUCommandEncoder, node: ContentNode, content: GPUTexture, target: GPUTexture, view: View, mask: Drawable | null, draw: LayerDraw | null, format: PlanFormat) {
    this.drawContent(encoder, content, target, view, mask, draw, format, { blend: addsLight(node.blend) ? "add" : "normal", opacity: node.opacity, clear: false, encode: false });
  }

  /**
   * `content` through its layer's mask alone into `target` (cleared), encoded with `encode`: the layer drawn alone,
   * for the compositor's blend or style pass (which applies its opacity and blending).
   */
  prepare(encoder: GPUCommandEncoder, content: GPUTexture, target: GPUTexture, view: View, mask: Drawable | null, draw: LayerDraw | null, format: PlanFormat, encode: boolean) {
    this.drawContent(encoder, content, target, view, mask, draw, format, { blend: "normal", opacity: 1, clear: true, encode });
  }

  private drawContent(encoder: GPUCommandEncoder, content: GPUTexture, target: GPUTexture, view: View, mask: Drawable | null, draw: LayerDraw | null, format: PlanFormat, o: { blend: Blend; opacity: number; clear: boolean; encode: boolean }) {
    const { device } = this.compositor.ctx;
    // The mask's pixels: a placed layer's own (through its inverse matrix), a generator's the document's.
    const inv = draw ? invert(draw.matrix) : ([1, 0, 0, 1, 0, 0] as const);
    const scale = draw ? view.zoom * layerScale(draw.transform) : view.zoom;
    const u = new ArrayBuffer(64);
    const f = new Float32Array(u);
    f.set([inv[0], inv[2], inv[4], 0, inv[1], inv[3], inv[5], 0, view.x, view.y, view.zoom, o.opacity]);
    new Uint32Array(u, 48, 3).set([mask ? levelForScale(scale, mask.image.levels.length) : 0, mask ? 1 : 0, o.encode ? 1 : 0]);
    const ctx = mask?.ctx ?? this.compositor.ctx;
    const image = mask?.image ?? ctx.emptyImage;
    image.flush();
    const pass = encoder.beginRenderPass({ colorAttachments: [{ view: target.createView(), loadOp: o.clear ? "clear" : "load", storeOp: "store", clearValue: [0, 0, 0, 0] }] });
    pass.setPipeline(this.pipelines.composite.get(`${o.blend}:${format}`)!);
    pass.setBindGroup(0, ctx.atlasBindGroup());
    pass.setBindGroup(1, ctx.imageBindGroup(image));
    pass.setBindGroup(2, device.createBindGroup({ layout: this.layouts.composite, entries: [{ binding: 0, resource: content.createView() }, { binding: 1, resource: { buffer: this.uniform(u, "composite") } }] }));
    pass.setViewport(0, 0, Math.round(view.width), Math.round(view.height), 0, 1);
    pass.draw(3);
    pass.end();
  }

  destroy() {
    this.pool.destroy();
    this.dummy.destroy();
    this.noTable.destroy();
    for (const t of this.dummies.values()) t.destroy();
    for (const f of this.flares.values()) f.buffer.destroy();
    this.flares.clear();
    for (const b of this.gradients.values()) b.destroy();
    this.gradients.clear();
    void this.sampler;
  }
}
