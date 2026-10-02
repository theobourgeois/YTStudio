import { describe, expect, it } from "vitest";
import { controlOf, createAutomation, editPoints } from "./automation.ts";
import { compileSong } from "./compile.ts";
import { setEffect } from "./mixer.ts";
import { addClips, editClips } from "./playlist.ts";
import { DEFAULT_PRO_Q, MASTER_TRACK_ID, createMusicProject, normalizeMusicProject, normalizeProQ } from "./project.ts";
import {
  addBand,
  applyPreset,
  copyAB,
  dragBands,
  editProQ,
  findProQ,
  fitBand,
  freeBandId,
  frequencyText,
  invertGain,
  makeDynamic,
  nextShape,
  nextSlope,
  noteText,
  parseTyped,
  removeBands,
  setShape,
  splitBands,
  switchAB,
  updateBands,
  updateProQ,
} from "./pro-q.ts";
import { DEFAULT_BAND, EQ_BANDS, PRO_Q_PLUGIN, PRO_Q_PRESETS } from "./pro-q-presets.ts";
import type { AutomationTarget, EqBand, ProQ } from "./types.ts";

const EQ = "fx_eq";
const song = () => setEffect(createMusicProject("EQ", 120), MASTER_TRACK_ID, 0, PRO_Q_PLUGIN, EQ);
const band = (id: number, patch: Partial<EqBand> = {}): EqBand => ({ ...DEFAULT_BAND, ...patch, id });
const withBands = (...bands: EqBand[]): ProQ => ({ ...DEFAULT_PRO_Q, bands });

describe("Pro-Q in the song", () => {
  it("is made with its defaults in an effect slot, and survives a save and load", () => {
    const s = song();
    const found = findProQ(s, EQ)!;
    expect(found.proQ).toEqual(DEFAULT_PRO_Q);
    expect(found.effect.plugin).toEqual(PRO_Q_PLUGIN);
    const edited = editProQ(s, EQ, (pq) => addBand(pq, { frequency: 200, gain: 4 })!.proQ);
    const loaded = normalizeMusicProject(JSON.parse(JSON.stringify(edited)));
    expect(findProQ(loaded, EQ)!.proQ.bands).toEqual([band(1, { frequency: 200, gain: 4 })]);
  });

  it("normalises anything: values clamped, slopes fitting their shape, numbers unique", () => {
    const pq = normalizeProQ({
      bands: [
        { id: 1, shape: "bell", frequency: 5, gain: 50, q: 100, slope: "brickwall" },
        { id: 1, shape: "notch" },
        { id: 30 },
        { id: 2, shape: "lowCut", slope: "brickwall", placement: "side", threshold: -100 },
        "nonsense",
      ],
      mode: "linearPhase",
      resolution: "nope",
      output: 99,
      analyzer: { range: 120, tilt: 7 },
    });
    expect(pq.bands.map((b) => b.id)).toEqual([1, 2]);
    expect(pq.bands[0]).toMatchObject({ frequency: 10, gain: 30, q: 40, slope: 12 });
    expect(pq.bands[1]).toMatchObject({ shape: "lowCut", slope: "brickwall", placement: "side", threshold: -60 });
    expect(pq.mode).toBe("linearPhase");
    expect(pq.resolution).toBe("medium");
    expect(pq.output).toBe(36);
    expect(pq.analyzer).toMatchObject({ range: 120, tilt: 4.5 });
    expect(normalizeProQ(undefined)).toBe(DEFAULT_PRO_Q);
  });

  it("leaves the song as it is when nothing changes", () => {
    const s = song();
    expect(updateProQ(s, EQ, { output: 0, mode: "zeroLatency" })).toBe(s);
    expect(updateProQ(s, EQ, { analyzer: { pre: true } })).toBe(s);
    expect(updateProQ(s, "fx_nothing", { output: 3 })).toBe(s);
    expect(findProQ(updateProQ(s, EQ, { output: 50 }), EQ)!.proQ.output).toBe(36);
  });
});

describe("bands", () => {
  it("are numbered with the lowest free number, up to 24", () => {
    let pq = withBands(band(1), band(3));
    expect(freeBandId(pq.bands)).toBe(2);
    pq = addBand(pq, { frequency: 400 })!.proQ;
    expect(pq.bands.map((b) => b.id)).toEqual([1, 3, 2]);
    const full = withBands(...Array.from({ length: EQ_BANDS }, (_, i) => band(i + 1)));
    expect(addBand(full, {})).toBeNull();
  });

  it("drag together: frequencies in parallel, gains scaled relative to the grabbed one", () => {
    const base = [band(1, { frequency: 100, gain: 6 }), band(2, { frequency: 1000, gain: -3 }), band(3, { frequency: 5000, gain: 2 })];
    const moved = dragBands(base, new Set([1, 2]), 1, 200, 12);
    expect(moved[0]).toMatchObject({ frequency: 200, gain: 12 });
    expect(moved[1]).toMatchObject({ frequency: 2000, gain: -6 });
    expect(moved[2]).toBe(base[2]);
    // From a flat band, the others move by as much.
    const flat = dragBands([band(1, { gain: 0 }), band(2, { gain: 3 })], new Set([1, 2]), 1, null, 2);
    expect(flat.map((b) => b.gain)).toEqual([2, 5]);
    // Held in range, and a cut takes no gain.
    const cut = dragBands([band(1, { shape: "lowCut", frequency: 20 })], new Set([1]), 1, 2, 10);
    expect(cut[0]).toMatchObject({ frequency: 10, gain: 0 });
  });

  it("fit their shape: Brickwall only on cuts, no dynamics where a shape can't have them", () => {
    expect(fitBand(band(1, { shape: "bell", slope: "brickwall" })).slope).toBe(96);
    expect(fitBand(band(1, { shape: "notch", range: -6 })).range).toBe(0);
    const b = band(1);
    expect(fitBand(b)).toBe(b);
    expect(setShape(withBands(band(1, { shape: "lowCut", slope: "brickwall" })), [1], "bell").bands[0].slope).toBe(96);
  });

  it("step their shape and slope round (Cmd+Alt-click, Alt+Shift-click)", () => {
    expect(nextShape("bell")).toBe("lowShelf");
    expect(nextShape("flatTilt")).toBe("bell");
    expect(nextSlope({ shape: "bell", slope: 96 })).toBe(12);
    expect(nextSlope({ shape: "lowCut", slope: 96 })).toBe("brickwall");
    expect(nextSlope({ shape: "lowCut", slope: "brickwall" })).toBe(6);
  });

  it("invert gain and range; become dynamic; are removed", () => {
    let pq = withBands(band(1, { gain: 4, range: -3 }), band(2, { shape: "notch" }));
    pq = invertGain(pq, [1, 2]);
    expect(pq.bands[0]).toMatchObject({ gain: -4, range: 3 });
    pq = makeDynamic(withBands(band(1), band(2, { shape: "notch" })), [1, 2]);
    expect(pq.bands.map((b) => b.range)).toEqual([-6, 0]);
    expect(removeBands(pq, [1]).bands.map((b) => b.id)).toEqual([2]);
    expect(removeBands(pq, [9])).toBe(pq);
    expect(updateBands(pq, [1], { gain: 0 })).toBe(pq);
  });

  it("split into left and right, or mid and side", () => {
    const split = splitBands(withBands(band(1, { gain: 3 }), band(2, { placement: "side" })), [1, 2])!;
    expect(split.proQ.bands.map((b) => [b.id, b.placement])).toEqual([
      [1, "left"],
      [2, "mid"],
      [3, "right"],
      [4, "side"],
    ]);
    expect(split.proQ.bands[2].gain).toBe(3);
  });
});

describe("A/B and presets", () => {
  it("switch between two states, a new one starting as a copy", () => {
    let pq = withBands(band(1, { gain: 3 }));
    pq = switchAB(pq);
    expect(pq.ab).toBe("b");
    expect(pq.bands[0].gain).toBe(3);
    pq = { ...pq, bands: [band(1, { gain: -9 })] };
    pq = switchAB(pq);
    expect(pq.ab).toBe("a");
    expect(pq.bands[0].gain).toBe(3);
    expect(pq.other!.bands[0].gain).toBe(-9);
    expect(copyAB(pq).other!.bands[0].gain).toBe(3);
  });

  it("are applied over the state, the analyzer kept", () => {
    const pq = { ...DEFAULT_PRO_Q, analyzer: { ...DEFAULT_PRO_Q.analyzer, range: 120 as const }, output: 6 };
    const flat7 = applyPreset(pq, PRO_Q_PRESETS.find((p) => p.name === "Flat 7 Bands")!);
    expect(flat7.bands).toHaveLength(7);
    expect(flat7.output).toBe(0);
    expect(flat7.analyzer.range).toBe(120);
    for (const preset of PRO_Q_PRESETS) for (const b of applyPreset(pq, preset).bands) expect(fitBand(b)).toBe(b);
  });
});

describe("saying and typing values", () => {
  it("reads as Pro-Q writes them", () => {
    expect(frequencyText(542.531)).toBe("542.5 Hz");
    expect(frequencyText(1200)).toBe("1.20 kHz");
    expect(noteText(440)).toBe("A4");
    expect(noteText(200.04)).toBe("G3 +35");
  });

  it("takes Pro-Q's shortcuts: 1k, notes with cents, 2x", () => {
    expect(parseTyped("1k", "frequency")).toBe(1000);
    expect(parseTyped("2.5k", "frequency")).toBe(2500);
    expect(parseTyped("A4", "frequency")).toBeCloseTo(440);
    expect(parseTyped("C#3+13", "frequency")).toBeCloseTo(440 * 2 ** ((49.13 - 69) / 12));
    expect(parseTyped("2x", "gain")).toBeCloseTo(6.0206);
    expect(parseTyped("-3.5", "gain")).toBe(-3.5);
    expect(parseTyped("abc", "q")).toBeNull();
  });
});

describe("Pro-Q's automation", () => {
  /** A song in song mode (a pattern clip over two bars), a Pro-Q with a bell at +6 dB, and `target` automated from 0 to 1 over a bar. */
  function automated(target: AutomationTarget) {
    let s = editProQ(song(), EQ, () => withBands(band(1, { frequency: 1000, gain: 6 })));
    s = editClips(s, (clips) => addClips(clips, [{ kind: "pattern", ref: s.patterns[0].id, track: 0, start: 0, length: 768 }]).clips);
    const made = createAutomation(s, target, { start: 0, length: 384 }, { id: "auto_eq" });
    s = editPoints(made.song, "auto_eq", () => [
      { tick: 0, value: 0, tension: 0, curve: "single" },
      { tick: 384, value: 1, tension: 0, curve: "single" },
    ]);
    return compileSong(s, s.patterns[0].id, null, "song").lanes;
  }

  it("folds Gain Scale into its bands' gain and range lanes (the engine has none of its own)", () => {
    const lanes = automated({ kind: "proQ", effect: EQ, band: 0, control: "gainScale" });
    const gain = lanes.find((l) => l.target.kind === "eq" && l.target.control === "gain")!;
    expect(gain.target).toMatchObject({ band: 1 });
    // 6 dB scaled from 0% to 200%.
    expect(gain.values[0]).toBe(0);
    expect(gain.values[gain.values.length - 1]).toBeCloseTo(12, 6);
    expect(lanes.some((l) => l.target.kind === "eq" && l.target.control === "range")).toBe(true);
    expect(lanes.some((l) => l.target.kind === "eq" && l.target.control === "frequency")).toBe(false);
  });

  it("automates its pan, -1 to 1, and names its own controls", () => {
    const pan = automated({ kind: "proQ", effect: EQ, band: 0, control: "pan" }).find((l) => l.target.kind === "eq" && l.target.control === "pan")!;
    expect(pan.values[0]).toBe(-1);
    expect(pan.values[pan.values.length - 1]).toBe(1);
    const s = song();
    expect(controlOf(s, { kind: "proQ", effect: EQ, band: 0, control: "pan" })).toMatchObject({ name: "Pan", own: 0.5 });
    expect(controlOf(s, { kind: "proQ", effect: EQ, band: 0, control: "gainScale" })).toMatchObject({ name: "Gain Scale", own: 0.5 });
    expect(controlOf(s, { kind: "proQ", effect: EQ, band: 0, control: "gainScale" }).format(1)).toBe("200%");
  });
});
