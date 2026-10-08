/**
 * Units between what Serum stores (a parameter's "plain" value) and what the spec says, measured against what
 * Serum shows (its controls' text in the offline engine):
 *
 * - levels (oscillators, main volume): the plain value is a gain, the knob shows √gain as a percentage;
 * - bus and direct volumes: gain = 2 · plain, the knob shows √(plain / 2) as a percentage (50% is 0 dB);
 * - a filter's level: the knob shows 40 · log10(2 · plain) dB;
 * - a filter's cutoff: 440 · 2^((136.8 · plain − 69) / 12) Hz (checked on 1 002 values, every filter type);
 * - times are stored in seconds and shown in milliseconds;
 * - a synced LFO's rate is a free rate (Hz) whose knob position (plain / 100)^¼ falls in a division's band.
 *
 * A value read from a file becomes the shortest decimal that converts back to exactly the stored double, so a
 * preset read and written again is byte for byte the same. When no decimal does, the field isn't converted:
 * the plain value is kept as it is (`exactSpecValue` returns undefined).
 */

export interface NumberUnit {
  /** A stored value as the spec says it. */
  toSpec(plain: number): number;
  /** A spec value as Serum stores it. */
  toPlain(value: number): number;
  /** For the docs and error messages. */
  label: string;
}

const scale = (k: number, label: string): NumberUnit => ({ toSpec: (p) => p * k, toPlain: (v) => v / k, label });

/** The value as stored. */
export const PLAIN: NumberUnit = { toSpec: (p) => p, toPlain: (v) => v, label: "as stored" };
/** 0..1 stored, shown as 0..100 %. */
export const PERCENT = scale(100, "%");
/** Seconds stored, milliseconds in the spec. */
export const MS = scale(1000, "ms");
/** A gain stored, the knob's percentage (√gain × 100) in the spec. */
export const GAIN_PERCENT: NumberUnit = {
  toSpec: (p) => Math.sqrt(p) * 100,
  toPlain: (v) => (v / 100) ** 2,
  label: "% of the knob (gain = (v/100)²)",
};
/** Bus and direct volumes: 2·(v/100)² stored; 50% is unity gain. */
export const BUS_PERCENT: NumberUnit = {
  toSpec: (p) => Math.sqrt(p / 2) * 100,
  toPlain: (v) => 2 * (v / 100) ** 2,
  label: "% of the knob (50% = 0 dB)",
};
/** A filter's output level: 40·log10(2·plain) dB. */
export const FILTER_DB: NumberUnit = {
  toSpec: (p) => 40 * Math.log10(2 * p),
  toPlain: (v) => 10 ** (v / 40) / 2,
  label: "dB",
};
/** A filter's cutoff in Hz. */
export const CUTOFF_HZ: NumberUnit = {
  toSpec: (p) => 440 * 2 ** ((136.8 * p - 69) / 12),
  toPlain: (hz) => (69 + 12 * Math.log2(hz / 440)) / 136.8,
  label: "Hz",
};

/** The next double up or down from `x`. */
function nextDouble(x: number, up: boolean): number {
  if (Number.isNaN(x) || !Number.isFinite(x)) return x;
  if (x === 0) return up ? Number.MIN_VALUE : -Number.MIN_VALUE;
  const buf = new DataView(new ArrayBuffer(8));
  buf.setFloat64(0, x);
  const bits = buf.getBigUint64(0);
  buf.setBigUint64(0, (x > 0) === up ? bits + 1n : bits - 1n);
  return buf.getFloat64(0);
}

/**
 * The spec's value for a stored one: the shortest decimal (or a double a few steps from the exact
 * conversion) that `unit.toPlain` turns back into exactly `plain`. Undefined if there's none.
 */
export function exactSpecValue(plain: number, unit: NumberUnit): number | undefined {
  if (!Number.isFinite(plain)) return undefined;
  if (unit === PLAIN) return plain;
  const v = unit.toSpec(plain);
  if (!Number.isFinite(v)) return undefined;
  for (let digits = 1; digits <= 17; digits++) {
    const candidate = Number(v.toPrecision(digits));
    if (unit.toPlain(candidate) === plain) return candidate;
  }
  let down = v;
  let up = v;
  for (let i = 0; i < 64; i++) {
    if (unit.toPlain(up) === plain) return up;
    if (unit.toPlain(down) === plain) return down;
    up = nextDouble(up, true);
    down = nextDouble(down, false);
  }
  return undefined;
}

/**
 * Synced LFO rates. Serum's rate knob (position (plain/100)^¼) is cut into 14 bands, one per straight division
 * from 32 bars to 1/256; with dotted or triplet rates allowed each band is shared, a third each: straight,
 * dotted (of the next division up), triplet. A division's value here is the middle of its share, which Serum
 * shows as that division whether or not dotted and triplet rates are allowed (measured on 2 001 positions in
 * each of the four combinations).
 */
const STRAIGHT = ["32 bar", "16 bar", "8 bar", "4 bar", "2 bar", "bar", "1/2", "1/4", "1/8", "1/16", "1/32", "1/64", "1/128", "1/256"];
const DOTTED = ["24 bar", "12 bar", "6 bar", "3 bar", "1.5 bar", "1/2.", "1/4.", "1/8.", "1/16.", "1/32.", "1/64.", "1/128.", "1/256.", "1/512."];
const TRIPLET = STRAIGHT.map((d) => `${d} t`);

export type DivisionKind = "straight" | "dotted" | "triplet";

export const LFO_DIVISIONS: ReadonlyMap<string, { kind: DivisionKind; plain: number }> = new Map(
  [
    ...STRAIGHT.map((name, k) => [name, "straight", k] as const),
    ...DOTTED.map((name, k) => [name, "dotted", k + 1 / 3] as const),
    ...TRIPLET.map((name, k) => [name, "triplet", k + 2 / 3] as const),
  ].map(([name, kind, band]) => [name, { kind, plain: 100 * (band / 14) ** 4 }]),
);

/** A synced rate's division name, if the stored value is exactly a division's value here. */
export function divisionOf(plain: number): string | undefined {
  for (const [name, d] of LFO_DIVISIONS) if (d.plain === plain) return name;
  return undefined;
}
