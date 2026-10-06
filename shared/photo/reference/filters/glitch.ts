/** The glitch filters' CPU references (`../../effects/filters/glitch.ts`), mirrored by `render/filters/glitch.ts`. */
import { type KernelReference, type Pixel, clamp, enc3, fract, fromEncoded, mix, rand, smoothstep, unpremul, vnoise } from "../kernel.ts";

/** RGB Split: red read from behind its shift, blue (or green and blue) from ahead of it; coverage the most of them. */
const rgbSplit: KernelReference = (p, canvas) => {
  const distance = p.distance as number;
  const angle = ((p.angle as number) * Math.PI) / 180;
  const radial = p.mode === "radial";
  const anaglyph = p.pair === "anaglyph";
  const half = Math.hypot(canvas.width, canvas.height) / 2;
  return ([x, y], c, env) => {
    let dx = Math.cos(angle) * distance;
    let dy = Math.sin(angle) * distance;
    if (radial) {
      dx = ((x - canvas.width / 2) / half) * distance;
      dy = ((y - canvas.height / 2) / half) * distance;
    }
    const r = env.src(x - dx, y - dy);
    const b = env.src(x + dx, y + dy);
    if (anaglyph) return [r[0], b[1], b[2], Math.max(r[3], b[3])] as Pixel;
    return [r[0], c[1], b[2], Math.max(r[3], c[3], b[3])] as Pixel;
  };
};

/**
 * A read at `q` (one axis) kept within the canvas's edge pixels as evaluated (`px` document pixels each), unless `p`
 * is off it: never farther from `p` than `q`.
 */
const onCanvas = (q: number, p: number, size: number, px: number) => clamp(q, Math.min(p, 0.5 * px), Math.max(p, size - 0.5 * px));

/**
 * Glitch: slices on two grids (Slice Height and about a third of it) shoved sideways, blocks on a staggered grid
 * twice the slice copied from elsewhere, dragged into a streak of one line or corrupted, every move whole pixels
 * and within Shift; then the channels split, more where something moved.
 */
const glitch: KernelReference = (p, canvas) => {
  const h = p.sliceHeight as number;
  const thin = h * 0.31;
  const size = 2 * h;
  const shift = p.shift as number;
  const density = (p.density as number) / 100;
  const blocks = (p.blocks as number) / 100;
  const split = p.split as number;
  const seed = p.seed as number;
  return ([x, y], _c, env) => {
    const row = Math.floor(y / h);
    const onA = rand(row, 0, seed) < density ? 1 : 0;
    let dx = onA * (rand(row, 1, seed) * 2 - 1) * shift;
    const swap = onA === 1 && rand(row, 2, seed) > 0.88;
    const rowB = Math.floor(y / thin);
    const onB = rand(rowB, 0, seed + 17) < density * 0.5 ? 1 : 0;
    dx += onB * (rand(rowB, 1, seed + 17) * 2 - 1) * shift * 0.35;
    let hit = Math.max(onA, onB);
    let dy = 0;
    const cy = Math.floor(y / size);
    const cx = Math.floor((x + rand(cy, 5, seed + 31) * size) / size);
    let corrupt = 0;
    if (rand(cx, cy, seed + 37) < blocks * 0.45) {
      hit = 1;
      const kind = rand(cx, cy, seed + 41);
      if (kind < 0.5) {
        dx += (rand(cx, cy, seed + 43) * 2 - 1) * shift;
        dy += (rand(cx, cy, seed + 47) * 2 - 1) * shift * 0.5;
      } else if (kind < 0.78) {
        dy += Math.floor((cy + rand(cx, cy, seed + 53)) * size) + 0.5 - y;
      } else corrupt = kind;
    }
    dx = clamp(Math.floor(dx + 0.5), -shift, shift);
    dy = clamp(Math.floor(dy + 0.5), -shift, shift);
    const s = split * (hit === 1 ? 1 : 0.35) * (rand(1, 2, seed + 59) < 0.5 ? -1 : 1);
    // Past the canvas's edge, its last pixels are read again (smeared) rather than nothing.
    const at = (qx: number) => env.src(onCanvas(qx, x, canvas.width, env.px), onCanvas(y + dy, y, canvas.height, env.px));
    const r = at(x + dx + s);
    const g = at(x + dx);
    const b = at(x + dx - s);
    let out: Pixel = [r[0], g[1], b[2], Math.max(r[3], g[3], b[3])];
    if (swap) out = [out[1], out[2], out[0], out[3]];
    if (corrupt > 0) {
      let v = enc3(unpremul(out)).map((e) => Math.floor(e * 4 + 0.5) / 4);
      if (corrupt > 0.9) v = [v[1], v[2], v[0]];
      out = fromEncoded(v, out[3]);
    }
    return out;
  };
};

const W = [0.2126, 0.7152, 0.0722] as const;
const dot = (v: readonly number[]) => W[0] * v[0] + W[1] * v[1] + W[2] * v[2];

/**
 * VHS: each line (Line Height) moved sideways by a smooth wobble, a jitter and, in the tracking band, a shove; its
 * brightness softened a little and its colour averaged over Bleed to its left (so colour trails brightness); then
 * washed out, the band lit and streaked, scanlines (faded where they'd be finer than the pixels shown) and snow.
 */
const vhs: KernelReference = (p, canvas) => {
  const bleed = p.bleed as number;
  const jitter = p.jitter as number;
  const lh = p.lineHeight as number;
  const tracking = (p.tracking as number) / 100;
  const bandY = ((p.band as number) / 100) * canvas.height;
  const bandH = 0.05 * canvas.height;
  const scan = (p.scanlines as number) / 100;
  const noise = (p.noise as number) / 100;
  const w = (p.wash as number) / 100;
  const seed = p.seed as number;
  return ([x, y], _c, env) => {
    const line = Math.floor(y / lh);
    const band = (1 - smoothstep(0, 1, Math.abs((line + 0.5) * lh - bandY) / bandH)) * tracking;
    const dx = (vnoise(line * 0.23, 0, seed) - 0.5) * 2 * jitter + (rand(line, 7, seed) - 0.5) * 0.7 * jitter + band * (0.3 + 0.7 * rand(line, 11, seed)) * 4.65 * jitter;
    const qx = x + dx;
    const s0 = env.src(qx, y);
    const left = env.src(qx - bleed / 6, y);
    const right = env.src(qx + bleed / 6, y);
    const sum = [s0[0] + left[0], s0[1] + left[1], s0[2] + left[2], s0[3] + left[3]];
    for (let k = 2; k <= 6; k++) {
      const t = env.src(qx - (bleed * k) / 6, y);
      for (let i = 0; i < 4; i++) sum[i] += t[i];
    }
    const lum = 0.25 * dot(enc3(unpremul(left))) + 0.5 * dot(enc3(unpremul(s0))) + 0.25 * dot(enc3(unpremul(right)));
    const vb = enc3(unpremul(sum as Pixel));
    const yb = dot(vb);
    let v = vb.map((e) => clamp(e - yb + lum));
    const a = Math.max(s0[3], left[3], right[3], sum[3] / 7);
    const yv = dot(v);
    const lift = [0.1, 0.075, 0.05];
    const tone = [1 + 0.05 * w, 1, 1 - 0.06 * w];
    v = v.map((e, i) => (mix(e, yv, 0.5 * w) * (1 - 0.15 * w) + w * lift[i]) * tone[i]);
    const streak = rand(Math.floor(x / (lh * 8)), line, seed + 5);
    v = v.map((e) => mix(e + band * 0.06, 1, band * smoothstep(0.82, 1, streak) * 0.8));
    const fine = smoothstep(1, 2, lh / env.px);
    const dark = scan * 0.6 * (0.5 + 0.5 * Math.cos(2 * Math.PI * fract((y - 0.5) / lh))) * fine;
    const n = rand(Math.floor(x), Math.floor(y), seed + 3);
    const amp = noise * 0.3 + band * 0.25;
    v = v.map((e) => clamp(e * (1 - dark) + (n - 0.5) * amp));
    return fromEncoded(v, a);
  };
};

export const GLITCH_REFERENCES: Record<string, KernelReference> = { "rgb-split": rgbSplit, glitch, vhs };
