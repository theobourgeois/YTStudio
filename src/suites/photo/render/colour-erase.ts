/**
 * The Background Eraser's CPU side (docs/photo/tools/background-eraser.md): what's erased is decided from the pixels
 * (a flood fill for Contiguous), so the layer's tiles under the dabs are read back once a stroke, as they were before
 * it, and kept as 8-bit encoded colour; each dab's erasure is accumulated per tile here and the changed rows written
 * into the drafts' accumulation, which the GPU's apply pass extracts (`brush-effects.ts`). Dabs wait, in order, for
 * their tiles.
 */
import {
  type BackgroundEraserOptions,
  type Colour8,
  ERASER_SPACING,
  type PixelWindow,
  accumulate,
  dabErase,
  dabWindow,
  encodePixels,
  eraseAmounts,
  sampleAt,
  sampleLight,
  toleranceLevels,
} from "@shared/photo/background-eraser.ts";
import { type BrushSettings, type Dab, DabSpacer } from "@shared/photo/brush.ts";
import type { SurfaceImage } from "./surface.ts";

/** What a Background Eraser stroke erases by. */
export interface ColourErase {
  options: BackgroundEraserOptions;
  /** The background colour (Sampling: Background Swatch). */
  swatch: Colour8;
  /** The foreground colour (Protect Foreground Color). */
  foreground: Colour8;
}

type TileKey = string;
const keyOf = (tx: number, ty: number): TileKey => `${tx},${ty}`;

/** A layer's tiles as matching reads them, read back as needed. */
class EncodedTiles {
  private readonly tiles = new Map<TileKey, Uint8ClampedArray>();

  constructor(
    readonly surface: SurfaceImage,
    readonly tile: number,
  ) {}

  /** Reads the tiles under these windows that aren't here yet. */
  async need(windows: readonly { x: number; y: number; width: number; height: number }[]) {
    const missing = new Map<TileKey, { tx: number; ty: number }>();
    for (const w of windows) {
      for (let ty = Math.floor(w.y / this.tile); ty <= Math.floor((w.y + w.height - 1) / this.tile); ty++) {
        for (let tx = Math.floor(w.x / this.tile); tx <= Math.floor((w.x + w.width - 1) / this.tile); tx++) {
          if (!this.tiles.has(keyOf(tx, ty))) missing.set(keyOf(tx, ty), { tx, ty });
        }
      }
    }
    if (!missing.size) return;
    const read = await this.surface.readBase([...missing.values()]);
    for (const [key, values] of read) this.tiles.set(key, encodePixels(values));
    // Outside the surface: transparent.
    for (const key of missing.keys()) if (!this.tiles.has(key)) this.tiles.set(key, new Uint8ClampedArray(this.tile * this.tile * 4));
  }

  /** A window of the layer's pixels (its tiles read first: `need`). */
  window(w: { x: number; y: number; width: number; height: number }): PixelWindow {
    const data = new Uint8ClampedArray(w.width * w.height * 4);
    const t = this.tile;
    for (let y = 0; y < w.height; y++) {
      const ly = w.y + y;
      const ty = Math.floor(ly / t);
      let x = 0;
      while (x < w.width) {
        const lx = w.x + x;
        const tx = Math.floor(lx / t);
        const run = Math.min(w.width - x, (tx + 1) * t - lx);
        const src = this.tiles.get(keyOf(tx, ty));
        if (src) {
          const from = ((ly - ty * t) * t + (lx - tx * t)) * 4;
          data.set(src.subarray(from, from + run * 4), (y * w.width + x) * 4);
        }
        x += run;
      }
    }
    return { ...w, data };
  }
}

/** A tile's accumulation and the part of it changed since it was last written. */
interface TileAcc {
  tx: number;
  ty: number;
  data: Float32Array;
  dirty: { x0: number; y0: number; x1: number; y1: number } | null;
}

/** Spreads a window's erasure (`w`, of background `light`) over the tiles' accumulations it reaches. */
function spread(accs: Map<TileKey, TileAcc>, tile: number, win: { x: number; y: number; width: number; height: number }, w: Float32Array, light: readonly [number, number, number]) {
  for (let ty = Math.floor(win.y / tile); ty <= Math.floor((win.y + win.height - 1) / tile); ty++) {
    for (let tx = Math.floor(win.x / tile); tx <= Math.floor((win.x + win.width - 1) / tile); tx++) {
      if (tx < 0 || ty < 0) continue;
      const key = keyOf(tx, ty);
      let acc = accs.get(key);
      if (!acc) accs.set(key, (acc = { tx, ty, data: new Float32Array(tile * tile * 4), dirty: null }));
      const ox = win.x - tx * tile;
      const oy = win.y - ty * tile;
      accumulate(acc.data, tile, tile, w, ox, oy, win.width, win.height, light);
      const x0 = Math.max(0, ox);
      const y0 = Math.max(0, oy);
      const x1 = Math.min(tile, ox + win.width);
      const y1 = Math.min(tile, oy + win.height);
      if (x1 <= x0 || y1 <= y0) continue;
      acc.dirty = acc.dirty ? { x0: Math.min(acc.dirty.x0, x0), y0: Math.min(acc.dirty.y0, y0), x1: Math.max(acc.dirty.x1, x1), y1: Math.max(acc.dirty.y1, y1) } : { x0, y0, x1, y1 };
    }
  }
}

/** Writes the changed parts of the accumulations into the stroke's drafts; resolves with the tiles written. */
function write(surface: SurfaceImage, accs: Map<TileKey, TileAcc>): TileAcc[] {
  const changed = [...accs.values()].filter((a) => a.dirty);
  if (!changed.length) return changed;
  surface.effectDrafts(changed);
  for (const a of changed) {
    const d = a.dirty!;
    surface.writeAccumulation(a.tx, a.ty, a.data, { x: d.x0, y: d.y0, width: d.x1 - d.x0, height: d.y1 - d.y0 });
    a.dirty = null;
  }
  return changed;
}

/**
 * A Background Eraser stroke on a surface whose effect stroke has begun (`beginEffect` with `{ kind: "erase" }`):
 * samples in the surface's pixels; `idle` resolves when every dab so far is shown.
 */
export class ColourEraseStroke {
  private readonly spacer: DabSpacer;
  private readonly pixels: EncodedTiles;
  private readonly accs = new Map<TileKey, TileAcc>();
  private queue: Promise<void> = Promise.resolve();
  private once: Colour8 | null = null;
  private stopped = false;
  /** The first error a dab met (the stroke stops there). */
  failure: unknown = null;

  constructor(
    readonly surface: SurfaceImage,
    brush: BrushSettings,
    private readonly erase: ColourErase,
  ) {
    this.spacer = new DabSpacer({ ...brush, strength: 1, spacing: ERASER_SPACING });
    this.pixels = new EncodedTiles(surface, surface.ctx.tile);
  }

  add(points: readonly { x: number; y: number }[]) {
    if (this.stopped) return;
    const dabs = points.flatMap((p) => this.spacer.add(p.x, p.y));
    if (!dabs.length) return;
    this.queue = this.queue.then(() => this.run(dabs)).catch((error: unknown) => {
      this.failure ??= error;
      this.stopped = true;
    });
  }

  /** Resolves when every dab added so far has been erased and shown. */
  idle(): Promise<void> {
    return this.queue;
  }

  /** Nothing more is done (the stroke was dropped). */
  stop() {
    this.stopped = true;
  }

  private async run(dabs: Dab[]) {
    if (this.stopped) return;
    const windows = dabs.map(dabWindow);
    await this.pixels.need(windows);
    if (this.stopped) return;
    const { options, swatch, foreground } = this.erase;
    const protect = options.protectForeground ? foreground : null;
    const tile = this.pixels.tile;
    dabs.forEach((dab, i) => {
      const win = this.pixels.window(windows[i]);
      const sample = options.sampling === "swatch" ? swatch : options.sampling === "once" ? (this.once ??= sampleAt(win, dab.x, dab.y)) : sampleAt(win, dab.x, dab.y);
      if (!sample) return;
      const w = dabErase(win, dab, sample, { tolerance: options.tolerance, limits: options.limits, protect });
      spread(this.accs, tile, win, w, sampleLight(sample));
    });
    const changed = write(this.surface, this.accs);
    if (changed.length) this.surface.applyEffect(changed);
  }
}

/**
 * A colour taken out of a whole region at once (the assistant's `remove_colour`), as `SurfaceImage.effectFill`'s
 * `accumulate`: the region's tiles read, matched against `sample` (or the colour at `seed`, in the surface's pixels),
 * flooded from `seed` for Contiguous and Find Edges, and written as the drafts' accumulation. Resolves with how many
 * pixels it erases at all.
 */
export async function eraseRegion(
  surface: SurfaceImage,
  tiles: readonly { tx: number; ty: number }[],
  request: { sample: Colour8 | null; seed: { x: number; y: number } | null; options: BackgroundEraserOptions; protect: Colour8 | null },
): Promise<number> {
  const tile = surface.ctx.tile;
  const xs = tiles.map((t) => t.tx);
  const ys = tiles.map((t) => t.ty);
  const box = { x: Math.min(...xs) * tile, y: Math.min(...ys) * tile, width: (Math.max(...xs) - Math.min(...xs) + 1) * tile, height: (Math.max(...ys) - Math.min(...ys) + 1) * tile };
  const pixels = new EncodedTiles(surface, tile);
  await pixels.need([box]);
  const win = pixels.window(box);
  const seed = request.seed ? { x: request.seed.x - box.x, y: request.seed.y - box.y } : null;
  const sample = request.sample ?? (request.seed ? sampleAt(win, request.seed.x, request.seed.y) : null);  if (!sample) throw new Error("There's nothing at that point to sample (it's transparent or off the layer): give a colour, or a point on the layer's pixels.");
  const contiguous = request.options.limits !== "discontiguous";
  const amounts = eraseAmounts(win, { sample, tolerance: toleranceLevels(request.options.tolerance), limits: request.options.limits, protect: request.protect, seed: contiguous ? seed : null });
  let erased = 0;
  for (const v of amounts) if (v > 0) erased++;
  const accs = new Map<TileKey, TileAcc>();
  spread(accs, tile, box, amounts, sampleLight(sample));
  // Only the region's tiles (an empty one has nothing to erase).
  const wanted = new Set(tiles.map((t) => keyOf(t.tx, t.ty)));
  for (const key of accs.keys()) if (!wanted.has(key)) accs.delete(key);
  write(surface, accs);
  return erased;
}
