/**
 * Camera Raw's histogram (docs/photo/camera-raw.md, "CR3"): the red, green and blue counts of what the Camera Raw
 * makes (redrawn as it changes), and its clipping warnings: a triangle in each top corner lights when shadows
 * (black in every channel) or highlights (a channel at white) clip, and a click on it (or U / O) shows where on the
 * canvas, blue and red, as Camera Raw's overlay does (`ClippingOverlay`).
 */
import { useEffect, useRef, useState } from "react";
import { create } from "zustand";
import { cn } from "cn";
import { linearToSrgb } from "@shared/photo/colour";
import type { PhotoProject } from "@shared/photo/types";
import { liveRenderer } from "../live";

/** Whether the canvas shows where shadows and highlights clip (the window turns them off when it closes). */
export const useClipping = create<{ shadows: boolean; highlights: boolean; toggle: (which: "shadows" | "highlights") => void; off: () => void }>((set) => ({
  shadows: false,
  highlights: false,
  toggle: (which) => set((s) => ({ [which]: !s[which] })),
  off: () => set({ shadows: false, highlights: false }),
}));

const BINS = 128;

interface Counts {
  r: Uint32Array;
  g: Uint32Array;
  b: Uint32Array;
  shadows: number;
  highlights: number;
}

/** The histogram of premultiplied linear pixels, sRGB-encoded (transparent ones left out). */
export function histogramOf(data: Float32Array): Counts {
  const r = new Uint32Array(BINS);
  const g = new Uint32Array(BINS);
  const b = new Uint32Array(BINS);
  let shadows = 0;
  let highlights = 0;
  let n = 0;
  for (let i = 0; i < data.length; i += 4) {
    const a = data[i + 3];
    if (!(a > 0.01)) continue;
    const c = [data[i] / a, data[i + 1] / a, data[i + 2] / a].map((v) => linearToSrgb(Math.max(0, Math.min(1, v))));
    r[Math.min(BINS - 1, Math.floor(c[0] * BINS))]++;
    g[Math.min(BINS - 1, Math.floor(c[1] * BINS))]++;
    b[Math.min(BINS - 1, Math.floor(c[2] * BINS))]++;
    if (Math.max(c[0], c[1], c[2]) <= 0.004) shadows++;
    if (Math.max(c[0], c[1], c[2]) >= 0.998) highlights++;
    n++;
  }
  return { r, g, b, shadows: n ? shadows / n : 0, highlights: n ? highlights / n : 0 };
}

/** Clipping shown when more than this share of the picture clips. */
const CLIPS = 0.0005;

/** The histogram of `doc` (re-read when it changes, one read at a time). */
export function CameraRawHistogram({ doc, read }: { doc: PhotoProject | null; read: (doc: PhotoProject) => Promise<Float32Array | null> }) {
  const [counts, setCounts] = useState<Counts | null>(null);
  const busy = useRef(false);
  const pending = useRef<PhotoProject | null>(null);
  const clipping = useClipping();
  useEffect(() => {
    if (!doc) return;
    pending.current = doc;
    const run = async () => {
      if (busy.current) return;
      busy.current = true;
      try {
        while (pending.current) {
          const next = pending.current;
          pending.current = null;
          const data = await read(next);
          if (data) setCounts(histogramOf(data));
        }
      } finally {
        busy.current = false;
      }
    };
    const t = setTimeout(run, 60);
    return () => clearTimeout(t);
  }, [doc, read]);

  const path = (bins: Uint32Array | undefined, peak: number) => {
    if (!bins) return "";
    let d = `M0,64`;
    for (let i = 0; i < BINS; i++) d += `L${(i / (BINS - 1)) * 256},${64 - Math.min(1, Math.sqrt(bins[i] / peak)) * 60}`;
    return `${d}L256,64Z`;
  };
  // Scaled to the second-tallest bin, so one spike (a flat background) doesn't flatten the rest.
  const peak = counts ? [...counts.r, ...counts.g, ...counts.b].sort((a, b) => b - a)[2] || 1 : 1;
  const corner = (which: "shadows" | "highlights") => {
    const clips = (counts?.[which] ?? 0) > CLIPS;
    return (
      <button
        type="button"
        aria-label={`${which === "shadows" ? "Shadow" : "Highlight"} clipping warning`}
        aria-pressed={clipping[which]}
        title={`${clipping[which] ? "Hide" : "Show"} where ${which} clip (${which === "shadows" ? "U" : "O"})${counts ? `: ${(counts[which] * 100).toFixed(1)}% of the picture` : ""}`}
        className={cn("absolute top-1 grid size-4 place-items-center", which === "shadows" ? "left-1" : "right-1")}
        onClick={() => clipping.toggle(which)}
        data-clips={clips || undefined}
      >
        <svg viewBox="0 0 10 10" className="size-3">
          <path
            d={which === "shadows" ? "M0,0 L10,0 L0,10 Z" : "M0,0 L10,0 L10,10 Z"}
            className={cn(clipping[which] ? "stroke-white" : "stroke-transparent")}
            fill={clips ? (which === "shadows" ? "#3d7bff" : "#ff4040") : "rgb(128 128 128 / 0.6)"}
          />
        </svg>
      </button>
    );
  };
  return (
    <div className="relative h-20 rounded bg-black/85" data-camera-raw-histogram>
      <svg viewBox="0 0 256 64" preserveAspectRatio="none" className="absolute inset-x-0 bottom-0 h-16 w-full" style={{ mixBlendMode: "normal" }}>
        <g style={{ mixBlendMode: "screen" }}>
          <path d={path(counts?.r, peak)} fill="rgb(230 60 60 / 0.75)" />
          <path d={path(counts?.g, peak)} fill="rgb(60 200 80 / 0.75)" style={{ mixBlendMode: "screen" }} />
          <path d={path(counts?.b, peak)} fill="rgb(70 110 240 / 0.75)" style={{ mixBlendMode: "screen" }} />
        </g>
      </svg>
      {corner("shadows")}
      {corner("highlights")}
    </div>
  );
}

/**
 * Where the screen clips, over the canvas: blue where shadows are black in every channel, red where highlights reach
 * white in one, read back from what the screen shows a few times a second while either warning is on.
 */
export function ClippingOverlay() {
  const { shadows, highlights } = useClipping();
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (!shadows && !highlights) return;
    let stopped = false;
    let timer = 0;
    const draw = async () => {
      const renderer = liveRenderer();
      const canvas = ref.current;
      if (!renderer || !canvas) return;
      const screen = await (await renderer).readScreen();
      if (stopped || !screen) return;
      const { data, width, height } = screen;
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }
      const ctx = canvas.getContext("2d")!;
      const image = ctx.createImageData(width, height);
      const px = image.data;
      // Linear 1/255 encoded is about 0.004: black in every channel; a channel at white or past it.
      const black = 0.0003;
      for (let i = 0; i < data.length; i += 4) {
        const a = data[i + 3];
        if (!(a > 0.01)) continue;
        const max = Math.max(data[i], data[i + 1], data[i + 2]) / a;
        if (highlights && max >= 0.995) px.set([255, 40, 40, 255], i);
        else if (shadows && max <= black) px.set([40, 110, 255, 255], i);
      }
      ctx.putImageData(image, 0, 0);
    };
    const loop = async () => {
      await draw().catch(() => {});
      if (!stopped) timer = window.setTimeout(loop, 250);
    };
    void loop();
    return () => {
      stopped = true;
      clearTimeout(timer);
      const canvas = ref.current;
      canvas?.getContext("2d")?.clearRect(0, 0, canvas.width, canvas.height);
    };
  }, [shadows, highlights]);
  if (!shadows && !highlights) return null;
  return <canvas ref={ref} className="pointer-events-none absolute inset-0 size-full" data-clipping-overlay />;
}
