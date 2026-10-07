/** The wind filters' CPU references (`../../effects/filters/wind.ts`), mirrored by `render/filters/wind.ts`. */
import { type KernelReference, type Pixel, clamp, enc, enc3, fromEncoded, hexEncoded, luma, mix, rand, smoothstep, unpremul, vnoise } from "../kernel.ts";

const RAD = Math.PI / 180;

/** The most taps Wind reads upwind of a point (two reads each), and Motion Blur along its line: their reads' budget. */
export const WIND_TAPS = 96;
/** How far downwind of a tap Wind looks for the change that makes it an edge, as a share of Length: soft edges count. */
export const EDGE_SPAN = 1 / 12;
export const BLUR_TAPS = 192;

/** How far above Threshold an edge's change of brightness must go to start a streak at full strength. */
const EDGE_SOFTNESS = 0.12;

/**
 * Each Wind method's streaks: the rows' thickness (document pixels), the shortest row's share of Length, how fast a
 * streak fades along it (a power of what's left of it), and whether streaks are thrown off their edges.
 */
export function windMethod(method: unknown, length: number) {
  if (method === "blast") return { thickness: Math.max(2, length * 0.02), shortest: 0.5, power: 0.5, stagger: false };
  if (method === "stagger") return { thickness: 1, shortest: 0.2, power: 0.9, stagger: true };
  return { thickness: 1, shortest: 0.12, power: 1.6, stagger: false };
}

/** Streaks' modes: which way across an edge the brightness must fall. */
export const STREAK_MODES: Record<string, number> = { light: 0, dark: 1, both: 2 };

/**
 * A read at `q` (one axis) kept within the canvas's edge pixels as evaluated (`px` document pixels each), unless `p`
 * is off it: never farther from `p` than `q`, so the canvas's border reads as its edge pixels, not transparency.
 */
const onCanvas = (q: number, p: number, size: number, px: number) => clamp(q, Math.min(p, 0.5 * px), Math.max(p, size - 0.5 * px));

/** Rec. 709's weights, used on encoded colour as a stylised brightness. */
const dot = (v: readonly number[]) => 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2];

/** A sample's encoded brightness over its coverage, so a cut-out's outline is an edge. */
const brightness = (s: Pixel) => s[3] * enc(luma(unpremul(s)));

/**
 * Wind: in the wind's frame (u along it, v across), taps upwind of the point `step` apart; a tap is an edge when its
 * brightness differs from a read `gap` downwind of it (a share of Length, so a look is the same at any size) by more
 * than Threshold (falling for light streaks, rising for dark).
 * Each row of `thickness` (v) has its streaks' length, a random share of Length (and smooth noise along the row by
 * where the edge is); Stagger throws them off their edges by a random offset. A streak's weight falls along it; the
 * strongest at the point wins and its colour (tinted) is mixed in, premultiplied.
 */
const wind: KernelReference = (p, canvas) => {
  const angle = (p.angle as number) * RAD;
  const cs = Math.cos(angle);
  const sn = Math.sin(angle);
  const L = p.length as number;
  const method = windMethod(p.method, L);
  const threshold = (p.threshold as number) / 100;
  const mode = STREAK_MODES[p.streaks as string] ?? 0;
  const tint = hexEncoded(p.tint as string);
  const tintAmount = (p.tintAmount as number) / 100;
  const seed = (p.seed as number) >>> 0;
  return ([x, y], c, env) => {
    const step = Math.max(1, env.px, L / WIND_TAPS);
    const taps = Math.min(WIND_TAPS, Math.floor(L / step + 1e-3));
    const gap = Math.max(step, L * EDGE_SPAN);
    const u = cs * x + sn * y;
    const v = -sn * x + cs * y;
    const row = Math.floor(v / method.thickness);
    const rowLength = L * mix(method.shortest, 1, rand(row, 0, seed)) * (method.stagger ? 0.55 : 1);
    const offset = method.stagger ? rand(row, 1, seed) * 0.45 * L : 0;
    let best = 0;
    let streak: Pixel = c;
    for (let t = 1; t <= taps; t++) {
      const d = t * step;
      const s = env.src(onCanvas(x - cs * d, x, canvas.width, env.px), onCanvas(y - sn * d, y, canvas.height, env.px));
      const b = brightness(s);
      const downwind = brightness(env.src(onCanvas(x - cs * (d - gap), x, canvas.width, env.px), onCanvas(y - sn * (d - gap), y, canvas.height, env.px)));
      const change = mode === 0 ? b - downwind : mode === 1 ? downwind - b : Math.abs(b - downwind);
      const strength = smoothstep(threshold, threshold + EDGE_SOFTNESS, change);
      if (strength > 0) {
        const len = rowLength * mix(0.55, 1, vnoise(((u - d) / L) * 4, row, (seed + 1) >>> 0));
        const along = d - offset;
        if (along >= 0 && along < len) {
          const w = strength * Math.pow(1 - along / len, method.power);
          if (w > best) {
            best = w;
            streak = s;
          }
        }
      }
    }
    if (!(best > 0)) return c;
    if (tintAmount > 0) {
      // The tint at the streak's brightness: black stays black, white white, the middle the tint (a hard light).
      const e = enc3(unpremul(streak));
      const l = dot(e);
      const tinted = tint.map((t, i) => mix(e[i], l < 0.5 ? 2 * l * t : 1 - 2 * (1 - l) * (1 - t), tintAmount));
      streak = fromEncoded(tinted, streak[3]);
    }
    return [mix(c[0], streak[0], best), mix(c[1], streak[1], best), mix(c[2], streak[2], best), mix(c[3], streak[3], best)];
  };
};

/**
 * Motion Blur: the premultiplied average of reads along the line, at most a document pixel apart where the budget
 * allows (and never closer than the pixels evaluated): Centred evenly across it, Trail ahead of the point only (so the
 * picture smears behind its motion), weighted down away from it.
 */
const motionBlur: KernelReference = (p, canvas) => {
  const angle = (p.angle as number) * RAD;
  const cs = Math.cos(angle);
  const sn = Math.sin(angle);
  const D = p.distance as number;
  const trail = p.shape === "trail";
  return ([x, y], _c, env) => {
    const taps = Math.min(BLUR_TAPS, Math.ceil(D / Math.max(1, env.px))) + 1;
    const spacing = taps > 1 ? D / (taps - 1) : 0;
    const start = trail ? 0 : -D / 2;
    const sum = [0, 0, 0, 0];
    let total = 0;
    for (let i = 0; i < taps; i++) {
      const s = start + i * spacing;
      const w = trail ? 1 - i / taps : 1;
      const q = env.src(onCanvas(x + cs * s, x, canvas.width, env.px), onCanvas(y + sn * s, y, canvas.height, env.px));
      for (let k = 0; k < 4; k++) sum[k] += q[k] * w;
      total += w;
    }
    return [sum[0] / total, sum[1] / total, sum[2] / total, sum[3] / total];
  };
};

export const WIND_REFERENCES: Record<string, KernelReference> = { wind, "motion-blur": motionBlur };
