/**
 * Pro-C's level display and the knee display over it (`docs/fabfilter/pro-c.md` 2.7): a canvas drawn each
 * frame something moves (the points scroll while the engine sends them; the settings redraw the knee
 * curve), its KNEE tab, and the meter scale's button at the bottom right. The points are kept outside
 * React (`history.ts`), so the window doesn't re-render as they come.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { PiCaretDoubleLeft, PiCaretDoubleRight } from "react-icons/pi";
import { cn } from "cn";
import { engineProC, staticReduction } from "@shared/music/pro-c";
import { isVintage } from "@shared/music/pro-c-presets";
import type { ProC } from "@shared/music/types";
import { prepare } from "../piano/draw";
import { useMusic } from "../store";
import { setProC } from "./actions";
import { type KneeScene, drawLevel, readCompPalette } from "./draw";
import { DISPLAY_DELAY_MS, kneeWidth, nextScale } from "./geometry";
import { compHistory, latestOf, pointAt } from "./history";

/** Room over the plot, under it (the controls' floor), and at the right for the scale. */
export const PLOT_TOP = 10;
const PLOT_BOTTOM = 8;
export const GUTTER = 30;

/** The transfer curve the knee display draws: `[input, output]` dB from under the scale to 0 dB, the make-up in it. */
export function transferCurve(proC: ProC, scale: number): [number, number][] {
  const engine = engineProC(proC);
  const points: [number, number][] = [];
  const steps = 160;
  for (let i = 0; i <= steps; i++) {
    const level = -scale + (i / steps) * scale;
    points.push([level, level - staticReduction(engine, level) + engine.makeup]);
  }
  return points;
}

export function LevelDisplay({ effectId, proC, bypassed }: { effectId: string; proC: ProC; bypassed: boolean }) {
  const box = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState({ width: 800, height: 400 });
  const scale = proC.view.scale;
  const engine = useMemo(() => engineProC(proC), [proC]);
  const curve = useMemo(() => transferCurve(proC, scale), [proC, scale]);
  const plot = Math.max(20, size.height - PLOT_TOP - PLOT_BOTTOM);
  const knee = proC.view.knee ? kneeWidth(plot, size.width - GUTTER) : 0;

  // What the frame loop draws with (refs: it outlives renders).
  const scene = useRef({ proC, engine, curve, knee, plot, size, bypassed });
  scene.current = { proC, engine, curve, knee, plot, size, bypassed };
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
      const history = compHistory(effectId);
      // Scrolling while points come, still once they stop (the song stopped: nothing comes through).
      const head = history ? Math.min(now - DISPLAY_DELAY_MS, pointAt(history, history.last)) : 0;
      const live = latestOf(history, now);
      if (!dirty.current && Math.abs(head - lastHead) < 0.5 && !!live === wasLive) return;
      dirty.current = false;
      lastHead = head;
      wasLive = !!live;
      const s = scene.current;
      const ctx = prepare(element, s.size.width, s.size.height);
      if (!ctx) return;
      const vintage = isVintage(s.proC.style);
      const threshold = vintage ? null : (live?.threshold ?? s.engine.curve.threshold);
      const kneeScene: KneeScene | null =
        s.knee > 0
          ? {
              width: s.knee,
              curve: s.curve,
              threshold,
              live: live && live.level > -119 ? { level: live.level, output: live.level - staticReduction(s.engine, live.level) + s.engine.makeup } : null,
            }
          : null;
      drawLevel(ctx, {
        width: s.size.width,
        height: s.size.height,
        top: PLOT_TOP,
        plot: s.plot,
        gutter: GUTTER,
        scale: s.proC.view.scale,
        palette: readCompPalette(element),
        history,
        head,
        threshold,
        bypassed: s.bypassed,
        knee: kneeScene,
      });
    };
    frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
  }, [effectId]);

  const tab = "absolute z-10 flex flex-col items-center gap-1 rounded-r-md border border-l-0 border-[var(--comp-panel-edge)] bg-[var(--comp-knee-bg)] px-[3px] py-2 text-[9px] font-semibold tracking-[0.18em] text-[var(--comp-label)] outline-none hover:text-[var(--comp-text)]";
  return (
    <div ref={box} className="absolute inset-0" data-testid="pro-c-display">
      <canvas ref={canvas} className="absolute inset-0 size-full" />
      <button
        type="button"
        aria-label={proC.view.knee ? "Hide the knee display" : "Show the knee display"}
        aria-pressed={proC.view.knee}
        data-testid="pro-c-knee-tab"
        className={tab}
        style={{ left: knee, top: PLOT_TOP + Math.max(8, plot * 0.18) }}
        onClick={() => setProC(effectId, { view: { knee: !proC.view.knee } })}
      >
        {proC.view.knee ? <PiCaretDoubleLeft className="size-2.5" /> : <PiCaretDoubleRight className="size-2.5" />}
        <span className="[writing-mode:vertical-rl]">KNEE</span>
      </button>
      <ScaleButton effectId={effectId} scale={scale} className="absolute" style={{ right: GUTTER + 6, bottom: PLOT_BOTTOM + 4 }} />
    </div>
  );
}

/** The meter scale (Pro-C's "36 dB" button): a click steps through them, for the displays and the meters together. */
export function ScaleButton({ effectId, scale, className, style }: { effectId: string; scale: number; className?: string; style?: React.CSSProperties }) {
  return (
    <button
      type="button"
      aria-label={`Meter scale: ${scale} dB`}
      title="The displays' and meters' scale: click for the next"
      data-testid="pro-c-scale"
      className={cn("z-10 rounded-[4px] border border-[var(--comp-panel-edge)] bg-black/45 px-1.5 py-0.5 text-[10.5px] font-semibold text-[var(--comp-text)] tabular-nums outline-none hover:bg-black/65", className)}
      style={style}
      onClick={() => setProC(effectId, { view: { scale: nextScale(scale) } })}
    >
      {scale} dB
    </button>
  );
}
