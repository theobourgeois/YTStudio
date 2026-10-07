/** The focus filters' WGSL (shared/photo/effects/filters/focus.ts), mirroring `reference/filters/focus.ts`. */
import {
  BOKEH_FULL,
  CONTRAST_S,
  FOCUS_SEED,
  FRONT_SPAN,
  GOLDEN,
  HIGHLIGHT_SOFT,
  MAX_IN,
  MAX_OUT,
  OVAL,
  PROBES,
  PROBE_RINGS,
  SHAPE_AREAS,
  TILT_THRESHOLD,
  lensSettings,
  tiltSettings,
} from "@shared/photo/reference/filters/focus.ts";
import { SCENE_HEADER } from "@shared/photo/scene.ts";
import { type FilterKernel, packValues } from "../kernel.ts";

const f = (v: number) => v.toFixed(9);

/**
 * The gather of circles of confusion (`gatherFocus`), for a filter whose WGSL defines `fn coc(q: vec2f, d: f32) -> f32`
 * and whose Params have `uses_depth`, `fg_max`, `shape`, `cats`, `gain` and `threshold`.
 */
const GATHER = /* wgsl */ `
const GOLDEN: f32 = ${f(GOLDEN)};
const MAX_IN: i32 = ${MAX_IN};
const MAX_OUT: i32 = ${MAX_OUT};
const PROBE_RINGS: i32 = ${PROBE_RINGS};
const PROBES: i32 = ${PROBES};
const FRONT_SPAN: f32 = ${f(FRONT_SPAN)};
const FOCUS_SEED: u32 = ${FOCUS_SEED}u;
const OVAL: f32 = ${f(OVAL)};
const HIGHLIGHT_SOFT: f32 = ${f(HIGHLIGHT_SOFT)};
const BOKEH_FULL: f32 = ${f(BOKEH_FULL)};
fn on_canvas(q: vec2f, p: vec2f) -> vec2f { return clamp(q, min(p, vec2f(0.5 * px())), max(p, header.canvas - 0.5 * px())); }
// The depth map alone at a document point: scene_at's arithmetic, half its reads.
fn depth_at(d: vec2f) -> f32 {
  if (scene[0] < 1.0) { return 0.0; }
  let w = i32(scene[0]);
  let h = i32(scene[1]);
  let u = d / scene[2] - 0.5;
  let fu = floor(u);
  let t = u - fu;
  let i0 = clamp(i32(fu.x), 0, w - 1);
  let i1 = clamp(i32(fu.x) + 1, 0, w - 1);
  let j0 = clamp(i32(fu.y), 0, h - 1);
  let j1 = clamp(i32(fu.y) + 1, 0, h - 1);
  let a = scene[${SCENE_HEADER}u + 2u * u32(j0 * w + i0)];
  let b = scene[${SCENE_HEADER}u + 2u * u32(j0 * w + i1)];
  let c = scene[${SCENE_HEADER}u + 2u * u32(j1 * w + i0)];
  let e = scene[${SCENE_HEADER}u + 2u * u32(j1 * w + i1)];
  return (a + (b - a) * t.x) * (1.0 - t.y) + (c + (e - c) * t.x) * t.y;
}
fn gauge(o: vec2f) -> f32 {
  if (params.shape == 1u) {
    let h = ${f(Math.sqrt(3) / 2)};
    return max(abs(o.x), max(abs(0.5 * o.x + h * o.y), abs(-0.5 * o.x + h * o.y))) / h;
  }
  if (params.shape == 2u) { return length(vec2f(o.x / OVAL, o.y)); }
  return length(o);
}
fn shape_area() -> f32 {
  if (params.shape == 1u) { return ${f(SHAPE_AREAS[1])}; }
  if (params.shape == 2u) { return ${f(SHAPE_AREAS[2])}; }
  return ${f(SHAPE_AREAS[0])};
}
fn lens_fraction(k: f32) -> f32 { return (2.0 * acos(k / 2.0) - (k / 2.0) * sqrt(4.0 - k * k)) / PI; }
fn cover(r: f32, o: vec2f, k: f32, v: vec2f, e: f32) -> f32 {
  var c = clamp((r - gauge(o)) / e + 0.5, 0.0, 1.0);
  if (k > 0.0) {
    let h = v * (k * r / 2.0);
    c = min(c, min(clamp((r - length(o - h)) / e + 0.5, 0.0, 1.0), clamp((r - length(o + h)) / e + 0.5, 0.0, 1.0)));
  }
  return c;
}
struct Gathered { back: vec4f, wb: f32, front: vec4f, wf: f32 }
fn focus_tap(g: ptr<function, Gathered>, p: vec2f, qd: vec2f, area: f32, centre: bool, c: vec4f, dp: f32, rp: f32) {
  let s = max(1.0, px());
  let hq = on_canvas(qd, p);
  let o = hq - p;
  var q = c;
  var dq = dp;
  var rq = rp;
  if (!centre) {
    q = src(hq);
    dq = 0.0;
    if (params.uses_depth == 1u) { dq = depth_at(hq); }
    rq = coc(hq, dq);
  }
  var b = 1.0;
  if (params.gain > 0.0 && q.a > 0.0) {
    b = 1.0 + params.gain * smoothstep(params.threshold, params.threshold + HIGHLIGHT_SOFT, enc(luma(unpremul(q)))) * clamp(rq / BOKEH_FULL, 0.0, 1.0);
  }
  let lit = vec4f(q.rgb * b, q.a);
  var k = 0.0;
  var v = vec2f(0.0);
  if (params.cats > 0.0) {
    let dv = hq - header.canvas / 2.0;
    let len = length(dv);
    k = params.cats * min(1.0, len / (length(header.canvas) / 2.0));
    if (len > 0.0) { v = dv / len; }
  }
  let area_k = shape_area() * lens_fraction(k);
  var t = 0.0;
  var behind = 0.0;
  if (params.uses_depth == 1u) {
    t = clamp((dq - dp) / FRONT_SPAN, 0.0, 1.0);
    behind = clamp((dp - dq) / FRONT_SPAN, 0.0, 1.0);
  }
  if (t > 0.0) {
    let m = max(rq, 0.5);
    let w = t * cover(rq, o, k, v, s) * min(1.0, area / (area_k * m * m));
    (*g).front += lit * w;
    (*g).wf += w;
  }
  if (t < 1.0) {
    let rb = min(rq, rp) + (rp - min(rq, rp)) * behind;
    let m = max(rb, 0.5);
    let w = (1.0 - t) * cover(rb, o, k, v, s) * min(1.0, area / (area_k * m * m));
    (*g).back += lit * w;
    (*g).wb += w;
  }
}
fn gather(p: vec2f, c: vec4f) -> vec4f {
  let s = max(1.0, px());
  let turn = 2.0 * PI * rand(i32(floor(p.x)), i32(floor(p.y)), FOCUS_SEED);
  var dp = 0.0;
  if (params.uses_depth == 1u) { dp = depth_at(p); }
  let rp = coc(p, dp);
  var R = rp;
  if (params.fg_max > 0.0) {
    for (var j = 0; j < PROBE_RINGS; j++) {
      let rr = params.fg_max * f32(j + 1) / f32(PROBE_RINGS);
      for (var i = 0; i < PROBES; i++) {
        let a = turn + ((f32(i) + f32(j) / f32(PROBE_RINGS)) * 2.0 * PI) / f32(PROBES);
        let q = p + vec2f(cos(a), sin(a)) * rr;
        let dq = depth_at(q);
        if (dq > dp) { R = max(R, coc(q, dq)); }
      }
    }
  }
  var g = Gathered(vec4f(0.0), 0.0, vec4f(0.0), 0.0);
  let n_in = clamp(i32(ceil(PI * rp * rp / (s * s))), 1, MAX_IN);
  let a_in = PI * max(rp, 0.5) * max(rp, 0.5) / f32(n_in);
  for (var k = 0; k < n_in; k++) {
    let r = rp * sqrt(f32(k) / f32(n_in));
    let a = turn + f32(k) * GOLDEN;
    focus_tap(&g, p, p + vec2f(cos(a), sin(a)) * r, a_in, k == 0, c, dp, rp);
  }
  if (R > rp + 0.5) {
    let ring = PI * (R * R - rp * rp);
    let n_out = clamp(i32(ceil(ring / (s * s))), 1, MAX_OUT);
    let a_out = ring / f32(n_out);
    for (var k = 0; k < n_out; k++) {
      let r = sqrt(rp * rp + ((R * R - rp * rp) * (f32(k) + 0.5)) / f32(n_out));
      let a = turn + 1.0 + f32(k) * GOLDEN;
      focus_tap(&g, p, p + vec2f(cos(a), sin(a)) * r, a_out, false, c, dp, rp);
    }
  }
  var under = c;
  if (g.wb > 0.0) { under = g.back / g.wb; }
  if (!(g.wf > 0.0)) { return under; }
  let cov = min(1.0, g.wf);
  return under * (1.0 - cov) + (g.front / g.wf) * cov;
}`;

const LENS_BLUR: FilterKernel = {
  wgsl: /* wgsl */ `
struct Params { focus: f32, half: f32, scale: f32, back_only: u32, blur: f32, fg_max: f32, shape: u32, cats: f32, gain: f32, threshold: f32, uses_depth: u32 }
fn coc(q: vec2f, d: f32) -> f32 {
  let s = d - params.focus;
  if (params.back_only == 1u && s > 0.0) { return 0.0; }
  return min(params.blur, params.scale * max(0.0, abs(s) - params.half));
}
${GATHER}
fn effect(p: vec2f, c: vec4f) -> vec4f { return gather(p, c); }`,
  pack: (p, canvas) => {
    const l = lensSettings(p, canvas);
    return { uniform: packValues([l.focus, l.half, l.scale, { u32: l.backOnly ? 1 : 0 }, l.blur, l.fgMax, { u32: l.shape }, l.cats, l.gain, l.threshold, { u32: 1 }]) };
  },
};

const TILT_SHIFT: FilterKernel = {
  wgsl: /* wgsl */ `
struct Params { focus: vec2f, normal: vec2f, half: f32, inv_t: f32, depth_focus: f32, depth_half: f32, depth_inv_t: f32, blur: f32, fg_max: f32, uses_depth: u32, shape: u32, cats: f32, gain: f32, threshold: f32, sat: f32, con: f32 }
const W709 = vec3f(0.2126, 0.7152, 0.0722);
const CONTRAST_S: f32 = ${f(CONTRAST_S)};
fn coc(q: vec2f, d: f32) -> f32 {
  var t: f32;
  if (params.uses_depth == 1u) { t = (abs(d - params.depth_focus) - params.depth_half) * params.depth_inv_t; }
  else { t = (abs(dot(q - params.focus, params.normal)) - params.half) * params.inv_t; }
  return params.blur * smoothstep(0.0, 1.0, t);
}
${GATHER}
// The miniature's finish (the reference's \`finish\`): saturation, then an S-curve, light above white kept.
fn finish(c: vec4f) -> vec4f {
  if ((params.sat == 0.0 && params.con == 0.0) || !(c.a > 0.0)) { return c; }
  let l = unpremul(c);
  let e = enc3(l);
  let g = dot(W709, e);
  let v = clamp(g + (e - g) * (1.0 + params.sat), vec3f(0.0), vec3f(1.0));
  let s = clamp(v + params.con * CONTRAST_S * (v * v * (3.0 - 2.0 * v) - v), vec3f(0.0), vec3f(1.0));
  return premul(dec3(s) + max(l - 1.0, vec3f(0.0)), c.a);
}
fn effect(p: vec2f, c: vec4f) -> vec4f {
  var b = c;
  if (params.blur > 0.0) { b = gather(p, c); }
  return finish(b);
}`,
  pack: (p, canvas) => {
    const t = tiltSettings(p, canvas);
    return {
      uniform: packValues([t.fx, t.fy, t.nx, t.ny, t.half, t.invT, t.depthFocus, t.depthHalf, t.depthInvT, t.blur, t.fgMax, { u32: t.usesDepth ? 1 : 0 }, { u32: 0 }, 0, t.gain, TILT_THRESHOLD, t.sat, t.con]),
    };
  },
};

export const FOCUS_KERNELS: Record<string, FilterKernel> = { "lens-blur": LENS_BLUR, "tilt-shift": TILT_SHIFT };
