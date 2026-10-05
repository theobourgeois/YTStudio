/**
 * A source image on the GPU (docs/photo/architecture.md, "Sources"): its decoded tiles fetched from the server in
 * bands of tile rows (byte ranges of the tile-major file), converted to linear light by `convert`, and its levels
 * built by `reduce` as soon as a parent's children are all there. Level-0 tiles are evictable once their parent
 * is built and fetched again when the view needs them; levels above stay (they're a third of level 0).
 */
import { type SourceTransform, transferLut } from "@shared/photo/colour.ts";
import { type View, levelForScale, visibleTiles } from "@shared/photo/geometry.ts";
import type { SourceLayout } from "@shared/photo/lab.ts";
import { BATCH, type RenderContext } from "./context.ts";
import { PENDING, VirtualImage } from "./image.ts";

/** A band of tile rows fetched at once stays under this. */
const BAND_BYTES = 64 * 1024 ** 2;

export interface SourceUrls {
  raw: string;
  preview: string;
}

export interface LoadProgress {
  /** Level-0 tiles converted so far, of `total`. */
  converted: number;
  total: number;
  /** Bytes fetched. */
  bytes: number;
}

export class SourceImage {
  readonly image: VirtualImage;
  readonly id: number;
  preview: GPUTexture | null = null;
  /** Level-0 tiles fetched again after being evicted. */
  refetched = 0;
  private readonly raw: GPUBuffer;
  private readonly lut: GPUBuffer;
  private readonly params: GPUBuffer;
  private readonly jobs: GPUBuffer;
  private readonly convertGroup: GPUBindGroup;
  private readonly reduceJobs: GPUBuffer;
  private readonly reduceGroup: GPUBindGroup;
  private readonly fetching = new Set<string>();
  private readonly stopListening: () => void;
  private destroyed = false;

  constructor(
    readonly ctx: RenderContext,
    readonly layout: SourceLayout,
    readonly transform: SourceTransform,
    readonly urls: SourceUrls,
  ) {
    const { device } = ctx;
    if (layout.tile !== ctx.tile) throw new Error(`The layout's tiles are ${layout.tile}, the renderer's ${ctx.tile}`);
    this.id = ctx.id();
    this.image = new VirtualImage(device, layout, layout.tile, [0, 0, 0, 0], true, PENDING, `source ${this.id}`);
    const bandRows = Math.max(1, Math.floor(BAND_BYTES / (layout.tilesX * layout.tileBytes)));
    this.raw = device.createBuffer({ label: "source band", size: bandRows * layout.tilesX * layout.tileBytes, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
    const n = 2 ** layout.bits;
    this.lut = device.createBuffer({ label: "transfer lut", size: 3 * n * 4, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
    const curves = transform.kind === "matrix" ? transform.curves : (["srgb", "srgb", "srgb"] as const);
    curves.forEach((curve, c) => device.queue.writeBuffer(this.lut, c * n * 4, transferLut(curve, layout.bits)));
    this.params = device.createBuffer({ size: 64, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    const params = new ArrayBuffer(64);
    new Uint32Array(params, 0, 4).set([layout.bits, transform.kind === "matrix" ? 0 : 1, layout.tile, 0]);
    if (transform.kind === "matrix") {
      const m = transform.matrix;
      new Float32Array(params, 16, 12).set([m[0], m[1], m[2], 0, m[3], m[4], m[5], 0, m[6], m[7], m[8], 0]);
    }
    device.queue.writeBuffer(this.params, 0, params);
    this.jobs = device.createBuffer({ size: BATCH * 4, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
    this.convertGroup = device.createBindGroup({
      layout: ctx.kernels.convert.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.raw } },
        { binding: 1, resource: { buffer: this.lut } },
        { binding: 2, resource: { buffer: this.params } },
        { binding: 3, resource: { buffer: this.jobs } },
        { binding: 4, resource: ctx.scratchView },
      ],
    });
    this.reduceJobs = device.createBuffer({ size: BATCH * 16, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
    this.reduceGroup = device.createBindGroup({
      layout: ctx.kernels.reduce.getBindGroupLayout(2),
      entries: [
        { binding: 0, resource: { buffer: this.reduceJobs } },
        { binding: 1, resource: ctx.scratchView },
      ],
    });
    // A level-0 tile whose slot is taken for something else is fetched again when it's next needed.
    this.stopListening = ctx.atlas.onEvict((key) => {
      const tile = this.parseKey(key);
      if (tile) this.image.set(tile.level, tile.tx, tile.ty, PENDING);
    });
  }

  private key(level: number, tx: number, ty: number) {
    return `s${this.id}:${level}:${tx}:${ty}`;
  }

  private parseKey(key: string) {
    const m = /^s(\d+):(\d+):(\d+):(\d+)$/.exec(key);
    return m && Number(m[1]) === this.id ? { level: Number(m[2]), tx: Number(m[3]), ty: Number(m[4]) } : null;
  }

  /** The coarse sRGB picture the view shows until tiles arrive. */
  async loadPreview(signal?: AbortSignal) {
    const res = await fetch(this.urls.preview, { signal });
    if (!res.ok) throw new Error(`Couldn't fetch the preview (${res.status})`);
    const bytes = new Uint8Array(await res.arrayBuffer());
    const { width, height } = this.layout.preview;
    const texture = this.ctx.device.createTexture({
      label: "preview",
      size: [width, height],
      format: "rgba8unorm-srgb",
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
    });
    this.ctx.device.queue.writeTexture({ texture }, bytes, { bytesPerRow: width * 4 }, [width, height]);
    this.preview = texture;
  }

  /** Fetches and converts every level-0 tile, building the levels as it goes. */
  async loadAll(onProgress?: (progress: LoadProgress) => void, signal?: AbortSignal) {
    const { tilesX, tilesY, tileBytes } = this.layout;
    const bandRows = Math.max(1, Math.floor(this.raw.size / (tilesX * tileBytes)));
    const total = tilesX * tilesY;
    let converted = 0;
    let bytes = 0;
    // Fetch the next band while this one converts.
    const fetchBand = (row: number) => {
      const rows = Math.min(bandRows, tilesY - row);
      return this.fetchRange(row * tilesX * tileBytes, rows * tilesX * tileBytes, signal);
    };
    let next = fetchBand(0);
    for (let row = 0; row < tilesY; row += bandRows) {
      const data = await next;
      if (this.destroyed) return;
      if (row + bandRows < tilesY) next = fetchBand(row + bandRows);
      bytes += data.byteLength;
      const rows = Math.min(bandRows, tilesY - row);
      const tiles: { tx: number; ty: number; offset: number }[] = [];
      for (let r = 0; r < rows; r++) for (let tx = 0; tx < tilesX; tx++) tiles.push({ tx, ty: row + r, offset: (r * tilesX + tx) * tileBytes });
      this.convertTiles(data, tiles, true);
      converted += tiles.length;
      this.buildLevels();
      onProgress?.({ converted, total, bytes });
    }
  }

  private async fetchRange(start: number, length: number, signal?: AbortSignal): Promise<ArrayBuffer> {
    const res = await fetch(this.urls.raw, { headers: { Range: `bytes=${start}-${start + length - 1}` }, signal });
    if (res.status !== 206 && res.status !== 200) throw new Error(`Couldn't fetch tiles (${res.status})`);
    const buffer = await res.arrayBuffer();
    // A server that ignores the range sends everything.
    return res.status === 200 ? buffer.slice(start, start + length) : buffer;
  }

  /** Converts level-0 tiles whose samples are at `offset` in `data` into atlas slots. */
  private convertTiles(data: ArrayBuffer, tiles: readonly { tx: number; ty: number; offset: number }[], pin: boolean) {
    const { device } = this.ctx;
    device.queue.writeBuffer(this.raw, 0, data);
    const tile = this.layout.tile;
    for (let i = 0; i < tiles.length; i += BATCH) {
      const batch = tiles.slice(i, i + BATCH);
      device.queue.writeBuffer(this.jobs, 0, new Uint32Array(batch.map((t) => t.offset / 4)));
      const slots = batch.map((t) => this.ctx.atlas.acquire(this.key(0, t.tx, t.ty), pin));
      const encoder = device.createCommandEncoder({ label: "convert" });
      const pass = encoder.beginComputePass();
      pass.setPipeline(this.ctx.kernels.convert);
      pass.setBindGroup(0, this.convertGroup);
      pass.dispatchWorkgroups(tile / 16, tile / 16, batch.length);
      pass.end();
      this.ctx.copyScratchToSlots(encoder, slots);
      device.queue.submit([encoder.finish()]);
      batch.forEach((t, j) => this.image.setSlot(0, t.tx, t.ty, slots[j]));
    }
    this.image.flush();
  }

  /**
   * Builds every parent tile whose children are all there, level by level. Children at level 0 are pinned
   * until their parent exists (then they may be evicted); levels above are always kept.
   */
  buildLevels() {
    const { atlas, device } = this.ctx;
    for (let level = 1; level < this.image.levels.length; level++) {
      const below = this.image.levels[level - 1];
      const here = this.image.levels[level];
      const ready: { tx: number; ty: number }[] = [];
      for (let ty = 0; ty < here.tilesY; ty++) {
        for (let tx = 0; tx < here.tilesX; tx++) {
          if (this.image.entry(level, tx, ty) !== PENDING) continue;
          let complete = true;
          for (let cy = 2 * ty; cy < Math.min(2 * ty + 2, below.tilesY) && complete; cy++) {
            for (let cx = 2 * tx; cx < Math.min(2 * tx + 2, below.tilesX); cx++) {
              if (this.image.slotOf(level - 1, cx, cy) === null) {
                complete = false;
                break;
              }
            }
          }
          if (complete) ready.push({ tx, ty });
        }
      }
      for (let i = 0; i < ready.length; i += BATCH) {
        const batch = ready.slice(i, i + BATCH);
        device.queue.writeBuffer(this.reduceJobs, 0, new Uint32Array(batch.flatMap((t) => [t.tx, t.ty, level, 0])));
        const slots = batch.map((t) => atlas.acquire(this.key(level, t.tx, t.ty), true));
        const encoder = device.createCommandEncoder({ label: "reduce" });
        const pass = encoder.beginComputePass();
        pass.setPipeline(this.ctx.kernels.reduce);
        pass.setBindGroup(0, this.ctx.atlasBindGroup());
        pass.setBindGroup(1, this.ctx.imageBindGroup(this.image));
        pass.setBindGroup(2, this.reduceGroup);
        pass.dispatchWorkgroups(this.layout.tile / 16, this.layout.tile / 16, batch.length);
        pass.end();
        this.ctx.copyScratchToSlots(encoder, slots);
        device.queue.submit([encoder.finish()]);
        batch.forEach((t, j) => this.image.setSlot(level, t.tx, t.ty, slots[j]));
        this.image.flush();
        // Their level-0 children may go now.
        if (level === 1) {
          for (const t of batch) {
            for (let cy = 2 * t.ty; cy < Math.min(2 * t.ty + 2, below.tilesY); cy++) {
              for (let cx = 2 * t.tx; cx < Math.min(2 * t.tx + 2, below.tilesX); cx++) {
                const slot = this.image.slotOf(0, cx, cy);
                if (slot !== null) atlas.unpin(slot);
              }
            }
          }
        }
      }
    }
  }

  /** Whether every tile the view needs at its own level is resident (so what it shows is final). */
  settled(view: View): boolean {
    const level = levelForScale(view.zoom, this.image.levels.length);
    return visibleTiles(view, this.layout, level, this.layout.tile).every(({ tx, ty }) => this.image.slotOf(level, tx, ty) !== null);
  }

  /**
   * Fetches the level-0 tiles the view needs that were evicted (levels above are always resident). Resolves
   * once they're converted; the view shows a coarser level meanwhile.
   */
  async ensureVisible(view: View): Promise<number> {
    if (levelForScale(view.zoom, this.image.levels.length) !== 0) return 0;
    const missing = visibleTiles(view, this.layout, 0, this.layout.tile, 1).filter(
      ({ tx, ty }) => this.image.entry(0, tx, ty) === PENDING && !this.fetching.has(`${tx},${ty}`),
    );
    if (!missing.length) return 0;
    for (const t of missing) this.fetching.add(`${t.tx},${t.ty}`);
    try {
      const { tilesX, tileBytes } = this.layout;
      // Tiles next to each other in a row are one range.
      const runs: { tx: number; ty: number; count: number }[] = [];
      for (const t of missing.sort((a, b) => a.ty - b.ty || a.tx - b.tx)) {
        const last = runs.at(-1);
        if (last && last.ty === t.ty && last.tx + last.count === t.tx) last.count++;
        else runs.push({ tx: t.tx, ty: t.ty, count: 1 });
      }
      const fetched = await Promise.all(runs.map((r) => this.fetchRange((r.ty * tilesX + r.tx) * tileBytes, r.count * tileBytes)));
      if (this.destroyed) return 0;
      const capacity = Math.floor(this.raw.size / tileBytes);
      let tiles: { tx: number; ty: number; offset: number }[] = [];
      let parts: ArrayBuffer[] = [];
      const flush = () => {
        if (!tiles.length) return;
        const joined = new Uint8Array(tiles.length * tileBytes);
        let at = 0;
        for (const part of parts) {
          joined.set(new Uint8Array(part), at);
          at += part.byteLength;
        }
        this.convertTiles(joined.buffer, tiles, false);
        tiles = [];
        parts = [];
      };
      runs.forEach((run, i) => {
        for (let k = 0; k < run.count; k++) {
          if (tiles.length === capacity) flush();
          tiles.push({ tx: run.tx + k, ty: run.ty, offset: tiles.length * tileBytes });
          parts.push(fetched[i].slice(k * tileBytes, (k + 1) * tileBytes));
        }
      });
      flush();
      this.refetched += missing.length;
      return missing.length;
    } finally {
      for (const t of missing) this.fetching.delete(`${t.tx},${t.ty}`);
    }
  }

  destroy() {
    this.destroyed = true;
    this.stopListening();
    this.image.destroy();
    this.raw.destroy();
    this.lut.destroy();
    this.params.destroy();
    this.jobs.destroy();
    this.reduceJobs.destroy();
    this.preview?.destroy();
  }
}
