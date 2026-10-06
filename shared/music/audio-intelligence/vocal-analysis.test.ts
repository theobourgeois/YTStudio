import { describe, expect, it } from "vitest";
import { analyseVocal, checkVocalChange, proposeVocalChanges, vocalFindings } from "./vocal-analysis.ts";

const RATE = 48000, SECONDS = 12;
/** Repeatable pink noise (Paul Kellet's filter), high-passed at about 150 Hz as a voice is. */
function voiceLike(seed: number, amp: number) {
  let s = seed, b0 = 0, b1 = 0, b2 = 0, hp = 0, last = 0;
  const out = new Float32Array(RATE * SECONDS), a = Math.exp(-2 * Math.PI * 150 / RATE);
  for (let i = 0; i < out.length; i++) {
    s = (s * 1664525 + 1013904223) >>> 0;
    const white = s / 2 ** 32 * 2 - 1;
    b0 = 0.99765 * b0 + white * 0.099046; b1 = 0.963 * b1 + white * 0.2965164; b2 = 0.57 * b2 + white * 1.0526913;
    const pink = (b0 + b1 + b2 + white * 0.1848) * 0.2;
    hp = a * (hp + pink - last); last = pink;
    out[i] = amp * hp;
  }
  return out;
}
/** Sung phrases: on for 1.5 s, off for 0.5 s, each phrase at `levels[n % levels.length]`. */
const phrases = (x: Float32Array, levels: number[]) => Float32Array.from(x, (v, i) => { const t = i / RATE, n = Math.floor(t / 2); return t % 2 < 1.5 ? v * levels[n % levels.length] : 0; });
const add = (...xs: Float32Array[]) => Float32Array.from(xs[0], (_, i) => xs.reduce((s, x) => s + x[i], 0));
const stereo = (x: Float32Array) => [x, x];
const sine = (hz: number, amp: number) => Float32Array.from({ length: RATE * SECONDS }, (_, i) => amp * Math.sin(2 * Math.PI * hz * i / RATE));

function passage(vocal: Float32Array, beat: Float32Array) { return analyseVocal(stereo(vocal), stereo(beat), stereo(add(vocal, beat)), RATE); }

describe("a vocal against its beat", () => {
  it("measures where the vocal sits (LU against the beat) and proposes the fader move to the aimed level", () => {
    const vocal = phrases(voiceLike(1, 0.1), [1]), beat = voiceLike(2, 0.2);
    const a = passage(vocal, beat);
    expect(a.relation.medianLu!).toBeCloseTo(-6, 0);
    expect(a.vocal.activeFraction).toBeGreaterThan(0.6);
    const { findings, proposals } = proposeVocalChanges([a, a], 0, "balanced");
    expect(findings[0].map(f => f.kind)).toContain("level");
    expect(proposals.map(p => p.id)).toContain("level");
    expect(proposals.find(p => p.id === "level")!.change.faderDb).toBeCloseTo(3, 0);
    // Aimed lower, it's already there: no level move.
    expect(proposeVocalChanges([a, a], 0, "blended").proposals.some(p => p.id === "level")).toBe(false);
  });
  it("finds uneven phrases and sets the compressor's threshold from the vocal's loud level, before its fader", () => {
    const vocal = phrases(voiceLike(3, 0.2), [1, 0.15]), beat = voiceLike(4, 0.1);
    const a = passage(vocal, beat);
    expect(a.vocal.phraseSpreadLu!).toBeGreaterThan(12);
    const { proposals } = proposeVocalChanges([a, a], 2, "balanced");
    const shape = proposals.find(p => p.id === "shape")!;
    expect(shape.change.compressor!.ratio).toBe(3);
    expect(shape.change.compressor!.threshold).toBeCloseTo(Math.round((a.loudRmsDbfs! - 2 - 4) * 2) / 2, 5);
    expect(shape.reasons.join(" ")).toMatch(/Uneven phrases/);
  });
  it("finds rumble, mud, harshness and sibilance and proposes cuts where they are", () => {
    const base = phrases(voiceLike(5, 0.1), [1]);
    const on = (x: Float32Array) => Float32Array.from(x, (v, i) => base[i] !== 0 ? v : 0);
    const vocal = add(base, on(sine(45, 0.05)), on(sine(320, 0.12)), on(sine(7000, 0.08)));
    const a = passage(vocal, voiceLike(6, 0.05));
    const kinds = vocalFindings(a).map(f => f.kind);
    expect(kinds).toEqual(expect.arrayContaining(["rumble", "mud", "sibilance"]));
    expect(a.shape.mudHz).toBeGreaterThan(280);
    expect(a.shape.mudHz).toBeLessThan(360);
    const eq = proposeVocalChanges([a, a], 0).proposals.find(p => p.id === "shape")!.change.eq!;
    expect(eq.find(b => b.shape === "lowCut")!.frequency).toBe(80);
    expect(eq.find(b => b.shape === "bell" && b.gain < 0)!.frequency).toBeGreaterThan(280);
    expect(eq.find(b => b.range === -6)!.frequency).toBeGreaterThan(6000);
  });
  it("proposes nothing when only one passage shows a finding, or none does", () => {
    const even = phrases(voiceLike(7, 0.1), [1]), uneven = phrases(voiceLike(8, 0.2), [1, 0.15]);
    const beat = voiceLike(9, 0.14);
    const steady = passage(even, beat), odd = passage(uneven, beat);
    expect(proposeVocalChanges([steady, odd], 0).proposals.some(p => p.change.compressor)).toBe(false);
    const quiet = proposeVocalChanges([steady, steady], 0, "balanced");
    expect(quiet.findings[0].filter(f => f.kind === "dynamics")).toEqual([]);
  });
  it("is silent-safe: no vocal gives no relation and no findings", () => {
    const a = passage(new Float32Array(RATE * SECONDS), voiceLike(10, 0.1));
    expect(a.vocal.integratedLufs).toBeNull();
    expect(a.relation.medianLu).toBeNull();
    expect(vocalFindings(a)).toEqual([]);
    expect(JSON.stringify(a)).not.toContain("NaN");
  });
});

describe("a vocal change in its own units", () => {
  it("accepts bounded changes and refuses what's out of range, with the range in the message", () => {
    expect(checkVocalChange({ faderDb: 2, eq: [{ shape: "bell", frequency: 3000, gain: 2, q: 0.8 }] })).toEqual({ faderDb: 2, eq: [{ shape: "bell", frequency: 3000, gain: 2, q: 0.8 }] });
    expect(checkVocalChange({ compressor: { threshold: -20, ratio: 3, attack: 0.01, release: 0.15 } }).compressor).toMatchObject({ knee: 6, range: 12 });
    expect(() => checkVocalChange({ faderDb: 9 })).toThrow(/-6 to 6/);
    expect(() => checkVocalChange({ eq: [{ shape: "notch", frequency: 100 }] })).toThrow(/shape/);
    expect(() => checkVocalChange({ eq: [{ shape: "lowCut", frequency: 500 }] })).toThrow(/300 Hz/);
    expect(() => checkVocalChange({ eq: [{ shape: "highShelf", frequency: 8000, gain: 2, range: -4 }] })).toThrow(/only a bell/);
    expect(() => checkVocalChange({})).toThrow(/changes nothing/);
  });
});
