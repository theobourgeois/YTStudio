/**
 * A virtual image on the GPU: its levels' sizes and a page table saying, for each tile of each level, which atlas
 * slot holds it. Kernels read any pixel of it through `texel{I}` (wgsl.ts), crossing tile boundaries freely, so
 * nothing tiled needs a seam rule of its own. Entry values: `FILL` (no tile: the image's fill value), `PENDING`
 * (a tile that exists but isn't resident yet: reads as transparent, and views fall back to a coarser level),
 * else slot + 1.
 */
import type { TileSize } from "@shared/photo/lab.ts";
import { type Size, levelCount, levelSize, tileGrid } from "@shared/photo/geometry.ts";

export const FILL = 0;
export const PENDING = 0xffffffff;
export const MAX_LEVELS = 16;
/** Bytes of the WGSL `Image` struct: fill (16), four u32 (16), 16 levels of eight u32 (512). */
const INFO_BYTES = 16 + 16 + MAX_LEVELS * 32;

export interface LevelInfo extends Size {
  tilesX: number;
  tilesY: number;
  offset: number;
}

export class VirtualImage {
  readonly levels: LevelInfo[];
  readonly info: GPUBuffer;
  readonly pages: GPUBuffer;
  private readonly table: Uint32Array;
  private dirtyFrom = Infinity;
  private dirtyTo = -1;

  constructor(
    readonly device: GPUDevice,
    readonly size: Size,
    readonly tile: TileSize,
    readonly fill: readonly [number, number, number, number],
    /** Only level 0 (paint surfaces in F0), or the whole pyramid. */
    pyramid: boolean,
    initial: number,
    label: string,
  ) {
    const count = pyramid ? Math.min(MAX_LEVELS, levelCount(size, tile)) : 1;
    let offset = 0;
    this.levels = Array.from({ length: count }, (_, level) => {
      const s = levelSize(size, level);
      const grid = tileGrid(s, tile);
      const info = { ...s, ...grid, offset };
      offset += grid.tilesX * grid.tilesY;
      return info;
    });
    this.table = new Uint32Array(offset).fill(initial);
    this.pages = device.createBuffer({ label: `${label} pages`, size: Math.max(16, offset * 4), usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
    device.queue.writeBuffer(this.pages, 0, this.table);
    this.info = device.createBuffer({ label: `${label} info`, size: INFO_BYTES, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
    const data = new ArrayBuffer(INFO_BYTES);
    new Float32Array(data, 0, 4).set(fill);
    new Uint32Array(data, 16, 4).set([size.width, size.height, count, tile]);
    const levels = new Uint32Array(data, 32, MAX_LEVELS * 8);
    this.levels.forEach((l, i) => levels.set([l.width, l.height, l.tilesX, l.tilesY, l.offset], i * 8));
    device.queue.writeBuffer(this.info, 0, data);
  }

  /** What a tile with no slot (FILL) reads as: a surface's fill changes with the manifest it shows. */
  setFill(fill: readonly [number, number, number, number]) {
    this.device.queue.writeBuffer(this.info, 0, new Float32Array(fill));
  }

  private index(level: number, tx: number, ty: number): number {
    const l = this.levels[level];
    if (tx < 0 || ty < 0 || tx >= l.tilesX || ty >= l.tilesY) return -1;
    return l.offset + ty * l.tilesX + tx;
  }

  entry(level: number, tx: number, ty: number): number {
    const i = this.index(level, tx, ty);
    return i < 0 ? FILL : this.table[i];
  }

  /** Points a tile at a slot (or FILL / PENDING); sent to the GPU on `flush`. */
  set(level: number, tx: number, ty: number, value: number) {
    const i = this.index(level, tx, ty);
    if (i < 0 || this.table[i] === value) return;
    this.table[i] = value;
    this.dirtyFrom = Math.min(this.dirtyFrom, i);
    this.dirtyTo = Math.max(this.dirtyTo, i);
  }

  setSlot(level: number, tx: number, ty: number, slot: number) {
    this.set(level, tx, ty, slot + 1);
  }

  /** The slot a tile is in, or null when it's FILL or PENDING. */
  slotOf(level: number, tx: number, ty: number): number | null {
    const e = this.entry(level, tx, ty);
    return e === FILL || e === PENDING ? null : e - 1;
  }

  /** Every tile entry that points at `slot` becomes PENDING (its slot was taken for something else). */
  forgetSlot(slot: number) {
    for (let i = 0; i < this.table.length; i++) {
      if (this.table[i] === slot + 1) {
        this.table[i] = PENDING;
        this.dirtyFrom = Math.min(this.dirtyFrom, i);
        this.dirtyTo = Math.max(this.dirtyTo, i);
      }
    }
  }

  flush() {
    if (this.dirtyTo < 0) return;
    this.device.queue.writeBuffer(this.pages, this.dirtyFrom * 4, this.table, this.dirtyFrom, this.dirtyTo - this.dirtyFrom + 1);
    this.dirtyFrom = Infinity;
    this.dirtyTo = -1;
  }

  destroy() {
    this.info.destroy();
    this.pages.destroy();
  }
}
