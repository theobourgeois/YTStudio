/**
 * YT-L's level display (`docs/fabfilter/pro-l.md` §2.6): a canvas drawn each frame something moves (the columns
 * scroll while the engine sends them; the settings redraw the ceiling and the scale). The columns are kept outside
 * React (`history.ts`), so the window doesn't re-render as they come.
 */
import { useEffect, useRef, useState } from "react";
import type { ProL } from "@shared/music/types";
import { prepare } from "../piano/draw";
import { useMusic } from "../store";
import { drawLevel, readLimPalette } from "./draw";
import { displaySeconds, headFraction, scaleRange } from "./geometry";
import { KEPT_SECONDS, columnAt, latestOf, limHistory } from "./history";

/** Room over the plot, under it, and at the right for the scale. */
export const PLOT_TOP = 10;
const PLOT_BOTTOM = 10;
export const GUTTER = 30;
/** The display is drawn this late (ms), so the newest columns (which come in bursts) reach its right edge. */
const DELAY_MS = 60;

export function LevelDisplay({ effectId, proL, bypassed }: { effectId: string; proL: ProL; bypassed: boolean }) {
  const box = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState({ width: 600, height: 300 });
  const { range, zero } = scaleRange(proL.meter.scale);
  const scene = useRef({ proL, range, zero, size, bypassed });
  scene.current = { proL, range, zero, size, bypassed };
  const dirty = useRef(true);
  useEffect(() => {
    dirty.current = true;
  });

  useEffect(() => {
    const element = box.current;
    if (!element) return;
    const observer = new ResizeObserver(() => setSize({ width: element.clientWidth, height: element.clientHeight }));
    observer.observe(element);
    setSize({ width: element.clientWidth, height: element.clientHeight });
    return () => observer.disconnect();
  }, []);
  useEffect(() => useMusic.subscribe(() => (dirty.current = true)), []);

  useEffect(() => {
    let frame = 0;
    let lastHead = -1;
    let wasLive = false;
    const draw = () => {
      frame = requestAnimationFrame(draw);
      const element = canvas.current;
      if (!element) return;
      const now = performance.now();
      const history = limHistory(effectId);
      // Scrolling while columns come, still once they stop.
      const head = history ? Math.min(now - DELAY_MS, columnAt(history, history.last)) : 0;
      const live = !!latestOf(history, now);
      if (!dirty.current && Math.abs(head - lastHead) < 0.5 && live === wasLive) return;
      dirty.current = false;
      lastHead = head;
      wasLive = live;
      const { proL: p, range: r, zero: z, size: s, bypassed: off } = scene.current;
      const ctx = prepare(element, s.width, s.height);
      if (!ctx) return;
      const seconds = displaySeconds(p.meter.display, Math.min(KEPT_SECONDS, history?.filled ?? 0));
      drawLevel(
        ctx,
        {
          width: s.width,
          height: s.height,
          top: PLOT_TOP,
          plot: Math.max(20, s.height - PLOT_TOP - PLOT_BOTTOM),
          gutter: GUTTER,
          range: r,
          zero: z,
          ceiling: p.output,
          seconds,
          head: headFraction(p.meter.display, seconds, history?.filled ?? 0),
          now: head,
          loudness: p.meter.timeScale === "momentary" ? 4 : 5,
          target: p.meter.target,
          bypassed: off,
          palette: readLimPalette(element),
        },
        history,
      );
    };
    frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
  }, [effectId]);

  return (
    <div ref={box} className="absolute inset-0" data-testid="pro-l-display">
      <canvas ref={canvas} className="absolute inset-0 h-full w-full" />
    </div>
  );
}
