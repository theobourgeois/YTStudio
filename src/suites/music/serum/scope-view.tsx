import { useEffect, useRef } from "react";
import { ownerWindow } from "@/lib/window-events";
import { steady, triggered } from "./scope-model";
import { scopeOf } from "./scope";

/** A frame older than this is silence (the engine says nothing while nothing sounds). */
const STALE_MS = 140;
/** How many samples the trace spans: a cycle of a low bass note. */
const SPAN = 768;
/** The graticule's divisions, across and up. */
const DIVISIONS_X = 10;
const DIVISIONS_Y = 8;

function readPalette(el: Element) {
  const style = ownerWindow(el).getComputedStyle(el);
  const v = (name: string, fallback: string) => style.getPropertyValue(name).trim() || fallback;
  return { screen: v("--serum-screen", "#0b100d"), grid: v("--serum-grid", "#17211b"), axis: v("--serum-axis", "#22332a"), trace: v("--serum-trace", "#46e08a") };
}

/**
 * The Serum player's display: an oscilloscope of what its channel's Serum plays. One green trace, held on its cycle
 * (as a scope's trigger holds it) and scaled to fill the screen, on a faint graticule; flat when nothing plays.
 */
export function ScopeView({ channelId }: { channelId: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const win = ownerWindow(canvas);
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    let palette = readPalette(canvas);
    let paletteAt = performance.now();
    let width = 0;
    let height = 0;
    let scale = 1;
    const fit = () => {
      const box = canvas.getBoundingClientRect();
      scale = win.devicePixelRatio || 1;
      width = Math.max(1, box.width);
      height = Math.max(1, box.height);
      canvas.width = Math.round(width * scale);
      canvas.height = Math.round(height * scale);
    };
    fit();
    const resize = new ResizeObserver(fit);
    resize.observe(canvas);

    let shown: Float32Array = new Float32Array(SPAN);
    let gain = 1;
    let lastFrame = performance.now();
    let raf = 0;
    let timer = 0;

    const draw = (time: number) => {
      const dt = Math.min(0.1, (time - lastFrame) / 1000);
      lastFrame = time;
      if (time - paletteAt > 2000) {
        palette = readPalette(canvas);
        paletteAt = time;
      }
      const scope = scopeOf(channelId);
      const sounding = scope !== null && time - scope.at < STALE_MS;
      ({ shown, gain } = steady(shown, gain, sounding ? triggered(scope.scope.wave, SPAN) : null, dt));

      ctx.setTransform(scale, 0, 0, scale, 0, 0);
      const W = width;
      const H = height;
      ctx.fillStyle = palette.screen;
      ctx.fillRect(0, 0, W, H);
      // The graticule, and its axes a little brighter.
      ctx.lineWidth = 1;
      for (let i = 1; i < DIVISIONS_X; i++) {
        ctx.strokeStyle = i === DIVISIONS_X / 2 ? palette.axis : palette.grid;
        const x = Math.round((W * i) / DIVISIONS_X) + 0.5;
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, H);
        ctx.stroke();
      }
      for (let i = 1; i < DIVISIONS_Y; i++) {
        ctx.strokeStyle = i === DIVISIONS_Y / 2 ? palette.axis : palette.grid;
        const y = Math.round((H * i) / DIVISIONS_Y) + 0.5;
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(W, y);
        ctx.stroke();
      }
      // The trace.
      ctx.save();
      ctx.strokeStyle = palette.trace;
      ctx.shadowColor = palette.trace;
      ctx.shadowBlur = 4;
      ctx.lineWidth = 1.5;
      ctx.lineJoin = "round";
      ctx.beginPath();
      const mid = H / 2;
      const reach = H * 0.42;
      for (let i = 0; i < shown.length; i++) {
        const x = (i / (shown.length - 1)) * W;
        const y = mid - Math.max(-1, Math.min(1, shown[i] * gain)) * reach;
        if (i) ctx.lineTo(x, y);
        else ctx.moveTo(x, y);
      }
      ctx.stroke();
      ctx.restore();

      // Flat and still, it needn't be drawn often.
      if (!sounding && gain <= 1.001 && shown.every((v) => Math.abs(v) < 1e-4)) timer = win.setTimeout(() => (raf = win.requestAnimationFrame(draw)), 100);
      else raf = win.requestAnimationFrame(draw);
    };
    raf = win.requestAnimationFrame(draw);
    return () => {
      win.cancelAnimationFrame(raf);
      win.clearTimeout(timer);
      resize.disconnect();
    };
  }, [channelId]);

  return <canvas ref={canvasRef} className="block h-full w-full" aria-label="Oscilloscope" role="img" data-testid="serum-scope" />;
}
