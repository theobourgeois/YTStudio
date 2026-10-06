/** The stylize filters' WGSL (shared/photo/effects/filters/stylize.ts), mirroring `reference/filters/stylize.ts`. */
import { PROCESS_INKS } from "@shared/photo/effects/filters/stylize.ts";
import { hexEncoded } from "@shared/photo/reference/kernel.ts";
import { type FilterKernel, packValues } from "../kernel.ts";

const SHAPES: Record<string, number> = { dot: 0, line: 1, square: 2 };
const MODES: Record<string, number> = { mono: 0, cmyk: 1, colour: 2 };
const rgba = (hex: string) => [...hexEncoded(hex), 1];

/** Where a pattern reads its content (reference: held). */
const HELD = /* wgsl */ `
// Inside the canvas when p is, so a cell cut by its edge reads the edge rather than the transparency past it.
fn held(d: vec2f, p: vec2f) -> vec2f {
  if (p.x < 0.0 || p.y < 0.0 || p.x > header.canvas.x || p.y > header.canvas.y) { return d; }
  return clamp(d, vec2f(0.5), header.canvas - 0.5);
}`;

const HALFTONE: FilterKernel = {
  wgsl: /* wgsl */ `
struct Params { cell: f32, angle: f32, mode: u32, shape: u32, soft: f32, p0: f32, p1: f32, p2: f32, ink: vec4f, paper: vec4f, cyan: vec4f, magenta: vec4f, yellow: vec4f }
${HELD}

// How dark a colour is before CMYK's key starts to print (reference: KEY_FROM).
const KEY_FROM: f32 = 0.3;
// Colour mode's largest ink: full dots just touch (reference: COLOUR_DOT).
const COLOUR_DOT: f32 = 0.65;

// A dot of ink k's cover at offset o from its centre, in cells (reference: shapeCover).
fn shape_cover(k: f32, o: vec2f, aa: f32) -> f32 {
  var r = 0.0;
  var d = 0.0;
  if (params.shape == 0u) {
    r = sqrt(k / PI) * mix(1.0, 1.277, k * k);
    d = length(o);
  } else if (params.shape == 2u) {
    r = sqrt(k) * (0.5 + aa);
    d = max(abs(o.x), abs(o.y));
  } else {
    r = k * (0.5 + aa);
    d = abs(o.y);
  }
  return (1.0 - smoothstep(r - aa, r + aa, d)) * min(1.0, r / aa);
}

// A screen's ink at a document point: the sample's encoded colour, and its ink in .a (reference: inkAt).
fn ink_at(p: vec2f, d: vec2f, ch: u32) -> vec4f {
  let s = src(held(d, p));
  let lin = unpremul(s);
  let v = enc3(lin);
  var k = 0.0;
  if (ch == 4u) {
    k = 1.0 - enc(luma(lin));
  } else if (ch == 5u) {
    let e = abs(v - params.paper.rgb);
    k = COLOUR_DOT * max(e.r, max(e.g, e.b));
  } else {
    let key = clamp((1.0 - max(v.r, max(v.g, v.b)) - KEY_FROM) / (1.0 - KEY_FROM), 0.0, 1.0);
    if (ch == 3u) {
      k = key;
    } else {
      let own = select(select(v.b, v.g, ch == 1u), v.r, ch == 0u);
      k = clamp((1.0 - own - key) / max(1.0 - key, 1e-4), 0.0, 1.0);
    }
  }
  return vec4f(v, k * clamp(s.a, 0.0, 1.0));
}

// One screen at a document point: the colour of the dot covering most, and its cover in .a (reference: screen).
fn screen(p: vec2f, angle: f32, ch: u32) -> vec4f {
  let g = rotate(p, -angle) / params.cell;
  let i = floor(g);
  let f = g - i - 0.5;
  let dir = vec2f(select(-1.0, 1.0, f.x >= 0.0), select(-1.0, 1.0, f.y >= 0.0));
  let aa = 0.5 * px() / params.cell + params.soft * 0.35;
  var best = vec4f(0.0);
  for (var j = 0; j < 2; j++) {
    let oy = f32(j) * dir.y;
    let a = ink_at(p, rotate(vec2f((i.x + 0.5) * params.cell, (i.y + 0.5 + oy) * params.cell), angle), ch);
    let b = ink_at(p, rotate(vec2f((i.x + 0.5 + dir.x) * params.cell, (i.y + 0.5 + oy) * params.cell), angle), ch);
    if (params.shape == 1u) {
      let t = abs(f.x);
      let cover = shape_cover(mix(a.a, b.a, t), vec2f(0.0, f.y - oy), aa);
      if (cover > best.a) { best = vec4f(mix(a.rgb, b.rgb, t), cover); }
    } else {
      let ca = shape_cover(a.a, vec2f(f.x, f.y - oy), aa);
      if (ca > best.a) { best = vec4f(a.rgb, ca); }
      let cb = shape_cover(b.a, vec2f(f.x - dir.x, f.y - oy), aa);
      if (cb > best.a) { best = vec4f(b.rgb, cb); }
    }
  }
  return best;
}

fn effect(p: vec2f, c: vec4f) -> vec4f {
  let paper = params.paper.rgb;
  var res = paper;
  if (params.mode == 1u) {
    // The printers' angles, relative to the key's.
    res = res * mix(vec3f(1.0), params.cyan.rgb, screen(p, params.angle - PI / 6.0, 0u).a);
    res = res * mix(vec3f(1.0), params.magenta.rgb, screen(p, params.angle + PI / 6.0, 1u).a);
    res = res * mix(vec3f(1.0), params.yellow.rgb, screen(p, params.angle - PI / 4.0, 2u).a);
    res = res * mix(vec3f(1.0), params.ink.rgb, screen(p, params.angle, 3u).a);
  } else if (params.mode == 2u) {
    let s = screen(p, params.angle, 5u);
    res = mix(paper, s.rgb, s.a);
  } else {
    res = mix(paper, params.ink.rgb, screen(p, params.angle, 4u).a);
  }
  return from_encoded(res, c.a);
}`,
  pack: (p) => ({
    uniform: packValues([
      p.cellSize as number,
      ((p.angle as number) * Math.PI) / 180,
      { u32: MODES[p.mode as string] ?? 0 },
      { u32: SHAPES[p.shape as string] ?? 0 },
      (p.softness as number) / 100,
      0,
      0,
      0,
      ...rgba(p.ink as string),
      ...rgba(p.paper as string),
      ...rgba(PROCESS_INKS.cyan),
      ...rgba(PROCESS_INKS.magenta),
      ...rgba(PROCESS_INKS.yellow),
    ]),
  }),
};

/** A cell's average from a 4 × 4 grid of reads inside it (reference: cellAverage), for Dither and Pixelate. */
const CELL_AVERAGE = /* wgsl */ `
${HELD}
fn cell_average(p: vec2f, cell: vec2f, size: f32) -> vec4f {
  var sum = vec4f(0.0);
  for (var j = 0; j < 4; j++) {
    for (var i = 0; i < 4; i++) {
      sum += src(held(vec2f((cell.x + (f32(i) + 0.5) / 4.0) * size, (cell.y + (f32(j) + 0.5) / 4.0) * size), p));
    }
  }
  return sum / 16.0;
}`;

const DITHER: FilterKernel = {
  wgsl: /* wgsl */ `
struct Params { size: f32, levels: f32, colour: u32, pattern: u32, ink: vec4f, paper: vec4f }
${CELL_AVERAGE}

// Bayer's ordered-dither threshold at a cell, for a matrix of 2^bits on a side (reference: bayer).
fn bayer(x: i32, y: i32, bits: u32) -> f32 {
  var v = 0;
  for (var b = 0u; b < bits; b++) {
    let xb = (x >> b) & 1;
    let yb = (y >> b) & 1;
    v = (v << 2u) | (((xb ^ yb) << 1u) | yb);
  }
  return (f32(v) + 0.5) / f32(1 << (2u * bits));
}

fn level(v: f32, t: f32) -> f32 {
  let n = params.levels - 1.0;
  return clamp(floor(v * n + t) / n, 0.0, 1.0);
}

fn effect(p: vec2f, c: vec4f) -> vec4f {
  let cell = floor(p / params.size);
  let avg = cell_average(p, cell, params.size);
  let ix = i32(cell.x);
  let iy = i32(cell.y);
  var t = 0.0;
  if (params.pattern == 2u) { t = rand(ix, iy, 17u); } else { t = bayer(ix, iy, params.pattern + 2u); }
  let lin = unpremul(avg);
  var res = vec3f(0.0);
  if (params.colour == 1u) {
    let v = enc3(lin);
    res = vec3f(level(v.r, t), level(v.g, t), level(v.b, t));
  } else {
    res = mix(params.ink.rgb, params.paper.rgb, level(enc(luma(lin)), t));
  }
  return from_encoded(res, clamp(avg.a, 0.0, 1.0));
}`,
  pack: (p) =>
    ({
      uniform: packValues([
        p.pixelSize as number,
        p.levels as number,
        { u32: p.mode === "colour" ? 1 : 0 },
        // Bayer 4×4 is 2 bits a side, 8×8 three; noise is its own.
        { u32: p.pattern === "noise" ? 2 : p.pattern === "bayer4" ? 0 : 1 },
        ...rgba(p.ink as string),
        ...rgba(p.paper as string),
      ]),
    }),
};

const PIXELATE: FilterKernel = {
  wgsl: /* wgsl */ `
struct Params { size: f32, circle: u32, gap: f32, p0: f32 }
${CELL_AVERAGE}

fn effect(p: vec2f, c: vec4f) -> vec4f {
  let cell = floor(p / params.size);
  let avg = cell_average(p, cell, params.size);
  if (params.circle == 0u && !(params.gap > 0.0)) { return avg; }
  let f = p / params.size - cell - 0.5;
  let aa = 0.5 * px() / params.size;
  let h = 0.5 * (1.0 - params.gap);
  var d = max(abs(f.x), abs(f.y));
  if (params.circle == 1u) { d = length(f); }
  let cover = 1.0 - smoothstep(h - aa, h + aa, d);
  return vec4f(avg.rgb * cover, avg.a);
}`,
  pack: (p) => ({ uniform: packValues([p.cellSize as number, { u32: p.shape === "circle" ? 1 : 0 }, (p.gap as number) / 100, 0]) }),
};

export const STYLIZE_KERNELS: Record<string, FilterKernel> = { halftone: HALFTONE, dither: DITHER, pixelate: PIXELATE };
