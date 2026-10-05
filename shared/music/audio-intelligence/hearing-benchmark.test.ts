import { describe, expect, it } from "vitest";
import { hashJson } from "../hash.ts";
import { createHearingCertification, evaluateHearing, HEARING_PROTOCOL, parseHearingCertification, parseHearingEvaluation, type HearingEvaluation } from "./hearing-benchmark.ts";

export function reviewedEvaluation(): HearingEvaluation {
  const cases: HearingEvaluation["cases"] = Array.from({ length: 10 }, (_, i) => ({ id: `case-${i}`, family: `family-${i % 5}`, split: "heldout", task: "context", control: i < 2, realRecording: true, audioSha256: hashJson(i) }));
  const trials = cases.flatMap(c => [0, 1].map(repeat => ({ id: `${c.id}-${repeat}`, caseId: c.id, repeat, completed: true, resolvedModel: "gemini-test-build", outputSha256: hashJson([c.id, repeat]) })));
  return { protocol: HEARING_PROTOCOL, identity: { provider: "google-gemini", model: "gemini-test", adapterVersion: "gemini-interactions-audio-v1", destination: "https://generativelanguage.googleapis.com/v1beta/interactions", promptVersion: "hearing-v1" }, cases, trials,
    reviews: trials.flatMap(t => ["reviewer-one", "reviewer-two"].flatMap(reviewer => (["dsp", "audio", "combined"] as const).map(arm => ({ trialId: t.id, reviewer, arm, usefulness: arm === "dsp" ? 1 : 2, factualError: false, unsupportedClaim: false, timestampsCorrect: true, noChangeCorrect: true })))) };
}
describe("reviewed hearing release gate", () => {
  it("promotes only the reviewed task and refuses changed certificate content", () => {
    const evaluation = reviewedEvaluation();
    expect(evaluateHearing(evaluation).filter(v => v.passed).map(v => v.task)).toEqual(["context"]);
    const certificate = createHearingCertification(evaluation);
    expect(parseHearingCertification(certificate)).toEqual(certificate);
    certificate.evaluation.identity.model = "gemini-other";
    expect(() => parseHearingCertification(certificate)).toThrow(/hash mismatch/);
  });
  it("does not count synthetic sources, repeats or missing human reviews as acceptance", () => {
    for (const change of [
      (e: HearingEvaluation) => { e.cases.forEach(c => { c.realRecording = false; }); },
      (e: HearingEvaluation) => { e.cases.forEach(c => { c.family = "one-family"; }); },
      (e: HearingEvaluation) => { e.reviews = []; },
      (e: HearingEvaluation) => { e.trials = e.trials.filter(t => t.repeat === 0); e.reviews = e.reviews.filter(r => e.trials.some(t => t.id === r.trialId)); },
      (e: HearingEvaluation) => { e.trials[0].completed = false; },
    ]) {
      const evaluation = reviewedEvaluation(); change(evaluation);
      expect(() => createHearingCertification(evaluation)).toThrow(/No hearing task/);
    }
  });
  it("retains ties, disagreements, timestamp failures and false no-change claims", () => {
    for (const change of [
      (e: HearingEvaluation) => { e.reviews.forEach(r => { r.usefulness = 1; }); },
      (e: HearingEvaluation) => { e.reviews[1].factualError = true; },
      (e: HearingEvaluation) => { e.reviews[1].unsupportedClaim = true; },
      (e: HearingEvaluation) => { e.reviews[1].timestampsCorrect = false; },
      (e: HearingEvaluation) => { e.reviews[1].noChangeCorrect = false; },
    ]) {
      const evaluation = reviewedEvaluation(); change(evaluation);
      expect(evaluateHearing(evaluation)[0].passed).toBe(false);
    }
  });
  it("rejects family leakage, duplicated audio families and duplicate reviews", () => {
    const e = reviewedEvaluation();
    e.cases[5].split = "development";
    expect(() => parseHearingEvaluation(e)).toThrow(/crosses splits/);
    e.cases[5].split = "heldout"; e.cases[1].audioSha256 = e.cases[0].audioSha256;
    expect(() => parseHearingEvaluation(e)).toThrow(/different families/);
    e.cases[1].audioSha256 = hashJson(1); e.reviews.push(e.reviews[0]);
    expect(() => parseHearingEvaluation(e)).toThrow(/duplicate review/);
  });
});
