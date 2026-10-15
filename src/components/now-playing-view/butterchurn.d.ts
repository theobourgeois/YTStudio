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

  export interface ButterchurnVisualizer {
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

/** A pack of Butterchurn's presets, by name. */
declare module "butterchurn-presets/lib/*.min.js" {
  const pack: { getPresets(): Record<string, import("butterchurn").ButterchurnPreset> };
  export default pack;
}
