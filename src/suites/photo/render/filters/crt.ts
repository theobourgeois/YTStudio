/** CRT's WGSL (shared/photo/effects/filters/crt.ts), mirroring `reference/filters/crt.ts`. */
import { BEAM_MEAN, crtSetup } from "@shared/photo/reference/filters/crt.ts";
import { type FilterKernel, packValues } from "../kernel.ts";

/** Where a pattern reads its content (reference: stylize's held). */
const HELD = /* wgsl */ `
// Inside the canvas when p is, so a cell cut by its edge reads the edge rather than the transparency past it.
fn held(d: vec2f, p: vec2f) -> vec2f {
  if (p.x < 0.0 || p.y < 0.0 || p.x > header.canvas.x || p.y > header.canvas.y) { return d; }
  return clamp(d, vec2f(0.5), header.canvas - 0.5);
}`;


const CRT: FilterKernel = {
  wgsl: /* wgsl */ `
struct Params { kind: u32, strength: f32, scan: f32, mean_mask: f32, boost: f32, glow: f32, k: f32, half: f32, corner: f32, vignette: f32, cell: f32, beam_mean: f32 }
${HELD}

// A shadow mask's rows of dots, apart by this many dot pitches (reference: ROW).
const ROW: f32 = ${Math.sqrt(3) / 2};

fn put(out: ptr<function, vec3f>, ch: i32, v: f32) {
  if (ch == 0) { (*out).r = max((*out).r, v); } else if (ch == 1) { (*out).g = max((*out).g, v); } else { (*out).b = max((*out).b, v); }
}

// The mask's transmission for each phosphor at (x, y) in cells, edges smoothed over a cells (reference: crtMask).
fn crt_mask(x: f32, y: f32, a: f32) -> vec3f {
  var out = vec3f(0.0);
  let s = 3.0 * a;
  if (params.kind == 1u) {
    let gx = x * 3.0;
    let gy = (y * 3.0) / ROW;
    let r0 = i32(floor(gy - 0.5));
    for (var j = 0; j < 2; j++) {
      let r = r0 + j;
      let odd = r & 1;
      let fo = f32(odd);
      let dy = (gy - (f32(r) + 0.5)) * ROW;
      let i0 = i32(floor(gx - 0.5 * fo - 0.5));
      for (var k = 0; k < 2; k++) {
        let i = i0 + k;
        let d = length(vec2f(gx - (f32(i) + 0.5 + 0.5 * fo), dy));
        put(&out, (((i + 2 * odd) % 3) + 3) % 3, 1.0 - smoothstep(0.3 - s, 0.46 + s, d));
      }
    }
    return out;
  }
  let u = fract(x) * 3.0;
  let k = min(2, i32(floor(u)));
  let d = abs(fract(u) - 0.5);
  var cover = 0.0;
  if (params.kind == 2u) {
    let yy = abs(fract(y + 0.5 * f32(i32(floor(x)) & 1)) - 0.5);
    cover = (1.0 - smoothstep(0.24 - s, 0.4 + s, d)) * (1.0 - smoothstep(0.36 - a, 0.46 + a, yy));
  } else {
    cover = 1.0 - smoothstep(0.26 - s, 0.44 + s, d);
  }
  put(&out, k, cover);
  return out;
}

fn effect(p: vec2f, c: vec4f) -> vec4f {
  let w = params.cell;
  let ctr = header.canvas / 2.0;
  let dc = p - ctr;
  let f = 1.0 + (params.k * (dc.x * dc.x + dc.y * dc.y)) / (params.half * params.half);
  let q = ctr + dc * f;
  let b = abs(q - ctr) - (ctr - params.corner);
  let sd = length(max(b, vec2f(0.0))) + min(max(b.x, b.y), 0.0) - params.corner;
  let tube = clamp(0.5 - sd / px(), 0.0, 1.0);
  if (!(tube > 0.0)) { return vec4f(0.0, 0.0, 0.0, c.a); }
  let col = floor(q.x / w);
  let row = floor(q.y / w);
  var pic = vec4f(0.0);
  for (var j = 0; j < 2; j++) {
    for (var i = 0; i < 2; i++) {
      pic += src(held(vec2f((col + 0.25 + 0.5 * f32(i)) * w, (row + 0.25 + 0.5 * f32(j)) * w), p)) / 4.0;
    }
  }
  let lum = enc(luma(unpremul(pic)));
  let v = q.y / w - row - 0.5;
  let sigma = mix(0.2, 0.34, lum);
  let beam = exp(-0.5 * (v / sigma) * (v / sigma));
  let scan = 1.0 - params.scan * (1.0 - mix(params.beam_mean, beam, smoothstep(1.5, 3.0, w / px())));
  let m = crt_mask(q.x / w, q.y / w, (0.5 * px()) / w);
  let fm = smoothstep(1.0, 2.0, w / 3.0 / px());
  let e = (q - ctr) / ctr;
  let vig = 1.0 - params.vignette * smoothstep(0.5, 1.5, length(e));
  let gain = params.boost * scan * vig * tube;
  let rgb = pic.rgb * mix(vec3f(params.mean_mask), mix(vec3f(1.0), m, params.strength), fm) * gain;
  let base_a = mix(c.a, clamp(pic.a, 0.0, 1.0), tube);
  let radius = 2.5 * w;
  var glow = vec3f(0.0);
  for (var i = 0; i < 6; i++) {
    let a1 = f32(i) * PI / 3.0;
    let a2 = a1 + PI / 6.0;
    let g1 = src(held(vec2f(q.x + cos(a1) * 0.4 * radius, q.y + sin(a1) * 0.4 * radius), p));
    let g2 = src(held(vec2f(q.x + cos(a2) * radius, q.y + sin(a2) * radius), p));
    glow += 0.6 * g1.rgb + 0.4 * g2.rgb;
  }
  let light = glow * ((params.glow * params.mean_mask * (1.0 - params.scan * (1.0 - params.beam_mean)) * params.boost * vig * tube) / 6.0);
  // The glow's addLight: no pixel brighter than its coverage, up to white.
  let coverage = clamp(max(light.r, max(light.g, light.b)), 0.0, 1.0);
  let o = rgb + light;
  return vec4f(o, max(base_a + coverage * (1.0 - base_a), clamp(max(o.r, max(o.g, o.b)), 0.0, 1.0)));
}`,
  pack: (p, canvas) => {
    const k = crtSetup(p, canvas);
    return { uniform: packValues([{ u32: k.kind }, k.strength, k.scan, k.meanMask, k.boost, k.glow, k.k, k.half, k.corner, k.vignette, k.cell, BEAM_MEAN]) };
  },
};


export const CRT_KERNELS: Record<string, FilterKernel> = { crt: CRT };
