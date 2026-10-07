/**
 * The Object Selection tool (docs/photo/selections.md): the user paints roughly over a thing, and a model selects
 * that thing. Lightroom's Select Objects brush, Photoshop's Object Selection. For now the model is Select Subject's
 * (IS-Net), shown only the part of the photo around the strokes (so the thing fills its view and has its whole
 * 1024 × 1024), and only what the strokes touched of its answer is kept; a prompted model (SAM) is next. Pure.
 */
import type { Size } from "./geometry.ts";
import { dabsAlong } from "./quick-select.ts";
import type { SampleBox } from "./subject.ts";

type Point = { x: number; y: number };

/** How far past the strokes' bounds the model looks, as a share of their longer side: a stroke needn't cover the whole thing. */
const MARGIN = 0.25;

/**
 * The part of the document the model is shown for `strokes` (document points) painted `size` pixels across: their
 * bounds grown by `MARGIN`, within the canvas. Null when nothing of it is on the canvas.
 */
export function objectBox(strokes: readonly (readonly Point[])[], size: number, canvas: Size): SampleBox | null {
  const r = size / 2;
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const stroke of strokes) {
    for (const p of stroke) {
      x0 = Math.min(x0, p.x - r);
      y0 = Math.min(y0, p.y - r);
      x1 = Math.max(x1, p.x + r);
      y1 = Math.max(y1, p.y + r);
    }
  }
  if (!(x1 > x0 && y1 > y0)) return null;
  const pad = Math.max(x1 - x0, y1 - y0) * MARGIN;
  const bx0 = Math.max(0, Math.floor(x0 - pad));
  const by0 = Math.max(0, Math.floor(y0 - pad));
  const bx1 = Math.min(canvas.width, Math.ceil(x1 + pad));
  const by1 = Math.min(canvas.height, Math.ceil(y1 + pad));
  if (bx1 <= bx0 || by1 <= by0) return null;
  return { x: bx0, y: by0, width: bx1 - bx0, height: by1 - by0 };
}

/**
 * What the strokes painted, on the model's `side × side` grid over `at` (a box of a sample `scale` sample pixels a
 * document pixel): 1 painted. The grid squeezes the box to a square, so a dab is an ellipse on it.
 */
export function paintedGrid(strokes: readonly (readonly Point[])[], size: number, scale: number, at: SampleBox, side: number): Uint8Array {
  const out = new Uint8Array(side * side);
  const sx = (scale * side) / at.width;
  const sy = (scale * side) / at.height;
  const r = size / 2;
  const rx = Math.max(0.5, r * sx);
  const ry = Math.max(0.5, r * sy);
  for (const stroke of strokes) {
    for (const dab of dabsAlong(stroke, r)) {
      const cx = (dab.x * scale - at.x) * (side / at.width);
      const cy = (dab.y * scale - at.y) * (side / at.height);
      const gx0 = Math.max(0, Math.floor(cx - rx));
      const gx1 = Math.min(side - 1, Math.ceil(cx + rx));
      const gy0 = Math.max(0, Math.floor(cy - ry));
      const gy1 = Math.min(side - 1, Math.ceil(cy + ry));
      for (let gy = gy0; gy <= gy1; gy++) {
        const dy = (gy + 0.5 - cy) / ry;
        for (let gx = gx0; gx <= gx1; gx++) {
          const dx = (gx + 0.5 - cx) / rx;
          if (dx * dx + dy * dy <= 1) out[gy * side + gx] = 1;
        }
      }
    }
  }
  return out;
}

/** A thing kept when the strokes cover this share of it… */
const COVERED = 0.3;
/** …or this share of the strokes lies on it (a big thing painted over in part). Else it was only brushed past. */
const PAINTED = 0.15;
/** The kept things' soft edges reach this many grid cells past where they're half certain. */
const EDGE = 2;

/**
 * The model's answer (`side × side` probabilities) with only the things the strokes meant: its parts over one half
 * certain, joined (8 neighbours), kept when the strokes cover enough of one or lie on it enough (the one they lie on
 * most always), with their soft edges; everything else 0. Null when the strokes touched nothing it found.
 */
export function objectProbabilities(probabilities: Float32Array, side: number, painted: Uint8Array): Float32Array | null {
  const n = side * side;
  const label = new Int32Array(n).fill(-1);
  const stack = new Int32Array(n);
  const areas: number[] = [];
  const overlaps: number[] = [];
  let paintedArea = 0;
  for (let i = 0; i < n; i++) paintedArea += painted[i];
  for (let start = 0; start < n; start++) {
    if (label[start] !== -1 || probabilities[start] < 0.5) continue;
    const id = areas.length;
    let area = 0;
    let overlap = 0;
    let top = 0;
    stack[top++] = start;
    label[start] = id;
    while (top > 0) {
      const i = stack[--top];
      area++;
      overlap += painted[i];
      const x = i % side;
      const y = (i - x) / side;
      for (let dy = -1; dy <= 1; dy++) {
        const ny = y + dy;
        if (ny < 0 || ny >= side) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          if (nx < 0 || nx >= side) continue;
          const j = ny * side + nx;
          if (label[j] === -1 && probabilities[j] >= 0.5) {
            label[j] = id;
            stack[top++] = j;
          }
        }
      }
    }
    areas.push(area);
    overlaps.push(overlap);
  }
  let best = -1;
  for (let id = 0; id < areas.length; id++) if (overlaps[id] > 0 && (best === -1 || overlaps[id] > overlaps[best])) best = id;
  if (best === -1) return null;
  const kept = areas.map((area, id) => id === best || (overlaps[id] > 0 && (overlaps[id] >= area * COVERED || overlaps[id] >= paintedArea * PAINTED)));
  // Where the kept things are, grown by EDGE (a square's max filter, by rows then columns): their soft rims are in it.
  const rows = new Uint8Array(n);
  for (let y = 0; y < side; y++) {
    for (let x = 0; x < side; x++) {
      const id = label[y * side + x];
      if (id === -1 || !kept[id]) continue;
      for (let k = Math.max(0, x - EDGE); k <= Math.min(side - 1, x + EDGE); k++) rows[y * side + k] = 1;
    }
  }
  const near = new Uint8Array(n);
  for (let x = 0; x < side; x++) {
    for (let y = 0; y < side; y++) {
      if (!rows[y * side + x]) continue;
      for (let k = Math.max(0, y - EDGE); k <= Math.min(side - 1, y + EDGE); k++) near[k * side + x] = 1;
    }
  }
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const id = label[i];
    // A dropped thing's own pixels stay out even beside a kept one's rim.
    if (near[i] && (id === -1 || kept[id])) out[i] = probabilities[i];
  }
  return out;
}
