/**
 * Drawing the Reverb's displays (`docs/reverb/reverb.md` 4.6), in our look with its own dark tokens
 * (`--verb-*`): DECAY, how long each frequency lasts (the tail's spectrum behind, falling at each
 * frequency's T60; the mode's natural curve thin; the decay curve thick in the accent; the Post EQ in
 * amber on its own dB scale; the bands' dots; the Post EQ's handles), and SHAPE, the reverb over time (the
 * dry hit, the pre-delay gap, the early taps, the late envelope with a line per octave band, -60 dB, the
 * duck during a phrase).
 */
import { decayCurve, formatHz, postCurve, type ShapeEnvelope } from "@shared/music/reverb";
import { REVERB_OCTAVES } from "@shared/music/reverb-modes";
import { spectrumFrequency } from "@shared/music/pro-q-presets";
import type { ReverbState } from "@shared/music/types";
import { FREQ_RANGE, type Plot, POST_DB, SHAPE_FLOOR, T60_RANGE, bandPoint, dbY, freqX, levelY, postHandles, t60Y, timeX } from "./geometry";

export interface VerbPalette {
  bgTop: string;
  bgBottom: string;
  grid: string;
  gridStrong: string;
  label: string;
  text: string;
  decay: string;
  natural: string;
  post: string;
  spectrum: string;
  spectrumLine: string;
  band: string;
  bandOff: string;
  early: string;
  late: string;
  duck: string;
  freeze: string;
  font: string;
}

let cached: { key: string; palette: VerbPalette } | null = null;
/** The displays' colours (read again when the theme changes). */
export function readVerbPalette(element: Element): VerbPalette {
  const key = document.documentElement.className;
  if (cached?.key === key) return cached.palette;
  const style = getComputedStyle(element);
  const read = (name: string) => style.getPropertyValue(`--verb-${name}`).trim();
  const palette: VerbPalette = {
    bgTop: read("bg-top"),
    bgBottom: read("bg-bottom"),
    grid: read("grid"),
    gridStrong: read("grid-strong"),
    label: read("label"),
    text: read("text"),
    decay: read("decay"),
    natural: read("natural"),
    post: read("post"),
    spectrum: read("spectrum"),
    spectrumLine: read("spectrum-line"),
    band: read("band"),
    bandOff: read("band-off"),
    early: read("early"),
    late: read("late"),
    duck: read("duck"),
    freeze: read("freeze"),
    font: style.getPropertyValue("--font-sans").trim() || "sans-serif",
  };
  cached = { key, palette };
  return palette;
}

function background(ctx: CanvasRenderingContext2D, width: number, height: number, palette: VerbPalette) {
  const g = ctx.createLinearGradient(0, 0, 0, height);
  g.addColorStop(0, palette.bgTop);
  g.addColorStop(1, palette.bgBottom);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, width, height);
}

const FREQ_LINES = [50, 100, 200, 500, 1000, 2000, 5000, 10000];
const T60_LINES = [0.2, 0.5, 1, 2, 5, 10, 20];
const secondsText = (t: number) => (t < 1 ? `${Math.round(t * 1000)} ms` : `${t} s`);

export interface DecayScene {
  width: number;
  height: number;
  plot: Plot;
  palette: VerbPalette;
  reverb: ReverbState;
  /** The T60 at each octave band (what the engine plays), and the natural curve's. */
  t60: number[];
  natural: number[];
  showNatural: boolean;
  /** The analyzer (dB at the engine's points), or null. */
  spectrum: Float32Array | null;
  frozen: boolean;
  /** Bands selected, the band or handle under the pointer. */
  selected: readonly number[];
  hover: number | string | null;
  /** The Decay EQ bypassed: bands dimmed, the curve the natural one. */
  bypassed: boolean;
}

/** The Decay display. */
export function drawDecay(ctx: CanvasRenderingContext2D, s: DecayScene) {
  const { plot: p, palette } = s;
  background(ctx, s.width, s.height, palette);
  ctx.font = `10px ${palette.font}`;
  ctx.textBaseline = "middle";
  // The grid: frequencies, decay times (left), the Post EQ's dB (right).
  ctx.lineWidth = 1;
  for (const f of FREQ_LINES) {
    const x = Math.round(freqX(p, f)) + 0.5;
    ctx.strokeStyle = f === 1000 || f === 100 || f === 10000 ? palette.gridStrong : palette.grid;
    ctx.beginPath();
    ctx.moveTo(x, p.top);
    ctx.lineTo(x, p.top + p.height);
    ctx.stroke();
    ctx.fillStyle = palette.label;
    ctx.textAlign = "center";
    ctx.fillText(formatHz(f).replace(" ", ""), x, p.top + p.height + 9);
  }
  for (const t of T60_LINES) {
    const y = Math.round(t60Y(p, t)) + 0.5;
    ctx.strokeStyle = t === 1 || t === 10 ? palette.gridStrong : palette.grid;
    ctx.beginPath();
    ctx.moveTo(p.left, y);
    ctx.lineTo(p.left + p.width, y);
    ctx.stroke();
    ctx.fillStyle = palette.label;
    ctx.textAlign = "right";
    ctx.fillText(secondsText(t), p.left - 4, y);
  }
  ctx.textAlign = "left";
  for (const db of [POST_DB, POST_DB / 2, 0, -POST_DB / 2, -POST_DB]) {
    ctx.fillStyle = palette.post;
    ctx.globalAlpha = 0.6;
    ctx.fillText(`${db > 0 ? "+" : ""}${db}`, p.left + p.width + 4, dbY(p, db));
    ctx.globalAlpha = 1;
  }

  // The tail's spectrum, behind: a soft fill where its energy is, each frequency falling at its T60.
  if (s.spectrum) {
    ctx.beginPath();
    let started = false;
    const floor = -90;
    for (let i = 0; i < s.spectrum.length; i++) {
      const f = spectrumFrequency(i);
      if (f < FREQ_RANGE[0] || f > FREQ_RANGE[1]) continue;
      const x = freqX(p, f);
      // 0 dB at the top, the floor at the bottom (its own scale: where the energy is, not how long).
      const y = p.top + p.height * Math.min(1, Math.max(0, s.spectrum[i] / floor));
      if (!started) {
        ctx.moveTo(x, p.top + p.height);
        started = true;
      }
      ctx.lineTo(x, y);
    }
    if (started) {
      ctx.lineTo(freqX(p, FREQ_RANGE[1]), p.top + p.height);
      ctx.closePath();
      ctx.fillStyle = palette.spectrum;
      ctx.globalAlpha = 0.55;
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.strokeStyle = palette.spectrumLine;
      ctx.lineWidth = 1;
      ctx.stroke();
    }
  }

  const curve = (t60: readonly number[]) => {
    ctx.beginPath();
    for (let x = p.left; x <= p.left + p.width; x += 2) {
      const f = FREQ_RANGE[0] * (FREQ_RANGE[1] / FREQ_RANGE[0]) ** ((x - p.left) / p.width);
      const y = t60Y(p, Math.min(T60_RANGE[1], decayCurve(t60, f)));
      if (x === p.left) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
  };
  // The Post EQ: its level across frequency, on the dB scale.
  ctx.beginPath();
  for (let x = p.left; x <= p.left + p.width; x += 2) {
    const f = FREQ_RANGE[0] * (FREQ_RANGE[1] / FREQ_RANGE[0]) ** ((x - p.left) / p.width);
    const y = dbY(p, postCurve(s.reverb, f));
    if (x === p.left) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.strokeStyle = palette.post;
  ctx.globalAlpha = 0.85;
  ctx.lineWidth = 1.25;
  ctx.stroke();
  ctx.globalAlpha = 1;
  // The mode's natural curve, thin and dimmed, under the decay curve.
  if (s.showNatural) {
    curve(s.natural);
    ctx.strokeStyle = palette.natural;
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 3]);
    ctx.stroke();
    ctx.setLineDash([]);
  }
  // The decay curve: what the engine plays (flat at the top while frozen: ∞).
  if (s.frozen) {
    ctx.strokeStyle = palette.freeze;
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(p.left, p.top + 1);
    ctx.lineTo(p.left + p.width, p.top + 1);
    ctx.stroke();
  } else {
    curve(s.t60);
    ctx.strokeStyle = palette.decay;
    ctx.lineWidth = 2.5;
    ctx.stroke();
    // Its height at 1 kHz is Decay.
    const y = t60Y(p, s.t60[5]);
    ctx.fillStyle = palette.decay;
    ctx.beginPath();
    ctx.arc(freqX(p, 1000), y, 2.5, 0, Math.PI * 2);
    ctx.fill();
  }
  // The Post EQ's handles.
  for (const h of postHandles(s.reverb, p)) {
    const on = s.hover === h.kind;
    ctx.fillStyle = palette.post;
    ctx.globalAlpha = on ? 1 : 0.7;
    ctx.fillRect(h.x - (on ? 4 : 3), h.y - (on ? 4 : 3), on ? 8 : 6, on ? 8 : 6);
    ctx.globalAlpha = 1;
  }
  // The bands' dots: a number in each.
  ctx.textAlign = "center";
  ctx.font = `bold 9px ${palette.font}`;
  for (const band of s.reverb.bands) {
    const at = bandPoint(s.reverb, band, p);
    const selected = s.selected.includes(band.id);
    const on = band.enabled && !s.bypassed;
    const r = s.hover === band.id || selected ? 8 : 7;
    ctx.beginPath();
    ctx.arc(at.x, at.y, r, 0, Math.PI * 2);
    ctx.fillStyle = on ? palette.band : palette.bandOff;
    ctx.globalAlpha = on ? 0.95 : 0.6;
    ctx.fill();
    ctx.globalAlpha = 1;
    if (selected) {
      ctx.strokeStyle = palette.decay;
      ctx.lineWidth = 2;
      ctx.stroke();
    }
    ctx.fillStyle = palette.bgTop;
    ctx.fillText(String(band.id), at.x, at.y + 0.5);
  }
}

export interface ShapeScene {
  width: number;
  height: number;
  plot: Plot;
  palette: VerbPalette;
  shape: ShapeEnvelope;
  span: number;
  log: boolean;
  /** dB the duck takes off during a phrase (shown dotted). */
  duck: number;
  hover: "predelay" | "slope" | "early" | null;
}

/** The Shape display: the reverb over time, from what the settings mean. */
export function drawShape(ctx: CanvasRenderingContext2D, s: ShapeScene) {
  const { plot: p, palette, shape } = s;
  background(ctx, s.width, s.height, palette);
  ctx.font = `10px ${palette.font}`;
  ctx.textBaseline = "middle";
  ctx.lineWidth = 1;
  // The grid: levels and times.
  for (let db = 0; db >= SHAPE_FLOOR; db -= 12) {
    const y = Math.round(levelY(p, db)) + 0.5;
    ctx.strokeStyle = db === -60 ? palette.gridStrong : palette.grid;
    ctx.setLineDash(db === -60 ? [5, 4] : []);
    ctx.beginPath();
    ctx.moveTo(p.left, y);
    ctx.lineTo(p.left + p.width, y);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = palette.label;
    ctx.textAlign = "right";
    ctx.fillText(`${db}`, p.left - 4, y);
  }
  const steps = s.log ? [0.001, 0.01, 0.1, 1, 10].filter((t) => t <= s.span) : Array.from({ length: 6 }, (_, i) => (s.span * i) / 5);
  ctx.textAlign = "center";
  for (const t of steps) {
    const x = Math.round(timeX(p, t, s.span, s.log)) + 0.5;
    ctx.strokeStyle = palette.grid;
    ctx.beginPath();
    ctx.moveTo(x, p.top);
    ctx.lineTo(x, p.top + p.height);
    ctx.stroke();
    ctx.fillStyle = palette.label;
    ctx.fillText(t < 1 ? `${Math.round(t * 1000)} ms` : `${t.toFixed(t < 10 ? 1 : 0)} s`, x, p.top + p.height + 9);
  }
  // The pre-delay gap.
  const pre = timeX(p, shape.predelay, s.span, s.log);
  ctx.fillStyle = palette.grid;
  ctx.globalAlpha = 0.5;
  ctx.fillRect(p.left, p.top, pre - p.left, p.height);
  ctx.globalAlpha = 1;
  ctx.strokeStyle = s.hover === "predelay" ? palette.text : palette.label;
  ctx.setLineDash([3, 3]);
  ctx.beginPath();
  ctx.moveTo(pre + 0.5, p.top);
  ctx.lineTo(pre + 0.5, p.top + p.height);
  ctx.stroke();
  ctx.setLineDash([]);
  // The late envelope: built from its start, then the straight −60 dB per T60 (a line per octave band faintly behind).
  const late = (t60: number) => (t: number) => (t < shape.lateStart ? SHAPE_FLOOR : t < shape.lateBuilt ? shape.lateDb + 30 * Math.log10(Math.max(1e-3, (t - shape.lateStart) / Math.max(1e-3, shape.lateBuilt - shape.lateStart))) : shape.lateDb - (60 * (t - shape.lateBuilt)) / Math.max(0.05, t60));
  const trace = (at: (t: number) => number) => {
    ctx.beginPath();
    for (let x = p.left; x <= p.left + p.width; x += 2) {
      const t = s.log ? (Math.exp(((x - p.left) / p.width) * Math.log(1 + s.span * 1000)) - 1) / 1000 : ((x - p.left) / p.width) * s.span;
      const y = levelY(p, at(t));
      if (x === p.left) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
  };
  ctx.strokeStyle = palette.natural;
  ctx.globalAlpha = 0.5;
  for (const [b] of REVERB_OCTAVES.entries()) {
    if (b < 2 || b > 8) continue;
    trace(late(shape.t60[b]));
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  trace(late(shape.t60[5]));
  ctx.lineTo(p.left + p.width, p.top + p.height);
  ctx.lineTo(p.left, p.top + p.height);
  ctx.closePath();
  ctx.fillStyle = palette.late;
  ctx.globalAlpha = 0.75;
  ctx.fill();
  ctx.globalAlpha = 1;
  trace(late(shape.t60[5]));
  ctx.strokeStyle = s.hover === "slope" ? palette.text : palette.decay;
  ctx.lineWidth = 2;
  ctx.stroke();
  // The duck during a phrase: the tail held down while the voice sings, dotted.
  if (s.duck < -0.1) {
    const phrase = Math.min(s.span * 0.4, shape.lateBuilt + 0.4);
    ctx.beginPath();
    for (let x = p.left; x <= timeX(p, phrase, s.span, s.log); x += 2) {
      const t = s.log ? (Math.exp(((x - p.left) / p.width) * Math.log(1 + s.span * 1000)) - 1) / 1000 : ((x - p.left) / p.width) * s.span;
      const y = levelY(p, late(shape.t60[5])(t) + s.duck);
      if (x === p.left) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.strokeStyle = palette.duck;
    ctx.lineWidth = 1.5;
    ctx.setLineDash([2, 3]);
    ctx.stroke();
    ctx.setLineDash([]);
  }
  // The early taps: thin lines at their places and gains.
  ctx.strokeStyle = s.hover === "early" ? palette.text : palette.early;
  ctx.lineWidth = 1;
  ctx.globalAlpha = 0.45;
  for (const tap of shape.early) {
    const x = Math.round(timeX(p, tap.at, s.span, s.log)) + (tap.side ? 0.5 : -0.5);
    ctx.beginPath();
    ctx.moveTo(x, p.top + p.height);
    ctx.lineTo(x, levelY(p, Math.min(0, tap.db)));
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  // The dry hit.
  ctx.strokeStyle = palette.text;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(p.left + 1, p.top);
  ctx.lineTo(p.left + 1, p.top + p.height);
  ctx.stroke();
}
