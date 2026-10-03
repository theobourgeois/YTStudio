/**
 * Pro-C's meters (`docs/fabfilter/pro-c.md` 2.7): gain reduction (red, from the top), input and output
 * (each side), the highest peaks read out above them (a click resets a readout); in Compact, horizontal
 * rows under the controls. Drawn each frame from what the engine last said (`history.ts`), falling once
 * it stops saying (the mixer's meters fall the same way), so nothing re-renders as levels come.
 */
import { useEffect, useRef } from "react";
import { prepare } from "../piano/draw";
import { drawCompactMeters, drawMeters, readCompPalette } from "./draw";
import { linearDb, peakText } from "./geometry";
import { compHistory, latestOf } from "./history";

/** dB a second a level falls once it's gone, and how long a peak marker holds (ms). */
const FALL = 26;
const HOLD_MS = 1500;

/** The meters' levels, falling: kept between frames. */
class Levels {
  input: [number, number] = [-120, -120];
  output: [number, number] = [-120, -120];
  outputPeak: [number, number] = [-120, -120];
  peakAt: [number, number] = [0, 0];
  reduction = 0;
  reductionPeak = 0;
  reductionAt = 0;
  /** The readouts: the highest since they were reset. */
  maxReduction = 0;
  maxOutput = -120;
  last = performance.now();

  /** Move on to `now`: rise to what's heard at once, fall at FALL; returns whether anything changed. */
  step(effectId: string, now: number): boolean {
    const dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    const live = latestOf(compHistory(effectId), now);
    const before = JSON.stringify([this.input, this.output, this.reduction, this.outputPeak, this.reductionPeak]);
    const fall = (from: number, to: number) => (to >= from ? to : Math.max(to, from - FALL * dt));
    for (let i = 0; i < 2; i++) {
      const input = live ? linearDb(live.input[i]) : -120;
      const output = live ? linearDb(live.output[i]) : -120;
      this.input[i] = fall(this.input[i], input);
      this.output[i] = fall(this.output[i], output);
      if (output >= this.outputPeak[i] || now - this.peakAt[i] > HOLD_MS) {
        this.outputPeak[i] = output >= this.outputPeak[i] ? output : fall(this.outputPeak[i], output);
        if (output >= this.outputPeak[i]) this.peakAt[i] = now;
      }
      this.maxOutput = Math.max(this.maxOutput, output);
    }
    const reduction = live ? Math.max(0, live.reduction) : 0;
    this.reduction = reduction >= this.reduction ? reduction : Math.max(reduction, this.reduction - FALL * 2 * dt);
    if (reduction >= this.reductionPeak) {
      this.reductionPeak = reduction;
      this.reductionAt = now;
    } else if (now - this.reductionAt > HOLD_MS) this.reductionPeak = Math.max(reduction, this.reductionPeak - FALL * dt);
    this.maxReduction = Math.max(this.maxReduction, reduction);
    return before !== JSON.stringify([this.input, this.output, this.reduction, this.outputPeak, this.reductionPeak]);
  }
}

/** The vertical meters at the window's right, with their readouts. */
export function Meters({ effectId, scale, top, bottom }: { effectId: string; scale: number; top: number; bottom: number }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const levels = useRef(new Levels());
  const reductionText = useRef<HTMLButtonElement>(null);
  const outputText = useRef<HTMLButtonElement>(null);
  const scaleRef = useRef(scale);
  scaleRef.current = scale;

  useEffect(() => {
    let frame = 0;
    let lastScale = -1;
    let lastTexts = "";
    const draw = () => {
      frame = requestAnimationFrame(draw);
      const element = canvas.current;
      if (!element) return;
      const l = levels.current;
      const moved = l.step(effectId, performance.now());
      const texts = `${l.maxReduction}|${l.maxOutput}`;
      if (texts !== lastTexts) {
        lastTexts = texts;
        if (reductionText.current) reductionText.current.textContent = l.maxReduction > 0.05 ? `−${l.maxReduction.toFixed(1)}` : "0.0";
        if (outputText.current) outputText.current.textContent = peakText(l.maxOutput);
      }
      if (!moved && lastScale === scaleRef.current) return;
      lastScale = scaleRef.current;
      const width = element.clientWidth;
      const height = element.clientHeight;
      const ctx = prepare(element, width, height);
      if (!ctx) return;
      drawMeters(ctx, { width, height, top, plot: Math.max(10, height - top - bottom), scale: scaleRef.current, palette: readCompPalette(element), ...l });
    };
    frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
  }, [effectId, top, bottom]);

  const readout = "w-full rounded-sm text-center text-[10px] leading-4 tabular-nums outline-none hover:bg-white/5";
  return (
    <div className="relative flex w-[54px] shrink-0 flex-col border-l border-black/50 bg-[var(--comp-section)]" data-testid="pro-c-meters">
      <div className="flex h-5 shrink-0 items-center gap-0.5 px-0.5 pt-1">
        <button ref={reductionText} type="button" title="The most gain reduction (click to reset)" className={`${readout} text-[var(--comp-reduction)]`} onClick={() => (levels.current.maxReduction = 0)}>
          0.0
        </button>
        <button ref={outputText} type="button" title="The output's highest peak (click to reset)" className={`${readout} text-[var(--comp-text)]`} onClick={() => (levels.current.maxOutput = -120)}>
          −∞
        </button>
      </div>
      <canvas ref={canvas} className="min-h-0 w-full flex-1" />
    </div>
  );
}

/** Compact's meters: the gain change and the output as rows across, with the scale under them. */
export function CompactMeters({ effectId, scale }: { effectId: string; scale: number }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const levels = useRef(new Levels());
  const scaleRef = useRef(scale);
  scaleRef.current = scale;
  useEffect(() => {
    let frame = 0;
    let lastScale = -1;
    const draw = () => {
      frame = requestAnimationFrame(draw);
      const element = canvas.current;
      if (!element) return;
      const l = levels.current;
      const moved = l.step(effectId, performance.now());
      if (!moved && lastScale === scaleRef.current) return;
      lastScale = scaleRef.current;
      const width = element.clientWidth;
      const height = element.clientHeight;
      const ctx = prepare(element, width, height);
      if (ctx) drawCompactMeters(ctx, { width, height, scale: scaleRef.current, palette: readCompPalette(element), left: 72, right: width - 44, ...l });
    };
    frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
  }, [effectId]);
  return <canvas ref={canvas} className="h-[42px] w-full" data-testid="pro-c-compact-meters" />;
}
