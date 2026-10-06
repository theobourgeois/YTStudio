/**
 * The Signals window's spectrum: what a source sounds like at the playhead (from its files' signals, not
 * an analyser, so it's what the export hears), on a log axis from 20 Hz to 20 kHz, with a band signal's
 * range shaded. Dragging across it sets the range (Trapcode Sound Keys' way).
 */
import { useLayoutEffect, useRef, useState } from "react";
import { currentSignalReader, spectrumAt } from "@shared/audio-signals";
import type { SignalSource } from "@shared/types";
import { startPointerDrag } from "@/lib/pointer-drag";
import { usePlayback } from "@/stores/playback";
import { useSignals } from "@/stores/signals";
import { formatHz, hzToX, rangeFromDrag } from "./geometry";

const TICKS = [50, 100, 200, 500, 1000, 2000, 5000, 10_000];
/** dB at the bottom of the display (0 dB, a full-scale sine, at the top). */
const FLOOR_DB = -84;

const cssColour = (name: string, fallback: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;

export function Spectrum({
  source,
  sequenceId,
  low,
  high,
  onRange,
  onRangeEnd,
}: {
  source: SignalSource;
  sequenceId: string | null;
  low: number;
  high: number;
  /** A drag across it: live, then once more when it's let go. */
  onRange: (range: { low: number; high: number }) => void;
  onRangeEnd: () => void;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const time = usePlayback((s) => s.time);
  // Drawn again once the files' signals arrive.
  const loaded = useSignals((s) => s.data);
  const [width, setWidth] = useState(0);

  useLayoutEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const observer = new ResizeObserver(() => setWidth(canvas.clientWidth));
    observer.observe(canvas);
    return () => observer.disconnect();
  }, []);

  useLayoutEffect(() => {
    const canvas = ref.current;
    const g = canvas?.getContext("2d");
    if (!canvas || !g || width <= 0) return;
    const dpr = window.devicePixelRatio || 1;
    const h = canvas.clientHeight;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(h * dpr);
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, width, h);
    const brand = cssColour("--brand", "#3b82f6");
    const line = cssColour("--line", "#888888");
    // The band.
    const [x0, x1] = [hzToX(low, width), hzToX(high, width)];
    g.globalAlpha = 0.18;
    g.fillStyle = brand;
    g.fillRect(x0, 0, Math.max(1, x1 - x0), h);
    g.globalAlpha = 1;
    // Frequency lines.
    g.fillStyle = line;
    g.font = "10px sans-serif";
    for (const hz of TICKS) {
      const x = Math.round(hzToX(hz, width)) + 0.5;
      g.globalAlpha = 0.5;
      g.fillRect(x, 0, 1, h - 12);
      g.globalAlpha = 0.9;
      g.fillText(formatHz(hz).replace(" ", ""), x + 2, h - 2);
    }
    g.globalAlpha = 1;
    // The spectrum now.
    const reader = currentSignalReader();
    const spectrum = reader ? spectrumAt(reader, sequenceId, source, time) : null;
    if (!spectrum) return;
    const { edges, db } = spectrum;
    g.beginPath();
    g.moveTo(0, h - 12);
    for (let b = 0; b < db.length; b++) {
      const v = Math.max(0, Math.min(1, (db[b] - FLOOR_DB) / -FLOOR_DB));
      const y = (h - 12) * (1 - v);
      g.lineTo(hzToX(edges[b], width), y);
      g.lineTo(hzToX(edges[b + 1], width), y);
    }
    g.lineTo(width, h - 12);
    g.closePath();
    g.globalAlpha = 0.35;
    g.fillStyle = brand;
    g.fill();
    g.globalAlpha = 1;
    g.strokeStyle = brand;
    g.lineWidth = 1;
    g.stroke();
  }, [width, time, loaded, low, high, source, sequenceId]);

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (e.button !== 0) return;
    const box = e.currentTarget.getBoundingClientRect();
    const from = e.clientX - box.left;
    startPointerDrag(e, {
      threshold: 2,
      onMove: (ev) => onRange(rangeFromDrag(from, ev.clientX - box.left, box.width)),
      onEnd: () => onRangeEnd(),
      onCancel: () => onRangeEnd(),
    });
  };

  return (
    <div className="space-y-1">
      <canvas
        ref={ref}
        aria-label={`Spectrum: drag across it to choose the band (now ${formatHz(low)} to ${formatHz(high)})`}
        data-spectrum
        onPointerDown={onPointerDown}
        className="sunken h-36 w-full cursor-crosshair touch-none rounded-md"
      />
      <p className="text-[11px] text-muted-foreground">
        At the playhead. Drag across it to choose the band: {formatHz(low)} to {formatHz(high)}.
      </p>
    </div>
  );
}
