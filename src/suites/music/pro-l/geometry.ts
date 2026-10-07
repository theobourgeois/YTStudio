/**
 * YT-L's displays on screen (`docs/fabfilter/pro-l.md` §2.6, §2.7): the level display (dB down from 0 at the top
 * to the meter scale's bottom, the gain reduction hanging from the top, time scrolling right to left), the meters
 * and the loudness panel's bar. Pure, so it's tested; `draw.ts` draws with it.
 */
import { clamp } from "@shared/math";
import type { ProLDisplayMode, ProLMeter, ProLMeterScale } from "@shared/music/types";

/** How many dB a scale shows, and where its 0 mark is (the K-System's at −12, −14 or −20 dBFS). */
export function scaleRange(scale: ProLMeterScale): { range: number; zero: number } {
  switch (scale) {
    case "16":
      return { range: 16, zero: 0 };
    case "32":
      return { range: 32, zero: 0 };
    case "k12":
      return { range: 32, zero: -12 };
    case "k14":
      return { range: 34, zero: -14 };
    case "k20":
      return { range: 40, zero: -20 };
    default:
      return { range: 48, zero: 0 };
  }
}

/**
 * Where a level (dB) is down a plot `height` px tall from `top`: Pro-L's scales give their top few dB more of the
 * height ("linear precision in the upper part"): the top quarter of the range takes half of it.
 */
export function dbY(db: number, range: number, top: number, height: number): number {
  const f = clamp(-db / range, 0, 1);
  const shaped = f <= 0.25 ? f * 2 : 0.5 + ((f - 0.25) / 0.75) * 0.5;
  return top + shaped * height;
}
/** The level (dB) at `y`: `dbY`'s inverse. */
export function yDb(y: number, range: number, top: number, height: number): number {
  const shaped = clamp((y - top) / height, 0, 1);
  const f = shaped <= 0.5 ? shaped / 2 : 0.25 + ((shaped - 0.5) / 0.5) * 0.75;
  return -f * range;
}

/** The labelled steps of a scale, 0 first: 0, −1, −2, −3 then every 3 (16 and 32 dB) or 6 dB (48). */
export function scaleSteps(range: number): number[] {
  const fine = range <= 16 ? [0, -1, -2, -3, -4] : [0, -1, -2, -3];
  const step = range <= 16 ? 2 : range <= 40 ? 3 : 6;
  const steps = [...fine];
  for (let db = -6; db >= -range - 1e-9; db -= step) steps.push(db);
  return steps;
}

/** How many seconds the display shows across, by its mode (Infinite: everything kept; Off: none). */
export function displaySeconds(mode: ProLDisplayMode, kept: number): number {
  switch (mode) {
    case "fast":
      return 3;
    case "slow":
      return 12;
    case "slowDown":
      return 6;
    case "infinite":
      return Math.max(6, kept);
    default:
      return 0;
  }
}
/**
 * Slow Down: the newest column's place across the display (0..1 from its left) while the display fills, then
 * it stays at the right edge; Fast and Slow scroll from the start, as Pro-L 2's do.
 */
export function headFraction(mode: ProLDisplayMode, shownSeconds: number, measuredSeconds: number): number {
  if (mode !== "slowDown" && mode !== "infinite") return 1;
  return clamp(measuredSeconds / Math.max(1e-6, shownSeconds), 0.02, 1);
}

// ---------------------------------------------------------------------------
// Meters and loudness
// ---------------------------------------------------------------------------

/** A level (linear, 1 full scale) in dB; silence is −120. */
export const linearDb = (v: number) => (v > 1e-6 ? 20 * Math.log10(v) : -120);
/** A peak readout: "−∞" for silence, else one decimal. */
export const peakText = (db: number) => (db <= -119 ? "−∞" : `${db > 0.05 ? "+" : db < -0.05 ? "−" : ""}${Math.abs(db).toFixed(1)}`);
/** A loudness readout: "—" for nothing yet, else one decimal. */
export const loudnessText = (lufs: number) => (lufs <= -119 ? "—" : `${lufs < -0.05 ? "−" : ""}${Math.abs(lufs).toFixed(1)}`);

/** The loudness bar's span (LUFS): from `range` × 2 under the target to `range` over it (+9: 9 over, 27 under). */
export function loudnessSpan(meter: Pick<ProLMeter, "target" | "loudnessRange">): { low: number; high: number } {
  return { low: meter.target - meter.loudnessRange * 3, high: meter.target + meter.loudnessRange };
}
/** How full the loudness bar is at a level (LUFS). */
export function loudnessFraction(lufs: number, meter: Pick<ProLMeter, "target" | "loudnessRange">): number {
  const { low, high } = loudnessSpan(meter);
  return clamp((lufs - low) / (high - low), 0, 1);
}
/** The loudness's colour band (§2.7): well under the target, near it (within 1 LU under), or over it. */
export function loudnessZone(lufs: number, target: number): "low" | "near" | "over" {
  if (lufs > target + 0.05) return "over";
  return lufs >= target - 1 ? "near" : "low";
}
/** A loudness shown absolute (LUFS) or against the target (LU). */
export const relativeTo = (lufs: number, meter: Pick<ProLMeter, "target" | "relative">) => (meter.relative && lufs > -119 ? lufs - meter.target : lufs);
