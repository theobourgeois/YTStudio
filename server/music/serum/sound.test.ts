import { describe, expect, it } from "vitest";
import { serumModAmountParam } from "../../../shared/music/serum-sound.ts";
import { SpecError, specToBody } from "./body.ts";
import type { CborMap } from "./cbor.ts";
import { destinationNames, editSerumBody, fxLinksFor, type SerumChain, liveControls, macroNamesOf, readEffects, readRoutes, readSoundParts, sameLinks, withMacroNames } from "./sound.ts";
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

describe("oscillators", () => {
  it("says what each plays, whether it's on and its level, with Serum's defaults", () => {
    const oscillators = readSoundParts(
      body({ oscillators: { A: { level: 50, octave: -1 }, B: { enabled: true, wavetable: "Analog/Basic Shapes.wav" }, noise: { enabled: true }, sub: { enabled: true, shape: "kSaw" } } }),
    ).oscillators;
    expect(oscillators.map((o) => [o.name, o.kind, o.plays, o.enabled.value])).toEqual([
      ["A", "Wavetable", "Default Shapes", 1],
      ["B", "Wavetable", "Basic Shapes", 1],
      ["C", "Wavetable", "Default Shapes", 0],
      ["Noise", "Noise", "AC hum1", 1],
      ["Sub", "Sub", "Saw", 1],
    ]);
    expect(oscillators[0].level.value).toBeCloseTo(0.5);
    expect(oscillators[0].octave).toBe(-1);
    expect(oscillators[1].level.value).toBeCloseTo(0.75);
    expect(oscillators[3].level.value).toBeCloseTo(0.25);
    expect(oscillators[0].enabled.param).toBe("1000000");
    expect(oscillators[4].level.param).toBe("1004001");
  });
});


describe("effects", () => {
  const racks = () => body({ fx: { main: [{ effect: "distortion", drive: 60, mode: "kOverdrive" }, { effect: "reverb", wet: 30, type: "kHall" }], bus1: [{ effect: "delay", enabled: false }] } });
  const kinds = (b: CborMap) => readEffects(b).map((r) => r.effects.map((e) => e.effect));

  it("reads each rack's effects, their knobs at the places their stored values mean, Serum's defaults for the rest", () => {
    const [main, bus1, bus2] = readEffects(racks());
    expect(main.effects.map((e) => [e.position, e.effect])).toEqual([
      [1, "distortion"],
      [2, "reverb"],
    ]);
    const drive = main.effects[0].controls.find((c) => c.key === "kParamDrive")!;
    expect(drive).toEqual({ key: "kParamDrive", param: null, value: 0.6 });
    expect(main.effects[0].controls.find((c) => c.key === "kParamMode")!.value).toBeCloseTo(16 / 17);
    expect(main.effects[1].controls.find((c) => c.key === "kParamSize")!.value).toBeCloseTo(0.35);
    expect(bus1.effects[0].enabled!.value).toBe(0);
    expect(bus2.effects).toEqual([]);
  });

  it("links every effect's switch and its card's knobs to the rack's slots, and reads a linked knob from the engine", () => {
    const b = racks();
    const links = fxLinksFor(b);
    expect(links[0]!.slice(0, 3)).toEqual([
      { fxID: 0, paramIndex: 0 },
      { fxID: 1, paramIndex: 0 },
      { fxID: 0, paramIndex: 2 },
    ]);
    expect(links[1]).toHaveLength(5);
    expect(links[2]).toBeUndefined();
    const live = liveControls([{ id: "17000002", name: "FX 1: Dist Drive", value: 0.8, text: "80", index: 0 } as never, { id: "17000003", name: "FX 1: Rev Size", value: 0.5, text: "50", index: 1 } as never]);
    const [main] = readEffects(b, links, live);
    expect(main.effects[0].controls.find((c) => c.key === "kParamDrive")).toEqual({ key: "kParamDrive", param: "17000002", value: 0.8, text: "80" });
    expect(main.effects[0].enabled!.param).toBe("17000000");
    // The reverb's controls are named as Serum names them (they follow its type).
    expect(main.effects[1].controls.find((c) => c.key === "kParamSize")).toMatchObject({ param: "17000003", name: "Size" });
    // Not on a card: no slot, a reload sets it.
    expect(main.effects[0].controls.find((c) => c.key === "kParamFreq")!.param).toBeNull();
    expect(sameLinks(links, fxLinksFor(b))).toBe(true);
    expect(sameLinks(links, {})).toBe(false);
  });

  it("sets an effect's switch and settings by their spec names, in Serum's units or an option's name", () => {
    const out = editSerumBody(racks(), [
      { kind: "effect", rack: "main", position: 2, settings: { type: "Plate", size: 80 } },
      { kind: "effect", rack: "bus1", position: 1, enabled: true },
    ]);
    const [main, bus1] = readEffects(out);
    expect(main.effects[1].controls.find((c) => c.key === "kParamType")!.value).toBe(0);
    expect(main.effects[1].controls.find((c) => c.key === "kParamSize")!.value).toBeCloseTo(0.8);
    expect(bus1.effects[0].enabled!.value).toBe(1);
  });

  it("adds, removes and moves effects, the routes to them following", () => {
    const b = editSerumBody(racks(), [
      { kind: "route", source: "Macro 1", to: "Main FX 2 Size", amount: 40 },
      { kind: "route", source: "Macro 2", to: "Main FX 1 Drive", amount: 20 },
    ]);
    const added = editSerumBody(b, [{ kind: "addEffect", rack: "main", effect: "chorus", at: 1, settings: { wet: 40 } }]);
    expect(kinds(added)[0]).toEqual(["chorus", "distortion", "reverb"]);
    expect(readEffects(added)[0].effects[0].controls.find((c) => c.key === "kParamWet")!.value).toBeCloseTo(0.4);
    expect(readRoutes(added).map((r) => r.to)).toEqual(["Main FX 3 Size", "Main FX 2 Drive"]);

    const moved = editSerumBody(added, [{ kind: "moveEffect", rack: "main", position: 3, at: 1, toRack: "bus2" }]);
    expect(kinds(moved)).toEqual([["chorus", "distortion"], ["delay"], ["reverb"]]);
    expect(readRoutes(moved).map((r) => r.to)).toEqual(["Bus 2 FX 1 Size", "Main FX 2 Drive"]);

    const removed = editSerumBody(moved, [{ kind: "removeEffect", rack: "main", position: 2 }]);
    expect(kinds(removed)[0]).toEqual(["chorus"]);
    expect(readRoutes(removed).map((r) => r.to)).toEqual(["Bus 2 FX 1 Size"]);
  });

  it("puts in Serum's saved effects, or a whole saved rack", () => {
    const chains = new Map<string, SerumChain>([
      ["/Effect Chains/Hall.SerumFX", { kind: "effect" as const, entries: [{ FXReverb: { plainParams: { kParamSize: 60 } }, type: 6 }] }],
      ["/Effect Chains/Grit.SerumFXRack", { kind: "rack" as const, entries: [{ FXDistortion: { plainParams: "default" }, type: 0 }, { FXFilter: { plainParams: "default" }, type: 8 }] }],
    ]);
    const one = editSerumBody(racks(), [{ kind: "effectChain", rack: "main", path: "/Effect Chains/Hall.SerumFX", at: 2 }], chains);
    expect(kinds(one)[0]).toEqual(["distortion", "reverb", "reverb"]);
    expect(readEffects(one)[0].effects[1].controls.find((c) => c.key === "kParamSize")!.value).toBeCloseTo(0.6);
    const rack = editSerumBody(racks(), [{ kind: "effectChain", rack: "bus1", path: "/Effect Chains/Grit.SerumFXRack" }], chains);
    expect(kinds(rack)[1]).toEqual(["distortion", "filter"]);
  });

  it("says what's wrong with an effect edit, and what would do", () => {
    const problems = (edits: unknown[]) => {
      try {
        editSerumBody(racks(), edits);
      } catch (err) {
        return (err as SpecError).problems;
      }
      return [];
    };
    expect(problems([{ kind: "effect", rack: "main", position: 3 }])[0]).toBe("edit.position 3 isn't an effect's place: Main has 1 distortion, 2 reverb.");
    expect(problems([{ kind: "effect", rack: "main", position: 1, settings: { drive: 200 } }])[0]).toBe('edit.settings.drive is 200; it must be 0 to 100 (%).');
    expect(problems([{ kind: "effect", rack: "main", position: 1, settings: { size: 2 } }])[0]).toMatch(/^edit\.settings\.size isn't a distortion parameter; they are: wet, drive, lphp, mode/);
    expect(problems([{ kind: "addEffect", rack: "side", effect: "eq" }])[0]).toBe('edit.rack must be "main", "bus1", "bus2" (Main, Bus 1, Bus 2).');
    expect(problems([{ kind: "addEffect", rack: "main", effect: "wah" }])[0]).toMatch(/^edit\.effect is "wah"; it must be one of: distortion/);
    expect(problems([{ kind: "effectChain", rack: "main", path: "/x.SerumFX" }])[0]).toMatch(/isn't one of Serum's saved effects/);
  });
});
