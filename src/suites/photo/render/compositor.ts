/**
 * The document's evaluator (docs/photo/rendering.md, "The render plan"): every visible layer drawn, bottom to top,
 * into a float accumulator through its own transform, premultiplied source-over. The screen, exports, Home's cover
 * and the assistant's pictures all render through `render`, at different views: what's seen is what exports.
 *
 * A layer is resampled from its source: Mitchell at final quality (stretched when the view reduces it, so reducing
 * never aliases), bilinear while the view moves, and read texel for texel when its pixels land exactly on the
 * view's (scale ±1, right angles, whole-pixel offsets), so an unedited photo exports bit for bit.
 */
import { type View, levelForScale } from "@shared/photo/geometry.ts";
import { type Affine, invert, layerScale } from "@shared/photo/layers.ts";
import type { LayerTransform } from "@shared/photo/types.ts";
import type { RenderContext } from "./context.ts";
import type { SourceImage } from "./source.ts";
import { ATLAS, IMAGE_STRUCTS, MATHS, imageFunctions } from "./wgsl.ts";

export const ACCUMULATOR_FORMAT = "rgba16float";

export type Quality = "interactive" | "final";

/** One layer to draw: its source on the GPU, where it goes, how opaque. */
export interface LayerDraw {
  source: SourceImage;
  /** Layer pixels → document pixels. */
  matrix: Affine;
  transform: LayerTransform;
  opacity: number;
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
fn vs(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f {
  let p = vec2f(f32((i << 1u) & 2u), f32(i & 2u));
  return vec4f(p * 2.0 - 1.0, 0.0, 1.0);
}

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

/** The accumulator onto the canvas element: the canvas's area over the checkerboard, the pasteboard around it. */
const PRESENT = /* wgsl */ `
${MATHS}
struct Present { canvas: vec4f, checker: f32, amplitude: f32, p0: f32, p1: f32, pasteboard: vec4f }
@group(0) @binding(0) var accumulated: texture_2d<f32>;
@group(0) @binding(1) var<uniform> present: Present;

@vertex
fn vs(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f {
  let p = vec2f(f32((i << 1u) & 2u), f32(i & 2u));
  return vec4f(p * 2.0 - 1.0, 0.0, 1.0);
}

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
 * An accumulated region through the output transform into 8-bit RGBA (exports, pictures): dithered by document
 * pixel, optionally over a matte (JPEG) or the checkerboard (pictures for the assistant).
 */
const QUANTIZE = /* wgsl */ `
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
  let x = params.origin.x + g.x;
  let y = params.origin.y + g.y;
  let d = select(0.0, dither_at(x, y, params.amplitude), params.amplitude > 0.0);
  let q = vec3u(clamp(floor(e.rgb * 255.0 + d + 0.5), vec3f(0.0), vec3f(255.0)));
  let alpha = u32(floor(e.a * 255.0 + 0.5));
  out[g.y * params.size.x + g.x] = q.r | (q.g << 8u) | (q.b << 16u) | (alpha << 24u);
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

export class Compositor {
  readonly layerPipeline: GPURenderPipeline;
  readonly presentPipeline: GPURenderPipeline;
  readonly quantizePipeline: GPUComputePipeline;
  private uniforms: GPUBuffer;
  private readonly sampler: GPUSampler;
  private readonly blank: GPUTexture;
  private readonly layerGroups = new WeakMap<SourceImage, { preview: GPUTexture | null; uniforms: GPUBuffer; group: GPUBindGroup }>();

  private constructor(
    readonly ctx: RenderContext,
    pipelines: { layer: GPURenderPipeline; present: GPURenderPipeline; quantize: GPUComputePipeline },
  ) {
    this.layerPipeline = pipelines.layer;
    this.presentPipeline = pipelines.present;
    this.quantizePipeline = pipelines.quantize;
    const { device } = ctx;
    this.uniforms = device.createBuffer({ size: UNIFORM_STRIDE * 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    this.sampler = device.createSampler({ magFilter: "linear", minFilter: "linear" });
    this.blank = device.createTexture({ size: [1, 1], format: "rgba8unorm-srgb", usage: GPUTextureUsage.TEXTURE_BINDING });
  }

  /** A compositor whose pipelines have compiled (the canvas format is the screen's). */
  static async create(ctx: RenderContext, canvasFormat: GPUTextureFormat): Promise<Compositor> {
    const { device } = ctx;
    const blend: GPUBlendState = {
      color: { srcFactor: "one", dstFactor: "one-minus-src-alpha", operation: "add" },
      alpha: { srcFactor: "one", dstFactor: "one-minus-src-alpha", operation: "add" },
    };
    const layerGroup = device.createBindGroupLayout({
      label: "layer",
      entries: [
        { binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: { type: "uniform", hasDynamicOffset: true } },
        { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: "float" } },
        { binding: 2, visibility: GPUShaderStage.FRAGMENT, sampler: { type: "filtering" } },
      ],
    });
    const layerModule = device.createShaderModule({ label: "layer", code: LAYER });
    const presentModule = device.createShaderModule({ label: "present", code: PRESENT });
    const [layer, present, quantize] = await Promise.all([
      device.createRenderPipelineAsync({
        label: "layer",
        layout: device.createPipelineLayout({ bindGroupLayouts: [ctx.kernels.atlasLayout, ctx.kernels.imageLayout, layerGroup] }),
        vertex: { module: layerModule, entryPoint: "vs" },
        fragment: { module: layerModule, entryPoint: "fs", targets: [{ format: ACCUMULATOR_FORMAT, blend }] },
        primitive: { topology: "triangle-list" },
      }),
      device.createRenderPipelineAsync({
        label: "present",
        layout: "auto",
        vertex: { module: presentModule, entryPoint: "vs" },
        fragment: { module: presentModule, entryPoint: "fs", targets: [{ format: canvasFormat }] },
        primitive: { topology: "triangle-list" },
      }),
      device.createComputePipelineAsync({ label: "quantize region", layout: "auto", compute: { module: device.createShaderModule({ label: "quantize region", code: QUANTIZE }), entryPoint: "main" } }),
    ]);
    return new Compositor(ctx, { layer, present, quantize });
  }

  /** Compilation errors of the compositor's modules (empty when they compile), for checks. */
  static async compileErrors(device: GPUDevice): Promise<string[]> {
    const errors: string[] = [];
    for (const [label, code] of [["layer", LAYER], ["present", PRESENT], ["quantize region", QUANTIZE]] as const) {
      const info = await device.createShaderModule({ label, code }).getCompilationInfo();
      for (const m of info.messages) if (m.type === "error") errors.push(`${label}:${m.lineNum}: ${m.message}`);
    }
    return errors;
  }

  private groupFor(source: SourceImage) {
    let entry = this.layerGroups.get(source);
    if (!entry || entry.preview !== source.preview || entry.uniforms !== this.uniforms) {
      entry = {
        preview: source.preview,
        uniforms: this.uniforms,
        group: this.ctx.device.createBindGroup({
          layout: this.layerPipeline.getBindGroupLayout(2),
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

  /**
   * Draws `layers` (bottom to top) into `target`, an accumulator of `view.width` × `view.height`, cleared to
   * `clear` (the canvas's background, premultiplied linear, or transparent) first.
   */
  render(encoder: GPUCommandEncoder, target: GPUTextureView, view: View, layers: readonly LayerDraw[], clear: readonly [number, number, number, number], quality: Quality) {
    const { device } = this.ctx;
    if (layers.length > this.uniforms.size / UNIFORM_STRIDE) {
      this.uniforms.destroy();
      this.uniforms = device.createBuffer({ size: UNIFORM_STRIDE * Math.ceil(layers.length * 1.5), usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    }
    const data = new ArrayBuffer(UNIFORM_STRIDE * Math.max(1, layers.length));
    layers.forEach((l, i) => {
      const f = new Float32Array(data, i * UNIFORM_STRIDE, 20);
      const u = new Uint32Array(data, i * UNIFORM_STRIDE, 20);
      const inv = invert(l.matrix);
      f.set([inv[0], inv[2], inv[4], 0, inv[1], inv[3], inv[5], 0, view.x, view.y, view.zoom, l.opacity, l.source.layout.width, l.source.layout.height], 0);
      const scale = view.zoom * layerScale(l.transform);
      const level = levelForScale(scale, l.source.image.levels.length);
      u[14] = level;
      u[15] = alignedLayer(l.matrix, view) ? 2 : quality === "final" ? 1 : 0;
      f[16] = scale;
      u[17] = l.source.preview ? 1 : 0;
    });
    device.queue.writeBuffer(this.uniforms, 0, data);
    const pass = encoder.beginRenderPass({ colorAttachments: [{ view: target, loadOp: "clear", storeOp: "store", clearValue: [...clear] }] });
    pass.setPipeline(this.layerPipeline);
    layers.forEach((l, i) => {
      l.source.image.flush();
      pass.setBindGroup(0, l.source.ctx.atlasBindGroup());
      pass.setBindGroup(1, l.source.ctx.imageBindGroup(l.source.image));
      pass.setBindGroup(2, this.groupFor(l.source), [i * UNIFORM_STRIDE]);
      pass.draw(3);
    });
    pass.end();
  }

  destroy() {
    this.uniforms.destroy();
    this.blank.destroy();
  }
}
