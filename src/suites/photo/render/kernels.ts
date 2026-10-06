/**
 * The photo renderer's kernels: WGSL and their pipelines, made once per device and atlas format.
 *
 * - `convert`: a source tile's stored samples → linear premultiplied light (transfer LUT, then the profile's
 *   matrix), unclipped (rendering.md, "Getting sources in").
 * - `reduce`: a level's tile from four of the level below, a 2×2 box in linear premultiplied light.
 * - `blur`: a Gaussian through the page table (crossing tiles), and the same on one plain texture, so F0 can
 *   compare tiled against monolithic.
 * - `stamp`: brush dabs into draft tiles; `limit`: the selection capping a stroke's result.
 * - `maskFill`: a mask's tiles from a selection.
 * - `quantize`: the output transform to 8-bit RGBA (exports, the round-trip check).
 * - `view`: what the canvas shows (render pipeline).
 *
 * Kernels that read the atlas write a scratch texture, which is then copied into slots: a pass never reads and
 * writes the same texture.
 */
import { MAX_ARRAYS } from "./atlas.ts";
import { ATLAS, IMAGE_STRUCTS, MATHS, imageFunctions } from "./wgsl.ts";

export type StorageFormat = "rgba16float" | "rgba32float";

/**
 * Rounding to the nearest half before a store. Metal's f32 → f16 conversion in a storage write truncates (F0
 * measured every differing sample truncated: up to 0.08 of an 8-bit step after sRGB encoding, against 0.037 for
 * nearest), and \`quantizeToF16\` before the store is folded away by the compiler (measured too). So the mantissa
 * is rounded to its top 10 bits, ties to even, by integer arithmetic; the truncating store then keeps it exactly.
 * (Below f16's normal range it still truncates: an error under 6e-8.) f32 atlases store as they are.
 */
export const ROUND_FOR_STORE = (format: StorageFormat) =>
  format === "rgba16float"
    ? /* wgsl */ `
fn round_half(x: f32) -> f32 {
  let b = bitcast<u32>(x);
  if ((b & 0x7f800000u) == 0x7f800000u) { return x; }
  return bitcast<f32>((b + 0x0fffu + ((b >> 13u) & 1u)) & 0xffffe000u);
}
fn round_for_store(c: vec4f) -> vec4f { return vec4f(round_half(c.r), round_half(c.g), round_half(c.b), round_half(c.a)); }`
    : "fn round_for_store(c: vec4f) -> vec4f { return c; }";

const CONVERT = (format: StorageFormat) => /* wgsl */ `
${ROUND_FOR_STORE(format)}
struct Params { bits: u32, identity: u32, tile: u32, p0: u32, m0: vec4f, m1: vec4f, m2: vec4f }
@group(0) @binding(0) var<storage, read> raw: array<u32>;
@group(0) @binding(1) var<storage, read> lut: array<f32>;
@group(0) @binding(2) var<uniform> params: Params;
@group(0) @binding(3) var<storage, read> jobs: array<u32>;
@group(0) @binding(4) var out: texture_storage_2d_array<${format}, write>;

@compute @workgroup_size(16, 16)
fn main(@builtin(global_invocation_id) g: vec3u) {
  let tile = params.tile;
  if (g.x >= tile || g.y >= tile) { return; }
  let base = jobs[g.z];
  var code: vec4u;
  if (params.bits == 8u) {
    let w = raw[base + g.y * tile + g.x];
    code = vec4u(w & 255u, (w >> 8u) & 255u, (w >> 16u) & 255u, w >> 24u);
  } else {
    let i = base + (g.y * tile + g.x) * 2u;
    let w0 = raw[i];
    let w1 = raw[i + 1u];
    code = vec4u(w0 & 0xffffu, w0 >> 16u, w1 & 0xffffu, w1 >> 16u);
  }
  let n = 1u << params.bits;
  var rgb = vec3f(lut[code.r], lut[n + code.g], lut[2u * n + code.b]);
  if (params.identity == 0u) {
    rgb = vec3f(dot(params.m0.xyz, rgb), dot(params.m1.xyz, rgb), dot(params.m2.xyz, rgb));
  }
  let a = f32(code.a) / f32(n - 1u);
  let c = select(vec3f(0.0), rgb * a, a > 0.0);
  textureStore(out, vec2i(g.xy), i32(g.z), round_for_store(vec4f(c, a)));
}
`;

const REDUCE = (format: StorageFormat) => /* wgsl */ `
${ROUND_FOR_STORE(format)}
${ATLAS}
${IMAGE_STRUCTS}
${MATHS}
${imageFunctions("src", 1)}
@group(2) @binding(0) var<storage, read> jobs: array<vec4u>;
@group(2) @binding(1) var out: texture_storage_2d_array<${format}, write>;

@compute @workgroup_size(16, 16)
fn main(@builtin(global_invocation_id) g: vec3u) {
  let tile = img_src.tile;
  if (g.x >= tile || g.y >= tile) { return; }
  let job = jobs[g.z];
  let level = job.z;
  let x = i32(job.x * tile + g.x);
  let y = i32(job.y * tile + g.y);
  let dst = img_src.level[level];
  var c = vec4f(0.0);
  if (x < i32(dst.w) && y < i32(dst.h)) {
    let below = img_src.level[level - 1u];
    var n = 0.0;
    for (var dy = 0; dy < 2; dy++) {
      for (var dx = 0; dx < 2; dx++) {
        let sx = 2 * x + dx;
        let sy = 2 * y + dy;
        if (sx < i32(below.w) && sy < i32(below.h)) {
          c += texel_src(level - 1u, sx, sy);
          n += 1.0;
        }
      }
    }
    c /= n;
  }
  textureStore(out, vec2i(g.xy), i32(g.z), round_for_store(c));
}
`;

const GAUSSIAN = /* wgsl */ `
struct BlurParams { sigma: f32, radius: i32, tile: u32, p0: u32 }
fn gauss(d: i32, sigma: f32) -> f32 {
  let x = f32(d);
  return exp(-x * x / (2.0 * sigma * sigma));
}
fn gauss_norm(radius: i32, sigma: f32) -> f32 {
  var s = 0.0;
  for (var i = -radius; i <= radius; i++) { s += gauss(i, sigma); }
  return s * s;
}
`;

const BLUR_TILED = (format: StorageFormat) => /* wgsl */ `
${ROUND_FOR_STORE(format)}
${ATLAS}
${IMAGE_STRUCTS}
${MATHS}
${GAUSSIAN}
${imageFunctions("src", 1)}
@group(2) @binding(0) var<storage, read> jobs: array<vec4u>;
@group(2) @binding(1) var out: texture_storage_2d_array<${format}, write>;
@group(2) @binding(2) var<uniform> params: BlurParams;

@compute @workgroup_size(16, 16)
fn main(@builtin(global_invocation_id) g: vec3u) {
  let tile = params.tile;
  if (g.x >= tile || g.y >= tile) { return; }
  let job = jobs[g.z];
  let x = i32(job.x * tile + g.x);
  let y = i32(job.y * tile + g.y);
  var c = vec4f(0.0);
  for (var j = -params.radius; j <= params.radius; j++) {
    let wy = gauss(j, params.sigma);
    for (var i = -params.radius; i <= params.radius; i++) {
      c += texel_src(0u, x + i, y + j) * (wy * gauss(i, params.sigma));
    }
  }
  textureStore(out, vec2i(g.xy), i32(g.z), round_for_store(c / gauss_norm(params.radius, params.sigma)));
}
`;

const BLUR_MONO = /* wgsl */ `
${ROUND_FOR_STORE("rgba16float")}
${GAUSSIAN}
@group(0) @binding(0) var src: texture_2d<f32>;
@group(0) @binding(1) var out: texture_storage_2d<rgba16float, write>;
@group(0) @binding(2) var<uniform> params: BlurParams;

fn at(x: i32, y: i32) -> vec4f {
  let size = vec2i(textureDimensions(src));
  if (x < 0 || y < 0 || x >= size.x || y >= size.y) { return vec4f(0.0); }
  return textureLoad(src, vec2i(x, y), 0);
}

@compute @workgroup_size(16, 16)
fn main(@builtin(global_invocation_id) g: vec3u) {
  let size = textureDimensions(src);
  if (g.x >= size.x || g.y >= size.y) { return; }
  let x = i32(g.x);
  let y = i32(g.y);
  var c = vec4f(0.0);
  for (var j = -params.radius; j <= params.radius; j++) {
    let wy = gauss(j, params.sigma);
    for (var i = -params.radius; i <= params.radius; i++) {
      c += at(x + i, y + j) * (wy * gauss(i, params.sigma));
    }
  }
  textureStore(out, vec2i(g.xy), round_for_store(c / gauss_norm(params.radius, params.sigma)));
}
`;

/**
 * What a selection covers of a layer pixel (shared/photo/selection.ts's `layerPixelCoverage`): exact through a
 * layer at a right angle, 8 × 8 points across the pixel otherwise; 1 without a selection.
 */
const SELECTION = /* wgsl */ `
struct Dab { x: f32, y: f32, radius: f32, hardness: f32, strength: f32, p0: f32, p1: f32, p2: f32 }
struct Job { slot: u32, tx: i32, ty: i32, first: u32, count: u32, p0: u32, p1: u32, p2: u32 }
// m0, m1: layer pixels → document (a, b, c, d; e, f, right-angled); sel: x, y, width, height.
struct Params { colour: vec4f, tile: u32, hasSelection: u32, p0: u32, p1: u32, m0: vec4f, m1: vec4f, sel: vec4f }

fn to_doc(u: vec2f) -> vec2f {
  return vec2f(params.m0.x * u.x + params.m0.z * u.y + params.m1.x, params.m0.y * u.x + params.m0.w * u.y + params.m1.y);
}

fn box_coverage(lo: vec2f, hi: vec2f) -> f32 {
  let area = (hi.x - lo.x) * (hi.y - lo.y);
  if (area <= 0.0) { return 0.0; }
  let w = max(0.0, min(hi.x, params.sel.x + params.sel.z) - max(lo.x, params.sel.x));
  let h = max(0.0, min(hi.y, params.sel.y + params.sel.w) - max(lo.y, params.sel.y));
  return min(1.0, w * h / area);
}

fn selection_coverage(pixel: vec2i) -> f32 {
  if (params.hasSelection == 0u) { return 1.0; }
  let u = vec2f(pixel);
  if (params.m1.z > 0.5) {
    let p = to_doc(u);
    let q = to_doc(u + vec2f(1.0));
    return box_coverage(min(p, q), max(p, q));
  }
  var inside = 0.0;
  for (var j = 0; j < 8; j++) {
    for (var i = 0; i < 8; i++) {
      let p = to_doc(u + (vec2f(f32(i), f32(j)) + 0.5) / 8.0);
      if (p.x >= params.sel.x && p.x < params.sel.x + params.sel.z && p.y >= params.sel.y && p.y < params.sel.y + params.sel.w) { inside += 1.0; }
    }
  }
  return inside / 64.0;
}
`;

const STAMP = (format: StorageFormat) => /* wgsl */ `
${ROUND_FOR_STORE(format)}
${ATLAS}
${SELECTION}
@group(1) @binding(0) var<storage, read> jobs: array<Job>;
@group(1) @binding(1) var<storage, read> dabs: array<Dab>;
@group(1) @binding(2) var out: texture_storage_2d_array<${format}, write>;
@group(1) @binding(3) var<uniform> params: Params;

// shared/photo/brush.ts's dabCoverage.
fn coverage(d: Dab, distance: f32) -> f32 {
  let inner = d.radius * clamp(d.hardness, 0.0, 0.999);
  if (distance <= inner) { return d.strength; }
  if (distance >= d.radius) { return 0.0; }
  let t = (distance - inner) / (d.radius - inner);
  return d.strength * (1.0 - t * t * (3.0 - 2.0 * t));
}

@compute @workgroup_size(16, 16)
fn main(@builtin(global_invocation_id) g: vec3u) {
  let tile = params.tile;
  if (g.x >= tile || g.y >= tile) { return; }
  let job = jobs[g.z];
  var c = loadSlot(job.slot, vec2i(g.xy));
  let p = vec2f(f32(job.tx * i32(tile) + i32(g.x)), f32(job.ty * i32(tile) + i32(g.y))) + 0.5;
  for (var i = 0u; i < job.count; i++) {
    let d = dabs[job.first + i];
    let k = coverage(d, distance(p, vec2f(d.x, d.y)));
    c = params.colour * k + c * (1.0 - params.colour.a * k);
  }
  textureStore(out, vec2i(g.xy), i32(g.z), round_for_store(c));
}
`;

/**
 * The selection limiting a stroke (Photoshop's: it caps the stroke's result, not each dab, so a pixel half inside
 * gets half of whatever the stroke paints there): each pixel is what was there before the stroke (`first`: its
 * slot) mixed towards the stroke painted without limit (`slot`) by how much the selection covers it.
 */
const LIMIT = (format: StorageFormat) => /* wgsl */ `
${ROUND_FOR_STORE(format)}
${ATLAS}
${SELECTION}
@group(1) @binding(0) var<storage, read> jobs: array<Job>;
@group(1) @binding(1) var<storage, read> dabs: array<Dab>;
@group(1) @binding(2) var out: texture_storage_2d_array<${format}, write>;
@group(1) @binding(3) var<uniform> params: Params;

@compute @workgroup_size(16, 16)
fn main(@builtin(global_invocation_id) g: vec3u) {
  let tile = params.tile;
  if (g.x >= tile || g.y >= tile) { return; }
  let job = jobs[g.z];
  let before = loadSlot(job.first, vec2i(g.xy));
  let painted = loadSlot(job.slot, vec2i(g.xy));
  let k = selection_coverage(vec2i(job.tx * i32(tile) + i32(g.x), job.ty * i32(tile) + i32(g.y)));
  textureStore(out, vec2i(g.xy), i32(g.z), round_for_store(mix(before, painted, k)));
}
`;

/** A mask's tiles from a selection: each pixel's coverage, in every channel (masks are `r16f`; the GPU keeps RGBA). */
const MASK_FILL = (format: StorageFormat) => /* wgsl */ `
${ROUND_FOR_STORE(format)}
${SELECTION}
@group(0) @binding(0) var<storage, read> jobs: array<Job>;
@group(0) @binding(1) var out: texture_storage_2d_array<${format}, write>;
@group(0) @binding(2) var<uniform> params: Params;

@compute @workgroup_size(16, 16)
fn main(@builtin(global_invocation_id) g: vec3u) {
  let tile = params.tile;
  if (g.x >= tile || g.y >= tile) { return; }
  let job = jobs[g.z];
  let c = selection_coverage(vec2i(job.tx * i32(tile) + i32(g.x), job.ty * i32(tile) + i32(g.y)));
  textureStore(out, vec2i(g.xy), i32(g.z), round_for_store(vec4f(c)));
}
`;

const QUANTIZE = /* wgsl */ `
${ATLAS}
${IMAGE_STRUCTS}
${MATHS}
${imageFunctions("src", 1)}
${imageFunctions("paint", 2)}
struct Params { amplitude: f32, hasPaint: u32, tile: u32, p0: u32 }
@group(3) @binding(0) var<storage, read> jobs: array<vec2u>;
@group(3) @binding(1) var<storage, read_write> out: array<u32>;
@group(3) @binding(2) var<uniform> params: Params;

@compute @workgroup_size(16, 16)
fn main(@builtin(global_invocation_id) g: vec3u) {
  let tile = params.tile;
  if (g.x >= tile || g.y >= tile) { return; }
  let job = jobs[g.z];
  let x = job.x * tile + g.x;
  let y = job.y * tile + g.y;
  var c = texel_src(0u, i32(x), i32(y));
  if (params.hasPaint == 1u) {
    let p = texel_paint(0u, i32(x), i32(y));
    c = p + c * (1.0 - p.a);
  }
  let e = encode_pixel(c);
  let d = select(0.0, dither_at(x, y, params.amplitude), params.amplitude > 0.0);
  let q = vec3u(clamp(floor(e.rgb * 255.0 + d + 0.5), vec3f(0.0), vec3f(255.0)));
  let a = u32(floor(e.a * 255.0 + 0.5));
  out[(g.z * tile + g.y) * tile + g.x] = q.r | (q.g << 8u) | (q.b << 16u) | (a << 24u);
}
`;

const VIEW = /* wgsl */ `
${ATLAS}
${IMAGE_STRUCTS}
${MATHS}
${imageFunctions("src", 1)}
${imageFunctions("paint", 2)}
struct View {
  origin: vec2f,      // the document point at the canvas's top-left
  zoom: f32,          // device pixels per document pixel
  level: u32,         // the level to sample (levelForScale)
  bicubic: u32,       // 1: final quality (Mitchell), 0: bilinear
  hasPaint: u32,
  hasSource: u32,
  checker: f32,       // checkerboard square, device pixels
  amplitude: f32,     // dither, in 8-bit steps
  hasPreview: u32,
  p0: u32,
  p1: u32,
}
@group(3) @binding(0) var<uniform> view: View;
@group(3) @binding(1) var preview: texture_2d<f32>;
@group(3) @binding(2) var previewSampler: sampler;

@vertex
fn vs(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f {
  let p = vec2f(f32((i << 1u) & 2u), f32(i & 2u));
  return vec4f(p * 2.0 - 1.0, 0.0, 1.0);
}

// Bilinear at a level, texel centres at half-integers.
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

// Mitchell, stretched by s >= 1 when the view shows the level smaller than it is (so reducing never aliases).
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

fn source_at(doc: vec2f) -> vec4f {
  if (doc.x < 0.0 || doc.y < 0.0 || doc.x >= f32(img_src.width) || doc.y >= f32(img_src.height)) { return vec4f(0.0); }
  // The finest level at or coarser than the view's whose tile here is resident: the view refines as tiles arrive.
  var level = view.level;
  loop {
    let scale = exp2(-f32(level));
    let u = doc * scale;
    if (present_src(level, i32(u.x), i32(u.y))) {
      if (view.bicubic == 1u) { return bicubic(level, u, max(1.0, scale / view.zoom)); }
      return bilinear(level, u);
    }
    if (level + 1u >= img_src.levels) { break; }
    level += 1u;
  }
  if (view.hasPreview == 1u) {
    let p = textureSampleLevel(preview, previewSampler, doc / vec2f(f32(img_src.width), f32(img_src.height)), 0.0);
    return vec4f(p.rgb * p.a, p.a);
  }
  return vec4f(0.0);
}

fn paint_at(doc: vec2f) -> vec4f {
  let f = doc - 0.5;
  let i = vec2i(floor(f));
  let t = f - floor(f);
  let a = texel_paint(0u, i.x, i.y);
  let b = texel_paint(0u, i.x + 1, i.y);
  let c = texel_paint(0u, i.x, i.y + 1);
  let d = texel_paint(0u, i.x + 1, i.y + 1);
  return mix(mix(a, b, t.x), mix(c, d, t.x), t.y);
}

@fragment
fn fs(@builtin(position) pos: vec4f) -> @location(0) vec4f {
  let doc = view.origin + pos.xy / view.zoom;
  var c = vec4f(0.0);
  if (view.hasSource == 1u) { c = source_at(doc); }
  if (view.hasPaint == 1u) {
    let p = paint_at(doc);
    c = p + c * (1.0 - p.a);
  }
  // The checkerboard under transparency is UI: light greys, in linear light.
  let cell = vec2u(floor(pos.xy / view.checker));
  let grey = select(1.0, 0.6038, ((cell.x + cell.y) & 1u) == 1u);
  let inside = doc.x >= 0.0 && doc.y >= 0.0 && doc.x < f32(img_src.width) && doc.y < f32(img_src.height);
  let backdrop = select(vec3f(0.11, 0.115, 0.13), vec3f(grey * 0.8), inside);
  let shown = vec4f(c.rgb + backdrop * (1.0 - clamp(c.a, 0.0, 1.0)), 1.0);
  let e = encode_pixel(shown);
  let d = dither_at(u32(pos.x), u32(pos.y), view.amplitude) / 255.0;
  return vec4f(e.rgb + d, 1.0);
}
`;

const bgl = (device: GPUDevice, label: string, entries: GPUBindGroupLayoutEntry[]) => device.createBindGroupLayout({ label, entries });
const STAGES = GPUShaderStage.COMPUTE | GPUShaderStage.FRAGMENT;

/**
 * Every pipeline the renderer uses for one atlas format, and the bind group layouts they share. Made with the
 * async pipeline calls, so shaders compile when a session starts, not on the first open (F0 measured ~0.5 s).
 */
export class Kernels {
  readonly atlasLayout: GPUBindGroupLayout;
  readonly imageLayout: GPUBindGroupLayout;
  convert!: GPUComputePipeline;
  reduce!: GPUComputePipeline;
  blurTiled!: GPUComputePipeline;
  blurMono!: GPUComputePipeline;
  stamp!: GPUComputePipeline;
  limit!: GPUComputePipeline;
  maskFill!: GPUComputePipeline;
  quantize!: GPUComputePipeline;
  view!: GPURenderPipeline;
  /** Resolves when every pipeline has compiled. */
  readonly ready: Promise<void>;

  constructor(
    readonly device: GPUDevice,
    readonly format: StorageFormat,
    canvasFormat: GPUTextureFormat,
  ) {
    const unfilterable = (binding: number): GPUBindGroupLayoutEntry => ({
      binding,
      visibility: STAGES,
      texture: { sampleType: "unfilterable-float", viewDimension: "2d-array" },
    });
    this.atlasLayout = bgl(device, "atlas", [
      ...Array.from({ length: MAX_ARRAYS }, (_, i) => unfilterable(i)),
      { binding: MAX_ARRAYS, visibility: STAGES, buffer: { type: "uniform" } },
    ]);
    const readOnly = (binding: number): GPUBindGroupLayoutEntry => ({ binding, visibility: STAGES, buffer: { type: "read-only-storage" } });
    this.imageLayout = bgl(device, "image", [readOnly(0), readOnly(1)]);
    const storageArray = (binding: number): GPUBindGroupLayoutEntry => ({
      binding,
      visibility: GPUShaderStage.COMPUTE,
      storageTexture: { access: "write-only", format, viewDimension: "2d-array" },
    });
    const uniform = (binding: number): GPUBindGroupLayoutEntry => ({ binding, visibility: STAGES, buffer: { type: "uniform" } });

    const compute = (label: string, code: string, layouts: GPUBindGroupLayout[]) =>
      device.createComputePipelineAsync({
        label,
        layout: device.createPipelineLayout({ bindGroupLayouts: layouts }),
        compute: { module: device.createShaderModule({ label, code }), entryPoint: "main" },
      });

    const jobsOut = bgl(device, "jobs+out", [readOnly(0), storageArray(1)]);
    const stampLayout = bgl(device, "stamp", [readOnly(0), readOnly(1), storageArray(2), uniform(3)]);
    const viewModule = device.createShaderModule({ label: "view", code: VIEW });
    this.ready = Promise.all([
      compute("convert", CONVERT(format), [bgl(device, "convert", [readOnly(0), readOnly(1), uniform(2), readOnly(3), storageArray(4)])]).then((p) => (this.convert = p)),
      compute("reduce", REDUCE(format), [this.atlasLayout, this.imageLayout, jobsOut]).then((p) => (this.reduce = p)),
      compute("blur tiled", BLUR_TILED(format), [this.atlasLayout, this.imageLayout, bgl(device, "blur", [readOnly(0), storageArray(1), uniform(2)])]).then((p) => (this.blurTiled = p)),
      compute("blur mono", BLUR_MONO, [
        bgl(device, "blur mono", [
          { binding: 0, visibility: GPUShaderStage.COMPUTE, texture: { sampleType: "unfilterable-float" } },
          { binding: 1, visibility: GPUShaderStage.COMPUTE, storageTexture: { access: "write-only", format: "rgba16float" } },
          uniform(2),
        ]),
      ]).then((p) => (this.blurMono = p)),
      compute("stamp", STAMP(format), [this.atlasLayout, stampLayout]).then((p) => (this.stamp = p)),
      compute("limit", LIMIT(format), [this.atlasLayout, stampLayout]).then((p) => (this.limit = p)),
      compute("mask fill", MASK_FILL(format), [bgl(device, "mask fill", [readOnly(0), storageArray(1), uniform(2)])]).then((p) => (this.maskFill = p)),
      compute("quantize", QUANTIZE, [
        this.atlasLayout,
        this.imageLayout,
        this.imageLayout,
        bgl(device, "quantize", [readOnly(0), { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: "storage" } }, uniform(2)]),
      ]).then((p) => (this.quantize = p)),
      device.createRenderPipelineAsync({
        label: "view",
        layout: device.createPipelineLayout({
          bindGroupLayouts: [
            this.atlasLayout,
            this.imageLayout,
            this.imageLayout,
            bgl(device, "view", [
              { binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: { type: "uniform" } },
              { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: "float" } },
              { binding: 2, visibility: GPUShaderStage.FRAGMENT, sampler: { type: "filtering" } },
            ]),
          ],
        }),
        vertex: { module: viewModule, entryPoint: "vs" },
        fragment: { module: viewModule, entryPoint: "fs", targets: [{ format: canvasFormat }] },
        primitive: { topology: "triangle-list" },
      }).then((p) => (this.view = p)),
    ]).then(() => {});
  }

  /** Compilation errors of every module, for the lab and the checks (empty when all compiled). */
  static async compileErrors(device: GPUDevice, format: StorageFormat): Promise<string[]> {
    const sources: [string, string][] = [
      ["convert", CONVERT(format)],
      ["reduce", REDUCE(format)],
      ["blur tiled", BLUR_TILED(format)],
      ["blur mono", BLUR_MONO],
      ["stamp", STAMP(format)],
      ["limit", LIMIT(format)],
      ["mask fill", MASK_FILL(format)],
      ["quantize", QUANTIZE],
      ["view", VIEW],
    ];
    const errors: string[] = [];
    for (const [label, code] of sources) {
      const info = await device.createShaderModule({ label, code }).getCompilationInfo();
      for (const m of info.messages) if (m.type === "error") errors.push(`${label}:${m.lineNum}: ${m.message}`);
    }
    return errors;
  }
}
