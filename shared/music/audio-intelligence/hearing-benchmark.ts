/** Reviewed hearing evaluations. Source families, repeats and blind arms stay explicit. */
import { hashJson } from "../hash.ts";
import { HEARING_TASKS, type HearingTask } from "./hearing.ts";

export const HEARING_PROTOCOL = "hearing-heldout-v1";
export const HEARING_ARMS = ["dsp", "audio", "combined"] as const;
export type HearingArm = typeof HEARING_ARMS[number];
export interface HearingBenchmarkCase {
  id: string;
  family: string;
  split: "development" | "heldout";
  task: HearingTask;
  control: boolean;
  /** A real recording, including controlled derivatives; synthetic smoke cases cannot certify. */
  realRecording: boolean;
  audioSha256: string;
}
export interface HearingTrial {
  id: string;
  caseId: string;
  repeat: number;
  /** False includes provider fallback, malformed output and interrupted requests. */
  completed: boolean;
  resolvedModel: string | null;
  outputSha256: string;
}
export interface HearingReview {
  trialId: string;
  reviewer: string;
  arm: HearingArm;
  /** 0: useless, 1: limited, 2: useful, 3: very useful for this question. */
  usefulness: number;
  factualError: boolean;
  unsupportedClaim: boolean;
  timestampsCorrect: boolean;
  noChangeCorrect: boolean;
}
export interface HearingEvaluation {
  protocol: typeof HEARING_PROTOCOL;
  identity: { provider: string; model: string; adapterVersion: string; destination: string; promptVersion: string };
  cases: HearingBenchmarkCase[];
  trials: HearingTrial[];
  reviews: HearingReview[];
}
export interface HearingTaskVerdict {
  task: HearingTask;
  passed: boolean;
  reasons: string[];
  cases: number;
  families: number;
  reviewedTrials: number;
  improvementRate: number | null;
}
function fail(message: string): never { throw new Error(`Invalid hearing evaluation: ${message}`); }
const nonempty = (v: unknown): v is string => typeof v === "string" && v.trim().length > 0 && v.length <= 1000;
const digest = (v: unknown): v is string => typeof v === "string" && /^[a-f0-9]{64}$/.test(v);
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

export function parseHearingEvaluation(value: unknown): HearingEvaluation {
  if (!object(value) || value.protocol !== HEARING_PROTOCOL || !object(value.identity)) fail("protocol/identity");
  for (const key of ["provider", "model", "adapterVersion", "destination", "promptVersion"]) if (!nonempty(value.identity[key])) fail(`identity.${key}`);
  if (!Array.isArray(value.cases) || !Array.isArray(value.trials) || !Array.isArray(value.reviews) || value.cases.length > 1000 || value.trials.length > 10000 || value.reviews.length > 100000) fail("lists");
  const caseIds = new Set<string>(), trialIds = new Set<string>(), reviewIds = new Set<string>(), repeats = new Set<string>();
  const audioFamilies = new Map<string, string>(), familySplits = new Map<string, string>();
  for (const c of value.cases) {
    if (!object(c) || !nonempty(c.id) || !nonempty(c.family) || !HEARING_TASKS.includes(c.task as HearingTask) || !["development", "heldout"].includes(String(c.split)) || typeof c.control !== "boolean" || typeof c.realRecording !== "boolean" || !digest(c.audioSha256)) fail("case");
    if (caseIds.has(c.id)) fail("duplicate case");
    caseIds.add(c.id);
    if (familySplits.has(c.family) && familySplits.get(c.family) !== c.split) fail("recording family crosses splits");
    familySplits.set(c.family, String(c.split));
    if (audioFamilies.has(c.audioSha256) && audioFamilies.get(c.audioSha256) !== c.family) fail("identical audio assigned different families");
    audioFamilies.set(c.audioSha256, c.family);
  }
  for (const t of value.trials) {
    if (!object(t) || !nonempty(t.id) || !nonempty(t.caseId) || !caseIds.has(t.caseId) || !Number.isSafeInteger(t.repeat) || Number(t.repeat) < 0 || typeof t.completed !== "boolean" || !(t.resolvedModel === null || nonempty(t.resolvedModel)) || !digest(t.outputSha256)) fail("trial");
    const repeatId = JSON.stringify([t.caseId, t.repeat]);
    if (trialIds.has(t.id) || repeats.has(repeatId)) fail("duplicate trial/repeat");
    trialIds.add(t.id); repeats.add(repeatId);
  }
  for (const r of value.reviews) {
    if (!object(r) || !nonempty(r.trialId) || !trialIds.has(r.trialId) || !nonempty(r.reviewer) || !HEARING_ARMS.includes(r.arm as HearingArm) || !Number.isInteger(r.usefulness) || Number(r.usefulness) < 0 || Number(r.usefulness) > 3) fail("review");
    for (const key of ["factualError", "unsupportedClaim", "timestampsCorrect", "noChangeCorrect"]) if (typeof r[key] !== "boolean") fail(`review.${key}`);
    const id = JSON.stringify([r.trialId, r.reviewer, r.arm]);
    if (reviewIds.has(id)) fail("duplicate review");
    reviewIds.add(id);
  }
  return value as unknown as HearingEvaluation;
}

/** Preregistered conservative release gate; repeats never inflate the source-case count. */
export function evaluateHearing(input: unknown): HearingTaskVerdict[] {
  const e = parseHearingEvaluation(input);
  return HEARING_TASKS.map(task => {
    const cases = e.cases.filter(c => c.task === task && c.split === "heldout" && c.realRecording);
    const families = new Set(cases.map(c => c.family));
    const reasons: string[] = [];
    if (cases.length < 10) reasons.push("Need at least 10 held-out real-recording cases.");
    if (families.size < 5) reasons.push("Need at least five independent recording families.");
    const controls = cases.filter(c => c.control);
    if (new Set(controls.map(c => c.family)).size < 2) reasons.push("Need no-change controls from at least two families.");
    let reviewedTrials = 0;
    const caseImprovements: number[] = [];
    for (const c of cases) {
      const trials = e.trials.filter(t => t.caseId === c.id);
      if (trials.length < 2) reasons.push(`${c.id}: need two independent provider trials.`);
      const improvements: number[] = [];
      for (const t of trials) {
        if (!t.completed || !t.resolvedModel) { reasons.push(`${t.id}: provider did not complete.`); continue; }
        const reviews = e.reviews.filter(r => r.trialId === t.id);
        const reviewers = [...new Set(reviews.map(r => r.reviewer))].filter(reviewer => HEARING_ARMS.every(arm => reviews.some(r => r.reviewer === reviewer && r.arm === arm)));
        if (reviewers.length < 2) { reasons.push(`${t.id}: need two complete blind reviews of all three arms.`); continue; }
        reviewedTrials++;
        for (const r of reviews.filter(r => r.arm !== "dsp")) {
          if (r.factualError || r.unsupportedClaim || !r.timestampsCorrect || (c.control && !r.noChangeCorrect)) reasons.push(`${t.id}: a reviewer flagged an inaccurate or unsupported listening result.`);
        }
        improvements.push(reviewers.filter(reviewer => {
          const score = (arm: HearingArm) => reviews.find(r => r.reviewer === reviewer && r.arm === arm)!.usefulness;
          return score("combined") > score("dsp") && score("combined") >= 2;
        }).length / reviewers.length);
      }
      if (!c.control && improvements.length) caseImprovements.push(improvements.reduce((a, b) => a + b, 0) / improvements.length);
    }
    const improvementRate = caseImprovements.length ? caseImprovements.reduce((a, b) => a + b, 0) / caseImprovements.length : null;
    if (improvementRate === null || improvementRate < 0.6) reasons.push("Combined evidence must improve over DSP on at least 60% of non-control case reviews.");
    return { task, passed: reasons.length === 0, reasons: [...new Set(reasons)], cases: cases.length, families: families.size, reviewedTrials, improvementRate };
  });
}

export interface HearingCertification { evaluation: HearingEvaluation; evaluationSha256: string }
export function createHearingCertification(input: unknown): HearingCertification {
  const evaluation = parseHearingEvaluation(input);
  if (!evaluateHearing(evaluation).some(v => v.passed)) throw new Error("No hearing task passed the reviewed benchmark.");
  return { evaluation, evaluationSha256: hashJson(evaluation) };
}
export function parseHearingCertification(value: unknown): HearingCertification {
  if (!object(value) || !digest(value.evaluationSha256)) fail("certification");
  const certification = createHearingCertification(value.evaluation);
  if (certification.evaluationSha256 !== value.evaluationSha256) fail("certification content hash mismatch");
  return certification;
}
