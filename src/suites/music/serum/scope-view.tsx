import { useEffect, useRef, useState } from "react";
import { ownerWindow } from "@/lib/window-events";
import { SPECTRUM_BINS, follow, spectrumHeights, spectrumX, steady, triggered } from "./scope-model";
import { scopeOf } from "./scope";

/** What the display shows; a click goes to the next. */
const VIEWS = ["spectrum", "scope", "stereo"] as const;
type View = (typeof VIEWS)[number];
const VIEW_NAMES: Record<View, string> = { spectrum: "Spectrum", scope: "Oscilloscope", stereo: "Stereo" };
const VIEW_KEY = "vaudio.music.serumView";

/** A frame older than this is silence (the engine says nothing while nothing sounds). */
const STALE_MS = 140;
/** How many samples the oscilloscope spans: a cycle of a low bass note. */
const SPAN = 768;

function readPalette(el: Element) {
  const style = ownerWindow(el).getComputedStyle(el);
  const v = (name: string, fallback: string) => style.getPropertyValue(name).trim() || fallback;
  return {
    screen: v("--serum-screen", "#0d0f12"),
    grid: v("--serum-grid", "#191c22"),
    axis: v("--serum-axis", "#262a32"),
    label: v("--serum-label", "#5c6270"),
    trace: v("--brand", "#3b82f6"),
    font: v("--font-sans", "sans-serif"),
  };
}

/** `#rrggbb` with an alpha (other colours as they are). */
function alpha(colour: string, a: number): string {
  const n = parseInt(colour.slice(1, 7), 16);
  return colour[0] === "#" && colour.length >= 7 && !Number.isNaN(n) ? `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})` : colour;
}

const savedView = (): View => {
  const saved = localStorage.getItem(VIEW_KEY);
  return VIEWS.includes(saved as View) ? (saved as View) : "spectrum";
};

/**
 * The Serum player's display of what its channel's Serum plays, in the theme's accent on a dark screen: its
 * spectrum (the default), an oscilloscope (held on its cycle), or its stereo picture. A click shows the next.
 */
export function ScopeView({ channelId }: { channelId: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [view, setView] = useState<View>(savedView);
  const viewRef = useRef(view);
  viewRef.current = view;

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

    const spectrum = new Float32Array(SPECTRUM_BINS);
    let wave: Float32Array = new Float32Array(SPAN);
    let gain = 1;
    let left: number[] = [];
    let right: number[] = [];
    let lastFrame = performance.now();
    let raf = 0;

    const line = (W: number, y: (i: number) => number, n: number) => {
      ctx.beginPath();
      for (let i = 0; i < n; i++) {
        const x = (i / (n - 1)) * W;
        if (i) ctx.lineTo(x, y(i));
        else ctx.moveTo(x, y(i));
      }
    };

    const draw = (time: number) => {
      const dt = Math.min(0.1, (time - lastFrame) / 1000);
      lastFrame = time;
      if (time - paletteAt > 1000) {
        palette = readPalette(canvas);
        paletteAt = time;
      }
      const frame = scopeOf(channelId);
      const sounding = frame !== null && time - frame.at < STALE_MS;
      follow(spectrum, sounding ? spectrumHeights(frame.scope.spectrum) : null, dt);
      ({ shown: wave, gain } = steady(wave, gain, sounding ? triggered(frame.scope.wave, SPAN) : null, dt));
      if (sounding) [left, right] = [frame.scope.left, frame.scope.right];
      else if (left.length) [left, right] = [left.map((v) => v * 0.85), right.map((v) => v * 0.85)];

      ctx.setTransform(scale, 0, 0, scale, 0, 0);
      const W = width;
      const H = height;
      ctx.fillStyle = palette.screen;
      ctx.fillRect(0, 0, W, H);
      ctx.lineWidth = 1;
      ctx.font = `10px ${palette.font}`;
      ctx.fillStyle = palette.label;
      const view = viewRef.current;

      if (view === "spectrum") {
        // The frequencies' lines, labelled under them.
        ctx.textAlign = "center";
        for (const [hz, text] of [[50, "50"], [100, "100"], [200, "200"], [500, "500"], [1000, "1k"], [2000, "2k"], [5000, "5k"], [10_000, "10k"]] as const) {
          const x = Math.round(spectrumX(hz) * W) + 0.5;
          ctx.strokeStyle = palette.grid;
          ctx.beginPath();
          ctx.moveTo(x, 0);
          ctx.lineTo(x, H - 14);
          ctx.stroke();
          ctx.fillText(text, x, H - 3);
        }
        const bottom = H - 16;
        const y = (i: number) => bottom - spectrum[i] * (bottom - 8);
        line(W, y, SPECTRUM_BINS);
        ctx.lineTo(W, bottom);
        ctx.lineTo(0, bottom);
        ctx.closePath();
        const fill = ctx.createLinearGradient(0, 8, 0, bottom);
        fill.addColorStop(0, alpha(palette.trace, 0.35));
        fill.addColorStop(1, alpha(palette.trace, 0.04));
        ctx.fillStyle = fill;
        ctx.fill();
        line(W, y, SPECTRUM_BINS);
      } else if (view === "scope") {
        for (let i = 1; i < 10; i++) {
          ctx.strokeStyle = i === 5 ? palette.axis : palette.grid;
          const x = Math.round((W * i) / 10) + 0.5;
          ctx.beginPath();
          ctx.moveTo(x, 0);
          ctx.lineTo(x, H);
          ctx.stroke();
        }
        for (let i = 1; i < 8; i++) {
          ctx.strokeStyle = i === 4 ? palette.axis : palette.grid;
          const y = Math.round((H * i) / 8) + 0.5;
          ctx.beginPath();
          ctx.moveTo(0, y);
          ctx.lineTo(W, y);
          ctx.stroke();
        }
        line(W, (i) => H / 2 - Math.max(-1, Math.min(1, wave[i] * gain)) * H * 0.42, wave.length);
      } else {
        // Mid up, side across (a vectorscope's 45°): mono is a vertical line, wide a cloud.
        const r = Math.min(W, H) * 0.42;
        const cx = W / 2;
        const cy = H / 2;
        ctx.strokeStyle = palette.axis;
        ctx.beginPath();
        ctx.moveTo(cx, cy - r);
        ctx.lineTo(cx, cy + r);
        ctx.moveTo(cx - r, cy);
        ctx.lineTo(cx + r, cy);
        ctx.stroke();
        ctx.strokeStyle = palette.grid;
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.stroke();
        ctx.fillStyle = alpha(palette.trace, 0.75);
        const peak = Math.max(0.05, ...left.map((l, i) => Math.hypot(l, right[i] ?? 0)));
        for (let i = 0; i < left.length; i++) {
          const side = (left[i] - right[i]) * Math.SQRT1_2;
          const mid = (left[i] + right[i]) * Math.SQRT1_2;
          ctx.fillRect(cx + (side / peak) * r - 1, cy - (mid / peak) * r - 1, 2, 2);
        }
      }
      if (view !== "stereo") {
        ctx.strokeStyle = palette.trace;
        ctx.lineWidth = 1.5;
        ctx.lineJoin = "round";
        ctx.stroke();
      }
      // Which view, in its corner.
      ctx.textAlign = "left";
      ctx.fillStyle = palette.label;
      ctx.fillText(VIEW_NAMES[view], 8, 14);
      raf = win.requestAnimationFrame(draw);
    };
    raf = win.requestAnimationFrame(draw);
    return () => {
      win.cancelAnimationFrame(raf);
      resize.disconnect();
    };
  }, [channelId]);

  const next = () => {
    const to = VIEWS[(VIEWS.indexOf(view) + 1) % VIEWS.length];
    localStorage.setItem(VIEW_KEY, to);
    setView(to);
  };
  return (
    <canvas
      ref={canvasRef}
      className="block h-full w-full cursor-pointer"
      role="button"
      aria-label={`${VIEW_NAMES[view]}: click for ${VIEW_NAMES[VIEWS[(VIEWS.indexOf(view) + 1) % VIEWS.length]]}`}
      title="Click to change what it shows"
      data-testid="serum-scope"
      data-view={view}
      onClick={next}
    />
  );
}
