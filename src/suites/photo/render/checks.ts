/**
 * F0's GPU checks (docs/photo/foundations-prototype.md): reading level-0 pixels back, the tiled blur against the
 * same blur on one plain texture, and the export path (quantise every tile with the output transform, then let the
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

export interface BlurComparison {
  width: number;
  height: number;
  /** Largest difference between the tiled and the monolithic blur, any channel. */
  maxDifference: number;
  /** Largest difference along the tile boundaries (where seams would be). */
  maxAtSeams: number;
  tiledMs: number;
  monoMs: number;
}

/** Blurs level 0 of `source` tile by tile through its page table, and as one texture, and compares them. */
export async function compareBlur(ctx: RenderContext, source: SourceImage, sigma: number): Promise<BlurComparison> {
  const { device } = ctx;
  const { width, height, tilesX, tilesY } = source.image.levels[0];
  if (ctx.format !== "rgba16float") throw new Error("The blur check runs on rgba16float atlases.");
  const radius = Math.ceil(3 * sigma);
  const params = device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  const p = new ArrayBuffer(16);
  new Float32Array(p, 0, 1)[0] = sigma;
  new Int32Array(p, 4, 1)[0] = radius;
  new Uint32Array(p, 8, 1)[0] = ctx.tile;
  device.queue.writeBuffer(params, 0, p);

  // Tiled: every level-0 tile, reading its neighbours through the page table.
  const blurred = new VirtualImage(device, source.layout, ctx.tile, [0, 0, 0, 0], false, PENDING, "blurred");
  const jobs = device.createBuffer({ size: BATCH * 16, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
  const group = device.createBindGroup({
    layout: ctx.kernels.blurTiled.getBindGroupLayout(2),
    entries: [
      { binding: 0, resource: { buffer: jobs } },
      { binding: 1, resource: ctx.scratchView },
      { binding: 2, resource: { buffer: params } },
    ],
  });
  const tiles: { tx: number; ty: number }[] = [];
  for (let ty = 0; ty < tilesY; ty++) for (let tx = 0; tx < tilesX; tx++) tiles.push({ tx, ty });
  const tiledStart = performance.now();
  for (let i = 0; i < tiles.length; i += BATCH) {
    const batch = tiles.slice(i, i + BATCH);
    device.queue.writeBuffer(jobs, 0, new Uint32Array(batch.flatMap((t) => [t.tx, t.ty, 0, 0])));
    const slots = batch.map((t) => ctx.atlas.acquire(`blur${blurred.size.width}:${ctx.id()}:${t.tx}:${t.ty}`, true));
    const encoder = device.createCommandEncoder({ label: "blur tiled" });
    const pass = encoder.beginComputePass();
    pass.setPipeline(ctx.kernels.blurTiled);
    pass.setBindGroup(0, ctx.atlasBindGroup());
    pass.setBindGroup(1, ctx.imageBindGroup(source.image));
    pass.setBindGroup(2, group);
    pass.dispatchWorkgroups(ctx.tile / 16, ctx.tile / 16, batch.length);
    pass.end();
    ctx.copyScratchToSlots(encoder, slots);
    device.queue.submit([encoder.finish()]);
    batch.forEach((t, j) => blurred.setSlot(0, t.tx, t.ty, slots[j]));
  }
  blurred.flush();
  await device.queue.onSubmittedWorkDone();
  const tiledMs = performance.now() - tiledStart;
  const tiled = await readLevel0(ctx, blurred);

  // Monolithic: the same source pixels in one texture, blurred by the same arithmetic.
  const input = device.createTexture({ size: [width, height], format: "rgba16float", usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
  const output = device.createTexture({ size: [width, height], format: "rgba16float", usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.COPY_SRC });
  const encoder = device.createCommandEncoder({ label: "blur mono" });
  for (let ty = 0; ty < tilesY; ty++) {
    for (let tx = 0; tx < tilesX; tx++) {
      const slot = source.image.slotOf(0, tx, ty);
      if (slot === null) throw new Error("The source isn't fully loaded.");
      const { texture, layer } = ctx.atlas.location(slot);
      const w = Math.min(ctx.tile, width - tx * ctx.tile);
      const h = Math.min(ctx.tile, height - ty * ctx.tile);
      encoder.copyTextureToTexture({ texture, origin: [0, 0, layer] }, { texture: input, origin: [tx * ctx.tile, ty * ctx.tile] }, [w, h, 1]);
    }
  }
  const monoGroup = device.createBindGroup({
    layout: ctx.kernels.blurMono.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: input.createView() },
      { binding: 1, resource: output.createView() },
      { binding: 2, resource: { buffer: params } },
    ],
  });
  const monoStart = performance.now();
  const pass = encoder.beginComputePass();
  pass.setPipeline(ctx.kernels.blurMono);
  pass.setBindGroup(0, monoGroup);
  pass.dispatchWorkgroups(Math.ceil(width / 16), Math.ceil(height / 16));
  pass.end();
  const rowBytes = Math.ceil((width * 8) / 256) * 256;
  const readback = device.createBuffer({ size: rowBytes * height, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
  encoder.copyTextureToBuffer({ texture: output }, { buffer: readback, bytesPerRow: rowBytes }, [width, height]);
  device.queue.submit([encoder.finish()]);
  await readback.mapAsync(GPUMapMode.READ);
  const monoMs = performance.now() - monoStart;
  const mono = new Uint16Array(readback.getMappedRange());
  let maxDifference = 0;
  let maxAtSeams = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const seam = x % ctx.tile <= 1 || x % ctx.tile >= ctx.tile - 2 || y % ctx.tile <= 1 || y % ctx.tile >= ctx.tile - 2;
      for (let c = 0; c < 4; c++) {
        const d = Math.abs(tiled[(y * width + x) * 4 + c] - fromHalf(mono[(y * rowBytes) / 2 + x * 4 + c]));
        if (d > maxDifference) maxDifference = d;
        if (seam && d > maxAtSeams) maxAtSeams = d;
      }
    }
  }
  readback.unmap();
  for (const t of tiles) {
    const slot = blurred.slotOf(0, t.tx, t.ty);
    if (slot !== null) ctx.atlas.release(slot);
  }
  for (const resource of [readback, params, jobs]) resource.destroy();
  input.destroy();
  output.destroy();
  blurred.destroy();
  return { width, height, maxDifference, maxAtSeams, tiledMs, monoMs };
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

