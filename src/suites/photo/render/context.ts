/**
 * What every part of the renderer shares for one device: the atlas, the kernels, a scratch texture kernels write
 * into before their results are copied into slots, and bind groups for the atlas.
 */
import { toHalf } from "@shared/photo/half.ts";
import type { TileSize } from "@shared/photo/lab.ts";
import { type AtlasFormat, TileAtlas } from "./atlas.ts";
import type { Gpu } from "./gpu.ts";
import { VirtualImage } from "./image.ts";
import { Kernels } from "./kernels.ts";

/** Tiles one dispatch handles (the scratch texture's layers). */
export const BATCH = 64;

export class RenderContext {
  /** A context whose kernels have compiled. */
  static async create(gpu: Gpu, format: AtlasFormat, tile: TileSize, budgetBytes: number): Promise<RenderContext> {
    const ctx = new RenderContext(gpu, format, tile, budgetBytes);
    await ctx.kernels.ready;
    return ctx;
  }

  readonly device: GPUDevice;
  readonly atlas: TileAtlas;
  readonly kernels: Kernels;
  readonly scratch: GPUTexture;
  readonly scratchView: GPUTextureView;
  private readonly atlasInfo: GPUBuffer;
  private atlasGroup: { arrays: number; group: GPUBindGroup } | null = null;
  /** An image with nothing in it, for kernels that take an optional second image. */
  readonly emptyImage: VirtualImage;
  private nextId = 1;

  constructor(
    readonly gpu: Gpu,
    readonly format: AtlasFormat,
    readonly tile: TileSize,
    budgetBytes: number,
  ) {
    this.device = gpu.device;
    this.atlas = new TileAtlas(this.device, format, tile, budgetBytes);
    this.kernels = new Kernels(this.device, format, gpu.canvasFormat);
    this.scratch = this.device.createTexture({
      label: "scratch",
      size: [tile, tile, BATCH],
      format,
      usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.COPY_SRC,
    });
    this.scratchView = this.scratch.createView({ dimension: "2d-array" });
    this.atlasInfo = this.device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    this.device.queue.writeBuffer(this.atlasInfo, 0, new Uint32Array([this.atlas.perArray, tile, 0, 0]));
    this.emptyImage = new VirtualImage(this.device, { width: 1, height: 1 }, tile, [0, 0, 0, 0], false, 0, "empty");
  }

  /** A number for keys and labels, unique within this context. */
  id() {
    return this.nextId++;
  }

  /** The atlas's bind group (group 0), made again when the atlas has grown another array. */
  atlasBindGroup(): GPUBindGroup {
    const views = this.atlas.bindingViews();
    if (this.atlasGroup?.arrays !== this.atlas.arrayCount) {
      this.atlasGroup = {
        arrays: this.atlas.arrayCount,
        group: this.device.createBindGroup({
          layout: this.kernels.atlasLayout,
          entries: [...views.map((resource, binding) => ({ binding, resource })), { binding: views.length, resource: { buffer: this.atlasInfo } }],
        }),
      };
    }
    return this.atlasGroup.group;
  }

  imageBindGroup(image: VirtualImage): GPUBindGroup {
    return this.device.createBindGroup({
      layout: this.kernels.imageLayout,
      entries: [
        { binding: 0, resource: { buffer: image.info } },
        { binding: 1, resource: { buffer: image.pages } },
      ],
    });
  }

  /** Copies scratch layers 0..n-1 into these slots. */
  copyScratchToSlots(encoder: GPUCommandEncoder, slots: readonly number[]) {
    slots.forEach((slot, layer) => {
      const to = this.atlas.location(slot);
      encoder.copyTextureToTexture(
        { texture: this.scratch, origin: [0, 0, layer] },
        { texture: to.texture, origin: [0, 0, to.layer] },
        [this.tile, this.tile, 1],
      );
    });
  }

  copySlot(encoder: GPUCommandEncoder, from: number, to: number) {
    const a = this.atlas.location(from);
    const b = this.atlas.location(to);
    encoder.copyTextureToTexture({ texture: a.texture, origin: [0, 0, a.layer] }, { texture: b.texture, origin: [0, 0, b.layer] }, [this.tile, this.tile, 1]);
  }

  /** Writes one value into every texel of a slot (constant tiles, empty drafts). */
  fillSlot(slot: number, value: readonly number[]) {
    const { texture, layer } = this.atlas.location(slot);
    const texels = this.tile * this.tile;
    const data = this.format === "rgba16float" ? new Uint16Array(texels * 4) : new Float32Array(texels * 4);
    const encoded = this.format === "rgba16float" ? value.map(toHalf) : value;
    for (let i = 0; i < texels; i++) data.set(encoded, i * 4);
    this.device.queue.writeTexture({ texture, origin: [0, 0, layer] }, data, { bytesPerRow: this.rowBytes }, [this.tile, this.tile, 1]);
  }

  /** Bytes per row of a slot. */
  get rowBytes() {
    return this.atlas.tileBytes / this.tile;
  }

  destroy() {
    this.atlas.destroy();
    this.scratch.destroy();
    this.atlasInfo.destroy();
    this.emptyImage.destroy();
  }
}
