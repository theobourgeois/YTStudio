import { describe, expect, it } from "vitest";
import { serumModAmountParam } from "../../../shared/music/serum-sound.ts";
import { SpecError, specToBody } from "./body.ts";
import type { CborMap } from "./cbor.ts";
import { destinationNames, editSerumBody, macroNamesOf, readSoundParts, withMacroNames } from "./sound.ts";
import type { SerumPresetSpec } from "./spec.ts";

const body = (spec: Partial<SerumPresetSpec> = {}) => specToBody({ name: "Test", ...spec } as SerumPresetSpec);

describe("reading a Serum sound", () => {
  it("lists the routes by slot, named as Serum names sources and destinations, with their amounts as positions", () => {
    const { modulation } = readSoundParts(
      body({
        modulation: [
          { slot: 3, source: "LFO 1", to: "Filter 1 Freq", amount: 20 },
          { slot: 6, source: "Env 2", aux: "Macro 2", to: "A WT Pos", amount: -40, bipolar: true },
        ],
      }),
    );
    expect(modulation).toEqual([
      { slot: 3, source: "LFO 1", aux: null, to: "Filter 1 Freq", amount: { param: serumModAmountParam(3), value: 0.6 }, bipolar: false, bypass: false },
      { slot: 6, source: "Env 2", aux: "Macro 2", to: "A WT Pos", amount: { param: serumModAmountParam(6), value: 0.3 }, bipolar: true, bypass: false },
    ]);
  });

  it("names an effect's parameter by its rack and place", () => {
    const { modulation } = readSoundParts(body({ fx: { main: [{ effect: "distortion" }, { effect: "reverb" }] }, modulation: [{ source: "Macro 1", to: "Main FX 2 Wet", amount: 50 }] }));
    expect(modulation[0].to).toBe("Main FX 2 Wet");
  });

  it("reads envelopes and LFOs as their controls' positions, Serum's defaults where it stores nothing", () => {
    const { envelopes, lfos } = readSoundParts(
      body({
        envelopes: { "2": { attack: 1000, sustain: 50 } },
        lfos: { "1": { sync: false, rate: 6.25, phase: 90 }, "3": { rate: "1/4", mode: "Envelope", shape: { points: [[0, 0], [0.5, 1, 0.2], [1, 0]] } } },
        modulation: [{ source: "LFO 3", to: "A Level", amount: 10 }],
      }),
    );
    expect(envelopes[0].used).toBe(true);
    expect(envelopes[0].controls.attack.value).toBeCloseTo((0.001 / 32) ** 0.2);
    expect(envelopes[1].used).toBe(false);
    expect(envelopes[1].controls.attack.value).toBeCloseTo(0.5);
    expect(envelopes[1].controls.sustain.value).toBe(0.5);
    expect(envelopes[1].controls.decay.value).toBeCloseTo(0.5);
    expect(lfos[0]).toMatchObject({ sync: false, mode: "retrigger", customShape: false, used: false });
    expect(lfos[0].controls.rate.value).toBeCloseTo(0.5);
    expect(lfos[0].controls.phase.value).toBe(0.25);
    expect(lfos[2]).toMatchObject({ sync: true, mode: "envelope", customShape: true, used: true });
    expect(lfos[2].shape).toEqual([[0, 0], [0.5, 1, 0.2], [1, 0]]);
    expect(lfos[2].controls.rate.value).toBeCloseTo(0.5);
  });

  it("takes a control's position from the engine when it reports one", () => {
    const parts = readSoundParts(body({ modulation: [{ source: "LFO 1", to: "A Level", amount: 0 }] }), new Map([[serumModAmountParam(1), { value: 0.9, text: "80%" }]]));
    expect(parts.modulation[0].amount).toEqual({ param: serumModAmountParam(1), value: 0.9, text: "80%" });
  });
});

describe("editing a Serum sound", () => {
  const routed = body({ modulation: [{ slot: 2, source: "LFO 1", to: "Filter 1 Freq", amount: 20 }] });

  it("adds a route in the first free slot (50% when no amount is given), leaving the original alone", () => {
    const out = editSerumBody(routed, [{ kind: "route", source: "Macro 1", to: "A WT Pos" }]);
    expect(readSoundParts(out).modulation.map((r) => [r.slot, r.source, r.to, Math.round((r.amount.value * 2 - 1) * 100)])).toEqual([
      [1, "Macro 1", "A WT Pos", 50],
      [2, "LFO 1", "Filter 1 Freq", 20],
    ]);
    expect(readSoundParts(routed).modulation).toHaveLength(1);
  });

  it("changes a route's source, destination, amount and switches, keeping the rest", () => {
    const out = editSerumBody(routed, [{ kind: "route", slot: 2, source: "Env 2", to: "A Level", bipolar: true }]);
    const [r] = readSoundParts(out).modulation;
    expect(r).toMatchObject({ slot: 2, source: "Env 2", to: "A Level", bipolar: true });
    expect(r.amount.value).toBeCloseTo(0.6);
    const off = editSerumBody(out, [{ kind: "route", slot: 2, bipolar: false, bypass: true, aux: "Velo" }]);
    expect(readSoundParts(off).modulation[0]).toMatchObject({ bipolar: false, bypass: true, aux: "Velo" });
  });

  it("removes a route", () => {
    expect(readSoundParts(editSerumBody(routed, [{ kind: "removeRoute", slot: 2 }])).modulation).toEqual([]);
  });

  it("sets envelopes and LFOs in the spec's units, an LFO's mode and shape too", () => {
    const out = editSerumBody(routed, [
      { kind: "envelope", envelope: 2, attack: 1000, sustain: 50 },
      { kind: "lfo", lfo: 1, rate: "1/8", mode: "free", shape: [[0, 0], [1, 1]] },
      { kind: "lfo", lfo: 2, rate: 2 },
    ]);
    const { envelopes, lfos } = readSoundParts(out);
    expect(envelopes[1].controls.attack.value).toBeCloseTo(0.5);
    expect(lfos[0]).toMatchObject({ sync: true, mode: "free", customShape: true, shape: [[0, 0], [1, 1]] });
    expect(lfos[1].sync).toBe(false);
    const back = editSerumBody(out, [{ kind: "lfo", lfo: 1, mode: "retrigger", shape: null }]);
    expect(readSoundParts(back).lfos[0]).toMatchObject({ mode: "retrigger", customShape: false });
  });

  it("says what's wrong with an edit, and what would do", () => {
    const problems = (edits: unknown) => {
      try {
        editSerumBody(routed, edits);
      } catch (e) {
        expect(e).toBeInstanceOf(SpecError);
        return (e as SpecError).problems;
      }
      throw new Error("no error");
    };
    expect(problems([])[0]).toMatch(/must be a list/);
    expect(problems([{ kind: "route", slot: 5, amount: 10 }])[0]).toMatch(/needs "source" and "to".*routed slots are 2/);
    expect(problems([{ kind: "route", source: "Wobble", to: "A Level" }])[0]).toMatch(/a source is one of: Mod Wheel/);
    expect(problems([{ kind: "route", source: "LFO 1", to: "Nowhere" }])[0]).toMatch(/isn't a destination/);
    expect(problems([{ kind: "removeRoute", slot: 9 }])[0]).toMatch(/no route to remove; the routed slots are 2/);
    expect(problems([{ kind: "envelope", envelope: 5 }])[0]).toMatch(/1 to 4/);
    expect(problems([{ kind: "lfo", lfo: 1, wobble: 1 }])[0]).toMatch(/isn't an LFO's/);
    expect(problems([{ kind: "lfo", lfo: 1, shape: [[0.5, 0]] }])[0]).toMatch(/points/);
  });
});

describe("names and destinations", () => {
  it("writes the preset's macro names back where Serum reads them", () => {
    const named = withMacroNames(body() as CborMap, ["GRIT", "", "SPACE"]);
    expect(macroNamesOf(named)).toEqual(["GRIT", "", "SPACE", "", "", "", "", ""]);
  });

  it("lists every destination by name: Serum's controls and the sound's effects' parameters", () => {
    const names = destinationNames(body({ fx: { bus1: [{ effect: "reverb" }] } }));
    expect(names).toContain("Filter 1 Freq");
    expect(names).toContain("A WT Pos");
    expect(names).toContain("Bus 1 FX 1 Wet");
    expect(names.some((n) => / Param\d+$/.test(n))).toBe(false);
  });
});
