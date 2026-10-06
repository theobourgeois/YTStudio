/**
 * Layer effects, the CPU reference (docs/photo/layer-style/README.md, phase L2). The GPU (`render/style.ts`) runs
 * the same steps and is tested against this; this is tested against Photoshop 27.11's renders
 * (photoshop-measurements.md: "Shadows and glows", "Stroke", "Contours").
 *
 * Everything an effect draws comes from the layer's coverage (its alpha, with its mask): a signed distance to its
 * edge (an exact Euclidean transform, Felzenszwalb and Huttenlocher's), box blurs of fractional width (two per axis:
 * a tent, Softer's measured shape), and Precise's measured ramp. Fields are in the layer's pixels; the composite is
 * per pixel, in the document's compositing, as `blend.ts`'s is: outside the layer, the backdrop with the drop
 * shadows and outer glow; inside it, the layer's pixels at its Fill with the overlays, inner glow and inner shadow
 * over them; the two mixed by the layer's coverage, then the strokes over it all, then its Opacity.
 */
import { compositingOf } from "../blending.ts";
import { linearToSrgb, srgbToLinear } from "../colour.ts";
import { hash2 } from "../output.ts";
import { contourFunction } from "../style/contours.ts";
import { styleDefinition } from "../style/definitions.ts";
import { type Box, type GradientStyle, gradientAt, gradientLayout, gradientPosition } from "../style/gradients.ts";
import type { BlendMode, Compositing, Contour, EffectInstance, Gradient, PhotoLayer } from "../types.ts";
import { type BlendParams, type Rgba, compositePixel } from "./blend.ts";

// --- fields ---

const INF = 1e20;

/** Squared distances along a line to its nearest zero of `f` (Felzenszwalb and Huttenlocher's lower envelope). */
function edt1(f: Float64Array, n: number, d: Float64Array, v: Int32Array, z: Float64Array) {
  let k = 0;
  v[0] = 0;
  z[0] = -INF;
  z[1] = INF;
  for (let q = 1; q < n; q++) {
    let s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    while (s <= z[k]) {
      k--;
      s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    }
    k++;
    v[k] = q;
    z[k] = s;
    z[k + 1] = INF;
  }
  k = 0;
  for (let q = 0; q < n; q++) {
    while (z[k + 1] < q) k++;
    d[q] = (q - v[k]) * (q - v[k]) + f[v[k]];
  }
}

/** Squared Euclidean distance from every pixel centre to the nearest seed's (`seed[i]` true), rows then columns. */
export function edt(seed: (i: number) => boolean, w: number, h: number): Float64Array {
  const out = new Float64Array(w * h);
  const n = Math.max(w, h);
  const f = new Float64Array(n);
  const d = new Float64Array(n);
  const v = new Int32Array(n);
  const z = new Float64Array(n + 1);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) f[x] = seed(y * w + x) ? 0 : INF;
    edt1(f, w, d, v, z);
    for (let x = 0; x < w; x++) out[y * w + x] = d[x];
  }
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) f[y] = out[y * w + x];
    edt1(f, h, d, v, z);
    for (let y = 0; y < h; y++) out[y * w + x] = d[y];
  }
  return out;
}

/**
 * The signed distance to the layer's edge, in pixels, positive outside: a pixel's centre to the nearest pixel centre
 * of the other side (inside is coverage ≥ ½), less half a pixel, so a hard edge sits half a pixel from both; a partly
 * covered pixel is `½ − α` (its own estimate of where the edge crosses it).
 */
export function signedDistance(alpha: Float32Array, w: number, h: number): Float32Array {
  const toInside = edt((i) => alpha[i] >= 0.5, w, h);
  const toOutside = edt((i) => alpha[i] < 0.5, w, h);
  const out = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) {
    const a = alpha[i];
    if (a > 0 && a < 1) out[i] = 0.5 - a;
    else if (a < 0.5) out[i] = Math.min(Math.sqrt(toInside[i]), 1e9) - 0.5;
    else out[i] = -(Math.min(Math.sqrt(toOutside[i]), 1e9) - 0.5);
  }
  return out;
}

/**
 * A box of `width` pixels (fractional), centred, along rows (`axis` 0) or columns (1): each pixel the mean of the
 * line over [centre − width/2, centre + width/2], the line taken as constant across each pixel and `edge` beyond.
 */
export function boxBlur(src: Float32Array, w: number, h: number, width: number, axis: 0 | 1, edge: number): Float32Array {
  if (width <= 1e-6) return src.slice();
  const out = new Float32Array(w * h);
  const len = axis === 0 ? w : h;
  const lines = axis === 0 ? h : w;
  const at = (line: number, i: number) => (axis === 0 ? line * w + i : i * w + line);
  const prefix = new Float64Array(len + 1);
  for (let line = 0; line < lines; line++) {
    for (let i = 0; i < len; i++) prefix[i + 1] = prefix[i] + src[at(line, i)];
    // ∫ from 0 to t of the line, `edge` beyond its ends.
    const integral = (t: number) => {
      if (t <= 0) return t * edge;
      if (t >= len) return prefix[len] + (t - len) * edge;
      const j = Math.floor(t);
      return prefix[j] + (t - j) * src[at(line, j)];
    };
    for (let i = 0; i < len; i++) out[at(line, i)] = (integral(i + 0.5 + width / 2) - integral(i + 0.5 - width / 2)) / width;
  }
  return out;
}

/** Softer's blur (measured): a box `width` wide twice along each axis, a tent. */
export function tent(src: Float32Array, w: number, h: number, width: number, edge: number): Float32Array {
  let f = boxBlur(src, w, h, width, 0, edge);
  f = boxBlur(f, w, h, width, 0, edge);
  f = boxBlur(f, w, h, width, 1, edge);
  return boxBlur(f, w, h, width, 1, edge);
}

/**
 * A shadow's or glow's falloff (before Range and the contour): 1 at the shape, 0 past Size, from the layer's coverage
 * `alpha` (inverted for inner effects) and its signed distance `sd` (negated for inner ones). Measured:
 * - Softer: the shape grown by round(Size × spread) pixels, then the tent of the rest of Size;
 * - Precise: (Size + ½ − d) / ((2 − 2·spread)·Size + 2), d the distance outside the edge (a hard edge at 100%).
 */
export function falloff(alpha: Float32Array, sd: Float32Array, w: number, h: number, size: number, spread: number, technique: "softer" | "precise", edge: number): Float32Array {
  const out = new Float32Array(w * h);
  if (technique === "precise") {
    for (let i = 0; i < w * h; i++) {
      const d = sd[i];
      out[i] = spread >= 1 ? clamp01((size + 0.5 - d) * 8) : clamp01((size + 0.5 - d) / ((2 - 2 * spread) * size + 2));
    }
    return out;
  }
  const grow = Math.round(size * spread);
  let matte = alpha;
  if (grow > 0) {
    matte = new Float32Array(w * h);
    for (let i = 0; i < w * h; i++) matte[i] = clamp01(0.5 - (sd[i] - grow));
  }
  return tent(matte, w, h, size - grow, edge);
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

// --- per pixel ---

/** A random value in [0, 1) at a pixel, salted by `seed` (the output dither's hash). */
export const noiseAt = (x: number, y: number, seed: number) => (hash2(x >>> 0, (y ^ seed) >>> 0) >>> 8) / 16777216;

/** An effect's opacity from its falloff: Range, the contour, and an outer one's fade at its border (Photoshop's 8.4). */
export function shaped(f: number, contour: (x: number) => number, range: number, outer: boolean): number {
  const c = contour(Math.min(1, f / range));
  return outer ? Math.min(c, Math.min(1, 8.4 * f)) : c;
}

/** The stroke's coverage at signed distance `d`: its band, anti-aliased over a pixel. */
export function strokeBand(d: number, size: number, position: string): number {
  const [lo, hi] = position === "inside" ? [-size, 0] : position === "center" ? [-size / 2, size / 2] : [0, size];
  return clamp01(hi - d + 0.5) * clamp01(d - lo + 0.5);
}

/** Everything about a layer the reference composites, at one pixel. */
export interface StyledPixel {
  /** Below, premultiplied linear. */
  backdrop: Rgba;
  /** The layer's own pixel, premultiplied linear, its mask in its alpha (or not, with Layer Mask Hides Effects). */
  content: Rgba;
  /** Its mask's coverage when the mask hides the effects (else 1). */
  mask: number;
  /** Each drawn effect's coverage here (0..1 from its falloff, before opacity), by effect id. */
  coverage: Record<string, number>;
  /** Each gradient effect's position here (0..1, before Reverse), by effect id. */
  position: Record<string, number>;
  /** Each bevel's highlight and shadow here (0..1, weighted by its style, before their opacities), by effect id. */
  bevel?: Record<string, BevelShade>;
}

export interface StyleContext {
  layer: PhotoLayer;
  effects: EffectInstance[];
  compositing: Compositing;
}

const hexEncoded = (c: string): [number, number, number] => {
  const n = Number.parseInt(c.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
};

/** A colour (straight, sRGB-encoded) and its alpha onto `dst` with a mode, as premultiplied linear. */
function over(dst: Rgba, encoded: [number, number, number], alpha: number, mode: BlendMode, compositing: Compositing): Rgba {
  if (alpha <= 0) return dst;
  const lin = encoded.map(srgbToLinear);
  const params: BlendParams = { mode, opacity: 1, fill: 1, channels: { r: true, g: true, b: true }, blendIf: {}, compositing };
  return compositePixel(dst, [lin[0] * alpha, lin[1] * alpha, lin[2] * alpha, alpha], params);
}

/**
 * Mixing two premultiplied linear pixels by `t` in the compositing's values (encoded for "photoshop", as Photoshop
 * mixes: the layer's coverage between its two worlds, its Opacity), back to premultiplied linear.
 */
function lerp(a: Rgba, b: Rgba, t: number, compositing: Compositing): Rgba {
  if (compositing === "linear") return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t, a[3] + (b[3] - a[3]) * t];
  const enc = (p: Rgba): Rgba => (p[3] > 0 ? [linearToSrgb(p[0] / p[3]) * p[3], linearToSrgb(p[1] / p[3]) * p[3], linearToSrgb(p[2] / p[3]) * p[3], p[3]] : [0, 0, 0, 0]);
  const ea = enc(a);
  const eb = enc(b);
  const m = ea.map((v, i) => v + (eb[i] - v) * t) as Rgba;
  return m[3] > 0 ? [srgbToLinear(m[0] / m[3]) * m[3], srgbToLinear(m[1] / m[3]) * m[3], srgbToLinear(m[2] / m[3]) * m[3], m[3]] : [0, 0, 0, 0];
}

/** An effect's colour here: its own, or its gradient's at a position (reversed with Reverse). */
function colourOf(e: EffectInstance, at: number): [number, number, number, number] {
  if (e.params.fill === "gradient" || e.type === "gradient-overlay") {
    const t = e.params.reverse === true ? 1 - at : at;
    return gradientAt(e.params.gradient as Gradient, clamp01(t));
  }
  return [...hexEncoded(e.params.colour as string), 1];
}

/** The layer and its effects onto the backdrop at one pixel: premultiplied linear. */
export function styledPixel(ctx: StyleContext, p: StyledPixel): Rgba {
  const { layer, effects, compositing } = ctx;
  const n = (e: EffectInstance, k: string) => e.params[k] as number;
  const draw = (dst: Rgba, e: EffectInstance, cover: number) => {
    const [r, g, b, a] = colourOf(e, p.position[e.id] ?? 0);
    return over(dst, [r, g, b], cover * a * (n(e, "opacity") / 100), e.params.mode as BlendMode, compositing);
  };
  // Outside: the backdrop, the drop shadows, the outer glow.
  let outside = p.backdrop;
  let insideBase = p.backdrop;
  for (const e of effects) {
    if (e.type === "drop-shadow") {
      outside = draw(outside, e, p.coverage[e.id] ?? 0);
      if (e.params.knocksOut === false) insideBase = draw(insideBase, e, p.coverage[e.id] ?? 0);
    } else if (e.type === "outer-glow") outside = draw(outside, e, p.coverage[e.id] ?? 0);
  }
  // Inside: the layer's pixels at its Fill, by its mode (and Blend If), then the interior effects.
  const alpha = Math.min(1, Math.max(0, p.content[3]));
  const straight: Rgba = alpha > 0 ? [p.content[0] / alpha, p.content[1] / alpha, p.content[2] / alpha, 1] : [0, 0, 0, 1];
  const blending = { mode: layer.blend ?? "normal", fill: layer.fill ?? 1, blendIf: layer.blending?.blendIf ?? {} };
  const content: BlendParams = { mode: blending.mode, opacity: 1, fill: blending.fill, channels: { r: true, g: true, b: true }, blendIf: blending.blendIf, compositing };
  const interior = effects.filter((e) => styleDefinition(e.type)?.side === "inside");
  const interiorCover = (e: EffectInstance) => (e.type === "color-overlay" || e.type === "gradient-overlay" ? 1 : (p.coverage[e.id] ?? 0));
  let inside: Rgba;
  if (layer.blending?.interiorAsGroup) {
    // The interior effects join the layer's pixels first; then the whole meets the backdrop at Fill.
    let group: Rgba = straight;
    for (const e of interior) group = draw(group, e, interiorCover(e));
    inside = compositePixel(insideBase, group, content);
  } else {
    inside = compositePixel(insideBase, straight, content);
    for (const e of interior) inside = draw(inside, e, interiorCover(e));
  }
  let result = lerp(outside, inside, alpha, compositing);
  // The strokes, over it all.
  for (const e of effects) if (e.type === "stroke") result = draw(result, e, p.coverage[e.id] ?? 0);
  // The bevel over everything: its highlight, then its shadow.
  for (const e of effects) {
    const b = e.type === "bevel-emboss" ? p.bevel?.[e.id] : undefined;
    if (!b) continue;
    result = over(result, hexEncoded(e.params.highlightColour as string), b.highlight * (n(e, "highlightOpacity") / 100), e.params.highlightMode as BlendMode, compositing);
    result = over(result, hexEncoded(e.params.shadowColour as string), b.shadow * (n(e, "shadowOpacity") / 100), e.params.shadowMode as BlendMode, compositing);
  }
  // Opacity, and a mask that hides the effects too.
  result = lerp(p.backdrop, result, layer.opacity * p.mask, compositing);
  const channels = layer.blending?.channels;
  if (channels) [channels.r, channels.g, channels.b].forEach((keep, i) => !keep && (result[i] = p.backdrop[i]));
  return result;
}

// --- a whole layer, in its own pixels (the tests' and the e2e's reference) ---

/** An effect's offset in pixels: where the light's opposite is, `distance` away (measured: 120° throws it right and down). */
export function shadowOffset(angle: number, distance: number): { x: number; y: number } {
  const a = (angle * Math.PI) / 180;
  return { x: -distance * Math.cos(a), y: distance * Math.sin(a) };
}

/** Bilinear sample of a field, `edge` outside it. */
function sample(field: Float32Array, w: number, h: number, x: number, y: number, edge: number): number {
  const fx = x - 0.5;
  const fy = y - 0.5;
  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  const tx = fx - x0;
  const ty = fy - y0;
  const at = (xx: number, yy: number) => (xx < 0 || yy < 0 || xx >= w || yy >= h ? edge : field[yy * w + xx]);
  return (at(x0, y0) * (1 - tx) + at(x0 + 1, y0) * tx) * (1 - ty) + (at(x0, y0 + 1) * (1 - tx) + at(x0 + 1, y0 + 1) * tx) * ty;
}

export interface LayerImage {
  width: number;
  height: number;
  /** Premultiplied linear RGBA, row by row. */
  pixels: Float32Array;
}

/**
 * A layer and its style over a backdrop, both `width` × `height` and in the same pixels (the layer at 100%, not
 * moved): what the GPU's evaluator gives for that layer, premultiplied linear. `angleOf` gives each effect's light
 * angle (Global Light's or its own), `altitudeOf` a bevel's altitude.
 */
export function renderStyled(layer: PhotoLayer, doc: { compositing?: Compositing }, backdrop: LayerImage, content: LayerImage, angleOf: (e: EffectInstance) => number, box: Box, altitudeOf: (e: EffectInstance) => number = () => 30): Float32Array {
  const { width: w, height: h } = content;
  const effects = layer.style?.enabled ? layer.style.effects.filter((e) => e.enabled && styleDefinition(e.type)) : [];
  const compositing = compositingOf(doc as never);
  const alpha = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) alpha[i] = clamp01(content.pixels[i * 4 + 3]);
  const inverted = alpha.map((a) => 1 - a);
  const sd = signedDistance(alpha, w, h);
  const sdInverted = sd.map((d) => -d);
  // Each effect's field (its falloff; a stroke's is the signed distance itself).
  const fields = new Map<string, { field: Float32Array; edge: number; dx: number; dy: number }>();
  for (const e of effects) {
    const p = e.params;
    const num = (k: string) => p[k] as number;
    if (e.type === "drop-shadow" || e.type === "outer-glow") {
      const f = falloff(alpha, sd, w, h, num("size"), num("spread") / 100, e.type === "outer-glow" ? (p.technique as "softer" | "precise") : "softer", 0);
      const o = e.type === "drop-shadow" ? shadowOffset(angleOf(e), num("distance")) : { x: 0, y: 0 };
      fields.set(e.id, { field: f, edge: 0, dx: o.x, dy: o.y });
    } else if (e.type === "inner-shadow" || e.type === "inner-glow") {
      const f = falloff(inverted, sdInverted, w, h, num("size"), num("choke") / 100, e.type === "inner-glow" ? (p.technique as "softer" | "precise") : "softer", 1);
      const o = e.type === "inner-shadow" ? shadowOffset(angleOf(e), num("distance")) : { x: 0, y: 0 };
      fields.set(e.id, { field: f, edge: 1, dx: o.x, dy: o.y });
    } else if (e.type === "stroke") fields.set(e.id, { field: sd, edge: 1e9, dx: 0, dy: 0 });
    else if (e.type === "satin") fields.set(e.id, { field: tent(alpha, w, h, num("size"), 0), edge: 0, dx: 0, dy: 0 });
  }
  // Each bevel's height field, the edge it has past the image, and its options.
  const band = strokeEmbossBand(effects);
  const bevels = new Map<string, { H: Float32Array; edge: number; o: BevelOptions; gloss: (x: number) => number }>();
  for (const e of effects) {
    if (e.type !== "bevel-emboss") continue;
    const o = bevelOptions(e, band);
    if (!o) continue;
    bevels.set(e.id, { H: bevelHeight(alpha, sd, w, h, o), edge: o.technique === "smooth" ? 0 : chiselShape(o).outside, o, gloss: contourFunction(e.params.gloss as Contour) });
  }
  const contours = new Map(effects.map((e) => [e.id, e.params.contour ? contourFunction(e.params.contour as Contour) : (x: number) => x]));
  const layouts = new Map(effects.filter((e) => e.params.style !== undefined).map((e) => [e.id, gradientLayout(box, e.params.angle as number, e.params.scale as number, { x: e.params.offsetX as number, y: e.params.offsetY as number })]));
  const out = new Float32Array(w * h * 4);
  const ctx: StyleContext = { layer, effects, compositing };
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const coverage: Record<string, number> = {};
      const position: Record<string, number> = {};
      const bevelAmounts: Record<string, BevelShade> = {};
      for (const e of effects) {
        const f = fields.get(e.id);
        const p = e.params;
        if (e.type === "stroke") {
          const d = f!.field[i];
          coverage[e.id] = strokeBand(d, p.size as number, p.position as string);
          if (p.fill === "gradient") position[e.id] = p.style === "shape-burst" ? clamp01((d - (p.position === "inside" ? -(p.size as number) : p.position === "center" ? -(p.size as number) / 2 : 0)) / (p.size as number)) : gradientPosition(p.style as GradientStyle, layouts.get(e.id)!, x + 0.5, y + 0.5);
          continue;
        }
        if (e.type === "gradient-overlay") {
          position[e.id] = gradientPosition(p.style as GradientStyle, layouts.get(e.id)!, x + 0.5, y + 0.5);
          continue;
        }
        if (e.type === "satin" && f) {
          const off = satinOffset(angleOf(e), p.distance as number);
          coverage[e.id] = satinAt((sx, sy) => sample(f.field, w, h, sx, sy, 0), contours.get(e.id)!, x + 0.5, y + 0.5, off, p.invert === true);
          continue;
        }
        const bevel = bevels.get(e.id);
        if (bevel) {
          const contour = p.useContour === true ? contours.get(e.id)! : (v: number) => v;
          const at = (sx: number, sy: number) => contour(sample(bevel.H, w, h, sx, sy, bevel.edge));
          const neighbours = { left: at(x - 0.5, y + 0.5), right: at(x + 1.5, y + 0.5), up: at(x + 0.5, y - 0.5), down: at(x + 0.5, y + 1.5) };
          const light = { depth: (p.depth as number) / 100, size: p.size as number, style: bevel.o.style, down: p.direction === "down", angle: angleOf(e), altitude: altitudeOf(e), slopeScale: p.useContour === true ? 100 / (p.range as number) : 1 };
          const total = { highlight: 0, shadow: 0 };
          for (const [weight, sign] of bevelParts(bevel.o.style, alpha[i], band ? bandCover(sd[i], band) : 0)) {
            if (weight <= 0) continue;
            const s = bevelShade(neighbours, { ...light, sign }, bevel.gloss);
            total.highlight += weight * s.highlight;
            total.shadow += weight * s.shadow;
          }
          bevelAmounts[e.id] = { highlight: Math.min(1, total.highlight), shadow: Math.min(1, total.shadow) };
          continue;
        }
        if (!f) continue;
        const outer = e.type === "drop-shadow" || e.type === "outer-glow";
        const value = (sx: number, sy: number) => sample(f.field, w, h, sx - f.dx, sy - f.dy, f.edge);
        let raw = value(x + 0.5, y + 0.5);
        // Noise scatters: the falloff read up to 4 pixels away, as much as Noise says.
        const noise = (p.noise as number) / 100;
        if (noise > 0) {
          const h1 = noiseAt(x, y, 0x9e3779b9);
          const h2 = noiseAt(x, y, 0x85ebca6b);
          raw = raw + (value(x + 0.5 + (h1 - 0.5) * 8, y + 0.5 + (h2 - 0.5) * 8) - raw) * noise;
        }
        const range = e.type === "outer-glow" || e.type === "inner-glow" ? (p.range as number) / 100 : 1;
        let c = shaped(raw, contours.get(e.id)!, range, outer);
        if (e.type === "inner-glow" && p.source === "center") c = 1 - c;
        coverage[e.id] = c;
        if (p.fill === "gradient") {
          // A gradient glow's colour and opacity are the gradient's at 1 − c (its start at the shape); an outer
          // one still fades at its border.
          const jitter = (p.jitter as number) / 100;
          position[e.id] = clamp01(1 - c + (jitter > 0 ? (noiseAt(x, y, 0x27d4eb2f) - 0.5) * jitter : 0));
          coverage[e.id] = outer ? Math.min(1, 8.4 * raw) : 1;
        }
      }
      const px = (img: LayerImage): Rgba => [img.pixels[i * 4], img.pixels[i * 4 + 1], img.pixels[i * 4 + 2], img.pixels[i * 4 + 3]];
      const r = styledPixel(ctx, { backdrop: px(backdrop), content: px(content), mask: 1, coverage, position, bevel: bevelAmounts });
      out.set(r, i * 4);
    }
  }
  return out;
}

/** The encoded value of a linear one (for tests reading 8-bit codes). */
export const encodedCode = (v: number) => Math.round(linearToSrgb(Math.min(1, Math.max(0, v))) * 255);

// --- Bevel & Emboss and Satin (Layer Style L3) ---

/** Bevel's options as the reference reads them (the definition's parameters). */
export interface BevelOptions {
  style: "outer-bevel" | "inner-bevel" | "emboss" | "pillow-emboss" | "stroke-emboss";
  technique: "smooth" | "chisel-hard" | "chisel-soft";
  size: number;
  soften: number;
  /** Stroke Emboss: the strokes' band, in signed distance from the edge (`strokeEmbossBand`). */
  band?: readonly [number, number];
}

/** A tent's width for a Size (measured: max(2, round(Size)); Emboss and Pillow use half the Size). */
export const bevelWidth = (style: BevelOptions["style"], size: number) => Math.max(2, Math.round(style === "emboss" || style === "pillow-emboss" ? size / 2 : size));

/** The chisels' height per pixel of distance, as a fraction of a unit per width (fitted: within 2 levels of Photoshop's facets). */
const CHISEL_SLOPE = 0.48;
/** Chisel Soft's extra step across the edge (its edge pixels are steeper; fitted). */
const CHISEL_SOFT_JUMP = 1;

/**
 * A chisel's height from the distance `t` into the shape (or the stroke's band), in pixels: `offset + k · (clamp(t,
 * lo, hi) + jump · clamp(t, −½, ½))`. Measured on Photoshop's renders: the facet is exactly the bevel's width, held
 * flat past it (a pixel further outside for Chisel Hard), and Chisel Soft's edge pixels are steeper.
 */
export function chiselShape(o: BevelOptions) {
  const size = bevelWidth(o.style, o.size);
  const soft = o.technique === "chisel-soft";
  const shape = { lo: -(size + (soft ? 0.5 : 1.5)), hi: size + 0.5, k: CHISEL_SLOPE / size, jump: soft ? CHISEL_SOFT_JUMP : 0, offset: 0.5 };
  return { ...shape, outside: shape.offset + shape.k * (shape.lo - 0.5 * shape.jump) };
}

/** Stroke Emboss's band: the enabled strokes' together (each one touches the edge, so they make one band), or null. */
export function strokeEmbossBand(effects: readonly EffectInstance[]): [number, number] | null {
  let band: [number, number] | null = null;
  for (const e of effects) {
    if (e.type !== "stroke" || !e.enabled) continue;
    const size = e.params.size as number;
    const [lo, hi] = e.params.position === "inside" ? [-size, 0] : e.params.position === "center" ? [-size / 2, size / 2] : [0, size];
    band = band ? [Math.min(band[0], lo), Math.max(band[1], hi)] : [lo, hi];
  }
  return band;
}

/** The band's coverage at signed distance `d` (a stroke's, anti-aliased over a pixel). */
const bandCover = (d: number, band: readonly [number, number]) => clamp01(band[1] - d + 0.5) * clamp01(d - band[0] + 0.5);

/**
 * The bevel's height field, rising from outside the shape to inside (only its slopes matter): Smooth is the coverage
 * (or Stroke Emboss's band) through the tent of the bevel's width; the chisels are `chiselShape`s of the distance
 * into it. Soften blurs the result by a box of its width each way. Measured: every facet's width to the pixel
 * (docs/photo/layer-style/bevel-emboss.md).
 */
export function bevelHeight(alpha: Float32Array, sd: Float32Array, w: number, h: number, o: BevelOptions): Float32Array {
  let H: Float32Array;
  let edge = 0;
  if (o.technique === "smooth") {
    const band = o.band;
    const matte = band ? sd.map((d) => bandCover(d, band)) : alpha;
    H = tent(matte, w, h, bevelWidth(o.style, o.size), 0);
  } else {
    const c = chiselShape(o);
    edge = c.outside;
    H = new Float32Array(w * h);
    for (let i = 0; i < w * h; i++) {
      const t = o.band ? Math.min(sd[i] - o.band[0], o.band[1] - sd[i]) : -sd[i];
      H[i] = c.offset + c.k * (Math.min(c.hi, Math.max(c.lo, t)) + c.jump * Math.min(0.5, Math.max(-0.5, t)));
    }
  }
  if (o.soften > 0) H = boxBlur(boxBlur(H, w, h, o.soften, 0, edge), w, h, o.soften, 1, edge);
  return H;
}

/** A bevel effect's options (Stroke Emboss with the strokes' band), or null when it draws nothing (Stroke Emboss without a stroke). */
export function bevelOptions(e: EffectInstance, band: readonly [number, number] | null): BevelOptions | null {
  const style = e.params.style as BevelOptions["style"];
  if (style === "stroke-emboss" && !band) return null;
  return { style, technique: e.params.technique as BevelOptions["technique"], size: e.params.size as number, soften: e.params.soften as number, band: style === "stroke-emboss" ? band! : undefined };
}

/** How each style weighs the light at a pixel of coverage `a` (`band`: Stroke Emboss's), and which way its slope faces. */
export function bevelParts(style: BevelOptions["style"], a: number, band: number): [number, number][] {
  switch (style) {
    case "outer-bevel":
      return [[1 - a, 1]];
    case "emboss":
      return [[1, 1]];
    case "pillow-emboss":
      return [
        [1 - a, -1],
        [a, 1],
      ];
    case "stroke-emboss":
      return [[band, 1]];
    default:
      return [[a, 1]];
  }
}

export interface BevelShade {
  highlight: number;
  shadow: number;
}

/**
 * The light on a bevel at a pixel from its height field's slopes (central differences, `H` read at the four
 * neighbours): Depth scales them so 100% is a 45° Smooth slope at any Size, the light comes from Angle at Altitude,
 * and the highlight is how far the lighting rises above a flat face's (sin Altitude), the shadow how far it falls
 * below (measured: docs/photo/layer-style/bevel-emboss.md, "The algorithm"). Gloss Contour remaps the lighting first.
 */
export function bevelShade(
  h: { left: number; right: number; up: number; down: number },
  p: { depth: number; size: number; style: BevelOptions["style"]; down: boolean; angle: number; altitude: number; slopeScale: number; sign: number },
  gloss: (x: number) => number,
): BevelShade {
  const half = p.style === "emboss" || p.style === "pillow-emboss";
  const k = half ? 0.5 * Math.max(p.depth, 0.25) * bevelWidth(p.style, p.size) : 0.5 * p.depth * Math.max(1, p.size);
  let gx = (h.left - h.right) * k * p.slopeScale * p.sign;
  let gy = (h.up - h.down) * k * p.slopeScale * p.sign;
  if (p.down) [gx, gy] = [-gx, -gy];
  const a = (p.angle * Math.PI) / 180;
  const alt = (p.altitude * Math.PI) / 180;
  const L = [Math.cos(a) * Math.cos(alt), -Math.sin(a) * Math.cos(alt), Math.sin(alt)];
  const n = Math.hypot(gx, gy, 1);
  const flat = Math.sin(alt);
  const l = gloss(Math.min(1, Math.max(0, (gx * L[0] + gy * L[1] + L[2]) / n)));
  const highlight = l >= flat ? Math.min(1, (l - flat) / Math.max(1e-6, 1 - flat)) : 0;
  let shadow = l < flat ? Math.min(1, (flat - l) / Math.max(1e-6, flat)) : 0;
  // Emboss and Pillow's shadows are linear in the slope (Patchy's, within 3 levels to Depth 25%).
  if (half) shadow = Math.min(1, Math.max(0, (flat - (gx * L[0] + gy * L[1] + flat)) / Math.max(1e-6, flat)));
  return { highlight, shadow };
}

/** Satin's offset: the shadows' rounded to whole pixels (measured: Photoshop's copies move by whole pixels). */
export function satinOffset(angle: number, distance: number) {
  const o = shadowOffset(angle, distance);
  return { x: Math.round(o.x), y: Math.round(o.y) };
}

/** Satin's coverage at a pixel: the blurred coverage, through the contour, at two opposite offsets, differenced (inverted with Invert). */
export function satinAt(blurred: (x: number, y: number) => number, contour: (x: number) => number, x: number, y: number, off: { x: number; y: number }, invert: boolean): number {
  const m = Math.abs(contour(blurred(x + off.x, y + off.y)) - contour(blurred(x - off.x, y - off.y)));
  return invert ? 1 - m : m;
}
