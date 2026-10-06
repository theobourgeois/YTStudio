import { describe, expect, it } from "vitest";
import { FIXTURES, renderFixture } from "../../../shared/music/audio-intelligence/fixtures.ts";
import { createArtifact } from "../../../shared/music/audio-intelligence/artifact.ts";
import { validateEvidence } from "../../../shared/music/audio-intelligence/evidence.ts";
import { PRIVATE_USE } from "../../../shared/music/audio-intelligence/types.ts";
import { measureAudio } from "./measure.ts";

const rate = 48000;
function artifact(frames: number, channels = 2) {
  return createArtifact({ contentSha256: "a".repeat(64), bytes: frames*channels*4, role: "fixture", format: { sampleRate: rate, channels, sampleFormat: "float32", frames }, snapshotId: null, tap: { kind: "media", id: "fixture" }, passage: null, render: null, derivedFrom: null, transforms: [], jobId: null, recordingFamilyId: "fixture-family", permissions: { ...PRIVATE_USE }, createdAt: 0 });
}
describe("local audio evidence", () => {
  it("measures known sine levels, crest and opposite stereo polarity", async () => {
    const left = Float32Array.from({ length: rate }, (_, i) => 0.5 * Math.sin(2*Math.PI*1000*i/rate));
    const a = artifact(rate);
    const report = await measureAudio(a, { sampleRate: rate, channels: [left, left.map(x => -x)] });
    const get = (name: string) => report.measurements.find(m => m.name === name)!.value!;
    expect(get("peakDbfs")).toBeCloseTo(-6.0206, 3);
    expect(get("rmsDbfs")).toBeCloseTo(-9.0309, 3);
    expect(get("crestDb")).toBeCloseTo(3.0103, 3);
    expect(get("stereoCorrelation")).toBeCloseTo(-1, 6);
    expect(report.observations).toEqual([]);
    expect(validateEvidence(report, { artifacts: new Map([[a.id, a]]) }).ok).toBe(true);
  });
  it("measures loudness (LUFS, range, true peak), the balance by band and when the level moves", async () => {
    const quiet = 10 ** (-23 / 20), loud = 10 ** (-14 / 20);
    const tone = Float32Array.from({ length: rate * 12 }, (_, i) => (i < rate * 6 ? quiet : loud) * Math.sin(2*Math.PI*1000*i/rate));
    const a = artifact(tone.length);
    const report = await measureAudio(a, { sampleRate: rate, channels: [tone, tone] });
    const get = (name: string) => report.measurements.filter(m => m.name === name);
    expect(get("integratedLufs")[0].value!).toBeGreaterThan(-23);
    expect(get("integratedLufs")[0].value!).toBeLessThan(-14);
    expect(get("truePeakDbtp")[0].value!).toBeCloseTo(-14, 0);
    expect(get("loudnessRangeLu")[0].value!).toBeGreaterThan(6);
    expect(get("shortTermLufs").length).toBeGreaterThan(5);
    const change = get("loudnessChangeDb");
    expect(change).toHaveLength(1);
    expect(change[0].value!).toBeCloseTo(9, 0);
    expect(change[0].span.startSeconds).toBeCloseTo(5.75, 1);
    expect(get("bandBalanceDb.mid")[0].value!).toBeGreaterThan(get("bandBalanceDb.air")[0].value!);
    expect(report.coverage.unavailable).not.toContain("true peak");
    expect(validateEvidence(report, { artifacts: new Map([[a.id, a]]) }).ok).toBe(true);
  });
  it("handles silence with explicit unavailable logarithmic values", async () => {
    const report = await measureAudio(artifact(rate, 1), { sampleRate: rate, channels: [new Float32Array(rate)] });
    expect(report.measurements.find(m => m.name === "peakDbfs")!.value).toBeNull();
    expect(report.measurements.find(m => m.name === "firstActivitySeconds")!.value).toBeNull();
    expect(JSON.stringify(report)).not.toContain("NaN");
  });
  it("excludes lead-in and tails and respects local-analysis permission", async () => {
    const a = artifact(4800, 1);
    a.passage = { startTick: 0, endTick: 96, startSeconds: 0, leadInFrames: 1200, tailFrames: 1200 };
    const samples = new Float32Array(4800).fill(0.9); samples.fill(0.25, 1200, 3600);
    const report = await measureAudio(a, { sampleRate: rate, channels: [samples] });
    expect(report.measurements.find(m => m.name === "peakDbfs")!.value).toBeCloseTo(20*Math.log10(0.25));
    expect(report.coverage.inspected[0]).toMatchObject({ startSeconds: 0.025, endSeconds: 0.075 });
    a.permissions.localAnalysis = false;
    await expect(measureAudio(a, { sampleRate: rate, channels: [samples] })).rejects.toThrow(/permissions/);
  });
  it("matches the cleared fixture collection's known levels and correlations", async () => {
    for (const spec of FIXTURES) {
      const audio = renderFixture(spec, FIXTURES);
      const a = artifact(audio.channels[0].length, audio.channels.length);
      const report = await measureAudio(a, audio);
      const value = (name: string) => report.measurements.find(m => m.name === name)!.value!;
      const expected = spec.expected;
      if (expected.peakDbfs !== undefined) expect(Math.abs(value("peakDbfs") - expected.peakDbfs), spec.id).toBeLessThanOrEqual(expected.toleranceDb);
      if (expected.rmsDbfs !== undefined) expect(Math.abs(value("rmsDbfs") - expected.rmsDbfs), spec.id).toBeLessThanOrEqual(expected.toleranceDb);
      if (expected.correlation !== undefined) expect(value("stereoCorrelation"), spec.id).toBeCloseTo(expected.correlation, 1);
      expect(validateEvidence(report, { artifacts: new Map([[a.id, a]]) }).ok, spec.id).toBe(true);
    }
  });
  it("rejects non-finite audio and cancellation", async () => {
    await expect(measureAudio(artifact(1, 1), { sampleRate: rate, channels: [new Float32Array([NaN])] })).rejects.toThrow(/non-finite/);
    await expect(measureAudio(artifact(rate, 1), { sampleRate: rate, channels: [new Float32Array(rate)] }, AbortSignal.abort())).rejects.toThrow();
  });
});
