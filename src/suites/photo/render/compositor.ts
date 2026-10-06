/**
 * The document's evaluator (docs/photo/rendering.md, "The render plan"): it runs a `RenderPlan` bottom to top into
 * float buffers of the plan's format. Image layers are drawn through their own transform, premultiplied
 * source-over; an adjustment reads what's below and writes the next buffer (two buffers take turns). The screen,
 * exports, Home's cover and the assistant's pictures all evaluate here: what's seen is what exports.
 *
 * A layer is resampled from its source: Mitchell at final quality (stretched when the view reduces it, so reducing
 * never aliases), bilinear while the view moves, and read texel for texel when its pixels land exactly on the
 * view's (scale ±1, right angles, whole-pixel offsets), so an unedited photo exports bit for bit.
 *
 * Refinement (a reduced view of a plan that doesn't commute with reduction) is built from three passes here: the
 * plan at full resolution over a region, `reduce` (the pyramid's 2 × 2 box) down to the view's level, and `sample`
 * (Mitchell at the view's pixels, as a source would be read).
 */
import { type View, levelForScale } from "@shared/photo/geometry.ts";
import { type Affine, invert, layerScale } from "@shared/photo/layers.ts";
import type { AdjustmentNode, ImageNode, PlanFormat, RenderPlan } from "@shared/photo/render-plan.ts";
import type { LayerTransform } from "@shared/photo/types.ts";
import { ADJUSTMENT_KERNELS, adjustmentShader } from "./adjustments.ts";
import type { RenderContext } from "./context.ts";
import { ROUND_FOR_STORE } from "./kernels.ts";
import type { SourceImage } from "./source.ts";
import { ATLAS, IMAGE_STRUCTS, MATHS, imageFunctions } from "./wgsl.ts";

export type Quality = "interactive" | "final";

export const COMPOSITE_FORMATS: readonly PlanFormat[] = ["rgba16float", "rgba32float"];

/** One layer to draw: its source on the GPU, where it goes, how opaque. */
export interface LayerDraw {
  source: SourceImage;
  /** Layer pixels → document pixels. */
  matrix: Affine;
  transform: LayerTransform;
  opacity: number;
}

/** Counted work, for the gate "re-renders only what depends on it". */
export interface EvaluatorStats {
  /** Image layers drawn. */
  imageDraws: number;
  /** Adjustment passes run. */
  adjustmentPasses: number;
  /** Evaluations that started from a kept result below an adjustment. */
  resumed: number;
}

const LAYER = /* wgsl */ `
${ATLAS}
${IMAGE_STRUCTS}
${MATHS}
${imageFunctions("src", 1)}
struct Layer {
  inv0: vec4f,        // u = dot(inv0.xy, doc) + inv0.z
  inv1: vec4f,        // v = dot(inv1.xy, doc) + inv1.z
  origin: vec2f,      // the document point at the target's top-left
  zoom: f32,          // target pixels per document pixel
  opacity: f32,
  size: vec2f,        // the source's size in its own pixels
  level: u32,
  mode: u32,          // 0 bilinear, 1 Mitchell, 2 texel for texel
  scale: f32,         // target pixels per source pixel
  hasPreview: u32,
  p0: u32,
  p1: u32,
}
@group(2) @binding(0) var<uniform> layer: Layer;
@group(2) @binding(1) var preview: texture_2d<f32>;
@group(2) @binding(2) var previewSampler: sampler;

@vertex
fn vs(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f { return full_screen(i); }

fn bilinear(level: u32, u: vec2f) -> vec4f {
  let f = u - 0.5;
  let i = vec2i(floor(f));
  let t = f - floor(f);
  let a = texel_src(level, i.x, i.y);
  let b = texel_src(level, i.x + 1, i.y);
  let c = texel_src(level, i.x, i.y + 1);
  let d = texel_src(level, i.x + 1, i.y + 1);
  return mix(mix(a, b, t.x), mix(c, d, t.x), t.y);
}

fn bicubic(level: u32, u: vec2f, s: f32) -> vec4f {
  let f = u - 0.5;
  let reach = 2.0 * s;
  let x0 = i32(ceil(f.x - reach));
  let x1 = i32(floor(f.x + reach));
  let y0 = i32(ceil(f.y - reach));
  let y1 = i32(floor(f.y + reach));
  var c = vec4f(0.0);
  var total = 0.0;
  for (var y = y0; y <= y1; y++) {
    let wy = mitchell((f32(y) - f.y) / s);
    for (var x = x0; x <= x1; x++) {
      let w = wy * mitchell((f32(x) - f.x) / s);
      c += texel_src(level, x, y) * w;
      total += w;
    }
  }
  c /= total;
  return vec4f(c.rgb, clamp(c.a, 0.0, 1.0));
}

@fragment
fn fs(@builtin(position) pos: vec4f) -> @location(0) vec4f {
  let doc = layer.origin + pos.xy / layer.zoom;
  let u = vec2f(dot(layer.inv0.xy, doc) + layer.inv0.z, dot(layer.inv1.xy, doc) + layer.inv1.z);
  // A source pixel's reach under Mitchell, in source pixels: never past this, nothing of the layer shows.
  let reach = 4.0 * max(1.0, 1.0 / layer.scale) + 1.0;
  if (u.x < -reach || u.y < -reach || u.x > layer.size.x + reach || u.y > layer.size.y + reach) { discard; }
  if (layer.mode == 2u) {
    // Texel for texel: the source pixel under this one, exactly.
    return texel_src(0u, i32(floor(u.x)), i32(floor(u.y))) * layer.opacity;
  }
  // The finest level at or coarser than the one wanted whose tile here is resident: the view refines as tiles arrive.
  var level = layer.level;
  loop {
    let scale = exp2(-f32(level));
    let p = u * scale;
    if (present_src(level, i32(floor(p.x)), i32(floor(p.y)))) {
      var c: vec4f;
      if (layer.mode == 1u) {
        c = bicubic(level, p, max(1.0, exp2(-f32(level)) / layer.scale));
      } else {
        c = bilinear(level, p);
      }
      return c * layer.opacity;
    }
    if (level + 1u >= img_src.levels) { break; }
    level += 1u;
  }
  if (layer.hasPreview == 1u && u.x >= 0.0 && u.y >= 0.0 && u.x < layer.size.x && u.y < layer.size.y) {
    let p = textureSampleLevel(preview, previewSampler, u / layer.size, 0.0);
    return vec4f(p.rgb * p.a, p.a) * layer.opacity;
  }
  discard;
  return vec4f(0.0);
}
`;

/** A composite onto the canvas element: the canvas's area over the checkerboard, the pasteboard around it. */
const PRESENT = /* wgsl */ `
${MATHS}
struct Present { canvas: vec4f, checker: f32, amplitude: f32, p0: f32, p1: f32, pasteboard: vec4f }
@group(0) @binding(0) var accumulated: texture_2d<f32>;
@group(0) @binding(1) var<uniform> present: Present;

@vertex
fn vs(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f { return full_screen(i); }

@fragment
fn fs(@builtin(position) pos: vec4f) -> @location(0) vec4f {
  let inside = pos.x >= present.canvas.x && pos.y >= present.canvas.y && pos.x < present.canvas.z && pos.y < present.canvas.w;
  if (!inside) { return present.pasteboard; }
  let c = textureLoad(accumulated, vec2i(pos.xy), 0);
  // The checkerboard under transparency is UI: light greys, in linear light.
  let cell = vec2u(floor((pos.xy - present.canvas.xy) / present.checker));
  let grey = select(0.8, 0.48, ((cell.x + cell.y) & 1u) == 1u);
  let shown = vec4f(c.rgb + vec3f(grey) * (1.0 - clamp(c.a, 0.0, 1.0)), 1.0);
  let e = encode_pixel(shown);
  let d = dither_at(u32(pos.x), u32(pos.y), present.amplitude) / 255.0;
  return vec4f(e.rgb + d, 1.0);
}
`;

/**
 * A composite through the output transform into RGBA (exports, pictures): 8 bits dithered by document pixel, or 16
 * bits undithered (rendering.md, "The output transform"), optionally over a matte (JPEG) or the checkerboard
 * (pictures for the assistant).
 */
const QUANTIZE = (bits: 8 | 16) => /* wgsl */ `
${MATHS}
struct Params { origin: vec2u, size: vec2u, amplitude: f32, under: u32, checker: f32, p0: u32, matte: vec4f }
@group(0) @binding(0) var accumulated: texture_2d<f32>;
@group(0) @binding(1) var<storage, read_write> out: array<u32>;
@group(0) @binding(2) var<uniform> params: Params;

@compute @workgroup_size(16, 16)
fn main(@builtin(global_invocation_id) g: vec3u) {
  if (g.x >= params.size.x || g.y >= params.size.y) { return; }
  var c = textureLoad(accumulated, vec2i(g.xy), 0);
  let a = clamp(c.a, 0.0, 1.0);
  if (params.under == 1u) {
    c = vec4f(c.rgb + params.matte.rgb * (1.0 - a), 1.0);
  } else if (params.under == 2u) {
    let cell = vec2u(floor(vec2f(g.xy) / params.checker));
    let grey = select(0.8, 0.48, ((cell.x + cell.y) & 1u) == 1u);
    c = vec4f(c.rgb + vec3f(grey) * (1.0 - a), 1.0);
  }
  let e = encode_pixel(c);
  let i = g.y * params.size.x + g.x;
${
  bits === 8
    ? `  let x = params.origin.x + g.x;
  let y = params.origin.y + g.y;
  let d = select(0.0, dither_at(x, y, params.amplitude), params.amplitude > 0.0);
  let q = vec3u(clamp(floor(e.rgb * 255.0 + d + 0.5), vec3f(0.0), vec3f(255.0)));
  let alpha = u32(floor(e.a * 255.0 + 0.5));
  out[i] = q.r | (q.g << 8u) | (q.b << 16u) | (alpha << 24u);`
    : `  let q = vec4u(clamp(floor(e * 65535.0 + 0.5), vec4f(0.0), vec4f(65535.0)));
  out[2u * i] = q.r | (q.g << 16u);
  out[2u * i + 1u] = q.b | (q.a << 16u);`
}
}
`;

/** The pyramid's step on a composite: each pixel the mean of the four below it (rendering.md, "Resampling"). */
const REDUCE = (format: PlanFormat) => /* wgsl */ `
${ROUND_FOR_STORE(format)}
${MATHS}
struct Params { size: vec2u, p0: u32, p1: u32 }
@group(0) @binding(0) var src: texture_2d<f32>;
@group(0) @binding(1) var<uniform> params: Params;

@vertex
fn vs(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f { return full_screen(i); }

fn at(p: vec2i) -> vec4f {
  if (p.x >= i32(params.size.x) || p.y >= i32(params.size.y)) { return vec4f(0.0); }
  return textureLoad(src, p, 0);
}

@fragment
fn fs(@builtin(position) pos: vec4f) -> @location(0) vec4f {
  let p = vec2i(floor(pos.xy)) * 2;
  return round_for_store((at(p) + at(p + vec2i(1, 0)) + at(p + vec2i(0, 1)) + at(p + vec2i(1, 1))) * 0.25);
}
`;

/**
 * A reduced level of a region at the view's pixels: Mitchell, stretched as a source's level would be read (the
 * compositor's `bicubic`), so a refined view is the full-resolution render reduced the way sources are.
 */
const SAMPLE = (format: PlanFormat) => /* wgsl */ `
${ROUND_FOR_STORE(format)}
${MATHS}
struct Params { view: vec2f, zoom: f32, inv: f32, origin: vec2f, size: vec2f, stretch: f32, p0: f32, p1: f32, p2: f32 }
@group(0) @binding(0) var level: texture_2d<f32>;
@group(0) @binding(1) var<uniform> params: Params;

@vertex
fn vs(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f { return full_screen(i); }

fn texel(x: i32, y: i32) -> vec4f {
  if (x < 0 || y < 0 || x >= i32(params.size.x) || y >= i32(params.size.y)) { return vec4f(0.0); }
  return textureLoad(level, vec2i(x, y), 0);
}

@fragment
fn fs(@builtin(position) pos: vec4f) -> @location(0) vec4f {
  let doc = params.view + pos.xy / params.zoom;
  let f = doc * params.inv - params.origin - 0.5;
  let s = params.stretch;
  let reach = 2.0 * s;
  var c = vec4f(0.0);
  var total = 0.0;
  for (var y = i32(ceil(f.y - reach)); y <= i32(floor(f.y + reach)); y++) {
    let wy = mitchell((f32(y) - f.y) / s);
    for (var x = i32(ceil(f.x - reach)); x <= i32(floor(f.x + reach)); x++) {
      let w = wy * mitchell((f32(x) - f.x) / s);
      c += texel(x, y) * w;
      total += w;
    }
  }
  c /= total;
  return round_for_store(vec4f(c.rgb, clamp(c.a, 0.0, 1.0)));
}
`;

const UNIFORM_STRIDE = 256;

/** Whether a layer's pixel centres land exactly on the target's pixel centres (so it's read texel for texel). */
export function alignedLayer(matrix: Affine, view: Pick<View, "x" | "y" | "zoom">): boolean {
  if (view.zoom !== 1) return false;
  const [a, b, c, d] = matrix;
  const permutation = (a === 0 && d === 0 && Math.abs(b) === 1 && Math.abs(c) === 1) || (b === 0 && c === 0 && Math.abs(a) === 1 && Math.abs(d) === 1);
  if (!permutation) return false;
  const inv = invert(matrix);
  const centre = { x: view.x + 0.5, y: view.y + 0.5 };
  const u = inv[0] * centre.x + inv[2] * centre.y + inv[4];
  const v = inv[1] * centre.x + inv[3] * centre.y + inv[5];
  const half = (n: number) => Math.abs(n - Math.floor(n) - 0.5) < 1e-6;
  return half(u) && half(v);
}

/** Two textures of one size and format that an evaluation alternates between. */
export interface WorkPair {
  a: GPUTexture;
  b: GPUTexture;
}

export interface EvaluateOptions {
  /** Start from a kept result: the composite below node `index`, in `texture` (read, never written). */
  from?: { index: number; texture: GPUTexture };
  /** Called with the composite below each adjustment, before it runs (the caller copies what it wants to keep). */
  beforeAdjustment?: (index: number, composite: GPUTexture, encoder: GPUCommandEncoder) => void;
}

const COMPOSITE_USAGE = GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_SRC | GPUTextureUsage.COPY_DST;

/** A float composite texture the evaluator can draw into, read from and copy. */
export function compositeTexture(device: GPUDevice, width: number, height: number, format: PlanFormat, label: string): GPUTexture {
  return device.createTexture({ label, size: [Math.max(1, width), Math.max(1, height)], format, usage: COMPOSITE_USAGE });
}

interface Pipelines {
  layer: Record<PlanFormat, GPURenderPipeline>;
  adjustment: Map<string, GPURenderPipeline>;
  reduce: Record<PlanFormat, GPURenderPipeline>;
  sample: Record<PlanFormat, GPURenderPipeline>;
  present: GPURenderPipeline;
  quantize8: GPUComputePipeline;
  /** Null until it has compiled (`ready`). */
  quantize16: GPUComputePipeline | null;
}

export class Compositor {
  readonly pipelines: Pipelines;
  readonly stats: EvaluatorStats = { imageDraws: 0, adjustmentPasses: 0, resumed: 0 };
  private uniforms: GPUBuffer;
  private readonly sampler: GPUSampler;
  private readonly blank: GPUTexture;
  private readonly emptyTable: GPUBuffer;
  private readonly layerGroups = new WeakMap<SourceImage, { preview: GPUTexture | null; uniforms: GPUBuffer; group: GPUBindGroup }>();
  /** Each adjustment's parameters on the GPU, by its node's key (a node's parameters never change under its key). */
  private readonly adjustmentParams = new Map<string, { uniform: GPUBuffer; table: GPUBuffer | null; group: GPUBindGroup }>();

  private constructor(
    readonly ctx: RenderContext,
    readonly layouts: { layer: GPUBindGroupLayout; texture: GPUBindGroupLayout; textureUniform: GPUBindGroupLayout; params: GPUBindGroupLayout; quantize: GPUBindGroupLayout },
    pipelines: Pipelines,
    private readonly formats: readonly PlanFormat[],
    /** Resolves when every pipeline has compiled (the first picture's are there from the start). */
    readonly ready: Promise<void>,
  ) {
    this.pipelines = pipelines;
    const { device } = ctx;
    this.uniforms = device.createBuffer({ size: UNIFORM_STRIDE * 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    this.sampler = device.createSampler({ magFilter: "linear", minFilter: "linear" });
    this.blank = device.createTexture({ size: [1, 1], format: "rgba8unorm-srgb", usage: GPUTextureUsage.TEXTURE_BINDING });
    this.emptyTable = device.createBuffer({ size: 16, usage: GPUBufferUsage.STORAGE });
  }

  /**
   * A compositor whose pipelines have compiled (the canvas format is the screen's). `formats` are the composite
   * formats it evaluates in: f32 needs the device's `float32-blendable`.
   */
  static async create(ctx: RenderContext, canvasFormat: GPUTextureFormat, formats: readonly PlanFormat[] = COMPOSITE_FORMATS): Promise<Compositor> {
    const { device } = ctx;
    const blend: GPUBlendState = {
      color: { srcFactor: "one", dstFactor: "one-minus-src-alpha", operation: "add" },
      alpha: { srcFactor: "one", dstFactor: "one-minus-src-alpha", operation: "add" },
    };
    const FRAG = GPUShaderStage.FRAGMENT;
    const COMP = GPUShaderStage.COMPUTE;
    const layerGroup = device.createBindGroupLayout({
      label: "layer",
      entries: [
        { binding: 0, visibility: FRAG, buffer: { type: "uniform", hasDynamicOffset: true } },
        { binding: 1, visibility: FRAG, texture: { sampleType: "float" } },
        { binding: 2, visibility: FRAG, sampler: { type: "filtering" } },
      ],
    });
    const texture = device.createBindGroupLayout({ label: "below", entries: [{ binding: 0, visibility: FRAG, texture: { sampleType: "unfilterable-float" } }] });
    const textureUniform = device.createBindGroupLayout({
      label: "texture + uniform",
      entries: [
        { binding: 0, visibility: FRAG, texture: { sampleType: "unfilterable-float" } },
        { binding: 1, visibility: FRAG, buffer: { type: "uniform" } },
      ],
    });
    const params = device.createBindGroupLayout({
      label: "adjustment params",
      entries: [
        { binding: 0, visibility: FRAG, buffer: { type: "uniform" } },
        { binding: 1, visibility: FRAG, buffer: { type: "read-only-storage" } },
      ],
    });
    const quantize = device.createBindGroupLayout({
      label: "quantize",
      entries: [
        { binding: 0, visibility: COMP, texture: { sampleType: "unfilterable-float" } },
        { binding: 1, visibility: COMP, buffer: { type: "storage" } },
        { binding: 2, visibility: COMP, buffer: { type: "uniform" } },
      ],
    });
    const render = (label: string, code: string, layouts: GPUBindGroupLayout[], format: GPUTextureFormat, withBlend = false) => {
      const module = device.createShaderModule({ label, code });
      return device.createRenderPipelineAsync({
        label,
        layout: device.createPipelineLayout({ bindGroupLayouts: layouts }),
        vertex: { module, entryPoint: "vs" },
        fragment: { module, entryPoint: "fs", targets: [{ format, ...(withBlend ? { blend } : {}) }] },
        primitive: { topology: "triangle-list" },
      });
    };
    const compute = (label: string, code: string) =>
      device.createComputePipelineAsync({ label, layout: device.createPipelineLayout({ bindGroupLayouts: [quantize] }), compute: { module: device.createShaderModule({ label, code }), entryPoint: "main" } });

    const layer = {} as Record<PlanFormat, GPURenderPipeline>;
    const reduce = {} as Record<PlanFormat, GPURenderPipeline>;
    const sample = {} as Record<PlanFormat, GPURenderPipeline>;
    const adjustment = new Map<string, GPURenderPipeline>();
    // What a first picture needs is compiled before the compositor is ready; the rest (f32 composites, adjustments,
    // refinement, 16-bit exports) compiles meanwhile, and `ready` says when it has.
    const [first, present, quantize8] = await Promise.all([
      render("layer rgba16float", LAYER, [ctx.kernels.atlasLayout, ctx.kernels.imageLayout, layerGroup], "rgba16float", true),
      render("present", PRESENT, [textureUniform], canvasFormat),
      compute("quantize 8", QUANTIZE(8)),
    ]);
    layer.rgba16float = first;
    const pipelines: Pipelines = { layer, adjustment, reduce, sample, present, quantize8, quantize16: null };
    const rest: Promise<unknown>[] = [compute("quantize 16", QUANTIZE(16)).then((p) => (pipelines.quantize16 = p))];
    for (const format of formats) {
      if (format !== "rgba16float") rest.push(render(`layer ${format}`, LAYER, [ctx.kernels.atlasLayout, ctx.kernels.imageLayout, layerGroup], format, true).then((p) => (layer[format] = p)));
      rest.push(
        render(`reduce ${format}`, REDUCE(format), [textureUniform], format).then((p) => (reduce[format] = p)),
        render(`sample ${format}`, SAMPLE(format), [textureUniform], format).then((p) => (sample[format] = p)),
        ...Object.entries(ADJUSTMENT_KERNELS).map(([type, kernel]) =>
          render(`${type} ${format}`, adjustmentShader(kernel, format), [texture, params], format).then((p) => adjustment.set(`${type}:${format}`, p)),
        ),
      );
    }
    return new Compositor(ctx, { layer: layerGroup, texture, textureUniform, params, quantize }, pipelines, formats, Promise.all(rest).then(() => {}));
  }

  /** Whether every pipeline `plan` needs has compiled (and, to refine it, the reduction's). */
  canEvaluate(plan: RenderPlan, refine = false): boolean {
    const p = this.pipelines;
    if (!p.layer[plan.format]) return false;
    if (refine && (!p.reduce[plan.format] || !p.sample[plan.format])) return false;
    return plan.nodes.every((n) => n.kind !== "adjustment" || p.adjustment.has(`${n.type}:${plan.format}`));
  }

  /** Compilation errors of the compositor's modules (empty when they compile), for checks. */
  static async compileErrors(device: GPUDevice): Promise<string[]> {
    const modules: [string, string][] = [
      ["layer", LAYER],
      ["present", PRESENT],
      ["quantize 8", QUANTIZE(8)],
      ["quantize 16", QUANTIZE(16)],
      ...COMPOSITE_FORMATS.flatMap((f): [string, string][] => [
        [`reduce ${f}`, REDUCE(f)],
        [`sample ${f}`, SAMPLE(f)],
        ...Object.entries(ADJUSTMENT_KERNELS).map(([type, k]): [string, string] => [`${type} ${f}`, adjustmentShader(k, f)]),
      ]),
    ];
    const errors: string[] = [];
    for (const [label, code] of modules) {
      const info = await device.createShaderModule({ label, code }).getCompilationInfo();
      for (const m of info.messages) if (m.type === "error") errors.push(`${label}:${m.lineNum}: ${m.message}`);
    }
    return errors;
  }

  /** Whether composites can be of this format (f32 needs the device's `float32-blendable`). */
  supports(format: PlanFormat) {
    return this.formats.includes(format);
  }

  private groupFor(source: SourceImage) {
    let entry = this.layerGroups.get(source);
    if (!entry || entry.preview !== source.preview || entry.uniforms !== this.uniforms) {
      entry = {
        preview: source.preview,
        uniforms: this.uniforms,
        group: this.ctx.device.createBindGroup({
          layout: this.layouts.layer,
          entries: [
            { binding: 0, resource: { buffer: this.uniforms, size: 80 } },
            { binding: 1, resource: (source.preview ?? this.blank).createView() },
            { binding: 2, resource: this.sampler },
          ],
        }),
      };
      this.layerGroups.set(source, entry);
    }
    return entry.group;
  }

  private paramsFor(node: AdjustmentNode) {
    let entry = this.adjustmentParams.get(node.key);
    if (entry) {
      // Most recently used last, so the oldest go first.
      this.adjustmentParams.delete(node.key);
      this.adjustmentParams.set(node.key, entry);
      return entry;
    }
    const { device } = this.ctx;
    const packed = ADJUSTMENT_KERNELS[node.type].pack(node.params, node.opacity);
    const uniform = device.createBuffer({ label: `${node.type} params`, size: Math.max(16, packed.uniform.byteLength), usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    device.queue.writeBuffer(uniform, 0, packed.uniform);
    let table: GPUBuffer | null = null;
    if (packed.table) {
      table = device.createBuffer({ label: `${node.type} table`, size: packed.table.byteLength, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
      device.queue.writeBuffer(table, 0, packed.table);
    }
    const group = device.createBindGroup({
      layout: this.layouts.params,
      entries: [
        { binding: 0, resource: { buffer: uniform } },
        { binding: 1, resource: { buffer: table ?? this.emptyTable } },
      ],
    });
    entry = { uniform, table, group };
    this.adjustmentParams.set(node.key, entry);
    while (this.adjustmentParams.size > 48) {
      const [oldest, old] = this.adjustmentParams.entries().next().value!;
      this.adjustmentParams.delete(oldest);
      // Destroyed once the GPU is done with what's already submitted.
      void device.queue.onSubmittedWorkDone().then(() => {
        old.uniform.destroy();
        old.table?.destroy();
      });
    }
    return entry;
  }

  /**
   * Evaluates `plan` for `view` (a target of `view.width` × `view.height`) into one of `work`'s textures, and
   * returns that one. Image layers whose source isn't on the GPU yet (`draw` gives null) are left out.
   */
  evaluate(encoder: GPUCommandEncoder, plan: RenderPlan, view: View, quality: Quality, draw: (node: ImageNode) => LayerDraw | null, work: WorkPair, options: EvaluateOptions = {}): GPUTexture {
    const { device } = this.ctx;
    const format = plan.format;
    const start = options.from?.index ?? 0;
    // Every image this evaluation draws, its uniforms written once (one slot each).
    const images: { index: number; draw: LayerDraw }[] = [];
    for (let i = start; i < plan.nodes.length; i++) {
      const node = plan.nodes[i];
      if (node.kind !== "image") continue;
      const d = draw(node);
      if (d) images.push({ index: i, draw: d });
    }
    if (images.length > this.uniforms.size / UNIFORM_STRIDE) {
      this.uniforms.destroy();
      this.uniforms = device.createBuffer({ size: UNIFORM_STRIDE * Math.ceil(images.length * 1.5), usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    }
    if (images.length) {
      const data = new ArrayBuffer(UNIFORM_STRIDE * images.length);
      images.forEach(({ draw: l }, i) => {
        const f = new Float32Array(data, i * UNIFORM_STRIDE, 20);
        const u = new Uint32Array(data, i * UNIFORM_STRIDE, 20);
        const inv = invert(l.matrix);
        f.set([inv[0], inv[2], inv[4], 0, inv[1], inv[3], inv[5], 0, view.x, view.y, view.zoom, l.opacity, l.source.layout.width, l.source.layout.height], 0);
        const scale = view.zoom * layerScale(l.transform);
        u[14] = levelForScale(scale, l.source.image.levels.length);
        u[15] = alignedLayer(l.matrix, view) ? 2 : quality === "final" ? 1 : 0;
        f[16] = scale;
        u[17] = l.source.preview ? 1 : 0;
      });
      device.queue.writeBuffer(this.uniforms, 0, data);
    }
    const slotOf = new Map(images.map((im, slot) => [im.index, { slot, draw: im.draw }]));

    let current = work.a;
    let clear = true;
    if (options.from) {
      encoder.copyTextureToTexture({ texture: options.from.texture }, { texture: current }, [view.width, view.height]);
      clear = false;
      this.stats.resumed++;
    }
    let i = start;
    while (i < plan.nodes.length) {
      const node = plan.nodes[i];
      if (node.kind === "image") {
        // A run of images: one pass, each blended over the last.
        const pass = encoder.beginRenderPass({
          colorAttachments: [{ view: current.createView(), loadOp: clear ? "clear" : "load", storeOp: "store", clearValue: plan.background }],
        });
        clear = false;
        pass.setPipeline(this.pipelines.layer[format]);
        while (i < plan.nodes.length && plan.nodes[i].kind === "image") {
          const entry = slotOf.get(i);
          if (entry) {
            const l = entry.draw;
            l.source.image.flush();
            pass.setBindGroup(0, l.source.ctx.atlasBindGroup());
            pass.setBindGroup(1, l.source.ctx.imageBindGroup(l.source.image));
            pass.setBindGroup(2, this.groupFor(l.source), [entry.slot * UNIFORM_STRIDE]);
            pass.draw(3);
            this.stats.imageDraws++;
          }
          i++;
        }
        pass.end();
        continue;
      }
      if (clear) {
        this.clear(encoder, current, plan.background);
        clear = false;
      }
      options.beforeAdjustment?.(i, current, encoder);
      const next = current === work.a ? work.b : work.a;
      const pass = encoder.beginRenderPass({ colorAttachments: [{ view: next.createView(), loadOp: "clear", storeOp: "store", clearValue: [0, 0, 0, 0] }] });
      pass.setPipeline(this.pipelines.adjustment.get(`${node.type}:${format}`)!);
      pass.setBindGroup(0, device.createBindGroup({ layout: this.layouts.texture, entries: [{ binding: 0, resource: current.createView() }] }));
      pass.setBindGroup(1, this.paramsFor(node).group);
      pass.setViewport(0, 0, view.width, view.height, 0, 1);
      pass.draw(3);
      pass.end();
      this.stats.adjustmentPasses++;
      current = next;
      i++;
    }
    if (clear) this.clear(encoder, current, plan.background);
    return current;
  }

  private clear(encoder: GPUCommandEncoder, target: GPUTexture, colour: readonly number[]) {
    encoder.beginRenderPass({ colorAttachments: [{ view: target.createView(), loadOp: "clear", storeOp: "store", clearValue: [...colour] }] }).end();
  }

  /** `from`'s top-left `size` reduced by the 2 × 2 box into `to`'s top-left (ceil(size / 2)). */
  reduce(encoder: GPUCommandEncoder, format: PlanFormat, from: GPUTexture, size: { width: number; height: number }, to: GPUTexture) {
    const { device } = this.ctx;
    const uniform = device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    device.queue.writeBuffer(uniform, 0, new Uint32Array([size.width, size.height, 0, 0]));
    const pass = encoder.beginRenderPass({ colorAttachments: [{ view: to.createView(), loadOp: "clear", storeOp: "store", clearValue: [0, 0, 0, 0] }] });
    pass.setPipeline(this.pipelines.reduce[format]);
    pass.setBindGroup(0, device.createBindGroup({ layout: this.layouts.textureUniform, entries: [{ binding: 0, resource: from.createView() }, { binding: 1, resource: { buffer: uniform } }] }));
    pass.setViewport(0, 0, Math.ceil(size.width / 2), Math.ceil(size.height / 2), 0, 1);
    pass.draw(3);
    pass.end();
    void device.queue.onSubmittedWorkDone().then(() => uniform.destroy());
  }

  /**
   * Samples a reduced region (`level`, whose pixel (0, 0) is level pixel `origin`) at the view's pixels inside
   * `rect` of `target`: Mitchell stretched by `stretch`.
   */
  sample(
    encoder: GPUCommandEncoder,
    format: PlanFormat,
    level: GPUTexture,
    params: { view: View; inv: number; origin: { x: number; y: number }; size: { width: number; height: number }; stretch: number },
    target: GPUTexture,
    rect: { x0: number; y0: number; x1: number; y1: number },
  ) {
    const { device } = this.ctx;
    const uniform = device.createBuffer({ size: 48, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    const { view } = params;
    device.queue.writeBuffer(uniform, 0, new Float32Array([view.x, view.y, view.zoom, params.inv, params.origin.x, params.origin.y, params.size.width, params.size.height, params.stretch, 0, 0, 0]));
    const pass = encoder.beginRenderPass({ colorAttachments: [{ view: target.createView(), loadOp: "load", storeOp: "store" }] });
    pass.setPipeline(this.pipelines.sample[format]);
    pass.setBindGroup(0, device.createBindGroup({ layout: this.layouts.textureUniform, entries: [{ binding: 0, resource: level.createView() }, { binding: 1, resource: { buffer: uniform } }] }));
    pass.setScissorRect(rect.x0, rect.y0, rect.x1 - rect.x0, rect.y1 - rect.y0);
    pass.draw(3);
    pass.end();
    void device.queue.onSubmittedWorkDone().then(() => uniform.destroy());
  }

  /** Draws a composite on a canvas texture through the output transform (`uniform`: `Present`'s 48 bytes). */
  present(encoder: GPUCommandEncoder, composite: GPUTexture, uniform: GPUBuffer, canvas: GPUTexture) {
    const pass = encoder.beginRenderPass({ colorAttachments: [{ view: canvas.createView(), loadOp: "clear", storeOp: "store", clearValue: [0, 0, 0, 1] }] });
    pass.setPipeline(this.pipelines.present);
    pass.setBindGroup(
      0,
      this.ctx.device.createBindGroup({ layout: this.layouts.textureUniform, entries: [{ binding: 0, resource: composite.createView() }, { binding: 1, resource: { buffer: uniform } }] }),
    );
    pass.draw(3);
    pass.end();
  }

  /** A quantise pass's bind group: the composite in, `out` (u32 per pixel at 8 bits, two at 16), `params`. */
  quantizeGroup(composite: GPUTexture, out: GPUBuffer, params: GPUBuffer): GPUBindGroup {
    return this.ctx.device.createBindGroup({
      layout: this.layouts.quantize,
      entries: [
        { binding: 0, resource: composite.createView() },
        { binding: 1, resource: { buffer: out } },
        { binding: 2, resource: { buffer: params } },
      ],
    });
  }

  destroy() {
    this.uniforms.destroy();
    this.blank.destroy();
    this.emptyTable.destroy();
    for (const p of this.adjustmentParams.values()) {
      p.uniform.destroy();
      p.table?.destroy();
    }
    this.adjustmentParams.clear();
  }
}
