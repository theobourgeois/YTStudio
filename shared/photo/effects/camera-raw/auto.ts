/**
 * Camera Raw's Auto (docs/photo/camera-raw.md, "CR3"): Light's six sliders and Vibrance set from the picture before
 * Camera Raw. Adobe's Auto is a learned model (and erratic on CR0's synthetic charts), so ours is a rule a person
 * would follow, from the picture's tones: the median towards a middle grey (Exposure), the ends towards black and
 * white (Blacks, Whites), clipped highlights pulled back and deep shadows opened (Highlights, Shadows), a flat
 * picture given Contrast and a dull one Vibrance. Moves are kept moderate: Auto is a start, not a finish.
 */
import { linearToSrgb } from "../../colour.ts";

/** What Auto sets (the rest stays as it is). */
export interface AutoSettings {
  exposure: number;
  contrast: number;
  highlights: number;
  shadows: number;
  whites: number;
  blacks: number;
  vibrance: number;
}

/** A picture's tones as Auto reads them: sRGB-encoded luminance percentiles, clipped shares, mean saturation. */
export interface AutoStats {
  p01: number;
  p05: number;
  median: number;
  p95: number;
  p99: number;
  /** Shares of pixels with a channel at white, and black in every channel. */
  clippedHighlights: number;
  clippedShadows: number;
  /** Mean HSV saturation of encoded colour (0..1). */
  saturation: number;
}

/** The statistics of premultiplied linear RGBA pixels (transparent ones left out); null when none are seen. */
export function autoStats(data: Float32Array): AutoStats | null {
  const bins = new Float64Array(1024);
  let n = 0;
  let clippedHi = 0;
  let clippedLo = 0;
  let sat = 0;
  for (let i = 0; i < data.length; i += 4) {
    const a = data[i + 3];
    if (!(a > 0.01)) continue;
    const r = linearToSrgb(Math.max(0, data[i] / a));
    const g = linearToSrgb(Math.max(0, data[i + 1] / a));
    const b = linearToSrgb(Math.max(0, data[i + 2] / a));
    const y = linearToSrgb(Math.max(0, (0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]) / a));
    bins[Math.max(0, Math.min(1023, Math.floor(y * 1023.999)))]++;
    const hi = Math.max(r, g, b);
    const lo = Math.min(r, g, b);
    if (hi >= 0.998) clippedHi++;
    if (hi <= 0.004) clippedLo++;
    sat += hi > 0 ? (Math.min(1, hi) - Math.min(1, lo)) / Math.min(1, hi) : 0;
    n++;
  }
  if (!n) return null;
  const at = (q: number) => {
    let seen = 0;
    for (let k = 0; k < 1024; k++) {
      seen += bins[k];
      if (seen >= q * n) return (k + 0.5) / 1024;
    }
    return 1;
  };
  return { p01: at(0.01), p05: at(0.05), median: at(0.5), p95: at(0.95), p99: at(0.99), clippedHighlights: clippedHi / n, clippedShadows: clippedLo / n, saturation: sat / n };
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const round = (v: number, step = 1) => Math.round(v / step) * step;
const toLinear = (e: number) => (e <= 0.04045 ? e / 12.92 : ((e + 0.055) / 1.055) ** 2.4);

/** Auto's settings for a picture with these statistics. */
export function autoSettings(s: AutoStats): AutoSettings {
  // Exposure: the median towards a middle grey (sRGB 0.46), two-thirds of the way, within ±2 stops.
  const exposure = clamp(round((2 / 3) * Math.log2(toLinear(0.46) / Math.max(toLinear(s.median), 1e-4)), 0.05), -2, 2);
  const lift = (e: number) => linearToSrgb(Math.min(1, toLinear(e) * 2 ** exposure));
  const [p01, p05, p95, p99] = [lift(s.p01), lift(s.p05), lift(s.p95), lift(s.p99)];
  // Whites and Blacks: the ends towards white and black (not past them).
  const whites = clamp(round((0.97 - p99) * 150), -40, 40);
  const blacks = clamp(round((0.02 - p01) * 250), -40, 25);
  // Highlights pulled back as much as they clip (and when exposure pushed them up); deep shadows opened.
  const clipped = Math.max(s.clippedHighlights, exposure > 0 ? clamp((p95 - 0.9) * 2, 0, 1) : 0);
  const highlights = clamp(round(-clipped * 400 - Math.max(0, p95 - 0.85) * 150), -70, 0);
  const shadows = clamp(round(Math.max(0, 0.18 - p05) * 250), 0, 50);
  // Contrast: a flat picture (its middle 90% in a short range) gets some; a hard one a little less.
  const spread = p95 - p05;
  const contrast = clamp(round((0.7 - spread) * 60), -15, 30);
  // Vibrance: a dull picture more than a colourful one.
  const vibrance = clamp(round((0.35 - s.saturation) * 80), 0, 25);
  return { exposure, contrast, highlights, shadows, whites, blacks, vibrance };
}
