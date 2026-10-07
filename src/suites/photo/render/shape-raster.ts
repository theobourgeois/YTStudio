/**
 * Shape layers' pixels (docs/photo/tools/shapes.md): what `shared/photo/shape-drawing.ts` says a shape draws, played
 * on a 2D canvas a tile at a time, at document resolution. The renderer shows a shape layer through a `SurfaceImage`
 * like a pixel layer's; only its tiles come from here instead of the project's uploads: `ShapeTiles` answers the
 * same three questions (`knownManifest`, `manifest`, `tile`), making each tile when it's asked for (again after the
 * atlas evicted it). Nothing is uploaded or saved: the document keeps the shape, never its pixels.
 *
 * Seam (for unifying with text layers): a layer drawn by the 2D canvas compiles into a `PixelNode` whose `surface`
 * is a derived name (`shape:<key>`, `render-plan.ts`); `PhotoRenderer.syncSurfaces` gives its content surface this
 * store in place of the uploads (`register`). Anything else that draws vectors can be a store like this one.
 */
import { srgbToLinear } from "@shared/photo/colour";
import { toHalf } from "@shared/photo/half";
import { type DrawItem, type PathCommand, type ShapeRaster, shapeDrawing, shapeRaster } from "@shared/photo/shape-drawing";
import { type SurfaceManifest, type TileEntry, constantRef, emptySurface, withTiles } from "@shared/photo/surfaces";
import type { ShapeLayer, SurfaceId } from "@shared/photo/types";
import type { SurfaceUploads } from "../uploads";

const TILE = 256;
/** How many shapes' drawings are kept to make tiles from (each is a few kilobytes of paths). */
const KEPT = 512;

/** 8-bit sRGB `v` at 8-bit alpha `a` as a premultiplied linear half float: `LUT[a * 256 + v]`. */
let lut: Uint16Array | null = null;
function premultipliedHalves(): Uint16Array {
  if (lut) return lut;
  lut = new Uint16Array(256 * 256);
  for (let a = 0; a < 256; a++) for (let v = 0; v < 256; v++) lut[a * 256 + v] = toHalf((srgbToLinear(v / 255) * a) / 255);
  return lut;
}
const alphaHalves = Array.from({ length: 256 }, (_, a) => toHalf(a / 255));

/** A path as the 2D canvas's. */
export function toPath2D(path: readonly PathCommand[]): Path2D {
  const p = new Path2D();
  for (const c of path) {
    if (c[0] === "M") p.moveTo(c[1], c[2]);
    else if (c[0] === "L") p.lineTo(c[1], c[2]);
    else if (c[0] === "C") p.bezierCurveTo(c[1], c[2], c[3], c[4], c[5], c[6]);
    else p.closePath();
  }
  return p;
}

/** What a shape draws, on a 2D context already placed (its transform maps document pixels to the context's). */
export function drawItems(ctx: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D, items: readonly DrawItem[]) {
  for (const item of items) {
    const path = toPath2D(item.path);
    if (item.kind === "fill") {
      ctx.fillStyle = item.colour;
      ctx.fill(path, "nonzero");
      continue;
    }
    ctx.save();
    if (item.clip) {
      const clip = toPath2D(item.clip.path);
      if (item.clip.outside) {
        // Everything but the outline: a huge rectangle around it, the outline taken out by the even-odd rule.
        const outside = new Path2D();
        outside.rect(-1e7, -1e7, 2e7, 2e7);
        outside.addPath(clip);
        ctx.clip(outside, "evenodd");
      } else ctx.clip(clip);
    }
    ctx.strokeStyle = item.colour;
    ctx.lineWidth = item.width;
    ctx.lineCap = item.cap;
    ctx.lineJoin = item.join;
    ctx.miterLimit = 10;
    ctx.setLineDash(item.dash);
    ctx.stroke(path);
    ctx.restore();
  }
}

interface Kept {
  layer: ShapeLayer;
  raster: ShapeRaster;
  manifest: SurfaceManifest;
}

/** Shapes' surfaces, made here (the renderer's content store for shape layers). */
export class ShapeTiles {
  private readonly kept = new Map<string, Kept>();
  private canvas: OffscreenCanvas | null = null;
  private ctx: OffscreenCanvasRenderingContext2D | null = null;

  /** The surface a shape layer shows (its id and size): known here from now on. */
  register(layer: ShapeLayer): { id: SurfaceId; size: { width: number; height: number } } {
    const raster = shapeRaster(layer);
    const id = `shape:${raster.key}`;
    if (!this.kept.has(id)) {
      const entries = raster.tiles.map(({ tx, ty, constant }): TileEntry => [tx, ty, constant ? constantRef(constant) : `${id}:${tx}:${ty}`]);
      this.kept.set(id, { layer, raster, manifest: withTiles(emptySurface("rgba16f", TILE, [0, 0, 0, 0]), entries) });
      // The oldest go first (a drag makes one a frame); they're made again if they're asked for.
      while (this.kept.size > KEPT) this.kept.delete(this.kept.keys().next().value!);
    } else {
      // Used again: kept longer.
      const k = this.kept.get(id)!;
      this.kept.delete(id);
      this.kept.set(id, k);
    }
    return { id, size: raster.size };
  }

  knownManifest(id: SurfaceId): SurfaceManifest | null {
    return this.kept.get(id)?.manifest ?? null;
  }

  manifest(id: SurfaceId): Promise<SurfaceManifest> {
    const known = this.knownManifest(id);
    return known ? Promise.resolve(known) : Promise.reject(new Error(`The shape ${id} isn't drawn here any more.`));
  }

  /** A tile's samples (RGBA halves, premultiplied linear light), drawn now. */
  async tile(ref: string): Promise<ArrayBuffer> {
    const at = ref.lastIndexOf(":", ref.lastIndexOf(":") - 1);
    const id = ref.slice(0, at);
    const [tx, ty] = ref.slice(at + 1).split(":").map(Number);
    const kept = this.kept.get(id);
    if (!kept) throw new Error(`The shape ${id} isn't drawn here any more.`);
    return this.draw(kept.layer, tx, ty);
  }

  /** Tile (tx, ty) of a shape: drawn on the 2D canvas, read back, made premultiplied linear halves. */
  draw(layer: ShapeLayer, tx: number, ty: number): ArrayBuffer {
    if (!this.ctx) {
      this.canvas = new OffscreenCanvas(TILE, TILE);
      this.ctx = this.canvas.getContext("2d", { willReadFrequently: true })!;
    }
    const ctx = this.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, TILE, TILE);
    ctx.setTransform(1, 0, 0, 1, -tx * TILE, -ty * TILE);
    drawItems(ctx, shapeDrawing(layer).items);
    const bytes = ctx.getImageData(0, 0, TILE, TILE).data;
    const table = premultipliedHalves();
    const out = new Uint16Array(TILE * TILE * 4);
    for (let i = 0; i < out.length; i += 4) {
      const a = bytes[i + 3];
      if (!a) continue;
      const row = a * 256;
      out[i] = table[row + bytes[i]];
      out[i + 1] = table[row + bytes[i + 1]];
      out[i + 2] = table[row + bytes[i + 2]];
      out[i + 3] = alphaHalves[a];
    }
    return out.buffer;
  }
}

/** The page's one store: shapes are drawn the same for every project. */
export const shapeTiles = new ShapeTiles();

/** The store as a `SurfaceImage` reads its tiles (it asks only for manifests and tiles: shapes are never painted). */
export const shapeStore = shapeTiles as unknown as SurfaceUploads;
