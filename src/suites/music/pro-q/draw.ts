/**
 * Drawing Pro-Q's display (`docs/fabfilter/pro-q.md`, FabFilter's look): the analyzer behind (the sound
 * before it a darker fill, after it a lighter one with a line, another Pro-Q's in red), the grid, each
 * band's curve in its colour (filled while it's selected or under the pointer; a dynamic band's range
 * between two curves), each placement's result curve, the thick yellow curve of the whole EQ, the dots,
 * the yellow EQ scale and the grey analyzer scale, the frequency scale or the piano, the output meter.
 * The colours are the theme's `--eq-*` tokens, read again when the theme changes.
 */
import { EQ_SPECTRUM_POINTS, hasGain, spectrumFrequency } from "@shared/music/pro-q-presets";
import { type BandFilter, bandSections, responseAt } from "@shared/music/pro-q-filters";
import type { EqBand, EqPlacement } from "@shared/music/types";
import { type EqView, analyzerSteps, analyzerY, dbAt, dotOf, frequencyLines, gainSteps, hzAt, xOf, yOf, zeroY, DOT } from "./geometry";

// ---------------------------------------------------------------------------
// Colours
// ---------------------------------------------------------------------------

/** Each band's colour, by its number (Pro-Q's: 1 green, 2 blue, 5 violet...; a number keeps its colour). */
export const BAND_COLOURS = [
  "#58e04f",
  "#3d9cf5",
  "#f24848",
  "#e04fd6",
  "#8452f7",
  "#2fc6ee",
  "#2ee0ad",
  "#c6e93a",
  "#f5993d",
  "#f26ba3",
  "#8fe085",
  "#5b7cf7",
  "#38d17a",
  "#4fb4ff",
  "#ff7a5c",
  "#c45cf2",
  "#a77bff",
  "#5ce0e6",
  "#7af2c4",
  "#e6d94a",
  "#ffb066",
  "#ff8fbd",
  "#b8f0a8",
  "#8ca2ff",
] as const;
export const bandColour = (id: number) => BAND_COLOURS[(id - 1) % BAND_COLOURS.length];

export interface EqPalette {
  bgTop: string;
  bgBottom: string;
  grid: string;
  gridStrong: string;
  zero: string;
  label: string;
  text: string;
  curve: string;
  pre: string;
  post: string;
  postLine: string;
  external: string;
  collision: string;
  grab: string;
  meter: string;
  meterHot: string;
  dynamic: string;
  placements: Record<EqPlacement, string>;
}

let cached: { key: string; palette: EqPalette } | null = null;
export function readEqPalette(element: Element): EqPalette {
  const key = `${document.documentElement.className}`;
  if (cached?.key === key) return cached.palette;
  const style = getComputedStyle(element);
  const read = (name: string) => style.getPropertyValue(`--eq-${name}`).trim();
  const palette: EqPalette = {
    bgTop: read("bg-top"),
    bgBottom: read("bg-bottom"),
    grid: read("grid"),
    gridStrong: read("grid-strong"),
    zero: read("zero"),
    label: read("label"),
    text: read("text"),
    curve: read("curve"),
    pre: read("pre"),
    post: read("post"),
    postLine: read("post-line"),
    external: read("external"),
    collision: read("collision"),
    grab: read("grab"),
    meter: read("meter"),
    meterHot: read("meter-hot"),
    dynamic: read("dynamic"),
    placements: { stereo: read("curve"), left: read("left"), right: read("right"), mid: read("mid"), side: read("side") },
  };
  cached = { key, palette };
  return palette;
}

/** `colour` at `alpha` (a #rrggbb colour). */
export function alpha(colour: string, a: number): string {
  const n = Number.parseInt(colour.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}

// ---------------------------------------------------------------------------
// Curves (cached: a band's curve is worked out once for its settings and the frequencies shown)
// ---------------------------------------------------------------------------

const curveCache = new WeakMap<Float64Array, Map<string, Float64Array>>();
/** A band's level in dB at each of `frequencies`, at `gain`. */
export function curveOf(band: BandFilter, gain: number, frequencies: Float64Array): Float64Array {
  let cache = curveCache.get(frequencies);
  if (!cache) {
    cache = new Map();
    curveCache.set(frequencies, cache);
  }
  const key = `${band.shape}|${band.slope}|${band.frequency}|${band.q}|${gain}`;
  let curve = cache.get(key);
  if (!curve) {
    if (cache.size > 400) cache.clear();
    const sections = bandSections(band, gain);
    curve = new Float64Array(frequencies.length);
    for (let i = 0; i < frequencies.length; i++) {
      const [re, im] = responseAt(sections, frequencies[i]);
      curve[i] = 10 * Math.log10(re * re + im * im || 1e-30);
    }
    cache.set(key, curve);
  }
  return curve;
}

// ---------------------------------------------------------------------------
// The analyzer's ballistics (in the tab: the engine says levels, the display falls at its speed)
// ---------------------------------------------------------------------------

/** How fast a peak falls, dB a second, at each speed. */
export const FALL_RATES = { verySlow: 12, slow: 24, medium: 48, fast: 90, veryFast: 160 } as const;

/** A spectrum as drawn: each point rises to what's heard at once and falls at the speed (or holds, frozen). */
export class Ballistics {
  readonly levels = new Float32Array(EQ_SPECTRUM_POINTS).fill(-200);
  private last: readonly number[] | null = null;
  private at = 0;

  /** Take `fresh` levels (the same array as last time: nothing new) at `now` (ms). */
  update(fresh: readonly number[] | null, now: number, rate: number, freeze: boolean) {
    const dt = this.at ? Math.min(0.1, (now - this.at) / 1000) : 0;
    this.at = now;
    const fall = freeze ? 0 : rate * dt;
    const isNew = fresh !== null && fresh !== this.last;
    this.last = fresh;
    for (let i = 0; i < this.levels.length; i++) {
      const v = this.levels[i] - fall;
      this.levels[i] = isNew ? Math.max(fresh![i] ?? -200, v) : v;
      if (this.levels[i] < -200) this.levels[i] = -200;
    }
  }
  /** Something to draw (not all fallen away). */
  get visible() {
    for (const v of this.levels) if (v > -150) return true;
    return false;
  }
}

// ---------------------------------------------------------------------------
// The scene
// ---------------------------------------------------------------------------

export interface DynamicLive {
  /** The gain the band's dynamics add now (dB), and the level in its range (dB). */
  gain: number;
  level: number;
}

export interface EqScene {
  view: EqView;
  palette: EqPalette;
  /** The bands as they're heard (Gain Scale applied, Gain-Q's Q), in their numbers' order. */
  bands: EqBand[];
  frequencies: Float64Array;
  selected: ReadonlySet<number>;
  hover: number | null;
  /** The live gains of dynamic bands (by number), while the engine says. */
  live: ReadonlyMap<number, DynamicLive>;
  /** The whole slot bypassed: the display dimmed. */
  bypassed: boolean;
  /** A band soloed: the others dimmed, its region lit. */
  solo: number | null;
  spectra: { pre: Float32Array | null; post: Float32Array | null; external: Float32Array | null; tilt: number; grab: boolean };
  /** Peaks labelled while Spectrum Grab holds the spectrum (frequency, level in dB). */
  peaks: { hz: number; db: number }[];
  /** The output's peak per side (0..1+). */
  meter: [number, number];
  /** The frequency under the pointer (shown on the scale), the rubber band, the piano. */
  pointerHz: number | null;
  rubber: { x0: number; y0: number; x1: number; y1: number } | null;
  piano: boolean;
  /** Room on the right for the scales and the meter. */
  scaleWidth: number;
}

const FONT = "10px 'DM Sans', system-ui, sans-serif";

export function drawScene(ctx: CanvasRenderingContext2D, scene: EqScene) {
  const { view, palette } = scene;
  const { width, height } = view;
  ctx.save();
  ctx.clearRect(0, 0, width + scene.scaleWidth, height);
  const gradient = ctx.createLinearGradient(0, 0, 0, height);
  gradient.addColorStop(0, palette.bgTop);
  gradient.addColorStop(1, palette.bgBottom);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width + scene.scaleWidth, height);

  drawSpectra(ctx, scene);
  drawGrid(ctx, scene);
  if (scene.solo !== null) drawSoloRegion(ctx, scene);
  drawBands(ctx, scene);
  drawDots(ctx, scene);
  drawScales(ctx, scene);
  drawMeter(ctx, scene);
  if (scene.rubber) {
    const { x0, y0, x1, y1 } = scene.rubber;
    ctx.fillStyle = alpha(palette.curve, 0.08);
    ctx.strokeStyle = alpha(palette.curve, 0.6);
    ctx.lineWidth = 1;
    ctx.fillRect(Math.min(x0, x1), Math.min(y0, y1), Math.abs(x1 - x0), Math.abs(y1 - y0));
    ctx.strokeRect(Math.min(x0, x1) + 0.5, Math.min(y0, y1) + 0.5, Math.abs(x1 - x0), Math.abs(y1 - y0));
  }
  if (scene.bypassed) {
    ctx.fillStyle = "rgba(10, 8, 12, 0.45)";
    ctx.fillRect(0, 0, width + scene.scaleWidth, height);
  }
  ctx.restore();
}

/** A spectrum's levels (tilted) as points across the display. */
function spectrumPath(scene: EqScene, levels: Float32Array, tilt: number): { x: number; y: number }[] {
  const { view } = scene;
  const points: { x: number; y: number }[] = [];
  const bottom = view.height - view.bottom;
  for (let i = 0; i < levels.length; i++) {
    const hz = spectrumFrequency(i);
    if (hz < view.low / 1.05 || hz > view.high * 1.05) continue;
    const db = levels[i] + tilt * Math.log2(hz / 1000);
    points.push({ x: xOf(view, hz), y: Math.min(bottom, analyzerY(view, db)) });
  }
  return points;
}

function fillSpectrum(ctx: CanvasRenderingContext2D, scene: EqScene, points: { x: number; y: number }[], fill: string, line: string | null) {
  if (points.length < 2) return;
  const bottom = scene.view.height - scene.view.bottom;
  ctx.beginPath();
  ctx.moveTo(points[0].x, bottom);
  for (const p of points) ctx.lineTo(p.x, p.y);
  ctx.lineTo(points[points.length - 1].x, bottom);
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
  if (line) {
    ctx.beginPath();
    points.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
    ctx.strokeStyle = line;
    ctx.lineWidth = 1;
    ctx.stroke();
  }
}

function drawSpectra(ctx: CanvasRenderingContext2D, scene: EqScene) {
  const { palette, spectra } = scene;
  if (spectra.pre) fillSpectrum(ctx, scene, spectrumPath(scene, spectra.pre, spectra.tilt), spectra.post ? palette.pre : alpha(palette.postLine, 0.35), null);
  if (spectra.post) {
    const grab = spectra.grab;
    fillSpectrum(ctx, scene, spectrumPath(scene, spectra.post, spectra.tilt), grab ? alpha(palette.grab, 0.85) : alpha(palette.post, 0.75), grab ? "#ffffff" : alpha(palette.postLine, 0.8));
  }
  if (spectra.external) {
    const points = spectrumPath(scene, spectra.external, spectra.tilt);
    ctx.beginPath();
    points.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
    ctx.strokeStyle = alpha(palette.external, 0.8);
    ctx.lineWidth = 1;
    ctx.stroke();
  }
}

function drawGrid(ctx: CanvasRenderingContext2D, scene: EqScene) {
  const { view, palette } = scene;
  const bottom = view.height - view.bottom;
  ctx.lineWidth = 1;
  for (const line of frequencyLines(view)) {
    const x = Math.round(xOf(view, line.hz)) + 0.5;
    ctx.strokeStyle = line.label ? palette.gridStrong : palette.grid;
    ctx.beginPath();
    ctx.moveTo(x, view.top);
    ctx.lineTo(x, bottom);
    ctx.stroke();
  }
  for (const db of gainSteps(view.range)) {
    const y = Math.round(yOf(view, db)) + 0.5;
    ctx.strokeStyle = db === 0 ? palette.zero : palette.grid;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(view.width, y);
    ctx.stroke();
  }
}

function drawSoloRegion(ctx: CanvasRenderingContext2D, scene: EqScene) {
  const band = scene.bands.find((b) => b.id === scene.solo);
  if (!band) return;
  const { view } = scene;
  // Roughly the band's width: its half-gain points for a Bell (Q's octaves), an octave round a cut's frequency.
  const octaves = band.shape === "bell" || band.shape === "notch" || band.shape === "bandPass" ? (2 / Math.LN2) * Math.asinh(1 / (Math.SQRT2 * band.q)) : 2;
  const low = band.shape === "lowCut" || band.shape === "lowShelf" ? view.low : band.frequency / 2 ** (octaves / 2);
  const high = band.shape === "highCut" || band.shape === "highShelf" || band.shape === "tiltShelf" ? view.high : band.frequency * 2 ** (octaves / 2);
  ctx.fillStyle = "rgba(0, 0, 0, 0.35)";
  ctx.fillRect(0, 0, xOf(view, low), view.height);
  ctx.fillRect(xOf(view, high), 0, view.width - xOf(view, high), view.height);
  ctx.fillStyle = alpha(bandColour(band.id), 0.08);
  ctx.fillRect(xOf(view, low), 0, xOf(view, high) - xOf(view, low), view.height);
}

function strokeCurve(ctx: CanvasRenderingContext2D, scene: EqScene, curve: ArrayLike<number>) {
  const { view, frequencies } = scene;
  ctx.beginPath();
  for (let i = 0; i < frequencies.length; i++) {
    const x = (i / (frequencies.length - 1)) * view.width;
    const y = yOf(view, curve[i]);
    if (i) ctx.lineTo(x, y);
    else ctx.moveTo(x, y);
  }
}

/** The area between two curves (a band's and 0 dB, or a dynamic band's two). */
function fillBetween(ctx: CanvasRenderingContext2D, scene: EqScene, a: ArrayLike<number>, b: ArrayLike<number> | null, fill: string) {
  const { view, frequencies } = scene;
  const n = frequencies.length;
  ctx.beginPath();
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * view.width;
    if (i) ctx.lineTo(x, yOf(view, a[i]));
    else ctx.moveTo(x, yOf(view, a[i]));
  }
  for (let i = n - 1; i >= 0; i--) ctx.lineTo((i / (n - 1)) * view.width, b ? yOf(view, b[i]) : zeroY(view));
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
}

function drawBands(ctx: CanvasRenderingContext2D, scene: EqScene) {
  const { bands, frequencies, palette, live, selected, hover, solo } = scene;
  const n = frequencies.length;
  // What each part of the sound gets: the stereo bands' sum, and each placement's own bands'.
  const stereo = new Float64Array(n);
  const parts = new Map<EqPlacement, Float64Array>();
  ctx.lineJoin = "round";
  for (const band of bands) {
    const colour = bandColour(band.id);
    const dynamic = band.range !== 0 && band.dynamics;
    const liveGain = dynamic ? (live.get(band.id)?.gain ?? 0) : 0;
    if (band.enabled) {
      const heard = curveOf(band, band.gain + liveGain, frequencies);
      let sum: Float64Array = stereo;
      if (band.placement !== "stereo") {
        sum = parts.get(band.placement) ?? new Float64Array(n);
        parts.set(band.placement, sum);
      }
      for (let i = 0; i < n; i++) sum[i] += heard[i];
    }
    const lit = selected.has(band.id) || hover === band.id;
    const dim = !band.enabled || (solo !== null && solo !== band.id);
    const own = curveOf(band, band.gain, frequencies);
    ctx.globalAlpha = dim ? 0.35 : 1;
    if (dynamic) {
      // Its range: between the band at its gain and at its gain plus the range, filled.
      const far = curveOf(band, band.gain + band.range, frequencies);
      fillBetween(ctx, scene, own, far, alpha(colour, lit ? 0.45 : 0.22));
      strokeCurve(ctx, scene, far);
      ctx.strokeStyle = alpha(colour, lit ? 0.9 : 0.5);
      ctx.lineWidth = 1;
      ctx.stroke();
    } else if (lit) {
      fillBetween(ctx, scene, own, null, alpha(colour, 0.3));
    }
    strokeCurve(ctx, scene, own);
    ctx.strokeStyle = alpha(colour, lit ? 1 : 0.65);
    ctx.lineWidth = lit ? 1.5 : 1;
    ctx.stroke();
    ctx.globalAlpha = 1;
  }
  // Each placement's result in its colour (the stereo bands are in it too), then the whole EQ: yellow, thick.
  for (const [placement, own] of parts) {
    const sum = new Float64Array(n);
    for (let i = 0; i < n; i++) sum[i] = stereo[i] + own[i];
    strokeCurve(ctx, scene, sum);
    ctx.strokeStyle = palette.placements[placement];
    ctx.lineWidth = 2;
    ctx.globalAlpha = solo !== null ? 0.35 : 0.95;
    ctx.stroke();
  }
  strokeCurve(ctx, scene, stereo);
  ctx.strokeStyle = palette.curve;
  ctx.lineWidth = 2.5;
  ctx.globalAlpha = solo !== null ? 0.35 : 1;
  ctx.shadowColor = alpha(palette.curve, 0.35);
  ctx.shadowBlur = 6;
  ctx.stroke();
  ctx.shadowBlur = 0;
  ctx.globalAlpha = 1;
}

function drawDots(ctx: CanvasRenderingContext2D, scene: EqScene) {
  const { view, bands, selected, hover, solo, palette } = scene;
  ctx.font = "bold 8px 'DM Sans', system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  for (const band of bands) {
    const { x, y } = dotOf(view, band);
    const colour = bandColour(band.id);
    const on = selected.has(band.id);
    const hot = hover === band.id;
    const dim = !band.enabled || (solo !== null && solo !== band.id);
    const r = on || hot ? DOT + 2 : DOT;
    ctx.globalAlpha = dim ? 0.45 : 1;
    // A dynamic band's handle: ▲▼ where its gain goes when it's fully triggered.
    if (band.range !== 0 && band.dynamics && hasGain(band.shape)) {
      const hy = yOf(view, band.gain + band.range);
      ctx.fillStyle = alpha("#ffffff", on || hot ? 0.85 : 0.45);
      ctx.beginPath();
      ctx.moveTo(x - 4, hy - 1.5);
      ctx.lineTo(x + 4, hy - 1.5);
      ctx.lineTo(x, hy - 6);
      ctx.closePath();
      ctx.moveTo(x - 4, hy + 1.5);
      ctx.lineTo(x + 4, hy + 1.5);
      ctx.lineTo(x, hy + 6);
      ctx.closePath();
      ctx.fill();
    }
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    const fill = ctx.createRadialGradient(x - r / 3, y - r / 3, 1, x, y, r);
    fill.addColorStop(0, alpha(colour, 1));
    fill.addColorStop(1, alpha(colour, 0.75));
    ctx.fillStyle = band.enabled ? fill : "#55505a";
    ctx.fill();
    ctx.lineWidth = on ? 2 : 1;
    ctx.strokeStyle = on ? "#ffffff" : "rgba(0, 0, 0, 0.6)";
    ctx.stroke();
    if (hot && !on) {
      ctx.beginPath();
      ctx.arc(x, y, r + 3, 0, Math.PI * 2);
      ctx.strokeStyle = alpha(colour, 0.5);
      ctx.lineWidth = 1;
      ctx.stroke();
    }
    // A band on one part of the sound: its letter beside the dot, in the part's colour.
    if (band.placement !== "stereo") {
      const letter = { left: "L", right: "R", mid: "M", side: "S" }[band.placement];
      ctx.fillStyle = palette.placements[band.placement];
      ctx.fillText(letter, x + r + 5, y - r - 1);
    }
  }
  ctx.globalAlpha = 1;
}

function drawScales(ctx: CanvasRenderingContext2D, scene: EqScene) {
  const { view, palette } = scene;
  const right = view.width;
  ctx.font = FONT;
  ctx.textBaseline = "middle";
  // The EQ's scale (yellow) just inside the right edge, the analyzer's (grey) beside it.
  ctx.textAlign = "right";
  for (const db of gainSteps(view.range)) {
    if (Math.abs(db) > view.range) continue;
    const y = yOf(view, db);
    ctx.fillStyle = alpha(palette.curve, db === 0 ? 0.9 : 0.75);
    ctx.fillText(db > 0 ? `+${db}` : db < 0 ? `−${-db}` : "0", right - 4, y);
  }
  ctx.textAlign = "left";
  ctx.fillStyle = palette.label;
  for (const db of analyzerSteps(view.analyzerRange)) {
    const y = analyzerY(view, db);
    if (y > view.height - view.bottom - 6) continue;
    ctx.fillText(String(db), right + 4, y);
  }
  // The frequency scale along the bottom (or the piano's keys, drawn by the window).
  if (!scene.piano) {
    ctx.textAlign = "center";
    ctx.textBaseline = "alphabetic";
    const y = view.height - 5;
    const hovered = scene.pointerHz !== null ? xOf(view, scene.pointerHz) : null;
    for (const line of frequencyLines(view)) {
      if (!line.label) continue;
      const x = xOf(view, line.hz);
      if (hovered !== null && Math.abs(x - hovered) < 34) continue;
      if (x < 10 || x > view.width - 10) continue;
      ctx.fillStyle = palette.label;
      ctx.fillText(line.label, x, y);
    }
    if (scene.pointerHz !== null && hovered !== null) {
      const hz = scene.pointerHz;
      const label = hz >= 1000 ? `${(hz / 1000).toFixed(2)} kHz` : `${hz.toFixed(1)} Hz`;
      ctx.fillStyle = palette.text;
      ctx.fillText(label, Math.max(30, Math.min(view.width - 30, hovered)), y);
    }
  }
  // Peaks Spectrum Grab offers.
  ctx.textBaseline = "middle";
  ctx.textAlign = "center";
  for (const peak of scene.peaks) {
    const x = xOf(view, peak.hz);
    const y = analyzerY(view, peak.db + scene.spectra.tilt * Math.log2(peak.hz / 1000));
    ctx.fillStyle = palette.curve;
    ctx.beginPath();
    ctx.arc(x, y, 3, 0, Math.PI * 2);
    ctx.fill();
    const label = peak.hz >= 1000 ? `${(peak.hz / 1000).toFixed(1)}k` : `${Math.round(peak.hz)} Hz`;
    const w = ctx.measureText(label).width + 10;
    ctx.fillStyle = alpha(palette.curve, 0.92);
    ctx.beginPath();
    ctx.roundRect(x - w / 2, y - 22, w, 14, 7);
    ctx.fill();
    ctx.fillStyle = "#1a1612";
    ctx.fillText(label, x, y - 15);
  }
}

function drawMeter(ctx: CanvasRenderingContext2D, scene: EqScene) {
  const { view, palette, meter } = scene;
  const x0 = view.width + scene.scaleWidth - 12;
  const top = view.top;
  const bottom = view.height - view.bottom;
  for (let side = 0; side < 2; side++) {
    const x = x0 + side * 5;
    ctx.fillStyle = "rgba(0, 0, 0, 0.35)";
    ctx.fillRect(x, top, 4, bottom - top);
    const db = 20 * Math.log10(Math.max(1e-6, meter[side]));
    const y = Math.max(top, analyzerY(view, db));
    if (y >= bottom) continue;
    const g = ctx.createLinearGradient(0, bottom, 0, top);
    g.addColorStop(0, alpha(palette.meter, 0.6));
    g.addColorStop(0.75, palette.meter);
    g.addColorStop(1, palette.meterHot);
    ctx.fillStyle = g;
    ctx.fillRect(x, y, 4, bottom - y);
  }
}

/** The frequency and EQ gain under a point of the display. */
export const pointAt = (view: EqView, x: number, y: number) => ({ hz: hzAt(view, x), db: dbAt(view, y) });
