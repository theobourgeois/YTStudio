/**
 * What Pro-Q's bands sound like (`docs/fabfilter/pro-q-3-dsp.md`): each band as analog sections, the
 * curve they make, and Auto Gain's estimate. The display draws these curves; the engine
 * (`engine/src/EqDesign.cpp`) builds its filters from the same sections, matched to them digitally, so
 * keep the two in step (`server/music/pro-q.integration.test.ts` measures one against the other).
 *
 * The conventions, FabFilter's:
 * - Q is the textbook (RBJ) Q times √2: a Butterworth cut has Q 1, and Q 1 is every shape's default.
 * - The slope is 6 dB/oct per order. Every shape is one family: a symmetric Butterworth shelf (its
 *   gain at the corner exactly half its gain in dB, at any order), turned into a band for a Bell; a
 *   Butterworth cascade for the cuts (Q on its sharpest section, so the cut's gain at its frequency is
 *   20·log10(Q/√2) at every slope); Brickwall a 14th-order elliptic filter.
 * Pure and tested.
 */
import { hasGain } from "./pro-q-presets.ts";
import type { EqBand, EqPlacement, ProQState } from "./types.ts";

/**
 * An analog section: (b0 + b1 p + b2 p²) / (a0 + a1 p + a2 p²), p = s / (2π·frequency): first order when
 * b2 and a2 are 0.
 */
export interface Section {
  b0: number;
  b1: number;
  b2: number;
  a0: number;
  a1: number;
  a2: number;
  frequency: number;
}

/** What a band's filter needs: its shape, slope, frequency, Q and the gain it's at. */
export type BandFilter = Pick<EqBand, "shape" | "slope" | "frequency" | "q" | "gain">;

const SQRT2 = Math.SQRT2;
/** The 14th-order elliptic low pass (0.05 dB ripple, 100 dB down) behind Brickwall, -3 dB at 1: [ωz², a1, a0] per section. */
export const BRICKWALL: readonly (readonly [number, number, number])[] = [
  [1.16875010689, 0.0157315728044, 0.996392865059],
  [1.21480940173, 0.0532890912819, 0.965291173716],
  [1.33515576153, 0.110317002406, 0.893416009502],
  [1.61897467419, 0.202044716507, 0.763645449376],
  [2.37218547572, 0.33888282627, 0.563421310846],
  [5.2094901803, 0.504391367122, 0.318743738755],
  [41.0045579738, 0.629812734107, 0.132729794846],
];
/** Its pass band sits this far down (its ripple's bottom), in amplitude. */
const BRICKWALL_GAIN = 10 ** (-0.05 / 20);

/** Gain-Q interaction (Bell only): a band narrows as it's boosted or cut, as an analog EQ's does. */
export const gainQ = (q: number, gain: number) => q * 10 ** (Math.abs(gain) / 80);

/** A slope's order (dB/oct over 6); Brickwall is its own. */
const order = (slope: EqBand["slope"]) => (slope === "brickwall" ? 0 : slope / 6);

/** A complex number, as [re, im]. */
type C = [number, number];
const cmul = (a: C, b: C): C => [a[0] * b[0] - a[1] * b[1], a[0] * b[1] + a[1] * b[0]];
const csqrt = ([re, im]: C): C => {
  const r = Math.hypot(re, im);
  const x = Math.sqrt(Math.max(0, (r + re) / 2));
  const y = Math.sqrt(Math.max(0, (r - re) / 2));
  return [x, im < 0 ? -y : y];
};

/** The Butterworth angles of an order-M shelf: its roots are -r·e^{±jα} (and -r for odd M), the widest first. */
function butterworthAngles(m: number): number[] {
  const angles: number[] = [];
  for (let k = 1; k <= Math.floor(m / 2); k++) angles.push((0.5 - (2 * k - 1) / (2 * m)) * Math.PI);
  return angles;
}

/**
 * A symmetric Butterworth low shelf of order `m` with gain `g` (amplitude) at DC and 1 at the top, its
 * sharpest section's damping divided by `q` (1: Butterworth): as quadratics and a first-order factor in p.
 */
function shelfFactors(m: number, g: number, q: number): { quads: [number, number, number, number][]; first: [number, number] | null } {
  const rz = g ** (1 / (2 * m));
  const rp = 1 / rz;
  // Each pair: (p² + 2cos(α)·rz·p + rz²) / (p² + 2cos(α)·rp·p + rp²).
  const quads = butterworthAngles(m).map((alpha, i): [number, number, number, number] => {
    const damping = (2 * Math.cos(alpha)) / (i === 0 ? q : 1);
    return [damping * rz, rz * rz, damping * rp, rp * rp];
  });
  return { quads, first: m % 2 === 1 ? [rz, rp] : null };
}

/** The sections of a low-pass-to-band-pass transform p = Qr (s + 1/s) of polynomial factors in p. */
function bandTransform(factors: { quads: [number, number][]; first: number[] }, qr: number): [number, number][] {
  // Each root r of a factor (p + r) becomes s = c ± √(c² - 1), c = r / (2Qr): one quadratic s² - 2c·s + 1
  // for a real root; for a conjugate pair of roots, two quadratics (one root above 1 in size, one below).
  const out: [number, number][] = [];
  for (const r of factors.first) out.push([(2 * r) / (2 * qr), 1]);
  for (const [b, c] of factors.quads) {
    // The roots of p² + b p + c: -b/2 ± √(b²/4 - c).
    const disc = (b * b) / 4 - c;
    const roots: C[] = disc >= 0 ? [[-b / 2 + Math.sqrt(disc), 0], [-b / 2 - Math.sqrt(disc), 0]] : [[-b / 2, Math.sqrt(-disc)]];
    if (disc >= 0) {
      // Two real roots: each its own quadratic s² + (2r/2Qr)... with r = -root.
      for (const root of roots) out.push([(-2 * root[0]) / (2 * qr), 1]);
      continue;
    }
    // A conjugate pair: c = root / (2Qr) for the root with Im > 0; s = c ± √(c² - 1), each with its conjugate.
    const cc: C = [roots[0][0] / (2 * qr), roots[0][1] / (2 * qr)];
    const d = csqrt([cc[0] * cc[0] - cc[1] * cc[1] - 1, 2 * cc[0] * cc[1]]);
    // (s - x)(s - x̄) = s² - 2Re(x) s + |x|²: the larger root's first, so zeros and poles pair up by size.
    const pair = ([
      [cc[0] + d[0], cc[1] + d[1]],
      [cc[0] - d[0], cc[1] - d[1]],
    ] as C[]).map((x): [number, number] => [-2 * x[0], x[0] * x[0] + x[1] * x[1]]);
    pair.sort((a, b) => b[1] - a[1]);
    out.push(...pair);
  }
  return out;
}

/** A band as analog sections, at its own gain (or `gain` when given: where its dynamics take it). */
export function bandSections(band: BandFilter, gain = band.gain): Section[] {
  const f = band.frequency;
  const qr = band.q / SQRT2;
  const n = order(band.slope);
  const sec = (b0: number, b1: number, b2: number, a0: number, a1: number, a2: number, frequency = f): Section => ({ b0, b1, b2, a0, a1, a2, frequency });
  const g = 10 ** (gain / 20);
  switch (band.shape) {
    case "bell": {
      // An order-M symmetric shelf (M = slope / 12) turned into a band around f: its half-gain points at Ω = ±1.
      const m = Math.max(1, Math.round(n / 2));
      if (m === 1) {
        // The RBJ peaking filter, with Qr.
        const a = Math.sqrt(g);
        return [sec(1, a / qr, 1, 1, 1 / (a * qr), 1)];
      }
      const { quads, first } = shelfFactors(m, g, 1);
      const zeros = bandTransform({ quads: quads.map(([b1, b0]) => [b1, b0]), first: first ? [first[0]] : [] }, qr);
      const poles = bandTransform({ quads: quads.map(([, , b1, b0]) => [b1, b0]), first: first ? [first[1]] : [] }, qr);
      return zeros.map((z, i) => sec(z[1], z[0], 1, poles[i][1], poles[i][0], 1));
    }
    case "lowShelf":
    case "highShelf":
    case "tiltShelf": {
      const m = Math.max(1, n);
      // A tilt is a high shelf turned down by half its gain: -G/2 below, +G/2 above, 0 dB at f.
      const low = band.shape === "lowShelf";
      const { quads, first } = shelfFactors(m, g, band.q);
      const out: Section[] = [];
      // A low shelf's factors in p; a high shelf's are the same with p → 1/p (the gain moves to the top),
      // which reverses each polynomial.
      if (first) out.push(low ? sec(first[0], 1, 0, first[1], 1, 0) : sec(1, first[0], 0, 1, first[1], 0));
      for (const [zb, zc, pb, pc] of quads) out.push(low ? sec(zc, zb, 1, pc, pb, 1) : sec(1, zb, zc, 1, pb, pc));
      if (band.shape === "tiltShelf") {
        const k = 1 / Math.sqrt(g);
        out[0] = { ...out[0], b0: out[0].b0 * k, b1: out[0].b1 * k, b2: out[0].b2 * k };
      }
      return out;
    }
    case "lowCut":
    case "highCut": {
      const high = band.shape === "highCut";
      if (band.slope === "brickwall") {
        // The elliptic low pass, each section unity at DC (a high pass: p → 1/p).
        return BRICKWALL.map(([wz2, a1, a0], i) => {
          const k = (a0 / wz2) * (i === 0 ? BRICKWALL_GAIN : 1);
          return high ? sec(k * wz2, 0, k, a0, a1, 1) : sec(k, 0, k * wz2, 1, a1, a0);
        });
      }
      // Butterworth of order N, Q on its sharpest section.
      const out: Section[] = [];
      if (n % 2 === 1) out.push(high ? sec(1, 0, 0, 1, 1, 0) : sec(0, 1, 0, 1, 1, 0));
      for (let k = 0; k < Math.floor(n / 2); k++) {
        const qk = 1 / (2 * Math.sin(((2 * k + 1) * Math.PI) / (2 * n)));
        const damping = 1 / (qk * (k === 0 ? band.q : 1));
        out.push(high ? sec(1, 0, 0, 1, damping, 1) : sec(0, 0, 1, 1, damping, 1));
      }
      return out;
    }
    case "notch": {
      // An order-M Butterworth high pass turned into a band: its zeros on f, its -3 dB points at Ω = ±1.
      const m = Math.max(1, Math.round(n / 2));
      if (m === 1) return [sec(1, 0, 1, 1, 1 / qr, 1)];
      const poles = bandTransform({ quads: butterworthAngles(m).map((alpha) => [2 * Math.cos(alpha), 1]), first: m % 2 ? [1] : [] }, qr);
      return poles.map((p) => sec(1, 0, 1, p[1], p[0], 1));
    }
    case "bandPass": {
      // An order-N Butterworth low pass turned into a band: its skirts fall at the slope, 0 dB at f.
      const poles = bandTransform({ quads: butterworthAngles(n).map((alpha) => [2 * Math.cos(alpha), 1]), first: n % 2 ? [1] : [] }, qr);
      const sections = poles.map((p) => sec(0, 1 / qr, 0, p[1], p[0], 1));
      // Each section's numerator s/Qr; scaled together so the centre is exactly 0 dB.
      const [re, im] = responseAt(sections, f);
      sections[0] = { ...sections[0], b1: sections[0].b1 / Math.hypot(re, im) };
      return sections;
    }
    case "flatTilt":
      return flatTilt(f, gain);
  }
}

/** Flat Tilt's slope for its gain: the gain is reached about 5 octaves from the pivot (±30 dB: ±6 dB/oct). */
export const flatTiltSlope = (gain: number) => gain / (0.5 * Math.log2(20_000 / 20));

/**
 * Flat Tilt: a straight line in dB per octave through 0 dB at `pivot`, from first-order shelves an octave
 * apart from about 2 Hz to 100 kHz (each period a zero then a pole, so the line's slope is the share of
 * the octave between them times 6.02 dB).
 */
function flatTilt(pivot: number, gain: number): Section[] {
  const slope = flatTiltSlope(gain);
  if (Math.abs(slope) < 1e-9) return [];
  const share = Math.min(1, Math.abs(slope) / (20 * Math.log10(2)));
  const out: Section[] = [];
  const from = Math.floor(Math.log2(2 / pivot));
  const to = Math.ceil(Math.log2(100_000 / pivot));
  for (let k = from; k <= to; k++) {
    const corner = pivot * 2 ** k;
    const zero = slope > 0 ? corner : corner * 2 ** share;
    const pole = slope > 0 ? corner * 2 ** share : corner;
    // (1 + s/zero)/(1 + s/pole), in p = s/(2π·zero): (1 + p) / (1 + p·zero/pole).
    out.push({ b0: 1, b1: 1, b2: 0, a0: 1, a1: zero / pole, a2: 0, frequency: zero });
  }
  // 0 dB at the pivot.
  const [re, im] = responseAt(out, pivot);
  const k = 1 / Math.hypot(re, im);
  out[0] = { ...out[0], b0: out[0].b0 * k, b1: out[0].b1 * k };
  return out;
}

/** The sections' response at `hz`, as [re, im]. */
export function responseAt(sections: readonly Section[], hz: number): C {
  let h: C = [1, 0];
  for (const s of sections) {
    const w = hz / s.frequency;
    // (b0 - b2 w² + j b1 w) / (a0 - a2 w² + j a1 w)
    const nr = s.b0 - s.b2 * w * w;
    const ni = s.b1 * w;
    const dr = s.a0 - s.a2 * w * w;
    const di = s.a1 * w;
    const d = dr * dr + di * di || 1e-300;
    h = cmul(h, [(nr * dr + ni * di) / d, (ni * dr - nr * di) / d]);
  }
  return h;
}

/** A band's level in dB at each of `frequencies` (its curve), at `gain` (its own by default). */
export function bandCurve(band: BandFilter, frequencies: ArrayLike<number>, gain = band.gain): Float64Array {
  const sections = bandSections(band, gain);
  const out = new Float64Array(frequencies.length);
  for (let i = 0; i < frequencies.length; i++) {
    const [re, im] = responseAt(sections, frequencies[i]);
    out[i] = 10 * Math.log10(re * re + im * im || 1e-30);
  }
  return out;
}

// ---------------------------------------------------------------------------
// The whole EQ
// ---------------------------------------------------------------------------

/** A band as the filters play it: its gain scaled (Gain Scale), and narrowed by Gain-Q interaction. */
export function playedBand<T extends EqBand>(band: T, state: Pick<ProQState, "gainScale" | "gainQ">): T {
  if (!hasGain(band.shape)) return band;
  const gain = band.gain * state.gainScale;
  const range = band.range * state.gainScale;
  const q = state.gainQ && band.shape === "bell" ? Math.min(40, gainQ(band.q, gain)) : band.q;
  return gain === band.gain && range === band.range && q === band.q ? band : { ...band, gain, range, q };
}

/** The parts of a stereo sound the curves are drawn for: what's done to both sides, to each, to the mid, the side. */
export type CurveGroup = EqPlacement;

/**
 * Each placement's curve (dB at `frequencies`): the bands working on it, multiplied. `stereo` has the
 * stereo bands alone; a left band's curve has the stereo ones too (as Pro-Q groups them), and so on.
 */
export function placementCurves(state: ProQState, frequencies: ArrayLike<number>, gains?: ReadonlyMap<number, number>): Map<CurveGroup, Float64Array> {
  const used = new Set<CurveGroup>(["stereo"]);
  const bands = state.bands.filter((b) => b.enabled).map((b) => playedBand(b, state));
  for (const b of bands) used.add(b.placement);
  const curves = new Map<CurveGroup, Float64Array>();
  const per = bands.map((b) => ({ placement: b.placement, curve: bandCurve(b, frequencies, gains?.get(b.id) ?? b.gain) }));
  for (const group of used) {
    const total = new Float64Array(frequencies.length);
    for (const { placement, curve } of per) if (placement === group || placement === "stereo") for (let i = 0; i < total.length; i++) total[i] += curve[i];
    curves.set(group, total);
  }
  return curves;
}

// ---------------------------------------------------------------------------
// Auto Gain
// ---------------------------------------------------------------------------

/** 1/12-octave from 20 Hz to 20 kHz: where Auto Gain weighs the curve. */
const AUTO_FREQUENCIES = Array.from({ length: 12 * 10 + 1 }, (_, i) => 20 * 2 ** (i / 12)).filter((f) => f <= 20_000);
/** ITU-R BS.1770's K-weighting (its high shelf and high pass, as analog sections): how loud each part sounds. */
const K_WEIGHTING: Section[] = [
  ...bandSections({ shape: "highShelf", slope: 12, frequency: 1682, q: 1, gain: 4 }),
  ...bandSections({ shape: "lowCut", slope: 12, frequency: 38, q: 0.5 * SQRT2, gain: 0 }),
];
const AUTO_WEIGHTS = AUTO_FREQUENCIES.map((f) => {
  const [re, im] = responseAt(K_WEIGHTING, f);
  // Pink: equal power per octave, so uniform on this log grid.
  return re * re + im * im;
});

/**
 * Auto Gain (Pro-Q's "educated guess based on the current EQ settings"): the level, in dB, that
 * takes back what the curve adds or removes, weighed as music is heard (pink, K-weighted), the side
 * counting for less than the mid, and a dynamic band at the middle of its range.
 */
export function autoGain(state: ProQState): number {
  const bands = state.bands.filter((b) => b.enabled).map((b) => playedBand(b, state));
  if (!bands.length) return 0;
  // Each part's power gain at each frequency (left, right, mid, side).
  // (Stereo bands count once: with the left and right ones.)
  const power = (placements: EqPlacement[]) => {
    const db = new Float64Array(AUTO_FREQUENCIES.length);
    for (const b of bands) {
      if (!placements.includes(b.placement)) continue;
      const curve = bandCurve(b, AUTO_FREQUENCIES, b.gain + (b.dynamics ? b.range / 2 : 0));
      for (let i = 0; i < db.length; i++) db[i] += curve[i];
    }
    return Array.from(db, (d) => 10 ** (d / 10));
  };
  const left = power(["stereo", "left"]);
  const right = power(["stereo", "right"]);
  const mid = power(["mid"]);
  const side = power(["side"]);
  const SIDE = 0.25;
  let sum = 0;
  let weights = 0;
  for (let i = 0; i < AUTO_FREQUENCIES.length; i++) {
    const lr = (left[i] + right[i]) / 2;
    const ms = (mid[i] + SIDE * side[i]) / (1 + SIDE);
    sum += AUTO_WEIGHTS[i] * lr * ms;
    weights += AUTO_WEIGHTS[i];
  }
  return Math.max(-36, Math.min(36, -10 * Math.log10(sum / weights)));
}
