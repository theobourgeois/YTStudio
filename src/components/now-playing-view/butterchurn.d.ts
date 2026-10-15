/** Butterchurn (MilkDrop 2 in WebGL 2, `milkdrop.ts`): what's used of it. */
declare module "butterchurn" {
  /** A preset as the packs have it (its equations as text, its shaders). */
  export type ButterchurnPreset = Record<string, unknown>;

  export interface ButterchurnAudioLevels {
    /** 1024 samples each, 0..255 (128 is silence). */
    timeByteArray: Uint8Array;
    timeByteArrayL: Uint8Array;
    timeByteArrayR: Uint8Array;
  }

  /** Its renderer's frame buffers: the one drawn last is warped into the next frame (`media-feed.ts` paints into it). */
  export interface ButterchurnRenderer {
    targetFrameBuffer: WebGLFramebuffer;
    texsizeX: number;
    texsizeY: number;
  }

  export interface ButterchurnVisualizer {
    renderer: ButterchurnRenderer;
    loadPreset(preset: ButterchurnPreset, blendSeconds?: number): void;
    setRendererSize(width: number, height: number, opts?: { pixelRatio?: number; textureRatio?: number; meshWidth?: number; meshHeight?: number }): void;
    render(opts?: { audioLevels?: ButterchurnAudioLevels; elapsedTime?: number }): void;
  }

  const butterchurn: {
    createVisualizer(
      audioContext: AudioContext | null,
      canvas: HTMLCanvasElement,
      opts: { width: number; height: number; pixelRatio?: number; textureRatio?: number; meshWidth?: number; meshHeight?: number },
    ): ButterchurnVisualizer;
  };
  export default butterchurn;
}

/** MilkDrop's presets picked (shared/milkdrop-presets.ts), by name: made by vite.config.ts. */
declare module "virtual:milkdrop-presets" {
  const presets: Record<string, import("butterchurn").ButterchurnPreset>;
  export default presets;
}
