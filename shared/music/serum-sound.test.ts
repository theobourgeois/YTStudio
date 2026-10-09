import { describe, expect, it } from "vitest";
import {
  envelopeOutline,
  envelopeSeconds,
  envelopeText,
  envelopeValueOf,
  lfoDivision,
  lfoText,
  lfoValueOf,
  modAmountOf,
  modAmountText,
  modAmountToValue,
  routesBySource,
  type SerumControl,
  type SerumModRoute,
  serumEnvelopeParam,
  serumLfoParam,
  serumModAmountParam,
  sourceDrives,
  soloOscillator,
  sourceUsed,
  withControl,
} from "./serum-sound.ts";

const route = (slot: number, source: string, to: string, extra: Partial<SerumModRoute> = {}): SerumModRoute => ({
  slot,
  source,
  aux: null,
  to,
  amount: { param: serumModAmountParam(slot), value: 0.75 },
  bipolar: false,
  bypass: false,
  ...extra,
});

describe("Serum's live controls", () => {
  it("are numbered as Serum numbers them", () => {
    expect(serumModAmountParam(1)).toBe("6000000");
    expect(serumModAmountParam(6)).toBe("6005000");
    expect(serumEnvelopeParam(1, "attack")).toBe("3000000");
    expect(serumEnvelopeParam(2, "sustain")).toBe("3001003");
    expect(serumEnvelopeParam(4, "releaseCurve")).toBe("3003007");
    expect(serumLfoParam(1, "rate")).toBe("4000000");
    expect(serumLfoParam(10, "phase")).toBe("4009004");
  });

  it("map a mod amount to its position and back (measured: 0.6 is 20%, 0.25 is −50%)", () => {
    expect(modAmountToValue(20)).toBeCloseTo(0.6);
    expect(modAmountToValue(-50)).toBeCloseTo(0.25);
    expect(modAmountOf(0.9)).toBeCloseTo(80);
    expect(modAmountText(0.3)).toBe("-40%");
    expect(modAmountText(0.5)).toBe("0%");
  });

  it("map envelope times as Serum does: 32·v⁵ seconds (measured: 0.5 is 1 s, 0.25 is 31 ms)", () => {
    expect(envelopeSeconds(0.5)).toBeCloseTo(1);
    expect(envelopeValueOf("attack", 0.03125)).toBeCloseTo(0.25);
    expect(envelopeValueOf("decay", 32)).toBe(1);
    expect(envelopeText(2, "attack", 0.1)).toBe("0.3 ms");
    expect(envelopeText(2, "attack", 0.25)).toBe("31 ms");
    expect(envelopeText(2, "decay", 0.5)).toBe("1.00 s");
    expect(envelopeText(2, "release", 0.75)).toBe("7.59 s");
    expect(envelopeText(2, "release", 0.9)).toBe("18.9 s");
  });

  it("show a sustain as its gain: Env 1's in dB, the others' in % (measured: 0.5 is −12.0 dB, 25%)", () => {
    expect(envelopeValueOf("sustain", 0.5)).toBe(0.5);
    expect(envelopeText(1, "sustain", 0.5)).toBe("-12.0 dB");
    expect(envelopeText(1, "sustain", 0)).toBe("-∞ dB");
    expect(envelopeText(2, "sustain", 0.5)).toBe("25%");
    expect(envelopeText(3, "attackCurve", 0.666)).toBe("67");
  });

  it("map an LFO's rate along the knob's fourth power, synced into Serum's bands (measured: the middle is 1/4)", () => {
    expect(lfoValueOf("rate", 6.25)).toBeCloseTo(0.5);
    expect(lfoDivision(0.5)).toBe("1/4");
    expect(lfoDivision(0)).toBe("32 bar");
    expect(lfoDivision(0.25)).toBe("4 bar");
    expect(lfoDivision(0.75)).toBe("1/32");
    expect(lfoDivision(0.5 + 1.5 / 42, { dotted: true, triplets: true })).toBe("1/8.");
    expect(lfoDivision(0.5 + 2.5 / 42, { triplets: true })).toBe("1/4 t");
    const free = { sync: false, dotted: false, triplets: false, rate10x: false };
    expect(lfoText(free, "rate", 0.5)).toBe("6.25 Hz");
    expect(lfoText(free, "rate", 0.75)).toBe("31.6 Hz");
    expect(lfoText({ ...free, rate10x: true }, "rate", 0.5)).toBe("62.5 Hz");
  });

  it("map rise, delay, smooth and phase as Serum stores them (a synced rise or delay is Serum's to show)", () => {
    expect(lfoValueOf("rise", 2)).toBe(0.5);
    expect(lfoValueOf("phase", 90)).toBe(0.25);
    const free = { sync: false, dotted: false, triplets: false, rate10x: false };
    expect(lfoText(free, "rise", 0.5)).toBe("2.0 s");
    expect(lfoText(free, "delay", 0)).toBe("Off");
    expect(lfoText({ ...free, sync: true }, "rise", 0.5)).toBeNull();
    expect(lfoText(free, "phase", 0.25)).toBe("90°");
    expect(lfoText(free, "smooth", 0.1)).toBe("10");
  });
});

describe("the mod matrix", () => {
  const routes = [route(1, "LFO 1", "Filter 1 Freq"), route(2, "Macro 1", "A WT Pos"), route(3, "LFO 1", "A Level", { bypass: true }), route(4, "Env 2", "B Fine", { aux: "Macro 1" }), route(5, "LFO 3 Y", "Sub Level")];

  it("groups routes by their source, in the matrix's order", () => {
    expect(routesBySource(routes).map((g) => [g.source, g.routes.map((r) => r.slot)])).toEqual([
      ["LFO 1", [1, 3]],
      ["Macro 1", [2]],
      ["Env 2", [4]],
      ["LFO 3 Y", [5]],
    ]);
  });

  it("says what a source drives (as source or aux, bypassed routes left out) and whether it's used", () => {
    expect(sourceDrives(routes, "Macro 1")).toEqual(["A WT Pos", "B Fine"]);
    expect(sourceDrives(routes, "LFO 1")).toEqual(["Filter 1 Freq"]);
    expect(sourceUsed(routes, "LFO 3")).toBe(true);
    expect(sourceUsed(routes, "Env 3")).toBe(false);
  });
});

describe("withControl", () => {
  const controls = (ids: string[]) => Object.fromEntries(ids.map((id, i) => [String(i), { param: id, value: 0 } satisfies SerumControl]));
  const sound = {
    modulation: [route(1, "LFO 1", "Filter 1 Freq")],
    envelopes: [{ index: 1, used: true, controls: controls(["3000000", "3000001"]) as never }],
    lfos: [{ index: 1, controls: controls(["4000000"]) } as never],
    macros: [{ param: "7000000", value: 0 }],
  };

  it("moves the one control that has the parameter, wherever it is, and leaves the rest the same objects", () => {
    const moved = withControl(sound, "6000000", 0.2);
    expect(moved.modulation![0].amount.value).toBe(0.2);
    expect(moved.envelopes[0]).toBe(sound.envelopes[0]);
    const env = withControl(sound, "3000001", 0.4);
    expect((Object.values(env.envelopes[0].controls) as SerumControl[]).map((c) => c.value)).toEqual([0, 0.4]);
    expect(env.lfos[0]).toBe(sound.lfos[0]);
    expect(withControl(sound, "7000000", 1).macros[0].value).toBe(1);
  });
});

describe("envelopeOutline", () => {
  it("draws each stage as wide as its control's position, the sustain at its gain", () => {
    const c = (value: number) => ({ param: "", value });
    const { points } = envelopeOutline({ controls: { attack: c(0.5), hold: c(0), decay: c(1), sustain: c(0.5), release: c(0.25), attackCurve: c(0.5), decayCurve: c(0.5), releaseCurve: c(0.5) } }, 100);
    expect(points).toEqual([
      [0, 0],
      [50, 1],
      [50, 1],
      [150, 0.25],
      [210, 0.25],
      [235, 0],
    ]);
  });
});

describe("soloing an oscillator", () => {
  const osc = (index: number, on: boolean) =>
    ({ index, name: "A", kind: "Wavetable", plays: "", enabled: { param: `e${index}`, value: on ? 1 : 0 }, level: { param: `l${index}`, value: 0.75 }, octave: 0, semi: 0 }) as const;
  const oscillators = [osc(0, true), osc(1, true), osc(2, false), osc(3, false), osc(4, true)];

  it("turns it on and the rest off, then puts every switch back as it was", () => {
    const first = soloOscillator(oscillators, 1, null);
    expect(first.values).toEqual({ e0: 0, e1: 1, e2: 0, e3: 0, e4: 0 });
    expect(first.solo).toEqual({ index: 1, before: { e0: 1, e1: 1, e2: 0, e3: 0, e4: 1 } });
    expect(soloOscillator(oscillators, 1, first.solo)).toEqual({ values: { e0: 1, e1: 1, e2: 0, e3: 0, e4: 1 }, solo: null });
  });

  it("moves to another oscillator, still putting back the state from before the first", () => {
    const first = soloOscillator(oscillators, 1, null);
    const moved = soloOscillator(oscillators, 2, first.solo);
    expect(moved.values).toEqual({ e0: 0, e1: 0, e2: 1, e3: 0, e4: 0 });
    expect(soloOscillator(oscillators, 2, moved.solo).values).toEqual(first.solo!.before);
  });
});
