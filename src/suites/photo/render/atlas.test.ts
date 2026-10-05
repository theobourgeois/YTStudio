/** The tile atlas's bookkeeping (slots, pins, LRU eviction, the budget), on a stand-in device. */
import { describe, expect, it } from "vitest";
import { AtlasFullError, TileAtlas } from "./atlas.ts";

// WebGPU's flags, which Node doesn't have.
Object.assign(globalThis, { GPUTextureUsage: { COPY_SRC: 1, COPY_DST: 2, TEXTURE_BINDING: 4, STORAGE_BINDING: 8, RENDER_ATTACHMENT: 16 } });

/** Just what the atlas asks of a device. */
function fakeDevice(maxLayers = 2048) {
  const made: { layers: number }[] = [];
  const device = {
    limits: { maxTextureArrayLayers: maxLayers },
    createTexture: (d: { size: [number, number, number] }) => {
      const texture = { depthOrArrayLayers: d.size[2], createView: () => ({}), destroy: () => {} };
      made.push({ layers: d.size[2] });
      return texture;
    },
  };
  return { device: device as unknown as GPUDevice, made };
}

const MB = 1024 ** 2;

describe("the tile atlas", () => {
  it("sizes itself from the budget, in arrays of at most 512 MB, made as they're needed", () => {
    const { device, made } = fakeDevice();
    const atlas = new TileAtlas(device, "rgba16float", 256, 2048 * MB);
    expect(atlas.tileBytes).toBe(512 * 1024);
    expect(atlas.perArray).toBe(1024);
    expect(atlas.capacity).toBe(4096);
    expect(made).toEqual([]);
    atlas.acquire("a");
    expect(made).toEqual([{ layers: 1024 }]);
    expect(atlas.allocatedBytes).toBe(512 * MB);
    expect(new TileAtlas(device, "rgba32float", 512, 1024 * MB).capacity).toBe(256);
  });

  it("refuses a budget too small to be useful", () => {
    expect(() => new TileAtlas(fakeDevice().device, "rgba32float", 512, 32 * MB)).toThrow(AtlasFullError);
  });

  it("gives a key its slot back, and evicts the least recently used unpinned one when full", () => {
    const { device } = fakeDevice();
    const atlas = new TileAtlas(device, "rgba16float", 512, 32 * MB); // 16 tiles
    const evicted: string[] = [];
    atlas.onEvict((key) => evicted.push(key));
    const slots = Array.from({ length: 16 }, (_, i) => atlas.acquire(`t${i}`, i < 2));
    expect(new Set(slots).size).toBe(16);
    expect(atlas.acquire("t5")).toBe(slots[5]);
    atlas.get("t2"); // used: no longer the oldest unpinned
    atlas.acquire("new");
    expect(evicted).toEqual(["t3"]); // t0, t1 pinned; t2 touched
    expect(atlas.has("t3")).toBe(false);
    expect(atlas.get("new")).toBe(slots[3]);
  });

  it("never evicts pinned slots, and says so when nothing can go", () => {
    const atlas = new TileAtlas(fakeDevice().device, "rgba16float", 512, 32 * MB);
    for (let i = 0; i < 16; i++) atlas.acquire(`t${i}`, true);
    expect(() => atlas.acquire("one more")).toThrow(AtlasFullError);
    atlas.unpin(atlas.get("t7")!);
    expect(() => atlas.acquire("one more")).not.toThrow();
    expect(atlas.has("t7")).toBe(false);
  });

  it("renames a slot (a draft becoming a stored tile) and frees released ones", () => {
    const atlas = new TileAtlas(fakeDevice().device, "rgba16float", 512, 32 * MB);
    const draft = atlas.acquire("draft", true);
    atlas.rename(draft, "hash");
    expect(atlas.get("hash")).toBe(draft);
    expect(atlas.has("draft")).toBe(false);
    atlas.release(draft);
    expect(atlas.used).toBe(0);
    expect(atlas.acquire("again")).toBe(draft);
  });

  it("finds a slot's array and layer", () => {
    const atlas = new TileAtlas(fakeDevice(4).device, "rgba16float", 512, 64 * MB); // 4 layers an array, 32 tiles
    expect(atlas.perArray).toBe(4);
    expect(atlas.location(9).layer).toBe(1);
    expect(atlas.arrayCount).toBe(3);
  });
});
