/**
 * The Effects tab's thumbnails: every card's picture is drawn by one shared
 * WebGL canvas (browsers only allow a handful of contexts), a transition
 * between the two sample scenes or an effect over the sunset, then copied into
 * the card's own 2D canvas.
 *
 * Shaders compile in the background and a card shows nothing until its shader is ready,
 * so opening the tab never waits on ~50 compiles. Posters (the still frame) are drawn
 * a few per frame and kept, so reopening the tab only copies pixels.
 */
import { lazySceneRenderer, scenesReady } from "@/scenes/loader";
import { type Compositor, IDENTITY, type Shader, createCompositor } from "@shared/compositor";
import { effectPass, effectPasses } from "@shared/effect-gl";
import { canvasAffine, clipLayer } from "@shared/layers";
import { type PresetDefinition, presetClip } from "@shared/presets";
import type { EffectDefinition } from "@shared/effects";
import { defaultParams } from "@shared/params";
import { transitionShader, transitionUniforms } from "@shared/transition-gl";
import { drawSampleScene } from "@shared/transition-samples";
import { type TransitionDefinition, defaultTransitionParams } from "@shared/transitions";

/** Thumbnail size in CSS px (3:2). */
export const THUMB_WIDTH = 102;
export const THUMB_HEIGHT = 68;

interface Thumbnailer {
  canvas: HTMLCanvasElement;
  compositor: Compositor;
  /** The sunset without its letter, as effects' cards start from (for the before side of a comparison). */
  plain: HTMLCanvasElement;
}

let thumbnailer: Promise<Thumbnailer | null> | null = null;

function getThumbnailer(): Promise<Thumbnailer | null> {
  thumbnailer ??= (async () => {
    // The scenes' letters use the UI font; draw them once it's there.
    await document.fonts.load(`800 40px "DM Sans Variable"`).catch(() => {});
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const width = Math.round(THUMB_WIDTH * dpr);
    const height = Math.round(THUMB_HEIGHT * dpr);
    const canvas = document.createElement("canvas");
    const gl = canvas.getContext("webgl2", { premultipliedAlpha: true, preserveDrawingBuffer: true, antialias: false });
    if (!gl) return null;
    const compositor = createCompositor(gl);
    compositor.resize(width, height);
    // 3D scenes' cards wait for their runtime (`Thumb.ready`).
    compositor.setSceneRenderer(lazySceneRenderer(() => {}));
    const scene = (which: 0 | 1, letter: boolean) => {
      const c = document.createElement("canvas");
      c.width = width;
      c.height = height;
      drawSampleScene(c.getContext("2d")!, width, height, which, letter);
      return c;
    };
    compositor.setPicture("0", scene(0, true));
    compositor.setPicture("1", scene(1, true));
    const plain = scene(1, false);
    compositor.setPicture("plain", plain);
    return { canvas, compositor, plain };
  })();
  return thumbnailer;
}

/** What a card shows: shaders, drawn at a moment (a transition's progress, or an effect's time in seconds). */
export interface Thumb {
  key: string;
  /** Compiled before it's drawn. */
  shaders: Shader[];
  /** The moment its poster shows. */
  posterAt: number;
  /** Whether it can be drawn yet (a 3D scene's runtime loads first: asking starts it). */
  ready?(): boolean;
  render(compositor: Compositor, at: number): void;
}

/** Progress shown while a transition's card isn't hovered. */
export const POSTER_PROGRESS = 0.36;

const thumbs = new Map<object, Thumb>();

export function transitionThumb(def: TransitionDefinition): Thumb {
  let thumb = thumbs.get(def);
  if (!thumb) {
    const shader = transitionShader(def);
    const uniforms = transitionUniforms(def, defaultTransitionParams(def));
    const scene = (key: string) => ({ key, affine: IDENTITY, opacity: 1 });
    thumb = {
      key: `transition:${def.type}`,
      shaders: [shader],
      posterAt: POSTER_PROGRESS,
      render: (compositor, progress) => compositor.drawTransition(shader, uniforms, progress, scene("0"), scene("1")),
    };
    thumbs.set(def, thumb);
  }
  return thumb;
}

export function effectThumb(def: EffectDefinition): Thumb {
  let thumb = thumbs.get(def);
  if (!thumb) {
    const values = { ...defaultParams(def.params), ...def.shader?.demo };
    const pass = (time: number) => effectPass(def, values, time);
    const first = pass(0);
    if (!first) throw new Error(`${def.label} isn't a video effect.`);
    const stepped = !!(def.shader?.history || def.shader?.simulation || def.shader?.scene);
    thumb = {
      key: `effect:${def.type}`,
      shaders: [first.shader],
      posterAt: 0.6,
      ...(def.shader?.scene && { ready: scenesReady }),
      render: stepped
        ? // A time effect (or a simulation, a scene) needs a moving picture and the frames before: the sunset drifting, a third of a second of them.
          (compositor, time) => {
            for (let k = 10; k >= 0; k--) {
              const t = time - k / 30;
              if (k > 0) compositor.clear([0, 0, 0, 0]);
              const drift = Math.sin(t * 3) * 0.12;
              compositor.drawPicture({ key: "plain", affine: [1, 0, 0, 1, drift, 0], opacity: 1 });
              const time_ = effectPass(def, values, t, 30, `thumb/${def.type}`);
              if (time_) compositor.drawAdjustment({ affine: IDENTITY, opacity: 1, effects: [time_] });
            }
          }
        : (compositor, time) => compositor.drawPicture({ key: "plain", affine: IDENTITY, opacity: 1, effects: [pass(time)!] }),
    };
    thumbs.set(def, thumb);
  }
  return thumb;
}

/**
 * A preset's card, drawn at a time (seconds into it): a transition's adjustment layer over
 * the cut from one sample scene to the other, an effect preset on the plain sunset.
 */
export function presetThumb(def: PresetDefinition): Thumb {
  let thumb = thumbs.get(def);
  if (!thumb) {
    const clip = presetClip(def);
    const shaders = [...new Map(effectPasses(clip, 0).map((p) => [p.shader.key, p.shader])).values()];
    thumb = {
      key: `preset:${def.type}`,
      shaders,
      posterAt: def.duration * (def.kind === "transition" ? 0.42 : 0.6),
      render: (compositor, time) => {
        const canvas = { width: compositor.gl.canvas.width, height: compositor.gl.canvas.height };
        const t = Math.min(def.duration - 1e-4, Math.max(0, time));
        const layer = clipLayer(clip, t, canvasAffine(clip, canvas), { canvas, fps: 30, maxSamples: 12 });
        if (def.kind === "transition") {
          compositor.drawPicture({ key: t < def.duration / 2 ? "0" : "1", affine: IDENTITY, opacity: 1 });
          if (layer) compositor.drawAdjustment(layer);
        } else if (layer) {
          compositor.drawPicture({ ...layer, key: "plain" });
        }
      },
    };
    thumbs.set(def, thumb);
  }
  return thumb;
}

/** Time spent drawing posters per animation frame, in ms. */
const POSTER_BUDGET_MS = 6;

/** Drawn posters, by thumb key. */
const posters = new Map<string, HTMLCanvasElement>();
/** Cards waiting for their poster, by thumb key. */
const waiting = new Map<string, { thumb: Thumb; targets: Set<HTMLCanvasElement> }>();
let posterFrame = 0;

/**
 * Show a card's poster in its canvas: now if it's been drawn before, otherwise
 * once its shader has compiled (a few cards per frame). Returns a cancel, for unmounting.
 */
export function requestPoster(thumb: Thumb, target: HTMLCanvasElement): () => void {
  const poster = posters.get(thumb.key);
  if (poster) {
    copyInto(poster, target);
    return () => {};
  }
  const entry = waiting.get(thumb.key) ?? { thumb, targets: new Set() };
  entry.targets.add(target);
  waiting.set(thumb.key, entry);
  posterFrame ||= requestAnimationFrame(drawPosters);
  return () => {
    entry.targets.delete(target);
    if (entry.targets.size === 0) waiting.delete(thumb.key);
  };
}

async function drawPosters() {
  const t = await getThumbnailer();
  posterFrame = 0;
  if (!t) return;
  const started = performance.now();
  for (const [key, { thumb, targets }] of waiting) {
    if (performance.now() - started > POSTER_BUDGET_MS) break;
    if (thumb.ready && !thumb.ready()) continue;
    if (!thumb.shaders.every((shader) => t.compositor.prepareShader(shader))) continue;
    waiting.delete(key);
    if (!render(t, thumb, thumb.posterAt)) continue;
    const poster = document.createElement("canvas");
    copyInto(t.canvas, poster);
    posters.set(key, poster);
    for (const target of targets) copyInto(poster, target);
  }
  if (waiting.size > 0) posterFrame = requestAnimationFrame(drawPosters);
}

/**
 * Draw a card at `at` into its canvas (skipped while its shader compiles). `before`
 * (0..1) shows the picture without the effect left of that point, to compare.
 */
export async function drawThumbnail(thumb: Thumb, at: number, target: HTMLCanvasElement, before?: number): Promise<void> {
  const t = await getThumbnailer();
  if (!t || (thumb.ready && !thumb.ready()) || !thumb.shaders.every((shader) => t.compositor.prepareShader(shader))) return;
  if (!render(t, thumb, at)) return;
  copyInto(t.canvas, target);
  if (before === undefined) return;
  const ctx = target.getContext("2d");
  if (!ctx) return;
  const x = Math.round(before * target.width);
  if (x > 0) ctx.drawImage(t.plain, 0, 0, x, target.height, 0, 0, x, target.height);
  ctx.fillStyle = "rgba(255,255,255,0.9)";
  ctx.fillRect(x - 1, 0, 2, target.height);
}

/** Draw into the shared WebGL canvas; false if the shader failed. */
function render(t: Thumbnailer, thumb: Thumb, at: number): boolean {
  try {
    t.compositor.clear([0, 0, 0, 0]);
    thumb.render(t.compositor, at);
    t.compositor.present();
    return true;
  } catch (err) {
    console.error(`"${thumb.key}" failed to draw`, err);
    return false;
  }
}

function copyInto(source: HTMLCanvasElement, target: HTMLCanvasElement) {
  if (target.width !== source.width || target.height !== source.height) {
    target.width = source.width;
    target.height = source.height;
  }
  const ctx = target.getContext("2d");
  if (!ctx) return;
  ctx.clearRect(0, 0, target.width, target.height);
  ctx.drawImage(source, 0, 0);
}
