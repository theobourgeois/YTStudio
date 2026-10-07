/**
 * Content-Aware Fill (docs/photo/content-aware-fill.md): the selection filled from what's around it by the model
 * (LaMa, run as every photo model is: `models.ts`), onto a new layer right above the active one, one undo step. It
 * reads the active layer and those under it as they show, so the layers above (an adjustment, a text) still act on
 * the result once, and nothing of the photo's own pixels changes. The plan of crops and the maths are
 * `shared/photo/inpaint.ts`'s; this renders each crop's pixels, runs the model, and puts its answer back at the
 * photo's resolution (with the photo's grain where the crop was shrunk).
 */
import { create } from "zustand";
import { toast } from "sonner";
import { errorMessage } from "@shared/errors";
import { createId } from "@shared/ids";
import { addPixelLayer, findLayer } from "@shared/photo/edits";
import {
  FILL_MODEL,
  FILL_SIDE,
  type FillCrop,
  type FillPlan,
  GRAIN_BELOW_SCALE,
  MAX_FILL_PIXELS,
  type PixelBox,
  fillAlpha,
  fillBox,
  fillReach,
  gaussian,
  grainToAdd,
  growHole,
  highPass,
  holeAt,
  noiseSigma,
  planFill,
  reflect,
  sampleCubic,
  standInFill,
} from "@shared/photo/inpaint";
import { coverageIn, selectionBox } from "@shared/photo/selection";
import type { PhotoProject, PhotoSelection } from "@shared/photo/types";
import { actingLayerId } from "./edit-actions";
import { liveRenderer } from "./live";
import { ModelMissing, askForModel, readyModel, runModel } from "./models";
import type { PhotoRenderer } from "./render/renderer";
import { currentDoc, currentSelection, usePhoto } from "./store";
import { surfaceFromSrgb } from "./surface-pixels";
import { usePhotoUi } from "./ui";
import { uploadsFor } from "./uploads";

/** Content-Aware Fill is running. */
export const useContentAwareFill = create<{ running: boolean }>(() => ({ running: false }));

/** Why a fill can't be done, said to the user (and the assistant) as it is. */
export class FillProblem extends Error {}

/** The new layer's name. */
export const FILL_LAYER_NAME = "Content-Aware Fill";

/** The layers up to and including `layerId` (all of them with none): what the fill reads, as they show. */
function readFrom(doc: PhotoProject, layerId: string | null): PhotoProject {
  const at = layerId ? doc.layers.findIndex((l) => l.id === layerId) : -1;
  return at < 0 ? doc : { ...doc, layers: doc.layers.slice(0, at + 1) };
}

/** Everything a fill works with, over its box (`w` × `h` document pixels from `box`'s corner). */
interface Work {
  renderer: PhotoRenderer;
  source: PhotoProject;
  box: PixelBox;
  w: number;
  h: number;
  hole: Uint8Array;
  alpha: Uint8Array;
  /** Hole still to fill. */
  pending: Uint8Array;
  /** The fill so far, 8-bit sRGB. */
  rgb: Uint8Array;
  plan: FillPlan;
  standIn: boolean;
}

/** The model's input for a crop: what the photo shows there (and the fill so far), reflected past the canvas, with its hole. */
async function cropInput(work: Work, crop: FillCrop): Promise<{ rgb: Uint8Array; mask: Uint8Array }> {
  const { renderer, source, box, w, pending, rgb: filled, alpha } = work;
  const { width: cw, height: ch } = source.canvas;
  const S = FILL_SIDE;
  const s = crop.scale;
  // The crop's part on the canvas, at the crop's scale.
  const rx0 = Math.max(0, crop.x);
  const ry0 = Math.max(0, crop.y);
  const rx1 = Math.min(cw, crop.x + crop.side);
  const ry1 = Math.min(ch, crop.y + crop.side);
  const seen = await renderer.sampleView(source, { zoom: s, x: rx0, y: ry0, width: Math.max(1, Math.round((rx1 - rx0) * s)), height: Math.max(1, Math.round((ry1 - ry0) * s)) });
  // Where the hole still is, by model pixel: every one a hole pixel touches (on the canvas; past it, reflected below).
  const holes = new Uint8Array(S * S);
  const cell = (v: number, from: number) => Math.min(S - 1, Math.max(0, Math.floor((v - from) * s)));
  const hx0 = Math.max(box.x0, crop.x);
  const hy0 = Math.max(box.y0, crop.y);
  const hx1 = Math.min(box.x1, crop.x + crop.side);
  const hy1 = Math.min(box.y1, crop.y + crop.side);
  for (let y = hy0; y < hy1; y++)
    for (let x = hx0; x < hx1; x++) {
      if (!pending[(y - box.y0) * w + (x - box.x0)]) continue;
      const i0 = cell(x, crop.x);
      const i1 = cell(x + 1 - 1e-6, crop.x);
      const j0 = cell(y, crop.y);
      const j1 = cell(y + 1 - 1e-6, crop.y);
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) holes[j * S + i] = 1;
    }
  // Shrunk, an edge pixel mixes in what's in the hole: keep it out of what the model reads.
  const grown = s < 1 ? dilateOne(holes, S) : holes;
  const rgb = new Uint8Array(S * S * 3);
  const mask = new Uint8Array(S * S);
  for (let j = 0; j < S; j++) {
    // The document pixel under this model pixel's centre, reflected into the canvas.
    const y = reflect(Math.floor(crop.y + (j + 0.5) / s), ch);
    const sy = Math.min(seen.height - 1, Math.max(0, Math.floor((y + 0.5 - ry0) * s)));
    const mj = cell(y + 0.5, crop.y);
    for (let i = 0; i < S; i++) {
      const x = reflect(Math.floor(crop.x + (i + 0.5) / s), cw);
      const sx = Math.min(seen.width - 1, Math.max(0, Math.floor((x + 0.5 - rx0) * s)));
      const o = (j * S + i) * 3;
      const k = (sy * seen.width + sx) * 4;
      const m = grown[mj * S + cell(x + 0.5, crop.x)];
      mask[j * S + i] = m;
      if (m) continue;
      // What's been filled already shows here as it will.
      const inBox = x >= box.x0 && x < box.x1 && y >= box.y0 && y < box.y1;
      const b = inBox ? (y - box.y0) * w + (x - box.x0) : -1;
      const a = b >= 0 && work.hole[b] && !pending[b] ? alpha[b] / 255 : 0;
      for (let c = 0; c < 3; c++) rgb[o + c] = Math.round(seen.data[k + c] * (1 - a) + (a ? filled[b * 3 + c] * a : 0));
    }
  }
  return { rgb, mask };
}

/** A square grid's 1s grown by one pixel (its 8 neighbours). */
function dilateOne(values: Uint8Array, side: number): Uint8Array {
  const out = new Uint8Array(values);
  for (let y = 0; y < side; y++)
    for (let x = 0; x < side; x++) {
      if (!values[y * side + x]) continue;
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx >= 0 && ny >= 0 && nx < side && ny < side) out[ny * side + nx] = 1;
        }
    }
  return out;
}

/** The model's answer for a crop: RGB 0..255, 512 × 512. */
async function answer(work: Work, input: { rgb: Uint8Array; mask: Uint8Array }): Promise<Float32Array> {
  if (work.standIn) return standInFill(input.rgb, input.mask);
  const n = FILL_SIDE * FILL_SIDE;
  const image = new Float32Array(3 * n);
  const mask = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    mask[i] = input.mask[i];
    for (let c = 0; c < 3; c++) image[c * n + i] = input.mask[i] ? 0 : input.rgb[i * 3 + c] / 255;
  }
  const planar = await runModel("fill", { [FILL_MODEL.image]: { data: image, dims: [1, 3, FILL_SIDE, FILL_SIDE] }, [FILL_MODEL.mask]: { data: mask, dims: [1, 1, FILL_SIDE, FILL_SIDE] } }, FILL_MODEL.output);
  const out = new Float32Array(3 * n);
  for (let i = 0; i < n; i++) for (let c = 0; c < 3; c++) out[i * 3 + c] = planar[c * n + i];
  return out;
}

/** A crop's holes (its members, on the canvas, in the box) as document pixels: `visit` for each, by box index. */
function eachMember(work: Work, crop: FillCrop, visit: (x: number, y: number, b: number) => void) {
  const { box, w, hole, plan } = work;
  const members = new Set(crop.members);
  for (let y = Math.max(box.y0, crop.hole.y0); y < Math.min(box.y1, crop.hole.y1); y++)
    for (let x = Math.max(box.x0, crop.hole.x0); x < Math.min(box.x1, crop.hole.x1); x++) {
      const b = (y - box.y0) * w + (x - box.x0);
      if (hole[b] && members.has(holeAt(plan, x, y))) visit(x, y, b);
    }
}

/** The answer put back into the fill at the photo's resolution (bicubic where the crop was shrunk), for its holes alone. */
function putBack(work: Work, crop: FillCrop, out: Float32Array) {
  const S = FILL_SIDE;
  const s = crop.scale;
  const v = [0, 0, 0];
  eachMember(work, crop, (x, y, b) => {
    work.pending[b] = 0;
    if (s === 1) {
      const o = ((y - crop.y) * S + (x - crop.x)) * 3;
      for (let c = 0; c < 3; c++) work.rgb[b * 3 + c] = Math.round(Math.min(255, Math.max(0, out[o + c])));
      return;
    }
    sampleCubic(out, S, (x + 0.5 - crop.x) * s - 0.5, (y + 0.5 - crop.y) * s - 0.5, v);
    for (let c = 0; c < 3; c++) work.rgb[b * 3 + c] = Math.round(v[c]);
  });
}

/**
 * A shrunk crop's fill is as soft as 512 pixels across it; the photo isn't. Its grain is measured beside the holes
 * at full resolution (four patches, the hole left out), and what the fill lacks is added: luminance noise, the same
 * every time.
 */
async function matchGrain(work: Work, crop: FillCrop) {
  const { box, w, hole, source, renderer } = work;
  const { width: cw, height: ch } = source.canvas;
  const P = 96;
  const r = crop.hole;
  const midX = Math.round((r.x0 + r.x1) / 2 - P / 2);
  const midY = Math.round((r.y0 + r.y1) / 2 - P / 2);
  const patches = [
    { x: r.x0 - P, y: midY },
    { x: r.x1, y: midY },
    { x: midX, y: r.y0 - P },
    { x: midX, y: r.y1 },
  ]
    .map((p) => ({ x: Math.min(Math.max(0, p.x), cw - P), y: Math.min(Math.max(0, p.y), ch - P) }))
    .filter(() => cw >= P && ch >= P);
  const around: number[][] = [[], [], []];
  for (const p of patches) {
    const seen = await renderer.sampleView(source, { zoom: 1, x: p.x, y: p.y, width: P, height: P });
    for (let y = 1; y < P - 1; y++)
      for (let x = 1; x < P - 1; x++) {
        const dx = p.x + x;
        const dy = p.y + y;
        const inBox = dx >= box.x0 && dx < box.x1 && dy >= box.y0 && dy < box.y1;
        if (inBox && hole[(dy - box.y0) * w + (dx - box.x0)]) continue;
        for (let c = 0; c < 3; c++) around[c].push(Math.abs(highPass(seen.data, P, x, y, c, 4)));
      }
  }
  const own: number[][] = [[], [], []];
  const step = Math.max(1, Math.floor(Math.sqrt(((r.x1 - r.x0) * (r.y1 - r.y0)) / 100_000)));
  eachMember(work, crop, (x, y, b) => {
    if ((x - r.x0) % step || (y - r.y0) % step || work.alpha[b] < 255) return;
    if (x <= box.x0 || y <= box.y0 || x >= box.x1 - 1 || y >= box.y1 - 1) return;
    for (let c = 0; c < 3; c++) own[c].push(Math.abs(highPass(work.rgb, w, x - box.x0, y - box.y0, c, 3)));
  });
  const add = around.map((values, c) => grainToAdd(noiseSigma(values), noiseSigma(own[c])));
  if (add.every((a) => a < 0.25)) return;
  const next = gaussian(crop.x * 7919 + crop.y * 104729 + crop.side);
  eachMember(work, crop, (_x, _y, b) => {
    const a = work.alpha[b] / 255;
    if (a === 0) return;
    const n = next();
    for (let c = 0; c < 3; c++) work.rgb[b * 3 + c] = Math.round(Math.min(255, Math.max(0, work.rgb[b * 3 + c] + n * add[c])));
  });
}

/**
 * Content-Aware Fill: `selection` filled from what's around it on a new layer right above `layerId` (the active
 * layer; the topmost under the selection with none), reading that layer and those under it as they show. One undo
 * step; the new layer is selected and the selection kept. Throws `ModelMissing` while the model isn't here and
 * `FillProblem` when it can't fill. Returns the new layer's id.
 */
export async function contentAwareFill(options: { layerId?: string | null; selection?: PhotoSelection | null } = {}): Promise<string> {
  const { projectId } = usePhoto.getState();
  const doc = currentDoc();
  if (!projectId || !doc) throw new FillProblem("No photo is open.");
  const selection = options.selection ?? currentSelection();
  if (!selection) throw new FillProblem("Select what to remove first: Content-Aware Fill replaces the selection with what's around it.");
  if (useContentAwareFill.getState().running) throw new FillProblem("A Content-Aware Fill is already running.");
  const status = await readyModel("fill");
  const renderer = await liveRenderer();
  if (!renderer) throw new FillProblem("The photo isn't on the GPU yet.");
  const layerId = options.layerId === undefined ? actingLayerId() : options.layerId;
  useContentAwareFill.setState({ running: true });
  try {
    const canvas = doc.canvas;
    const { grow, feather } = fillReach(canvas);
    const box = fillBox(selectionBox(selection), grow, canvas);
    if (!box) throw new FillProblem("The selection is outside the canvas.");
    const w = box.x1 - box.x0;
    const h = box.y1 - box.y0;
    if (w * h > MAX_FILL_PIXELS) throw new FillProblem(`The selection is too big to fill (${Math.round((w * h) / 1e6)} megapixels around it; at most ${MAX_FILL_PIXELS / 1e6}). Select less.`);
    const coverage = coverageIn(selection, { x: box.x0, y: box.y0, width: w, height: h });
    if (!coverage.some((v) => v > 0)) throw new FillProblem("The selection is empty.");
    const hole = growHole(coverage, box, grow, canvas);
    const work: Work = {
      renderer,
      source: readFrom(doc, layerId),
      box,
      w,
      h,
      hole,
      alpha: fillAlpha(hole, box, feather, canvas),
      pending: Uint8Array.from(hole),
      rgb: new Uint8Array(w * h * 3),
      plan: planFill(hole, box, canvas),
      standIn: status.standIn,
    };
    for (const crop of work.plan.crops) {
      putBack(work, crop, await answer(work, await cropInput(work, crop)));
      if (crop.scale < GRAIN_BELOW_SCALE && !work.standIn) await matchGrain(work, crop);
    }
    const surface = await surfaceFromSrgb(uploadsFor(projectId), w, h, work.rgb, work.alpha);
    if (!surface) throw new FillProblem("There was nothing to fill.");
    if (usePhoto.getState().projectId !== projectId) throw new FillProblem("The photo was closed while it was being filled.");
    const id = createId("layer");
    const transform = { x: box.x0 + w / 2, y: box.y0 + h / 2, scaleX: 1, scaleY: 1, rotation: 0 };
    usePhoto.getState().commit((d) => addPixelLayer(d, { id, name: FILL_LAYER_NAME, surface, size: { width: w, height: h }, transform }, layerId && findLayer(d, layerId) ? layerId : null));
    usePhotoUi.getState().select(id);
    return id;
  } finally {
    useContentAwareFill.setState({ running: false });
  }
}

/** Content-Aware Fill from the menu or ⇧⌫: says what it's doing, asks for the model first, says why it can't. */
export async function runContentAwareFill() {
  if (useContentAwareFill.getState().running) return;
  if (!currentSelection()) return void toast("Select what to remove first", { description: "Content-Aware Fill replaces the selection with what's around it." });
  const working = toast.loading("Filling the selection…");
  try {
    await contentAwareFill();
    toast.dismiss(working);
  } catch (error) {
    toast.dismiss(working);
    if (error instanceof ModelMissing) return askForModel(error, () => void runContentAwareFill());
    if (error instanceof FillProblem) return void toast.error(error.message);
    toast.error("Content-Aware Fill didn't work", { description: errorMessage(error) });
  }
}
