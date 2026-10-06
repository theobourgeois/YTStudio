/**
 * Quick Selection (docs/photo/selections.md): paint roughly over something and the selection grows out to its edges,
 * stroke after stroke, as Photoshop's. This is Liu, Sun and Shum's Paint Selection (SIGGRAPH 2009), which
 * Photoshop's tool follows: each time the brush reaches pixels not yet selected, a graph cut decides which unselected
 * pixels join, by colour models (four Gaussians fitted to what's painted and selected near it, eight to the rest of the
 * photo) and the photo's edges (a cut between similar colours costs more). The selection only grows (pixels already
 * selected stay), joins only what touches the brush (the paper's fluctuation removal) and leans out from its own edge
 * (its frontal pixels are fixed). The cut runs over the whole photo reduced to about 400 × 400, then at full detail in
 * a band around that answer's edge (the paper's multilevel banded cut, on two levels). Subtracting (Alt) is the same
 * on what isn't selected. It works on a sample of the photo reduced until the brush is at most `MAX_WORKING_RADIUS`
 * across, so a big brush stays quick. Pure and seeded.
 */
import { GridCut } from "./graph-cut.ts";
import { type Mixture, fitMixture, negLogLikelihood, seeded } from "./gmm.ts";
import type { PixelSample } from "./pixel-sample.ts";

/** The paper's weight of the edge term against the colour term. */
export const LAMBDA = 60;
/** The brush's largest radius in working pixels: a bigger one works on the photo reduced. */
export const MAX_WORKING_RADIUS = 40;
/** Pixels the background model is fitted to (the paper's 1,200). */
const BACKGROUND_SAMPLES = 1200;
/** Pixels at most the foreground model is fitted to. */
const FOREGROUND_SAMPLES = 2000;
/** A hard constraint's cost. */
const HARD = 1e9;

export interface Dab {
  x: number;
  y: number;
  radius: number;
}

/** How many times a sample at `scale` is halved for a brush of `radius` document pixels (Quick Selection's level). */
export function quickLevel(radius: number, scale: number): number {
  let level = 0;
  while (radius * scale * 0.5 ** level > MAX_WORKING_RADIUS && level < 8) level++;
  return level;
}

/** One stroke's (or several's) work on one sample: the selection at the sample's size, grown or shrunk as it's painted. */
export class QuickSelection {
  readonly width: number;
  readonly height: number;
  /** Colours, 0..255, three a pixel (transparency shown over grey). */
  private readonly rgb: Float32Array;
  /** What's taken: selected when adding, unselected when subtracting. */
  private readonly taken: Uint8Array;
  private readonly random: () => number;
  /** The photo reduced for the first cut (blocks of k × k pixels; k = 1: not reduced). */
  private readonly coarse: { k: number; width: number; height: number; rgb: Float32Array };
  private background: Int32Array;
  private backgroundModel: Mixture;
  /** The box of what's changed since the session began (sample pixels), or null. */
  changed: { x0: number; y0: number; x1: number; y1: number } | null = null;

  /**
   * `initial`: the selection at the sample's size (non-zero: selected); `subtract` takes pixels out instead (Alt).
   */
  constructor(
    sample: PixelSample,
    initial: Uint8Array,
    readonly subtract: boolean,
    seed = 1,
  ) {
    this.width = sample.width;
    this.height = sample.height;
    const n = this.width * this.height;
    this.rgb = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const a = sample.data[i * 4 + 3] / 255;
      for (let c = 0; c < 3; c++) this.rgb[i * 3 + c] = sample.data[i * 4 + c] * a + 128 * (1 - a);
    }
    this.taken = new Uint8Array(n);
    for (let i = 0; i < n; i++) this.taken[i] = (initial[i] > 0) !== subtract ? 1 : 0;
    this.coarse = coarseOf(this.rgb, this.width, this.height);
    this.random = seeded(seed);
    this.background = new Int32Array(0);
    this.backgroundModel = { components: [] };
    this.resampleBackground();
  }

  /** The selection now at the sample's size: 1 selected, 0 not. */
  get selected(): Uint8Array {
    if (!this.subtract) return this.taken;
    return this.taken.map((v) => 1 - v);
  }

  /** Paints dabs (sample pixels): true when the selection changed. */
  paint(dabs: readonly Dab[]): boolean {
    const { width, height, taken } = this;
    if (!dabs.length) return false;
    // The brush's pixels, and those of them not yet taken (the seeds).
    let bx0 = width;
    let by0 = height;
    let bx1 = -1;
    let by1 = -1;
    for (const d of dabs) {
      bx0 = Math.min(bx0, Math.floor(d.x - d.radius));
      by0 = Math.min(by0, Math.floor(d.y - d.radius));
      bx1 = Math.max(bx1, Math.ceil(d.x + d.radius));
      by1 = Math.max(by1, Math.ceil(d.y + d.radius));
    }
    bx0 = Math.max(0, bx0);
    by0 = Math.max(0, by0);
    bx1 = Math.min(width - 1, bx1);
    by1 = Math.min(height - 1, by1);
    if (bx1 < bx0 || by1 < by0) return false;
    const seed = new Uint8Array(width * height);
    const seeds: number[] = [];
    for (let y = by0; y <= by1; y++) {
      for (let x = bx0; x <= bx1; x++) {
        const i = y * width + x;
        if (taken[i]) continue;
        if (dabs.some((d) => (x + 0.5 - d.x) ** 2 + (y + 0.5 - d.y) ** 2 <= Math.max(d.radius, 0.75) ** 2)) {
          seed[i] = 1;
          seeds.push(i);
        }
      }
    }
    if (!seeds.length) return false;
    const radius = Math.max(...dabs.map((d) => d.radius));
    // The foreground model: the seeds and what's taken near them (the paper's local foreground, its 40-pixel box).
    const near = Math.max(40, Math.ceil(radius));
    const fg: number[] = [...seeds];
    for (let y = Math.max(0, by0 - near); y <= Math.min(height - 1, by1 + near); y++) {
      for (let x = Math.max(0, bx0 - near); x <= Math.min(width - 1, bx1 + near); x++) if (taken[y * width + x]) fg.push(y * width + x);
    }
    const foreground = fitMixture(this.colours(this.pick(fg, FOREGROUND_SAMPLES)), 4, 7);
    // The background's samples taken since are replaced (the paper's update), and its model fitted again.
    this.resampleBackground();
    const models = { foreground, background: this.backgroundModel };
    // The paper's multilevel banded cut, on two levels: the whole photo, reduced; then a band around its answer.
    const k = this.coarse.k;
    const coarse = this.cutCoarse(seed, models);
    const keep = k === 1 ? coarse : this.refine(seed, coarse, models);
    let changed = false;
    for (let i = 0; i < keep.length; i++) {
      if (!keep[i] || taken[i]) continue;
      taken[i] = 1;
      changed = true;
      this.grow(i % width, Math.floor(i / width));
    }
    return changed;
  }

  /**
   * The cut over the whole photo at the coarse level: a block is taken when most of it is, a seed when any of it is;
   * returns the blocks that join (joined to the seeds through new blocks: the paper's fluctuation removal), at the
   * coarse level (the sample's own when it isn't reduced).
   */
  private cutCoarse(seed: Uint8Array, models: Models): Uint8Array {
    const { k, width: cw, height: ch, rgb } = this.coarse;
    const n = cw * ch;
    const takenC = new Uint8Array(n);
    const seedC = new Uint8Array(n);
    if (k === 1) {
      takenC.set(this.taken);
      seedC.set(seed);
    } else {
      const count = new Uint32Array(n);
      const cells = new Uint32Array(n);
      for (let y = 0; y < this.height; y++) {
        for (let x = 0; x < this.width; x++) {
          const i = y * this.width + x;
          const b = Math.floor(y / k) * cw + Math.floor(x / k);
          cells[b]++;
          if (this.taken[i]) count[b]++;
          if (seed[i]) seedC[b] = 1;
        }
      }
      for (let b = 0; b < n; b++) {
        takenC[b] = count[b] * 2 >= cells[b] ? 1 : 0;
        if (takenC[b]) seedC[b] = 0;
      }
    }
    const beta = betaOf(rgb, cw, 0, 0, cw - 1, ch - 1);
    const cut = new GridCut(cw, ch);
    for (let y = 0; y < ch; y++) {
      for (let x = 0; x < cw; x++) {
        const b = y * cw + x;
        if (takenC[b] || seedC[b]) cut.setTerminals(b, HARD, 0);
        else {
          const [source, sink] = dataTerms(models, rgb, b);
          cut.setTerminals(b, source, sink);
        }
        if (x < cw - 1) cut.setEdge(b, false, LAMBDA * Math.exp(-beta * step(rgb, b, b + 1)));
        if (y < ch - 1) cut.setEdge(b, true, LAMBDA * Math.exp(-beta * step(rgb, b, b + cw)));
      }
    }
    const labels = cut.solve();
    return joined(seedC, (b) => labels[b] === 1 && !takenC[b], cw, ch);
  }

  /**
   * The band refined at the sample's level: inside the coarse answer, away from its edge, pixels join; outside it,
   * they don't; within a block of its edge, a cut at full detail decides. Returns the pixels that join.
   */
  private refine(seed: Uint8Array, coarse: Uint8Array, models: Models): Uint8Array {
    const { width, height, taken, rgb } = this;
    const { k, width: cw, height: ch } = this.coarse;
    const keep = new Uint8Array(width * height);
    // The box of the coarse answer, a block around it.
    let x0 = cw;
    let y0 = ch;
    let x1 = -1;
    let y1 = -1;
    for (let b = 0; b < coarse.length; b++) {
      if (!coarse[b]) continue;
      const bx = b % cw;
      const by = (b - bx) / cw;
      x0 = Math.min(x0, bx);
      y0 = Math.min(y0, by);
      x1 = Math.max(x1, bx);
      y1 = Math.max(y1, by);
    }
    if (x1 < 0) return keep;
    const wx0 = Math.max(0, (x0 - 1) * k);
    const wy0 = Math.max(0, (y0 - 1) * k);
    const wx1 = Math.min(width - 1, (x1 + 2) * k - 1);
    const wy1 = Math.min(height - 1, (y1 + 2) * k - 1);
    const ww = wx1 - wx0 + 1;
    const wh = wy1 - wy0 + 1;
    const at = (bx: number, by: number) => coarse[Math.min(ch - 1, Math.max(0, by)) * cw + Math.min(cw - 1, Math.max(0, bx))];
    // Whether a block and the eight around it agree (then its pixels are settled).
    const settled = (bx: number, by: number) => {
      const v = at(bx, by);
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (at(bx + dx, by + dy) !== v) return false;
      return true;
    };
    const beta = betaOf(rgb, width, wx0, wy0, wx1, wy1);
    const weight = (i: number, j: number) => LAMBDA * Math.exp(-beta * step(rgb, i, j));
    const cut = new GridCut(ww, wh);
    for (let y = 0; y < wh; y++) {
      for (let x = 0; x < ww; x++) {
        const w = y * ww + x;
        const px = x + wx0;
        const py = y + wy0;
        const i = py * width + px;
        const bx = Math.floor(px / k);
        const by = Math.floor(py / k);
        let source = 0;
        let sink = 0;
        if (taken[i] || seed[i]) source = HARD;
        else if (settled(bx, by)) {
          if (at(bx, by)) source = HARD;
          else sink = HARD;
        } else {
          [source, sink] = dataTerms(models, rgb, i);
          // Past the band's box, pixels are what they are: taken ones pull it in, the rest hold it out.
          const outside = (ox: number, oy: number) => {
            if (ox < 0 || oy < 0 || ox >= width || oy >= height) return;
            const o = oy * width + ox;
            if (taken[o]) source += weight(i, o);
            else sink += weight(i, o);
          };
          if (x === 0) outside(px - 1, py);
          if (x === ww - 1) outside(px + 1, py);
          if (y === 0) outside(px, py - 1);
          if (y === wh - 1) outside(px, py + 1);
        }
        cut.setTerminals(w, source, sink);
        if (x < ww - 1) cut.setEdge(w, false, weight(i, i + 1));
        if (y < wh - 1) cut.setEdge(w, true, weight(i, i + width));
      }
    }
    const labels = cut.solve();
    const seedW = new Uint8Array(ww * wh);
    for (let y = 0; y < wh; y++) for (let x = 0; x < ww; x++) seedW[y * ww + x] = seed[(y + wy0) * width + (x + wx0)];
    const joinedW = joined(seedW, (w) => labels[w] === 1, ww, wh);
    for (let y = 0; y < wh; y++) for (let x = 0; x < ww; x++) if (joinedW[y * ww + x]) keep[(y + wy0) * width + (x + wx0)] = 1;
    return keep;
  }

  private grow(x: number, y: number) {
    const c = this.changed;
    if (!c) this.changed = { x0: x, y0: y, x1: x, y1: y };
    else {
      if (x < c.x0) c.x0 = x;
      if (y < c.y0) c.y0 = y;
      if (x > c.x1) c.x1 = x;
      if (y > c.y1) c.y1 = y;
    }
  }

  /** Up to `max` of `pixels`, spread evenly. */
  private pick(pixels: number[], max: number): number[] {
    if (pixels.length <= max) return pixels;
    const out: number[] = [];
    const stride = pixels.length / max;
    for (let k = 0; k < max; k++) out.push(pixels[Math.floor(k * stride)]);
    return out;
  }

  private colours(pixels: readonly number[]): Float32Array {
    const out = new Float32Array(pixels.length * 3);
    pixels.forEach((i, k) => out.set(this.rgb.subarray(i * 3, i * 3 + 3), k * 3));
    return out;
  }

  /** The background's samples: random pixels not taken (those taken since replaced), and its model. */
  private resampleBackground() {
    const n = this.width * this.height;
    const kept = [...this.background].filter((i) => !this.taken[i]);
    let tries = 0;
    while (kept.length < BACKGROUND_SAMPLES && tries < BACKGROUND_SAMPLES * 20) {
      tries++;
      const i = Math.floor(this.random() * n);
      if (!this.taken[i]) kept.push(i);
    }
    const changed = kept.length !== this.background.length || kept.some((v, k) => v !== this.background[k]);
    this.background = Int32Array.from(kept);
    if (changed || !this.backgroundModel.components.length) this.backgroundModel = fitMixture(this.colours(kept), 8, 3);
  }
}

interface Models {
  foreground: Mixture;
  background: Mixture;
}

/** Pixels the first cut works on at most (the paper's coarsest level is about 400 × 400). */
const COARSE_PIXELS = 400 * 400;

/** The colours averaged over blocks of k × k (k a power of two), small enough for `COARSE_PIXELS`. */
function coarseOf(rgb: Float32Array, width: number, height: number) {
  let k = 1;
  while (Math.ceil(width / k) * Math.ceil(height / k) > COARSE_PIXELS) k *= 2;
  if (k === 1) return { k, width, height, rgb };
  const cw = Math.ceil(width / k);
  const ch = Math.ceil(height / k);
  const out = new Float32Array(cw * ch * 3);
  const count = new Uint32Array(cw * ch);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const b = Math.floor(y / k) * cw + Math.floor(x / k);
      const i = y * width + x;
      out[b * 3] += rgb[i * 3];
      out[b * 3 + 1] += rgb[i * 3 + 1];
      out[b * 3 + 2] += rgb[i * 3 + 2];
      count[b]++;
    }
  }
  for (let b = 0; b < cw * ch; b++) for (let c = 0; c < 3; c++) out[b * 3 + c] /= count[b];
  return { k, width: cw, height: ch, rgb: out };
}

/** What labelling pixel i background costs (its likeness to the foreground) and foreground costs, the smaller made 0. */
function dataTerms(models: Models, rgb: Float32Array, i: number): [number, number] {
  const source = negLogLikelihood(models.background, rgb[i * 3], rgb[i * 3 + 1], rgb[i * 3 + 2]);
  const sink = negLogLikelihood(models.foreground, rgb[i * 3], rgb[i * 3 + 1], rgb[i * 3 + 2]);
  const floor = Math.min(source, sink);
  return [source - floor, sink - floor];
}

/** β: one over twice the mean squared colour step between neighbours in the box (GrabCut's). */
function betaOf(rgb: Float32Array, width: number, x0: number, y0: number, x1: number, y1: number): number {
  let total = 0;
  let steps = 0;
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const i = y * width + x;
      if (x < x1) (total += step(rgb, i, i + 1), steps++);
      if (y < y1) (total += step(rgb, i, i + width), steps++);
    }
  }
  return steps && total > 0 ? 1 / (2 * (total / steps)) : 0;
}

/** What's joined (four ways) to the seeds through pixels `open` says may join. */
function joined(seeds: Uint8Array, open: (i: number) => boolean, width: number, height: number): Uint8Array {
  const keep = new Uint8Array(seeds.length);
  const stack: number[] = [];
  for (let i = 0; i < seeds.length; i++) if (seeds[i]) stack.push(i);
  while (stack.length) {
    const i = stack.pop()!;
    if (keep[i]) continue;
    keep[i] = 1;
    const x = i % width;
    if (x + 1 < width && !keep[i + 1] && open(i + 1)) stack.push(i + 1);
    if (x > 0 && !keep[i - 1] && open(i - 1)) stack.push(i - 1);
    if (i + width < width * height && !keep[i + width] && open(i + width)) stack.push(i + width);
    if (i >= width && !keep[i - width] && open(i - width)) stack.push(i - width);
  }
  return keep;
}

/** The squared colour distance between pixels i and j. */
function step(rgb: Float32Array, i: number, j: number) {
  const r = rgb[i * 3] - rgb[j * 3];
  const g = rgb[i * 3 + 1] - rgb[j * 3 + 1];
  const b = rgb[i * 3 + 2] - rgb[j * 3 + 2];
  return r * r + g * g + b * b;
}

/** Dabs along a pointer's path (sample pixels), one every quarter of the radius so the brush covers it. */
export function dabsAlong(points: readonly { x: number; y: number }[], radius: number): Dab[] {
  const dabs: Dab[] = [];
  const spacing = Math.max(0.5, radius / 4);
  for (let k = 0; k < points.length; k++) {
    const p = points[k];
    if (k === 0) {
      dabs.push({ x: p.x, y: p.y, radius });
      continue;
    }
    const q = points[k - 1];
    const length = Math.hypot(p.x - q.x, p.y - q.y);
    const n = Math.max(1, Math.ceil(length / spacing));
    for (let s = 1; s <= n; s++) dabs.push({ x: q.x + ((p.x - q.x) * s) / n, y: q.y + ((p.y - q.y) * s) / n, radius });
  }
  return dabs;
}

/** Smooths a 0/1 selection's edge (Auto-Enhance): twice a 3 × 3 mean, as coverage 0..255. */
export function enhance(selected: Uint8Array, width: number, height: number): Uint8Array {
  let a = Float32Array.from(selected);
  for (let pass = 0; pass < 2; pass++) {
    const b = new Float32Array(a.length);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        let sum = 0;
        let n = 0;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const nx = x + dx;
            const ny = y + dy;
            if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
            sum += a[ny * width + nx];
            n++;
          }
        }
        b[y * width + x] = sum / n;
      }
    }
    a = b;
  }
  return Uint8Array.from(a, (v) => Math.round(v * 255));
}
