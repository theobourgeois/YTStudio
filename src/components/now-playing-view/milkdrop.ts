/**
 * MilkDrop (docs/now-playing.md, step 8): Butterchurn drawing the preset of the MilkDrop look on screen into a canvas
 * of its own, which the engine takes as a live picture (`MILKDROP_ASSET`). One visualizer for all of them: as a
 * MilkDrop look gives way to another, it blends to the new preset in MilkDrop's own way over the switch (both sides
 * show the one canvas); after any other look, the new preset is there at once. It hears the sound at the picture's
 * time (`LiveSignals.soundAt`), as in sync as the rest; in slow motion its time runs slower. Butterchurn and the packs
 * the presets are in load the first time it's asked (`prepare`); nothing's drawn while no MilkDrop look is on screen.
 */
import type { ButterchurnAudioLevels, ButterchurnPreset, ButterchurnVisualizer } from "butterchurn";
import { MILKDROP_PRESETS, MILKDROP_SIZE, type MilkdropPack, milkdropPreset } from "@shared/live-milkdrop";
import type { LiveSignals } from "@shared/signals/live";
import { errorMessage } from "@shared/errors";
import { log } from "@/lib/log";

const logger = log("now-playing");

/** Samples a channel Butterchurn hears each frame (its analysis's size). */
const SAMPLES = 1024;

type Pack = { getPresets(): Record<string, ButterchurnPreset> };

/** Each pack, loaded on its own (only those the presets picked are in). */
const PACKS: Record<MilkdropPack, () => Promise<unknown>> = {
  butterchurnPresets: () => import("butterchurn-presets/lib/butterchurnPresets.min.js"),
  butterchurnPresetsExtra: () => import("butterchurn-presets/lib/butterchurnPresetsExtra.min.js"),
  butterchurnPresetsExtra2: () => import("butterchurn-presets/lib/butterchurnPresetsExtra2.min.js"),
  butterchurnPresetsMD1: () => import("butterchurn-presets/lib/butterchurnPresetsMD1.min.js"),
};

/** A CommonJS module as the bundler hands it over: its exports, wrapped in `default` once or twice. */
function exportsOf<T>(mod: unknown, has: string): T {
  let m = mod as Record<string, unknown> | undefined;
  for (let i = 0; i < 3 && m && !(has in m); i++) m = m.default as Record<string, unknown> | undefined;
  if (!m || !(has in m)) throw new Error(`no ${has} in the module`);
  return m as T;
}

/** What's on screen, oldest first (`LiveDirector.shownAt`). */
export type Shown = readonly { look: string; from: number; full: number }[];

export class MilkDrop {
  readonly canvas: HTMLCanvasElement;
  private visualizer: ButterchurnVisualizer | null = null;
  private gl: WebGL2RenderingContext | null = null;
  private presets = new Map<string, ButterchurnPreset>();
  private loading: Promise<void> | null = null;
  private disposed = false;
  /** The look whose preset is loaded. */
  private current: string | null = null;
  private readonly left = new Float32Array(SAMPLES);
  private readonly right = new Float32Array(SAMPLES);
  private readonly levels: ButterchurnAudioLevels = {
    timeByteArray: new Uint8Array(SAMPLES),
    timeByteArrayL: new Uint8Array(SAMPLES),
    timeByteArrayR: new Uint8Array(SAMPLES),
  };

  private frames = 0;
  private failedDrawing = false;

  constructor() {
    this.canvas = document.createElement("canvas");
    this.canvas.width = MILKDROP_SIZE.width;
    this.canvas.height = MILKDROP_SIZE.height;
    // Not shown itself (the engine draws it): what it's doing, for the tests.
    this.canvas.hidden = true;
    this.canvas.dataset.milkdrop = "idle";
  }

  /** Whether it's ready to draw. */
  get ready(): boolean {
    return this.visualizer !== null;
  }

  /** Load Butterchurn and the presets' packs (once; it draws nothing until they're in). */
  prepare(): Promise<void> {
    this.loading ??= this.load().catch((err) => {
      this.canvas.dataset.milkdrop = "failed";
      logger.warn(`MilkDrop couldn't start: ${errorMessage(err)}`);
    });
    return this.loading;
  }

  private async load(): Promise<void> {
    const started = performance.now();
    this.canvas.dataset.milkdrop = "loading";
    // Its drawing kept until the next, so the engine can take it after (Butterchurn is given this same context).
    this.gl = this.canvas.getContext("webgl2", { alpha: false, antialias: false, depth: false, stencil: false, premultipliedAlpha: false, preserveDrawingBuffer: true });
    if (!this.gl) throw new Error("WebGL 2 isn't available");
    const packs = [...new Set(MILKDROP_PRESETS.map((p) => p.pack))];
    const [butterchurn, ...loaded] = await Promise.all([import("butterchurn"), ...packs.map((p) => PACKS[p]())]);
    if (this.disposed) return;
    packs.forEach((pack, i) => {
      const all = exportsOf<Pack>(loaded[i], "getPresets").getPresets();
      for (const p of MILKDROP_PRESETS) if (p.pack === pack && all[p.name]) this.presets.set(p.name, all[p.name]);
    });
    const missing = MILKDROP_PRESETS.filter((p) => !this.presets.has(p.name));
    if (missing.length) logger.warn(`MilkDrop presets not found: ${missing.map((p) => p.name).join(", ")}`);
    const { createVisualizer } = exportsOf<{ createVisualizer: typeof import("butterchurn").default.createVisualizer }>(butterchurn, "createVisualizer");
    this.visualizer = createVisualizer(null, this.canvas, { ...MILKDROP_SIZE, pixelRatio: 1, textureRatio: 1 });
    this.canvas.dataset.milkdrop = "ready";
    logger.info(`MilkDrop ready: ${this.presets.size} presets in ${Math.round(performance.now() - started)} ms`);
  }

  /**
   * Draw the frame for `time` (`seconds` after the last) if a MilkDrop look is on screen (`shown`): the newest one's
   * preset, blended into over what's left of its switch when the one before is MilkDrop's too. `pace`: how fast its
   * time runs (slow motion's). Whether it drew.
   */
  draw(time: number, seconds: number, shown: Shown, signals: LiveSignals | null, pace = 1): boolean {
    const on = shown.filter((s) => milkdropPreset(s.look));
    if (!on.length || this.disposed) return false;
    void this.prepare();
    const visualizer = this.visualizer;
    if (!visualizer) return false;
    const newest = on[on.length - 1];
    if (newest.look !== this.current) {
      const preset = this.presets.get(milkdropPreset(newest.look)!.name);
      if (preset) {
        const blending = this.current !== null && on.some((s) => s.look === this.current);
        try {
          visualizer.loadPreset(preset, blending ? Math.max(0, newest.full - time) : 0);
        } catch (err) {
          logger.warn(`MilkDrop couldn't load ${newest.look}: ${errorMessage(err)}`);
        }
        // (Not tried again each frame, if it failed.)
        this.current = newest.look;
        this.canvas.dataset.look = newest.look;
      }
    }
    if (signals) signals.soundAt(time, this.left, this.right);
    else {
      this.left.fill(0);
      this.right.fill(0);
    }
    const byte = (v: number) => Math.max(0, Math.min(255, Math.round(128 + v * 128)));
    for (let i = 0; i < SAMPLES; i++) {
      this.levels.timeByteArrayL[i] = byte(this.left[i]);
      this.levels.timeByteArrayR[i] = byte(this.right[i]);
      this.levels.timeByteArray[i] = byte((this.left[i] + this.right[i]) / 2);
    }
    try {
      visualizer.render({ audioLevels: this.levels, elapsedTime: Math.max(0.001, seconds * pace) });
    } catch (err) {
      if (!this.failedDrawing) logger.warn(`MilkDrop couldn't draw ${this.current}: ${errorMessage(err)}`);
      this.failedDrawing = true;
      return false;
    }
    this.failedDrawing = false;
    if (++this.frames % 30 === 0) this.canvas.dataset.frames = String(this.frames);
    return true;
  }

  /** Let go of its GPU context. */
  dispose(): void {
    this.disposed = true;
    this.visualizer = null;
    this.gl?.getExtension("WEBGL_lose_context")?.loseContext();
    this.gl = null;
  }
}
