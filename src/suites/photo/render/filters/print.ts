/** The print filters' WGSL (shared/photo/effects/filters/print.ts), mirroring `reference/filters/print.ts`. */
import { ASCII_GLYPHS, ASCII_TEXT_ASPECT } from "@shared/photo/effects/filters/print.ts";
import { risoOffsets, risoSeparation } from "@shared/photo/reference/filters/print.ts";
import { hexEncoded } from "@shared/photo/reference/kernel.ts";
import { type FilterKernel, packValues } from "../kernel.ts";

const rgba = (hex: string) => [...hexEncoded(hex), 1];

/** Where a pattern reads its content (reference: stylize's held). */
const HELD = /* wgsl */ `
// Inside the canvas when p is, so a cell cut by its edge reads the edge rather than the transparency past it.
fn held(d: vec2f, p: vec2f) -> vec2f {
  if (p.x < 0.0 || p.y < 0.0 || p.x > header.canvas.x || p.y > header.canvas.y) { return d; }
  return clamp(d, vec2f(0.5), header.canvas - 0.5);
}`;


const RISOGRAPH: FilterKernel = {
  wgsl: /* wgsl */ `
struct Params { r0: vec4f, r1: vec4f, r2: vec4f, ink0: vec4f, ink1: vec4f, ink2: vec4f, paper: vec4f, off01: vec4f, off2: vec4f, count: u32, density: f32, gs: f32, amount: f32, texture: f32, seed: u32, p0: f32, p1: f32 }
${HELD}

// An ink's stochastic screen (reference: risoScreen).
fn riso_screen(q: vec2f, seed: u32) -> f32 {
  let a = vnoise(q, seed);
  let b = vnoise(vec2f(q.x * 2.31 + 17.3, q.y * 2.31 + 5.9), seed + 1u);
  return clamp((0.62 * a + 0.38 * b - 0.5) * 2.1 + 0.5, 0.0, 1.0);
}

fn effect(p: vec2f, c: vec4f) -> vec4f {
  let seed = params.seed;
  let gs = params.gs;
  let fibre = max(gs, 1.0);
  let fine = vnoise(vec2f(p.x / (3.0 * fibre), p.y / (1.2 * fibre)), seed + 40u) - 0.5;
  let broad = vnoise(vec2f(p.x / (40.0 * fibre), p.y / (40.0 * fibre)), seed + 41u) - 0.5;
  let tex = 1.0 + params.texture * (0.1 * fine * smoothstep(0.6, 1.6, (1.2 * fibre) / px()) + 0.08 * broad);
  var out = params.paper.rgb * tex;
  let w = max(px() / gs, 0.05);
  let sharp = smoothstep(0.6, 1.6, gs / px());
  for (var i = 0u; i < params.count; i++) {
    var off = params.off2.xy;
    var row = params.r2.xyz;
    var ink = params.ink2.rgb;
    if (i == 0u) {
      off = params.off01.xy;
      row = params.r0.xyz;
      ink = params.ink0.rgb;
    } else if (i == 1u) {
      off = params.off01.zw;
      row = params.r1.xyz;
      ink = params.ink1.rgb;
    }
    // The drum's grain moves with it; its colour is read on the canvas.
    let q = p - off;
    let s = src(held(q, p));
    let v = enc3(unpremul(s));
    let al = clamp(s.a, 0.0, 1.0);
    var d = clamp((row.x * (1.0 - v.r) + row.y * (1.0 - v.g) + row.z * (1.0 - v.b)) * al * params.density, 0.0, 1.0);
    d *= 1.0 - 0.3 * params.amount * vnoise(vec2f(q.x / (12.0 * gs), q.y / (12.0 * gs)), seed + 10u + i);
    let t = riso_screen(q / gs, seed + 20u + 2u * i);
    var screened = clamp((d - t) / w + 0.5, 0.0, 1.0);
    screened = max(min(screened, d / w), 1.0 - (1.0 - d) / w);
    let cover = mix(d, mix(d, screened, sharp), params.amount);
    out = out * mix(vec3f(1.0), ink, cover);
  }
  return from_encoded(out, c.a);
}`,
  pack: (p) => {
    const count = p.inks === "3" ? 3 : 2;
    const inks = [p.ink1, p.ink2, p.ink3].map((h) => hexEncoded(h as string));
    const rows = risoSeparation(inks.slice(0, count));
    const off = risoOffsets(p.misregistration as number, p.seed as number);
    return {
      uniform: packValues([
        ...rows[0],
        0,
        ...rows[1],
        0,
        ...rows[2],
        0,
        ...inks.flatMap((ink) => [...ink, 1]),
        ...rgba(p.paper as string),
        off[0][0],
        off[0][1],
        off[1][0],
        off[1][1],
        off[2][0],
        off[2][1],
        0,
        0,
        { u32: count },
        (p.density as number) / 100,
        p.grainSize as number,
        (p.grain as number) / 100,
        (p.texture as number) / 100,
        { u32: p.seed as number },
      ]),
    };
  },
};

/** ASCII's font as WGSL: each glyph's bits (reference: ASCII_GLYPHS). */
const GLYPHS = `var<private> GLYPHS: array<vec2u, ${ASCII_GLYPHS.length}> = array<vec2u, ${ASCII_GLYPHS.length}>(${ASCII_GLYPHS.map((g) => `vec2u(${g.lo}u, ${g.hi}u)`).join(", ")});`;

const ASCII: FilterKernel = {
  wgsl: /* wgsl */ `
struct Params { ink: vec4f, background: vec4f, ch: f32, cw: f32, g: f32, mode: u32, contrast: f32, invert: u32, rain: f32, seed: u32, brightness: f32, p0: f32, p1: f32, p2: f32 }
${HELD}
${GLYPHS}

// A glyph's pixel (column i, row j): 1 lit, 0 not or outside its 5 × 7 (reference: glyphBit).
fn glyph_bit(g: u32, i: i32, j: i32) -> f32 {
  if (i < 0 || j < 0 || i >= 5 || j >= 7) { return 0.0; }
  let bit = u32(j * 5 + i);
  let w = GLYPHS[g];
  if (bit < 32u) { return f32((w.x >> bit) & 1u); }
  return f32((w.y >> (bit - 32u)) & 1u);
}

fn over(i: i32, v: f32, f: f32) -> f32 {
  return max(0.0, min(f32(i + 1), v + f / 2.0) - max(f32(i), v - f / 2.0)) / f;
}

// How much of a box f glyph pixels wide around (x, y) the glyph covers (reference: glyphCover).
fn glyph_cover(g: u32, x: f32, y: f32, f: f32) -> f32 {
  let i0 = i32(floor(x - f / 2.0));
  let j0 = i32(floor(y - f / 2.0));
  var sum = 0.0;
  for (var j = j0; j <= j0 + 1; j++) {
    for (var i = i0; i <= i0 + 1; i++) { sum += glyph_bit(g, i, j) * over(i, x, f) * over(j, y, f); }
  }
  return sum;
}

fn effect(p: vec2f, c: vec4f) -> vec4f {
  let ch = params.ch;
  let cw = params.cw;
  let g = params.g;
  let seed = params.seed;
  let ix = i32(floor(p.x / cw));
  let iy = i32(floor(p.y / ch));
  var sum = vec4f(0.0);
  for (var j = 0; j < 3; j++) {
    for (var i = 0; i < 2; i++) {
      sum += src(held(vec2f((f32(ix) + (f32(i) + 0.5) / 2.0) * cw, (f32(iy) + (f32(j) + 0.5) / 3.0) * ch), p)) / 6.0;
    }
  }
  let v = enc3(unpremul(sum));
  let b = clamp((enc(luma(unpremul(sum))) + params.brightness - 0.5) * params.contrast + 0.5, 0.0, 1.0);
  var density = b;
  if (params.mode == 2u) { density = 1.0 - b; }
  if (params.invert == 1u) { density = 1.0 - density; }
  let n = f32(${ASCII_GLYPHS.length});
  let glyph = u32(min(n - 1.0, floor(density * n)));
  var ox = f32(ix) * cw + (cw - 5.0 * g) / 2.0;
  var oy = f32(iy) * ch + g;
  var strike = 1.0;
  if (params.mode == 2u) {
    ox += (rand(ix, iy, seed + 7u) - 0.5) * 0.3 * g;
    oy += (rand(ix, iy, seed + 8u) - 0.5) * 0.8 * g;
    strike = 0.72 + 0.28 * rand(ix, iy, seed + 9u);
  }
  let detail = smoothstep(0.5, 1.2, g / px());
  let bits = GLYPHS[glyph];
  let mean = (f32(countOneBits(bits.x) + countOneBits(bits.y)) * g * g) / (cw * ch);
  let cover = mix(mean, glyph_cover(glyph, (p.x - ox) / g, (p.y - oy) / g, min(1.0, px() / g)), detail) * strike;
  var colour = params.ink.rgb;
  if (params.mode == 1u) {
    let top = max(0.05, max(v.r, max(v.g, v.b)));
    colour = mix(v, v / top, 0.6);
  }
  if (params.rain > 0.0 && params.mode != 2u) {
    let streak = 8.0 + 16.0 * rand(ix, 1, seed);
    let t = fract(f32(iy) / streak + rand(ix, 2, seed));
    let trail = mix(1.0, 0.12 + 0.88 * t * t, params.rain);
    var head = 0.0;
    if (t > 1.0 - 1.0 / streak) { head = 0.75 * params.rain; }
    colour = mix(colour * trail, vec3f(1.0), head);
  }
  return from_encoded(mix(params.background.rgb, colour, cover), clamp(sum.a, 0.0, 1.0));
}`,
  pack: (p) => {
    const ch = p.cellSize as number;
    return {
      uniform: packValues([
        ...rgba(p.ink as string),
        ...rgba(p.background as string),
        ch,
        p.cells === "square" ? ch : ch * ASCII_TEXT_ASPECT,
        ch / 9,
        { u32: p.mode === "own" ? 1 : p.mode === "paper" ? 2 : 0 },
        1 + 3 * ((p.contrast as number) / 100),
        { u32: p.invert ? 1 : 0 },
        (p.rain as number) / 100,
        { u32: p.seed as number },
        0.5 * ((p.brightness as number) / 100),
      ]),
    };
  },
};


export const PRINT_KERNELS: Record<string, FilterKernel> = { risograph: RISOGRAPH, ascii: ASCII };
