/** Clip backgrounds: virtualised filmstrip thumbnails and canvas waveforms. */
import { memo, useLayoutEffect, useRef } from "react";
import type { Filmstrip as FilmstripInfo } from "@shared/types";
import { filmstripFrameUrl } from "@/lib/api";
import { filmstripTiles, peakInRange } from "./geometry";
import { useVisibleWindow } from "./view-store";
import { useWaveformData } from "./waveform-cache";

interface SpanProps {
  /** Clip left edge in lane px. */
  clipLeft: number;
  width: number;
  height: number;
  inPoint: number;
  zoom: number;
}

/** Clip-local px range [from, to) that intersects the rendered window. */
function useLocalRange(clipLeft: number, width: number) {
  const [x0, x1] = useVisibleWindow();
  return [Math.max(0, Math.floor(x0 - clipLeft)), Math.min(width, Math.ceil(x1 - clipLeft))] as const;
}

export const Filmstrip = memo(function Filmstrip({
  filmstrip,
  assetDuration,
  clipLeft,
  width,
  height,
  inPoint,
  zoom,
}: SpanProps & { filmstrip: FilmstripInfo; assetDuration: number }) {
  const [from, to] = useLocalRange(clipLeft, width);
  const tileWidth = Math.max(16, (height * filmstrip.width) / Math.max(1, filmstrip.height));
  const tiles = filmstripTiles({
    from,
    to,
    tileWidth,
    inPoint,
    zoom,
    assetDuration,
    frameCount: filmstrip.count,
  });
  return (
    <>
      {tiles.map((t) => (
        <img
          key={t.key}
          src={filmstripFrameUrl(filmstrip.urlPattern, t.frame)}
          alt=""
          draggable={false}
          decoding="async"
          className="pointer-events-none absolute top-0 h-full object-cover select-none"
          style={{ left: t.x, width: tileWidth }}
        />
      ))}
    </>
  );
});

/** Repeating poster frame while the filmstrip is still being generated. */
export function PosterStrip({ poster }: { poster: string }) {
  return (
    <div
      className="pointer-events-none absolute inset-0 bg-repeat-x opacity-90"
      style={{ backgroundImage: `url("${poster}")`, backgroundSize: "auto 100%" }}
    />
  );
}

/** Browsers cap canvas dimensions around 16k px; stay well inside that. */
const MAX_CANVAS_PX = 12_000;

export const Waveform = memo(function Waveform({
  url,
  clipLeft,
  width,
  height,
  inPoint,
  zoom,
}: SpanProps & { url: string | null }) {
  const data = useWaveformData(url);
  const [from, to] = useLocalRange(clipLeft, width);
  const span = to - from;
  const ref = useRef<HTMLCanvasElement>(null);

  useLayoutEffect(() => {
    const canvas = ref.current;
    if (!canvas || !data || span <= 0) return;
    const dpr = Math.min(window.devicePixelRatio || 1, MAX_CANVAS_PX / span);
    const w = Math.max(1, Math.round(span * dpr));
    const h = Math.max(1, Math.round(height * dpr));
    if (canvas.width !== w) canvas.width = w;
    if (canvas.height !== h) canvas.height = h;
    const g = canvas.getContext("2d");
    if (!g) return;
    g.clearRect(0, 0, w, h);
    g.fillStyle = "rgba(255, 255, 255, 0.62)";
    const mid = h / 2;
    const maxBar = h - 4 * dpr;
    const step = 1 / dpr / zoom; // seconds per device pixel
    for (let px = 0; px < w; px++) {
      const t0 = inPoint + (from + px / dpr) / zoom;
      const amp = peakInRange(data.peaks, data.peaksPerSecond, t0, t0 + step);
      const bar = Math.max(dpr, amp * maxBar);
      g.fillRect(px, mid - bar / 2, 1, bar);
    }
  }, [data, from, span, height, inPoint, zoom]);

  if (!data || span <= 0) return null;
  return (
    <canvas
      ref={ref}
      className="pointer-events-none absolute top-0"
      style={{ left: from, width: span, height }}
    />
  );
});
