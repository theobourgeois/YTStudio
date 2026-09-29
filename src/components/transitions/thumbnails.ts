/**
 * Library thumbnails: every card's picture is drawn by one shared WebGL canvas
 * (browsers only allow a handful of contexts) running the transition between
 * the two sample scenes, then copied into the card's own 2D canvas.
 *
 * Shaders compile in the background and a card shows nothing until its shader is ready,
 * so opening the library never waits on ~50 compiles. Posters (the still frame) are drawn
 * a few per frame and kept, so reopening the tab only copies pixels.
 */
import { type Compositor, IDENTITY, createCompositor } from "@shared/compositor";
import { transitionShader, transitionUniforms } from "@shared/transition-gl";
import { drawSampleScene } from "@shared/transition-samples";
import { type TransitionDefinition, defaultTransitionParams } from "@shared/transitions";

/** Thumbnail size in CSS px (3:2). */
export const THUMB_WIDTH = 102;
export const THUMB_HEIGHT = 68;

interface Thumbnailer {
  canvas: HTMLCanvasElement;
  compositor: Compositor;
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
    const compositor = createCompositor(gl);
    compositor.resize(width, height);
    ([0, 1] as const).forEach((i) => {
      const scene = document.createElement("canvas");
      scene.width = width;
      scene.height = height;
      drawSampleScene(scene.getContext("2d")!, width, height, i);
      compositor.setPicture(String(i), scene);
    });
    return { canvas, compositor, width, height };
  })();
  return thumbnailer;
}

/** Progress shown while a card isn't hovered. */
export const POSTER_PROGRESS = 0.36;
/** Time spent drawing posters per animation frame, in ms. */
const POSTER_BUDGET_MS = 6;

/** Drawn posters, by transition type. */
const posters = new Map<string, HTMLCanvasElement>();
/** Cards waiting for their poster, by transition type. */
const waiting = new Map<string, { def: TransitionDefinition; targets: Set<HTMLCanvasElement> }>();
let posterFrame = 0;

/**
 * Show a transition's poster in a card's canvas: now if it's been drawn before, otherwise
 * once its shader has compiled (a few cards per frame). Returns a cancel, for unmounting.
 */
export function requestPoster(def: TransitionDefinition, target: HTMLCanvasElement): () => void {
  const poster = posters.get(def.type);
  if (poster) {
    copyInto(poster, target);
    return () => {};
  }
  const entry = waiting.get(def.type) ?? { def, targets: new Set() };
  entry.targets.add(target);
  waiting.set(def.type, entry);
  posterFrame ||= requestAnimationFrame(drawPosters);
  return () => {
    entry.targets.delete(target);
    if (entry.targets.size === 0) waiting.delete(def.type);
  };
}

async function drawPosters() {
  const t = await getThumbnailer();
  posterFrame = 0;
  if (!t) return;
  const started = performance.now();
  for (const [type, { def, targets }] of waiting) {
    if (performance.now() - started > POSTER_BUDGET_MS) break;
    if (!t.compositor.prepareTransition(transitionShader(def))) continue;
    waiting.delete(type);
    if (!render(t, def, POSTER_PROGRESS)) continue;
    const poster = document.createElement("canvas");
    copyInto(t.canvas, poster);
    posters.set(type, poster);
    for (const target of targets) copyInto(poster, target);
  }
  if (waiting.size > 0) posterFrame = requestAnimationFrame(drawPosters);
}

/** Draw a transition at `progress` into a card's canvas (skipped while its shader compiles). */
export async function drawThumbnail(def: TransitionDefinition, progress: number, target: HTMLCanvasElement): Promise<void> {
  const t = await getThumbnailer();
  if (!t || !t.compositor.prepareTransition(transitionShader(def))) return;
  if (render(t, def, progress)) copyInto(t.canvas, target);
}

/** Draw into the shared WebGL canvas; false if the transition failed. */
function render(t: Thumbnailer, def: TransitionDefinition, progress: number): boolean {
  try {
    const scene = (key: string) => ({ key, affine: IDENTITY, opacity: 1 });
    t.compositor.clear([0, 0, 0, 0]);
    t.compositor.drawTransition(transitionShader(def), transitionUniforms(def, defaultTransitionParams(def)), progress, scene("0"), scene("1"));
    t.compositor.present();
    return true;
  } catch (err) {
    console.error(`Transition "${def.label}" failed to draw`, err);
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
