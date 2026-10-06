import { describe, expect, it } from "vitest";
import { faderGain } from "../compile.ts";
import { createMusicProject, DEFAULT_FADER } from "../project.ts";
import { addAudioClips } from "../playlist.ts";
import { addMixerTracks, getMixerTrack, updateMixerTrack } from "../mixer.ts";
import { createRun } from "./run.ts";
import type { VocalAnalysis } from "./vocal-analysis.ts";
import { acceptVocalCandidate, applyVocalChange, auditionGains, candidateEffects, faderDbOf, faderMoved, levelMatch, validateVocalMixRun, vocalRevision, type VocalMixRun } from "./vocal-mix.ts";

const song = () => {
  const base = addAudioClips(addMixerTracks(createMusicProject(), null, 2, ["insert_vocal", "insert_beat"]),
    [{ channelId: "chan_vocal", name: "Vocal", sampleId: "media_vocal", seconds: 40 },
      { channelId: "chan_beat", name: "Instrumental", sampleId: "media_beat", seconds: 40 }], { start: 0, track: 0 }).song;
  return { ...base, channels: base.channels.map(c => ({ ...c, mixerTrack: c.id === "chan_vocal" ? "insert_vocal" : "insert_beat" })) };
};
const render = (i: number) => ({ jobId: `job_${i}`, analysisJobId: "analysis", artifactId: "audio", stemArtifactId: "stem", reportId: "report", auditionGainDb: -3, integratedLufs: -14, truePeakDbtp: -2, peakDbfs: -3, rmsDbfs: -18, fullScaleFraction: 0 });
const run = (base: ReturnType<typeof song>): VocalMixRun => ({ schema: 2, id: "mixrun_test", projectId: "proj_test", goal: "Vocal balance", vocalTrackId: "insert_vocal", level: "balanced",
  baseSnapshotId: "snapshot_test", baseRevision: vocalRevision(base), passages: [{ startTick: 0, endTick: 1920 }, { startTick: 3840, endTick: 5760 }], status: "ready", error: null, createdAt: 0,
  accompaniment: { snapshotId: "snapshot_acc", renders: [{ jobId: "a", artifactId: "acc" }, { jobId: "b", artifactId: "acc" }] }, requested: null, findings: [[], []], conclusion: null, chosen: null, levelMatched: false,
  mixRun: createRun({ id: "run_0123456789ab", projectId: "proj_test", goal: "Vocal balance", snapshotId: "snapshot_test", now: 0 }),
  candidates: [
    { id: "baseline", label: "Keep current mix", source: "baseline", reasons: [], change: null, snapshotId: "snapshot_test", renders: [render(0), render(1)], analyses: [null, null], effects: [] },
    { id: "both", label: "Level + tone & dynamics", source: "measured", reasons: ["Measured."], snapshotId: "snapshot_both", renders: [render(2), render(3)], analyses: [null, null], effects: [],
      change: { faderDb: 2, compressor: { threshold: -24, ratio: 3, attack: 0.01, release: 0.15, knee: 6, range: 12 }, eq: [{ shape: "lowCut", frequency: 80, gain: 0, q: 0.7, slope: 12 }, { shape: "bell", frequency: 7000, gain: 0, q: 2, range: -6 }] } },
  ] });

describe("the vocal's fader", () => {
  it("moves by the dB asked on the cubic fader (it was a squared law, so +2 dB moved it 3)", () => {
    expect(faderDbOf(DEFAULT_FADER)).toBeCloseTo(0, 9);
    expect(20 * Math.log10(faderGain(faderMoved(DEFAULT_FADER, 2)) / faderGain(DEFAULT_FADER))).toBeCloseTo(2, 9);
    expect(faderDbOf(faderMoved(0.5, -4)) - faderDbOf(0.5)).toBeCloseTo(-4, 9);
  });
});

describe("a vocal change on the song", () => {
  it("changes only the vocal's insert: its fader, a compressor and an EQ with a de-essing band", () => {
    const base = song(), next = applyVocalChange(base, "insert_vocal", run(base).candidates[1].change!, "fx_test");
    expect(next.channels).toBe(base.channels);
    expect(next.playlist).toBe(base.playlist);
    expect(getMixerTrack(next, "insert_beat")).toBe(getMixerTrack(base, "insert_beat"));
    const vocal = getMixerTrack(next, "insert_vocal")!;
    expect(faderDbOf(vocal.volume) - faderDbOf(getMixerTrack(base, "insert_vocal")!.volume)).toBeCloseTo(2, 6);
    const [comp, eq] = vocal.effects.filter(Boolean);
    expect(comp!.plugin.id).toBe("vaudio:pro-c");
    expect(comp!.proC).toMatchObject({ style: "clean", threshold: -24, slope: 1 - 1 / 3, autoGain: false });
    expect(eq!.plugin.id).toBe("vaudio:pro-q");
    expect(eq!.proQ!.bands).toMatchObject([{ shape: "lowCut", frequency: 80, slope: 12 }, { shape: "bell", frequency: 7000, dynamics: true, range: -6, threshold: null }]);
  });
  it("refuses a fader past its top and an insert without free slots", () => {
    const base = updateMixerTrack(song(), "insert_vocal", { volume: 0.98 });
    expect(() => applyVocalChange(base, "insert_vocal", { faderDb: 3 }, "fx")).toThrow(/no room/);
    expect(() => applyVocalChange(song(), "master", { faderDb: 1 }, "fx")).toThrow(/dedicated/);
  });
});

describe("accepting a candidate", () => {
  it("rejects musical edits made while rendering, but permits a harmless song rename", () => {
    const base = song(), comparison = run(base);
    expect(() => acceptVocalCandidate(updateMixerTrack(base, "insert_beat", { pan: .2 }), comparison, "both")).toThrow(/changed/);
    expect(acceptVocalCandidate({ ...base, name: "New name" }, comparison, "both").name).toBe("New name");
    expect(() => acceptVocalCandidate(base, comparison, "nope")).toThrow(/baseline, both/);
  });
  it("requires both passage reports and a true peak under 0 dBTP, and keeps the baseline as it is", () => {
    const base = song(), comparison = run(base);
    comparison.candidates[1].renders[1].reportId = null;
    expect(() => acceptVocalCandidate(base, comparison, "both")).toThrow(/Both passage/);
    comparison.candidates[1].renders[1].reportId = "report";
    comparison.candidates[1].renders[1].truePeakDbtp = 0.2;
    expect(() => acceptVocalCandidate(base, comparison, "both")).toThrow(/headroom/);
    expect(acceptVocalCandidate(base, comparison, "baseline")).toBe(base);
  });
  it("checks a persisted run's shape, and refuses an earlier version's", () => {
    const comparison = run(song());
    expect(validateVocalMixRun(JSON.parse(JSON.stringify(comparison)), comparison.id, comparison.projectId).id).toBe(comparison.id);
    expect(() => validateVocalMixRun({ ...comparison, schema: 1 }, comparison.id, comparison.projectId)).toThrow(/earlier version/);
    const bad = JSON.parse(JSON.stringify(comparison)); bad.candidates[1].change.faderDb = 20;
    expect(() => validateVocalMixRun(bad, comparison.id, comparison.projectId)).toThrow(/-6 to 6/);
  });
});

describe("what a candidate did", () => {
  const analysis = (median: number, masked: number, spread: number, lufs: number): VocalAnalysis => ({ method: { name: "vocal-vs-accompaniment", version: "1" }, seconds: 10,
    vocal: { integratedLufs: -20, truePeakDbtp: -6, loudnessRangeLu: 4, activeFraction: 0.8, phraseSpreadLu: spread, balance: [] }, accompaniment: { integratedLufs: -16 },
    mix: { integratedLufs: lufs, truePeakDbtp: -1.5, loudnessRangeLu: 5 }, relation: { integratedLu: median, medianLu: median, p10Lu: median - 2, p90Lu: median + 2, seconds: [] },
    masking: { medianDb: 3, maskedFraction: masked }, shape: { mudDb: 1, rumbleDb: -40, harshDb: 1, sibilantFraction: 0.02, mudHz: 300, harshHz: 3000, sibilanceHz: 7000 }, loudRmsDbfs: -18, loudPeakDbfs: -8, sibilanceLevelDbfs: -40, sounding: { chunks: "", frames: "" } });
  it("says what moved against the baseline, in numbers", () => {
    const lines = candidateEffects([analysis(-6, 0.5, 11, -14), analysis(-5, 0.4, 10, -14)], [analysis(-3.5, 0.3, 7, -13.6), analysis(-2.5, 0.2, 6, -13.6)], "balanced");
    expect(lines[0]).toBe("Vocal against the beat (median while singing; balanced is -3 LU): -5.5 → -3.0 LU");
    expect(lines).toContain("Beat over the vocal at 1–4 kHz: 45 → 25% of sung frames");
    expect(lines).toContain("Phrase spread: +10.5 → +6.5 LU");
    expect(lines.some(l => l.startsWith("Low mids"))).toBe(false);
    expect(lines).toContain("Mix loudness: -14.0 → -13.6 LUFS");
  });
  it("level-matches a candidate whose compressor or EQ moved the vocal more than its fader meant", () => {
    const base = [analysis(-3, 0.3, 10, -14), analysis(-3, 0.3, 10, -14)], quieter = [analysis(-9.2, 0.3, 6, -15), analysis(-8.8, 0.3, 6, -15)];
    expect(levelMatch(base, { change: { faderDb: 1, compressor: { threshold: -20, ratio: 3, attack: 0.01, release: 0.15, knee: 6, range: 12 } }, analyses: quieter })).toEqual({ faderDb: 6, driftLu: -7 });
    expect(levelMatch(base, { change: { eq: [{ shape: "bell", frequency: 300, gain: -3, q: 1 }] }, analyses: [analysis(-3.4, 0.3, 10, -14), analysis(-3.4, 0.3, 10, -14)] })).toBeNull();
    expect(levelMatch(base, { change: null, analyses: quieter })).toBeNull();
  });
  it("matches playback to the quietest render, never past -1 dBTP", () => {
    expect(auditionGains([{ integratedLufs: -14, truePeakDbtp: -3 }, { integratedLufs: -12, truePeakDbtp: -0.5 }])).toEqual([0, -2]);
    // The quietest is too hot itself: everything comes down so it peaks at -1 dBTP.
    const [a, b] = auditionGains([{ integratedLufs: -14, truePeakDbtp: -0.2 }, { integratedLufs: -12, truePeakDbtp: -3 }]);
    expect(a).toBeCloseTo(-0.8, 9); expect(b).toBeCloseTo(-2.8, 9);
    expect(auditionGains([{ integratedLufs: null, truePeakDbtp: -3 }])).toEqual([null]);
  });
});
