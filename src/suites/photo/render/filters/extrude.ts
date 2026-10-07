/** Extrude's WGSL (shared/photo/effects/filters/extrude.ts), mirroring `reference/filters/extrude.ts`. */
import { EXTRUDE_MAX_BLOCKS } from "@shared/photo/effects/filters/extrude.ts";
import { EXTRUDE_LIGHT, EXTRUDE_STEPS } from "@shared/photo/reference/filters/extrude.ts";
import { type FilterKernel, packValues } from "../kernel.ts";

/** Where a pattern reads its content (reference: stylize's held). */
const HELD = /* wgsl */ `
// Inside the canvas when p is, so a cell cut by its edge reads the edge rather than the transparency past it.
fn held(d: vec2f, p: vec2f) -> vec2f {
  if (p.x < 0.0 || p.y < 0.0 || p.x > header.canvas.x || p.y > header.canvas.y) { return d; }
  return clamp(d, vec2f(0.5), header.canvas - 0.5);
}`;


const EXTRUDE: FilterKernel = {
  wgsl: /* wgsl */ `
struct Params { dir: vec2f, size: f32, depth: f32, pyramids: u32, random: u32, solid: u32, seed: u32 }
${HELD}

// The light the faces are shaded by (reference: EXTRUDE_LIGHT), and the steps of a ray (EXTRUDE_STEPS).
const LIGHT = vec3f(${EXTRUDE_LIGHT.join(", ")});
const AMBIENT: f32 = 0.35;
const STEPS: i32 = ${EXTRUDE_STEPS};

// A face's shade by its normal, relative to a flat top's (reference: extrudeShade).
fn shade(n: vec3f) -> f32 {
  return (AMBIENT + (1.0 - AMBIENT) * max(0.0, dot(n, LIGHT))) / (AMBIENT + (1.0 - AMBIENT) * LIGHT.z);
}
fn cross2(a: vec2f, b: vec2f) -> f32 { return a.x * b.y - a.y * b.x; }

// The cover of the parallelogram o + u e1 + v e2 at p, and v there (reference: parallelogram).
fn parallelogram(p: vec2f, o: vec2f, e1: vec2f, e2: vec2f) -> vec2f {
  let area = cross2(e1, e2);
  if (!(abs(area) > 1e-6)) { return vec2f(0.0); }
  let l1 = length(e1);
  let l2 = length(e2);
  var n1 = vec2f(-e1.y, e1.x) / l1;
  if (dot(n1, e2) < 0.0) { n1 = -n1; }
  var n2 = vec2f(-e2.y, e2.x) / l2;
  if (dot(n2, e1) < 0.0) { n2 = -n2; }
  let r = p - o;
  let a1 = dot(n1, r);
  let a2 = dot(n2, r);
  let sd = max(max(-a1, a1 - dot(n1, e2)), max(-a2, a2 - dot(n2, e1)));
  let cover = clamp(0.5 - sd / px(), 0.0, 1.0) * min(1.0, abs(area) / l1 / px());
  return vec2f(cover, clamp(cross2(e1, r) / area, 0.0, 1.0));
}

fn edge_sd(s: vec2f, t: vec2f, p: vec2f) -> f32 { return -cross2(t - s, p - s) / length(t - s); }
fn corner(o: vec2f, size: f32, k: i32) -> vec2f {
  let m = k % 4;
  return o + vec2f(select(0.0, size, m == 1 || m == 2), select(0.0, size, m >= 2));
}
fn normal(k: i32) -> vec2f {
  if (k == 0) { return vec2f(0.0, -1.0); }
  if (k == 1) { return vec2f(1.0, 0.0); }
  if (k == 2) { return vec2f(0.0, 1.0); }
  return vec2f(-1.0, 0.0);
}

// One block as seen at a point (reference: Seen).
struct Seen { z: f32, cover: f32, front: f32, front_shade: f32, side_shade: f32, alpha: f32, lift: f32, colour: vec3f }
var<private> seen: array<Seen, 3>;
var<private> seen_count: i32;

fn keep(s: Seen) {
  var at = seen_count;
  while (at > 0 && s.z > seen[at - 1].z) { at--; }
  if (at < 3) {
    var k = min(seen_count, 2);
    while (k > at) {
      seen[k] = seen[k - 1];
      k--;
    }
    seen[at] = s;
    seen_count = min(seen_count + 1, 3);
  }
}

fn see(p: vec2f, i: i32, j: i32) {
  let size = params.size;
  var sum = vec4f(0.0);
  for (var b = 0; b < 2; b++) {
    for (var a = 0; a < 2; a++) {
      sum += src(held(vec2f((f32(i) + 0.25 + 0.5 * f32(a)) * size, (f32(j) + 0.25 + 0.5 * f32(b)) * size), p)) / 4.0;
    }
  }
  let lin = unpremul(sum);
  let alpha = clamp(sum.a, 0.0, 1.0);
  var level = enc(luma(lin));
  if (params.random == 1u) { level = rand(i, j, params.seed); }
  let h = params.depth * level * alpha;
  let o = vec2f(f32(i), f32(j)) * size;
  let hd = h * params.dir;
  var s: Seen;
  s.colour = enc3(lin);
  s.alpha = alpha;
  s.front_shade = 1.0;
  s.side_shade = 0.0;
  s.lift = h;
  var cover = 0.0;
  if (params.pyramids == 0u) {
    let fp = p - hd - (o + size / 2.0);
    let af = clamp(0.5 - (max(abs(fp.x), abs(fp.y)) - size / 2.0) / px(), 0.0, 1.0);
    let xe = select(o.x + size, o.x, params.dir.x > 0.0);
    let ye = select(o.y + size, o.y, params.dir.y > 0.0);
    let wx = parallelogram(p, vec2f(xe, o.y), vec2f(0.0, size), hd);
    let wy = parallelogram(p, vec2f(o.x, ye), vec2f(size, 0.0), hd);
    let sx = shade(vec3f(select(1.0, -1.0, params.dir.x > 0.0), 0.0, 0.0)) * mix(0.6, 1.0, wx.y);
    let sy = shade(vec3f(0.0, select(1.0, -1.0, params.dir.y > 0.0), 0.0)) * mix(0.6, 1.0, wy.y);
    let sides = wx.x + wy.x;
    cover = af + sides;
    if (!(cover > 0.0)) { return; }
    s.z = (af * h + wx.x * wx.y * h + wy.x * wy.y * h) / cover;
    s.front = af / cover;
    if (sides > 0.0) { s.side_shade = (wx.x * sx + wy.x * sy) / sides; }
  } else {
    let apex = o + size / 2.0 + hd;
    var zs = 0.0;
    var shades = 0.0;
    for (var k = 0; k < 4; k++) {
      let c0 = corner(o, size, k);
      let c1 = corner(o, size, k + 1);
      let e = c1 - c0;
      let area = cross2(e, apex - c0);
      if (!(area > 1e-4 * size * size)) { continue; }
      let sd = max(edge_sd(c0, c1, p), max(edge_sd(c1, apex, p), edge_sd(apex, c0, p)));
      let a = clamp(0.5 - sd / px(), 0.0, 1.0) * min(1.0, area / size / px());
      if (!(a > 0.0)) { continue; }
      let zk = h * clamp(cross2(e, p - c0) / area, 0.0, 1.0);
      let n3 = vec3f(normal(k) * h, size / 2.0);
      cover += a;
      zs += a * zk;
      shades += a * shade(n3 / length(n3));
    }
    if (!(cover > 0.0)) { return; }
    s.z = zs / cover;
    s.front = 1.0;
    s.front_shade = shades / cover;
    s.lift = s.z;
  }
  s.cover = min(1.0, cover);
  keep(s);
}

fn effect(p: vec2f, c: vec4f) -> vec4f {
  seen_count = 0;
  let size = params.size;
  let dir = params.dir;
  let m = min(0.5 * px(), 0.25 * size);
  let ahead = 1.42 * size;
  let len = ahead + params.depth + m;
  var first: array<vec2i, ${EXTRUDE_STEPS}>;
  var n_first = 0;
  for (var side = 0; side < 2; side++) {
    var off = m;
    if (side == 0) { off = -m; }
    let st = vec2f(p.x - dir.y * off + dir.x * ahead, p.y + dir.x * off + dir.y * ahead);
    let d = -dir;
    var i = i32(floor(st.x / size));
    var j = i32(floor(st.y / size));
    let ad = abs(d);
    let step_x = select(-1, 1, d.x > 0.0);
    let step_y = select(-1, 1, d.y > 0.0);
    var delta_x = 1e30;
    var delta_y = 1e30;
    var tx = 1e30;
    var ty = 1e30;
    if (ad.x > 1e-6) {
      delta_x = size / ad.x;
      tx = select(st.x - f32(i) * size, f32(i + 1) * size - st.x, d.x > 0.0) / ad.x;
    }
    if (ad.y > 1e-6) {
      delta_y = size / ad.y;
      ty = select(st.y - f32(j) * size, f32(j + 1) * size - st.y, d.y > 0.0) / ad.y;
    }
    for (var k = 0; k < STEPS; k++) {
      if (side == 0) {
        first[n_first] = vec2i(i, j);
        n_first++;
        see(p, i, j);
      } else {
        var again = false;
        for (var q = 0; q < n_first; q++) {
          if (first[q].x == i && first[q].y == j) { again = true; }
        }
        if (!again) { see(p, i, j); }
      }
      if (min(tx, ty) > len) { break; }
      if (tx < ty) {
        i += step_x;
        tx += delta_x;
      } else {
        j += step_y;
        ty += delta_y;
      }
    }
  }
  if (seen_count == 0) { return vec4f(0.0); }
  var rgb = vec3f(0.0);
  var alpha = 0.0;
  var left = 1.0;
  for (var e = 0; e < seen_count; e++) {
    let s = seen[e];
    var cover = s.cover;
    if (e == seen_count - 1) { cover = 1.0; }
    var face = s.colour;
    var face_alpha = s.alpha;
    if (params.solid == 0u) {
      let img = src(held(p - s.lift * dir, p));
      face = enc3(unpremul(img));
      face_alpha = clamp(img.a, 0.0, 1.0);
    }
    let a = s.front * face_alpha + (1.0 - s.front) * s.alpha;
    let wgt = left * cover;
    rgb += wgt * (s.front * face_alpha * clamp(face * s.front_shade, vec3f(0.0), vec3f(1.0)) + (1.0 - s.front) * s.alpha * clamp(s.colour * s.side_shade, vec3f(0.0), vec3f(1.0)));
    alpha += wgt * a;
    left *= 1.0 - cover;
  }
  if (!(alpha > 0.0)) { return vec4f(0.0); }
  return from_encoded(rgb / alpha, alpha);
}`,
  pack: (p) => {
    const size = p.size as number;
    const angle = ((p.angle as number) * Math.PI) / 180;
    return {
      uniform: packValues([
        Math.cos(angle),
        Math.sin(angle),
        size,
        Math.min(p.depth as number, EXTRUDE_MAX_BLOCKS * size),
        { u32: p.shape === "pyramids" ? 1 : 0 },
        { u32: p.height === "random" ? 1 : 0 },
        { u32: p.front === "image" ? 0 : 1 },
        { u32: p.seed as number },
      ]),
    };
  },
};


export const EXTRUDE_KERNELS: Record<string, FilterKernel> = { extrude: EXTRUDE };
