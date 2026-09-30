import { useEffect, useRef } from "react";
import { cn } from "cn";
import { useTransport } from "./transport";

/** How long a graph shows, and how often it takes a sample. */
const OUTPUT_SAMPLE_MS = 40;
const CPU_SAMPLE_MS = 250;

/** The output's peak (0..1+) as a level on the meter: the last 48 dB fill it. */
export function peakLevel(peak: number): number {
  if (!(peak > 0)) return 0;
  return Math.max(0, Math.min(1, (20 * Math.log10(peak) + 48) / 48));
}

/**
 * The engine's peak now: what it last said, or silence if it hasn't spoken for a moment (it only
 * speaks while something sounds).
 */
function peakNow(now: number): number {
  const { peak, at, playing } = useTransport.getState();
  return playing || now - at < 250 ? peak : 0;
}

/** A value's recent history, drawn on a canvas as it rolls from right to left, a sample every `every` ms. */
function useRollingGraph(canvas: React.RefObject<HTMLCanvasElement | null>, every: number, sample: (now: number) => number, draw: (ctx: CanvasRenderingContext2D, values: number[], width: number, height: number, colours: Colours) => void) {
  const latest = useRef({ sample, draw });
  latest.current = { sample, draw };
  useEffect(() => {
    const element = canvas.current;
    if (!element) return;
    let values: number[] = [];
    let last = 0;
    let frame = 0;
    const tick = (now: number) => {
      frame = requestAnimationFrame(tick);
      if (now - last < every) return;
      last = now;
      const ratio = window.devicePixelRatio || 1;
      const width = element.clientWidth;
      const height = element.clientHeight;
      if (!width || !height) return;
      if (element.width !== Math.round(width * ratio) || element.height !== Math.round(height * ratio)) {
        element.width = Math.round(width * ratio);
        element.height = Math.round(height * ratio);
      }
      // One sample for every two pixels across.
      const count = Math.max(2, Math.floor(width / 2));
      values = [...values, latest.current.sample(now)].slice(-count);
      const ctx = element.getContext("2d");
      if (!ctx) return;
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
      ctx.clearRect(0, 0, width, height);
      latest.current.draw(ctx, values, width, height, readColours(element));
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [canvas, every]);
}

interface Colours {
  brand: string;
  danger: string;
  faint: string;
}

/** The theme's colours, from its CSS variables (canvases can't use its classes). */
function readColours(element: Element): Colours {
  const style = getComputedStyle(element);
  const read = (name: string, fallback: string) => style.getPropertyValue(name).trim() || fallback;
  return { brand: read("--brand", "#5b9bf0"), danger: read("--destructive", "#e5484d"), faint: read("--line", "#333") };
}

/**
 * The output, as FL Studio's toolbar shows it beside the time: its level over the last few seconds,
 * mirrored about the middle like a waveform's outline, red where it clipped.
 */
export function OutputGraph({ className }: { className?: string }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useRollingGraph(
    canvas,
    OUTPUT_SAMPLE_MS,
    (now) => peakNow(now),
    (ctx, values, width, height, colours) => {
      const middle = height / 2;
      ctx.fillStyle = colours.faint;
      ctx.fillRect(0, Math.round(middle), width, 1);
      const x0 = width - values.length * 2;
      values.forEach((peak, i) => {
        const half = Math.max(0.5, peakLevel(peak) * (middle - 2));
        ctx.fillStyle = peak >= 1 ? colours.danger : colours.brand;
        ctx.fillRect(x0 + i * 2, middle - half, 1.5, half * 2);
      });
    },
  );
  return (
    <div className={cn("sunken h-10 overflow-hidden rounded-sm px-1", className)} title="Output: its level over the last few seconds">
      <canvas ref={canvas} className="size-full" role="img" aria-label="Output level" />
    </div>
  );
}

/** The engine's load: now, and over the last half minute. */
export function CpuGraph({ className }: { className?: string }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const cpu = useTransport((s) => Math.round(s.cpu * 100));
  useRollingGraph(
    canvas,
    CPU_SAMPLE_MS,
    () => useTransport.getState().cpu,
    (ctx, values, width, height, colours) => {
      const x0 = width - values.length * 2;
      const y = (v: number) => height - Math.max(0, Math.min(1, v)) * (height - 1);
      ctx.beginPath();
      ctx.moveTo(x0, height);
      values.forEach((v, i) => ctx.lineTo(x0 + i * 2, y(v)));
      ctx.lineTo(x0 + (values.length - 1) * 2, height);
      ctx.closePath();
      ctx.globalAlpha = 0.25;
      ctx.fillStyle = colours.brand;
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.beginPath();
      values.forEach((v, i) => (i ? ctx.lineTo(x0 + i * 2, y(v)) : ctx.moveTo(x0, y(v))));
      ctx.strokeStyle = colours.brand;
      ctx.lineWidth = 1.25;
      ctx.stroke();
    },
  );
  return (
    <div className={cn("sunken flex h-10 flex-col gap-0.5 rounded-sm px-2 pt-1 pb-1", className)} title={`The audio engine's load: ${cpu}%`}>
      <div className="flex items-baseline justify-between text-[10px] leading-none text-muted-foreground">
        <span className="font-semibold tracking-wide">CPU</span>
        <span className="font-mono tabular-nums text-foreground" data-testid="cpu">
          {cpu}%
        </span>
      </div>
      <canvas ref={canvas} className="min-h-0 w-full flex-1" role="img" aria-label="Engine load over time" />
    </div>
  );
}
