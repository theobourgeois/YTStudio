/**
 * YT-L's meters and loudness panel (`docs/fabfilter/pro-l.md` §2.6, §2.7): the gain reduction (red, from the top)
 * and the output (each side, true peaks or sample peaks, its Momentary paler), their readouts above them (a click
 * resets the measurement); and the loudness panel: the chosen loudness large, M, S and I as bars against the
 * target, the most of each, the loudness range, PLR, pause and reset. Drawn each frame from what the engine last
 * said (`history.ts`), falling once it stops saying, so nothing re-renders as levels come.
 */
import { useEffect, useRef } from "react";
import { PiArrowCounterClockwise, PiCaretDown, PiPause } from "react-icons/pi";
import { cn } from "cn";
import { PRO_L_TARGETS } from "@shared/music/pro-l-presets";
import type { EngineProLState } from "@shared/music/engine";
import type { ProL, ProLTimeScale } from "@shared/music/types";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { prepare } from "../piano/draw";
import { pauseMeter, resetMeter, setProL } from "./actions";
import { drawLoudness, drawMeters, readLimPalette } from "./draw";
import { linearDb, loudnessText, peakText, relativeTo, scaleRange } from "./geometry";
import { latestOf, limHistory, limReading } from "./history";

/** dB a second a level falls once it's gone, and how long a peak marker holds (ms). */
const FALL = 26;
const HOLD_MS = 1500;

/** The meters' levels, falling: kept between frames. */
class Levels {
  output: [number, number] = [-120, -120];
  rms: [number, number] = [-120, -120];
  peak: [number, number] = [-120, -120];
  peakAt: [number, number] = [0, 0];
  reduction: [number, number] = [0, 0];
  last = performance.now();

  step(live: EngineProLState | null, truePeak: boolean, now: number): boolean {
    const dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    const before = JSON.stringify([this.output, this.rms, this.peak, this.reduction]);
    const fall = (from: number, to: number) => (to >= from ? to : Math.max(to, from - FALL * dt));
    for (let i = 0; i < 2; i++) {
      const output = live ? linearDb((truePeak ? live.truePeak : live.output)[i]) : -120;
      this.output[i] = fall(this.output[i], output);
      this.rms[i] = fall(this.rms[i], live ? live.rms[i] : -120);
      if (output >= this.peak[i]) {
        this.peak[i] = output;
        this.peakAt[i] = now;
      } else if (now - this.peakAt[i] > HOLD_MS) this.peak[i] = fall(this.peak[i], output);
      const reduction = live ? Math.max(0, live.reduction) : 0;
      this.reduction[i] = reduction >= this.reduction[i] ? reduction : Math.max(reduction, this.reduction[i] - FALL * 2 * dt);
    }
    return before !== JSON.stringify([this.output, this.rms, this.peak, this.reduction]);
  }
}

/** The output and reduction meters at the display's right, with their readouts. */
export function Meters({ effectId, proL, top, bottom }: { effectId: string; proL: ProL; top: number; bottom: number }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const levels = useRef(new Levels());
  const reductionText = useRef<HTMLButtonElement>(null);
  const outputText = useRef<HTMLButtonElement>(null);
  const settings = useRef(proL);
  settings.current = proL;

  useEffect(() => {
    let frame = 0;
    let lastKey = "";
    const draw = () => {
      frame = requestAnimationFrame(draw);
      const element = canvas.current;
      if (!element) return;
      const now = performance.now();
      const p = settings.current;
      const live = latestOf(limHistory(effectId), now);
      const moved = levels.current.step(live, p.meter.truePeakMeter, now);
      const reading = limReading(effectId);
      if (reading && reductionText.current && outputText.current) {
        reductionText.current.textContent = reading.maxReduction + reading.maxClip > 0.05 ? `−${(reading.maxReduction + reading.maxClip).toFixed(1)}` : "0.0";
        const most = p.meter.truePeakMeter ? reading.loudness.maxTruePeak : linearDb(Math.max(...reading.output));
        outputText.current.textContent = peakText(most);
        // Green when it's a true peak reading, orange over the Output Level, red over 0 dBTP (§2.6).
        outputText.current.dataset.zone = most > 0.005 ? "over" : most > p.output + 0.005 ? "hot" : p.meter.truePeakMeter ? "tp" : "";
      }
      const key = `${p.meter.scale}|${p.output}`;
      if (!moved && key === lastKey) return;
      lastKey = key;
      const width = element.clientWidth;
      const height = element.clientHeight;
      const ctx = prepare(element, width, height);
      if (!ctx) return;
      const l = levels.current;
      drawMeters(ctx, { width, height, top, plot: Math.max(10, height - top - bottom), range: scaleRange(p.meter.scale).range, output: l.output, rms: l.rms, peak: l.peak, reduction: l.reduction, ceiling: p.output, palette: readLimPalette(element) });
    };
    frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
  }, [effectId, top, bottom]);

  const readout = "w-full rounded-sm text-center text-[10px] leading-4 tabular-nums outline-none hover:bg-white/5";
  return (
    <div className="relative flex w-[64px] shrink-0 flex-col border-l border-black/50 bg-[var(--lim-section)]" data-testid="pro-l-meters">
      <div className="flex h-5 shrink-0 items-center gap-0.5 px-0.5 pt-1">
        <button ref={reductionText} type="button" title="The most gain reduction (click to reset the measurement)" className={`${readout} text-[var(--lim-reduction)]`} onClick={() => resetMeter(effectId)}>
          0.0
        </button>
        <button
          ref={outputText}
          type="button"
          title="The output's highest peak: green a true peak, orange over the Output Level, red over 0 dBTP (click to reset)"
          className={`${readout} text-[var(--lim-text)] data-[zone=hot]:text-[var(--lim-loud-near)] data-[zone=over]:text-[var(--lim-loud-over)] data-[zone=tp]:text-[var(--lim-meter)]`}
          onClick={() => resetMeter(effectId)}
          data-testid="pro-l-peak"
        >
          −∞
        </button>
      </div>
      <canvas ref={canvas} className="min-h-0 w-full flex-1" />
    </div>
  );
}

const TIME_SCALES: { id: ProLTimeScale; name: string; short: string }[] = [
  { id: "momentary", name: "Momentary", short: "M" },
  { id: "shortTerm", name: "Short Term", short: "S" },
  { id: "integrated", name: "Integrated", short: "I" },
];

/** The loudness panel at the window's right (§2.7). */
export function LoudnessPanel({ effectId, proL }: { effectId: string; proL: ProL }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const big = useRef<HTMLSpanElement>(null);
  const maxes = useRef<HTMLDivElement>(null);
  const range = useRef<HTMLDivElement>(null);
  const paused = useRef<HTMLButtonElement>(null);
  const settings = useRef(proL);
  settings.current = proL;
  const meter = proL.meter;

  useEffect(() => {
    let frame = 0;
    let lastKey = "";
    const draw = () => {
      frame = requestAnimationFrame(draw);
      const element = canvas.current;
      if (!element) return;
      const m = settings.current.meter;
      const reading = limReading(effectId)?.loudness;
      const momentary = reading?.momentary ?? -120;
      const shortTerm = reading?.shortTerm ?? -120;
      const integrated = reading?.integrated ?? -120;
      const main = m.timeScale === "momentary" ? momentary : m.timeScale === "shortTerm" ? shortTerm : integrated;
      const key = JSON.stringify([m, reading]);
      if (key === lastKey) return;
      lastKey = key;
      if (big.current) {
        big.current.textContent = loudnessText(relativeTo(main, m));
        big.current.dataset.zone = main <= -119 ? "" : main > m.target + 0.05 ? "over" : main >= m.target - 1 ? "near" : "low";
      }
      if (maxes.current && reading) {
        const most = m.timeScale === "integrated" ? (m.maxOf === "momentary" ? ["Max M", reading.maxMomentary] : ["Max S", reading.maxShortTerm]) : m.timeScale === "momentary" ? ["Max M", reading.maxMomentary] : ["Max S", reading.maxShortTerm];
        const plr = reading.integrated > -119 && reading.maxTruePeak > -119 ? (reading.maxTruePeak - reading.integrated).toFixed(1) : "—";
        maxes.current.textContent = `${most[0]} ${loudnessText(relativeTo(most[1] as number, m))}  ·  PLR ${plr}`;
      }
      if (range.current && reading) range.current.textContent = `LRA ${reading.range.toFixed(1)} LU${reading.seconds < 60 ? " …" : ""}  ·  ${Math.floor(reading.seconds / 60)}:${String(Math.floor(reading.seconds % 60)).padStart(2, "0")}`;
      if (paused.current) paused.current.dataset.paused = reading?.paused ? "true" : "false";
      const width = element.clientWidth;
      const height = element.clientHeight;
      const ctx = prepare(element, width, height);
      if (ctx) drawLoudness(ctx, { width, height, meter: m, main, momentary, shortTerm, integrated, palette: readLimPalette(element) });
    };
    frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
  }, [effectId]);

  const button = "rounded-sm p-1 text-[var(--lim-label)] outline-none hover:bg-white/5 hover:text-[var(--lim-text)]";
  return (
    <div className="flex w-[118px] shrink-0 flex-col gap-1 border-l border-black/50 bg-[var(--lim-section)] px-1.5 py-1" data-testid="pro-l-loudness">
      <div className="flex items-center justify-between">
        <button
          ref={paused}
          type="button"
          aria-label="Pause the measurement"
          title="Pause the measurement (Integrated, the range and the maxima stop; the meters carry on)"
          className={cn(button, "data-[paused=true]:text-[var(--lim-loud-near)]")}
          onClick={() => pauseMeter(effectId, !(limReading(effectId)?.loudness.paused ?? false))}
        >
          <PiPause className="size-3" />
        </button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button type="button" aria-label="Loudness time scale" className="flex items-center gap-0.5 rounded-sm px-1 py-0.5 text-[10.5px] outline-none hover:bg-white/5">
              {TIME_SCALES.find((t) => t.id === meter.timeScale)!.name}
              <PiCaretDown className="size-2.5 text-[var(--lim-label)]" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="center">
            <DropdownMenuRadioGroup value={meter.timeScale} onValueChange={(v) => setProL(effectId, { meter: { timeScale: v as ProLTimeScale } })}>
              {TIME_SCALES.map((t) => (
                <DropdownMenuRadioItem key={t.id} value={t.id}>
                  {t.name}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
            {meter.timeScale === "integrated" && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuRadioGroup value={meter.maxOf} onValueChange={(v) => setProL(effectId, { meter: { maxOf: v as ProL["meter"]["maxOf"] } })}>
                  <DropdownMenuRadioItem value="shortTerm">Show Max Short Term</DropdownMenuRadioItem>
                  <DropdownMenuRadioItem value="momentary">Show Max Momentary</DropdownMenuRadioItem>
                </DropdownMenuRadioGroup>
              </>
            )}
            <DropdownMenuSeparator />
            <DropdownMenuCheckboxItem checked={meter.autoReset} onCheckedChange={(on) => setProL(effectId, { meter: { autoReset: on === true } })}>
              Auto-Reset when play starts
            </DropdownMenuCheckboxItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <button type="button" aria-label="Reset the measurement" title="Reset: Integrated, the range, the maxima and the peak readouts start again" className={button} onClick={() => resetMeter(effectId)}>
          <PiArrowCounterClockwise className="size-3" />
        </button>
      </div>
      <div className="flex items-baseline justify-center gap-1">
        <span ref={big} className="text-[22px] font-semibold tabular-nums data-[zone=near]:text-[var(--lim-loud-near)] data-[zone=over]:text-[var(--lim-loud-over)]" data-testid="pro-l-loudness-value">
          —
        </span>
        <span className="text-[9.5px] text-[var(--lim-label)]">{meter.relative ? "LU" : "LUFS"}</span>
      </div>
      <div ref={maxes} className="text-center text-[9.5px] text-[var(--lim-label)] tabular-nums" />
      <canvas ref={canvas} className="min-h-0 w-full flex-1" />
      <div ref={range} className="text-center text-[9.5px] text-[var(--lim-label)] tabular-nums" data-testid="pro-l-lra" />
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button type="button" aria-label="Loudness target" data-testid="pro-l-target" className="flex items-center justify-center gap-0.5 rounded-sm px-1 py-0.5 text-[10.5px] outline-none hover:bg-white/5">
            <span className="text-[var(--lim-target)]">{meter.target}</span>
            <span className="text-[var(--lim-label)]">{PRO_L_TARGETS.find((t) => t.lufs === meter.target)?.name ?? "LUFS"}</span>
            <PiCaretDown className="size-2.5 text-[var(--lim-label)]" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="center">
          <DropdownMenuLabel>Loudness target (Integrated)</DropdownMenuLabel>
          <DropdownMenuRadioGroup value={String(meter.target)} onValueChange={(v) => setProL(effectId, { meter: { target: Number(v) } })}>
            {PRO_L_TARGETS.map((t) => (
              <DropdownMenuRadioItem key={t.lufs} value={String(t.lufs)}>
                {t.lufs} LUFS <span className="ml-auto pl-3 text-[10px] text-muted-foreground">{t.name}</span>
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
          <DropdownMenuSeparator />
          <DropdownMenuRadioGroup value={String(meter.loudnessRange)} onValueChange={(v) => setProL(effectId, { meter: { loudnessRange: Number(v) as 9 | 18 } })}>
            <DropdownMenuRadioItem value="9">Scale +9</DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="18">Scale +18</DropdownMenuRadioItem>
          </DropdownMenuRadioGroup>
          <DropdownMenuCheckboxItem checked={meter.relative} onCheckedChange={(on) => setProL(effectId, { meter: { relative: on === true } })}>
            Relative to the target (LU)
          </DropdownMenuCheckboxItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

