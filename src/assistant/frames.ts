/**
 * Pictures for the assistant: the Program monitor at a timeline time (the
 * preview canvas, drawn by the same compositor as the export), a video that
 * isn't open drawn the same way offscreen, and frames of media files (drawn
 * by the server with ffmpeg).
 */
import type { ToolContent } from "@shared/assistant-tools";
import { aspectParts, videoTracks } from "@shared/timeline";
import type { MediaAsset, Project } from "@shared/types";
import { PreviewEngine, type PreviewSource } from "@/components/preview/engine";
import { api } from "@/lib/api";
import { usePlayback } from "@/stores/playback";
import { useSourcePreview } from "@/stores/source-preview";
import { ToolError } from "./input";

const nextFrame = () => new Promise<void>((r) => requestAnimationFrame(() => r()));
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Wait until a preview's media (in `root`) has caught up with a seek (or give up after a while). */
async function previewSettled(root: ParentNode, signal: AbortSignal): Promise<void> {
  await nextFrame();
  await nextFrame();
  const deadline = performance.now() + 4000;
  while (performance.now() < deadline) {
    if (signal.aborted) throw new ToolError("Stopped.");
    const videos = [...root.querySelectorAll<HTMLVideoElement>("video")];
    const busy = videos.some((v) => v.src && (v.seeking || (v.readyState < HTMLMediaElement.HAVE_CURRENT_DATA && !v.error)));
    const images = [...root.querySelectorAll<HTMLImageElement>("img")];
    const loading = images.some((i) => i.src && !i.complete);
    if (!busy && !loading) break;
    await sleep(50);
  }
  // The engine draws on the frame after the media reports it's ready.
  await nextFrame();
  await nextFrame();
}

/** A canvas as a base64 JPEG `width` px wide (never wider than it is). */
function toJpeg(source: HTMLCanvasElement, width: number): { data: string; width: number; height: number } {
  const w = Math.max(16, Math.min(width, source.width));
  const h = Math.max(16, Math.round((w * source.height) / source.width));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new ToolError("The browser couldn't make a picture.");
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(source, 0, 0, w, h);
  return { data: canvas.toDataURL("image/jpeg", 0.85).split(",")[1], width: w, height: h };
}

/** The edited video at timeline `times`: a line of text and a picture for each. Moves the playhead. */
export async function programFrames(times: number[], width: number, signal: AbortSignal): Promise<ToolContent[]> {
  // The source monitor hides the timeline's preview.
  useSourcePreview.getState().close();
  const playback = usePlayback.getState();
  playback.pause();
  const content: ToolContent[] = [];
  for (const time of times) {
    usePlayback.getState().seek(time);
    await previewSettled(document.querySelector('[data-slot="canvas"]') ?? document, signal);
    const canvas = document.querySelector<HTMLCanvasElement>('[data-slot="preview-canvas"]');
    if (!canvas || canvas.width === 0 || canvas.height === 0) {
      throw new ToolError("The Program monitor isn't showing, so there's nothing to look at. Ask the user to make the preview visible.");
    }
    const shown = usePlayback.getState().time;
    const jpeg = toJpeg(canvas, width);
    content.push({ type: "text", text: `Timeline ${Math.round(shown * 1000) / 1000}s (${jpeg.width}×${jpeg.height}):` });
    content.push({ type: "image", data: jpeg.data, mimeType: "image/jpeg" });
  }
  return content;
}

/**
 * A video that isn't open in the editor at timeline `times`, like `programFrames`: drawn by a
 * preview engine of its own, on a canvas nobody sees (kept laid out so the browser decodes its media).
 */
export async function offscreenFrames(
  video: { project: Project; assets: readonly MediaAsset[] },
  times: number[],
  width: number,
  signal: AbortSignal,
): Promise<ToolContent[]> {
  const [a, b] = aspectParts(video.project.settings.aspectRatio);
  const size = { width, height: Math.round((width * b) / a) };
  const root = document.createElement("div");
  root.dataset.slot = "assistant-offscreen";
  Object.assign(root.style, {
    position: "fixed",
    left: "0",
    top: "0",
    width: `${size.width}px`,
    height: `${size.height}px`,
    opacity: "0",
    pointerEvents: "none",
    zIndex: "-1",
    overflow: "hidden",
  });
  document.body.append(root);

  let state = { project: video.project, assets: [...video.assets], time: 0, playing: false };
  const listeners = new Set<() => void>();
  const source: PreviewSource = {
    get: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  const engine = new PreviewEngine(() => {}, source);
  const cleanups: (() => void)[] = [];
  const add = <T extends HTMLElement>(el: T): T => {
    Object.assign(el.style, { position: "absolute", inset: "0", width: "100%", height: "100%" });
    root.append(el);
    return el;
  };
  try {
    for (const track of videoTracks(video.project)) {
      for (const index of [0, 1] as const) {
        const v = add(document.createElement("video"));
        v.muted = true;
        v.playsInline = true;
        v.preload = "auto";
        cleanups.push(engine.attachVideo(track.id, index, v));
        const img = add(document.createElement("img"));
        img.decoding = "async";
        cleanups.push(engine.attachImage(track.id, index, img));
      }
    }
    const canvas = add(document.createElement("canvas"));
    cleanups.push(engine.attachCanvas(canvas));
    engine.setCanvasSize(size);
    engine.start();

    const content: ToolContent[] = [];
    for (const time of times) {
      state = { ...state, time };
      for (const listener of listeners) listener();
      await previewSettled(root, signal);
      if (canvas.width === 0 || canvas.height === 0) throw new ToolError("The video couldn't be drawn here (this browser has no WebGL 2).");
      const jpeg = toJpeg(canvas, width);
      content.push({ type: "text", text: `Timeline ${Math.round(time * 1000) / 1000}s (${jpeg.width}×${jpeg.height}):` });
      content.push({ type: "image", data: jpeg.data, mimeType: "image/jpeg" });
    }
    return content;
  } finally {
    engine.stop();
    for (const cleanup of cleanups.reverse()) cleanup();
    // Give the WebGL context back now: browsers allow only a few, and drop the oldest (the preview's) first.
    root.querySelector("canvas")?.getContext("webgl2")?.getExtension("WEBGL_lose_context")?.loseContext();
    root.remove();
  }
}

async function blobToBase64(blob: Blob): Promise<string> {
  const reader = new FileReader();
  return new Promise((resolve, reject) => {
    reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "");
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

/** Frames of a media file at source `times`. */
export async function mediaFrames(assetId: string, times: number[], width: number, signal: AbortSignal): Promise<ToolContent[]> {
  const frames = await Promise.all(
    times.map(async (t) => {
      const res = await fetch(api.mediaFrameUrl(assetId, t, width), { signal });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new ToolError(body?.error ?? `Couldn't get the frame at ${t}s.`);
      }
      return { t, data: await blobToBase64(await res.blob()) };
    }),
  );
  return frames.flatMap(({ t, data }): ToolContent[] => [
    { type: "text", text: `Source ${Math.round(t * 1000) / 1000}s:` },
    { type: "image", data, mimeType: "image/jpeg" },
  ]);
}
