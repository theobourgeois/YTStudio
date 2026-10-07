/** CRT's CPU reference (`../../effects/filters/crt.ts`), mirrored by `render/filters/crt.ts`. */
import { addLight } from "../../effects/glow.ts";
import { type KernelReference, type Pixel, type Rgb, clamp, enc, fract, luma, mix, smoothstep, unpremul } from "../kernel.ts";
import { held } from "./stylize.ts";

const CRT_MASKS: Record<string, number> = { aperture: 0, shadow: 1, slot: 2 };
/** A shadow mask's rows of dots, apart by this many dot pitches: dots packed in triangles. */
const ROW = Math.sqrt(3) / 2;

/**
 * A CRT mask's transmission for each phosphor at (x, y) in cells (a cell is one red-green-blue triad wide), edges
 * smoothed over `a` cells. Aperture Grille: three vertical stripes a cell. Shadow Mask: rows of dots a third of a cell
 * apart, every other row shifted half a dot and its colours turned, so each three neighbours make a triangle of the
 * three colours. Slot Mask: the stripes cut into slots a cell tall, every other triad half a slot lower.
 */
export function crtMask(kind: number, x: number, y: number, a: number): Rgb {
  const out: Rgb = [0, 0, 0];
  const s = 3 * a;
  if (kind === 1) {
    const X = x * 3;
    const Y = (y * 3) / ROW;
    const r0 = Math.floor(Y - 0.5);
    for (let j = 0; j < 2; j++) {
      const r = r0 + j;
      const odd = r & 1;
      const dy = (Y - (r + 0.5)) * ROW;
      const i0 = Math.floor(X - 0.5 * odd - 0.5);
      for (let k = 0; k < 2; k++) {
        const i = i0 + k;
        const d = Math.hypot(X - (i + 0.5 + 0.5 * odd), dy);
        const ch = (((i + 2 * odd) % 3) + 3) % 3;
        out[ch] = Math.max(out[ch], 1 - smoothstep(0.3 - s, 0.46 + s, d));
      }
    }
    return out;
  }
  const u = fract(x) * 3;
  const k = Math.min(2, Math.floor(u));
  const d = Math.abs(fract(u) - 0.5);
  if (kind === 2) {
    const yy = Math.abs(fract(y + 0.5 * (Math.floor(x) & 1)) - 0.5);
    out[k] = (1 - smoothstep(0.24 - s, 0.4 + s, d)) * (1 - smoothstep(0.36 - a, 0.46 + a, yy));
  } else out[k] = 1 - smoothstep(0.26 - s, 0.44 + s, d);
  return out;
}

const memo = new Map<number, number>();
/** A mask's average transmission per phosphor (sharp), worked out once: what Brightness makes up for. */
export function crtMaskMean(kind: number): number {
  let m = memo.get(kind);
  if (m === undefined) {
    // Over 3 × 2√3 cells: whole periods of every mask in x, of the shadow mask's rows in y (nearly so of the slots').
    const nx = 96;
    const ny = 192;
    let sum = 0;
    for (let j = 0; j < ny; j++)
      for (let i = 0; i < nx; i++) {
        const t = crtMask(kind, ((i + 0.5) / nx) * 3, ((j + 0.5) / ny) * 4 * Math.sqrt(3), 0.004);
        sum += t[0] + t[1] + t[2];
      }
    m = sum / (3 * nx * ny);
    memo.set(kind, m);
  }
  return m;
}

/** A beam's width across its row (as a share of the row) for a dark picture and a bright one: bright beams bloom. */
const BEAM = [0.2, 0.34] as const;
/** The beam's average across a row, at mid brightness: what Brightness makes up for in the scanlines. */
export const BEAM_MEAN = (() => {
  const sigma = (BEAM[0] + BEAM[1]) / 2;
  let sum = 0;
  for (let i = 0; i < 1000; i++) sum += Math.exp(-0.5 * (((i + 0.5) / 1000 - 0.5) / sigma) ** 2);
  return sum / 1000;
})();

/**
 * CRT's constants for these settings, shared with the WGSL's pack: the curve, the tube's corner, the mean
 * transmission and the gain making up for it.
 */
export function crtSetup(p: Record<string, unknown>, canvas: { width: number; height: number }) {
  const kind = CRT_MASKS[p.mask as string] ?? 0;
  const strength = (p.strength as number) / 100;
  const scan = (p.scanlines as number) / 100;
  const bulge = p.curvature as number;
  const half = Math.hypot(canvas.width, canvas.height) / 2;
  const meanMask = mix(1, crtMaskMean(kind), strength);
  const meanScan = 1 - scan * (1 - BEAM_MEAN);
  return {
    kind,
    strength,
    scan,
    meanMask,
    boost: 1 + (1 / (meanMask * meanScan) - 1) * ((p.brightness as number) / 100),
    glow: (p.glow as number) / 100,
    // The barrel: a point d from the centre is read from d (1 + k |d|² / R²), the corners `bulge` farther out.
    k: bulge / half,
    half,
    corner: Math.min(0.5 * bulge, 0.25 * Math.min(canvas.width, canvas.height)),
    vignette: (p.vignette as number) / 100,
    cell: p.cellSize as number,
  };
}

/**
 * CRT: the point moved out by the tube's curve; the picture there sampled per cell (the average of four reads), its
 * beam across the row (wider the brighter), lit through the mask (mask and scanlines faded to their averages where
 * finer than the pixels shown), made up for by Brightness, vignetted, black past the tube's rounded edge; then the
 * glow, twelve reads around it, added as light.
 */
const crt: KernelReference = (p, canvas) => {
  const k = crtSetup(p, canvas);
  const w = k.cell;
  const cx = canvas.width / 2;
  const cy = canvas.height / 2;
  const radius = 2.5 * w;
  return (pt, c, env) => {
    const dx = pt[0] - cx;
    const dy = pt[1] - cy;
    const f = 1 + (k.k * (dx * dx + dy * dy)) / (k.half * k.half);
    const qx = cx + dx * f;
    const qy = cy + dy * f;
    const bx = Math.abs(qx - cx) - (cx - k.corner);
    const by = Math.abs(qy - cy) - (cy - k.corner);
    const sd = Math.hypot(Math.max(bx, 0), Math.max(by, 0)) + Math.min(Math.max(bx, by), 0) - k.corner;
    const tube = clamp(0.5 - sd / env.px);
    if (!(tube > 0)) return [0, 0, 0, c[3]];
    const col = Math.floor(qx / w);
    const row = Math.floor(qy / w);
    const pic: Pixel = [0, 0, 0, 0];
    for (let j = 0; j < 2; j++)
      for (let i = 0; i < 2; i++) {
        const at = held((col + 0.25 + 0.5 * i) * w, (row + 0.25 + 0.5 * j) * w, pt, canvas);
        const s = env.src(at[0], at[1]);
        for (let ch = 0; ch < 4; ch++) pic[ch] += s[ch] / 4;
      }
    const lum = enc(luma(unpremul(pic)));
    const v = qy / w - row - 0.5;
    const sigma = mix(BEAM[0], BEAM[1], lum);
    const beam = Math.exp(-0.5 * (v / sigma) ** 2);
    const scan = 1 - k.scan * (1 - mix(BEAM_MEAN, beam, smoothstep(1.5, 3, w / env.px)));
    const m = crtMask(k.kind, qx / w, qy / w, (0.5 * env.px) / w);
    const fm = smoothstep(1, 2, w / 3 / env.px);
    const ex = (qx - cx) / cx;
    const ey = (qy - cy) / cy;
    const vig = 1 - k.vignette * smoothstep(0.5, 1.5, Math.hypot(ex, ey));
    const gain = k.boost * scan * vig * tube;
    const base: Pixel = [0, 0, 0, mix(c[3], clamp(pic[3]), tube)];
    for (let ch = 0; ch < 3; ch++) base[ch] = pic[ch] * mix(k.meanMask, mix(1, m[ch], k.strength), fm) * gain;
    const glow = [0, 0, 0];
    for (let i = 0; i < 6; i++) {
      const a1 = (i * Math.PI) / 3;
      const a2 = a1 + Math.PI / 6;
      const s1 = held(qx + Math.cos(a1) * 0.4 * radius, qy + Math.sin(a1) * 0.4 * radius, pt, canvas);
      const s2 = held(qx + Math.cos(a2) * radius, qy + Math.sin(a2) * radius, pt, canvas);
      const g1 = env.src(s1[0], s1[1]);
      const g2 = env.src(s2[0], s2[1]);
      for (let ch = 0; ch < 3; ch++) glow[ch] += 0.6 * g1[ch] + 0.4 * g2[ch];
    }
    const light = (k.glow * k.meanMask * (1 - k.scan * (1 - BEAM_MEAN)) * k.boost * vig * tube) / 6;
    return addLight(base, [glow[0] * light, glow[1] * light, glow[2] * light]) as Pixel;
  };
};


export const CRT_REFERENCES: Record<string, KernelReference> = { crt };
