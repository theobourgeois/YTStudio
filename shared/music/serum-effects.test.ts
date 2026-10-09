import { describe, expect, it } from "vitest";
import { describeEffect, fxInput, fxParamText, fxPosition, fxStored, fxText, planFxSlots, SERUM_EFFECTS, SERUM_FX_SLOTS, type SerumEffectKind, stepPosition } from "./serum-effects.ts";

const param = (kind: SerumEffectKind, key: string) => SERUM_EFFECTS[kind].params.find((p) => p.key === `kParam${key}`)!;

describe("Serum's effect knobs, as measured", () => {
  it("stores what Serum stores at a knob's position", () => {
    expect(fxStored(param("distortion", "Drive").scale, 0.4)).toBeCloseTo(40);
    expect(fxStored(param("phaser", "Freq").scale, 0.5)).toBeCloseTo(600);
    expect(fxStored(param("eq", "Freq1").scale, 0.5)).toBeCloseTo(656.25, 1);
    expect(fxStored(param("delay", "TimeL").scale, 0.5)).toBeCloseTo(0.03225);
    expect(fxStored(param("compressor", "Attack").scale, 0.5)).toBeCloseTo(250.075);
    expect(fxStored(param("compressor", "Makeup").scale, 0.5)).toBeCloseTo(8.5);
    expect(fxStored(param("compressor", "Ratio").scale, 0.75)).toBeCloseTo(4);
    expect(fxStored(param("convolve", "Decay").scale, 0.5)).toBeCloseTo(1.25);
    expect(fxStored(param("utility", "Width").scale, 0.5)).toBeCloseTo(100);
    expect(fxStored(param("distortion", "BW").scale, 0.25)).toBeCloseTo(0.54375);
  });

  it("picks a choice or a count by its band, and sits on it where Serum reports it", () => {
    const mode = param("distortion", "Mode").scale;
    expect([0.05, 0.1, 0.2, 0.5, 0.95, 1].map((v) => fxStored(mode, v))).toEqual(["kTube", "kSoftClip", "kDiode1", "kAsym", "kSoftSat", "kSoftSat"]);
    expect(fxPosition(mode, "kSoftClip", 0)).toBeCloseTo(stepPosition(18, 1));
    expect(fxStored(mode, stepPosition(18, 7))).toBe("kZeroSquare");
    const poles = param("phaser", "NumPoles").scale;
    expect([0.1, 0.25, 0.4, 0.5, 1].map((v) => fxStored(poles, v))).toEqual([2, 5, 8, 10, 18]);
    expect(fxPosition(poles, 4, 0)).toBeCloseTo(0.1765, 3);
    expect([0.3, 0.4, 0.7].map((v) => fxStored(param("distortion", "PrePost").scale, v))).toEqual([0, 1, 2]);
  });

  it("reads a knob's position back from what's stored, its default where nothing is", () => {
    for (const spec of Object.values(SERUM_EFFECTS))
      for (const p of spec.params) for (const v of [0, 0.3, 0.75, 1]) {
        const back = fxPosition(p.scale, fxStored(p.scale, v), p.default);
        // A choice or count comes back to its step; anything else to itself.
        const step = p.scale.kind === "options" || p.scale.kind === "count" || p.scale.kind === "switch";
        if (!step) expect(back, `${spec.kind} ${p.key} at ${v}`).toBeCloseTo(v, 6);
        else expect(fxStored(p.scale, back), `${spec.kind} ${p.key} at ${v}`).toEqual(fxStored(p.scale, v));
      }
    expect(fxPosition(param("reverb", "Size").scale, undefined, 0.35)).toBe(0.35);
  });

  it("shows a knob as Serum does", () => {
    expect(fxText(param("distortion", "Drive").scale, 0.25)).toBe("25%");
    expect(fxText(param("distortion", "LevelOut").scale, 0.25)).toBe("-12.0 dB");
    expect(fxText(param("distortion", "LevelOut").scale, 0)).toBe("-∞ dB");
    expect(fxText(param("filter", "Freq").scale, 0.5)).toBe("425 Hz");
    expect(fxText(param("filter", "Freq").scale, 0.75)).toBe("3.06 kHz");
    expect(fxText(param("compressor", "Thresh").scale, 0.5)).toBe("-18.1 dB");
    expect(fxText(param("compressor", "Thresh").scale, 0.9)).toBe("-60.0 dB");
    expect(fxText(param("compressor", "Ratio").scale, 0.25)).toBe("1.3:1");
    expect(fxText(param("compressor", "Ratio").scale, 1)).toBe("Limit");
    expect(fxText(param("compressor", "Makeup").scale, 0.5)).toBe("18.6 dB");
    expect(fxText(param("flanger", "Rate").scale, 0.5)).toBe("1.25 Hz");
    expect(fxText(param("flanger", "Width").scale, 0.25)).toBe("90°");
    expect(fxText(param("reverb", "Type").scale, 0.75)).toBe("Nitrous");
    expect(fxText(param("delay", "OffsetL").scale, 0.25)).toBe("Dot 1/2");
    expect(fxText(param("delay", "TimeL").scale, 0.5)).toBe("32 ms");
    expect(fxText(param("hyper", "Unison").scale, 4 / 7)).toBe("4");
  });

  it("takes a value as Serum stores it, or an option by its name, and refuses one out of range", () => {
    expect(fxInput(param("reverb", "Type").scale, "Hall")).toBe("kHall");
    expect(fxInput(param("reverb", "Type").scale, "kSpace")).toBe("kSpace");
    expect(fxInput(param("delay", "Mode").scale, "ping-pong")).toBe(1);
    expect(fxInput(param("distortion", "Drive").scale, 60)).toBe(60);
    expect(fxInput(param("distortion", "Drive").scale, 160)).toBeNull();
    expect(fxInput(param("distortion", "KeyTrack").scale, true)).toBe(1);
    expect(fxInput(param("phaser", "NumPoles").scale, 2.5)).toBeNull();
  });
});

describe("which knobs get a rack's slots", () => {
  it("gives every effect's switch a slot first, then each card's knobs round by round, its mode after its first", () => {
    expect(planFxSlots(["distortion", "reverb"])).toEqual([
      { position: 0, key: "kParamEnable" },
      { position: 1, key: "kParamEnable" },
      { position: 0, key: "kParamDrive" },
      { position: 1, key: "kParamSize" },
      { position: 0, key: "kParamMode" },
      { position: 1, key: "kParamType" },
      { position: 0, key: "kParamWet" },
      { position: 1, key: "kParamFeedback" },
      { position: 1, key: "kParamWet" },
    ]);
  });

  it("stops at 16, and skips what it doesn't know", () => {
    const plan = planFxSlots(["compressor", null, "eq", "flanger", "phaser", "chorus"]);
    expect(plan).toHaveLength(SERUM_FX_SLOTS);
    expect(plan.some((s) => s.position === 1)).toBe(false);
    expect(plan.filter((s) => s.key === "kParamEnable")).toHaveLength(5);
    expect(planFxSlots([])).toEqual([]);
  });

  it("lists each effect's parameters once, in Serum's order, its switch first; its card's knobs and mode among them", () => {
    for (const spec of Object.values(SERUM_EFFECTS)) {
      expect(spec.params[0].key).toBe("kParamEnable");
      expect(new Set(spec.params.map((p) => p.key)).size).toBe(spec.params.length);
      for (const key of [...spec.main, ...(spec.mode ? [spec.mode] : [])]) expect(spec.params.some((p) => p.key === key), `${spec.kind} ${key}`).toBe(true);
    }
  });
});

describe("an effect for the model", () => {
  it("says its settings by their spec names, in Serum's units, with Serum's text", () => {
    const spec = SERUM_EFFECTS.distortion;
    const line = describeEffect({
      position: 1,
      effect: "distortion",
      enabled: { key: "kParamEnable", param: null, value: 0 },
      controls: spec.params.slice(1).map((p) => ({ key: p.key, param: null, value: p.key === "kParamDrive" ? 0.6 : p.default })),
    });
    expect(line).toMatch(/^distortion \(off\): wet 100 \(100%\), drive 60 \(60%\)/);
    expect(line).toContain('mode "kTube" (Tube)');
  });
});

describe("synced times and rates", () => {
  const effect = (sync: string, on: boolean) => ({ controls: [{ key: `kParam${sync}`, param: null, value: on ? 1 : 0 }] });
  it("shows a division of the beat while its effect is synced, as Serum does", () => {
    const time = param("delay", "TimeL");
    expect(fxParamText(time, 0.625, effect("BeatSync", true))).toBe("1/4");
    expect(fxParamText(time, 0, effect("BeatSync", true))).toBe("fast");
    expect(fxParamText(time, 0.5, effect("BeatSync", false))).toBe("32 ms");
    const rate = param("flanger", "Rate");
    expect([0, 0.017, 0.484, 0.517, 0.684, 1].map((v) => fxParamText(rate, v, effect("BeatSync", true)))).toEqual(["Off", "24 bar", "bar", "1/2.", "1/4", "1/32"]);
    expect(fxParamText(param("reverb", "PreDelay"), 0.697, effect("PreDelayBeatSync", true))).toBe("1/4");
  });
});
