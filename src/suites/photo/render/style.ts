/**
 * Layer effects on the GPU (docs/photo/layer-style/README.md, phase L2): the same steps as the CPU reference
 * `shared/photo/reference/style.ts`, which they're tested against.
 *
 * Fields are made in the layer's own pixels (at a level of its pyramid when it's large), once for its content and
 * the effects' sizes, and kept: moving or zooming never makes them again, and colour, opacity, mode or a contour
 * only re-runs the composite. The layer is drawn alone into a texture there, its alpha taken, an exact Euclidean
 * distance transform (Felzenszwalb and Huttenlocher's, a line per thread) gives the signed distance to its edge,
 * and Softer's tents are box blurs of fractional width by moving sums. The composite pass then reads them at each
 * view pixel through the layer's transform.
 */
import { BLEND, BLEND_PARAMS_SIZE, BLEND_STRUCT, modeIndex, packBlend } from "./blend.ts";
import { CONTOUR_TABLE_SIZE, contourTable } from "@shared/photo/style/contours.ts";
import { styleDefinition } from "@shared/photo/style/definitions.ts";
import { GRADIENT_TABLE_SIZE, type GradientStyle, gradientLayout, gradientTable } from "@shared/photo/style/gradients.ts";
import { shadowOffset } from "@shared/photo/reference/style.ts";
import { type Affine, invert, layerScale } from "@shared/photo/layers.ts";
import type { DrawNode, NodeBlend, PlanFormat } from "@shared/photo/render-plan.ts";
import type { BlendMode, Compositing, Contour, EffectInstance, Gradient } from "@shared/photo/types.ts";
import { ROUND_FOR_STORE } from "./kernels.ts";
import { MATHS } from "./wgsl.ts";

/** The largest side of a layer's fields: a bigger layer's are made from a level of its pyramid. */
export const MAX_FIELD_SIDE = 3072;

/** The effects' kinds in the shaders: their place in the drawing order. */
const KINDS = ["drop-shadow", "outer-glow", "gradient-overlay", "color-overlay", "inner-glow", "inner-shadow", "stroke"];
const STYLE_CODES: Record<string, number> = { linear: 0, radial: 1, angle: 2, reflected: 3, diamond: 4, "shape-burst": 5 };
const POSITION_CODES: Record<string, number> = { outside: 0, inside: 1, center: 2 };

/** One Softer field to make: from the matte (or its inverse), grown by `grow`, blurred over `width` (field pixels). */
interface SofterJob {
  inner: boolean;
  grow: number;
  width: number;
}

/** What a layer's fields are made from and how big they are. */
export interface FieldPlan {
  /** The pyramid level the layer is drawn at (its pixels / 2^level). */
  level: number;
  /** Field pixels around the layer. */
  pad: number;
  width: number;
  height: number;
  /** Document pixels per field pixel. */
  scale: number;
  jobs: SofterJob[];
  /** By effect id: its Softer field (1..), or 0 for none (it reads the signed distance). */
  fieldOf: Record<string, number>;
  key: string;
}

/** The fields a styled layer needs: its level, pad, size and Softer jobs (equal ones made once). */
export function planFields(node: DrawNode, levels: number): FieldPlan {
  const style = node.style!;
  const { width: w, height: h } = node.size;
  let level = 0;
  while (level < levels - 1 && Math.max(w, h) / 2 ** level > MAX_FIELD_SIDE) level++;
  const scale = layerScale(node.transform) * 2 ** level;
  // Around the layer: as far as an effect's falloff or stroke reaches (a shadow's offset is read, not padded).
  const reach = Math.max(0, ...style.effects.map((e) => ((e.params.size as number) ?? 0) + 4));
  const pad = Math.ceil(Math.min(reach, 512 * scale) / scale) + 3;
  const jobs: SofterJob[] = [];
  const fieldOf: Record<string, number> = {};
  for (const e of style.effects) {
    const p = e.params;
    const inner = e.type === "inner-glow" || e.type === "inner-shadow";
    const softer = e.type === "drop-shadow" || e.type === "inner-shadow" || ((e.type === "outer-glow" || e.type === "inner-glow") && p.technique === "softer");
    if (!softer) {
      fieldOf[e.id] = 0;
      continue;
    }
    const size = p.size as number;
    const grow = Math.round(size * ((inner ? (p.choke as number) : (p.spread as number)) / 100));
    const job = { inner, grow: grow / scale, width: (size - grow) / scale };
    let at = jobs.findIndex((j) => j.inner === job.inner && j.grow === job.grow && j.width === job.width);
    if (at < 0) at = jobs.push(job) - 1;
    fieldOf[e.id] = at + 1;
  }
  const width = Math.ceil(w / 2 ** level) + 2 * pad;
  const height = Math.ceil(h / 2 ** level) + 2 * pad;
  return { level, pad, width, height, scale, jobs, fieldOf, key: `${level}|${pad}|${width}x${height}|${scale}|${JSON.stringify(jobs)}|${style.maskHidesEffects}` };
}

const FIELDS = /* wgsl */ `
const INF: f32 = 1e20;
struct P {
  w: u32, h: u32, axis: u32, kind: u32,     // kind: the EDT's seeds (0 inside, 1 outside); the box's source (0 scratch, 1 matte, 2 grown)
  src: u32, dst: u32, toFields: u32, field: u32,
  width: f32, edge: f32, grow: f32, sign: f32,
  a: u32, r: u32, t1: u32, t2: u32,
}
@group(0) @binding(0) var<storage, read_write> scratch: array<f32>;
@group(0) @binding(1) var<storage, read_write> fields: array<f32>;
@group(0) @binding(2) var<storage, read_write> ev: array<i32>;
@group(0) @binding(3) var<storage, read_write> ez: array<f32>;
@group(0) @binding(4) var<uniform> p: P;
@group(0) @binding(5) var layerTex: texture_2d<f32>;

fn n_px() -> u32 { return p.w * p.h; }

@compute @workgroup_size(8, 8)
fn alpha(@builtin(global_invocation_id) g: vec3u) {
  if (g.x >= p.w || g.y >= p.h) { return; }
  scratch[p.a + g.y * p.w + g.x] = clamp(textureLoad(layerTex, vec2i(g.xy), 0).a, 0.0, 1.0);
}

fn line_index(line: u32, q: u32) -> u32 { return select(q * p.w + line, line * p.w + q, p.axis == 0u); }

// The line's values: seeds from the alpha along rows, the rows' squared distances along columns.
fn fval(line: u32, q: u32) -> f32 {
  let i = line_index(line, q);
  if (p.axis == 0u) {
    let inside = scratch[p.a + i] >= 0.5;
    return select(INF, 0.0, select(!inside, inside, p.kind == 0u));
  }
  return scratch[p.src + i];
}

@compute @workgroup_size(64)
fn edt(@builtin(global_invocation_id) g: vec3u) {
  let line = g.x;
  let lines = select(p.w, p.h, p.axis == 0u);
  if (line >= lines) { return; }
  let n = select(p.h, p.w, p.axis == 0u);
  let vb = line * (n + 1u);
  let zb = line * (n + 2u);
  var k = 0u;
  ev[vb] = 0;
  ez[zb] = -INF;
  ez[zb + 1u] = INF;
  for (var q = 1u; q < n; q++) {
    let fq = fval(line, q) + f32(q * q);
    var vk = u32(ev[vb + k]);
    var s = (fq - (fval(line, vk) + f32(vk * vk))) / (2.0 * f32(q) - 2.0 * f32(vk));
    // Parabolas the new one hides are dropped (z[0] is −∞, so this stops at the first).
    while (k > 0u && s <= ez[zb + k]) {
      k -= 1u;
      vk = u32(ev[vb + k]);
      s = (fq - (fval(line, vk) + f32(vk * vk))) / (2.0 * f32(q) - 2.0 * f32(vk));
    }
    k += 1u;
    ev[vb + k] = i32(q);
    ez[zb + k] = s;
    ez[zb + k + 1u] = INF;
  }
  k = 0u;
  for (var q = 0u; q < n; q++) {
    while (ez[zb + k + 1u] < f32(q)) { k += 1u; }
    let vk = u32(ev[vb + k]);
    let d = f32(q) - f32(vk);
    scratch[p.dst + line_index(line, q)] = d * d + fval(line, vk);
  }
}

@compute @workgroup_size(8, 8)
fn signed(@builtin(global_invocation_id) g: vec3u) {
  if (g.x >= p.w || g.y >= p.h) { return; }
  let i = g.y * p.w + g.x;
  let a = scratch[p.a + i];
  var sd: f32;
  if (a > 0.0 && a < 1.0) { sd = 0.5 - a; }
  else if (a < 0.5) { sd = min(sqrt(scratch[p.t1 + i]), 1e9) - 0.5; }
  else { sd = -(min(sqrt(scratch[p.t2 + i]), 1e9) - 0.5); }
  fields[i] = sd;
}

fn read_box(line: u32, q: u32) -> f32 {
  let i = line_index(line, q);
  if (p.kind == 1u) {
    let a = scratch[p.a + i];
    return select(a, 1.0 - a, p.sign < 0.0);
  }
  if (p.kind == 2u) { return clamp(0.5 - (fields[i] * p.sign - p.grow), 0.0, 1.0); }
  return scratch[p.src + i];
}

fn write_box(line: u32, q: u32, v: f32) {
  let i = line_index(line, q);
  if (p.toFields == 1u) { fields[p.field * n_px() + i] = v; } else { scratch[p.dst + i] = v; }
}

// A box of fractional width along each line: two moving sums, the line constant across a pixel and \`edge\` beyond.
@compute @workgroup_size(64)
fn box(@builtin(global_invocation_id) g: vec3u) {
  let line = g.x;
  let lines = select(p.w, p.h, p.axis == 0u);
  if (line >= lines) { return; }
  let n = select(p.h, p.w, p.axis == 0u);
  if (p.width <= 1e-6) {
    for (var q = 0u; q < n; q++) { write_box(line, q, read_box(line, q)); }
    return;
  }
  let half = p.width * 0.5;
  var j0 = 0u;
  var s0 = 0.0;
  var j1 = 0u;
  var s1 = 0.0;
  for (var q = 0u; q < n; q++) {
    let t1 = f32(q) + 0.5 + half;
    let t0 = f32(q) + 0.5 - half;
    while (j1 < n && f32(j1 + 1u) <= t1) { s1 += read_box(line, j1); j1 += 1u; }
    while (j0 < n && f32(j0 + 1u) <= t0) { s0 += read_box(line, j0); j0 += 1u; }
    var i1 = s1 + (t1 - f32(j1)) * p.edge;
    if (t1 <= 0.0) { i1 = t1 * p.edge; } else if (j1 < n) { i1 = s1 + (t1 - f32(j1)) * read_box(line, j1); }
    var i0 = s0 + (t0 - f32(j0)) * p.edge;
    if (t0 <= 0.0) { i0 = t0 * p.edge; } else if (j0 < n) { i0 = s0 + (t0 - f32(j0)) * read_box(line, j0); }
    write_box(line, q, (i1 - i0) / p.width);
  }
}
`;

const PARAMS_STRIDE = 256;

/** A layer's fields on the GPU: the signed distance (field 0) and its Softer fields, each `width` × `height`. */
export interface FieldSet {
  plan: FieldPlan;
  buffer: GPUBuffer;
  key: string;
}

/** Makes and keeps layers' fields (a few at a time, the least recently used going first). */
export class StyleFields {
  private readonly pipelines: { alpha: GPUComputePipeline; edt: GPUComputePipeline; signed: GPUComputePipeline; box: GPUComputePipeline };
  private readonly layout: GPUBindGroupLayout;
  private scratch: GPUBuffer | null = null;
  private ev: GPUBuffer | null = null;
  private ez: GPUBuffer | null = null;
  private params: GPUBuffer;
  private readonly kept = new Map<string, FieldSet>();
  /** Fields made (counted: the tests check that a colour change makes none). */
  made = 0;

  constructor(private readonly device: GPUDevice) {
    const STORAGE: GPUBufferBindingLayout = { type: "storage" };
    this.layout = device.createBindGroupLayout({
      label: "style fields",
      entries: [
        { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: STORAGE },
        { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: STORAGE },
        { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: STORAGE },
        { binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: STORAGE },
        { binding: 4, visibility: GPUShaderStage.COMPUTE, buffer: { type: "uniform", hasDynamicOffset: true } },
        { binding: 5, visibility: GPUShaderStage.COMPUTE, texture: { sampleType: "unfilterable-float" } },
      ],
    });
    const module = device.createShaderModule({ label: "style fields", code: FIELDS });
    const pipeline = (entryPoint: string) => device.createComputePipeline({ label: `style ${entryPoint}`, layout: device.createPipelineLayout({ bindGroupLayouts: [this.layout] }), compute: { module, entryPoint } });
    this.pipelines = { alpha: pipeline("alpha"), edt: pipeline("edt"), signed: pipeline("signed"), box: pipeline("box") };
    this.params = device.createBuffer({ size: PARAMS_STRIDE * 64, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  }

  static compileErrors = async (device: GPUDevice) => {
    const info = await device.createShaderModule({ code: FIELDS }).getCompilationInfo();
    return info.messages.filter((m) => m.type === "error").map((m) => `style fields:${m.lineNum}: ${m.message}`);
  };

  /** The fields for `plan` and this content (`key`), made now (from the layer drawn into `drawn`) if they aren't kept. */
  fields(encoder: GPUCommandEncoder, plan: FieldPlan, key: string, drawn: () => GPUTexture): FieldSet {
    const kept = this.kept.get(key);
    if (kept) {
      this.kept.delete(key);
      this.kept.set(key, kept);
      return kept;
    }
    const { device } = this;
    const { width: w, height: h } = plan;
    const n = w * h;
    const scratchSize = 4 * n * 4;
    if (!this.scratch || this.scratch.size < scratchSize) {
      this.scratch?.destroy();
      this.scratch = device.createBuffer({ label: "style scratch", size: scratchSize, usage: GPUBufferUsage.STORAGE });
    }
    const edtSize = (Math.max(w, h) + 2) * (Math.max(w, h) + 2) * 4;
    if (!this.ev || this.ev.size < edtSize) {
      this.ev?.destroy();
      this.ez?.destroy();
      this.ev = device.createBuffer({ label: "edt v", size: edtSize, usage: GPUBufferUsage.STORAGE });
      this.ez = device.createBuffer({ label: "edt z", size: edtSize, usage: GPUBufferUsage.STORAGE });
    }
    const count = 6 + 4 * plan.jobs.length;
    if (count * PARAMS_STRIDE > this.params.size) {
      this.params.destroy();
      this.params = device.createBuffer({ size: PARAMS_STRIDE * count * 2, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    }
    const buffer = device.createBuffer({ label: "style fields", size: Math.max(4, (1 + plan.jobs.length) * n * 4), usage: GPUBufferUsage.STORAGE });
    const texture = drawn();
    const group = device.createBindGroup({
      layout: this.layout,
      entries: [
        { binding: 0, resource: { buffer: this.scratch } },
        { binding: 1, resource: { buffer } },
        { binding: 2, resource: { buffer: this.ev } },
        { binding: 3, resource: { buffer: this.ez! } },
        { binding: 4, resource: { buffer: this.params, size: 64 } },
        { binding: 5, resource: texture.createView() },
      ],
    });
    // Regions of the scratch: the alpha, the rows' distances, and two more.
    const A = 0;
    const R = n;
    const T1 = 2 * n;
    const T2 = 3 * n;
    const passes: { pipeline: GPUComputePipeline; params: number[]; groups: [number, number] }[] = [];
    const lines = (axis: number) => Math.ceil((axis === 0 ? h : w) / 64);
    const pixels: [number, number] = [Math.ceil(w / 8), Math.ceil(h / 8)];
    // [w, h, axis, kind, src, dst, toFields, field, width, edge, grow, sign, a, r, t1, t2]
    const P = (axis: number, kind: number, src: number, dst: number, toFields: number, field: number, width = 0, edge = 0, grow = 0, sign = 1) => [w, h, axis, kind, src, dst, toFields, field, width, edge, grow, sign, A, R, T1, T2];
    passes.push({ pipeline: this.pipelines.alpha, params: P(0, 0, 0, 0, 0, 0), groups: pixels });
    passes.push({ pipeline: this.pipelines.edt, params: P(0, 0, 0, R, 0, 0), groups: [lines(0), 1] });
    passes.push({ pipeline: this.pipelines.edt, params: P(1, 0, R, T1, 0, 0), groups: [lines(1), 1] });
    passes.push({ pipeline: this.pipelines.edt, params: P(0, 1, 0, R, 0, 0), groups: [lines(0), 1] });
    passes.push({ pipeline: this.pipelines.edt, params: P(1, 1, R, T2, 0, 0), groups: [lines(1), 1] });
    passes.push({ pipeline: this.pipelines.signed, params: P(0, 0, 0, 0, 0, 0), groups: pixels });
    plan.jobs.forEach((job, j) => {
      const edge = job.inner ? 1 : 0;
      const sign = job.inner ? -1 : 1;
      const first = job.grow > 0 ? 2 : 1;
      // Rows twice, then columns twice: Softer's tent.
      passes.push({ pipeline: this.pipelines.box, params: P(0, first, 0, T1, 0, 0, job.width, edge, job.grow, sign), groups: [lines(0), 1] });
      passes.push({ pipeline: this.pipelines.box, params: P(0, 0, T1, T2, 0, 0, job.width, edge, 0, sign), groups: [lines(0), 1] });
      passes.push({ pipeline: this.pipelines.box, params: P(1, 0, T2, T1, 0, 0, job.width, edge, 0, sign), groups: [lines(1), 1] });
      passes.push({ pipeline: this.pipelines.box, params: P(1, 0, T1, 0, 1, j + 1, job.width, edge, 0, sign), groups: [lines(1), 1] });
    });
    const data = new ArrayBuffer(PARAMS_STRIDE * passes.length);
    passes.forEach((pass, i) => {
      const u = new Uint32Array(data, i * PARAMS_STRIDE, 16);
      const f = new Float32Array(data, i * PARAMS_STRIDE, 16);
      const v = pass.params;
      u.set(v.slice(0, 8), 0);
      f.set(v.slice(8, 12), 8);
      u.set(v.slice(12, 16), 12);
    });
    device.queue.writeBuffer(this.params, 0, data);
    const compute = encoder.beginComputePass({ label: "style fields" });
    passes.forEach((pass, i) => {
      compute.setPipeline(pass.pipeline);
      compute.setBindGroup(0, group, [i * PARAMS_STRIDE]);
      compute.dispatchWorkgroups(pass.groups[0], pass.groups[1]);
    });
    compute.end();
    this.made++;
    const set = { plan, buffer, key };
    this.kept.set(key, set);
    let bytes = 0;
    for (const s of this.kept.values()) bytes += s.buffer.size;
    while (this.kept.size > 1 && (this.kept.size > 8 || bytes > 512 * 1024 ** 2)) {
      const [oldest, old] = this.kept.entries().next().value!;
      this.kept.delete(oldest);
      bytes -= old.buffer.size;
      void device.queue.onSubmittedWorkDone().then(() => old.buffer.destroy());
    }
    return set;
  }

  destroy() {
    for (const s of this.kept.values()) s.buffer.destroy();
    this.kept.clear();
    this.scratch?.destroy();
    this.ev?.destroy();
    this.ez?.destroy();
    this.params.destroy();
  }
}

/** One effect as the composite reads it (112 bytes). */
const FX_SIZE = 112;
/** The composite's uniform: the layer's place, the fields', flags, then its `BlendParams`. */
export const STYLE_UNIFORM_SIZE = 96 + BLEND_PARAMS_SIZE;

export const STYLE_COMPOSITE = (format: PlanFormat) => /* wgsl */ `
${ROUND_FOR_STORE(format)}
${MATHS}
${BLEND_STRUCT}
${BLEND}
struct Fx {
  kind: u32, mode: u32, field: i32, flags: u32,      // flags: 1 precise, 2 inner, 4 centre, 8 gradient, 16 outer
  colour: vec4f,                                      // straight, encoded
  opacity: f32, size: f32, spread: f32, range: f32,   // size in field pixels
  noise: f32, jitter: f32, contour: u32, gradient: i32,
  offset: vec2f, position: u32, style: u32,           // offset in document pixels; the stroke's position; a gradient's style
  place: vec4f,                                       // a gradient's centre and vector, document pixels
  extra: vec4f,                                       // a stroke's size and its band's start (document pixels)
}
struct SU {
  inv0: vec4f, inv1: vec4f,
  origin: vec2f, zoom: f32, count: u32,
  field: vec4f,                                       // width, height, pad, 2^level
  sdScale: f32, flags: u32, gradients: u32, p0: u32,  // flags: 1 interior as group, 2 mask hides effects
  p1: vec4f,
  blend: BlendParams,
}
@group(0) @binding(0) var below: texture_2d<f32>;
@group(0) @binding(1) var drawn: texture_2d<f32>;
@group(0) @binding(2) var maskTex: texture_2d<f32>;
@group(1) @binding(0) var<uniform> su: SU;
@group(2) @binding(0) var<storage, read> fields: array<f32>;
@group(2) @binding(1) var<storage, read> fxs: array<Fx>;
@group(2) @binding(2) var<storage, read> tables: array<f32>;

@vertex
fn vs(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f { return full_screen(i); }

fn texel(fi: i32, x: i32, y: i32, edge: f32) -> f32 {
  let w = i32(su.field.x);
  let h = i32(su.field.y);
  if (x < 0 || y < 0 || x >= w || y >= h) { return edge; }
  return fields[u32(fi) * u32(w * h) + u32(y * w + x)];
}
fn bil(fi: i32, f: vec2f, edge: f32) -> f32 {
  let g = f - 0.5;
  let i = vec2i(floor(g));
  let t = g - floor(g);
  return mix(mix(texel(fi, i.x, i.y, edge), texel(fi, i.x + 1, i.y, edge), t.x), mix(texel(fi, i.x, i.y + 1, edge), texel(fi, i.x + 1, i.y + 1, edge), t.x), t.y);
}
fn sd_at(f: vec2f) -> f32 { return bil(0, f, 1e9); }
fn to_field(doc: vec2f) -> vec2f {
  let u = vec2f(dot(su.inv0.xy, doc) + su.inv0.z, dot(su.inv1.xy, doc) + su.inv1.z);
  return u / su.field.w + su.field.z;
}
fn noise_at(f: vec2f, salt: u32) -> f32 {
  let c = bitcast<vec2u>(vec2i(floor(f)));
  return f32(hash2(c.x, c.y ^ salt) >> 8u) / 16777216.0;
}
fn contour(row: u32, x: f32) -> f32 {
  let n = ${CONTOUR_TABLE_SIZE}u;
  let t = clamp(x, 0.0, 1.0) * f32(n - 1u);
  let i = min(u32(floor(t)), n - 1u);
  let j = min(i + 1u, n - 1u);
  return mix(tables[row * n + i], tables[row * n + j], t - f32(i));
}
fn gradient(row: i32, x: f32) -> vec4f {
  let n = ${GRADIENT_TABLE_SIZE}u;
  let t = clamp(x, 0.0, 1.0) * f32(n - 1u);
  let i = min(u32(floor(t)), n - 1u);
  let j = min(i + 1u, n - 1u);
  let b = su.gradients + u32(row) * n * 4u;
  let a = vec4f(tables[b + i * 4u], tables[b + i * 4u + 1u], tables[b + i * 4u + 2u], tables[b + i * 4u + 3u]);
  let c = vec4f(tables[b + j * 4u], tables[b + j * 4u + 1u], tables[b + j * 4u + 2u], tables[b + j * 4u + 3u]);
  return mix(a, c, t - f32(i));
}
// reference gradients.ts's gradientPosition.
fn gradient_position(style: u32, l: vec4f, doc: vec2f) -> f32 {
  let pd = doc - l.xy;
  let rr = max(dot(l.zw, l.zw), 1e-12);
  let along = dot(pd, l.zw) / rr;
  switch (style) {
    case 1u: { return min(1.0, length(pd) / sqrt(rr)); }
    case 2u: {
      let a0 = atan2(-l.w, l.z);
      let a = atan2(-pd.y, pd.x);
      let d = (a - a0) / 6.283185307179586;
      return d - floor(d);
    }
    case 3u: { return min(1.0, abs(along)); }
    case 4u: { return min(1.0, abs(along) + abs(dot(pd, vec2f(-l.w, l.z)) / rr)); }
    default: { return clamp(0.5 + along / 2.0, 0.0, 1.0); }
  }
}
fn domain(c: vec3f) -> vec3f { return select(dec3(c), c, su.blend.encoded == 1u); }
// A colour (straight, encoded) and its alpha onto \`dst\` by a mode.
fn over(dst: vec4f, colour: vec3f, a: f32, mode: u32, doc: vec2f) -> vec4f {
  if (a <= 0.0) { return dst; }
  var p: BlendParams;
  p.mode = mode;
  p.encoded = su.blend.encoded;
  p.fill = 1.0;
  p.opacity = 1.0;
  p.channels = 7u;
  return composite_pixel(p, dst, vec4f(domain(colour) * a, a), doc);
}
fn falloff(fx: Fx, f: vec2f) -> f32 {
  let inner = (fx.flags & 2u) != 0u;
  if ((fx.flags & 1u) != 0u) {
    var d = sd_at(f);
    if (inner) { d = -d; }
    if (fx.spread >= 1.0) { return clamp((fx.size + 0.5 - d) * 8.0, 0.0, 1.0); }
    return clamp((fx.size + 0.5 - d) / ((2.0 - 2.0 * fx.spread) * fx.size + 2.0), 0.0, 1.0);
  }
  return bil(fx.field, f, select(0.0, 1.0, inner));
}
fn band(d: f32, size: f32, position: u32) -> f32 {
  var lo = 0.0;
  var hi = size;
  if (position == 1u) { lo = -size; hi = 0.0; }
  if (position == 2u) { lo = -size / 2.0; hi = size / 2.0; }
  return clamp(hi - d + 0.5, 0.0, 1.0) * clamp(d - lo + 0.5, 0.0, 1.0);
}
// What an effect paints here: its colour (straight, encoded) and alpha (coverage × its opacity).
fn paint(fx: Fx, doc: vec2f) -> vec4f {
  if (fx.kind == 3u) { return vec4f(fx.colour.rgb, fx.opacity); }
  if (fx.kind == 2u) {
    let g = gradient(fx.gradient, gradient_position(fx.style, fx.place, doc));
    return vec4f(g.rgb, g.a * fx.opacity);
  }
  if (fx.kind == 6u) {
    let d = sd_at(to_field(doc)) * su.sdScale;
    let c = band(d, fx.extra.x, fx.position);
    if ((fx.flags & 8u) != 0u) {
      var t = gradient_position(fx.style, fx.place, doc);
      if (fx.style == 5u) { t = clamp((d - fx.extra.y) / fx.extra.x, 0.0, 1.0); }
      let g = gradient(fx.gradient, t);
      return vec4f(g.rgb, c * g.a * fx.opacity);
    }
    return vec4f(fx.colour.rgb, c * fx.opacity);
  }
  let outer = (fx.flags & 16u) != 0u;
  let f = to_field(doc - fx.offset);
  var raw = falloff(fx, f);
  if (fx.noise > 0.0) {
    let scatter = (vec2f(noise_at(f, 0x9e3779b9u), noise_at(f, 0x85ebca6bu)) - 0.5) * 8.0;
    raw = raw + (falloff(fx, f + scatter) - raw) * fx.noise;
  }
  var c = contour(fx.contour, min(1.0, raw / fx.range));
  if (outer) { c = min(c, min(1.0, 8.4 * raw)); }
  if ((fx.flags & 4u) != 0u) { c = 1.0 - c; }
  if ((fx.flags & 8u) != 0u) {
    var t = 1.0 - c;
    if (fx.jitter > 0.0) { t += (noise_at(f, 0x27d4eb2fu) - 0.5) * fx.jitter; }
    let g = gradient(fx.gradient, clamp(t, 0.0, 1.0));
    return vec4f(g.rgb, g.a * select(1.0, min(1.0, 8.4 * raw), outer) * fx.opacity);
  }
  return vec4f(fx.colour.rgb, c * fx.opacity);
}

@fragment
fn fs(@builtin(position) pos: vec4f) -> @location(0) vec4f {
  let px = vec2i(pos.xy);
  let doc = su.origin + pos.xy / su.zoom;
  let b = textureLoad(below, px, 0);
  let content = textureLoad(drawn, px, 0);
  // The mask drawn alone is its value in every channel inside the layer's rectangle (premultiplied by the edge's
  // coverage); past it a mask reveals.
  let mt = textureLoad(maskTex, px, 0);
  let m = select(1.0, clamp(mt.r + (1.0 - clamp(mt.a, 0.0, 1.0)), 0.0, 1.0), (su.flags & 2u) != 0u);
  // Outside: the backdrop, the drop shadows (those that don't knock out under the layer too), the outer glow.
  var outside = b;
  var insideBase = b;
  for (var i = 0u; i < su.count; i++) {
    let fx = fxs[i];
    if (fx.kind > 1u) { continue; }
    let pnt = paint(fx, doc);
    outside = over(outside, pnt.rgb, pnt.a, fx.mode, doc);
    if (fx.kind == 0u && (fx.flags & 32u) == 0u) { insideBase = over(insideBase, pnt.rgb, pnt.a, fx.mode, doc); }
  }
  // Inside: the layer's pixels at its Fill by its mode (and Blend If), and the interior effects.
  let alpha = clamp(content.a, 0.0, 1.0);
  var s = vec4f(0.0, 0.0, 0.0, 1.0);
  if (alpha > 0.0) { s = vec4f(content.rgb / alpha, 1.0); }
  var lb = su.blend;
  lb.opacity = 1.0;
  lb.channels = 7u;
  var inside: vec4f;
  if ((su.flags & 1u) != 0u) {
    var group = s;
    for (var i = 0u; i < su.count; i++) {
      let fx = fxs[i];
      if (fx.kind < 2u || fx.kind > 5u) { continue; }
      let pnt = paint(fx, doc);
      group = over(group, pnt.rgb, pnt.a, fx.mode, doc);
    }
    inside = composite_pixel(lb, insideBase, group, doc);
  } else {
    inside = composite_pixel(lb, insideBase, s, doc);
    for (var i = 0u; i < su.count; i++) {
      let fx = fxs[i];
      if (fx.kind < 2u || fx.kind > 5u) { continue; }
      let pnt = paint(fx, doc);
      inside = over(inside, pnt.rgb, pnt.a, fx.mode, doc);
    }
  }
  var result = mix(outside, inside, alpha);
  // The strokes, over it all.
  for (var i = 0u; i < su.count; i++) {
    let fx = fxs[i];
    if (fx.kind != 6u) { continue; }
    let pnt = paint(fx, doc);
    result = over(result, pnt.rgb, pnt.a, fx.mode, doc);
  }
  result = mix(b, result, su.blend.opacity * m);
  let keep = vec4<bool>((su.blend.channels & 1u) != 0u, (su.blend.channels & 2u) != 0u, (su.blend.channels & 4u) != 0u, true);
  return round_for_store(select(b, result, keep));
}
`;

const hexEncoded = (c: string): [number, number, number] => {
  const n = Number.parseInt(c.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
};

/** The composite's inputs for a styled layer: its uniform, its effects and their tables. */
export function packStyle(node: DrawNode, blend: NodeBlend, opacity: number, compositing: Compositing, plan: FieldPlan, matrix: Affine, view: { x: number; y: number; zoom: number }) {
  const style = node.style!;
  const effects = style.effects.filter((e) => styleDefinition(e.type));
  const fx = new ArrayBuffer(Math.max(FX_SIZE, FX_SIZE * effects.length));
  const contours: Float32Array[] = [];
  const gradients: Float32Array[] = [];
  const contourRow = (c: Contour) => contours.push(contourTable(c)) - 1;
  const gradientRow = (g: Gradient, reverse: boolean) => gradients.push(gradientTable(g, reverse)) - 1;
  effects.forEach((e: EffectInstance, i) => {
    const p = e.params;
    const u = new Uint32Array(fx, i * FX_SIZE, FX_SIZE / 4);
    const f = new Float32Array(fx, i * FX_SIZE, FX_SIZE / 4);
    const i32 = new Int32Array(fx, i * FX_SIZE, FX_SIZE / 4);
    const kind = KINDS.indexOf(e.type);
    const inner = e.type === "inner-glow" || e.type === "inner-shadow";
    const gradientFill = e.type === "gradient-overlay" || p.fill === "gradient";
    u[0] = kind;
    u[1] = Math.max(0, modeIndex(p.mode as BlendMode));
    i32[2] = plan.fieldOf[e.id] ?? 0;
    u[3] =
      (p.technique === "precise" ? 1 : 0) |
      (inner ? 2 : 0) |
      (p.source === "center" ? 4 : 0) |
      (gradientFill ? 8 : 0) |
      (e.type === "drop-shadow" || e.type === "outer-glow" ? 16 : 0) |
      (e.type === "drop-shadow" && p.knocksOut !== false ? 32 : 0);
    f.set([...(p.colour ? hexEncoded(p.colour as string) : [0, 0, 0]), 1], 4);
    f[8] = (p.opacity as number) / 100;
    f[9] = ((p.size as number) ?? 0) / plan.scale;
    f[10] = ((inner ? p.choke : p.spread) as number | undefined) !== undefined ? ((inner ? p.choke : p.spread) as number) / 100 : 0;
    f[11] = p.range !== undefined ? (p.range as number) / 100 : 1;
    f[12] = p.noise !== undefined ? (p.noise as number) / 100 : 0;
    f[13] = p.jitter !== undefined ? (p.jitter as number) / 100 : 0;
    u[14] = contourRow((p.contour as Contour | undefined) ?? { name: "Linear", points: [{ x: 0, y: 0 }, { x: 255, y: 255 }] });
    i32[15] = gradientFill ? gradientRow(p.gradient as Gradient, p.reverse === true) : -1;
    const o = e.type === "drop-shadow" || e.type === "inner-shadow" ? shadowOffset(style.angles[e.id], p.distance as number) : { x: 0, y: 0 };
    f[16] = o.x;
    f[17] = o.y;
    u[18] = POSITION_CODES[p.position as string] ?? 0;
    u[19] = STYLE_CODES[p.style as string] ?? 0;
    if (p.style !== undefined) {
      const l = gradientLayout(p.align === false ? style.canvasBox : style.layerBox, p.angle as number, p.scale as number, { x: p.offsetX as number, y: p.offsetY as number });
      f.set([l.cx, l.cy, l.rx, l.ry], 20);
    }
    if (e.type === "stroke") {
      const size = p.size as number;
      f[24] = size;
      f[25] = p.position === "inside" ? -size : p.position === "center" ? -size / 2 : 0;
    }
  });
  const tables = new Float32Array(Math.max(4, contours.length * CONTOUR_TABLE_SIZE + gradients.length * GRADIENT_TABLE_SIZE * 4));
  contours.forEach((t, i) => tables.set(t, i * CONTOUR_TABLE_SIZE));
  const gradientBase = contours.length * CONTOUR_TABLE_SIZE;
  gradients.forEach((t, i) => tables.set(t, gradientBase + i * GRADIENT_TABLE_SIZE * 4));
  const uniform = new ArrayBuffer(STYLE_UNIFORM_SIZE);
  const f = new Float32Array(uniform);
  const u = new Uint32Array(uniform);
  const inv = invert(matrix);
  f.set([inv[0], inv[2], inv[4], 0, inv[1], inv[3], inv[5], 0, view.x, view.y, view.zoom], 0);
  u[11] = effects.length;
  f.set([plan.width, plan.height, plan.pad, 2 ** plan.level, plan.scale], 12);
  u[17] = (style.interiorAsGroup ? 1 : 0) | (style.maskHidesEffects ? 2 : 0);
  u[18] = gradientBase;
  packBlend(blend, opacity, compositing, view, uniform, 96);
  return { uniform, fx, tables, count: effects.length };
}

export type { GradientStyle };
