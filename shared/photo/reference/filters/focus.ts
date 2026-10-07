/** The focus filters' CPU references (`../../effects/filters/focus.ts`), mirrored by `render/filters/focus.ts`. */
import { type SceneMaps, sceneAt, sceneOf } from "../../scene.ts";
import type { EffectParamValue } from "../../types.ts";
import { type KernelEnv, type KernelReference, type Pixel, clamp, dec, enc, enc3, luma, premul, rand, smoothstep, unpremul } from "../kernel.ts";
import { warpCentre } from "./warp.ts";

const RAD = Math.PI / 180;

/** The golden angle: successive taps of a spiral turned by it fill a disc evenly (Vogel's). */
export const GOLDEN = Math.PI * (3 - Math.sqrt(5));
/** The most taps inside a point's own circle of confusion, and outside it (where nearer blur may reach it from). */
export const MAX_IN = 128;
export const MAX_OUT = 64;
/** Depth reads looking for nearer blur around a point: rings, each of this many. */
export const PROBE_RINGS = 3;
export const PROBES = 8;
/** How much nearer (in depth) a tap must be to be wholly in front of the point, covering it rather than behind it. */
export const FRONT_SPAN = 0.02;
/** The seed turning each pixel's spiral (no Seed: it only trades the taps' pattern for fine noise). */
export const FOCUS_SEED = 7;
/** Anamorphic bokeh's width against its height. */
export const OVAL = 0.6;
/** Each aperture's area at radius 1: a circle, a hexagon (circumradius 1), an anamorphic oval. */
export const SHAPE_AREAS = [Math.PI, (3 * Math.sqrt(3)) / 2, Math.PI * OVAL];
export const APERTURES: Record<string, number> = { circle: 0, hexagon: 1, anamorphic: 2 };
/** Highlights at 100%: how many times brighter the brightest out-of-focus light gets. */
export const HIGHLIGHT_GAIN = 4;
/** How far above Threshold (encoded) light is brightened fully. */
export const HIGHLIGHT_SOFT = 0.08;
/** The blur's radius (document pixels) at which light is brightened fully: in-focus light is left as it is. */
export const BOKEH_FULL = 6;
/** Tilt-Shift's Highlights threshold (encoded). */
export const TILT_THRESHOLD = 0.85;
/** How strongly Contrast's S-curve bends at 100%. */
export const CONTRAST_S = 2;

/** What the gather needs of a filter: its circle of confusion anywhere, and how its bokeh looks. */
export interface FocusSpec {
  /** The circle of confusion's radius (document pixels) at a document point of depth `d`. */
  coc: (x: number, y: number, d: number) => number;
  /** Whether it reads the depth map (else every point is at depth 0, and nothing is in front of anything). */
  usesDepth: boolean;
  /** The largest circle of confusion in front of anything (0: nothing nearer blurs over what's behind it). */
  fgMax: number;
  shape: number;
  /** Cat's Eye, 0..1. */
  cats: number;
  /** Highlights' gain and threshold (encoded). */
  gain: number;
  threshold: number;
}

/** A read held within the canvas's edge pixels (as evaluated), never farther from the point than asked. */
const onCanvas = (q: number, p: number, size: number, px: number) => clamp(q, Math.min(p, 0.5 * px), Math.max(p, size - 0.5 * px));

/** The aperture's gauge of an offset: 1 on its rim at radius 1, scaling with the offset (a circle's is its length). */
export function gauge(shape: number, ox: number, oy: number): number {
  if (shape === 1) {
    const h = Math.sqrt(3) / 2;
    return Math.max(Math.abs(ox), Math.abs(0.5 * ox + h * oy), Math.abs(-0.5 * ox + h * oy)) / h;
  }
  if (shape === 2) return Math.hypot(ox / OVAL, oy);
  return Math.hypot(ox, oy);
}

/** What's left of a disc by a cat's eye `k` (0..1): two unit discs k apart, their overlap's share of one. */
export const lensFraction = (k: number) => (2 * Math.acos(k / 2) - (k / 2) * Math.sqrt(4 - k * k)) / Math.PI;

/**
 * How much of a tap's circle of confusion (radius `r`, the aperture's shape, squeezed by a cat's eye `k` along `v`)
 * reaches the point at offset `o` from it: 1 inside, 0 outside, over `e` pixels at its rim.
 */
function cover(shape: number, r: number, ox: number, oy: number, k: number, vx: number, vy: number, e: number): number {
  let v = clamp((r - gauge(shape, ox, oy)) / e + 0.5);
  if (k > 0) {
    const h = (k * r) / 2;
    v = Math.min(v, clamp((r - Math.hypot(ox - vx * h, oy - vy * h)) / e + 0.5), clamp((r - Math.hypot(ox + vx * h, oy + vy * h)) / e + 0.5));
  }
  return v;
}

/**
 * The gather of a lens's circles of confusion at a point (scattering as gathering): taps on a spiral turned by a seeded
 * angle per pixel, over the point's own circle of confusion and, where nearer blur may reach it, out to that blur's
 * size (found by rings of depth probes). Each tap counts where its own circle reaches the point, weighted by the share
 * of its light that lands there (its tap's area over its circle's). Taps behind the point reach it as far as the
 * point's own blur, no farther (a sharp point hides what's behind it: no halo) and no nearer (what's behind a blurred
 * point shows through its blur); taps in front cover it by their own blur, as a layer over the rest. Premultiplied linear light is averaged, so light above white blooms into bright discs.
 */
export function gatherFocus(f: FocusSpec, x: number, y: number, c: Pixel, env: KernelEnv): Pixel {
  const { width, height } = env.canvas;
  const s = Math.max(1, env.px);
  const halfDiag = Math.hypot(width, height) / 2;
  const turn = 2 * Math.PI * rand(Math.floor(x), Math.floor(y), FOCUS_SEED);
  const dp = f.usesDepth ? env.scene(x, y)[0] : 0;
  const rp = f.coc(x, y, dp);
  // How far nearer blur may reach this point from.
  let R = rp;
  if (f.fgMax > 0) {
    for (let j = 0; j < PROBE_RINGS; j++) {
      const rr = (f.fgMax * (j + 1)) / PROBE_RINGS;
      for (let i = 0; i < PROBES; i++) {
        const a = turn + ((i + j / PROBE_RINGS) * 2 * Math.PI) / PROBES;
        const qx = x + Math.cos(a) * rr;
        const qy = y + Math.sin(a) * rr;
        const dq = env.scene(qx, qy)[0];
        if (dq > dp) R = Math.max(R, f.coc(qx, qy, dq));
      }
    }
  }
  const back = [0, 0, 0, 0];
  const front = [0, 0, 0, 0];
  let wb = 0;
  let wf = 0;
  const tap = (qx: number, qy: number, area: number, centre: boolean) => {
    const hx = onCanvas(qx, x, width, env.px);
    const hy = onCanvas(qy, y, height, env.px);
    const ox = hx - x;
    const oy = hy - y;
    const q = centre ? c : env.src(hx, hy);
    const dq = centre ? dp : f.usesDepth ? env.scene(hx, hy)[0] : 0;
    const rq = centre ? rp : f.coc(hx, hy, dq);
    // Highlights: out-of-focus light above the threshold brightened.
    let b = 1;
    if (f.gain > 0 && q[3] > 0) b = 1 + f.gain * smoothstep(f.threshold, f.threshold + HIGHLIGHT_SOFT, enc(luma(unpremul(q)))) * clamp(rq / BOKEH_FULL);
    // Cat's eye: squeezed along the line from the canvas's centre, more towards its corners.
    let k = 0;
    let vx = 0;
    let vy = 0;
    if (f.cats > 0) {
      const dx = hx - width / 2;
      const dy = hy - height / 2;
      const len = Math.hypot(dx, dy);
      k = f.cats * Math.min(1, len / halfDiag);
      if (len > 0) {
        vx = dx / len;
        vy = dy / len;
      }
    }
    const shapeArea = SHAPE_AREAS[f.shape] * lensFraction(k);
    const t = f.usesDepth ? clamp((dq - dp) / FRONT_SPAN) : 0;
    const behind = f.usesDepth ? clamp((dp - dq) / FRONT_SPAN) : 0;
    if (t > 0) {
      const w = t * cover(f.shape, rq, ox, oy, k, vx, vy, s) * Math.min(1, area / (shapeArea * Math.max(rq, 0.5) ** 2));
      for (let ch = 0; ch < 3; ch++) front[ch] += q[ch] * b * w;
      front[3] += q[3] * w;
      wf += w;
    }
    if (t < 1) {
      const rb = Math.min(rq, rp) + (rp - Math.min(rq, rp)) * behind;
      const w = (1 - t) * cover(f.shape, rb, ox, oy, k, vx, vy, s) * Math.min(1, area / (shapeArea * Math.max(rb, 0.5) ** 2));
      for (let ch = 0; ch < 3; ch++) back[ch] += q[ch] * b * w;
      back[3] += q[3] * w;
      wb += w;
    }
  };
  // The point's own circle, the point first.
  const nIn = Math.min(MAX_IN, Math.max(1, Math.ceil((Math.PI * rp * rp) / (s * s))));
  const aIn = (Math.PI * Math.max(rp, 0.5) ** 2) / nIn;
  for (let k = 0; k < nIn; k++) {
    const r = rp * Math.sqrt(k / nIn);
    const a = turn + k * GOLDEN;
    tap(x + Math.cos(a) * r, y + Math.sin(a) * r, aIn, k === 0);
  }
  // Beyond it, where nearer blur reaches.
  if (R > rp + 0.5) {
    const ring = Math.PI * (R * R - rp * rp);
    const nOut = Math.min(MAX_OUT, Math.max(1, Math.ceil(ring / (s * s))));
    const aOut = ring / nOut;
    for (let k = 0; k < nOut; k++) {
      const r = Math.sqrt(rp * rp + ((R * R - rp * rp) * (k + 0.5)) / nOut);
      const a = turn + 1 + k * GOLDEN;
      tap(x + Math.cos(a) * r, y + Math.sin(a) * r, aOut, false);
    }
  }
  const under: Pixel = wb > 0 ? [back[0] / wb, back[1] / wb, back[2] / wb, back[3] / wb] : [c[0], c[1], c[2], c[3]];
  if (!(wf > 0)) return under;
  const cov = Math.min(1, wf);
  return [0, 1, 2, 3].map((ch) => under[ch] * (1 - cov) + (front[ch] / wf) * cov) as Pixel;
}

// --- Lens Blur ---

const subjectDepths = new WeakMap<SceneMaps, number>();

/** Bins of the subject's depths. */
const DEPTH_BINS = 256;
/** The share of the subject (by weight) farther than its depth: subjects stand in front of what their map spills onto. */
export const SUBJECT_PERCENTILE = 0.75;

/**
 * The subject's depth: a high percentile of the depth map weighted by the subject map squared (its solid middle counts,
 * its soft edge little), so the background its map spills onto (around thin shapes) doesn't pull it back; the canvas
 * centre's depth if there's no subject.
 */
export function subjectDepth(maps: SceneMaps | null, canvas: { width: number; height: number }): number {
  if (!maps?.depth) return 0;
  const known = subjectDepths.get(maps);
  if (known !== undefined) return known;
  const bins = new Float64Array(DEPTH_BINS);
  let total = 0;
  if (maps.subject) {
    for (let i = 0; i < maps.depth.length; i++) {
      const w = maps.subject[i] * maps.subject[i];
      bins[Math.min(DEPTH_BINS - 1, Math.max(0, Math.floor(maps.depth[i] * DEPTH_BINS)))] += w;
      total += w;
    }
  }
  let depth = sceneAt(maps, canvas.width / 2, canvas.height / 2)[0];
  if (total > 1e-3) {
    const target = total * SUBJECT_PERCENTILE;
    let below = 0;
    for (let b = 0; b < DEPTH_BINS; b++) {
      if (bins[b] > 0 && below + bins[b] >= target) {
        depth = (b + (target - below) / bins[b]) / DEPTH_BINS;
        break;
      }
      below += bins[b];
    }
  }
  subjectDepths.set(maps, depth);
  return depth;
}

/** Lens Blur's focus depth: the subject's, the depth at Focus Point, or Focus Distance. */
export function lensFocus(p: Record<string, EffectParamValue>, canvas: { width: number; height: number }): number {
  if (p.focusOn === "distance") return (p.distance as number) / 100;
  const maps = sceneOf(p);
  if (p.focusOn === "subject") return subjectDepth(maps, canvas);
  const [fx, fy] = warpCentre(p.focus, canvas);
  return sceneAt(maps, fx, fy)[0];
}

/**
 * Lens Blur's circle of confusion: linear in the depth's distance from the focus beyond half Focus Range (the depth
 * map is relative inverse depth, in which a lens's blur is linear), Blur where it's farthest on the side(s) blurred.
 */
export function lensSettings(p: Record<string, EffectParamValue>, canvas: { width: number; height: number }) {
  const focus = lensFocus(p, canvas);
  const half = (p.range as number) / 200;
  const backOnly = p.side === "background";
  const blur = p.blur as number;
  const scale = blur / Math.max(0.05, (backOnly ? focus : Math.max(focus, 1 - focus)) - half);
  const coc = (d: number) => {
    const s = d - focus;
    return backOnly && s > 0 ? 0 : Math.min(blur, scale * Math.max(0, Math.abs(s) - half));
  };
  const front = backOnly ? 0 : coc(1);
  return { focus, half, scale, backOnly, blur, coc, fgMax: front < 0.5 ? 0 : front, shape: APERTURES[p.aperture as string] ?? 0, cats: (p.catsEye as number) / 100, gain: ((p.highlights as number) / 100) * HIGHLIGHT_GAIN, threshold: (p.threshold as number) / 100 };
}

/** Lens Blur: depth of field around the focus depth. */
const lensBlur: KernelReference = (p, canvas) => {
  const l = lensSettings(p, canvas);
  const spec: FocusSpec = { coc: (_x, _y, d) => l.coc(d), usesDepth: true, fgMax: l.fgMax, shape: l.shape, cats: l.cats, gain: l.gain, threshold: l.threshold };
  return ([x, y], c, env) => gatherFocus(spec, x, y, c, env);
};

// --- Tilt-Shift ---

/** Tilt-Shift's band, blur and finish. */
export function tiltSettings(p: Record<string, EffectParamValue>, canvas: { width: number; height: number }) {
  const usesDepth = p.mode === "depth";
  const [fx, fy] = warpCentre(p.focus, canvas);
  const angle = (p.angle as number) * RAD;
  const nx = -Math.sin(angle);
  const ny = Math.cos(angle);
  const half = (p.band as number) / 2;
  const invT = 1 / Math.max(p.transition as number, 1e-3);
  const depthFocus = usesDepth ? sceneAt(sceneOf(p), fx, fy)[0] : 0;
  const depthHalf = (p.range as number) / 200;
  const depthInvT = 1 / Math.max((p.falloff as number) / 100, 1e-3);
  const blur = p.blur as number;
  const coc = (x: number, y: number, d: number) => blur * smoothstep(0, 1, usesDepth ? (Math.abs(d - depthFocus) - depthHalf) * depthInvT : (Math.abs((x - fx) * nx + (y - fy) * ny) - half) * invT);
  const front = usesDepth ? coc(0, 0, 1) : 0;
  return { usesDepth, fx, fy, nx, ny, half, invT, depthFocus, depthHalf, depthInvT, blur, coc, fgMax: front < 0.5 ? 0 : front, gain: ((p.highlights as number) / 100) * HIGHLIGHT_GAIN, sat: (p.saturation as number) / 100, con: (p.contrast as number) / 100 };
}

/** Rec. 709's weights, used on encoded colour as a stylised brightness. */
const W = [0.2126, 0.7152, 0.0722] as const;

/**
 * The miniature's finish on encoded colour: saturation about its grey, then an S-curve of contrast; light above white
 * is kept above it (added back after).
 */
export function finish(c: Pixel, sat: number, con: number): Pixel {
  if ((sat === 0 && con === 0) || !(c[3] > 0)) return c;
  const l = unpremul(c);
  const e = enc3(l);
  const g = W[0] * e[0] + W[1] * e[1] + W[2] * e[2];
  const out = [0, 1, 2].map((i) => {
    const v = clamp(g + (e[i] - g) * (1 + sat));
    return dec(clamp(v + con * CONTRAST_S * (v * v * (3 - 2 * v) - v))) + Math.max(l[i] - 1, 0);
  });
  return premul(out, c[3]);
}

/** Tilt-Shift: blur growing away from a band (or a range of depths), then the miniature's finish. */
const tiltShift: KernelReference = (p, canvas) => {
  const t = tiltSettings(p, canvas);
  const spec: FocusSpec = { coc: t.coc, usesDepth: t.usesDepth, fgMax: t.fgMax, shape: 0, cats: 0, gain: t.gain, threshold: TILT_THRESHOLD };
  return ([x, y], c, env) => finish(t.blur > 0 ? gatherFocus(spec, x, y, c, env) : c, t.sat, t.con);
};

export const FOCUS_REFERENCES: Record<string, KernelReference> = { "lens-blur": lensBlur, "tilt-shift": tiltShift };
