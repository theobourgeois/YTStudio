/**
 * Pictures for the assistant: the Program monitor at a timeline time (the
 * preview canvas, drawn by the same compositor as the export), and frames of
 * media files (drawn by the server with ffmpeg).
 */
import type { ToolContent } from "@shared/assistant-tools";
import { api } from "@/lib/api";
import { usePlayback } from "@/stores/playback";
import { useSourcePreview } from "@/stores/source-preview";
import { ToolError } from "./input";

const nextFrame = () => new Promise<void>((r) => requestAnimationFrame(() => r()));
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Wait until the preview's media has caught up with a seek (or give up after a while). */
async function previewSettled(signal: AbortSignal): Promise<void> {
  await nextFrame();
  await nextFrame();
  const deadline = performance.now() + 4000;
  while (performance.now() < deadline) {
    if (signal.aborted) throw new ToolError("Stopped.");
    const videos = [...document.querySelectorAll<HTMLVideoElement>('[data-slot="canvas"] video')];
    const busy = videos.some((v) => v.src && (v.seeking || (v.readyState < HTMLMediaElement.HAVE_CURRENT_DATA && !v.error)));
    const images = [...document.querySelectorAll<HTMLImageElement>('[data-slot="canvas"] img')];
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
    await previewSettled(signal);
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
