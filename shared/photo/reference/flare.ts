/**
 * The flare's CPU reference (`../effects/flare.ts`): its light at one document point, in f64. `render/flare.ts`'s
 * WGSL is the same arithmetic, element by element, and is tested against this.
 *
 * `footprint` is the document pixels one target pixel covers (at least 1: a level-0 pixel). Every element's thin
 * features widen by it (never thinner than about half a pixel, so nothing aliases) and dim to keep their energy,
 * so a reduced view matches level 0 reduced within a tolerance (tested here, measured in e2e) without
 * supersampling.
 */
import type { EffectElement } from "../types.ts";
import type { FlareShape } from "../effects/flare.ts";

export type Rgb = [number, number, number];

const smoothstep = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** A Gaussian edge's width (`exp(−(d/w)²)`) widened by a pixel's footprint, and how much it dims to keep its energy. */
export function widen(width: number, footprint: number): { width: number; scale: number } {
  const w = Math.sqrt(width * width + (footprint * footprint) / 2);
  return { width: w, scale: width / w };
}

/** Distance to a regular polygon of circumradius `r` with `n` sides (negative inside): Inigo Quilez's sdRegularPolygon. */
export function polygonDistance(x: number, y: number, r: number, n: number): number {
  const an = Math.PI / n;
  const raw = Math.atan2(x, y);
  const period = 2 * an;
  const bn = raw - period * Math.floor(raw / period) - an;
  const len = Math.hypot(x, y);
  let px = len * Math.cos(bn) - r * Math.cos(an);
  let py = len * Math.abs(Math.sin(bn)) - r * Math.sin(an);
  py += Math.min(Math.max(-py, 0), r * Math.sin(an));
  return Math.hypot(px, py) * Math.sign(px);
}

const num = (e: EffectElement, key: string) => e[key] as number;

/** One element's profile at a point relative to its centre, per channel (before its tint and intensity). */
export function elementProfile(e: EffectElement, dx: number, dy: number, footprint: number): Rgb {
  const size = Math.max(num(e, "size"), 1e-3);
  const r = Math.hypot(dx, dy);
  switch (e.type) {
    case "glow": {
      const s = widen(size, footprint);
      const body = s.scale * s.scale / (1 + (r / s.width) ** num(e, "falloff"));
      const c = widen(size * 0.3, footprint);
      const core = (num(e, "core") / 100) * c.scale * c.scale * Math.exp(-((r / c.width) ** 2));
      return [body + core, body + core, body + core];
    }
    case "halo": {
      const th = widen((size * num(e, "thickness")) / 100, footprint);
      const spread = (num(e, "spread") / 100) * th.width;
      return [0, 1, 2].map((c) => {
        const d = r - (size + (1 - c) * spread);
        return th.scale * Math.exp(-((d / th.width) ** 2));
      }) as Rgb;
    }
    case "ghost": {
      const polygon = e.shape === "polygon";
      const turn = (num(e, "rotation") * Math.PI) / 180;
      const qx = dx * Math.cos(turn) + dy * Math.sin(turn);
      const qy = -dx * Math.sin(turn) + dy * Math.cos(turn);
      const rim = num(e, "rim") / 100;
      return [0, 1, 2].map((c) => {
        const sc = size * (1 + ((1 - c) * num(e, "chroma")) / 100);
        const d = polygon ? polygonDistance(qx, qy, sc, Math.round(num(e, "sides"))) : r - sc;
        const edge = widen(sc * 0.08, footprint);
        const soft = Math.max((sc * num(e, "softness")) / 100, edge.width);
        const body = 1 - smoothstep(-soft, edge.width, d);
        const ring = edge.scale * Math.exp(-((d / edge.width) ** 2));
        return body * (1 - rim) + ring * rim;
      }) as Rgb;
    }
    case "streak": {
      const a = (num(e, "angle") * Math.PI) / 180;
      const along = dx * Math.cos(a) + dy * Math.sin(a);
      const across = -dx * Math.sin(a) + dy * Math.cos(a);
      const th = widen(num(e, "thickness"), footprint);
      const core = th.scale * Math.exp(-((across / th.width) ** 2)) * Math.exp(-Math.abs(along) / size);
      const haze = (num(e, "haze") / 100) * Math.exp(-Math.abs(across) / (th.width * 6)) * Math.exp(-Math.abs(along) / (size * 0.5));
      return [core + haze, core + haze, core + haze];
    }
  }
  return [0, 0, 0];
}

/** Where an element's centre is: on the line from the source through the optical centre, and to its side. */
export function elementCentre(shape: FlareShape, e: EffectElement): [number, number] {
  const ax = shape.source[0] - shape.centre[0];
  const ay = shape.source[1] - shape.centre[1];
  const len = Math.hypot(ax, ay);
  const [ux, uy] = len > 0 ? [ax / len, ay / len] : [1, 0];
  const t = num(e, "position");
  const o = num(e, "offset");
  return [shape.centre[0] + ax * t - uy * o, shape.centre[1] + ay * t + ux * o];
}

/** The flare's light at document point (x, y): premultiplied linear rgb (its coverage is `max`, as any light's). */
export function flareLight(shape: FlareShape, x: number, y: number, footprint: number, linear: (hex: string) => Rgb): Rgb {
  const out: Rgb = [0, 0, 0];
  for (const e of shape.elements) {
    const [cx, cy] = elementCentre(shape, e);
    const p = elementProfile(e, x - cx, y - cy, footprint);
    const tint = linear(e.tint as string);
    const k = 2 ** num(e, "intensity");
    for (let c = 0; c < 3; c++) out[c] += p[c] * tint[c] * k * shape.gain[c];
  }
  return out;
}
