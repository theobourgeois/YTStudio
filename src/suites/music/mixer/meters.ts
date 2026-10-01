import { useCallback, useEffect, useRef } from "react";
import { useTransport } from "../transport";
import { type MeterState, SILENT_METER, isClipping, meterFraction, stepMeter } from "./meter";

interface Meter {
  canvas: HTMLCanvasElement;
  sides: [MeterState, MeterState];
  /** What was last drawn, to draw again only when it changes. */
  drawn: string;
}

interface Colours {
  brand: string;
  danger: string;
  mark: string;
}

/** The theme's colours, from its CSS variables (canvases can't use its classes). */
function readColours(element: Element): Colours {
  const style = getComputedStyle(element);
  const read = (name: string, fallback: string) => style.getPropertyValue(name).trim() || fallback;
  return { brand: read("--brand", "#5b9bf0"), danger: read("--destructive", "#e5484d"), mark: read("--line-strong", "#555") };
}

/**
 * The mixer's meters: every strip's canvas, drawn by one animation loop from the engine's reports
 * (`useTransport().meters`). Returns the ref callback a strip gives its canvas, by track id.
 */
export function useMeters(): (trackId: string) => (canvas: HTMLCanvasElement | null) => void {
  const meters = useRef(new Map<string, Meter>());
  const refs = useRef(new Map<string, (canvas: HTMLCanvasElement | null) => void>());

  useEffect(() => {
    let frame = 0;
    let last = performance.now();
    let heardAt = -1;
    let colours: Colours | null = null;
    const tick = (now: number) => {
      frame = requestAnimationFrame(tick);
      const dt = now - last;
      last = now;
      const { meters: report, at } = useTransport.getState();
      const fresh = at !== heardAt;
      heardAt = at;
      for (const [id, meter] of meters.current) {
        const heard = fresh ? (report[id] ?? [0, 0]) : null;
        meter.sides = [stepMeter(meter.sides[0], heard ? heard[0] : null, dt, now), stepMeter(meter.sides[1], heard ? heard[1] : null, dt, now)];
        const clipping = meter.sides.map((side) => isClipping(side, now));
        const heights = meter.sides.map((side) => meterFraction(side.level));
        const key = `${heights.map((h) => Math.round(h * 200)).join()}${clipping.join()}`;
        if (key === meter.drawn) continue;
        meter.drawn = key;
        colours ??= readColours(meter.canvas);
        draw(meter.canvas, heights, clipping, colours);
      }
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, []);

  return useCallback((trackId: string) => {
    let ref = refs.current.get(trackId);
    if (!ref) {
      ref = (canvas) => {
        if (canvas) meters.current.set(trackId, { canvas, sides: [SILENT_METER, SILENT_METER], drawn: "" });
        else meters.current.delete(trackId);
      };
      refs.current.set(trackId, ref);
    }
    return ref;
  }, []);
}

/** Two bars, left and right, rising from the bottom; red while they've lately been over 0 dB. */
function draw(canvas: HTMLCanvasElement, heights: number[], clipping: boolean[], colours: Colours) {
  const ratio = window.devicePixelRatio || 1;
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  if (!width || !height) return;
  if (canvas.width !== Math.round(width * ratio) || canvas.height !== Math.round(height * ratio)) {
    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(height * ratio);
  }
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  ctx.clearRect(0, 0, width, height);
  const bar = (width - 1) / 2;
  heights.forEach((h, side) => {
    const top = height - h * height;
    ctx.fillStyle = clipping[side] ? colours.danger : colours.brand;
    ctx.fillRect(side * (bar + 1), top, bar, height - top);
  });
  // 0 dB.
  ctx.fillStyle = colours.mark;
  ctx.fillRect(0, Math.round(height - meterFraction(1) * height), width, 1);
}
