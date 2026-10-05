/**
 * Draws the canvas (docs/photo/rendering.md, "The output transform"): the source through its page table at the
 * view's level (or a coarser resident one, then the preview, while tiles arrive), paint over it, the
 * checkerboard under transparency, encoded and dithered into the canvas. Bilinear while the view moves,
 * Mitchell once it settles. Each frame reports its CPU time and when the GPU finished it.
 */
import { DITHER_8BIT } from "@shared/photo/output.ts";
import { type View, levelForScale } from "@shared/photo/geometry.ts";
import type { RenderContext } from "./context.ts";
import type { PaintSurface } from "./paint.ts";
import type { SourceImage } from "./source.ts";

export type Quality = "interactive" | "final";

export interface FrameTiming {
  /** Encoding and submitting, on the main thread. */
  cpuMs: number;
  /** Submit → the GPU finished the frame. */
  gpuMs: Promise<number>;
}

export class ViewRenderer {
  readonly context: GPUCanvasContext;
  private readonly uniform: GPUBuffer;
  private readonly sampler: GPUSampler;
  private readonly blank: GPUTexture;
  private viewGroup: { preview: GPUTexture | null; group: GPUBindGroup } | null = null;

  constructor(
    readonly ctx: RenderContext,
    readonly canvas: HTMLCanvasElement | OffscreenCanvas,
  ) {
    const context = canvas.getContext("webgpu") as GPUCanvasContext | null;
    if (!context) throw new Error("This canvas has no WebGPU context.");
    this.context = context;
    this.context.configure({ device: ctx.device, format: ctx.gpu.canvasFormat, alphaMode: "opaque" });
    this.uniform = ctx.device.createBuffer({ size: 48, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    this.sampler = ctx.device.createSampler({ magFilter: "linear", minFilter: "linear" });
    this.blank = ctx.device.createTexture({ size: [1, 1], format: "rgba8unorm-srgb", usage: GPUTextureUsage.TEXTURE_BINDING });
  }

  private group(source: SourceImage | null) {
    const preview = source?.preview ?? null;
    if (this.viewGroup?.preview !== preview) {
      this.viewGroup = {
        preview,
        group: this.ctx.device.createBindGroup({
          layout: this.ctx.kernels.view.getBindGroupLayout(3),
          entries: [
            { binding: 0, resource: { buffer: this.uniform } },
            { binding: 1, resource: (preview ?? this.blank).createView() },
            { binding: 2, resource: this.sampler },
          ],
        }),
      };
    }
    return this.viewGroup.group;
  }

  /** Draws one frame of `view` (device pixels; the canvas must already be that size). */
  draw(view: View, source: SourceImage | null, paint: PaintSurface | null, quality: Quality, checker = 8): FrameTiming {
    const started = performance.now();
    const { device } = this.ctx;
    source?.image.flush();
    paint?.image.flush();
    const data = new ArrayBuffer(48);
    const f = new Float32Array(data);
    const u = new Uint32Array(data);
    f[0] = view.x;
    f[1] = view.y;
    f[2] = view.zoom;
    u[3] = source ? levelForScale(view.zoom, source.image.levels.length) : 0;
    u[4] = quality === "final" ? 1 : 0;
    u[5] = paint ? 1 : 0;
    u[6] = source ? 1 : 0;
    f[7] = checker;
    f[8] = DITHER_8BIT;
    u[9] = source?.preview ? 1 : 0;
    device.queue.writeBuffer(this.uniform, 0, data);
    const encoder = device.createCommandEncoder({ label: "view" });
    const pass = encoder.beginRenderPass({
      colorAttachments: [{ view: this.context.getCurrentTexture().createView(), loadOp: "clear", storeOp: "store", clearValue: [0, 0, 0, 1] }],
    });
    pass.setPipeline(this.ctx.kernels.view);
    pass.setBindGroup(0, this.ctx.atlasBindGroup());
    pass.setBindGroup(1, this.ctx.imageBindGroup(source?.image ?? this.ctx.emptyImage));
    pass.setBindGroup(2, this.ctx.imageBindGroup(paint?.image ?? this.ctx.emptyImage));
    pass.setBindGroup(3, this.group(source));
    pass.draw(3);
    pass.end();
    device.queue.submit([encoder.finish()]);
    const cpuMs = performance.now() - started;
    return { cpuMs, gpuMs: device.queue.onSubmittedWorkDone().then(() => performance.now() - started) };
  }

  destroy() {
    this.uniform.destroy();
    this.blank.destroy();
    this.context.unconfigure();
  }
}
