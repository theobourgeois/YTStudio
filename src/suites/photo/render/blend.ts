/**
 * Blend modes and Blending Options on the GPU (docs/photo/layer-style/README.md, phase L1): the same steps as the
 * CPU reference `shared/photo/reference/blend.ts`, which they're tested against. Values arrive premultiplied in the
 * plan's compositing ("photoshop": encoded, "linear": linear light) and leave the same way.
 *
 * `BLEND` is the WGSL library (the blend pass and the adjustments use it); `packBlend` writes its uniform,
 * `BlendParams` (176 bytes).
 */
import { BLEND_IF_CHANNELS, BLEND_MODES, SPECIAL_FILL } from "@shared/photo/blending.ts";
import { EDGE, HARD_MIX_TIE } from "@shared/photo/reference/blend.ts";
import type { NodeBlend } from "@shared/photo/render-plan.ts";
import type { BlendMode, Compositing } from "@shared/photo/types.ts";

/** A mode's number in the shaders: its place in Photoshop's menu. */
export const modeIndex = (mode: BlendMode) => BLEND_MODES.findIndex((m) => m.id === mode);
const M = (mode: BlendMode) => `${modeIndex(mode)}u`;
const UNBOUNDED: BlendMode[] = ["normal", "dissolve", "darken", "lighten", "multiply", "screen", "linear-dodge", "difference", "subtract", "darker-color", "lighter-color"];

export const BLEND_PARAMS_SIZE = 176;

/** The uniform's WGSL: mode, compositing, Fill, Opacity, channels and Blend If, and where the view is (Dissolve). */
export const BLEND_STRUCT = /* wgsl */ `
struct BlendParams {
  mode: u32,
  encoded: u32,
  fill: f32,
  opacity: f32,
  channels: u32,     // bit 0 red, 1 green, 2 blue: the ones that blend
  entries: u32,      // Blend If's entries in use: bit 0 gray, 1 red, 2 green, 3 blue
  seed: u32,
  dissolve: u32,     // 1: speckle in document pixels; 0: Dissolve draws as Normal (a reduced view: its mean)
  origin: vec2f,     // the document point at the target's top-left
  zoom: f32,
  p0: f32,
  ranges: array<vec4f, 8>,  // per entry: This Layer's range, then Underlying Layer's (0..255)
}
`;

export const BLEND = /* wgsl */ `
const EDGE: f32 = ${EDGE};
const HARD_MIX_TIE: f32 = ${HARD_MIX_TIE};

// sRGB's curve, sign-mirrored and extended past 1 (colour.ts's linearToSrgb / srgbToLinear on any value).
fn enc1(l: f32) -> f32 {
  let a = abs(l);
  var v = a * 12.92;
  if (a > 0.0031308049535603713) { v = 1.055 * pow(a, 1.0 / 2.4) - 0.055; }
  return select(v, -v, l < 0.0);
}
fn dec1(v: f32) -> f32 {
  let a = abs(v);
  var l = a / 12.92;
  if (a > 0.04045) { l = pow((a + 0.055) / 1.055, 2.4); }
  return select(l, -l, v < 0.0);
}
fn enc3(c: vec3f) -> vec3f { return vec3f(enc1(c.r), enc1(c.g), enc1(c.b)); }
fn dec3(c: vec3f) -> vec3f { return vec3f(dec1(c.r), dec1(c.g), dec1(c.b)); }

// A premultiplied pixel converted between linear light and encoded values (alpha kept).
fn premult_encode(c: vec4f) -> vec4f {
  if (c.a <= 0.0) { return vec4f(0.0); }
  return vec4f(enc3(c.rgb / c.a) * c.a, c.a);
}
fn premult_decode(c: vec4f) -> vec4f {
  if (c.a <= 0.0) { return vec4f(0.0); }
  return vec4f(dec3(c.rgb / c.a) * c.a, c.a);
}

fn lum(c: vec3f) -> f32 { return dot(c, vec3f(0.3, 0.59, 0.11)); }

fn clip_colour(c: vec3f) -> vec3f {
  let l = lum(c);
  let n = min(c.r, min(c.g, c.b));
  let x = max(c.r, max(c.g, c.b));
  var out = c;
  if (n < 0.0) { out = l + (out - l) * l / max(l - n, 1e-12); }
  if (x > 1.0) { out = l + (out - l) * (1.0 - l) / max(x - l, 1e-12); }
  return out;
}
fn set_lum(c: vec3f, l: f32) -> vec3f { return clip_colour(c + (l - lum(c))); }
fn sat(c: vec3f) -> f32 { return max(c.r, max(c.g, c.b)) - min(c.r, min(c.g, c.b)); }
fn set_sat(c: vec3f, s: f32) -> vec3f {
  let mx = max(c.r, max(c.g, c.b));
  let mn = min(c.r, min(c.g, c.b));
  if (mx <= mn) { return vec3f(0.0); }
  var out = (c - mn) * s / (mx - mn);
  out = select(out, vec3f(s), c == vec3f(mx));
  out = select(out, vec3f(0.0), c == vec3f(mn));
  return out;
}

fn colour_burn(b: f32, s: f32) -> f32 {
  if (b >= 1.0 - EDGE) { return 1.0; }
  if (s <= EDGE) { return 0.0; }
  return 1.0 - min(1.0, (1.0 - b) / s);
}
fn colour_dodge(b: f32, s: f32) -> f32 {
  if (b <= EDGE) { return 0.0; }
  if (s >= 1.0 - EDGE) { return 1.0; }
  return min(1.0, b / (1.0 - s));
}
fn hard_light(b: f32, s: f32) -> f32 {
  if (s <= 0.5) { return b * 2.0 * s; }
  return 1.0 - (1.0 - b) * (1.0 - (2.0 * s - 1.0));
}
fn soft_light(b: f32, s: f32) -> f32 {
  if (s <= 0.5) { return b - (1.0 - 2.0 * s) * b * (1.0 - b); }
  var d = sqrt(b);
  if (b <= 0.25) { d = ((16.0 * b - 12.0) * b + 4.0) * b; }
  return b + (2.0 * s - 1.0) * (d - b);
}
fn vivid_light(b: f32, s: f32) -> f32 {
  if (s <= EDGE) { return 0.0; }
  if (s >= 1.0 - EDGE) { return 1.0; }
  if (s <= 0.5) { return colour_burn(b, 2.0 * s); }
  return colour_dodge(b, 2.0 * s - 1.0);
}
fn hard_mix(b: f32, s: f32) -> f32 {
  let sum = b + s;
  if (abs(sum - 1.0) < HARD_MIX_TIE) { return select(0.0, 1.0, b > 0.5); }
  return select(0.0, 1.0, sum > 1.0);
}

fn channel(mode: u32, b: f32, s: f32, f: f32) -> f32 {
  switch (mode) {
    case ${M("darken")}: { return min(b, s); }
    case ${M("multiply")}: { return b * s; }
    case ${M("color-burn")}: { return colour_burn(b, 1.0 - f * (1.0 - s)); }
    case ${M("linear-burn")}: { return b - f * (1.0 - s); }
    case ${M("lighten")}: { return max(b, s); }
    case ${M("screen")}: { return b + s - b * s; }
    case ${M("color-dodge")}: { return colour_dodge(b, f * s); }
    case ${M("linear-dodge")}: { return b + f * s; }
    case ${M("overlay")}: { return hard_light(s, b); }
    case ${M("soft-light")}: { return soft_light(b, s); }
    case ${M("hard-light")}: { return hard_light(b, s); }
    case ${M("vivid-light")}: { return vivid_light(b, 0.5 + f * (s - 0.5)); }
    case ${M("linear-light")}: { return b + f * (2.0 * s - 1.0); }
    case ${M("pin-light")}: { return select(max(b, 2.0 * s - 1.0), min(b, 2.0 * s), s <= 0.5); }
    case ${M("hard-mix")}: {
      if (f >= 1.0) { return hard_mix(b, s); }
      return clamp((b - f * (1.0 - s)) / (1.0 - f), 0.0, 1.0);
    }
    case ${M("difference")}: { return abs(b - f * s); }
    case ${M("exclusion")}: { return b + s - 2.0 * b * s; }
    case ${M("subtract")}: { return b - s; }
    case ${M("divide")}: {
      if (s <= EDGE) { return select(1.0, 0.0, b <= EDGE); }
      return b / s;
    }
    default: { return s; }
  }
}

fn is_special(mode: u32) -> bool {
  return ${[...SPECIAL_FILL].map((m) => `mode == ${M(m)}`).join(" || ")};
}
fn is_unbounded(mode: u32) -> bool {
  return ${UNBOUNDED.map((m) => `mode == ${M(m)}`).join(" || ")};
}

// The mode's colour B(b, s) at Fill f (only the special eight use it), clamped no further out than its inputs.
fn blend_colour(mode: u32, b_in: vec3f, s_in: vec3f, f: f32) -> vec3f {
  var b = b_in;
  var s = s_in;
  if (!is_unbounded(mode)) { b = clamp(b, vec3f(0.0), vec3f(1.0)); s = clamp(s, vec3f(0.0), vec3f(1.0)); }
  var out: vec3f;
  switch (mode) {
    case ${M("hue")}: { out = set_lum(set_sat(s, sat(b)), lum(b)); }
    case ${M("saturation")}: { out = set_lum(set_sat(b, sat(s)), lum(b)); }
    case ${M("color")}: { out = set_lum(s, lum(b)); }
    case ${M("luminosity")}: { out = set_lum(b, lum(s)); }
    case ${M("darker-color")}: { out = select(b, s, lum(s) < lum(b)); }
    case ${M("lighter-color")}: { out = select(b, s, lum(s) > lum(b)); }
    default: {
      let ff = select(1.0, f, is_special(mode));
      out = vec3f(channel(mode, b.r, s.r, ff), channel(mode, b.g, s.g, ff), channel(mode, b.b, s.b, ff));
    }
  }
  return clamp(out, min(vec3f(0.0), min(b, s)), max(vec3f(1.0), max(b, s)));
}

fn range_pass(r: vec4f, v: f32) -> f32 {
  let low = clamp((v - r.x + 1.0) / (r.y - r.x + 1.0), 0.0, 1.0);
  let high = clamp((r.w - v + 1.0) / (r.w - r.z + 1.0), 0.0, 1.0);
  return min(low, high);
}

// Blend If on straight encoded colours: This Layer on the layer's, Underlying on the backdrop's.
fn blend_if_gate(p: BlendParams, s: vec3f, d: vec3f, da: f32) -> f32 {
  if (p.entries == 0u) { return 1.0; }
  let sv = clamp(s, vec3f(0.0), vec3f(1.0)) * 255.0;
  let dv = clamp(d, vec3f(0.0), vec3f(1.0)) * 255.0;
  var sval = array<f32, 4>(dot(sv, vec3f(0.299, 0.59, 0.111)), sv.r, sv.g, sv.b);
  var dval = array<f32, 4>(dot(dv, vec3f(0.299, 0.59, 0.111)), dv.r, dv.g, dv.b);
  var g_this = 1.0;
  var g_under = 1.0;
  for (var i = 0u; i < 4u; i++) {
    if ((p.entries & (1u << i)) == 0u) { continue; }
    g_this *= range_pass(p.ranges[2u * i], sval[i]);
    g_under *= range_pass(p.ranges[2u * i + 1u], dval[i]);
  }
  return g_this * (1.0 - da + da * g_under);
}

fn straight(c: vec4f) -> vec3f {
  if (c.a <= 0.0) { return vec3f(0.0); }
  return c.rgb / c.a;
}
// Straight colour as Blend If reads it: encoded, whatever the compositing.
fn gate_colour(p: BlendParams, c: vec3f) -> vec3f { return select(enc3(c), c, p.encoded == 1u); }

// A layer's pixel (premultiplied, its mask in its alpha) onto the backdrop's, both in the compositing's values:
// reference/blend.ts's compositePixel. \`doc\` is the document pixel (Dissolve's speckle).
fn composite_pixel(p: BlendParams, backdrop: vec4f, layer: vec4f, doc: vec2f) -> vec4f {
  let ba = clamp(backdrop.a, 0.0, 1.0);
  let la = clamp(layer.a, 0.0, 1.0);
  let b = straight(backdrop);
  let s = straight(layer);
  var mode = p.mode;
  var coverage = la * blend_if_gate(p, gate_colour(p, s), gate_colour(p, b), ba);
  var opacity = p.opacity;
  var fill = p.fill;
  if (mode == ${M("dissolve")}) {
    mode = ${M("normal")};
    if (p.dissolve == 1u) {
      // The same bits as reference/blend.ts's dissolveThreshold (a negative pixel wraps as \`>>> 0\` does).
      let d = bitcast<vec2u>(vec2i(floor(doc)));
      let t = f32(hash2(d.x, d.y ^ p.seed) >> 8u) / 16777216.0;
      coverage = select(0.0, 1.0, t < coverage * fill * opacity);
      opacity = 1.0;
      fill = 1.0;
    }
  }
  let special = is_special(mode);
  let mixed = blend_colour(mode, b, s, select(1.0, fill, special));
  let weight = coverage * opacity * select(fill, 1.0, special);
  let added = coverage * fill * opacity;
  let alpha = added + ba * (1.0 - added);
  var out = s * added * (1.0 - ba) + mixed * weight * ba + b * ba * (1.0 - weight);
  let keep = vec3<bool>((p.channels & 1u) != 0u, (p.channels & 2u) != 0u, (p.channels & 4u) != 0u);
  out = select(b * ba, out, keep);
  if (alpha <= 0.0) { return vec4f(0.0); }
  return vec4f(out, alpha);
}

// An adjustment's result onto what it adjusted (both premultiplied, in the compositing's values; alpha unchanged):
// reference/blend.ts's compositeAdjustment.
fn composite_adjustment(p: BlendParams, original: vec4f, adjusted: vec4f, mask: f32) -> vec4f {
  let a = clamp(original.a, 0.0, 1.0);
  if (a <= 0.0) { return original; }
  let b = straight(original);
  let s = adjusted.rgb / a;
  let gate = blend_if_gate(p, gate_colour(p, s), gate_colour(p, b), 1.0);
  var mode = p.mode;
  if (mode == ${M("dissolve")}) { mode = ${M("normal")}; }
  let special = is_special(mode);
  let mixed = blend_colour(mode, b, s, select(1.0, p.fill, special));
  let k = clamp(mask * gate * p.opacity * select(p.fill, 1.0, special), 0.0, 1.0);
  let keep = vec3<bool>((p.channels & 1u) != 0u, (p.channels & 2u) != 0u, (p.channels & 4u) != 0u);
  let c = select(b, b + (mixed - b) * k, keep);
  return vec4f(c * a, original.a);
}
`;

/**
 * The uniform for a node's blending: its mode (Normal when null: a plain layer or adjustment), Fill, Opacity,
 * channels and Blend If, the compositing, and the view (Dissolve's document pixels; below 100% it draws its mean).
 */
export function packBlend(blend: NodeBlend | null, opacity: number, compositing: Compositing, view: { x: number; y: number; zoom: number }, into = new ArrayBuffer(BLEND_PARAMS_SIZE), offset = 0): ArrayBuffer {
  const u = new Uint32Array(into, offset, BLEND_PARAMS_SIZE / 4);
  const f = new Float32Array(into, offset, BLEND_PARAMS_SIZE / 4);
  const channels = blend ? blend.channels : { r: true, g: true, b: true };
  let entries = 0;
  BLEND_IF_CHANNELS.forEach((entry, i) => {
    const e = blend?.blendIf[entry];
    if (!e) return;
    entries |= 1 << i;
    f.set(e.layer, 12 + i * 8);
    f.set(e.underlying, 12 + i * 8 + 4);
  });
  u[0] = modeIndex(blend?.mode ?? "normal");
  u[1] = compositing === "photoshop" ? 1 : 0;
  f[2] = blend?.fill ?? 1;
  f[3] = opacity;
  u[4] = (channels.r ? 1 : 0) | (channels.g ? 2 : 0) | (channels.b ? 4 : 0);
  u[5] = entries;
  u[6] = blend?.seed ?? 0;
  u[7] = view.zoom >= 1 ? 1 : 0;
  f[8] = view.x;
  f[9] = view.y;
  f[10] = view.zoom;
  return into;
}
