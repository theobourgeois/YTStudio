import { useEffect, useRef } from "react";
import { cn } from "cn";
import { METER_COLOUR_STOPS } from "./mixer/meter";
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
    /** Drawn flat at this value, still so: nothing to draw again until it changes (the app idle). */
    let flatAt: number | null = null;
    let colours: { at: number; value: Colours } | null = null;
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
      const value = latest.current.sample(now);
      values = [...values, value].slice(-count);
      const flat = values.length === count && values.every((v) => v === value);
      if (flat && flatAt === value) return;
      flatAt = flat ? value : null;
      const ctx = element.getContext("2d");
      if (!ctx) return;
      // The theme's colours, read again now and then (a theme switched), not on every frame.
      if (!colours || now - colours.at > 1000) colours = { at: now, value: readColours(element) };
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
      ctx.clearRect(0, 0, width, height);
      latest.current.draw(ctx, values, width, height, colours.value);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [canvas, every]);
}

interface Colours {
  brand: string;
  faint: string;
  /** The mixer meters' (green, amber, red at 0 dB). */
  meter: { low: string; mid: string; high: string };
}

/** The theme's colours, from its CSS variables (canvases can't use its classes). */
function readColours(element: Element): Colours {
  const style = getComputedStyle(element);
  const read = (name: string, fallback: string) => style.getPropertyValue(name).trim() || fallback;
  return {
    brand: read("--brand", "#5b9bf0"),
    faint: read("--line", "#333"),
    meter: { low: read("--meter-low", "#4cc46c"), mid: read("--meter-mid", "#f2b33d"), high: read("--meter-high", "#ef4d55") },
  };
}

/**
 * Where the output graph's colours change, as fractions of its half height out from the middle: the
 * meters' stops (green to -18 dB, amber by -6, red at 0) on its scale (`peakLevel`).
 */
export function outputColourStops(): { at: number; colour: "low" | "mid" | "high" }[] {
  return [{ at: 0, colour: "low" }, ...METER_COLOUR_STOPS.map((stop) => ({ at: peakLevel(stop.level), colour: stop.colour }))];
}

/** How much of the graph's oldest end fades away, as a fraction of its width. */
const FADE = 0.3;

/**
 * The output, as FL Studio's toolbar shows it beside the time: its level over the last few seconds,
 * mirrored about the middle like a waveform's outline, in the mixer meters' colours (red reaching 0 dB),
 * fading out as it rolls away.
 */
export function OutputGraph({ className }: { className?: string }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useRollingGraph(
    canvas,
    OUTPUT_SAMPLE_MS,
    (now) => peakNow(now),
    (ctx, values, width, height, colours) => {
      const middle = height / 2;
      const reach = middle - 2;
      ctx.fillStyle = colours.faint;
      ctx.fillRect(0, Math.round(middle), width, 1);
      // Coloured as the meters are, by how far out from the middle: quiet green, loud amber, red at 0 dB.
      const gradient = ctx.createLinearGradient(0, middle - reach, 0, middle + reach);
      for (const stop of outputColourStops()) {
        gradient.addColorStop(0.5 - stop.at / 2, colours.meter[stop.colour]);
        gradient.addColorStop(0.5 + stop.at / 2, colours.meter[stop.colour]);
      }
      const x0 = width - values.length * 2;
      values.forEach((peak, i) => {
        const x = x0 + i * 2;
        const half = Math.max(0.5, peakLevel(peak) * reach);
        // The oldest fade out as they roll off the left.
        ctx.globalAlpha = Math.min(1, x / (width * FADE));
        ctx.fillStyle = gradient;
        ctx.fillRect(x, middle - half, 1.5, half * 2);
      });
      ctx.globalAlpha = 1;
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
