/**
 * Brushes that read the pixels they change (docs/photo/tools/toning.md, background-eraser.md): Dodge, Burn, Sponge
 * and the Background Eraser. Their strokes keep, per draft tile, the tile as it was before the stroke (`base`) and the
 * stroke's accumulation (`acc`: the Brush's stamp for toning, the CPU's for the Background Eraser); the **apply** pass
 * here writes what the shown draft is: `tone(base, cap × acc × selection)`, or the colour extraction. So pixels are
 * always made from what was there before the stroke, whatever its length.
 *
 * The WGSL mirrors the CPU references `shared/photo/reference/toning.ts` and `reference/background-erase.ts`: change
 * both.
 */
import type { ToneEffect } from "@shared/photo/reference/toning.ts";
import type { RenderContext } from "./context.ts";
import { ROUND_FOR_STORE, SELECTION } from "./kernels.ts";
import { ATLAS, MATHS } from "./wgsl.ts";

/** What a stroke's apply pass does: toning (`cap`: the stroke's ceiling, its Exposure or 1), or extracting a colour. */
export type BrushEffect = { kind: "tone"; effect: ToneEffect; cap: number; mask: boolean } | { kind: "erase" };

const APPLY = (format: "rgba16float" | "rgba32float") => /* wgsl */ `
${ROUND_FOR_STORE(format)}
${ATLAS}
${MATHS}
${SELECTION}
// mode: 0 dodge, 1 burn, 2 sponge, 3 erase. range: 0 shadows, 1 midtones, 2 highlights. flags: 1 protect tones,
// 2 vibrance, 4 saturate, 8 the surface is a mask.
struct Effect { mode: u32, range: u32, flags: u32, p0: u32, cap: f32, p1: f32, p2: f32, p3: f32 }
@group(1) @binding(0) var<storage, read> jobs: array<Job>;
@group(1) @binding(1) var<storage, read> dabs: array<Dab>;
@group(1) @binding(2) var out: texture_storage_2d_array<${format}, write>;
@group(1) @binding(3) var<uniform> params: Params;
@group(2) @binding(0) var<uniform> fx: Effect;

// sRGB's curve on any value, sign-mirrored (shared/photo/colour.ts's linearToSrgb and srgbToLinear).
fn enc(v: f32) -> f32 { return sign(v) * linear_to_srgb(abs(v)); }
fn dec(v: f32) -> f32 { return sign(v) * srgb_to_linear(abs(v)); }
fn powp(x: f32, y: f32) -> f32 { return select(0.0, pow(x, y), x > 0.0); }

// reference/toning.ts's toneCurve.
fn tone_curve(x: f32, a: f32) -> f32 {
  if (a <= 0.0) { return x; }
  let protect = (fx.flags & 1u) != 0u;
  if (fx.mode == 0u) {
    if (fx.range == 0u) { return x + (a / 3.0) * (1.0 - x); }
    if (fx.range == 1u) { return powp(x, 1.0 / (1.0 + a)); }
    if (protect) { return x + a * x * x * (1.0 - x); }
    return x * (1.0 + a / 3.0);
  }
  if (fx.range == 2u) { return x * (1.0 - a / 3.0); }
  if (fx.range == 1u) { return powp(x, 1.0 + a / 3.0); }
  if (protect) { return x - a * x * (1.0 - x) * (1.0 - x); }
  let c = a / 3.0;
  return select((x - c) / (1.0 - c), 0.0, x < c);
}

fn curved(x: f32, a: f32) -> f32 {
  let c = clamp(x, 0.0, 1.0);
  return tone_curve(c, a) + (x - c);
}

// Dodge or Burn on straight linear colour (reference/toning.ts's toneColour).
fn tone_colour(c: vec3f, a: f32) -> vec3f {
  if ((fx.flags & 1u) == 0u) {
    return vec3f(dec(curved(enc(c.r), a)), dec(curved(enc(c.g), a)), dec(curved(enc(c.b), a)));
  }
  let l = dot(c, vec3f(0.2126, 0.7152, 0.0722));
  let goal = dec(curved(enc(l), a));
  var o = select(c + vec3f(goal - l), c * (goal / l), l > 1e-6);
  let limit = max(1.0, max(c.r, max(c.g, c.b)));
  let m = max(o.r, max(o.g, o.b));
  if (m > limit && goal < limit) {
    let t = (limit - goal) / (m - goal);
    o = vec3f(goal) + (o - vec3f(goal)) * t;
  }
  return o;
}

// Sponge on straight encoded colour (reference/toning.ts's spongeColour).
fn sponge_colour(e: vec3f, a: f32) -> vec3f {
  let k = clamp(e, vec3f(0.0), vec3f(1.0));
  let y = dot(k, vec3f(0.299, 0.587, 0.114));
  let mx = max(k.r, max(k.g, k.b));
  let s = select(0.0, (mx - min(k.r, min(k.g, k.b))) / mx, mx > 0.0);
  let vibrance = (fx.flags & 2u) != 0u;
  let saturate = (fx.flags & 4u) != 0u;
  var factor: f32;
  if (!saturate) {
    factor = 1.0 - a * select(1.0, (1.0 + s) / 2.0, vibrance);
  } else {
    factor = 1.0 + a * select(1.0, 1.0 - s, vibrance);
    if (vibrance) {
      for (var i = 0; i < 3; i++) {
        let d = e[i] - y;
        if (d > 1e-9) { factor = min(factor, max(1.0, (1.0 - y) / d)); }
        else if (d < -1e-9) { factor = min(factor, max(1.0, y / -d)); }
      }
    }
  }
  var o = vec3f(y) + (e - vec3f(y)) * factor;
  if (saturate && !vibrance) {
    for (var i = 0; i < 3; i++) {
      if (e[i] >= 0.0 && e[i] <= 1.0) { o[i] = clamp(o[i], 0.0, 1.0); }
    }
  }
  return o;
}

// reference/toning.ts's tonePixel and toneMask.
fn tone(p: vec4f, amount: f32) -> vec4f {
  let a = clamp(amount, 0.0, 1.0);
  if (a <= 0.0) { return p; }
  if ((fx.flags & 8u) != 0u) {
    var v: f32;
    if (fx.mode == 2u) { v = 0.5 + (p.r - 0.5) * select(1.0 - a, 1.0 + a, (fx.flags & 4u) != 0u); }
    else { v = tone_curve(clamp(p.r, 0.0, 1.0), a); }
    return vec4f(clamp(v, 0.0, 1.0));
  }
  if (!(p.a > 0.0)) { return p; }
  let c = p.rgb / p.a;
  var o: vec3f;
  if (fx.mode == 2u) {
    let s = sponge_colour(vec3f(enc(c.r), enc(c.g), enc(c.b)), a);
    o = vec3f(dec(s.r), dec(s.g), dec(s.b));
  } else {
    o = tone_colour(c, a);
  }
  return vec4f(o * p.a, p.a);
}

// reference/background-erase.ts's extractPixel.
fn extract(base: vec4f, acc: vec4f, cover: f32) -> vec4f {
  let erased = clamp(acc.a, 0.0, 1.0) * clamp(cover, 0.0, 1.0);
  let alpha = base.a;
  if (!(erased > 0.0) || !(alpha > 0.0)) { return base; }
  if (erased >= 1.0) { return vec4f(0.0); }
  let left = alpha * (1.0 - erased);
  let background = acc.rgb / acc.a;
  let ceiling = left * max(vec3f(1.0), base.rgb / alpha);
  return vec4f(min(ceiling, max(vec3f(0.0), base.rgb - alpha * erased * background)), left);
}

@compute @workgroup_size(16, 16)
fn main(@builtin(global_invocation_id) g: vec3u) {
  let tile = params.tile;
  if (g.x >= tile || g.y >= tile) { return; }
  let job = jobs[g.z];
  let p = vec2i(g.xy);
  let base = loadSlot(job.slot, p);
  let acc = loadSlot(job.first, p);
  var k = 1.0;
  if (params.hasSelection == 2u) {
    k = clamp(loadSlot(job.p0, p).r, 0.0, 1.0);
  } else {
    k = selection_coverage(vec2i(job.tx * i32(tile) + i32(g.x), job.ty * i32(tile) + i32(g.y)));
  }
  var c: vec4f;
  if (fx.mode == 3u) { c = extract(base, acc, k); }
  else { c = tone(base, clamp(acc.a, 0.0, 1.0) * k * fx.cap); }
  textureStore(out, p, i32(g.z), round_for_store(c));
}
`;

const pipelines = new WeakMap<RenderContext, { pipeline: GPUComputePipeline; layout: GPUBindGroupLayout }>();

/** The apply pipeline for a context, made the first time a stroke needs it. */
function applyPipeline(ctx: RenderContext) {
  let made = pipelines.get(ctx);
  if (!made) {
    const { device } = ctx;
    const layout = device.createBindGroupLayout({ label: "brush effect", entries: [{ binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: "uniform" } }] });
    const pipeline = device.createComputePipeline({
      label: "brush effect apply",
      layout: device.createPipelineLayout({ bindGroupLayouts: [ctx.kernels.atlasLayout, ctx.kernels.stamp.getBindGroupLayout(1), layout] }),
      compute: { module: device.createShaderModule({ label: "brush effect apply", code: APPLY(ctx.format) }), entryPoint: "main" },
    });
    pipelines.set(ctx, (made = { pipeline, layout }));
  }
  return made;
}

/** The WGSL's compilation errors (the checks: empty when it compiles). */
export async function brushEffectErrors(device: GPUDevice, format: "rgba16float" | "rgba32float"): Promise<string[]> {
  const info = await device.createShaderModule({ code: APPLY(format) }).getCompilationInfo();
  return info.messages.filter((m) => m.type === "error").map((m) => `${m.lineNum}: ${m.message}`);
}

const MODES = { dodge: 0, burn: 1, sponge: 2 } as const;
const RANGES = { shadows: 0, midtones: 1, highlights: 2 } as const;

/** The `Effect` uniform's 32 bytes. */
export function packEffect(effect: BrushEffect): ArrayBuffer {
  const data = new ArrayBuffer(32);
  const u = new Uint32Array(data);
  const f = new Float32Array(data);
  if (effect.kind === "erase") {
    u[0] = 3;
    return data;
  }
  const e = effect.effect;
  u[0] = MODES[e.tool];
  if (e.tool === "sponge") u[2] = (e.vibrance ? 2 : 0) | (e.mode === "saturate" ? 4 : 0);
  else {
    u[1] = RANGES[e.range];
    u[2] = e.protect ? 1 : 0;
  }
  if (effect.mask) u[2] |= 8;
  f[4] = Math.max(0, Math.min(1, effect.cap));
  return data;
}

/** One stroke's apply pass: its uniform and bind group (destroyed with the stroke). */
export class EffectPass {
  private readonly uniform: GPUBuffer;
  private readonly group: GPUBindGroup;
  private readonly pipeline: GPUComputePipeline;

  constructor(
    private readonly ctx: RenderContext,
    readonly effect: BrushEffect,
  ) {
    const { pipeline, layout } = applyPipeline(ctx);
    this.pipeline = pipeline;
    this.uniform = ctx.device.createBuffer({ size: 32, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    ctx.device.queue.writeBuffer(this.uniform, 0, packEffect(effect));
    this.group = ctx.device.createBindGroup({ layout, entries: [{ binding: 0, resource: { buffer: this.uniform } }] });
  }

  /** Whether the GPU accumulates the stroke (the Brush's stamp into `acc`); else the CPU writes `acc`. */
  get stamped() {
    return this.effect.kind === "tone";
  }

  /**
   * Encodes the apply pass over `count` jobs (the limit jobs' layout: `slot` the base, `first` the accumulation, `p0`
   * a mask selection's coverage) into scratch layers 0..count-1.
   */
  encode(encoder: GPUCommandEncoder, jobsGroup: GPUBindGroup, count: number) {
    const pass = encoder.beginComputePass({ label: "brush effect apply" });
    pass.setPipeline(this.pipeline);
    pass.setBindGroup(0, this.ctx.atlasBindGroup());
    pass.setBindGroup(1, jobsGroup);
    pass.setBindGroup(2, this.group);
    pass.dispatchWorkgroups(this.ctx.tile / 16, this.ctx.tile / 16, count);
    pass.end();
  }

  destroy() {
    this.uniform.destroy();
  }
}
