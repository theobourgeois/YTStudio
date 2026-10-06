/**
 * An audio clip's spectrogram (instead of its waveform, when the Signals window says so): its file's
 * signals' 96 bands over time, low at the bottom, brighter where louder. Drawn only for the part of the
 * clip in view, as the waveform is.
 */
import { memo, useLayoutEffect, useRef } from "react";
import { BAND_COUNT, BAND_FLOOR_DB, byteDb } from "@shared/signals/format";
import { useSignals } from "@/stores/signals";
import { useVisibleWindow } from "./view-store";

const MAX_CANVAS_PX = 12_000;
/** dB that reads as the brightest. */
const TOP_DB = -12;

export const Spectrogram = memo(function Spectrogram({
  assetId,
  clipLeft,
  width,
  height,
  inPoint,
  zoom,
  rate,
}: {
  assetId: string;
  clipLeft: number;
  width: number;
  height: number;
  inPoint: number;
  zoom: number;
  rate: number;
}) {
  const data = useSignals((s) => s.data.get(assetId));
  const [x0, x1] = useVisibleWindow();
  const from = Math.max(0, Math.floor(x0 - clipLeft));
  const to = Math.min(width, Math.ceil(x1 - clipLeft));
  const span = to - from;
  const ref = useRef<HTMLCanvasElement>(null);

  useLayoutEffect(() => {
    const canvas = ref.current;
    if (!canvas || !data || span <= 0) return;
    const w = Math.max(1, Math.round(Math.min(span, MAX_CANVAS_PX)));
    const h = Math.max(1, Math.round(height));
    canvas.width = w;
    canvas.height = h;
    const g = canvas.getContext("2d");
    if (!g) return;
    const image = g.createImageData(w, h);
    const { rate: frameRate, frames } = data.header;
    for (let px = 0; px < w; px++) {
      const t = inPoint + ((from + (px * span) / w) / zoom) * rate;
      const frame = Math.round(t * frameRate);
      if (frame < 0 || frame >= frames) continue;
      for (let y = 0; y < h; y++) {
        const band = Math.min(BAND_COUNT - 1, Math.floor(((h - 1 - y) / h) * BAND_COUNT));
        const db = byteDb(data.bands[frame * BAND_COUNT + band]);
        const v = Math.max(0, Math.min(1, (db - BAND_FLOOR_DB) / (TOP_DB - BAND_FLOOR_DB)));
        const a = Math.round(255 * v * v);
        const i = (y * w + px) * 4;
        image.data[i] = 255;
        image.data[i + 1] = 255;
        image.data[i + 2] = 255;
        image.data[i + 3] = a;
      }
    }
    g.putImageData(image, 0, 0);
  }, [data, from, span, height, inPoint, zoom, rate]);

  if (!data || span <= 0) return null;
  return <canvas ref={ref} data-spectrogram className="pointer-events-none absolute top-0" style={{ left: from, width: span, height }} />;
});
