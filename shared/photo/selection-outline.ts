/**
 * The marching ants' path (docs/photo/selections.md): the edges between pixels a selection covers at least half of
 * and those it doesn't, as Photoshop draws them, traced into closed loops (each turning clockwise around what's
 * selected, holes the other way) with straight runs merged. Pure; the canvas strokes them.
 */
import type { PhotoSelection } from "./types.ts";

/** A grid of pixels, inside or out, `scale` document pixels each, its top-left at (x, y) in the document. */
export interface OutlineGrid {
  x: number;
  y: number;
  width: number;
  height: number;
  scale: number;
  inside: (i: number, j: number) => boolean;
}

/** Directions along an edge: right, down, left, up. */
const DX = [1, 0, -1, 0];
const DY = [0, 1, 0, -1];

/** Closed loops of document points [x0, y0, x1, y1, …] around what's inside. */
export function traceOutline(grid: OutlineGrid): number[][] {
  const { width, height, inside } = grid;
  const W = width + 1;
  const vertices = W * (height + 1);
  // Up to two edges leave a vertex (two where pixels touch only at a corner): a direction each, or -1.
  const first = new Int8Array(vertices).fill(-1);
  const second = new Int8Array(vertices).fill(-1);
  const add = (vx: number, vy: number, dir: number) => {
    const v = vy * W + vx;
    if (first[v] < 0) first[v] = dir;
    else second[v] = dir;
  };
  const at = (i: number, j: number) => i >= 0 && j >= 0 && i < width && j < height && inside(i, j);
  let edges = 0;
  for (let j = 0; j < height; j++) {
    for (let i = 0; i < width; i++) {
      if (!inside(i, j)) continue;
      // Each side facing out, walked with the inside on its right.
      if (!at(i, j - 1)) (add(i, j, 0), edges++);
      if (!at(i + 1, j)) (add(i + 1, j, 1), edges++);
      if (!at(i, j + 1)) (add(i + 1, j + 1, 2), edges++);
      if (!at(i - 1, j)) (add(i, j + 1, 3), edges++);
    }
  }
  const loops: number[][] = [];
  const point = (vx: number, vy: number, loop: number[]) => loop.push(grid.x + vx * grid.scale, grid.y + vy * grid.scale);
  for (let start = 0; start < vertices && edges > 0; start++) {
    while (first[start] >= 0 || second[start] >= 0) {
      const loop: number[] = [];
      let vx = start % W;
      let vy = Math.floor(start / W);
      let dir = take(first, second, start, -1);
      point(vx, vy, loop);
      // Every vertex has as many edges in as out: the walk ends back where it started.
      for (;;) {
        vx += DX[dir];
        vy += DY[dir];
        edges--;
        const v = vy * W + vx;
        if (first[v] < 0 && second[v] < 0) break;
        const next = take(first, second, v, dir);
        // A corner: keep the point (a straight run's middle points are left out).
        if (next !== dir) point(vx, vy, loop);
        dir = next;
      }
      if (loop.length >= 6) loops.push(loop);
    }
  }
  return loops;
}

/**
 * Takes an edge leaving vertex `v`: the only one, or where two leave (pixels meeting at a corner), the one turning
 * right from `from` (so diagonal neighbours are traced as separate shapes).
 */
function take(first: Int8Array, second: Int8Array, v: number, from: number): number {
  let dir: number;
  if (second[v] < 0 || from < 0) {
    dir = first[v];
    first[v] = second[v];
    second[v] = -1;
    return dir;
  }
  const right = (from + 1) % 4;
  if (first[v] === right) {
    dir = first[v];
    first[v] = second[v];
  } else dir = second[v];
  second[v] = -1;
  return dir;
}

const outlines = new WeakMap<object, number[][]>();

/** A selection's ants, kept per selection (they're immutable). */
export function selectionOutline(s: PhotoSelection): number[][] {
  if (s.kind === "rect") {
    const x1 = s.x + s.width;
    const y1 = s.y + s.height;
    return [[s.x, s.y, x1, s.y, x1, y1, s.x, y1]];
  }
  let loops = outlines.get(s.data);
  if (!loops) {
    const { data, width } = s;
    loops = traceOutline({ x: s.x, y: s.y, width: s.width, height: s.height, scale: 1, inside: (i, j) => data[j * width + i] >= 128 });
    outlines.set(s.data, loops);
  }
  return loops;
}

/** Loops as an SVG path (`M … L … Z`). */
export const outlinePath = (loops: readonly number[][]) =>
  loops
    .map((l) => {
      let d = `M${l[0]} ${l[1]}`;
      for (let i = 2; i < l.length; i += 2) d += `L${l[i]} ${l[i + 1]}`;
      return `${d}Z`;
    })
    .join("");
