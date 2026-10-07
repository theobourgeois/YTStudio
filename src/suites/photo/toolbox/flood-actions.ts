/**
 * The Paint Bucket's and the Magic Eraser's clicks (docs/photo/tools/paint-bucket.md, magic-eraser.md), once: the
 * canvas and the assistant run these. A click reads the photo's pixels (as it shows, or the layer alone, its mask
 * left out), floods from the point (`shared/photo/flood-fill.ts`), meets the selection, and composes the tiles it
 * reaches on the CPU (`surface-edit.ts`, `shared/photo/fill-compose.ts`): one undo step, the mask it may add with
 * it. Clicks run one at a time, each on the photo the last one left.
 */
import { blendSeed, compositingOf } from "@shared/photo/blending";
import { srgbToLinear } from "@shared/photo/colour";
import { findLayer } from "@shared/photo/edits";
import { type FillMode, type FillSource, eraseMask, erasePixels, fillMask, fillPixels } from "@shared/photo/fill-compose";
import { defringe, flood, floodSelection } from "@shared/photo/flood-fill";
import { type Affine, apply } from "@shared/photo/layers";
import { type PixelSample, sampleScale } from "@shared/photo/pixel-sample";
import type { Rgba } from "@shared/photo/reference/blend";
import { combineSelections } from "@shared/photo/selection";
import { type PatternImage, builtInPatternLevels, patternFromLinear, patternLuminance } from "@shared/photo/style/patterns";
import type { PhotoLayer, PhotoProject } from "@shared/photo/types";
import { strokeColour } from "../brush-options";
import { useColours } from "../colours";
import { liveRenderer } from "../live";
import { type PaintTarget, type SurfacePart, commitSurface } from "../paint-target";
import { photoSample } from "../selecting";
import { currentDoc, currentSelection, usePhoto } from "../store";
import { readSurface } from "../surface-pixels";
import { usePhotoUi } from "../ui";
import { uploadsFor } from "../uploads";
import { type BucketOptions, type MagicEraserOptions, useBucketOptions, useMagicEraserOptions } from "./fill-options";
import { type FloodWhere, type FloodWhereResult, bucketWhere, eraserWhere, floodSurface, shownSurface } from "./flood-target";
import { type ComposeTile, editSurface } from "./surface-edit";

/** What a click did: changed a layer (or nothing: the click missed, or nothing there changed), or why it couldn't. */
export type FloodOutcome =
  | { kind: "done"; layerId: string; part: SurfacePart; changed: boolean; addedMask: boolean }
  /** A placed image under the Paint Bucket: the user chooses a new paint layer or converting it (ux.md). */
  | { kind: "choice"; layerId: string }
  | { kind: "error"; message: string };

/** Which layer and what of it a click acts on (default: the active layer and what's targeted). */
export interface FloodAt {
  layerId?: string | null;
  target?: PaintTarget;
}

// --- the pixels a click reads ---

let unmasked: { doc: PhotoProject; layerId: string; sample: Promise<PixelSample> } | null = null;

/**
 * The pixels a click decides by: the photo as it shows (`layerId` null), or that layer alone as its own pixels:
 * its mask left out, so a second Magic Eraser click decides by the picture, not by what the first one hid. Kept
 * while the photo doesn't change (the selection tools' samples are shared).
 */
async function floodSample(doc: PhotoProject, layerId: string | null): Promise<PixelSample> {
  const layer = layerId ? findLayer(doc, layerId) : undefined;
  if (!layer?.mask) return photoSample(doc, layerId);
  if (unmasked?.doc === doc && unmasked.layerId === layer.id) return unmasked.sample;
  const renderer = liveRenderer();
  if (!renderer) throw new Error("No photo is open.");
  const { mask: _, ...bare } = layer;
  const plain = { ...doc, layers: doc.layers.map((l) => (l.id === layer.id ? (bare as PhotoLayer) : l)) };
  const entry = { doc, layerId: layer.id, sample: renderer.then((r) => r.samplePixels(plain, sampleScale(doc.canvas), layer.id)) };
  unmasked = entry;
  entry.sample.catch(() => {
    if (unmasked === entry) unmasked = null;
  });
  return entry.sample;
}

// --- what's filled ---

/** A pattern's pixels (premultiplied encoded): a built-in one's, or the photo's own read from its surface. */
async function patternPixels(projectId: string, doc: PhotoProject, id: string): Promise<PatternImage | null> {
  const builtIn = builtInPatternLevels(id);
  if (builtIn) return builtIn[0];
  const p = doc.patterns?.find((q) => q.id === id);
  if (!p) return null;
  return patternFromLinear(p.size.width, p.size.height, await readSurface(uploadsFor(projectId), p.surface, p.size.width, p.size.height));
}

/** A pattern's texel under a surface pixel: tiled from the canvas's top-left corner, at 100% (Photoshop's bucket). */
function patternAt(p: PatternImage, matrix: Affine, x: number, y: number): number[] {
  const d = apply(matrix, x + 0.5, y + 0.5);
  const u = ((Math.floor(d.x) % p.width) + p.width) % p.width;
  const v = ((Math.floor(d.y) % p.height) + p.height) % p.height;
  const i = (v * p.width + u) * 4;
  return [p.data[i], p.data[i + 1], p.data[i + 2], p.data[i + 3]];
}

/** A premultiplied encoded pattern texel as premultiplied linear light (what a pixel surface holds). */
function linearOf(t: number[]): Rgba {
  const a = t[3];
  if (a <= 0) return [0, 0, 0, 0];
  return [srgbToLinear(t[0] / a) * a, srgbToLinear(t[1] / a) * a, srgbToLinear(t[2] / a) * a, a];
}

// --- a click ---

let queue: Promise<unknown> = Promise.resolve();

/** Runs clicks one after another: each sees the photo the one before it left. */
function inTurn<T>(work: () => Promise<T>): Promise<T> {
  const run = queue.then(work, work);
  queue = run.catch(() => {});
  return run;
}

interface Click {
  where: FloodWhere;
  /** Read every layer as the photo shows. */
  sampleAll: boolean;
  tolerance: number;
  antiAlias: boolean;
  contiguous: boolean;
  /** The Magic Eraser's Defringe. */
  defringe: boolean;
  /** How the tile is changed, given the colour clicked (straight sRGB, 0..255) and where the surface is. */
  compose: (colour: readonly number[], matrix: Affine) => ComposeTile;
}

/** Floods from `at` and composes what it reaches on the click's surface: one undo step. */
async function run(at: { x: number; y: number }, click: Click): Promise<FloodOutcome> {
  const { projectId, assets } = usePhoto.getState();
  const doc = currentDoc();
  if (!projectId || !doc) return { kind: "error", message: "No photo is open." };
  const { where } = click;
  const target = floodSurface(doc, where.layerId, where.part, assets);
  if (!target) return { kind: "error", message: "That layer's image isn't loaded yet: try again in a moment." };
  const before = shownSurface(doc, where.layerId, where.part);
  const done = (changed: boolean): FloodOutcome => ({ kind: "done", layerId: where.layerId, part: where.part, changed, addedMask: changed && where.addsMask });
  const sample = await floodSample(doc, click.sampleAll ? null : where.own);
  const reached = flood(sample, at, click, doc.canvas);
  if (!reached) return done(false);
  // Defringe unmixes from an opaque colour: a click on transparency has none.
  const amounts = click.defringe && reached.colour[3] >= 128 ? defringe(sample, reached.amounts, reached.colour) : reached.amounts;
  const selection = currentSelection();
  const flooded = floodSelection(sample, amounts, doc.canvas);
  const region = selection ? combineSelections(selection, flooded, "intersect") : flooded;
  if (!region) return done(false);
  const id = await editSurface(uploadsFor(projectId), target, region, click.compose(reached.colour, target.matrix));
  const now = currentDoc();
  // The photo changed under the click (a stroke, an undo): what it composed is of a surface that's gone.
  if (!now || shownSurface(now, where.layerId, where.part) !== before) return { kind: "error", message: "The layer changed while it was being filled: click again." };
  if (!id || id === before) return done(false);
  usePhoto.getState().commit(commitSurface(where.layerId, where.part, id));
  const ui = usePhotoUi.getState();
  // A mask given to a layer becomes what's targeted, so the brush refines it (black hides, white reveals).
  if (where.addsMask && ui.selectedLayerId === where.layerId) ui.setTarget("mask");
  return done(true);
}

/** Resolves who a click acts on, then runs it in turn; reasons it can't come back as outcomes. */
function click(resolve: (doc: PhotoProject) => FloodWhereResult, make: (where: FloodWhere, doc: PhotoProject, projectId: string) => Promise<Click>, at: { x: number; y: number }): Promise<FloodOutcome> {
  return inTurn(async () => {
    const doc = currentDoc();
    const { projectId } = usePhoto.getState();
    if (!doc || !projectId) return { kind: "error", message: "No photo is open." };
    const where = resolve(doc);
    if ("error" in where) return { kind: "error", message: where.error };
    if ("choice" in where) return { kind: "choice", layerId: where.choice };
    try {
      return await run(at, await make(where, doc, projectId));
    } catch (error) {
      return { kind: "error", message: error instanceof Error ? error.message : String(error) };
    }
  });
}

const whoOf = (o: FloodAt) => {
  const ui = usePhotoUi.getState();
  const layerId = o.layerId === undefined ? ui.selectedLayerId : o.layerId;
  return { layerId, target: o.target ?? (layerId === ui.selectedLayerId ? ui.target : "content") };
};

/**
 * The Paint Bucket clicked at document point `at`: the area of similar colour around it filled with the foreground
 * colour or a pattern, through the mode, at Opacity, on the layer's pixels or mask. `options` change the options
 * bar's for this click (the assistant's), `colour` the foreground's.
 */
export function paintBucketAt(at: { x: number; y: number }, options: Partial<BucketOptions> & FloodAt & { colour?: string } = {}): Promise<FloodOutcome> {
  const o: BucketOptions = { ...useBucketOptions.getState(), ...options };
  const who = whoOf(options);
  return click(
    (doc) => bucketWhere(doc, who.layerId, who.target),
    async (where, doc, projectId) => {
      const colour = options.colour ?? useColours.getState().foreground;
      const pattern = o.source === "pattern" ? await patternPixels(projectId, doc, o.pattern) : null;
      if (o.source === "pattern" && !pattern) throw new Error(`There's no pattern "${o.pattern}": choose another in the options bar.`);
      const layer = findLayer(doc, where.layerId)!;
      const mode: FillMode = o.mode;
      return {
        where,
        sampleAll: o.allLayers,
        tolerance: o.tolerance,
        antiAlias: o.antiAlias,
        contiguous: o.contiguous,
        defringe: false,
        compose: (_, matrix) => {
          if (where.part === "mask") {
            const grey = pattern ? (x: number, y: number) => patternLuminance(patternAt(pattern, matrix, x, y)) : strokeColour(colour, "mask")[0];
            return (tile, size, origin, cover) => fillMask(tile, size, size, origin, cover, grey, mode, o.opacity);
          }
          const source: FillSource = pattern ? (x, y) => linearOf(patternAt(pattern, matrix, x, y)) : strokeColour(colour, "pixels");
          const params = { mode, opacity: o.opacity, compositing: compositingOf(doc), seed: blendSeed(layer.id) };
          return (tile, size, origin, cover) => fillPixels(tile, size, size, origin, cover, source, params);
        },
      };
    },
    at,
  );
}

/**
 * The Magic Eraser clicked at document point `at`: the area of similar colour around it erased, on a pixel layer's
 * pixels, or through a layer's mask (a placed image is never rasterised; it's given a mask if it has none).
 */
export function magicEraseAt(at: { x: number; y: number }, options: Partial<MagicEraserOptions> & FloodAt = {}): Promise<FloodOutcome> {
  const o: MagicEraserOptions = { ...useMagicEraserOptions.getState(), ...options };
  const who = whoOf(options);
  return click(
    (doc) => eraserWhere(doc, who.layerId, who.target),
    async (where) => ({
      where,
      sampleAll: o.sampleAll,
      tolerance: o.tolerance,
      antiAlias: o.antiAlias,
      contiguous: o.contiguous,
      defringe: o.defringe,
      compose: (colour) => {
        if (where.part === "mask") return (tile, size, _origin, cover) => eraseMask(tile, size, size, cover, o.opacity);
        const matte = o.defringe && colour[3] >= 128 ? ([colour[0] / 255, colour[1] / 255, colour[2] / 255] as [number, number, number]) : null;
        return (tile, size, _origin, cover) => erasePixels(tile, size, size, cover, o.opacity, matte);
      },
    }),
    at,
  );
}
