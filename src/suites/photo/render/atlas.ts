/**
 * The GPU tile cache (docs/photo/rendering.md, "Tiles, levels and memory"): tiles live as layers of a few array
 * textures, each tile a *slot*, found by a key (a source tile, a stored tile's hash, a draft). Slots are reused
 * least-recently-used first, within a byte budget, never while pinned. Kernels read slots through `loadSlot` in
 * WGSL (wgsl.ts) and write them by copying from a scratch texture, so no pass reads and writes one texture.
 */
import type { TileSize } from "@shared/photo/lab.ts";

export type AtlasFormat = "rgba16float" | "rgba32float";

/** Bytes per sample texel of each format. */
const TEXEL_BYTES: Record<AtlasFormat, number> = { rgba16float: 8, rgba32float: 16 };
/** Bindings the kernels declare for arrays (wgsl.ts): the most arrays an atlas can have. */
export const MAX_ARRAYS = 8;
/** Each array texture stays under this, so no single allocation is huge. */
const ARRAY_BYTES = 512 * 1024 ** 2;

export class AtlasFullError extends Error {}

export class TileAtlas {
  readonly tileBytes: number;
  readonly perArray: number;
  readonly capacity: number;
  private readonly arrays: GPUTexture[] = [];
  private readonly keys: (string | null)[];
  private readonly slots = new Map<string, number>();
  private readonly pinned = new Set<number>();
  private readonly free: number[] = [];
  /** Slots in least-recently-used order (a Map keeps insertion order; touching re-inserts). */
  private readonly lru = new Map<number, true>();
  /** Slots reused for another key since the atlas was made. */
  evictions = 0;
  private readonly evicted = new Set<(key: string, slot: number) => void>();
  private readonly views: GPUTextureView[] = [];
  private placeholder: GPUTexture | null = null;

  constructor(
    readonly device: GPUDevice,
    readonly format: AtlasFormat,
    readonly tile: TileSize,
    budgetBytes: number,
  ) {
    this.tileBytes = tile * tile * TEXEL_BYTES[format];
    this.perArray = Math.max(1, Math.min(device.limits.maxTextureArrayLayers, Math.floor(ARRAY_BYTES / this.tileBytes)));
    this.capacity = Math.min(MAX_ARRAYS * this.perArray, Math.floor(budgetBytes / this.tileBytes));
    if (this.capacity < 16) throw new AtlasFullError(`A budget of ${Math.round(budgetBytes / 1024 ** 2)} MB holds fewer than 16 tiles.`);
    this.keys = new Array(this.capacity).fill(null);
    for (let s = this.capacity - 1; s >= 0; s--) this.free.push(s);
  }

  /** Bytes of GPU memory the arrays made so far take. */
  get allocatedBytes() {
    return this.arrays.reduce((sum, t) => sum + t.depthOrArrayLayers * this.tileBytes, 0);
  }

  get used() {
    return this.slots.size;
  }

  /** Called with each key whose slot is taken for another (so page tables forget it). */
  onEvict(listener: (key: string, slot: number) => void): () => void {
    this.evicted.add(listener);
    return () => this.evicted.delete(listener);
  }

  /** The slot holding `key`, marked as just used; null when it isn't here. */
  get(key: string): number | null {
    const slot = this.slots.get(key);
    if (slot === undefined) return null;
    this.touch(slot);
    return slot;
  }

  has(key: string) {
    return this.slots.has(key);
  }

  private touch(slot: number) {
    this.lru.delete(slot);
    this.lru.set(slot, true);
  }

  /** A slot for `key` (its own if it has one), evicting the least recently used unpinned slot when full. */
  acquire(key: string, pin = false): number {
    let slot = this.slots.get(key);
    if (slot === undefined) {
      slot = this.free.pop() ?? this.evictOne();
      this.ensureArray(Math.floor(slot / this.perArray));
      this.keys[slot] = key;
      this.slots.set(key, slot);
    }
    if (pin) this.pinned.add(slot);
    this.touch(slot);
    return slot;
  }

  /** Gives `slot` a new key (a draft becoming a stored tile), keeping its pixels. */
  rename(slot: number, key: string) {
    const old = this.keys[slot];
    if (old === null) throw new Error(`Slot ${slot} is empty`);
    const other = this.slots.get(key);
    if (other !== undefined && other !== slot) this.release(other);
    this.slots.delete(old);
    this.keys[slot] = key;
    this.slots.set(key, slot);
  }

  pin(slot: number) {
    this.pinned.add(slot);
  }

  unpin(slot: number) {
    this.pinned.delete(slot);
  }

  /** Forgets `slot`'s key and frees it. */
  release(slot: number) {
    const key = this.keys[slot];
    if (key === null) return;
    this.slots.delete(key);
    this.keys[slot] = null;
    this.pinned.delete(slot);
    this.lru.delete(slot);
    this.free.push(slot);
  }

  private evictOne(): number {
    for (const slot of this.lru.keys()) {
      if (this.pinned.has(slot)) continue;
      const key = this.keys[slot]!;
      this.slots.delete(key);
      this.keys[slot] = null;
      this.lru.delete(slot);
      this.evictions++;
      for (const listener of this.evicted) listener(key, slot);
      return slot;
    }
    throw new AtlasFullError(`Every one of the ${this.capacity} tiles the budget allows is in use.`);
  }

  private ensureArray(index: number) {
    while (this.arrays.length <= index) {
      const remaining = this.capacity - this.arrays.length * this.perArray;
      const layers = Math.max(1, Math.min(this.perArray, remaining));
      const texture = this.device.createTexture({
        label: `atlas ${this.format} ${this.arrays.length}`,
        size: [this.tile, this.tile, layers],
        format: this.format,
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.COPY_SRC,
      });
      this.arrays.push(texture);
      this.views.push(texture.createView({ dimension: "2d-array" }));
    }
  }

  /** Where a slot is: its array texture and layer. */
  location(slot: number): { texture: GPUTexture; layer: number } {
    const index = Math.floor(slot / this.perArray);
    this.ensureArray(index);
    return { texture: this.arrays[index], layer: slot % this.perArray };
  }

  /** Views for the kernels' `a0`..`a7` bindings (arrays not made yet are a placeholder). */
  bindingViews(): GPUTextureView[] {
    this.ensureArray(0);
    this.placeholder ??= this.device.createTexture({ size: [1, 1, 1], format: this.format, usage: GPUTextureUsage.TEXTURE_BINDING });
    const placeholder = this.placeholder.createView({ dimension: "2d-array" });
    return Array.from({ length: MAX_ARRAYS }, (_, i) => this.views[i] ?? placeholder);
  }

  /** How many arrays exist (bind groups made before a new one appears must be made again). */
  get arrayCount() {
    return this.arrays.length;
  }

  destroy() {
    for (const texture of this.arrays) texture.destroy();
    this.placeholder?.destroy();
  }
}
