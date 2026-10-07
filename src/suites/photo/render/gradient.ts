/**
 * The Gradient tool on the GPU (docs/photo/tools/gradient.md): a Gradient Fill generator's pass (its content at every
 * target pixel's document point, as the flare's) and the Classic gradient's kernel, which paints the same gradient
 * into a surface's tiles: a layer's pixels mixed as the photo mixes its layers, or a mask's greys. Both are
 * `shared/photo/reference/gradient.ts`'s arithmetic, reading the same table (the gradient sampled at
 * `GRADIENT_FILL_TABLE` points), and are tested against it.
 */
import type { GradientFillShape } from "@shared/photo/effects/gradient";
import { GRADIENT_TYPES } from "@shared/photo/effects/gradient";
import { fillTable } from "@shared/photo/reference/gradient";
import type { GradientPaint } from "@shared/photo/reference/gradient";
import type { Affine } from "@shared/photo/layers";
import type { BlendMode } from "@shared/photo/types";
import { BLEND, BLEND_STRUCT, packBlend } from "./blend.ts";
import type { RenderContext } from "./context.ts";
import { ROUND_FOR_STORE, type StorageFormat } from "./kernels.ts";
import { ATLAS, MATHS } from "./wgsl.ts";

/**
 * The line and how it's read (`gradientT`, `gradientDither`), and the table (`tableAt`): what both passes share. The
 * table is the storage buffer `gradient_table`, bound by whoever includes this.
 */
const GRADIENT = /* wgsl */ `
struct GradientLine { start: vec2f, end: vec2f, style: u32, dither: u32, size: u32, p0: u32 }

// shared/photo/effects/gradient.ts's gradientT (the overlay's gradientPosition on the tool's line).
fn gradient_t(g: GradientLine, p: vec2f) -> f32 {
  let d = g.end - g.start;
  if (d.x == 0.0 && d.y == 0.0) { return 1.0; }
  var c = g.start;
  var r = d;
  if (g.style == 0u) { c = (g.start + g.end) * 0.5; r = d * 0.5; }
  let q = p - c;
  let rr = dot(r, r);
  let along = dot(q, r) / rr;
  switch (g.style) {
    case 1u: { return min(1.0, length(q) / sqrt(rr)); }
    case 2u: {
      let a0 = atan2(-r.y, r.x);
      let a = atan2(-q.y, q.x);
      let t = (a - a0) / 6.283185307179586;
      return t - floor(t);
    }
    case 3u: { return min(1.0, abs(along)); }
    case 4u: {
      let across = (q.x * -r.y + q.y * r.x) / rr;
      return min(1.0, abs(along) + abs(across));
    }
    default: { return clamp(0.5 + along * 0.5, 0.0, 1.0); }
  }
}

// reference/gradient.ts's tableAt.
fn table_at(size: u32, t: f32) -> vec4f {
  let f = clamp(t, 0.0, 1.0) * f32(size - 1u);
  let i = min(size - 2u, u32(floor(f)));
  let k = f - f32(i);
  return gradient_table[i] * (1.0 - k) + gradient_table[i + 1u] * k;
}

// reference/gradient.ts's gradientColourAt: straight encoded colour and opacity, with Dither's offset (gradientDither).
fn gradient_colour(g: GradientLine, p: vec2f) -> vec4f {
  let c = table_at(g.size, gradient_t(g, p));
  var d = 0.0;
  if (g.dither == 1u) {
    let px = bitcast<vec2u>(vec2i(floor(p)));
    let a = f32(hash2(px.x, px.y ^ 0x9e3779b9u) >> 8u) / 16777216.0;
    let b = f32(hash2(px.x, px.y ^ 0x85ebca6bu) >> 8u) / 16777216.0;
    d = (a + b - 1.0) / 255.0;
  }
  return clamp(c + vec4f(d, d, d, 0.0), vec4f(0.0), vec4f(1.0));
}
`;

/** A shape's line as `GradientLine` (32 bytes) at `offset` of `into`. */
function packLine(shape: GradientFillShape, size: number, into: ArrayBuffer, offset: number) {
  new Float32Array(into, offset, 4).set([...shape.start, ...shape.end]);
  new Uint32Array(into, offset + 16, 4).set([GRADIENT_TYPES.indexOf(shape.style), shape.dither ? 1 : 0, size, 0]);
}

// --- the Gradient Fill generator ---

/** The generator's uniform (48 bytes: the target's grid, then its line) and its table. */
export function packGradientFill(shape: GradientFillShape, view: { x: number; y: number; zoom: number }): { uniform: ArrayBuffer; table: Float32Array } {
  const table = fillTable(shape);
  const uniform = new ArrayBuffer(48);
  new Float32Array(uniform, 0, 3).set([view.x, view.y, view.zoom]);
  packLine(shape, table.length / 4, uniform, 16);
  return { uniform, table };
}

/**
 * The generator's pass: group 0 is its uniform and its table (the flare's layout: a uniform and a storage buffer).
 * Premultiplied linear light, its opacity its coverage.
 */
export const GRADIENT_FILL_SHADER = (format: StorageFormat) => /* wgsl */ `
${ROUND_FOR_STORE(format)}
${MATHS}
struct Params { origin: vec2f, zoom: f32, p0: u32, line: GradientLine }
@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var<storage, read> gradient_table: array<vec4f>;
${GRADIENT}

@vertex
fn vs(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f { return full_screen(i); }

@fragment
fn fs(@builtin(position) pos: vec4f) -> @location(0) vec4f {
  let p = params.origin + pos.xy / params.zoom;
  let c = gradient_colour(params.line, p);
  let rgb = vec3f(srgb_to_linear(c.r), srgb_to_linear(c.g), srgb_to_linear(c.b));
  return round_for_store(vec4f(rgb * c.a, c.a));
}
`;

// --- the Classic gradient, painted into a surface's tiles ---

/** Painting modes past the blend modes: what `PaintParams.paint` says. */
const PAINT_MODES: Record<string, number> = { behind: 1, clear: 2 };

/**
 * The Classic kernel: for every texel of a job's tile, its document point (the surface's matrix), the gradient there
 * and the tile as it was before the stroke (`first`), mixed as `reference/gradient.ts`'s `paintPixel` (pixels, in the
 * photo's compositing) or `paintMask` (a mask's grey) mixes them, into scratch layer j. The stroke's limit pass then
 * mixes that with the tile as it was by the selection's coverage.
 */
const GRADIENT_PAINT = (format: StorageFormat) => /* wgsl */ `
${ROUND_FOR_STORE(format)}
${ATLAS}
${MATHS}
${BLEND_STRUCT}
${BLEND}
struct Job { slot: u32, tx: i32, ty: i32, first: u32, count: u32, p0: u32, p1: u32, p2: u32 }
// m0, m1: surface pixels → document (a, b, c, d; e, f); mask: 1 for a mask's values; paint: 0 the blend mode, 1
// Behind, 2 Clear; opacity: the options bar's (the blend's own is 1 for Behind, which mixes it first).
struct PaintParams { m0: vec4f, m1: vec4f, line: GradientLine, tile: u32, mask: u32, paint: u32, opacity: f32 }
@group(1) @binding(0) var<storage, read> jobs: array<Job>;
@group(1) @binding(1) var out: texture_storage_2d_array<${format}, write>;
@group(1) @binding(2) var<uniform> params: PaintParams;
@group(1) @binding(3) var<storage, read> gradient_table: array<vec4f>;
@group(1) @binding(4) var<uniform> blend: BlendParams;
${GRADIENT}

fn to_doc(u: vec2f) -> vec2f {
  return vec2f(params.m0.x * u.x + params.m0.z * u.y + params.m1.x, params.m0.y * u.x + params.m0.w * u.y + params.m1.y);
}

fn lin(c: vec4f) -> vec4f {
  return vec4f(srgb_to_linear(c.r) * c.a, srgb_to_linear(c.g) * c.a, srgb_to_linear(c.b) * c.a, c.a);
}

// reference/blend.ts's compositePixel, from premultiplied linear and back: the plan's domain is converted here.
fn composite_linear(base: vec4f, layer: vec4f, doc: vec2f) -> vec4f {
  if (blend.encoded == 1u) { return premult_decode(composite_pixel(blend, premult_encode(base), premult_encode(layer), doc)); }
  return composite_pixel(blend, base, layer, doc);
}

@compute @workgroup_size(16, 16)
fn main(@builtin(global_invocation_id) g: vec3u) {
  let tile = params.tile;
  if (g.x >= tile || g.y >= tile) { return; }
  let job = jobs[g.z];
  let base = loadSlot(job.first, vec2i(g.xy));
  let u = vec2f(f32(job.tx * i32(tile) + i32(g.x)), f32(job.ty * i32(tile) + i32(g.y))) + 0.5;
  let doc = to_doc(u);
  let c = gradient_colour(params.line, doc);
  let a = c.a;
  var result = base;
  if (params.mask == 1u) {
    let v = base.r;
    if (params.paint == 2u) { result = vec4f(v * (1.0 - a * params.opacity)); }
    else if (params.paint == 0u) {
      let grey = 0.299 * c.r + 0.587 * c.g + 0.114 * c.b;
      result = vec4f(composite_pixel(blend, vec4f(v, v, v, 1.0), vec4f(grey * a, grey * a, grey * a, a), floor(doc)).r);
    }
  } else {
    let layer = lin(c);
    if (params.paint == 2u) { result = base * (1.0 - a * params.opacity); }
    else if (params.paint == 1u) {
      // Behind: what's there over the gradient (at Normal, Opacity on the gradient).
      result = composite_linear(layer * params.opacity, base, floor(doc));
    } else { result = composite_linear(base, layer, floor(doc)); }
  }
  textureStore(out, vec2i(g.xy), i32(g.z), round_for_store(result));
}
`;

const pipelines = new WeakMap<RenderContext, GPUComputePipeline>();

/** The Classic kernel's pipeline for a context, made the first time it's asked for. */
function paintPipeline(ctx: RenderContext): GPUComputePipeline {
  let p = pipelines.get(ctx);
  if (!p) {
    const { device } = ctx;
    const COMPUTE = GPUShaderStage.COMPUTE;
    const layout = device.createBindGroupLayout({
      label: "gradient paint",
      entries: [
        { binding: 0, visibility: COMPUTE, buffer: { type: "read-only-storage" } },
        { binding: 1, visibility: COMPUTE, storageTexture: { access: "write-only", format: ctx.format, viewDimension: "2d-array" } },
        { binding: 2, visibility: COMPUTE, buffer: { type: "uniform" } },
        { binding: 3, visibility: COMPUTE, buffer: { type: "read-only-storage" } },
        { binding: 4, visibility: COMPUTE, buffer: { type: "uniform" } },
      ],
    });
    p = device.createComputePipeline({
      label: "gradient paint",
      layout: device.createPipelineLayout({ bindGroupLayouts: [ctx.kernels.atlasLayout, layout] }),
      compute: { module: device.createShaderModule({ label: "gradient paint", code: GRADIENT_PAINT(ctx.format) }), entryPoint: "main" },
    });
    pipelines.set(ctx, p);
  }
  return p;
}

/** WGSL modules, for compilation checks (`checks.ts`-style: every module compiles). */
export const gradientModules = (format: StorageFormat): [string, string][] => [
  [`gradient fill ${format}`, GRADIENT_FILL_SHADER(format)],
  [`gradient paint ${format}`, GRADIENT_PAINT(format)],
];

/** A buffer for this submission only (destroyed once the GPU is done with it). */
function transient(device: GPUDevice, data: ArrayBuffer | Float32Array, usage: number, label: string): GPUBuffer {
  const buffer = device.createBuffer({ label, size: Math.max(16, Math.ceil(data.byteLength / 16) * 16), usage: usage | GPUBufferUsage.COPY_DST });
  device.queue.writeBuffer(buffer, 0, data);
  void device.queue.onSubmittedWorkDone().then(() => setTimeout(() => buffer.destroy(), 0));
  return buffer;
}

/** What a tile stroke's painter is handed (`SurfaceImage.paintTiles`): its context, its kind and where it is. */
export interface TileTarget {
  ctx: RenderContext;
  kind: "pixels" | "mask";
  matrix: Affine;
}

/**
 * A painter for `SurfaceImage.paintTiles`: the Classic gradient `shape` painted with `paint` (its mode, opacity and
 * the photo's compositing) into the jobs' tiles, written to the scratch texture's layers.
 */
export function gradientPainter(shape: GradientFillShape, paint: GradientPaint) {
  const table = fillTable(shape);
  return (encoder: GPUCommandEncoder, jobs: GPUBuffer, count: number, target: TileTarget) => {
    const { ctx } = target;
    const { device } = ctx;
    const uniform = new ArrayBuffer(80);
    const m = target.matrix;
    new Float32Array(uniform, 0, 8).set([m[0], m[1], m[2], m[3], m[4], m[5], 0, 0]);
    packLine(shape, table.length / 4, uniform, 32);
    new Uint32Array(uniform, 64, 3).set([ctx.tile, target.kind === "mask" ? 1 : 0, PAINT_MODES[paint.mode] ?? 0]);
    new Float32Array(uniform, 76, 1)[0] = paint.opacity;
    const mode: BlendMode = paint.mode === "behind" || paint.mode === "clear" ? "normal" : paint.mode;
    // Dissolve's speckle in document pixels (zoom 1), seeded as the reference's (0).
    const blend = packBlend({ mode, fill: 1, channels: { r: true, g: true, b: true }, blendIf: {}, seed: 0 }, paint.mode === "behind" ? 1 : paint.opacity, target.kind === "mask" ? "linear" : paint.compositing, { x: 0, y: 0, zoom: 1 });
    const pipeline = paintPipeline(ctx);
    const group = device.createBindGroup({
      layout: pipeline.getBindGroupLayout(1),
      entries: [
        { binding: 0, resource: { buffer: jobs } },
        { binding: 1, resource: ctx.scratchView },
        { binding: 2, resource: { buffer: transient(device, uniform, GPUBufferUsage.UNIFORM, "gradient paint") } },
        { binding: 3, resource: { buffer: transient(device, table, GPUBufferUsage.STORAGE, "gradient table") } },
        { binding: 4, resource: { buffer: transient(device, blend, GPUBufferUsage.UNIFORM, "gradient blend") } },
      ],
    });
    const pass = encoder.beginComputePass({ label: "gradient paint" });
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, ctx.atlasBindGroup());
    pass.setBindGroup(1, group);
    pass.dispatchWorkgroups(ctx.tile / 16, ctx.tile / 16, count);
    pass.end();
  };
}
