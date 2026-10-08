import { describe, expect, it } from "vitest";
import { BUS_PERCENT, CUTOFF_HZ, divisionOf, exactSpecValue, FILTER_DB, GAIN_PERCENT, LFO_DIVISIONS, MS, PERCENT, PLAIN } from "./units.ts";

/** Repeatable doubles in [0, 1) with all 52 bits of fraction used. */
function doubles(count: number, seed: number): number[] {
  let x = seed;
  const next = () => (x = (x * 1_103_515_245 + 12_345) % 2_147_483_648) >>> 5; // 26 bits
  return Array.from({ length: count }, () => (next() * 2 ** 26 + next()) / 2 ** 52);
}

describe("units", () => {
  it("say a filter's cutoff as Serum shows it", () => {
    expect(CUTOFF_HZ.toSpec(0)).toBeCloseTo(8.1758, 4);
    expect(Math.round(CUTOFF_HZ.toSpec(0.5))).toBe(425);
    expect(Math.round(CUTOFF_HZ.toSpec(0.3))).toBe(88);
    expect(Math.round(CUTOFF_HZ.toSpec(0.8))).toBe(4549);
    expect(CUTOFF_HZ.toSpec(1)).toBeCloseTo(22093.89, 2);
    expect(CUTOFF_HZ.toPlain(CUTOFF_HZ.toSpec(0.37))).toBeCloseTo(0.37, 12);
  });

  it("say levels and dB as Serum's knobs show them", () => {
    expect(GAIN_PERCENT.toSpec(0.5625)).toBe(75);
    expect(GAIN_PERCENT.toPlain(50)).toBe(0.25);
    expect(BUS_PERCENT.toSpec(0.5)).toBe(50);
    expect(FILTER_DB.toSpec(0.5)).toBe(0);
    expect(FILTER_DB.toSpec(0.96784)).toBeCloseTo(11.473, 3);
  });

  it("read a stored value as a decimal that writes back exactly, or not at all", () => {
    const values = doubles(2000, 7);
    const floats = values.map(Math.fround);
    // How many stored values have an exact decimal: squaring halves the doubles a level can reach.
    const least = new Map([[PLAIN, 1], [PERCENT, 0.7], [MS, 0.75], [GAIN_PERCENT, 0.35], [BUS_PERCENT, 0.35], [FILTER_DB, 0.75], [CUTOFF_HZ, 0.65]]);
    for (const [unit, share] of least) {
      const said = (list: number[]) =>
        list.filter((p) => {
          const v = exactSpecValue(p, unit);
          if (v !== undefined) expect(unit.toPlain(v)).toBe(p);
          return v !== undefined;
        }).length;
      expect(said(values) / values.length).toBeGreaterThanOrEqual(share);
      // What Serum stores is mostly 32-bit floats, which percentages and milliseconds always say exactly.
      if (unit === PERCENT || unit === MS) expect(said(floats)).toBe(floats.length);
    }
    expect(exactSpecValue(0.75, PERCENT)).toBe(75);
    expect(exactSpecValue(0.025, MS)).toBe(25);
    expect(exactSpecValue(0.5625, GAIN_PERCENT)).toBe(75);
  });

  it("place synced LFO divisions in the middle of their share of the knob", () => {
    expect(LFO_DIVISIONS.get("1/4")).toEqual({ kind: "straight", plain: 6.25 });
    expect(LFO_DIVISIONS.get("1/8.")?.kind).toBe("dotted");
    expect(LFO_DIVISIONS.get("1/16 t")?.kind).toBe("triplet");
    const plains = [...LFO_DIVISIONS.values()].map((d) => d.plain);
    expect(new Set(plains).size).toBe(plains.length);
    for (const [name, d] of LFO_DIVISIONS) expect(divisionOf(d.plain)).toBe(name);
    expect(divisionOf(6.3)).toBeUndefined();
  });
});
