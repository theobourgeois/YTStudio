/**
 * The photo renderer's GPU device (docs/photo/architecture.md, "Where the work happens"). The device asks for the
 * adapter's own limits (a plain `requestDevice()` gets the spec's defaults: 8192-pixel textures, 256 MiB
 * buffers) and the optional features the kernels use. A lost device is replaced from a *new* adapter.
 */

/** Why the photo workspace can't run here, said so a person can act on it. */
export class GpuUnavailableError extends Error {}

export interface Gpu {
  device: GPUDevice;
  adapter: { vendor: string; architecture: string; fallback: boolean };
  /** The canvas format the system prefers (`bgra8unorm` on macOS). */
  canvasFormat: GPUTextureFormat;
  /** Resolves when the device is lost: destroyed by us, or the GPU process went away. */
  lost: Promise<GPUDeviceLostInfo>;
  /** Uncaptured validation and out-of-memory errors, newest last (shown in the lab, asserted on by checks). */
  errors: string[];
}

const LIMITS = ["maxTextureDimension2D", "maxTextureArrayLayers", "maxBufferSize", "maxStorageBufferBindingSize", "maxComputeWorkgroupsPerDimension"] as const;

export async function createGpu(): Promise<Gpu> {
  if (!("gpu" in navigator) || !navigator.gpu) {
    throw new GpuUnavailableError(
      isSecureContext ? "This browser has no WebGPU: use Chrome or the desktop app." : "WebGPU needs a secure page (localhost or https).",
    );
  }
  const adapter = await navigator.gpu.requestAdapter({ powerPreference: "high-performance" });
  if (!adapter) throw new GpuUnavailableError("No GPU adapter: WebGPU is turned off or the GPU is blocked.");
  const requiredLimits: Record<string, number> = {};
  for (const name of LIMITS) requiredLimits[name] = adapter.limits[name];
  const requiredFeatures: GPUFeatureName[] = [];
  for (const feature of ["timestamp-query"] as GPUFeatureName[]) if (adapter.features.has(feature)) requiredFeatures.push(feature);
  const device = await adapter.requestDevice({ requiredLimits, requiredFeatures });
  const errors: string[] = [];
  device.addEventListener("uncapturederror", (event) => {
    errors.push((event as GPUUncapturedErrorEvent).error.message);
    if (errors.length > 50) errors.shift();
  });
  const info = adapter.info;
  return {
    device,
    adapter: { vendor: info.vendor, architecture: info.architecture, fallback: Boolean((info as GPUAdapterInfo & { isFallbackAdapter?: boolean }).isFallbackAdapter) },
    canvasFormat: navigator.gpu.getPreferredCanvasFormat(),
    lost: device.lost,
    errors,
  };
}
