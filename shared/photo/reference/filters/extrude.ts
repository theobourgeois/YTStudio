/** Extrude's CPU reference (`../../effects/filters/extrude.ts`), mirrored by `render/filters/extrude.ts`. */
import { EXTRUDE_MAX_BLOCKS } from "../../effects/filters/extrude.ts";
import { type KernelReference, type Pixel, type Rgb, clamp, enc, enc3, fromEncoded, luma, mix, rand, unpremul } from "../kernel.ts";
import { held } from "./stylize.ts";

const RAD = Math.PI / 180;
const cross = (ax: number, ay: number, bx: number, by: number) => ax * by - ay * bx;

/** Cells each of a point's two rays visits, at most: its length in blocks (Depth, its start ahead, the margin), crossed diagonally. */
export const EXTRUDE_STEPS = 24;
/** The light Extrude's faces are shaded by: from the top left, above. */
export const EXTRUDE_LIGHT: Rgb = (() => {
  const l = [-0.4, -0.56, 0.72];
  const len = Math.hypot(l[0], l[1], l[2]);
  return [l[0] / len, l[1] / len, l[2] / len];
})();
const AMBIENT = 0.35;

/** A face's shade by its normal (x, y, z up), relative to a flat top's. */
export function extrudeShade(nx: number, ny: number, nz: number): number {
  const d = Math.max(0, nx * EXTRUDE_LIGHT[0] + ny * EXTRUDE_LIGHT[1] + nz * EXTRUDE_LIGHT[2]);
  return (AMBIENT + (1 - AMBIENT) * d) / (AMBIENT + (1 - AMBIENT) * EXTRUDE_LIGHT[2]);
}

/**
 * How much of the parallelogram o + u e1 + v e2 (u, v in [0, 1]) a pixel `px` wide at p covers, and v there (held to
 * [0, 1]): its signed distance to the four edges, antialiased, thin ones faded by their thickness.
 */
function parallelogram(p: readonly [number, number], o: readonly [number, number], e1: readonly [number, number], e2: readonly [number, number], px: number): [number, number] {
  const area = cross(e1[0], e1[1], e2[0], e2[1]);
  if (!(Math.abs(area) > 1e-6)) return [0, 0];
  const l1 = Math.hypot(e1[0], e1[1]);
  const l2 = Math.hypot(e2[0], e2[1]);
  let n1 = [-e1[1] / l1, e1[0] / l1];
  if (n1[0] * e2[0] + n1[1] * e2[1] < 0) n1 = [-n1[0], -n1[1]];
  let n2 = [-e2[1] / l2, e2[0] / l2];
  if (n2[0] * e1[0] + n2[1] * e1[1] < 0) n2 = [-n2[0], -n2[1]];
  const rx = p[0] - o[0];
  const ry = p[1] - o[1];
  const a1 = n1[0] * rx + n1[1] * ry;
  const a2 = n2[0] * rx + n2[1] * ry;
  const sd = Math.max(-a1, a1 - (n1[0] * e2[0] + n1[1] * e2[1]), -a2, a2 - (n2[0] * e1[0] + n2[1] * e1[1]));
  const cover = clamp(0.5 - sd / px) * Math.min(1, Math.abs(area) / l1 / px);
  return [cover, clamp(cross(e1[0], e1[1], rx, ry) / area)];
}

/** One block as seen at a point: its height z there, its cover, how much is front face, the shades, its colour. */
interface Seen {
  z: number;
  cover: number;
  front: number;
  frontShade: number;
  sideShade: number;
  colour: Rgb;
  alpha: number;
  /** How high the image on its front is read from (Image front faces). */
  lift: number;
}

/**
 * Extrude: the blocks a point can see are those its two rays cross (from just ahead of it, a little either side of
 * it, back along the extrusion by Depth): every block raised along the direction by its height (by its brightness or
 * at random), seen as its front face and its two walls facing back (or a pyramid's faces facing the viewer), each
 * antialiased; the three highest there drawn front to back, the last as if solid.
 */
const extrude: KernelReference = (p, canvas) => {
  const S = p.size as number;
  const depth = Math.min(p.depth as number, EXTRUDE_MAX_BLOCKS * S);
  const angle = (p.angle as number) * RAD;
  const dir: [number, number] = [Math.cos(angle), Math.sin(angle)];
  const pyramids = p.shape === "pyramids";
  const random = p.height === "random";
  const solid = p.front !== "image";
  const seed = p.seed as number;
  return (pt, _c, env) => {
    const px = env.px;
    const top: Seen[] = [];
    const block = (i: number, j: number) => {
      const sum: Pixel = [0, 0, 0, 0];
      for (let b = 0; b < 2; b++)
        for (let a = 0; a < 2; a++) {
          const at = held((i + 0.25 + 0.5 * a) * S, (j + 0.25 + 0.5 * b) * S, pt, canvas);
          const s = env.src(at[0], at[1]);
          for (let k = 0; k < 4; k++) sum[k] += s[k] / 4;
        }
      const lin = unpremul(sum);
      const alpha = clamp(sum[3]);
      const level = random ? rand(i, j, seed) : enc(luma(lin));
      return { h: depth * level * alpha, colour: enc3(lin), alpha };
    };
    const see = (i: number, j: number) => {
      const { h, colour, alpha } = block(i, j);
      const x0 = i * S;
      const y0 = j * S;
      const hx = h * dir[0];
      const hy = h * dir[1];
      let cover = 0;
      let z = 0;
      let front = 0;
      let frontShade = 1;
      let sideShade = 0;
      let lift = h;
      if (!pyramids) {
        // The front face: the block's footprint raised by h.
        const fx = pt[0] - hx - (x0 + S / 2);
        const fy = pt[1] - hy - (y0 + S / 2);
        const af = clamp(0.5 - (Math.max(Math.abs(fx), Math.abs(fy)) - S / 2) / px);
        // The walls facing back along the direction: an edge of the footprint swept by h.
        const xe = dir[0] > 0 ? x0 : x0 + S;
        const ye = dir[1] > 0 ? y0 : y0 + S;
        const [ax, vx] = parallelogram(pt, [xe, y0], [0, S], [hx, hy], px);
        const [ay, vy] = parallelogram(pt, [x0, ye], [S, 0], [hx, hy], px);
        const sx = extrudeShade(dir[0] > 0 ? -1 : 1, 0, 0) * mix(0.6, 1, vx);
        const sy = extrudeShade(0, dir[1] > 0 ? -1 : 1, 0) * mix(0.6, 1, vy);
        const sides = ax + ay;
        cover = af + sides;
        if (!(cover > 0)) return;
        z = (af * h + ax * vx * h + ay * vy * h) / cover;
        front = af / cover;
        sideShade = sides > 0 ? (ax * sx + ay * sy) / sides : 0;
      } else {
        // The faces of a pyramid whose apex is raised by h, those facing the viewer (wound as the base is).
        const corners = [
          [x0, y0],
          [x0 + S, y0],
          [x0 + S, y0 + S],
          [x0, y0 + S],
        ];
        const normals = [
          [0, -1],
          [1, 0],
          [0, 1],
          [-1, 0],
        ];
        const ax = x0 + S / 2 + hx;
        const ay = y0 + S / 2 + hy;
        let zs = 0;
        let shades = 0;
        for (let k = 0; k < 4; k++) {
          const [cx0, cy0] = corners[k];
          const [cx1, cy1] = corners[(k + 1) % 4];
          const ex = cx1 - cx0;
          const ey = cy1 - cy0;
          const area = cross(ex, ey, ax - cx0, ay - cy0);
          if (!(area > 1e-4 * S * S)) continue;
          const edge = (sx: number, sy: number, tx: number, ty: number) => -cross(tx - sx, ty - sy, pt[0] - sx, pt[1] - sy) / Math.hypot(tx - sx, ty - sy);
          const sd = Math.max(edge(cx0, cy0, cx1, cy1), edge(cx1, cy1, ax, ay), edge(ax, ay, cx0, cy0));
          const a = clamp(0.5 - sd / px) * Math.min(1, area / S / px);
          if (!(a > 0)) continue;
          const zk = h * clamp(cross(ex, ey, pt[0] - cx0, pt[1] - cy0) / area);
          const nl = Math.hypot(normals[k][0] * h, normals[k][1] * h, S / 2);
          cover += a;
          zs += a * zk;
          shades += a * extrudeShade((normals[k][0] * h) / nl, (normals[k][1] * h) / nl, S / 2 / nl);
        }
        if (!(cover > 0)) return;
        z = zs / cover;
        front = 1;
        frontShade = shades / cover;
        lift = z;
      }
      const seen: Seen = { z, cover: Math.min(1, cover), front, frontShade, sideShade, colour, alpha, lift };
      let at = top.length;
      while (at > 0 && z > top[at - 1].z) at--;
      if (at < 3) {
        top.splice(at, 0, seen);
        if (top.length > 3) top.pop();
      }
    };
    // Two rays back along the extrusion, either side of the point by m, from far enough ahead to cross its own block.
    const m = Math.min(0.5 * px, 0.25 * S);
    const ahead = 1.42 * S;
    const length = ahead + depth + m;
    const first: number[] = [];
    for (let side = 0; side < 2; side++) {
      const off = side === 0 ? -m : m;
      const sx = pt[0] - dir[1] * off + dir[0] * ahead;
      const sy = pt[1] + dir[0] * off + dir[1] * ahead;
      const dx = -dir[0];
      const dy = -dir[1];
      let i = Math.floor(sx / S);
      let j = Math.floor(sy / S);
      const adx = Math.abs(dx);
      const ady = Math.abs(dy);
      const stepX = dx > 0 ? 1 : -1;
      const stepY = dy > 0 ? 1 : -1;
      const deltaX = adx > 1e-6 ? S / adx : 1e30;
      const deltaY = ady > 1e-6 ? S / ady : 1e30;
      let tx = adx > 1e-6 ? (dx > 0 ? (i + 1) * S - sx : sx - i * S) / adx : 1e30;
      let ty = ady > 1e-6 ? (dy > 0 ? (j + 1) * S - sy : sy - j * S) / ady : 1e30;
      for (let k = 0; k < EXTRUDE_STEPS; k++) {
        if (side === 0) {
          first.push(i, j);
          see(i, j);
        } else {
          let again = false;
          for (let q = 0; q < first.length; q += 2) if (first[q] === i && first[q + 1] === j) again = true;
          if (!again) see(i, j);
        }
        if (Math.min(tx, ty) > length) break;
        if (tx < ty) {
          i += stepX;
          tx += deltaX;
        } else {
          j += stepY;
          ty += deltaY;
        }
      }
    }
    if (top.length === 0) return [0, 0, 0, 0];
    const rgb: Rgb = [0, 0, 0];
    let alpha = 0;
    let left = 1;
    for (let e = 0; e < top.length; e++) {
      const s = top[e];
      const cover = e === top.length - 1 ? 1 : s.cover;
      let face = s.colour;
      let faceAlpha = s.alpha;
      if (!solid) {
        const at = held(pt[0] - s.lift * dir[0], pt[1] - s.lift * dir[1], pt, canvas);
        const img = env.src(at[0], at[1]);
        face = enc3(unpremul(img));
        faceAlpha = clamp(img[3]);
      }
      const a = s.front * faceAlpha + (1 - s.front) * s.alpha;
      const wgt = left * cover;
      for (let k = 0; k < 3; k++) rgb[k] += wgt * (s.front * faceAlpha * clamp(face[k] * s.frontShade) + (1 - s.front) * s.alpha * clamp(s.colour[k] * s.sideShade));
      alpha += wgt * a;
      left *= 1 - cover;
    }
    if (!(alpha > 0)) return [0, 0, 0, 0];
    return fromEncoded([rgb[0] / alpha, rgb[1] / alpha, rgb[2] / alpha], alpha);
  };
};


export const EXTRUDE_REFERENCES: Record<string, KernelReference> = { extrude };
