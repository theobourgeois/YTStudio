/** The atmosphere filters' CPU references (`../../effects/filters/atmosphere.ts`), mirrored by `render/filters/atmosphere.ts`. */
import { addLight } from "../../effects/glow.ts";
import { PARTICLE_KINDS } from "../../effects/filters/atmosphere.ts";
import { type KernelReference, type Pixel, clamp, dec3, enc, hexEncoded, luma, mix, rand, rotate, smoothstep, unpremul, vnoise } from "../kernel.ts";
import { warpCentre } from "./warp.ts";

/** Four octaves of value noise, each turned off the last's lattice, in [0, 1]: WGSL's `fbm`. */
export function fbm(x: number, y: number, seed: number): number {
  let sum = 0;
  let amp = 0.5;
  let qx = x;
  let qy = y;
  for (let k = 0; k < 4; k++) {
    sum += amp * vnoise(qx, qy, (seed + k) >>> 0);
    const [rx, ry] = rotate(qx, qy, 0.6);
    qx = rx * 2.03 + 5.2;
    qy = ry * 2.03 + 1.3;
    amp *= 0.5;
  }
  return sum / 0.9375;
}

/** A read held inside the canvas when the point is, so blurring at its edge pulls no transparency in. */
const held = (v: number, at: number, size: number) => clamp(v, Math.min(at, 0.5), Math.max(at, size - 0.5));

/**
 * Fog: an optical depth from the distance beyond Start (the depth map's), plus ground fog by height in the frame,
 * broken into banks by fBm; the fog's share 1 − e^−τ mixes the content (softened by up to Soften, by that share) toward
 * the fog's colour lit near the light, in linear light. Coverage at least the fog's, and the glow's coverage rule.
 */
const fog: KernelReference = (p, canvas) => {
  const diag = Math.hypot(canvas.width, canvas.height);
  const tint = dec3(hexEncoded(p.colour as string));
  const glowTint = dec3(hexEncoded(p.glowColour as string));
  const [lx, ly] = warpCentre(p.light, canvas);
  const density = ((p.density as number) / 100) * 4;
  const start = Math.max(1e-3, (p.start as number) / 100);
  const ground = ((p.ground as number) / 100) * 3;
  const height = Math.max(0.01, (p.height as number) / 100);
  const wisps = (p.wisps as number) / 100;
  const scale = Math.max(1, p.scale as number);
  const glow = (p.glow as number) / 100;
  const spread = Math.max(1, ((p.spread as number) / 100) * diag);
  const soften = p.soften as number;
  const seed = (p.seed as number) >>> 0;
  return ([x, y], c, env) => {
    const depth = env.scene(x, y)[0];
    const dist = clamp((start - depth) / start);
    const low = Math.exp(-clamp((canvas.height - y) / canvas.height) / height);
    let w = 1;
    if (wisps > 0) w = mix(1, 2 * smoothstep(0.2, 0.8, fbm(x / scale, y / (scale * 0.5), seed)), wisps);
    const tau = (density * dist + ground * low * (0.3 + 0.7 * (1 - depth))) * w;
    const f = 1 - Math.exp(-tau);
    let b: Pixel = c;
    const r = soften * f;
    if (r > 0.5) {
      b = [c[0], c[1], c[2], c[3]];
      for (let k = 0; k < 8; k++) {
        const a = ((k + 0.5) * Math.PI) / 4;
        const s = k % 2 === 0 ? r : 0.5 * r;
        const t = env.src(held(x + Math.cos(a) * s, x, canvas.width), held(y + Math.sin(a) * s, y, canvas.height));
        for (let ch = 0; ch < 4; ch++) b[ch] += t[ch];
      }
      b = [b[0] / 9, b[1] / 9, b[2] / 9, b[3] / 9];
    }
    const d = Math.hypot(x - lx, y - ly) / spread;
    const g = glow * (0.7 * Math.exp(-d * d) + 0.3 * Math.exp(-2 * d));
    const lit = [tint[0] + glowTint[0] * g, tint[1] + glowTint[1] * g, tint[2] + glowTint[2] * g];
    return addLight([b[0] * (1 - f) + lit[0] * f, b[1] * (1 - f) + lit[1] * f, b[2] * (1 - f) + lit[2] * f, b[3] * (1 - f) + f], [0, 0, 0]) as Pixel;
  };
};

/**
 * Depth Particles: per layer, a grid of cells (across and along Angle, sized by the layer's largest particle and
 * Amount), each with at most one seeded particle at a depth in the layer, sized and defocused by it; the 3×3 cells
 * around the point are drawn (every particle reaches less than a cell, so that's all of them), hidden where the
 * picture is nearer. Snow covers, the rest add light; Glow's halo is light; then the glow's coverage rule.
 */
const depthParticles: KernelReference = (p) => {
  const kind = PARTICLE_KINDS[p.kind as string] ?? 0;
  const amount = (p.amount as number) / 100;
  const layers = Math.max(1, Math.min(6, Math.round(p.layers as number)));
  const size = p.size as number;
  const far = (p.far as number) / 100;
  const near = (p.near as number) / 100;
  const focus = (p.focus as number) / 100;
  const blur = (p.blur as number) / 100;
  const angle = ((p.angle as number) * Math.PI) / 180;
  const ca = Math.cos(angle);
  const sa = Math.sin(angle);
  const streak = (p.streak as number) / 100;
  const tint = dec3(hexEncoded(p.colour as string));
  const tint2 = dec3(hexEncoded(p.colour2 as string));
  const gain = Math.pow(2, p.intensity as number);
  const glow = (p.glow as number) / 100;
  const seed = (p.seed as number) >>> 0;
  const ratio = kind === 3 ? 4 : 2;
  const spacing = mix(16, 5, amount) / Math.sqrt(ratio);
  const presence = Math.min(1, amount * 2);
  return ([x, y], c, env) => {
    const ds = env.scene(x, y)[0];
    const qa = x * ca - y * sa;
    const qb = x * sa + y * ca;
    const lum = enc(luma(unpremul(c)));
    let o: Pixel = [c[0], c[1], c[2], c[3]];
    const light = [0, 0, 0];
    for (let k = 0; k < layers; k++) {
      const lo = mix(far, near, k / layers);
      const hi = mix(far, near, (k + 1) / layers);
      const cw = Math.max(3, size * Math.pow(2, 3 * (Math.max(lo, hi) - 1)) * 1.3 * spacing);
      const ch = cw * ratio;
      const ks = (seed + 101 * (k + 1)) >>> 0;
      const ci = Math.floor(qa / cw);
      const cj = Math.floor(qb / ch);
      for (let dj = -1; dj <= 1; dj++) {
        for (let di = -1; di <= 1; di++) {
          const i = ci + di;
          const j = cj + dj;
          if (!(rand(i, j, ks) < presence)) continue;
          const pa = (i + rand(i, j, ks + 1)) * cw;
          const pb = (j + rand(i, j, ks + 2)) * ch;
          const dp = mix(lo, hi, rand(i, j, ks + 3));
          const vis = clamp((dp - ds) / 0.03 + 1);
          if (!(vis > 0)) continue;
          const r = size * Math.pow(2, 3 * (dp - 1)) * (0.6 + 0.7 * rand(i, j, ks + 4));
          const bl = blur * Math.abs(dp - focus) * size * 3;
          const R = kind === 4 ? r : r + bl;
          const e = kind === 4 ? Math.max(env.px, 0.06 * r + 0.5 * bl) : Math.max(env.px, 0.4 * bl + 0.15 * r);
          const Re = Math.max(R, 0.5 * e);
          const ke = kind === 4 ? 1 : r / Re;
          const outer = Re + 0.5 * e;
          const Lh = Math.min(kind === 3 ? r * (4 + 16 * streak) : r * 8 * streak, ch - cw);
          const dA = qa - pa;
          const dB = qb - pb;
          const dB2 = dB - clamp(dB, -Lh, Lh);
          const dist = Math.sqrt(dA * dA + dB2 * dB2);
          if (!(dist < cw)) continue;
          let cov = 1 - smoothstep(Re - 0.5 * e, Re + 0.5 * e, dist);
          if (kind === 4) cov *= 0.55 + 0.45 * smoothstep(0.5 * Re, Re, dist);
          const Hh = Math.min(2.5 * outer, cw);
          const q = dist / Hh;
          const halo = q < 1 ? (1 - q * q) ** 3 : 0;
          const t = rand(i, j, ks + 5);
          const col = [mix(tint[0], tint2[0], t), mix(tint[1], tint2[1], t), mix(tint[2], tint2[2], t)];
          const rv = rand(i, j, ks + 6);
          const cv = cov * ke * vis;
          const h = glow * 0.3 * halo * vis * ke;
          if (kind === 0) {
            const a = clamp(cv * 0.9 * (0.6 + 0.4 * rv) * gain);
            o = [o[0] * (1 - a) + col[0] * a, o[1] * (1 - a) + col[1] * a, o[2] * (1 - a) + col[2] * a, o[3] * (1 - a) + a];
            for (let ch2 = 0; ch2 < 3; ch2++) light[ch2] += col[ch2] * h;
          } else {
            const br = kind === 1 ? gain * (0.15 + 0.85 * rv * rv) * (0.05 + 2 * lum * lum) : kind === 2 ? gain * 1.5 * (0.35 + 0.65 * rv) : kind === 3 ? gain * 0.4 * (0.4 + 0.6 * rv) : gain * 0.6 * (0.3 + 0.7 * rv);
            for (let ch2 = 0; ch2 < 3; ch2++) light[ch2] += col[ch2] * br * (cv + h);
          }
        }
      }
    }
    return addLight(o, [light[0], light[1], light[2]]) as Pixel;
  };
};

/**
 * Relight: the depth map as a surface (its slopes by a Sobel of 8 reads Smoothness apart, steepened by Relief) lit by
 * a point light in front of the picture (Lambert, dimmed with distance by Falloff) over the kept Ambient, multiplying
 * the picture's linear light; a rim from behind (where the surface turns away from the camera and from the light, on
 * the nearer side of an edge) added as light. Then the glow's coverage rule.
 */
/** The depth between the farthest and the nearest, as a share of the diagonal: where things are, for the light. */
export const DEPTH_SCALE = 0.4;

const relight: KernelReference = (p, canvas) => {
  const diag = Math.hypot(canvas.width, canvas.height);
  const [lx, ly] = warpCentre(p.light, canvas);
  const tint = dec3(hexEncoded(p.colour as string));
  const gain = Math.pow(2, p.intensity as number);
  const lift = ((p.height as number) / 100) * diag;
  const falloff = ((p.falloff as number) / 100) * 2;
  const ambient = (p.ambient as number) / 100;
  const ambientTint = dec3(hexEncoded(p.ambientColour as string));
  const relief = ((p.relief as number) / 100) * 0.5 * diag;
  const depthScale = DEPTH_SCALE * diag;
  const lz = depthScale + lift;
  const r = Math.max(1, p.smoothness as number);
  const rim = (p.rim as number) / 100;
  const rimTint = dec3(hexEncoded(p.rimColour as string));
  return ([x, y], c, env) => {
    const d0 = env.scene(x, y)[0];
    const at = (i: number, j: number) => env.scene(x + i * r, y + j * r)[0];
    const mm = at(-1, -1);
    const zm = at(0, -1);
    const pm = at(1, -1);
    const mz = at(-1, 0);
    const pz = at(1, 0);
    const mp = at(-1, 1);
    const zp = at(0, 1);
    const pp = at(1, 1);
    const gx = (pm + 2 * pz + pp - (mm + 2 * mz + mp)) / (8 * r);
    const gy = (mp + 2 * zp + pp - (mm + 2 * zm + pm)) / (8 * r);
    const mean = (mm + zm + pm + mz + pz + mp + zp + pp) / 8;
    // The far side of an edge keeps its own slope: what's in front isn't its shape.
    const side = clamp((d0 - mean) / 0.01 + 1);
    const nx0 = -gx * relief * side;
    const ny0 = -gy * relief * side;
    const nl = Math.sqrt(nx0 * nx0 + ny0 * ny0 + 1);
    const nx = nx0 / nl;
    const ny = ny0 / nl;
    const nz = 1 / nl;
    const vx = lx - x;
    const vy = ly - y;
    const vz = lz - d0 * depthScale;
    const dist = Math.max(1, Math.sqrt(vx * vx + vy * vy + vz * vz));
    const lambert = Math.max(0, (nx * vx + ny * vy + nz * vz) / dist);
    const atten = Math.min(4, Math.pow(Math.max(1, lift) / dist, falloff));
    const k = gain * lambert * atten;
    const shade = [ambient * ambientTint[0] + tint[0] * k, ambient * ambientTint[1] + tint[1] * k, ambient * ambientTint[2] + tint[2] * k];
    const lit: Pixel = [c[0] * shade[0], c[1] * shade[1], c[2] * shade[2], c[3]];
    let added = 0;
    if (rim > 0) {
      const hl = Math.hypot(nx, ny);
      const al = Math.hypot(vx, vy);
      const away = hl > 1e-6 && al > 1e-6 ? -(nx * vx + ny * vy) / (hl * al) : 0;
      const nearer = clamp((d0 - mean) / 0.02 + 0.5);
      added = rim * 1.2 * Math.pow(Math.max(0, 1 - nz), 1.5) * (0.25 + 0.75 * Math.max(0, away)) * nearer * c[3];
    }
    return addLight(lit, [rimTint[0] * added, rimTint[1] * added, rimTint[2] * added]) as Pixel;
  };
};

export const ATMOSPHERE_REFERENCES: Record<string, KernelReference> = { fog, "depth-particles": depthParticles, relight };
