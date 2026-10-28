/**
 * MilkDrop (docs/now-playing.md, step 8): Butterchurn drawing the preset of the MilkDrop look on screen into a canvas
 * of its own, which the engine takes as a live picture (`MILKDROP_ASSET`). One visualizer for all of them: as a
 * MilkDrop look gives way to another, it blends to the new preset in MilkDrop's own way over the switch (both sides
 * show the one canvas); after any other look, the new preset is there at once. It hears the sound at the picture's
 * time (`LiveSignals.soundAt`), as in sync as the rest. In slow motion it's drawn that much less often (a preset's zoom,
 * turn and warp are by the frame, so a slower clock alone slows nothing), and what's shown dissolves from one of its
 * frames to the next as the time between goes (`picture`). Butterchurn and the presets
 * picked (`virtual:milkdrop-presets`, only those) load the first time it's asked (`prepare`); nothing's drawn while no
 * MilkDrop look is on screen. The user's clips and pictures go into its feedback (`feed`, `media-feed.ts`): painted into
 * each frame it draws, for the next to warp; a screen shared goes in under them, by a feed of its own (`screenFeed`).
 */
import type { ButterchurnAudioLevels, ButterchurnPreset, ButterchurnVisualizer } from "butterchurn";
import { MILKDROP_PRESETS, MILKDROP_SIZE, milkdropPreset } from "@shared/live-milkdrop";
import type { LiveSignals } from "@shared/signals/live";
import { errorMessage } from "@shared/errors";
import { log } from "@/lib/log";
import { Brake, type FedMedia, MODEL_SCALE, MediaFeed } from "./media-feed";
import { MOST_TOGETHER, type Seat } from "./media-mix";
import type { MediaMix } from "./media-mix";

const logger = log("now-playing");

/** Samples a channel Butterchurn hears each frame (its analysis's size). */
const SAMPLES = 1024;

/** What `freeReplacedShaders` reaches into: Butterchurn's renderer and the two shaders a preset brings. */
interface ShaderHolder {
  shaderProgram?: WebGLProgram | null;
  updateShader(text: string): void;
}

/**
 * Butterchurn compiles a preset's warp and comp shaders into new programs as it loads one and never deletes the ones
 * they replace: hours of presets changing pile up thousands of programs in the GPU process, and every frame gets slower
 * until the app is reopened. So each shader deletes the program it had (by then two presets old, nothing draws with
 * it) before it makes the next.
 */
function freeReplacedShaders(visualizer: ButterchurnVisualizer, gl: WebGL2RenderingContext): void {
  const renderer = (visualizer as unknown as { renderer?: Record<string, ShaderHolder | undefined> }).renderer;
  for (const key of ["warpShader", "compShader", "prevWarpShader", "prevCompShader"]) {
    const shader = renderer?.[key];
    if (!shader || Object.hasOwn(shader, "updateShader")) continue;
    const update = shader.updateShader;
    shader.updateShader = function (this: ShaderHolder, text: string) {
      const old = this.shaderProgram;
      if (old) {
        for (const attached of gl.getAttachedShaders(old) ?? []) gl.deleteShader(attached);
        gl.deleteProgram(old);
      }
      update.call(this, text);
    };
  }
}

/** A CommonJS module as the bundler hands it over: its exports, wrapped in `default` once or twice. */
function exportsOf<T>(mod: unknown, has: string): T {
  let m = mod as Record<string, unknown> | undefined;
  for (let i = 0; i < 3 && m && !(has in m); i++) m = m.default as Record<string, unknown> | undefined;
  if (!m || !(has in m)) throw new Error(`no ${has} in the module`);
  return m as T;
}

/** What's on screen, oldest first (`LiveDirector.shownAt`). */
export type Shown = readonly { look: string; from: number; full: number }[];

/**
 * The clip, picture or screen going into its feedback, how, how far into a kick the music is (0..1), and how much of
 * it (`fade`, 0..1: a clip coming in over a screen; all of it if not given).
 */
export interface Feeding {
  media: FedMedia;
  mix: MediaMix;
  hit: number;
  fade?: number;
  /** One of several shown together: where (`seatsFor`). */
  seat?: Seat;
}

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
  /** Frames of Butterchurn's owed (`pace` a display frame: one's drawn as it reaches 1), and real seconds since its last. */
  private owed = 0;
  private since = 0;
  /** In slow motion: its last two frames, and what's shown of them (`picture`). */
  private slow: { before: HTMLCanvasElement; last: HTMLCanvasElement; shown: HTMLCanvasElement } | null = null;
  private slowed = false;
  /** The user's clips and pictures, painted into its feedback: a feed for each shown at once (the first, alone, most often). */
  private feeds: MediaFeed[] = [];
  private feeding: readonly Feeding[] = [];
  /** A screen or window shared (`screen.ts`), under the clips. */
  private screenFeed: MediaFeed | null = null;
  private screen: Feeding | null = null;

  constructor() {
    this.canvas = document.createElement("canvas");
    this.canvas.width = MILKDROP_SIZE.width;
    this.canvas.height = MILKDROP_SIZE.height;
    // Not shown itself (the engine draws it): what it's doing, for the tests.
    this.canvas.hidden = true;
    this.canvas.dataset.milkdrop = "idle";
  }

  /** What to show: Butterchurn's canvas, or in slow motion its last two frames, dissolving from one to the next. */
  get picture(): HTMLCanvasElement {
    return this.slowed && this.slow ? this.slow.shown : this.canvas;
  }

  /** Whether it's ready to draw. */
  get ready(): boolean {
    return this.visualizer !== null;
  }

  /** Load Butterchurn and the presets (once; it draws nothing until they're in). */
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
    const [butterchurn, { default: all }] = await Promise.all([import("butterchurn"), import("virtual:milkdrop-presets")]);
    if (this.disposed) return;
    for (const p of MILKDROP_PRESETS) if (all[p.name]) this.presets.set(p.name, all[p.name]);
    const missing = MILKDROP_PRESETS.filter((p) => !this.presets.has(p.name));
    if (missing.length) logger.warn(`MilkDrop presets not found: ${missing.map((p) => p.name).join(", ")}`);
    const { createVisualizer } = exportsOf<{ createVisualizer: typeof import("butterchurn").default.createVisualizer }>(butterchurn, "createVisualizer");
    this.visualizer = createVisualizer(null, this.canvas, { ...MILKDROP_SIZE, pixelRatio: 1, textureRatio: 1 });
    freeReplacedShaders(this.visualizer, this.gl);
    // (One brake for both: what they paint piles up in the one picture.)
    const brake = new Brake();
    this.screenFeed = new MediaFeed(this.gl, brake);
    // (The others only ever show a model small, beside another: their stages are drawn smaller.)
    for (let i = 0; i < MOST_TOGETHER; i++) this.feeds.push(new MediaFeed(this.gl, brake, i === 0 ? MODEL_SCALE : 0.5));
    this.canvas.dataset.milkdrop = "ready";
    logger.info(`MilkDrop ready: ${this.presets.size} presets in ${Math.round(performance.now() - started)} ms`);
  }

  /**
   * Draw the frame for `time` (`seconds` after the last) if a MilkDrop look is on screen (`shown`): the newest one's
   * preset, blended into over what's left of its switch when the one before is MilkDrop's too. `pace`: how fast it
   * goes (slow motion's: a frame of Butterchurn's every `1 / pace` of the display's). `feeding`: the user's clips into its
   * feedback (up to `MOST_TOGETHER`, each in its seat); `screen`: a screen shared, under them. Whether it drew.
   */
  draw(time: number, seconds: number, shown: Shown, signals: LiveSignals | null, pace = 1, feeding: readonly Feeding[] = [], screen: Feeding | null = null): boolean {
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
          // (Its blend is in its own time, which runs at `pace`.)
          visualizer.loadPreset(preset, blending ? Math.max(0, newest.full - time) * pace : 0);
        } catch (err) {
          logger.warn(`MilkDrop couldn't load ${newest.look}: ${errorMessage(err)}`);
        }
        // (Not tried again each frame, if it failed.)
        this.current = newest.look;
        this.canvas.dataset.look = newest.look;
      }
    }
    this.feeding = feeding;
    this.feeds.forEach((feed, i) => {
      feed.show(feeding[i] ? { ...feeding[i].media, rate: pace } : null);
      feed.setRate(pace);
    });
    this.screen = screen;
    this.screenFeed?.show(screen?.media ?? null);
    this.owed += Math.min(1, pace);
    this.since += seconds;
    this.slowed = pace < 1;
    // (How fast it's drawing, for the tests.)
    if (this.canvas.dataset.pace !== String(pace)) this.canvas.dataset.pace = String(pace);
    // (Out of slow motion, its frames let go: they'd be old when it's slowed again.)
    if (!this.slowed) this.slow = null;
    if (this.owed >= 1) {
      this.owed -= 1;
      if (!this.render(visualizer, time, this.since * pace, signals)) return false;
      this.since = 0;
    }
    if (this.slowed) this.dissolve(this.owed);
    return true;
  }

  /** One frame of Butterchurn's, hearing the sound at `time`, its clock moved on `seconds`. Whether it drew. */
  private render(visualizer: ButterchurnVisualizer, time: number, seconds: number, signals: LiveSignals | null): boolean {
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
      visualizer.render({ audioLevels: this.levels, elapsedTime: Math.max(0.001, seconds) });
    } catch (err) {
      if (!this.failedDrawing) logger.warn(`MilkDrop couldn't draw ${this.current}: ${errorMessage(err)}`);
      this.failedDrawing = true;
      return false;
    }
    this.failedDrawing = false;
    // A screen shared, then the user's clip, painted into what it just drew: the next frame warps them in. (The picture's
    // measured by the first of them only: they share a brake.)
    const screen = this.screen;
    const screenFed = !!screen && !!this.screenFeed?.feed(visualizer.renderer, screen.mix, screen.hit, seconds, this.canvas);
    if (screenFed && this.screenFeed!.frames % 30 === 1) this.canvas.dataset.screenFed = String(this.screenFeed!.frames);
    const screenShown = this.screenFeed?.showing ? "on" : "";
    if ((this.canvas.dataset.screen ?? "") !== screenShown) this.canvas.dataset.screen = screenShown;
    this.feeding.forEach((feeding, i) => {
      const feed = this.feeds[i];
      // (The picture's paleness measured by one feed: the first, unless the screen's did.)
      if (!feed?.feed(visualizer.renderer, feeding.mix, feeding.hit, seconds, screenFed || i > 0 ? undefined : this.canvas, feeding.fade, feeding.seat)) return;
      if (i === 0 && feed.frames % 30 === 1) {
        this.canvas.dataset.fed = String(feed.frames);
        this.canvas.dataset.mediaGain = feed.gain.toFixed(2);
        this.canvas.dataset.mediaKeyed = String(feed.keyed);
      }
    });
    const fed = this.feeds.flatMap((feed) => feed.showing ?? []).join(" ");
    if (this.canvas.dataset.media !== fed) this.canvas.dataset.media = fed;
    if (++this.frames % 30 === 0) this.canvas.dataset.frames = String(this.frames);
    if (this.slowed) {
      // Its frame kept beside the one before (the canvas is drawn over by the next): both this one, at first.
      if (!this.slow) {
        this.slow = { before: this.blank(), last: this.blank(), shown: this.blank() };
        this.slow.last.getContext("2d")!.drawImage(this.canvas, 0, 0);
      }
      [this.slow.before, this.slow.last] = [this.slow.last, this.slow.before];
      this.slow.last.getContext("2d")!.drawImage(this.canvas, 0, 0);
    }
    return true;
  }

  /** In slow motion, what's shown: its frame before dissolving into its last, `k` of the way (0..1). */
  private dissolve(k: number): void {
    const { before, last, shown } = this.slow ?? {};
    if (!before || !last || !shown) return;
    const ctx = shown.getContext("2d")!;
    ctx.globalAlpha = 1;
    ctx.drawImage(before, 0, 0);
    ctx.globalAlpha = k;
    ctx.drawImage(last, 0, 0);
  }

  private blank(): HTMLCanvasElement {
    const canvas = document.createElement("canvas");
    canvas.width = MILKDROP_SIZE.width;
    canvas.height = MILKDROP_SIZE.height;
    return canvas;
  }

  /** Let go of its GPU context. */
  dispose(): void {
    this.disposed = true;
    for (const feed of this.feeds) feed.dispose();
    this.feeds = [];
    this.screenFeed?.dispose();
    this.screenFeed = null;
    this.visualizer = null;
    this.gl?.getExtension("WEBGL_lose_context")?.loseContext();
    this.gl = null;
  }
}
