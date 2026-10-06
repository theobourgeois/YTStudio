/**
 * F0's GPU checks (docs/photo/foundations-prototype.md): reading level-0 pixels back (the blur's seam check went
 * with F4: the glow's own tests cover tiles), and the export path (quantise every tile with the output transform, then let the
 * server encode it). Kept beside the renderer because F1's export and tests use the same pieces.
 */
import { fromHalf } from "@shared/photo/half.ts";
import { DITHER_8BIT } from "@shared/photo/output.ts";
import { BATCH, type RenderContext } from "./context.ts";
import { PENDING, VirtualImage } from "./image.ts";
import type { PaintSurface } from "./paint.ts";
import type { SourceImage } from "./source.ts";

/** Level 0 of an image as floats (RGBA, premultiplied linear), read back tile by tile. */
export async function readLevel0(ctx: RenderContext, image: VirtualImage): Promise<Float32Array> {
  const { width, height, tilesX, tilesY } = image.levels[0];
  const tile = ctx.tile;
  const out = new Float32Array(width * height * 4);
  const tileBytes = ctx.atlas.tileBytes;
  const half = ctx.format === "rgba16float";
  for (let ty = 0; ty < tilesY; ty++) {
    const row: { tx: number; slot: number }[] = [];
    for (let tx = 0; tx < tilesX; tx++) {
      const slot = image.slotOf(0, tx, ty);
      if (slot === null) throw new Error(`Tile ${tx},${ty} isn't resident`);
      row.push({ tx, slot });
    }
    const buffer = ctx.device.createBuffer({ size: row.length * tileBytes, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
    const encoder = ctx.device.createCommandEncoder();
    row.forEach(({ slot }, i) => {
      const { texture, layer } = ctx.atlas.location(slot);
      encoder.copyTextureToBuffer({ texture, origin: [0, 0, layer] }, { buffer, offset: i * tileBytes, bytesPerRow: ctx.rowBytes }, [tile, tile, 1]);
    });
    ctx.device.queue.submit([encoder.finish()]);
    await buffer.mapAsync(GPUMapMode.READ);
    const mapped = buffer.getMappedRange();
    row.forEach(({ tx }, i) => {
      const values = half ? new Uint16Array(mapped, i * tileBytes, tile * tile * 4) : new Float32Array(mapped, i * tileBytes, tile * tile * 4);
      for (let y = 0; y < tile && ty * tile + y < height; y++) {
        for (let x = 0; x < tile && tx * tile + x < width; x++) {
          const from = (y * tile + x) * 4;
          const to = ((ty * tile + y) * width + tx * tile + x) * 4;
          for (let c = 0; c < 4; c++) out[to + c] = half ? fromHalf(values[from + c]) : values[from + c];
        }
      }
    });
    buffer.unmap();
    buffer.destroy();
  }
  return out;
}

export interface Quantized {
  width: number;
  height: number;
  ms: number;
}

/**
 * Level 0 of the source with paint over it, through the output transform, as 8-bit RGBA, one band of tile rows
 * at a time (`onBand` gets its first row and its rows): what an export sends the server as it goes, so the whole
 * image is never in memory. Bands are rendered in order; the next starts once `onBand`'s promise resolves.
 */
export async function quantize(
  ctx: RenderContext,
  source: SourceImage,
  paint: PaintSurface | null,
  onBand: (from: number, rows: Uint8Array) => Promise<void> | void,
  amplitude = DITHER_8BIT,
): Promise<Quantized> {
  const started = performance.now();
  const { device } = ctx;
  const { width, height, tilesX, tilesY } = source.image.levels[0];
  const tile = ctx.tile;
  const params = device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  const p = new ArrayBuffer(16);
  new Float32Array(p, 0, 1)[0] = amplitude;
  new Uint32Array(p, 4, 2).set([paint ? 1 : 0, tile]);
  device.queue.writeBuffer(params, 0, p);
  const jobs = device.createBuffer({ size: BATCH * 8, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
  const out = device.createBuffer({ size: BATCH * tile * tile * 4, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC });
  const group = device.createBindGroup({
    layout: ctx.kernels.quantize.getBindGroupLayout(3),
    entries: [
      { binding: 0, resource: { buffer: jobs } },
      { binding: 1, resource: { buffer: out } },
      { binding: 2, resource: { buffer: params } },
    ],
  });
  for (let ty = 0; ty < tilesY; ty++) {
    const rowsHere = Math.min(tile, height - ty * tile);
    const band = new Uint8Array(width * rowsHere * 4);
    // Evicted tiles come back first (an export needs every one).
    if (Array.from({ length: tilesX }, (_, tx) => source.image.entry(0, tx, ty)).some((e) => e === PENDING)) {
      await source.ensureVisible({ zoom: 1, x: 0, y: ty * tile, width: width, height: 1 });
    }
    for (let tx0 = 0; tx0 < tilesX; tx0 += BATCH) {
      const batch = Array.from({ length: Math.min(BATCH, tilesX - tx0) }, (_, i) => tx0 + i);
      device.queue.writeBuffer(jobs, 0, new Uint32Array(batch.flatMap((tx) => [tx, ty])));
      const readback = device.createBuffer({ size: batch.length * tile * tile * 4, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
      const encoder = device.createCommandEncoder({ label: "quantize" });
      const pass = encoder.beginComputePass();
      pass.setPipeline(ctx.kernels.quantize);
      pass.setBindGroup(0, ctx.atlasBindGroup());
      pass.setBindGroup(1, ctx.imageBindGroup(source.image));
      pass.setBindGroup(2, ctx.imageBindGroup(paint?.image ?? ctx.emptyImage));
      pass.setBindGroup(3, group);
      pass.dispatchWorkgroups(tile / 16, tile / 16, batch.length);
      pass.end();
      encoder.copyBufferToBuffer(out, 0, readback, 0, batch.length * tile * tile * 4);
      device.queue.submit([encoder.finish()]);
      await readback.mapAsync(GPUMapMode.READ);
      const data = new Uint8Array(readback.getMappedRange());
      batch.forEach((tx, j) => {
        const w = Math.min(tile, width - tx * tile);
        for (let y = 0; y < rowsHere; y++) {
          const from = (j * tile * tile + y * tile) * 4;
          band.set(data.subarray(from, from + w * 4), (y * width + tx * tile) * 4);
        }
      });
      readback.unmap();
      readback.destroy();
    }
    await onBand(ty * tile, band);
  }
  for (const resource of [params, jobs, out]) resource.destroy();
  return { width, height, ms: performance.now() - started };
}

/**
 * How far f16 storage moves a source's 8-bit samples: re-encodes level 0 in double precision and returns the
 * largest distance, in 8-bit steps, from the nearest level. Exact levels survive dithering while this is under
 * ½ − DITHER_8BIT.
 */
export function roundTripError(level0: Float32Array, encode: (r: number, g: number, b: number, a: number) => [number, number, number, number]): number {
  let worst = 0;
  for (let i = 0; i < level0.length; i += 4) {
    const e = encode(level0[i], level0[i + 1], level0[i + 2], level0[i + 3]);
    for (let c = 0; c < 4; c++) {
      const v = e[c] * 255;
      const d = Math.abs(v - Math.round(v));
      if (d > worst) worst = d;
    }
  }
  return worst;
}

