/**
 * Library thumbnails: every card's picture is drawn by one shared WebGL canvas
 * (browsers only allow a handful of contexts) running the transition between
 * the two sample scenes, then copied into the card's own 2D canvas.
 */
import { type TransitionRenderer, createTransitionRenderer, transitionShader, transitionUniforms } from "@shared/transition-gl";
import { drawSampleScene } from "@shared/transition-samples";
import { type TransitionDefinition, defaultTransitionParams } from "@shared/transitions";

/** Thumbnail size in CSS px (3:2). */
export const THUMB_WIDTH = 102;
export const THUMB_HEIGHT = 68;

interface Thumbnailer {
  canvas: HTMLCanvasElement;
  renderer: TransitionRenderer;
  width: number;
  height: number;
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
    const renderer = createTransitionRenderer(gl);
    renderer.resize(width, height);
    ([0, 1] as const).forEach((i) => {
      const scene = document.createElement("canvas");
      scene.width = width;
      scene.height = height;
      drawSampleScene(scene.getContext("2d")!, width, height, i);
      renderer.layer(i, scene);
    });
    return { canvas, renderer, width, height };
  })();
  return thumbnailer;
}

/** Draw a transition at `progress` into a card's canvas. */
export async function drawThumbnail(def: TransitionDefinition, progress: number, target: HTMLCanvasElement): Promise<void> {
  const t = await getThumbnailer();
  if (!t) return;
  if (target.width !== t.width || target.height !== t.height) {
    target.width = t.width;
    target.height = t.height;
  }
  try {
    t.renderer.draw(transitionShader(def), transitionUniforms(def, defaultTransitionParams(def)), progress);
  } catch (err) {
    console.error(`Transition "${def.label}" failed to draw`, err);
    return;
  }
  const ctx = target.getContext("2d");
  if (!ctx) return;
  ctx.clearRect(0, 0, t.width, t.height);
  ctx.drawImage(t.canvas, 0, 0);
}
