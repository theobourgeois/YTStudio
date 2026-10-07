/** The subject filters' CPU references (`../../effects/filters/subject.ts`), mirrored by `render/filters/subject.ts`. */
import { addLight } from "../../effects/glow.ts";
import { type SceneMaps, sceneOf } from "../../scene.ts";
import { type KernelEnv, type KernelReference, type Pixel, clamp, dec3, enc3, fromEncoded, hexEncoded, mix, rand, rotate, smoothstep, unpremul, vnoise } from "../kernel.ts";

/** Rec. 709's weights, used on encoded colour as a stylised brightness. */
const W = [0.2126, 0.7152, 0.0722] as const;
const dot = (v: readonly number[]) => W[0] * v[0] + W[1] * v[1] + W[2] * v[2];

/** The golden angle: successive spiral taps turn by it, so no two share a direction and none line up. */
export const GOLDEN_ANGLE = 2.399963229728653;
/** Taps of the blurs: a sunflower spiral (even over its disc), Gaussian-weighted. */
export const AURA_TAPS = 64;
export const POOL_TAPS = 64;
export const SHADOW_TAPS = 32;
/** Taps of Aura's rays, marched from a point towards the subject's centre. */
export const RAY_TAPS = 40;

/**
 * The subject map blurred over a disc of `radius`: a Gaussian of σ = radius/√6 over a spiral of `taps`, every tap at
 * its own distance, so an edge's blur is many fine steps. The spiral is turned by `turn` (radians): turning it
 * differently in each pixel of a 4×4 block makes the copies of a thin silhouette that sparse taps would leave (a palm's
 * fronds) a fine, even screen instead, the block's 16 spirals together a blur of 16 times the taps.
 */
export function blurredSubject(env: KernelEnv, x: number, y: number, radius: number, taps: number, turn: number): number {
  let sum = 0;
  let weights = 0;
  for (let i = 0; i < taps; i++) {
    const t = Math.sqrt((i + 0.5) / taps);
    const a = i * GOLDEN_ANGLE + turn;
    const w = Math.exp(-3 * t * t);
    sum += w * env.scene(x + Math.cos(a) * t * radius, y + Math.sin(a) * t * radius)[1];
    weights += w;
  }
  return sum / weights;
}

/** A pixel's turn of the spiral (radians): a 4×4 Bayer matrix's order, so neighbours' turns are far apart. */
export function turnAt(x: number, y: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const order = (u: number, v: number) => 2 * ((u ^ v) & 1) + (v & 1);
  return ((4 * order(ix, iy) + order(ix >> 1, iy >> 1) + 0.5) / 16) * 2 * Math.PI;
}

const centres = new WeakMap<Float32Array, [number, number]>();

/**
 * Where the subject is, as a whole: the subject map's centre of mass (weighted by its square, so its core counts more
 * than its soft fringes), in document pixels; the canvas's centre without one. Aura's rays radiate from it. Worked out
 * once per map, in f64, by the reference and the GPU's packing alike.
 */
export function subjectCentre(maps: SceneMaps | null, canvas: { width: number; height: number }): [number, number] {
  if (!maps?.subject) return [canvas.width / 2, canvas.height / 2];
  const known = centres.get(maps.subject);
  if (known) return known;
  let sum = 0;
  let sx = 0;
  let sy = 0;
  for (let j = 0; j < maps.height; j++) {
    for (let i = 0; i < maps.width; i++) {
      const s = maps.subject[j * maps.width + i];
      const w = s * s;
      sum += w;
      sx += w * (i + 0.5) * maps.spacing;
      sy += w * (j + 0.5) * maps.spacing;
    }
  }
  const centre: [number, number] = sum > 1e-6 ? [sx / sum, sy / sum] : [canvas.width / 2, canvas.height / 2];
  centres.set(maps.subject, centre);
  return centre;
}

/** Aura's modes, as the WGSL numbers them. */
export const AURA_MODES: Record<string, number> = { light: 0, shadow: 1 };

/**
 * Aura: the subject blurred over Size, twice its value (1 at a straight edge) the light's strength, hotter near the
 * edge. Rays are god rays: how much of the way from the point towards the subject's centre (over twice Size) is
 * subject (the nearer of it weighing more, so rays fade towards their ends), so light streams out past the silhouette's edges and through its gaps, broken into seeded streaks by the
 * direction from the centre. It shows behind the subject (and, by Wrap, a little over its edge, fading inwards), in
 * Colour near the edge and Colour 2 farther out: added in linear light, or (Shadow) composited over as a dark colour.
 */
const aura: KernelReference = (p, canvas) => {
  const radius = Math.max(0.5, p.size as number);
  const gain = Math.pow(2, p.intensity as number);
  const shadow = AURA_MODES[p.mode as string] === 1;
  const near = dec3(hexEncoded(p.colour as string));
  const far = dec3(hexEncoded(p.colour2 as string));
  const wrap = (p.wrap as number) / 100;
  const rays = (p.rays as number) / 100;
  const k = (p.rayCount as number) / (2 * Math.PI);
  const seed = (p.seed as number) >>> 0;
  const [cx, cy] = subjectCentre(sceneOf(p), canvas);
  return ([x, y], c, env) => {
    const s = env.scene(x, y)[1];
    const b = blurredSubject(env, x, y, radius, AURA_TAPS, turnAt(x, y));
    const e = clamp(2 * b);
    const glow = e * (0.3 + 0.7 * e);
    let shape = glow;
    if (rays > 0) {
      const vx = x - cx;
      const vy = y - cy;
      const dist = Math.hypot(vx, vy);
      const dx = dist > 0 ? vx / dist : 0;
      const dy = dist > 0 ? vy / dist : 0;
      const length = Math.min(dist, 2 * radius);
      const jitter = rand(Math.floor(x), Math.floor(y), (seed + 2) >>> 0);
      let lit = 0;
      let weights = 0;
      for (let j = 0; j < RAY_TAPS; j++) {
        const f = (j + jitter) / RAY_TAPS;
        const w = 1 - 0.8 * f;
        lit += w * env.scene(x - dx * length * f, y - dy * length * f)[1];
        weights += w;
      }
      const n1 = vnoise(dx * k + 31.5, dy * k + 17.5, seed);
      const n2 = vnoise(dx * k * 2.3 + 7.5, dy * k * 2.3 + 3.5, (seed + 1) >>> 0);
      const streak = smoothstep(0.3, 0.8, 0.65 * n1 + 0.35 * n2);
      shape = mix(shape, 1.5 * (lit / weights) * (0.1 + 0.9 * streak), rays);
    }
    // Behind the subject; Wrap's spill over its edge is the smooth glow (rays don't streak across it).
    const inside = clamp(2 - 2 * b);
    const amount = shape * (1 - s) + glow * s * wrap * inside * inside;
    const t = e * e * e;
    const col = [mix(far[0], near[0], t), mix(far[1], near[1], t), mix(far[2], near[2], t)];
    if (shadow) {
      const o = clamp(amount * gain * 0.5);
      return [c[0] * (1 - o) + col[0] * o, c[1] * (1 - o) + col[1] * o, c[2] * (1 - o) + col[2] * o, c[3] * (1 - o) + o];
    }
    return addLight(c, [col[0] * amount * gain, col[1] * amount * gain, col[2] * amount * gain]) as Pixel;
  };
};

/** Rim Light's taps: steps along each lane, the band's lanes (±30°) and the glow's (±20°). */
export const RIM_STEPS = 6;
export const RIM_LANES = 5;
export const GLOW_LANES = 3;

/**
 * One rim at a point: [band, glow]. The band is how much of the way towards the light (over Width, on lanes fanned
 * ±30° so edges at a slant catch it too) is out of the subject, through Softness's ramp, on the subject; the glow is
 * how much of the way back (over the glow's width, nearer taps weighing more) is subject, off it.
 */
export function rimAt(env: KernelEnv, x: number, y: number, s: number, angle: number, width: number, edge: number, glowWidth: number): [number, number] {
  let out = 0;
  for (let l = 0; l < RIM_LANES; l++) {
    const [dx, dy] = rotate(Math.cos(angle), Math.sin(angle), (l - 2) * (Math.PI / 12));
    for (let j = 1; j <= RIM_STEPS; j++) {
      const t = (width * j) / RIM_STEPS;
      out += 1 - env.scene(x + dx * t, y + dy * t)[1];
    }
  }
  const band = s * smoothstep(0, edge, out / (RIM_LANES * RIM_STEPS));
  let g = 0;
  let gw = 0;
  for (let l = 0; l < GLOW_LANES; l++) {
    const [dx, dy] = rotate(Math.cos(angle), Math.sin(angle), (l - 1) * (Math.PI / 9));
    for (let j = 0; j < RIM_STEPS; j++) {
      const f = (j + 0.5) / RIM_STEPS;
      const w = 1 - f;
      g += w * env.scene(x - dx * glowWidth * f, y - dy * glowWidth * f)[1];
      gw += w;
    }
  }
  const glow = (1 - s) * (g / gw);
  return [band, glow * glow];
}

/** Rim Light: one rim (and, by Second, another from the opposite side), its band and glow added in linear light. */
const rimLight: KernelReference = (p) => {
  const angle = ((p.angle as number) * Math.PI) / 180;
  const width = Math.max(0.5, p.width as number);
  const edge = mix(0.15, 1, (p.softness as number) / 100);
  const gain = Math.pow(2, p.intensity as number);
  const glow = (p.glow as number) / 100;
  const second = (p.second as number) / 100;
  const glowWidth = width * 2.5;
  const one = dec3(hexEncoded(p.colour as string)).map((v) => v * gain);
  const two = dec3(hexEncoded(p.colour2 as string)).map((v) => v * gain * second);
  return ([x, y], c, env) => {
    const s = env.scene(x, y)[1];
    const [band, halo] = rimAt(env, x, y, s, angle, width, edge, glowWidth);
    const a = band + glow * halo;
    let light: [number, number, number] = [one[0] * a, one[1] * a, one[2] * a];
    if (second > 0) {
      const [band2, halo2] = rimAt(env, x, y, s, angle + Math.PI, width, edge, glowWidth);
      const a2 = band2 + glow * halo2;
      light = [light[0] + two[0] * a2, light[1] + two[1] * a2, light[2] + two[2] * a2];
    }
    return addLight(c, light) as Pixel;
  };
};

/** Sticker's outlines: rings of taps as [radius as a share of the outline's, taps]; the outer ring sets its edge. */
export const OUTLINE_RINGS: readonly (readonly [number, number])[] = [[1, 24], [0.66, 12], [0.33, 6]];
export const OUTLINE2_RINGS: readonly (readonly [number, number])[] = [[1, 24], [0.75, 12]];

/** The subject map dilated by `radius`: the most subject on the rings' taps (each ring turned a little from the last). */
export function dilatedSubject(env: KernelEnv, x: number, y: number, radius: number, rings: readonly (readonly [number, number])[], from: number): number {
  let d = from;
  for (let k = 0; k < rings.length; k++) {
    const [f, taps] = rings[k];
    for (let i = 0; i < taps; i++) {
      const a = (2 * Math.PI * (i + 0.37 * k)) / taps;
      d = Math.max(d, env.scene(x + Math.cos(a) * radius * f, y + Math.sin(a) * radius * f)[1]);
    }
  }
  return d;
}

/** The standard normal's distribution function (Abramowitz and Stegun 7.1.26, within 1.5e-7). */
export function normalCdf(x: number): number {
  const z = Math.abs(x) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * z);
  const erf = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-z * z);
  return x >= 0 ? 0.5 * (1 + erf) : 0.5 * (1 - erf);
}

/**
 * The drop shadow's blur and thresholds: [radius, lo, hi]. The sticker's silhouette (the subject grown by its
 * outlines' width) blurred by Softness is approximated by the subject blurred wider and thresholded: a straight edge's
 * blur is Φ(−d/σ) at a distance d, so the shadow's fade, from (outline − softness) to (outline + softness) out, is
 * between those two values of it.
 */
export function shadowShape(outline: number, softness: number): [number, number, number] {
  const sigma = softness / 2;
  const blur = Math.max(0.5, (outline + 2 * sigma) / 1.2);
  const lo = normalCdf(-(outline + 2 * sigma) / blur);
  const hi = Math.max(lo + 0.02, normalCdf(-(outline - 2 * sigma) / blur));
  return [blur * Math.sqrt(6), lo, hi];
}

/** Sticker's backgrounds, as the WGSL numbers them. */
export const STICKER_BACKGROUNDS: Record<string, number> = { keep: 0, colour: 1, transparent: 2 };

/**
 * Sticker: the background (the picture, a colour or nothing), the shadow over it (the subject blurred and thresholded
 * where it's cast from), the second outline and the first (the subject dilated, its edge smoothstepped), then the
 * subject's own content over them by its matte (the map smoothstepped).
 */
const sticker: KernelReference = (p) => {
  const w1 = p.width as number;
  const w2 = p.width2 as number;
  const one = dec3(hexEncoded(p.colour as string));
  const two = dec3(hexEncoded(p.colour2 as string));
  const opacity = (p.shadow as number) / 100;
  const angle = ((p.shadowAngle as number) * Math.PI) / 180;
  const ox = Math.cos(angle) * (p.shadowDistance as number);
  const oy = Math.sin(angle) * (p.shadowDistance as number);
  const [blur, lo, hi] = shadowShape(w1 + w2, p.shadowSoftness as number);
  const shade = dec3(hexEncoded(p.shadowColour as string));
  const mode = STICKER_BACKGROUNDS[p.background as string] ?? 0;
  const paper = dec3(hexEncoded(p.backgroundColour as string));
  const over = (base: Pixel, rgb: readonly number[], a: number): Pixel => [base[0] * (1 - a) + rgb[0] * a, base[1] * (1 - a) + rgb[1] * a, base[2] * (1 - a) + rgb[2] * a, base[3] * (1 - a) + a];
  return ([x, y], c, env) => {
    const s = env.scene(x, y)[1];
    // The cut's matte: the map's faint guesses away from the subject left out, its edge kept soft.
    const m = smoothstep(0.1, 0.9, s);
    let base: Pixel = mode === 0 ? [c[0], c[1], c[2], c[3]] : mode === 1 ? [paper[0], paper[1], paper[2], 1] : [0, 0, 0, 0];
    if (opacity > 0) {
      const b = blurredSubject(env, x - ox, y - oy, blur, SHADOW_TAPS, 0);
      base = over(base, shade, opacity * smoothstep(lo, hi, b));
    }
    const d1 = w1 > 0 ? dilatedSubject(env, x, y, w1, OUTLINE_RINGS, s) : s;
    if (w2 > 0) base = over(base, two, smoothstep(0.3, 0.7, dilatedSubject(env, x, y, w1 + w2, OUTLINE2_RINGS, d1)));
    if (w1 > 0) base = over(base, one, smoothstep(0.3, 0.7, d1));
    return [c[0] * m + base[0] * (1 - m), c[1] * m + base[1] * (1 - m), c[2] * m + base[2] * (1 - m), c[3] * m + base[3] * (1 - m)];
  };
};

/**
 * Spotlight: the pool of light is the subject, or the subject blurred over Spread (twice it, so its edge is fully lit);
 * outside it the encoded colour is drained, tinted (Tint Colour at its brightness) and darkened; then the subject and
 * its pool get Lift's light, the colour there times Light Colour, added in linear light.
 */
const spotlight: KernelReference = (p) => {
  const spread = Math.max(0.5, p.spread as number);
  const amount = (p.amount as number) / 100;
  const desaturate = (p.desaturate as number) / 100;
  const tint = hexEncoded(p.tint as string);
  const tintAmount = (p.tintAmount as number) / 100;
  const lift = (p.lift as number) / 100;
  const light = dec3(hexEncoded(p.light as string));
  return ([x, y], c, env) => {
    const s = env.scene(x, y)[1];
    const b = blurredSubject(env, x, y, spread, POOL_TAPS, turnAt(x, y));
    const pool = Math.max(s, smoothstep(0, 0.5, b));
    const e = enc3(unpremul(c));
    const grey = dot(e);
    let v = [mix(e[0], grey, desaturate), mix(e[1], grey, desaturate), mix(e[2], grey, desaturate)];
    const d = dot(v) - dot(tint);
    v = [0, 1, 2].map((i) => mix(v[i], clamp(tint[i] + d), tintAmount));
    const dim = fromEncoded(v, c[3]);
    const w = 1 - pool;
    const k = 1 - amount;
    const out: Pixel = [mix(c[0], dim[0] * k, w), mix(c[1], dim[1] * k, w), mix(c[2], dim[2] * k, w), c[3]];
    const l = lift * pool;
    return addLight(out, [out[0] * l * light[0], out[1] * l * light[1], out[2] * l * light[2]]) as Pixel;
  };
};

export const SUBJECT_REFERENCES: Record<string, KernelReference> = { aura, "rim-light": rimLight, sticker, spotlight };
