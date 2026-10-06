/**
 * Measuring a sound file into signals (see `format.ts`), as it's decoded: stereo samples go in a
 * chunk at a time (`push`), frames come out `SIGNAL_RATE` times a second, each centred on its moment
 * (the file is padded with silence either side), so nothing reacts early or late on average.
 *
 * Per frame: a 2048-point spectrum (43 ms at 48 kHz) for the bands and brightness, 10 ms of samples
 * for the level, peak, width and balance, and a 1024-point spectrum (21 ms) for the onsets, whose
 * rises (spectral flux over log bands, in dB so quiet and loud passages count alike) are peaks at
 * each hit. Pure: no I/O, so the tests feed it synthetic sound.
 */
import { fft, hann } from "./fft.ts";
import {
  BAND_COUNT,
  type Hit,
  NAMED_BANDS,
  ONSET_SCALARS,
  type OnsetName,
  SCALARS,
  SIGNALS_VERSION,
  SIGNAL_RATE,
  type ScalarName,
  type SignalData,
  type SignalsHeader,
  bandByte,
  bandEdges,
  byteDb,
} from "./format.ts";

const LONG = 2048;
const SHORT = 1024;
/** Seconds the level, peak, width and balance are measured over. */
const LEVEL_SECONDS = 0.01;
/** dB below which a scalar reads as silence (instead of -Infinity). */
const SILENT_DB = -120;
/** A full-scale sine's mean square is 1/2: levels are given against it (AES17), so it reads 0 dB. */
const SINE_DB = 10 * Math.log10(2);
/** Hann's equivalent noise bandwidth, in bins: a sine's energy spreads over this much. */
const HANN_ENBW = 1.5;

// Onsets.
const FLUX_BANDS = 32;
const FLUX_LOW_HZ = 30;
const FLUX_HIGH_HZ = 16_000;
/** Below this is the low region (kicks), above `HIGH_REGION_HZ` the high one (hats). */
const LOW_REGION_HZ = 150;
const HIGH_REGION_HZ = 4000;
/** Bands this far below the recent loudest are leakage, which flickers with the window's phase: not onsets. */
const FLUX_RANGE_DB = 30;
/**
 * A rise is measured against the highest of this many frames before (30 ms), not just the last: noise
 * flickers up and down but never far above its own recent peaks; a hit does (SuperFlux's trick, over time).
 */
const RISE_FRAMES = 6;
/** A region this far below the loudest region is too quiet to have onsets of its own. */
const REGION_RANGE_DB = 35;
const REGION_SCALARS = ["onsetLow", "onsetMid", "onsetHigh"] as const;
/** How fast that reference falls after a loud moment, dB a second. */
const FLUX_RELEASE_DB = 20;
/**
 * A rise is measured as the sound enters the window, before the window's centre reaches it: this puts
 * a hit on its attack (measured on synthetic clicks and kicks, see analyse.test.ts).
 */
export const ONSET_SHIFT = 0.004;
/** Hits closer than this are one. */
const MIN_HIT_GAP = 0.05;
/** A peak must stand above the mean of this much around it... */
const HIT_CONTEXT = 0.15;
/** ...by this factor, plus this share of the file's hard hits. */
const HIT_FACTOR = 1.4;
const HIT_FLOOR = 0.08;
/** And rise at least this much (dB): a whisper of leakage isn't a hit, however quiet the rest. */
const MIN_HIT_RISE = 2;
/** And reach this share of the strongest rise within `HIT_NEIGHBOURHOOD` seconds: a noisy bed's flicker isn't a hit beside the beat's. */
const HIT_SHARE = 0.3;
const HIT_NEIGHBOURHOOD = 1;

// References (auto-gain).
/** A frame with sound: louder than this. */
const SOUNDING_DB = -60;
/** References are never quieter than these: auto-gain doesn't make hiss react like music. */
const MIN_LEVEL_REFERENCE = -45;
const MIN_BAND_REFERENCE = -60;
const MIN_FLUX_REFERENCE = 3;

const toDb = (power: number) => (power > 1e-12 ? Math.max(SILENT_DB, 10 * Math.log10(power) + SINE_DB) : SILENT_DB);

/** For each band, the bins it covers and how much of each (a band narrower than a bin takes its share). */
function bandBins(edges: readonly number[], binHz: number, bins: number): { k: number; w: number }[][] {
  return edges.slice(0, -1).map((low, b) => {
    const high = edges[b + 1];
    const parts: { k: number; w: number }[] = [];
    for (let k = Math.max(1, Math.floor(low / binHz)); k <= Math.min(bins, Math.ceil(high / binHz)); k++) {
      const overlap = Math.min(high, (k + 0.5) * binHz) - Math.max(low, (k - 0.5) * binHz);
      if (overlap > 0) parts.push({ k, w: overlap / binHz });
    }
    return parts;
  });
}

/** Log-spaced bands of whole bins (at least one each), as bin edges. */
function binBands(lowHz: number, highHz: number, count: number, binHz: number, bins: number): number[] {
  const edges: number[] = [];
  for (let b = 0; b <= count; b++) {
    const hz = lowHz * (highHz / lowHz) ** (b / count);
    edges.push(Math.min(bins, Math.max(1, Math.round(hz / binHz))));
  }
  for (let b = 1; b <= count; b++) edges[b] = Math.max(edges[b], edges[b - 1] + 1);
  return edges;
}

const SCALAR_INDEX = Object.fromEntries(SCALARS.map((s, i) => [s, i])) as Record<ScalarName, number>;
const S = SCALARS.length;

export class SignalAnalyser {
  readonly hop: number;
  private readonly binHz: number;
  private readonly longWindow = hann(LONG);
  private readonly shortWindow = hann(SHORT);
  private readonly bands: { k: number; w: number }[][];
  private readonly named: { k: number; w: number }[][];
  private readonly fluxEdges: number[];
  private readonly fluxRegion: (0 | 1 | 2)[];
  private readonly levelHalf: number;
  private readonly re = new Float64Array(LONG);
  private readonly im = new Float64Array(LONG);
  private readonly power = new Float64Array(LONG / 2 + 1);
  /** The last `RISE_FRAMES` frames' band and region levels (a ring, frame `f` at `f % RISE_FRAMES`). */
  private fluxHistory = Array.from({ length: RISE_FRAMES }, () => new Float64Array(FLUX_BANDS));
  private regionHistory = Array.from({ length: RISE_FRAMES }, () => new Float64Array(3));
  private regions = new Float64Array(3);
  private regionReference = [-Infinity, -Infinity, -Infinity];
  private nextFlux = new Float64Array(FLUX_BANDS);
  /** The highest of each band's or region's last levels, floored. */
  private recent = (history: Float64Array[], i: number, f: number, floor: number) => {
    let most = floor;
    for (let k = 1; k <= Math.min(f, RISE_FRAMES); k++) most = Math.max(most, history[(f - k) % RISE_FRAMES][i]);
    return most;
  };
  private fluxReference = -Infinity;
  private readonly fluxRelease: number;

  // Samples: absolute indices [start, start + length) of the file (negative: the silence before it).
  private left = new Float32Array(1 << 16);
  private right = new Float32Array(1 << 16);
  private start = -LONG / 2;
  private length = LONG / 2;
  /** The next frame to measure. */
  private frame = 0;
  private scalars = new Float32Array(0);
  private bandBytes = new Uint8Array(0);

  constructor(readonly sampleRate: number, expectedSeconds = 0) {
    this.hop = sampleRate / SIGNAL_RATE;
    if (!Number.isInteger(this.hop)) throw new Error(`Signals need a sample rate that's a multiple of ${SIGNAL_RATE}`);
    this.binHz = sampleRate / LONG;
    const edges = bandEdges();
    this.bands = bandBins(edges, this.binHz, LONG / 2);
    this.named = NAMED_BANDS.map((b) => bandBins([b.low, Math.min(b.high, sampleRate / 2)], this.binHz, LONG / 2)[0]);
    const shortBinHz = sampleRate / SHORT;
    this.fluxEdges = binBands(FLUX_LOW_HZ, Math.min(FLUX_HIGH_HZ, sampleRate / 2), FLUX_BANDS, shortBinHz, SHORT / 2);
    this.fluxRegion = this.fluxEdges.slice(0, -1).map((lo, b) => {
      const high = this.fluxEdges[b + 1] * shortBinHz;
      return high <= LOW_REGION_HZ ? 0 : lo * shortBinHz >= HIGH_REGION_HZ ? 2 : 1;
    });
    this.levelHalf = Math.round((LEVEL_SECONDS * sampleRate) / 2);
    this.fluxRelease = FLUX_RELEASE_DB / SIGNAL_RATE;
    this.grow(Math.ceil(expectedSeconds * SIGNAL_RATE) + 1);
  }

  /** Interleaved stereo samples (left, right, left...) or mono (`channels` 1). */
  push(samples: Float32Array, channels: 1 | 2 = 2): void {
    const count = Math.floor(samples.length / channels);
    this.reserve(count);
    const at = this.length;
    for (let i = 0; i < count; i++) {
      this.left[at + i] = samples[i * channels];
      this.right[at + i] = samples[i * channels + channels - 1];
    }
    this.length += count;
    this.measureReady();
  }

  /** The file has ended after `total` samples: measure to its end (padded with silence) and give the result. */
  finish(rhythm: SignalsHeader["rhythm"] = null): SignalData {
    const total = this.start + this.length;
    const frames = Math.floor(Math.max(0, total) / this.hop) + 1;
    this.reserve(LONG);
    this.left.fill(0, this.length, this.length + LONG);
    this.right.fill(0, this.length, this.length + LONG);
    this.length += LONG;
    this.grow(frames);
    while (this.frame < frames) this.measure();
    const scalars = this.scalars.slice(0, frames * S);
    const bands = this.bandBytes.slice(0, frames * BAND_COUNT);
    return { header: header(scalars, bands, frames, Math.max(0, total) / this.sampleRate, rhythm), scalars, bands };
  }

  /** Measure every frame whose window is all here. */
  private measureReady(): void {
    while ((this.frame * this.hop) + LONG / 2 <= this.start + this.length) this.measure();
    // Forget what no frame will need again.
    const keep = this.frame * this.hop - LONG / 2;
    const drop = keep - this.start;
    if (drop > this.left.length / 2) {
      this.left.copyWithin(0, drop, this.length);
      this.right.copyWithin(0, drop, this.length);
      this.length -= drop;
      this.start = keep;
    }
  }

  private reserve(count: number): void {
    if (this.length + count <= this.left.length) return;
    let size = this.left.length;
    while (size < this.length + count) size *= 2;
    const left = new Float32Array(size);
    const right = new Float32Array(size);
    left.set(this.left.subarray(0, this.length));
    right.set(this.right.subarray(0, this.length));
    this.left = left;
    this.right = right;
  }

  private grow(frames: number): void {
    if (frames * S <= this.scalars.length) return;
    const scalars = new Float32Array(Math.max(frames, (this.scalars.length / S) * 2) * S);
    scalars.set(this.scalars);
    const bands = new Uint8Array((scalars.length / S) * BAND_COUNT);
    bands.set(this.bandBytes);
    this.scalars = scalars;
    this.bandBytes = bands;
  }

  /** The spectrum's power per bin of the mono samples centred on `centre`, a window of `size` (into `this.power`). */
  private spectrum(centre: number, size: number, window: Float64Array): void {
    const { re, im, left, right } = this;
    const from = centre - size / 2 - this.start;
    const r = size === LONG ? re : re.subarray(0, size);
    const i2 = size === LONG ? im : im.subarray(0, size);
    for (let i = 0; i < size; i++) {
      r[i] = ((left[from + i] + right[from + i]) / 2) * window[i];
      i2[i] = 0;
    }
    fft(r, i2);
    // Energy: a sine's spread over its bins sums to its mean square (see HANN_ENBW).
    const scale = 8 / (HANN_ENBW * size * size);
    for (let k = 0; k <= size / 2; k++) this.power[k] = (r[k] * r[k] + i2[k] * i2[k]) * scale;
  }

  private measure(): void {
    const f = this.frame++;
    this.grow(f + 1);
    const centre = f * this.hop;
    const row = f * S;
    const out = this.scalars;

    // Level, peak, width, balance over 10 ms.
    let mid = 0, side = 0, ll = 0, rr = 0, peak = 0;
    const from = centre - this.levelHalf - this.start;
    const n = this.levelHalf * 2;
    for (let i = from; i < from + n; i++) {
      const l = this.left[i];
      const r = this.right[i];
      const m = (l + r) / 2;
      const s = (l - r) / 2;
      mid += m * m;
      side += s * s;
      ll += l * l;
      rr += r * r;
      peak = Math.max(peak, Math.abs(l), Math.abs(r));
    }
    out[row + SCALAR_INDEX.level] = toDb((ll + rr) / (2 * n));
    out[row + SCALAR_INDEX.peak] = peak > 0 ? Math.max(SILENT_DB, 20 * Math.log10(peak) + SINE_DB) : SILENT_DB;
    out[row + SCALAR_INDEX.width] = mid + side > 1e-12 ? side / (mid + side) : 0;
    out[row + SCALAR_INDEX.balance] = ll + rr > 1e-12 ? (rr - ll) / (ll + rr) : 0;

    // Bands and brightness.
    this.spectrum(centre, LONG, this.longWindow);
    const power = this.power;
    const bandRow = f * BAND_COUNT;
    for (let b = 0; b < BAND_COUNT; b++) {
      let e = 0;
      for (const { k, w } of this.bands[b]) e += power[k] * w;
      this.bandBytes[bandRow + b] = bandByte(toDb(e));
    }
    NAMED_BANDS.forEach((band, i) => {
      let e = 0;
      for (const { k, w } of this.named[i]) e += power[k] * w;
      out[row + SCALAR_INDEX[band.id]] = toDb(e);
    });
    let weighted = 0, total = 0;
    for (let k = 1; k <= LONG / 2; k++) {
      weighted += power[k] * k * this.binHz;
      total += power[k];
    }
    out[row + SCALAR_INDEX.brightness] = total > 1e-12 ? weighted / total : 0;

    // Onsets: rises of log band levels (all of them), and of each region's energy.
    this.spectrum(centre, SHORT, this.shortWindow);
    const edges = this.fluxEdges;
    const next = this.nextFlux;
    let loudest = -Infinity;
    for (let b = 0; b < FLUX_BANDS; b++) {
      let e = 0;
      for (let k = edges[b]; k < edges[b + 1]; k++) e += power[k];
      next[b] = toDb(e / (edges[b + 1] - edges[b]));
      loudest = Math.max(loudest, next[b]);
    }
    this.fluxReference = Math.max(loudest, this.fluxReference - this.fluxRelease);
    // Both frames floored at the same level: a band that stays far below the loudest doesn't rise out of
    // silence when the sound starts.
    const floor = this.fluxReference - FLUX_RANGE_DB;
    let rises = 0;
    const regions = this.regions;
    regions.fill(0);
    for (let b = 0; b < FLUX_BANDS; b++) {
      const rise = f > 0 ? Math.max(next[b], floor) - this.recent(this.fluxHistory, b, f, floor) : 0;
      if (rise > 0) rises += rise;
      for (let k = edges[b]; k < edges[b + 1]; k++) regions[this.fluxRegion[b]] += power[k];
    }
    out[row + SCALAR_INDEX.onset] = rises;
    // A region's onsets are its energy's rises, floored against itself and against the loudest region: a
    // region far below the rest (a hat's lows, a kick's highs) doesn't rise when the others do.
    let loudestRegion = -Infinity;
    for (let r = 0; r < 3; r++) {
      regions[r] = toDb(regions[r]);
      this.regionReference[r] = Math.max(regions[r], this.regionReference[r] - this.fluxRelease);
      loudestRegion = Math.max(loudestRegion, this.regionReference[r]);
    }
    REGION_SCALARS.forEach((name, r) => {
      const regionFloor = Math.max(this.regionReference[r] - FLUX_RANGE_DB, loudestRegion - REGION_RANGE_DB);
      const rise = f > 0 ? Math.max(regions[r], regionFloor) - this.recent(this.regionHistory, r, f, regionFloor) : 0;
      out[row + SCALAR_INDEX[name]] = Math.max(0, rise);
    });
    this.fluxHistory[f % RISE_FRAMES].set(next);
    this.regionHistory[f % RISE_FRAMES].set(regions);
  }
}

/** The value below which `share` of `values` fall (`values` is sorted in place). */
function percentile(values: number[], share: number): number | null {
  if (!values.length) return null;
  values.sort((a, b) => a - b);
  return values[Math.min(values.length - 1, Math.floor(share * (values.length - 1)))];
}

/** References, hits and the rest of the header, from the tables. */
function header(scalars: Float32Array, bands: Uint8Array, frames: number, duration: number, rhythm: SignalsHeader["rhythm"]): SignalsHeader {
  const column = (name: ScalarName) => {
    const out = new Float64Array(frames);
    const c = SCALAR_INDEX[name];
    for (let f = 0; f < frames; f++) out[f] = scalars[f * S + c];
    return out;
  };
  const level = column("level");
  const sounding: number[] = [];
  for (let f = 0; f < frames; f++) if (level[f] > SOUNDING_DB) sounding.push(f);
  const over = (values: Float64Array | ((f: number) => number), share: number) =>
    percentile(sounding.map((f) => (typeof values === "function" ? values(f) : values[f])), share);

  const reference: SignalsHeader["reference"] = {};
  for (const name of ["level", "peak"] as const) reference[name] = round(Math.max(MIN_LEVEL_REFERENCE, over(column(name), 0.95) ?? -Infinity));
  for (const band of NAMED_BANDS) reference[band.id] = round(Math.max(MIN_BAND_REFERENCE, over(column(band.id), 0.95) ?? -Infinity));
  const hits = {} as Record<OnsetName, Hit[]>;
  for (const name of ONSET_SCALARS) {
    const flux = column(name);
    const ref = Math.max(MIN_FLUX_REFERENCE, over(flux, 0.99) ?? 0);
    reference[name] = round(ref);
    hits[name] = pickHits(flux, ref);
  }
  const bandReference: number[] = [];
  for (let b = 0; b < BAND_COUNT; b++) {
    bandReference.push(round(Math.max(MIN_BAND_REFERENCE, over((f) => byteDb(bands[f * BAND_COUNT + b]), 0.95) ?? -Infinity)));
  }
  return {
    version: SIGNALS_VERSION,
    rate: SIGNAL_RATE,
    frames,
    duration: round(duration),
    bandEdges: bandEdges().map(round),
    scalars: [...SCALARS],
    reference,
    bandReference,
    hits,
    rhythm,
  };
}

const round = (v: number) => Math.round(v * 1000) / 1000;

/**
 * The hits in a flux series: peaks standing out from what's around them (`HIT_CONTEXT` either side)
 * and from the file's quiet rises, at least `MIN_HIT_GAP` apart (the strongest wins).
 */
export function pickHits(flux: Float64Array, reference: number): Hit[] {
  const n = flux.length;
  const radius = Math.round(HIT_CONTEXT * SIGNAL_RATE);
  const gap = Math.round(MIN_HIT_GAP * SIGNAL_RATE);
  // Moving mean over ±radius.
  const prefix = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) prefix[i + 1] = prefix[i] + flux[i];
  const near = localMax(flux, Math.round(HIT_NEIGHBOURHOOD * SIGNAL_RATE));
  const candidates: number[] = [];
  for (let i = 0; i < n; i++) {
    const v = flux[i];
    if (v <= Math.max(HIT_FLOOR * reference, MIN_HIT_RISE) || v < HIT_SHARE * near[i]) continue;
    const lo = Math.max(0, i - radius);
    const hi = Math.min(n, i + radius + 1);
    const mean = (prefix[hi] - prefix[lo]) / (hi - lo);
    if (v < mean * HIT_FACTOR) continue;
    // A local maximum (the first of equals).
    let top = true;
    for (let j = Math.max(0, i - gap); j <= Math.min(n - 1, i + gap); j++) {
      if (flux[j] > v || (j < i && flux[j] === v)) {
        top = false;
        break;
      }
    }
    if (top) candidates.push(i);
  }
  return candidates.map((i) => {
    // Between frames: the top of the parabola through the peak and its neighbours.
    const [a, b, c] = [flux[i - 1] ?? 0, flux[i], flux[i + 1] ?? 0];
    const curve = a - 2 * b + c;
    const shift = curve < 0 ? Math.max(-0.5, Math.min(0.5, (0.5 * (a - c)) / curve)) : 0;
    return [round(Math.max(0, (i + shift) / SIGNAL_RATE + ONSET_SHIFT)), Math.round(Math.min(1, b / reference) * 100) / 100];
  });
}

/** The largest value within `radius` of each (a sliding maximum, in one pass). */
function localMax(x: Float64Array, radius: number): Float64Array {
  const n = x.length;
  const out = new Float64Array(n);
  const window: number[] = [];
  let head = 0;
  for (let i = 0, j = 0; i < n; i++) {
    // Take in everything up to i + radius, keeping the indices of falling values.
    for (; j < Math.min(n, i + radius + 1); j++) {
      while (window.length > head && x[window[window.length - 1]] <= x[j]) window.pop();
      window.push(j);
      if (head > window.length) head = window.length;
    }
    while (window[head] < i - radius) head++;
    out[i] = x[window[head]];
  }
  return out;
}
