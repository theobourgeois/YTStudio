/**
 * Layers the 2D canvas draws, on the GPU (`shared/photo/canvas-content.ts`; docs/photo/tools/type.md, "Drawing it"):
 * a raster is drawn once by `drawCanvasContent` into an OffscreenCanvas of its size (document pixels, the layer's whole
 * transform applied, so it's sharp at any scale), then made premultiplied linear light, its pyramid reduced on the CPU,
 * and kept in pinned atlas slots (nothing is ever fetched: it's always resident). `CanvasImages` keeps them by key, the
 * renderer's `planSources.draw` asks it for a canvas node's pixels.
 *
 * A kind of content that's drawn in one colour (text) draws its coverage in white and says its colour (`tint`): the
 * colour is then exact, coverage only scaling it. Others (shapes: `shape-draw.ts`) draw in their own colours.
 */
import type { CanvasRaster } from "@shared/photo/canvas-content";
import { srgbToLinear } from "@shared/photo/colour";
import { levelCount } from "@shared/photo/geometry";
import { toHalf } from "@shared/photo/half";
import type { Drawable } from "./compositor";
import type { RenderContext } from "./context";
import { FILL, VirtualImage } from "./image";
import { coveragePyramid, coverageTile, meanPyramid } from "./text-pyramid";
import { drawText } from "./text-draw";
import { drawShape } from "./shape-draw";

type Ctx2D = OffscreenCanvasRenderingContext2D;

/** What drawing a raster made: its pixels are coverage in white, in this colour (sRGB "#rrggbb"), or its own colours (null). */
export interface Drawn {
  tint: string | null;
}

/**
 * Draws a raster's content into `ctx` (cleared, the raster's size): the one place each kind of canvas content is
 * drawn. `raster.matrix` takes the layer's own pixels into the canvas's.
 */
export function drawCanvasContent(ctx: Ctx2D, raster: CanvasRaster): Drawn {
  switch (raster.content.kind) {
    case "text":
      return drawText(ctx, raster.content, raster.matrix);
    case "shape":
      return drawShape(ctx, raster.content, raster.x, raster.y);
  }
}

const hexLinear = (hex: string): [number, number, number] => {
  const n = Number.parseInt(hex.slice(1), 16);
  return [srgbToLinear(((n >> 16) & 255) / 255), srgbToLinear(((n >> 8) & 255) / 255), srgbToLinear((n & 255) / 255)];
};

/** A drawn raster on the GPU: a `Drawable`, as a source's or a surface's pixels are. */
export class CanvasImage implements Drawable {
  readonly image: VirtualImage;
  readonly preview = null;
  private readonly slots: number[] = [];

  constructor(
    readonly ctx: RenderContext,
    readonly raster: CanvasRaster,
  ) {
    const tile = ctx.tile;
    const size = { width: raster.width, height: raster.height };
    const id = ctx.id();
    this.image = new VirtualImage(ctx.device, size, tile, [0, 0, 0, 0], true, FILL, `canvas ${id}`);
    const canvas = new OffscreenCanvas(raster.width, raster.height);
    const c2d = canvas.getContext("2d", { willReadFrequently: true })!;
    const drawn = drawCanvasContent(c2d, raster);
    const pixels = c2d.getImageData(0, 0, raster.width, raster.height).data;
    const count = Math.min(this.image.levels.length, levelCount(size, tile));
    // One colour: coverage scales it. Several: each channel's own coverage-weighted colour, then reduced alike.
    const channels = drawn.tint ? [{ colour: hexLinear(drawn.tint), alpha: everyFourth(pixels, 3) }] : null;
    const levels = channels ? coveragePyramid(channels[0].alpha, raster.width, raster.height, count) : null;
    const rgba = channels ? null : premultipliedPyramid(pixels, raster.width, raster.height, count);
    for (let level = 0; level < count; level++) {
      const l = this.image.levels[level];
      for (let ty = 0; ty < l.tilesY; ty++) {
        for (let tx = 0; tx < l.tilesX; tx++) {
          const data = levels ? coverageTile(levels[level], tx, ty, tile, channels![0].colour) : rgba![level](tx, ty, tile);
          if (!data) continue;
          const slot = ctx.atlas.acquire(`k${id}:${level}:${tx}:${ty}`, true);
          this.slots.push(slot);
          this.write(slot, data);
          this.image.setSlot(level, tx, ty, slot);
        }
      }
    }
    this.image.flush();
  }

  get width() {
    return this.raster.width;
  }

  get height() {
    return this.raster.height;
  }

  private write(slot: number, data: Float32Array) {
    const { texture, layer } = this.ctx.atlas.location(slot);
    const tile = this.ctx.tile;
    const samples: ArrayBufferView<ArrayBuffer> = this.ctx.format === "rgba32float" ? (data as Float32Array<ArrayBuffer>) : halves(data);
    this.ctx.device.queue.writeTexture({ texture, origin: [0, 0, layer] }, samples, { bytesPerRow: this.ctx.rowBytes }, [tile, tile, 1]);
  }

  destroy() {
    for (const slot of this.slots) this.ctx.atlas.release(slot);
    this.image.destroy();
  }
}

type HalfArrayConstructor = new (from: ArrayLike<number>) => ArrayBufferView<ArrayBuffer>;
/** The browser's own Float16Array where it has one (it rounds as `toHalf` does, ties to even), many times faster. */
const NativeHalf = (globalThis as { Float16Array?: HalfArrayConstructor }).Float16Array;

/** Floats as half floats' bits, for an `rgba16float` texture. */
function halves(data: Float32Array): ArrayBufferView<ArrayBuffer> {
  if (NativeHalf) return new NativeHalf(data);
  const out = new Uint16Array(data.length);
  for (let i = 0; i < data.length; i++) out[i] = toHalf(data[i]);
  return out;
}

/** An 8-bit sRGB value in linear light, by table. */
const LINEAR = Float32Array.from({ length: 256 }, (_, i) => srgbToLinear(i / 255));

function everyFourth(pixels: Uint8ClampedArray, offset: number): Uint8Array {
  const out = new Uint8Array(pixels.length / 4);
  for (let i = 0; i < out.length; i++) out[i] = pixels[i * 4 + offset];
  return out;
}

/** Straight 8-bit sRGB pixels as premultiplied linear light, each channel reduced as coverage is: a tile maker per level. */
function premultipliedPyramid(pixels: Uint8ClampedArray, width: number, height: number, count: number) {
  const alpha = everyFourth(pixels, 3);
  const coverage = coveragePyramid(alpha, width, height, count);
  const colours = [0, 1, 2].map((c) => {
    const base = new Float32Array(alpha.length);
    for (let i = 0; i < base.length; i++) base[i] = (LINEAR[pixels[i * 4 + c]] * alpha[i]) / 255;
    return meanPyramid(base, width, height, count);
  });
  return coverage.map((level, i) => (tx: number, ty: number, tile: number) => {
    const out = coverageTile(level, tx, ty, tile, [1, 1, 1]);
    if (!out) return null;
    for (let y = 0; y < tile && ty * tile + y < level.height; y++) {
      for (let x = 0; x < tile && tx * tile + x < level.width; x++) {
        const k = (ty * tile + y) * level.width + tx * tile + x;
        const o = (y * tile + x) * 4;
        for (let c = 0; c < 3; c++) out[o + c] = colours[c][i].data[k];
      }
    }
    return out;
  });
}

/** How many drawn rasters are kept (each layer's newest, and those still drawn by an export or a picture). */
const KEPT = 48;

/** The drawn rasters by key, the least recently used let go past `KEPT`. */
export class CanvasImages {
  private readonly images = new Map<string, CanvasImage>();

  /** A raster's pixels on the GPU, drawn now if they aren't kept. */
  get(ctx: RenderContext, raster: CanvasRaster): CanvasImage {
    let image = this.images.get(raster.key);
    if (image && image.ctx === ctx) {
      this.images.delete(raster.key);
      this.images.set(raster.key, image);
      return image;
    }
    image?.destroy();
    image = new CanvasImage(ctx, raster);
    this.images.set(raster.key, image);
    while (this.images.size > KEPT) {
      const [oldest, old] = this.images.entries().next().value!;
      this.images.delete(oldest);
      old.destroy();
    }
    return image;
  }

  clear() {
    for (const image of this.images.values()) image.destroy();
    this.images.clear();
  }
}
