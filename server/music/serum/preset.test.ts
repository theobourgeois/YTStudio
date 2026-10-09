import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { type CborMap, decodeCbor, encodeCbor } from "./cbor.ts";
import { fxParamName } from "./body.ts";
import { readXfer, writeXfer } from "./container.ts";
import { type DestinationContext, destinationName, parseDestination } from "./destinations.ts";
import { memoryBlockEncode, writePluginState } from "./plugin-state.ts";
import { bodyToSpec, readSerumFile, readSerumSettings, type SerumPresetSpec, SpecError, specToBody, writeSerumPreset } from "./preset.ts";
import { PRESET_TEMPLATE } from "./template.ts";

const LEAD: SerumPresetSpec = {
  name: "Soft Lead",
  author: "test",
  description: "A soft lead.",
  tags: ["Lead", "Mono"],
  global: { volume: 60, mono: true, legato: true, portamento: 60 },
  oscillators: {
    A: { wavetable: "Analog/Basic Shapes.wav", position: 86, level: 80, unison: { voices: 3, detune: 0.08, blend: 60 }, warp: { mode: "kBendPos", amount: 20 } },
    B: { enabled: true, level: 45, octave: 1, fine: 7 },
    sub: { enabled: true, level: 35, octave: -1, shape: "kTriangle" },
  },
  filters: { "1": { enabled: true, type: "MG Low 24", cutoff: 2400, resonance: 18 } },
  routing: { B: { to: "filter", bus1: 20 } },
  envelopes: { "1": { attack: 25, decay: 600, sustain: 85, release: 280 } },
  lfos: { "1": { sync: false, rate: 5.5 }, "2": { rate: "1/8.", shape: { points: [[0, 1], [0.5, 0, 0.3], [1, 1]] } } },
  modulation: [
    { source: "Env 2", to: "Filter 1 Freq", amount: 30 },
    { source: "LFO 1", aux: "Mod Wheel", to: "A Fine", amount: 15, bipolar: true },
    { source: "LFO 2", to: "A WT Pos", amount: 20 },
    { source: "Macro 1", to: "Main FX 3 Wet", amount: 50 },
  ],
  macros: { "1": { name: "SPACE", value: 0 } },
  fx: { main: [{ effect: "chorus", wet: 30 }, { effect: "delay", wet: 18, feedback: 35 }, { effect: "reverb", type: "kHall", wet: 22 }] },
};

const params = (module: unknown) => (module as { plainParams: CborMap }).plainParams;

describe("writing a spec", () => {
  const body = specToBody(LEAD);

  it("puts each field where Serum keeps it, in Serum's units", () => {
    expect(body.presetName).toBe("Soft Lead");
    expect(body.tags).toEqual(["Lead", "Mono"]);
    expect(body.version).toBe(11);
    const osc = body.Oscillator0 as CborMap;
    expect(params(osc).kParamVolume).toBeCloseTo(0.64, 15);
    expect(params(osc).kParamUnison).toBe(3);
    const wt = osc.WTOsc0 as CborMap;
    expect(wt.relativePathToWT).toBe("Analog/Basic Shapes.wav");
    expect(wt.numFrames).toBeUndefined();
    expect(params(wt)).toEqual({ kParamTablePos: 86, kParamWarp: 0.2, kParamWarpMenu: "kBendPos" });
    expect(params(body.Oscillator4).kParamOctave).toBe(-1);
    expect(params((body.Oscillator4 as CborMap).SubOsc4).kParamShape).toBe("kTriangle");
    expect(params(body.VoiceFilter0).kParamType).toBe("MgL24");
    expect(params(body.VoiceFilter0).kParamFreq).toBeCloseTo((69 + 12 * Math.log2(2400 / 440)) / 136.8, 12);
    expect(params(body.RoutingSlot1)).toEqual({ kParamRoutingDest: "kRoutingDestFilter", kParamFXBus1Level: 20 });
    expect(params(body.Env0)).toMatchObject({ kParamAttack: 0.025, kParamSustain: 0.85, kParamCurve1: 50 });
    expect(params(body.LFO0)).toEqual({ kParamBeatSync: 0, kParamRate: 5.5 });
    expect(params(body.LFO1)).toEqual({ kParamRate: 100 * ((7 + 1 / 3) / 14) ** 4, kParamDotted: 1 });
    expect((body.LFO1 as CborMap).curveData).toEqual({ curveVals: [0.5, 0.3, 0.5], numPoints: 2, xVals: [0, 0.5, 1], yVals: [1, 0, 1] });
    expect((body.Macro0 as CborMap).name).toBe("SPACE");
    expect((body.FXRack0 as CborMap).FX).toEqual([
      { FXChorus: { plainParams: { kParamWet: 30 } }, type: 3 },
      { FXDelay: { plainParams: { kParamWet: 18, kParamFeedback: 35 } }, type: 4 },
      { FXReverb: { plainParams: { kParamType: "kHall", kParamWet: 22 } }, type: 6 },
    ]);
    expect(body.ModSlot0).toEqual({
      source: [3, 0],
      destModuleTypeString: "VoiceFilter",
      destModuleID: 0,
      destModuleParamID: 3,
      destModuleParamName: "kParamFreq",
      plainParams: { kParamAmount: 30 },
    });
    expect(body.ModSlot1).toMatchObject({ source: [6, 1], destModuleTypeString: "Oscillator", destModuleParamID: 5, plainParams: { kParamBipolar: 1 } });
    expect(body.ModSlot2).toMatchObject({ destModuleTypeString: "WTOsc", destModuleID: 0, destModuleParamID: 6, destModuleParamName: "kParamTablePos" });
    expect(body.ModSlot3).toMatchObject({ source: [25, 0], destModuleTypeString: "FXReverb", destModuleID: 2, destModuleParamID: 1 });
    expect(body.ModSlot4).toEqual({ plainParams: "default" });
  });

  it("reads back to the same spec, with nothing left over", () => {
    const spec = bodyToSpec(body);
    expect(spec.raw).toBeUndefined();
    expect(spec.filters?.["1"]?.type).toBe("MgL24");
    expect(spec.lfos?.["2"]?.rate).toBe("1/8.");
    expect(spec.lfos?.["2"]?.dotted).toBe(true);
    const { filters, lfos, ...rest } = spec;
    const { filters: f0, lfos: l0, ...rest0 } = LEAD;
    expect(rest).toEqual({ ...rest0, serum: { version: 11, product: "2.1.5" } });
    expect(filters).toEqual({ "1": { ...f0!["1"], type: "MgL24" } });
    expect(lfos).toEqual({ "1": l0!["1"], "2": { ...l0!["2"], dotted: true } });
    expect(Buffer.from(encodeCbor(specToBody(spec))).equals(Buffer.from(encodeCbor(body)))).toBe(true);
  });

  it("keeps everything it doesn't name in raw, so any body comes back exactly", () => {
    const odd = decodeCbor(encodeCbor(body)) as CborMap;
    const osc = odd.Oscillator0 as CborMap;
    (osc.WTOsc0 as CborMap).embeddedWTData = Array.from({ length: 300 }, (_, i) => Math.fround(Math.sin(i / 10)));
    params(osc.WTOsc0).kParamPhaseMemory = "kPerVoice";
    params(osc).kParamVolume = 0.123456789;
    (odd.Oscillator3 as CborMap).NoiseOsc3 = { ...((odd.Oscillator3 as CborMap).NoiseOsc3 as CborMap), boundary64: 27_538_029_516_427_264n };
    odd.Mystery0 = { plainParams: { kParamWhatever: 2 }, list: [1, "two", null] };
    odd.ModSlot9 = { source: [6, 0], destModuleTypeString: "WTOsc", destModuleID: 0, destModuleParamID: 1, destModuleParamName: "kParamTablePos", plainParams: { kParamAmount: 10 } };
    (odd.LFO5 as CborMap).curveData = { numPoints: 1, xVals: [0, 2], yVals: [0, 1], curveVals: [0.5, 0.5] };
    (odd.FXRack1 as CborMap).FX = [{ FXReverb: { plainParams: "default", lfophasor: 0.25 }, kUIParamMixOrGain: 1, type: 6 }];
    delete (odd.Env3 as CborMap).plainParams;
    const spec = JSON.parse(JSON.stringify(bodyToSpec(odd))) as SerumPresetSpec;
    expect(spec.oscillators?.A?.typeParams).toEqual({ kParamPhaseMemory: "kPerVoice" });
    expect(spec.modulation?.find((m) => m.slot === 10)?.to).toEqual({ module: "WTOsc", id: 0, param: "kParamTablePos", paramId: 1 });
    expect(spec.fx?.bus1).toEqual([{ effect: "reverb", module: { lfophasor: 0.25 }, entry: { kUIParamMixOrGain: 1 } }]);
    expect(Object.keys(spec.raw ?? {})).toEqual(expect.arrayContaining(["Mystery0", "Oscillator0", "LFO5", "Env3"]));
    expect(Buffer.from(encodeCbor(specToBody(spec))).equals(Buffer.from(encodeCbor(odd)))).toBe(true);
  });

  it("reads Serum's init patch as an empty spec", () => {
    const spec = bodyToSpec(PRESET_TEMPLATE);
    expect(spec).toEqual({ name: "", tags: ["Wavetable", "Poly"], serum: { version: 11, product: "2.1.5" } });
  });
});

describe("a spec Serum can't take", () => {
  it("is refused with every problem, each saying what would do", () => {
    const bad = {
      name: "Bad",
      osc: {},
      oscillators: { A: { level: 120, wavetable: 3, unison: { voices: 3, spread: 1 } }, D: {} },
      filters: { "1": { type: "MG Low 25" }, "3": {} },
      lfos: { "1": { rate: "1/5" }, "2": { rate: "1/8.", dotted: false } },
      modulation: [{ source: "LFO 11", to: "A Wavetable Position" }, { slot: 70, source: "Velo", to: "A Level" }],
      fx: { main: [{ effect: "reverb", sizee: 3 }], bus3: [] },
    } as unknown as SerumPresetSpec;
    let problems: string[] = [];
    try {
      specToBody(bad);
    } catch (e) {
      expect(e).toBeInstanceOf(SpecError);
      problems = (e as SpecError).problems;
    }
    const all = problems.join("\n");
    expect(all).toMatch(/osc isn't a field of a preset spec/);
    expect(all).toMatch(/oscillators\.A\.level is 120; Serum's range is 0 to 100/);
    expect(all).toMatch(/oscillators\.A\.unison\.spread isn't a field/);
    expect(all).toMatch(/oscillators\.A\.wavetable must be a file's path/);
    expect(all).toMatch(/oscillators\.D: the oscillators are A, B, C, noise and sub/);
    expect(all).toMatch(/filters\.1\.type is "MG Low 25"; it must be one of: .*MgL24 \(MG Low 24\)/);
    expect(all).toMatch(/filters\.3: the keys are "1" to "2"/);
    expect(all).toMatch(/lfos\.1\.rate is "1\/5"; a synced rate is one of: .*1\/4/);
    expect(all).toMatch(/lfos\.2\.rate "1\/8\." needs dotted: true/);
    expect(all).toMatch(/modulation\[0\]\.source is "LFO 11"/);
    expect(all).toMatch(/modulation\[0\]\.to: "A Wavetable Position" isn't a destination/);
    expect(all).toMatch(/modulation\[1\]\.slot must be 1 to 64/);
    expect(all).toMatch(/fx\.main\[0\]\.sizee isn't a parameter of reverb; its parameters are: .*size/);
    expect(all).toMatch(/fx\.bus3: the racks are main, bus1, bus2/);
  });

  it("takes an option by Serum's name or by what Serum shows, the default options too", () => {
    const body = specToBody({
      name: "Options",
      filters: { "1": { type: "MG Low 12" }, "2": { type: "Acid Ladder" } },
      oscillators: { A: { warp: { mode: "kNoWarp" }, warp2: { mode: "FM (Sub)" } } },
      fx: { main: [{ effect: "filter", type: "MgL6" }] },
    });
    expect(params(body.VoiceFilter0).kParamType).toBe("MgL12");
    expect(params(body.VoiceFilter1).kParamType).toBe("LadderAcid");
    expect(params((body.Oscillator0 as CborMap).WTOsc0)).toEqual({ kParamWarpMenu: "kNoWarp", kParamWarpMenu2: "kFM_SUB" });
  });

  it("needs a name", () => {
    expect(() => specToBody({} as SerumPresetSpec)).toThrow(/name is required/);
  });
});

describe("mod destinations", () => {
  const ctx = (types: Partial<Record<number, "wavetable" | "sample">> = {}, effects: string[] = []): DestinationContext => ({
    oscillatorType: (i) => types[i] ?? "wavetable",
    effectAt: (rack, position) => (rack === 0 ? effects[position] : undefined),
  });

  it("are Serum's controls' names, resolved against the oscillators' types and the racks", () => {
    expect(parseDestination("A WT Pos", ctx())).toEqual({ module: "WTOsc", id: 0, paramId: 6, param: "kParamTablePos" });
    expect(parseDestination("B Warp", ctx({ 1: "sample" }))).toEqual({ module: "SampleOsc", id: 1, paramId: 0, param: "kParamWarp" });
    expect(parseDestination("Filter 2 Res", ctx())).toEqual({ module: "VoiceFilter", id: 1, paramId: 4, param: "kParamReso" });
    expect(parseDestination("Main Vol", ctx())).toEqual({ module: "Global", id: 0, paramId: 0, param: "kParamMasterVolume" });
    expect(parseDestination("Macro 3", ctx())).toEqual({ module: "Macro", id: 2, paramId: 0, param: "kParamValue" });
    expect(parseDestination("Main FX 2 Size", ctx({}, ["FXDelay", "FXReverb"]))).toEqual({ module: "FXReverb", id: 1, paramId: 2, param: "kParamSize" });
    expect(parseDestination("LFO 4 Mode", ctx())).toEqual({ module: "LFO", id: 3, paramId: 5, param: "kParamMode" });
    expect(parseDestination("Main FX 3 Wet", ctx({}, ["FXDelay"]))).toMatch(/isn't a destination/);
  });

  it("are named back only when the name means exactly that", () => {
    const c = ctx({}, ["FXReverb"]);
    expect(destinationName({ module: "WTOsc", id: 2, paramId: 6, param: "kParamTablePos" }, c)).toBe("C WT Pos");
    expect(destinationName({ module: "FXReverb", id: 0, paramId: 1, param: "kParamWet" }, c)).toBe("Main FX 1 Wet");
    expect(destinationName({ module: "WTOsc", id: 0, paramId: 1, param: "kParamTablePos" }, c)).toBeUndefined();
    expect(destinationName({ module: "SampleOsc", id: 0, paramId: 0, param: "kParamWarp" }, c)).toBeUndefined();
  });

  it("names effects' parameters in camel case", () => {
    expect(["kParamWet", "kParamFreqB", "kParamLPHP", "kParamLFXover", "kParamDimEWet", "kParamBW", "kParamThreshUD0"].map(fxParamName)).toEqual([
      "wet",
      "freqB",
      "lphp",
      "lfXover",
      "dimEWet",
      "bw",
      "threshUD0",
    ]);
  });
});

describe("preset files", () => {
  it("are laid out as Serum's: the container, the header's keys, its hash", () => {
    const bytes = writeSerumPreset(LEAD);
    const container = readXfer(bytes);
    expect(Object.keys(container.meta).sort()).toEqual(
      ["fileType", "hash", "presetAuthor", "presetDescription", "presetName", "product", "productVersion", "tags", "url", "vendor", "version"].sort(),
    );
    expect(container.meta).toMatchObject({ fileType: "SerumPreset", product: "Serum2", vendor: "Xfer Records", presetName: "Soft Lead", version: 11 });
    expect(container.meta.hash).toBe(createHash("md5").update(container.compressed).digest("hex"));
    expect(readSerumFile(bytes)).toEqual(bodyToSpec(specToBody(LEAD)));
  });

  it("can be read from Serum 2's plugin state, as a preset", () => {
    const processorBody: CborMap = { ...(decodeCbor(encodeCbor(PRESET_TEMPLATE)) as CborMap), component: "processor", modMatrixLocked: false, scalarCurvesLocked: [false, false] };
    for (const key of ["fileType", "presetName", "presetAuthor", "presetDescription", "SerumGUI"]) delete processorBody[key];
    (processorBody.Global0 as CborMap).plainParams = { kParamMasterVolume: 0.25 };
    (processorBody.Env1 as CborMap).plainParams = {};
    const processor = writeXfer({ component: "processor", version: 11 }, encodeCbor(processorBody));
    const controller = writeXfer({ component: "controller", presetName: " Warm Pad ", presetAuthor: "me" }, encodeCbor({}));
    const xml = `<VST3PluginState><IComponent>${memoryBlockEncode(processor)}</IComponent><IEditController>${memoryBlockEncode(controller)}</IEditController></VST3PluginState>`;
    const state = writePluginState({ format: "vst3", xml, component: processor, controller }, processor);
    const { kind, body } = readSerumSettings(state);
    expect(kind).toBe("state");
    expect(body.component).toBeUndefined();
    expect((body.Env1 as CborMap).plainParams).toBe("default");
    expect(body.SerumGUI).toEqual(PRESET_TEMPLATE.SerumGUI);
    const spec = readSerumFile(state);
    expect(spec).toMatchObject({ name: "Warm Pad", author: "me", global: { volume: 50 } });
  });
});
