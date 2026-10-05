import { describe, expect, it } from "vitest";
import { hashJson } from "../hash.ts";
import { evaluateHearing, HEARING_ARMS, parseHearingEvaluation } from "./hearing-benchmark.ts";
import { HEARING_TASKS } from "./hearing.ts";
import { activeSpan, armTexts, assembleEvaluation, BENCHMARK_QUESTIONS, BENCHMARK_SOURCES, benchmarkCases, blindOrder, changeTime, deriveAudio, evaluationCase, knownFacts, steadiestSpan, windowRmsDb } from "./hearing-pack.ts";

const RATE = 8000;
const tone = (seconds: number, hz: number, amp = 0.25) => Float32Array.from({ length: seconds * RATE }, (_, i) => amp * Math.sin(2 * Math.PI * hz * i / RATE));
const rmsDb = (x: Float32Array, from: number, to: number) => { let s = 0; for (let i = from; i < to; i++) s += x[i] * x[i]; return 10 * Math.log10(s / (to - from)); };

describe("hearing benchmark cases", () => {
  const cases = benchmarkCases();
  it("can pass the gate's counts: per task, ten held-out real cases, five families, controls from two", () => {
    for (const task of HEARING_TASKS) {
      const held = cases.filter(c => c.task === task && c.split === "heldout");
      expect(held.length).toBeGreaterThanOrEqual(10);
      expect(new Set(held.map(c => c.family)).size).toBeGreaterThanOrEqual(5);
      expect(new Set(held.filter(c => c.control).map(c => c.family)).size).toBeGreaterThanOrEqual(2);
      expect(cases.some(c => c.task === task && c.split === "development")).toBe(true);
    }
  });
  it("keeps every family in one split, ids unique, and only Creative Commons songs", () => {
    expect(new Set(cases.map(c => c.id)).size).toBe(cases.length);
    const splits = new Map<string, string>();
    for (const s of BENCHMARK_SOURCES) { expect(splits.get(s.family) ?? s.split).toBe(s.split); splits.set(s.family, s.split); expect(s.licence).toMatch(/^CC BY/); }
    // The evaluation's own validation agrees (it refuses a family across splits).
    parseHearingEvaluation(assembleEvaluation({ provider: "p", model: "m", adapterVersion: "a", destination: "d", promptVersion: "v" }, cases.map(c => evaluationCase(c, hashJson(c.id))), [], []));
  });
  it("asks one question per task and puts changes between 7 and 13 seconds", () => {
    for (const c of cases) if ("at" in c.derivation) expect(c.derivation.at).toBeGreaterThanOrEqual(7), expect(c.derivation.at).toBeLessThanOrEqual(13);
    expect(new Set(Object.values(BENCHMARK_QUESTIONS)).size).toBe(3);
    expect(changeTime("a")).toBe(changeTime("a"));
  });
  it("tells reviewers what was done", () => {
    const c = cases.find(x => x.derivation.kind === "gain")!, source = BENCHMARK_SOURCES.find(s => s.id === c.sourceId)!;
    expect(knownFacts(c, source, { steadySpreadDb: 1.84 }).join(" ")).toMatch(/level .* by \d+ dB[\s\S]*within 1\.8 dB/);
  });
});

describe("hearing benchmark audio", () => {
  it("steps the gain by exactly the stated dB at the stated time", () => {
    const { channels, gainDb } = deriveAudio({ kind: "gain", db: -9, at: 10, over: 0.05 }, RATE, { mix: [tone(20, 440), tone(20, 440)] });
    expect(gainDb).toBe(0);
    expect(rmsDb(channels[0], 11 * RATE, 19 * RATE) - rmsDb(channels[0], 1 * RATE, 9 * RATE)).toBeCloseTo(-9, 1);
  });
  it("removes a stem from the stated time and leaves the others", () => {
    const stems = { vocal: [tone(20, 300)], bass: [tone(20, 80)] };
    const { channels } = deriveAudio({ kind: "stem-exit", group: "vocal", stems: ["vocal"], at: 8 }, RATE, { stems });
    const after = channels[0].slice(9 * RATE, 19 * RATE), bass = stems.bass[0].slice(9 * RATE, 19 * RATE);
    expect(Math.max(...after.map((x, i) => Math.abs(x - bass[i])))).toBeLessThan(1e-6);
    expect(rmsDb(channels[0], RATE, 7 * RATE)).toBeGreaterThan(rmsDb(channels[0], 9 * RATE, 19 * RATE) + 2);
  });
  it("changes the tone only after its time: a high shelf cut dulls the highs", () => {
    const high = tone(20, 3500), mixed = Float32Array.from(tone(20, 100), (x, i) => x + high[i]);
    const { channels } = deriveAudio({ kind: "tone", filter: "dull", at: 10 }, RATE, { mix: [mixed] });
    expect(Math.max(...channels[0].slice(RATE, 9 * RATE).map((x, i) => Math.abs(x - mixed[RATE + i])))).toBeLessThan(1e-6);
    expect(rmsDb(channels[0], 11 * RATE, 19 * RATE)).toBeLessThan(rmsDb(mixed, 11 * RATE, 19 * RATE) - 2);
  });
  it("scales a clip down as a whole when it would clip, never up", () => {
    expect(deriveAudio({ kind: "gain", db: 12, at: 10, over: 0.05 }, RATE, { mix: [tone(20, 440, 0.5)] }).gainDb).toBeLessThan(-6);
    expect(deriveAudio({ kind: "none" }, RATE, { mix: [tone(20, 440, 0.01)] }).gainDb).toBe(0);
  });
  it("finds the steadiest span and the span where every stem plays", () => {
    const levels = [-10, -30, -10, -12, -11, -10, -40, -10];
    expect(steadiestSpan(levels, 3)).toEqual({ start: 2, spreadDb: 2 });
    expect(activeSpan([[-60, -20, -20, -20], [-20, -60, -20, -20]], 2)).toBe(2);
    expect(windowRmsDb([tone(3, 440, 1)], RATE)[0]).toBeCloseTo(-3.01, 1);
  });
});

describe("hearing benchmark review", () => {
  it("shows each reviewer the arms in an order of their own, the same every time", () => {
    const orders = new Set(Array.from({ length: 30 }, (_, i) => blindOrder(`trial-${i}`, "Théo").join()));
    expect(orders.size).toBeGreaterThan(3);
    expect(blindOrder("t", "Théo")).toEqual(blindOrder("t", " théo "));
    for (const o of orders) expect(o.split(",").sort()).toEqual([...HEARING_ARMS].sort());
  });
  it("keeps the arms' texts apart: DSP alone, findings alone, both", () => {
    const texts = armTexts([{ name: "rmsDbfs", value: -18.24, unit: "dBFS", channel: "left", method: { name: "unweighted-rms" } }],
      { findings: [{ claim: "The bass drops out.", startSeconds: 9.4, endSeconds: 20 }], limitations: [] });
    expect(texts.dsp).toContain("RMS level (left): -18.2 dBFS");
    expect(texts.dsp).not.toContain("bass");
    expect(texts.audio).toContain("9.4–20.0 s: The bass drops out.");
    expect(texts.audio).not.toContain("RMS");
    expect(texts.combined).toBe(`${texts.dsp}\n\n${texts.audio}`);
    expect(armTexts([], { findings: [], limitations: [] }).audio).toContain("no findings");
  });
  it("adds up to an evaluation the gate reads", () => {
    const cases = benchmarkCases().filter(c => c.split === "heldout").map(c => evaluationCase(c, hashJson(c.id)));
    const e = assembleEvaluation({ provider: "p", model: "m", adapterVersion: "a", destination: "d", promptVersion: "v" }, cases, [], []);
    expect(evaluateHearing(e).every(v => !v.passed)).toBe(true);
  });
});
