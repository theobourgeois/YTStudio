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
 * A layer's mask multiplies what it adds, read in the layer's own pixels (so it follows the layer); an adjustment's
 * multiplies how much it changes, read in document pixels. Pixel layers draw as images do.
 *
 * Blending (docs/photo/layer-style/README.md, phase L1): plain Normal layers draw in runs, source-over by the GPU's
 * blending. A layer with a mode, Blend If or excluded channels is drawn alone into a scratch buffer, then the blend
 * pass reads it and the composite below and writes the other buffer (`render/blend.ts`). In a "photoshop" plan the
 * buffers hold encoded values (premultiplied), as Photoshop mixes them: layers are encoded as they're drawn,
 * adjustments decode, adjust and encode again, and the result is decoded once at the end, so what leaves the
 * evaluator is linear light whatever the compositing.
 *
 * Refinement (a reduced view of a plan that doesn't commute with reduction) is built from three passes here: the
 * plan at full resolution over a region, `reduce` (the pyramid's 2 × 2 box) down to the view's level, and `sample`
 * (Mitchell at the view's pixels, as a source would be read).
 */
import { type View, levelForScale } from "@shared/photo/geometry.ts";
import { type Affine, invert, layerScale } from "@shared/photo/layers.ts";
import { type AdjustmentNode, type ContentNode, type DrawNode, type GeneratorNode, type PlanFormat, type PlanNode, type RenderPlan, addsLight, blendsInLinear, isDrawNode, isIsolated } from "@shared/photo/render-plan.ts";
import type { LayerTransform } from "@shared/photo/types.ts";
import { ADJUSTMENT_KERNELS, adjustmentShader } from "./adjustments.ts";
import { BLEND, BLEND_PARAMS_SIZE, BLEND_STRUCT, packBlend } from "./blend.ts";
import { type PatternsOf, STYLE_COMPOSITE, STYLE_UNIFORM_SIZE, StyleFields, packStyle, planFields } from "./style.ts";
import type { RenderContext } from "./context.ts";
import { ROUND_FOR_STORE } from "./kernels.ts";
import type { VirtualImage } from "./image.ts";
import { type GlowCache, Isolation } from "./isolated.ts";
import { ATLAS, IMAGE_STRUCTS, MASK_SAMPLE, MATHS, atlasAt, imageFunctions } from "./wgsl.ts";

export type Quality = "interactive" | "final";

export const COMPOSITE_FORMATS: readonly PlanFormat[] = ["rgba16float", "rgba32float"];

/** Pixels on the GPU a layer pass reads: a source image, or a surface (painted pixels, a mask). */
export interface Drawable {
  ctx: RenderContext;
  image: VirtualImage;
  /** Its size in its own pixels. */
  width: number;
  height: number;
  /** A coarse picture shown until its tiles arrive (a source's), or null. */
  preview: GPUTexture | null;
}

/** One layer to draw: its pixels on the GPU, where they go, how opaque, and its mask (in the same atlas). */
export interface LayerDraw {
  source: Drawable;
  /** Layer pixels → document pixels. */
  matrix: Affine;
  transform: LayerTransform;
  opacity: number;
  mask: Drawable | null;
}

/**
 * What an evaluation reads: each drawing node's pixels, each adjustment's or generator's mask (null while not on the
 * GPU), and each glow's cache once it's built (`isolated.ts`).
 */
export interface PlanSources {
  draw: (node: DrawNode) => LayerDraw | null;
  mask: (node: AdjustmentNode | GeneratorNode) => Drawable | null;
  glowCache?: (node: ContentNode, filterIndex: number) => GlowCache | null;
  /** What a styled layer's fields are keyed by besides the plan: its pixels' and mask's changes (a stroke, tiles arriving). */
  revision?: (node: DrawNode) => string;
  /** A pattern's levels (null while it loads, or when it's missing: its effects draw without it). */
  pattern?: PatternsOf;
}

/** Counted work, for the gate "re-renders only what depends on it". */
export interface EvaluatorStats {
  /** Image layers drawn. */
  imageDraws: number;
  /** Adjustment passes run. */
  adjustmentPasses: number;
  /** Blend passes run (layers with a mode, Blend If or channels). */
  blendPasses: number;
  /** Style passes run (layers with effects). */
  stylePasses: number;
  /** Evaluations that started from a kept result below an adjustment. */
  resumed: number;
}

const LAYER = /* wgsl */ `
${ATLAS}
${IMAGE_STRUCTS}
${MATHS}
${BLEND_STRUCT}
${BLEND}
${imageFunctions("src", 1)}
${imageFunctions("mask", 3)}
${MASK_SAMPLE}
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
  hasMask: u32,
  encoded: u32,       // 1: write encoded values (a "photoshop" plan's composite)
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

// What the layer adds, in the composite's values: linear light, or encoded.
fn out(c: vec4f, k: f32) -> vec4f {
  if (layer.encoded == 1u) { return premult_encode(c) * k; }
  return c * k;
}

@fragment
fn fs(@builtin(position) pos: vec4f) -> @location(0) vec4f {
  let doc = layer.origin + pos.xy / layer.zoom;
  let u = vec2f(dot(layer.inv0.xy, doc) + layer.inv0.z, dot(layer.inv1.xy, doc) + layer.inv1.z);
  // A source pixel's reach under Mitchell, in source pixels: never past this, nothing of the layer shows.
  let reach = 4.0 * max(1.0, 1.0 / layer.scale) + 1.0;
  if (u.x < -reach || u.y < -reach || u.x > layer.size.x + reach || u.y > layer.size.y + reach) { discard; }
  let masked = layer.hasMask == 1u;
  if (layer.mode == 2u) {
    // Texel for texel: the source pixel under this one, exactly (and its mask's).
    let m = select(1.0, clamp(texel_mask(0u, i32(floor(u.x)), i32(floor(u.y))).r, 0.0, 1.0), masked);
    return out(texel_src(0u, i32(floor(u.x)), i32(floor(u.y))), layer.opacity * m);
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
      return out(c, layer.opacity * mask_at(masked, level, p));
    }
    if (level + 1u >= img_src.levels) { break; }
    level += 1u;
  }
  if (layer.hasPreview == 1u && u.x >= 0.0 && u.y >= 0.0 && u.x < layer.size.x && u.y < layer.size.y) {
    let p = textureSampleLevel(preview, previewSampler, u / layer.size, 0.0);
    let coarsest = img_mask.levels - 1u;
    return out(vec4f(p.rgb * p.a, p.a), layer.opacity * mask_at(masked, coarsest, u * exp2(-f32(coarsest))));
  }
  discard;
  return vec4f(0.0);
}
`;

/** A layer drawn alone (`layer`) onto the composite below (`below`) by its blending: reference/blend.ts's compositePixel. */
const BLEND_PASS = (format: PlanFormat) => /* wgsl */ `
${ROUND_FOR_STORE(format)}
${MATHS}
${BLEND_STRUCT}
${BLEND}
@group(0) @binding(0) var below: texture_2d<f32>;
@group(0) @binding(1) var drawn: texture_2d<f32>;
@group(1) @binding(0) var<uniform> blend: BlendParams;

@vertex
fn vs(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f { return full_screen(i); }

@fragment
fn fs(@builtin(position) pos: vec4f) -> @location(0) vec4f {
  let p = vec2i(pos.xy);
  let doc = blend.origin + pos.xy / blend.zoom;
  // \`p0\`: a layer blending in linear light in an encoded composite (a flare's blendSpace): drawn in linear light,
  // it meets what's below decoded, and the result is encoded again.
  if (blend.p0 > 0.5) {
    var q = blend;
    q.encoded = 0u;
    return round_for_store(premult_encode(composite_pixel(q, premult_decode(textureLoad(below, p, 0)), textureLoad(drawn, p, 0), doc)));
  }
  return round_for_store(composite_pixel(blend, textureLoad(below, p, 0), textureLoad(drawn, p, 0), doc));
}
`;

/** An encoded composite back to linear light: the last pass of a "photoshop" plan. */
const DECODE = (format: PlanFormat) => /* wgsl */ `
${ROUND_FOR_STORE(format)}
${MATHS}
${BLEND_STRUCT}
${BLEND}
@group(0) @binding(0) var encoded: texture_2d<f32>;

@vertex
fn vs(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f { return full_screen(i); }

@fragment
fn fs(@builtin(position) pos: vec4f) -> @location(0) vec4f {
  return round_for_store(premult_decode(textureLoad(encoded, vec2i(pos.xy), 0)));
}
`;

/** A composite onto the canvas element: the canvas's area over the checkerboard, the pasteboard around it. */
const PRESENT = /* wgsl */ `
${MATHS}
struct Present { canvas: vec4f, checker: f32, amplitude: f32, film: f32, p1: f32, pasteboard: vec4f }
@group(0) @binding(0) var accumulated: texture_2d<f32>;
@group(0) @binding(1) var<uniform> present: Present;

@vertex
fn vs(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f { return full_screen(i); }

@fragment
fn fs(@builtin(position) pos: vec4f) -> @location(0) vec4f {
  let inside = pos.x >= present.canvas.x && pos.y >= present.canvas.y && pos.x < present.canvas.z && pos.y < present.canvas.w;
  // The pasteboard is linear light, like everything else drawn here: encoded for the screen too.
  if (!inside) { return vec4f(encode_pixel(vec4f(present.pasteboard.rgb, 1.0)).rgb, 1.0); }
  let c = textureLoad(accumulated, vec2i(pos.xy), 0);
  // The checkerboard under transparency is UI: light greys, in linear light.
  let cell = vec2u(floor((pos.xy - present.canvas.xy) / present.checker));
  let grey = select(0.8, 0.48, ((cell.x + cell.y) & 1u) == 1u);
  let shown = vec4f(c.rgb + vec3f(grey) * (1.0 - clamp(c.a, 0.0, 1.0)), 1.0);
  let e = encode_pixel_with(shown, present.film > 0.5);
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
struct Params { origin: vec2u, size: vec2u, amplitude: f32, under: u32, checker: f32, film: u32, matte: vec4f }
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
  let e = encode_pixel_with(c, params.film == 1u);
  let i = g.y * params.size.x + g.x;
${
  bits === 8
    ? `  let x = params.origin.x + g.x;
  let y = params.origin.y + g.y;
  let d = select(0.0, dither_at(x, y, params.amplitude), params.amplitude > 0.0);
  var q = vec3u(clamp(floor(e.rgb * 255.0 + d + 0.5), vec3f(0.0), vec3f(255.0)));
  let alpha = u32(floor(e.a * 255.0 + 0.5));
  // Stored transparent: no colour (shared/photo/output.ts's quantize8).
  if (alpha == 0u) { q = vec3u(0u); }
  out[i] = q.r | (q.g << 8u) | (q.b << 16u) | (alpha << 24u);`
    : `  var q = vec4u(clamp(floor(e * 65535.0 + 0.5), vec4f(0.0), vec4f(65535.0)));
  if (q.a == 0u) { q = vec4u(0u); }
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
/** A styled layer's composite uniform's slot (it's more than 256 bytes). */
const STYLE_SLOT = 512;

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
  /** Start from a kept result: the composite below node `index` (one that `needsPass`), in `texture` (read, never written). */
  from?: { index: number; texture: GPUTexture };
  /**
   * Called with the composite below each node that `needsPass` (adjustments and blended layers), before it runs
   * (the caller copies what it wants to keep). It's in the plan's compositing values, as `from` must be.
   */
  beforeAdjustment?: (index: number, composite: GPUTexture, encoder: GPUCommandEncoder) => void;
}

/**
 * Whether a node runs as a pass of its own, reading the composite below (an adjustment, or a layer that blends by
 * more than Normal): the places an evaluation can resume from.
 */
export const needsPass = (node: PlanNode) => node.kind === "adjustment" || node.blend !== null || (isDrawNode(node) && node.style !== null) || isIsolated(node);

/**
 * Whether an isolated layer (filtered, or a generator) composites by the GPU's own blending: Normal, or light added
 * in linear light, in a linear plan without effects. Otherwise its content goes through the blend or style pass.
 */
export const fixedComposite = (node: ContentNode, encoded: boolean) => !encoded && !(isDrawNode(node) && node.style) && (!node.blend || (node.kind === "generator" && addsLight(node.blend)));

const COMPOSITE_USAGE = GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_SRC | GPUTextureUsage.COPY_DST;

/** A float composite texture the evaluator can draw into, read from and copy. */
export function compositeTexture(device: GPUDevice, width: number, height: number, format: PlanFormat, label: string): GPUTexture {
  return device.createTexture({ label, size: [Math.max(1, width), Math.max(1, height)], format, usage: COMPOSITE_USAGE });
}

/** An adjustment's mask, read in document pixels: group 3 of an adjustment pass (its 32-byte `MaskParams`). */
const ADJUSTMENT_MASK = /* wgsl */ `
${IMAGE_STRUCTS}
${atlasAt(2)}
${imageFunctions("mask", 3)}
${MASK_SAMPLE}
struct MaskParams { origin: vec2f, zoom: f32, level: u32, on: u32, p0: u32, p1: u32, p2: u32, blend: BlendParams }
@group(3) @binding(2) var<uniform> maskp: MaskParams;
fn adjustment_mask(pos: vec2f) -> f32 {
  let doc = maskp.origin + pos / maskp.zoom;
  return mask_at(maskp.on == 1u, maskp.level, doc * exp2(-f32(maskp.level)));
}
fn adjustment_blend() -> BlendParams { return maskp.blend; }
`;

/** An adjustment's mask and blending uniform: 32 bytes of mask, then its `BlendParams`. */
const ADJUSTMENT_UNIFORM = 32 + BLEND_PARAMS_SIZE;

interface Pipelines {
  layer: Record<PlanFormat, GPURenderPipeline>;
  blend: Record<PlanFormat, GPURenderPipeline>;
  style: Record<PlanFormat, GPURenderPipeline>;
  decode: Record<PlanFormat, GPURenderPipeline>;
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
  readonly stats: EvaluatorStats = { imageDraws: 0, adjustmentPasses: 0, blendPasses: 0, stylePasses: 0, resumed: 0 };
  /** Layers' effect fields, made and kept (render/style.ts). */
  readonly styleFields: StyleFields;
  /** Styled layers' composite uniforms for an evaluation (512 bytes a slot). */
  private styleUniforms: GPUBuffer;
  /** Each styled layer's effects and tables on the GPU, by its node's key and its fields' plan. */
  private readonly styleData = new Map<string, { fx: GPUBuffer; tables: GPUBuffer; count: number }>();
  /** The patterns styles read, on the GPU, by what's in them (`packStyle`'s `patternKey`). */
  private readonly patternBuffers = new Map<string, GPUBuffer>();
  /** A styled layer's mask drawn alone (Layer Mask Hides Effects), as big as the biggest view. */
  private maskScratch: GPUTexture | null = null;
  private uniforms: GPUBuffer;
  /** Adjustments' masks' parameters for an evaluation, one slot each. */
  private maskUniforms: GPUBuffer;
  /** Blended layers' `BlendParams` for an evaluation, one slot each. */
  private blendUniforms: GPUBuffer;
  /** Where a blended layer is drawn alone before its blend pass, by format and size. */
  private scratch: GPUTexture | null = null;
  private readonly sampler: GPUSampler;
  private readonly blank: GPUTexture;
  /** Layers evaluated alone: filters and generators. */
  isolation!: Isolation;
  /** Resolves when every pipeline has compiled (the first picture's are there from the start). */
  ready: Promise<void>;
  private readonly emptyTable: GPUBuffer;
  private readonly layerGroups = new WeakMap<Drawable, { preview: GPUTexture | null; uniforms: GPUBuffer; group: GPUBindGroup }>();
  /** Each adjustment's parameters on the GPU, by its node's key (a node's parameters never change under its key). */
  private readonly adjustmentParams = new Map<string, { uniform: GPUBuffer; table: GPUBuffer | null; group: GPUBindGroup }>();

  private constructor(
    readonly ctx: RenderContext,
    readonly layouts: {
      layer: GPUBindGroupLayout;
      texture: GPUBindGroupLayout;
      textureUniform: GPUBindGroupLayout;
      params: GPUBindGroupLayout;
      quantize: GPUBindGroupLayout;
      mask: GPUBindGroupLayout;
      twoTextures: GPUBindGroupLayout;
      blendUniform: GPUBindGroupLayout;
      threeTextures: GPUBindGroupLayout;
      styleData: GPUBindGroupLayout;
    },
    pipelines: Pipelines,
    private readonly formats: readonly PlanFormat[],
    ready: Promise<void>,
  ) {
    this.pipelines = pipelines;
    this.ready = ready;
    const { device } = ctx;
    this.uniforms = device.createBuffer({ size: UNIFORM_STRIDE * 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    this.maskUniforms = device.createBuffer({ size: UNIFORM_STRIDE * 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    this.blendUniforms = device.createBuffer({ size: UNIFORM_STRIDE * 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    this.styleUniforms = device.createBuffer({ size: STYLE_SLOT * 8, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    this.styleFields = new StyleFields(device);
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
    const STORAGE: GPUBufferBindingLayout = { type: "read-only-storage" };
    const mask = device.createBindGroupLayout({
      label: "adjustment mask",
      entries: [
        { binding: 0, visibility: FRAG, buffer: STORAGE },
        { binding: 1, visibility: FRAG, buffer: STORAGE },
        { binding: 2, visibility: FRAG, buffer: { type: "uniform", hasDynamicOffset: true } },
      ],
    });
    const twoTextures = device.createBindGroupLayout({
      label: "below + drawn",
      entries: [
        { binding: 0, visibility: FRAG, texture: { sampleType: "unfilterable-float" } },
        { binding: 1, visibility: FRAG, texture: { sampleType: "unfilterable-float" } },
      ],
    });
    const blendUniform = device.createBindGroupLayout({ label: "blend", entries: [{ binding: 0, visibility: FRAG, buffer: { type: "uniform", hasDynamicOffset: true } }] });
    const threeTextures = device.createBindGroupLayout({
      label: "below + drawn + mask",
      entries: [0, 1, 2].map((binding) => ({ binding, visibility: FRAG, texture: { sampleType: "unfilterable-float" as const } })),
    });
    const READ: GPUBufferBindingLayout = { type: "read-only-storage" };
    const styleData = device.createBindGroupLayout({
      label: "style data",
      entries: [0, 1, 2, 3].map((binding) => ({ binding, visibility: FRAG, buffer: READ })),
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
    const blendPipelines = {} as Record<PlanFormat, GPURenderPipeline>;
    const stylePipelines = {} as Record<PlanFormat, GPURenderPipeline>;
    const decode = {} as Record<PlanFormat, GPURenderPipeline>;
    const reduce = {} as Record<PlanFormat, GPURenderPipeline>;
    const sample = {} as Record<PlanFormat, GPURenderPipeline>;
    const adjustment = new Map<string, GPURenderPipeline>();
    // What a first picture needs is compiled before the compositor is ready; the rest (f32 composites, adjustments,
    // refinement, 16-bit exports) compiles meanwhile, and `ready` says when it has.
    const [first, present, quantize8] = await Promise.all([
      render("layer rgba16float", LAYER, [ctx.kernels.atlasLayout, ctx.kernels.imageLayout, layerGroup, ctx.kernels.imageLayout], "rgba16float", true),
      render("present", PRESENT, [textureUniform], canvasFormat),
      compute("quantize 8", QUANTIZE(8)),
    ]);
    layer.rgba16float = first;
    const pipelines: Pipelines = { layer, blend: blendPipelines, style: stylePipelines, decode, adjustment, reduce, sample, present, quantize8, quantize16: null };
    const rest: Promise<unknown>[] = [compute("quantize 16", QUANTIZE(16)).then((p) => (pipelines.quantize16 = p))];
    for (const format of formats) {
      if (format !== "rgba16float") rest.push(render(`layer ${format}`, LAYER, [ctx.kernels.atlasLayout, ctx.kernels.imageLayout, layerGroup, ctx.kernels.imageLayout], format, true).then((p) => (layer[format] = p)));
      rest.push(
        render(`blend ${format}`, BLEND_PASS(format), [twoTextures, blendUniform], format).then((p) => (blendPipelines[format] = p)),
        render(`style ${format}`, STYLE_COMPOSITE(format), [threeTextures, blendUniform, styleData], format).then((p) => (stylePipelines[format] = p)),
        render(`decode ${format}`, DECODE(format), [texture], format).then((p) => (decode[format] = p)),
        render(`reduce ${format}`, REDUCE(format), [textureUniform], format).then((p) => (reduce[format] = p)),
        render(`sample ${format}`, SAMPLE(format), [textureUniform], format).then((p) => (sample[format] = p)),
        ...Object.entries(ADJUSTMENT_KERNELS).map(([type, kernel]) =>
          render(`${type} ${format}`, adjustmentShader(kernel, format, ADJUSTMENT_MASK), [texture, params, ctx.kernels.atlasLayout, mask], format).then((p) => adjustment.set(`${type}:${format}`, p)),
        ),
      );
    }
    const compositor = new Compositor(ctx, { layer: layerGroup, texture, textureUniform, params, quantize, mask, twoTextures, blendUniform, threeTextures, styleData }, pipelines, formats, Promise.resolve());
    const isolated = Isolation.create(compositor, formats, textureUniform);
    compositor.isolation = isolated.isolation;
    compositor.ready = Promise.all([...rest, isolated.ready]).then(() => {});
    return compositor;
  }

  /** Whether every pipeline `plan` needs has compiled (and, to refine it, the reduction's). */
  canEvaluate(plan: RenderPlan, refine = false): boolean {
    const p = this.pipelines;
    if (!p.layer[plan.format]) return false;
    if (refine && (!p.reduce[plan.format] || !p.sample[plan.format])) return false;
    if (plan.compositing === "photoshop" && !p.decode[plan.format]) return false;
    if (plan.nodes.some((n) => (n.kind !== "adjustment" && n.blend) || (isIsolated(n) && !fixedComposite(n, plan.compositing === "photoshop"))) && !p.blend[plan.format]) return false;
    if (plan.nodes.some((n) => isDrawNode(n) && n.style) && !p.style[plan.format]) return false;
    return plan.nodes.every((n) => {
      if (n.kind === "adjustment") return p.adjustment.has(`${n.type}:${plan.format}`);
      if (!isIsolated(n)) return true;
      return this.isolation.canEvaluate(n, plan.format) && (n.filters.length === 0 || !!p.reduce[plan.format]);
    });
  }

  /** Compilation errors of the compositor's modules (empty when they compile), for checks. */
  static async compileErrors(device: GPUDevice): Promise<string[]> {
    const modules: [string, string][] = [
      ["layer", LAYER],
      ["present", PRESENT],
      ["quantize 8", QUANTIZE(8)],
      ["quantize 16", QUANTIZE(16)],
      ...COMPOSITE_FORMATS.flatMap((f): [string, string][] => [
        [`blend ${f}`, BLEND_PASS(f)],
        [`style ${f}`, STYLE_COMPOSITE(f)],
        [`decode ${f}`, DECODE(f)],
        [`reduce ${f}`, REDUCE(f)],
        [`sample ${f}`, SAMPLE(f)],
        ...Object.entries(ADJUSTMENT_KERNELS).map(([type, k]): [string, string] => [`${type} ${f}`, adjustmentShader(k, f, ADJUSTMENT_MASK)]),
      ]),
      ...Isolation.modules(COMPOSITE_FORMATS),
    ];
    const errors: string[] = await StyleFields.compileErrors(device);
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

  private groupFor(source: Drawable) {
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
  evaluate(encoder: GPUCommandEncoder, plan: RenderPlan, view: View, quality: Quality, sources: PlanSources, work: WorkPair, options: EvaluateOptions = {}): GPUTexture {
    const { device } = this.ctx;
    const format = plan.format;
    const encoded = plan.compositing === "photoshop";
    const start = options.from?.index ?? 0;
    // Every layer this evaluation draws, its uniforms written once (one slot each); every adjustment's mask and
    // blending; every blended layer's blending.
    // A styled layer whose mask hides its effects is drawn unmasked, and its mask drawn alone as a second image.
    const images: { index: number; draw: LayerDraw; maskOnly?: true }[] = [];
    const masks: { index: number; node: AdjustmentNode; mask: Drawable | null }[] = [];
    const blends: { index: number; node: DrawNode | GeneratorNode }[] = [];
    const styled: { index: number; node: DrawNode; draw: LayerDraw }[] = [];
    for (let i = start; i < plan.nodes.length; i++) {
      const node = plan.nodes[i];
      if (node.kind === "adjustment") {
        masks.push({ index: i, node, mask: node.mask ? sources.mask(node) : null });
        continue;
      }
      const isolated = isIsolated(node);
      if (!isDrawNode(node)) {
        if (isolated && !fixedComposite(node, encoded)) blends.push({ index: i, node });
        continue;
      }
      const d = sources.draw(node);
      if (!d) continue;
      if (node.style) {
        // (An isolated layer's own entry isn't drawn: its content is its filters'.)
        const hides = node.style.maskHidesEffects && d.mask;
        images.push({ index: i, draw: hides ? { ...d, mask: null } : d });
        if (hides) images.push({ index: i, draw: { source: d.mask!, matrix: d.matrix, transform: d.transform, opacity: 1, mask: null }, maskOnly: true });
        styled.push({ index: i, node, draw: d });
        continue;
      }
      if (isolated) {
        if (!fixedComposite(node, encoded)) blends.push({ index: i, node });
        continue;
      }
      images.push({ index: i, draw: d });
      if (node.blend) blends.push({ index: i, node });
    }
    const grow = (buffer: GPUBuffer, slots: number) => {
      if (slots <= buffer.size / UNIFORM_STRIDE) return buffer;
      this.retire(buffer);
      return device.createBuffer({ size: UNIFORM_STRIDE * Math.ceil(slots * 1.5), usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    };
    this.uniforms = grow(this.uniforms, images.length);
    if (images.length) {
      const data = new ArrayBuffer(UNIFORM_STRIDE * images.length);
      images.forEach(({ index, draw: l, maskOnly }, i) => {
        const f = new Float32Array(data, i * UNIFORM_STRIDE, 20);
        const u = new Uint32Array(data, i * UNIFORM_STRIDE, 20);
        const inv = invert(l.matrix);
        // A blended or styled layer is drawn alone at full strength: its opacity is its pass's.
        const node = plan.nodes[index] as DrawNode;
        const opacity = node.blend || node.style ? 1 : l.opacity;
        f.set([inv[0], inv[2], inv[4], 0, inv[1], inv[3], inv[5], 0, view.x, view.y, view.zoom, opacity, l.source.width, l.source.height], 0);
        const scale = view.zoom * layerScale(l.transform);
        u[14] = levelForScale(scale, l.source.image.levels.length);
        u[15] = alignedLayer(l.matrix, view) ? 2 : quality === "final" ? 1 : 0;
        f[16] = scale;
        u[17] = l.source.preview ? 1 : 0;
        u[18] = l.mask ? 1 : 0;
        // A mask drawn alone is coverage, never encoded.
        u[19] = encoded && !maskOnly ? 1 : 0;
      });
      device.queue.writeBuffer(this.uniforms, 0, data);
    }
    const slotOf = new Map(images.flatMap((im, slot) => (im.maskOnly ? [] : [[im.index, { slot, draw: im.draw }] as const])));
    const maskOnlySlot = new Map(images.flatMap((im, slot) => (im.maskOnly ? [[im.index, { slot, draw: im.draw }] as const] : [])));
    // Adjustments' masks (where each reads its mask, at the view's level of it) and their blending.
    this.maskUniforms = grow(this.maskUniforms, masks.length);
    if (masks.length) {
      const data = new ArrayBuffer(UNIFORM_STRIDE * masks.length);
      masks.forEach(({ node, mask }, i) => {
        new Float32Array(data, i * UNIFORM_STRIDE, 3).set([view.x, view.y, view.zoom]);
        new Uint32Array(data, i * UNIFORM_STRIDE + 12, 2).set([mask ? levelForScale(view.zoom, mask.image.levels.length) : 0, mask ? 1 : 0]);
        packBlend(node.blend, node.opacity, plan.compositing, view, data, i * UNIFORM_STRIDE + 32);
      });
      device.queue.writeBuffer(this.maskUniforms, 0, data);
    }
    const maskSlot = new Map(masks.map((m, slot) => [m.index, { slot, mask: m.mask }]));
    this.blendUniforms = grow(this.blendUniforms, blends.length);
    if (blends.length) {
      const data = new ArrayBuffer(UNIFORM_STRIDE * blends.length);
      blends.forEach(({ node }, i) => {
        packBlend(node.blend, node.opacity, plan.compositing, view, data, i * UNIFORM_STRIDE);
        // Light blending in linear light in an encoded plan: the pass decodes what's below, blends, encodes.
        if (encoded && isIsolated(node) && blendsInLinear(node)) new Float32Array(data, i * UNIFORM_STRIDE + 44, 1)[0] = 1;
      });
      device.queue.writeBuffer(this.blendUniforms, 0, data);
    }
    const blendSlot = new Map(blends.map((b, slot) => [b.index, slot]));
    // Styled layers: their fields (made now if they aren't kept), effects and composite uniforms.
    if (styled.length * STYLE_SLOT > this.styleUniforms.size) {
      this.retire(this.styleUniforms);
      this.styleUniforms = device.createBuffer({ size: STYLE_SLOT * Math.ceil(styled.length * 1.5), usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    }
    const styleOf = new Map<number, { slot: number; fields: GPUBuffer; fx: GPUBuffer; tables: GPUBuffer; patterns: GPUBuffer }>();
    if (styled.length) {
      const data = new ArrayBuffer(STYLE_SLOT * styled.length);
      styled.forEach(({ index, node, draw }, slot) => {
        const fieldPlan = planFields(node, draw.source.image.levels.length);
        const content = node.kind === "image" ? `${node.mediaId}` : `${node.surface}`;
        const maskKey = node.style!.maskHidesEffects ? "" : `${node.mask?.surface ?? ""}`;
        const key = `${content}|${maskKey}|${node.size.width}x${node.size.height}|${fieldPlan.key}|${sources.revision?.(node) ?? ""}`;
        const set = this.styleFields.fields(encoder, fieldPlan, key, () => this.drawForFields(encoder, draw, node.style!.maskHidesEffects ? null : draw.mask, fieldPlan, format));
        const packed = packStyle(node, node.blend!, node.opacity, plan.compositing, fieldPlan, draw.matrix, view, sources.pattern);
        const dataKey = `${node.key}|${fieldPlan.key}|${packed.patternKey}`;
        let gpu = this.styleData.get(dataKey);
        let patterns = this.patternBuffers.get(packed.patternKey);
        if (!patterns) {
          patterns = device.createBuffer({ label: "style patterns", size: Math.max(16, packed.patterns.byteLength), usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
          device.queue.writeBuffer(patterns, 0, packed.patterns);
          this.patternBuffers.set(packed.patternKey, patterns);
          while (this.patternBuffers.size > 16) {
            const [oldest, old] = this.patternBuffers.entries().next().value!;
            this.patternBuffers.delete(oldest);
            void device.queue.onSubmittedWorkDone().then(() => old.destroy());
          }
        }
        if (!gpu) {
          const buffer = (bytes: ArrayBufferLike, label: string) => {
            const b = device.createBuffer({ label, size: Math.max(16, bytes.byteLength), usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
            device.queue.writeBuffer(b, 0, bytes);
            return b;
          };
          gpu = { fx: buffer(packed.fx, "style effects"), tables: buffer(packed.tables.buffer, "style tables"), count: packed.count };
          this.styleData.set(dataKey, gpu);
          while (this.styleData.size > 32) {
            const [oldest, old] = this.styleData.entries().next().value!;
            this.styleData.delete(oldest);
            void device.queue.onSubmittedWorkDone().then(() => {
              old.fx.destroy();
              old.tables.destroy();
            });
          }
        }
        new Uint8Array(data, slot * STYLE_SLOT, STYLE_UNIFORM_SIZE).set(new Uint8Array(packed.uniform));
        styleOf.set(index, { slot, fields: set.buffer, fx: gpu.fx, tables: gpu.tables, patterns });
      });
      device.queue.writeBuffer(this.styleUniforms, 0, data);
    }

    let current = work.a;
    let clear = true;
    if (options.from) {
      encoder.copyTextureToTexture({ texture: options.from.texture }, { texture: current }, [view.width, view.height]);
      clear = false;
      this.stats.resumed++;
    }
    const drawLayer = (pass: GPURenderPassEncoder, entry: { slot: number; draw: LayerDraw }) => {
      const l = entry.draw;
      l.source.image.flush();
      l.mask?.image.flush();
      pass.setBindGroup(0, l.source.ctx.atlasBindGroup());
      pass.setBindGroup(1, l.source.ctx.imageBindGroup(l.source.image));
      pass.setBindGroup(2, this.groupFor(l.source), [entry.slot * UNIFORM_STRIDE]);
      pass.setBindGroup(3, l.source.ctx.imageBindGroup(l.mask?.image ?? l.source.ctx.emptyImage));
      pass.draw(3);
      this.stats.imageDraws++;
    };
    // The style pass: a styled layer drawn alone (`drawn`, its mask alone in `maskTexture` when it hides the effects)
    // with its effects over what's below.
    const stylePass = (index: number, drawn: GPUTexture, maskTexture: GPUTexture) => {
      const style = styleOf.get(index)!;
      const next = current === work.a ? work.b : work.a;
      const pass = encoder.beginRenderPass({ colorAttachments: [{ view: next.createView(), loadOp: "clear", storeOp: "store", clearValue: [0, 0, 0, 0] }] });
      pass.setPipeline(this.pipelines.style[format]);
      pass.setBindGroup(
        0,
        device.createBindGroup({
          layout: this.layouts.threeTextures,
          entries: [
            { binding: 0, resource: current.createView() },
            { binding: 1, resource: drawn.createView() },
            { binding: 2, resource: maskTexture.createView() },
          ],
        }),
      );
      pass.setBindGroup(1, device.createBindGroup({ layout: this.layouts.blendUniform, entries: [{ binding: 0, resource: { buffer: this.styleUniforms, size: STYLE_UNIFORM_SIZE } }] }), [style.slot * STYLE_SLOT]);
      pass.setBindGroup(
        2,
        device.createBindGroup({
          layout: this.layouts.styleData,
          entries: [
            { binding: 0, resource: { buffer: style.fields } },
            { binding: 1, resource: { buffer: style.fx } },
            { binding: 2, resource: { buffer: style.tables } },
            { binding: 3, resource: { buffer: style.patterns } },
          ],
        }),
      );
      pass.setViewport(0, 0, view.width, view.height, 0, 1);
      pass.draw(3);
      pass.end();
      this.stats.stylePasses++;
      current = next;
    };
    // The blend pass: a layer drawn alone (`drawn`) over what's below by its blending.
    const blendPass = (index: number, drawn: GPUTexture) => {
      const next = current === work.a ? work.b : work.a;
      const pass = encoder.beginRenderPass({ colorAttachments: [{ view: next.createView(), loadOp: "clear", storeOp: "store", clearValue: [0, 0, 0, 0] }] });
      pass.setPipeline(this.pipelines.blend[format]);
      pass.setBindGroup(0, device.createBindGroup({ layout: this.layouts.twoTextures, entries: [{ binding: 0, resource: current.createView() }, { binding: 1, resource: drawn.createView() }] }));
      pass.setBindGroup(1, device.createBindGroup({ layout: this.layouts.blendUniform, entries: [{ binding: 0, resource: { buffer: this.blendUniforms, size: BLEND_PARAMS_SIZE } }] }), [blendSlot.get(index)! * UNIFORM_STRIDE]);
      pass.setViewport(0, 0, view.width, view.height, 0, 1);
      pass.draw(3);
      pass.end();
      this.stats.blendPasses++;
      current = next;
    };
    // A layer's mask drawn alone (Layer Mask Hides Effects), or `fallback`.
    const maskAlone = (index: number, fallback: GPUTexture) => {
      const maskEntry = maskOnlySlot.get(index);
      if (!maskEntry) return fallback;
      const maskTexture = this.maskScratchFor(format, view.width, view.height);
      const m = encoder.beginRenderPass({ colorAttachments: [{ view: maskTexture.createView(), loadOp: "clear", storeOp: "store", clearValue: [0, 0, 0, 0] }] });
      m.setPipeline(this.pipelines.layer[format]);
      m.setViewport(0, 0, view.width, view.height, 0, 1);
      drawLayer(m, maskEntry);
      m.end();
      return maskTexture;
    };
    let i = start;
    while (i < plan.nodes.length) {
      const node = plan.nodes[i];
      if (!needsPass(node)) {
        // A run of plain layers: one pass, each blended over the last by the GPU.
        const pass = encoder.beginRenderPass({
          colorAttachments: [{ view: current.createView(), loadOp: clear ? "clear" : "load", storeOp: "store", clearValue: plan.background }],
        });
        clear = false;
        pass.setPipeline(this.pipelines.layer[format]);
        while (i < plan.nodes.length && !needsPass(plan.nodes[i])) {
          const entry = slotOf.get(i);
          if (entry) drawLayer(pass, entry);
          i++;
        }
        pass.end();
        continue;
      }
      if (clear) {
        this.clear(encoder, current, plan.background);
        clear = false;
      }
      if (isIsolated(node)) {
        // Alone first (its filters, or a generator's content), then over what's below through its mask.
        const draw = isDrawNode(node) ? sources.draw(node) : null;
        const mask = isDrawNode(node) ? (draw?.mask ?? null) : node.mask ? sources.mask(node) : null;
        if (!((isDrawNode(node) && draw) || (node.kind === "generator" && (!node.mask || mask)))) {
          i++;
          continue;
        }
        const styled = isDrawNode(node) && node.style ? styleOf.get(i) : undefined;
        if (isDrawNode(node) && node.style && !styled) {
          i++;
          continue;
        }
        options.beforeAdjustment?.(i, current, encoder);
        const content = this.isolation.content(encoder, node, view, quality, sources, format);
        if (isDrawNode(node)) this.stats.imageDraws++;
        if (!content) {
          i++;
          continue;
        }
        if (fixedComposite(node, encoded)) {
          // Normal, or light added in linear light: the GPU's own blending, exactly.
          this.isolation.composite(encoder, node, content, current, view, mask, draw, format);
          i++;
          continue;
        }
        // Its content through its mask (not when the mask hides the effects), in the values it blends in, then the
        // style or blend pass.
        const hides = isDrawNode(node) && !!node.style?.maskHidesEffects && !!draw?.mask;
        const scratch = this.scratchFor(format, view.width, view.height);
        this.isolation.prepare(encoder, content, scratch, view, hides ? null : mask, draw, format, encoded && !blendsInLinear(node));
        if (styled) stylePass(i, scratch, maskAlone(i, scratch));
        else blendPass(i, scratch);
        i++;
        continue;
      }
      if (isDrawNode(node) && node.style) {
        const entry = slotOf.get(i);
        if (!entry || !styleOf.get(i)) {
          i++;
          continue;
        }
        options.beforeAdjustment?.(i, current, encoder);
        // The layer alone (and its mask alone, when it hides the effects), then the style pass.
        const scratch = this.scratchFor(format, view.width, view.height);
        const alone = encoder.beginRenderPass({ colorAttachments: [{ view: scratch.createView(), loadOp: "clear", storeOp: "store", clearValue: [0, 0, 0, 0] }] });
        alone.setPipeline(this.pipelines.layer[format]);
        alone.setViewport(0, 0, view.width, view.height, 0, 1);
        drawLayer(alone, entry);
        alone.end();
        stylePass(i, scratch, maskAlone(i, scratch));
        i++;
        continue;
      }
      if (node.kind !== "adjustment") {
        const entry = slotOf.get(i);
        if (!entry) {
          i++;
          continue;
        }
        options.beforeAdjustment?.(i, current, encoder);
        // The layer alone, then the blend pass reads it and what's below.
        const scratch = this.scratchFor(format, view.width, view.height);
        const alone = encoder.beginRenderPass({ colorAttachments: [{ view: scratch.createView(), loadOp: "clear", storeOp: "store", clearValue: [0, 0, 0, 0] }] });
        alone.setPipeline(this.pipelines.layer[format]);
        alone.setViewport(0, 0, view.width, view.height, 0, 1);
        drawLayer(alone, entry);
        alone.end();
        blendPass(i, scratch);
        i++;
        continue;
      }
      options.beforeAdjustment?.(i, current, encoder);
      const next = current === work.a ? work.b : work.a;
      const pass = encoder.beginRenderPass({ colorAttachments: [{ view: next.createView(), loadOp: "clear", storeOp: "store", clearValue: [0, 0, 0, 0] }] });
      pass.setPipeline(this.pipelines.adjustment.get(`${node.type}:${format}`)!);
      pass.setBindGroup(0, device.createBindGroup({ layout: this.layouts.texture, entries: [{ binding: 0, resource: current.createView() }] }));
      pass.setBindGroup(1, this.paramsFor(node).group);
      const m = maskSlot.get(i)!;
      const maskCtx = m.mask?.ctx ?? this.ctx;
      const maskImage = m.mask?.image ?? this.ctx.emptyImage;
      maskImage.flush();
      pass.setBindGroup(2, maskCtx.atlasBindGroup());
      pass.setBindGroup(
        3,
        device.createBindGroup({
          layout: this.layouts.mask,
          entries: [
            { binding: 0, resource: { buffer: maskImage.info } },
            { binding: 1, resource: { buffer: maskImage.pages } },
            { binding: 2, resource: { buffer: this.maskUniforms, size: ADJUSTMENT_UNIFORM } },
          ],
        }),
        [m.slot * UNIFORM_STRIDE],
      );
      pass.setViewport(0, 0, view.width, view.height, 0, 1);
      pass.draw(3);
      pass.end();
      this.stats.adjustmentPasses++;
      current = next;
      i++;
    }
    if (clear) this.clear(encoder, current, plan.background);
    if (!encoded) return current;
    // Encoded values back to linear light, for everything after the evaluator (the screen, refinement, exports).
    const linear = current === work.a ? work.b : work.a;
    const pass = encoder.beginRenderPass({ colorAttachments: [{ view: linear.createView(), loadOp: "clear", storeOp: "store", clearValue: [0, 0, 0, 0] }] });
    pass.setPipeline(this.pipelines.decode[format]);
    pass.setBindGroup(0, device.createBindGroup({ layout: this.layouts.texture, entries: [{ binding: 0, resource: current.createView() }] }));
    pass.setViewport(0, 0, view.width, view.height, 0, 1);
    pass.draw(3);
    pass.end();
    return linear;
  }

  /**
   * A buffer or texture replaced by a bigger one, destroyed once the GPU has done what was submitted with it: several
   * evaluations (the screen, a picture, a swatch) can be in flight between their submission and their work.
   */
  private retire(resource: GPUBuffer | GPUTexture) {
    void this.ctx.device.queue.onSubmittedWorkDone().then(() => setTimeout(() => resource.destroy(), 0));
  }

  /** The texture a styled layer's mask is drawn alone into (as large as the biggest view asked for). */
  private maskScratchFor(format: PlanFormat, width: number, height: number): GPUTexture {
    const s = this.maskScratch;
    if (s && s.format === format && s.width >= width && s.height >= height) return s;
    if (s) this.retire(s);
    this.maskScratch = compositeTexture(this.ctx.device, Math.max(width, s?.width ?? 0), Math.max(height, s?.height ?? 0), format, "style mask");
    return this.maskScratch;
  }

  /**
   * A layer drawn alone in its own pixels (at its fields' level, with their pad around it): what its effects' fields
   * are made from. A uniform buffer of its own: these are rare.
   */
  private drawForFields(encoder: GPUCommandEncoder, draw: LayerDraw, mask: Drawable | null, plan: { level: number; pad: number; width: number; height: number }, format: PlanFormat): GPUTexture {
    const { device } = this.ctx;
    const texture = compositeTexture(device, plan.width, plan.height, format, "style matte");
    const s = 2 ** plan.level;
    const view = { x: -plan.pad * s, y: -plan.pad * s, zoom: 1 / s, width: plan.width, height: plan.height };
    const uniform = device.createBuffer({ size: 80, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    const f = new Float32Array(20);
    const u = new Uint32Array(f.buffer);
    // In its own pixels: the identity place.
    f.set([1, 0, 0, 0, 0, 1, 0, 0, view.x, view.y, view.zoom, 1, draw.source.width, draw.source.height], 0);
    u[14] = levelForScale(view.zoom, draw.source.image.levels.length);
    u[15] = alignedLayer([1, 0, 0, 1, 0, 0], view) ? 2 : 1;
    f[16] = view.zoom;
    u[17] = draw.source.preview ? 1 : 0;
    u[18] = mask ? 1 : 0;
    u[19] = 0;
    device.queue.writeBuffer(uniform, 0, f);
    const group = device.createBindGroup({
      layout: this.layouts.layer,
      entries: [
        { binding: 0, resource: { buffer: uniform, size: 80 } },
        { binding: 1, resource: (draw.source.preview ?? this.blank).createView() },
        { binding: 2, resource: this.sampler },
      ],
    });
    draw.source.image.flush();
    mask?.image.flush();
    const pass = encoder.beginRenderPass({ colorAttachments: [{ view: texture.createView(), loadOp: "clear", storeOp: "store", clearValue: [0, 0, 0, 0] }] });
    pass.setPipeline(this.pipelines.layer[format]);
    pass.setBindGroup(0, draw.source.ctx.atlasBindGroup());
    pass.setBindGroup(1, draw.source.ctx.imageBindGroup(draw.source.image));
    pass.setBindGroup(2, group, [0]);
    pass.setBindGroup(3, draw.source.ctx.imageBindGroup(mask?.image ?? draw.source.ctx.emptyImage));
    pass.draw(3);
    pass.end();
    void device.queue.onSubmittedWorkDone().then(() => {
      texture.destroy();
      uniform.destroy();
    });
    return texture;
  }

  /** The scratch texture a blended layer is drawn alone into (as large as the biggest view asked for). */
  private scratchFor(format: PlanFormat, width: number, height: number): GPUTexture {
    const s = this.scratch;
    if (s && s.format === format && s.width >= width && s.height >= height) return s;
    if (s) this.retire(s);
    this.scratch = compositeTexture(this.ctx.device, Math.max(width, s?.width ?? 0), Math.max(height, s?.height ?? 0), format, "blend scratch");
    return this.scratch;
  }

  /**
   * One layer drawn alone into `target` (cleared to transparent) on `view`'s grid: an isolated layer's content, or a
   * filter's input at another level. Its uniforms are its own, so any number can be drawn in one encoder.
   */
  drawLayerAlone(encoder: GPUCommandEncoder, l: LayerDraw, view: View, quality: Quality, target: GPUTexture, format: PlanFormat) {
    const { device } = this.ctx;
    const data = new ArrayBuffer(80);
    const f = new Float32Array(data);
    const u = new Uint32Array(data);
    const inv = invert(l.matrix);
    f.set([inv[0], inv[2], inv[4], 0, inv[1], inv[3], inv[5], 0, view.x, view.y, view.zoom, l.opacity, l.source.width, l.source.height], 0);
    const scale = view.zoom * layerScale(l.transform);
    u[14] = levelForScale(scale, l.source.image.levels.length);
    u[15] = alignedLayer(l.matrix, view) ? 2 : quality === "final" ? 1 : 0;
    f[16] = scale;
    u[17] = l.source.preview ? 1 : 0;
    u[18] = l.mask ? 1 : 0;
    const uniform = device.createBuffer({ label: "layer alone", size: 80, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    device.queue.writeBuffer(uniform, 0, data);
    void device.queue.onSubmittedWorkDone().then(() => setTimeout(() => uniform.destroy(), 0));
    const group = device.createBindGroup({
      layout: this.layouts.layer,
      entries: [
        { binding: 0, resource: { buffer: uniform, size: 80 } },
        { binding: 1, resource: (l.source.preview ?? this.blank).createView() },
        { binding: 2, resource: this.sampler },
      ],
    });
    l.source.image.flush();
    l.mask?.image.flush();
    const pass = encoder.beginRenderPass({ colorAttachments: [{ view: target.createView(), loadOp: "clear", storeOp: "store", clearValue: [0, 0, 0, 0] }] });
    pass.setPipeline(this.pipelines.layer[format]);
    pass.setBindGroup(0, l.source.ctx.atlasBindGroup());
    pass.setBindGroup(1, l.source.ctx.imageBindGroup(l.source.image));
    pass.setBindGroup(2, group, [0]);
    pass.setBindGroup(3, l.source.ctx.imageBindGroup(l.mask?.image ?? l.source.ctx.emptyImage));
    pass.setViewport(0, 0, Math.max(1, Math.round(view.width)), Math.max(1, Math.round(view.height)), 0, 1);
    pass.draw(3);
    pass.end();
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

  /** Draws a composite on a canvas texture through the output transform (`uniform`: `Present`'s 48 bytes, `film` at byte 24). */
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
    this.isolation.destroy();
    this.uniforms.destroy();
    this.maskUniforms.destroy();
    this.blendUniforms.destroy();
    this.scratch?.destroy();
    this.maskScratch?.destroy();
    this.styleUniforms.destroy();
    this.styleFields.destroy();
    for (const b of this.patternBuffers.values()) b.destroy();
    for (const d of this.styleData.values()) {
      d.fx.destroy();
      d.tables.destroy();
    }
    this.blank.destroy();
    this.emptyTable.destroy();
    for (const p of this.adjustmentParams.values()) {
      p.uniform.destroy();
      p.table?.destroy();
    }
    this.adjustmentParams.clear();
  }
}
