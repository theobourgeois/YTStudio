/** Provider-independent hearing contracts; separate from immutable evidence schema v1. */
export const HEARING_TASKS = ["context", "tone", "dynamics"] as const;
export type HearingTask = typeof HEARING_TASKS[number];
export interface HearingRequest { artifactId: string; task: HearingTask; question: string }
export interface HearingSettings { enabled: boolean; revision: string }
export interface HearingCapabilities {
  configured: boolean;
  provider: string;
  model: string;
  adapterVersion: string;
  destination: string;
  verifiedTasks: HearingTask[];
  unavailable: string[];
}
export interface PerceptionFinding { task: HearingTask; claim: string; startSeconds: number; endSeconds: number }
export interface PerceptionOutput { findings: PerceptionFinding[]; limitations: string[] }
export interface HearingAttempt {
  number: number;
  startedAt: number;
  endedAt: number | null;
  status: "pending" | "completed" | "failed" | "cancelled";
  inputTokens: number | null;
  outputTokens: number | null;
  costUsd: number | null;
}
export interface HearingReceipt {
  jobId: string;
  sourceArtifactId: string;
  permittedArtifactId: string;
  preparedArtifactId: string;
  provider: string;
  requestedModel: string;
  resolvedModel: string | null;
  adapterVersion: string;
  destination: string;
  consentRevision: string;
  task: HearingTask;
  question: string;
  /** Provider seconds → original artifact seconds; no independent gain normalization. */
  timeMap: { sourceStartSeconds: number; secondsPerProviderSecond: number };
  attempts: HearingAttempt[];
  cachedFrom: string | null;
  evidenceId: string | null;
  unavailableReason: string | null;
  createdAt: number;
}
export function parseHearingRequest(input: unknown): HearingRequest {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("Invalid hearing request.");
  const o = input as Record<string, unknown>;
  if (typeof o.artifactId !== "string" || !/^art_[a-f0-9]{20}$/.test(o.artifactId)) throw new Error("A registered artifact id is required.");
  if (!(HEARING_TASKS as readonly unknown[]).includes(o.task)) throw new Error("Hearing task must be context, tone, or dynamics.");
  if (typeof o.question !== "string" || !o.question.trim() || o.question.length > 1000) throw new Error("Provide a question of 1 to 1000 characters.");
  return { artifactId: o.artifactId, task: o.task as HearingTask, question: o.question.trim() };
}
/** Strict structure/times; unsupported exact measurements, spatial and plugin-setting claims are suppressed. */
export function validatePerceptionOutput(input: unknown, duration: number, task: HearingTask): PerceptionOutput {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("Invalid hearing response.");
  const o = input as Record<string, unknown>;
  if (!Array.isArray(o.findings) || o.findings.length > 20 || !Array.isArray(o.limitations) || o.limitations.length > 20) throw new Error("Invalid hearing response lists.");
  const limitations = o.limitations.map(x => {
    if (typeof x !== "string" || !x.trim() || x.length > 1000) throw new Error("Invalid hearing limitation.");
    return x;
  });
  const findings: PerceptionFinding[] = [];
  for (const item of o.findings) {
    if (!item || typeof item !== "object" || Array.isArray(item)) throw new Error("Invalid hearing finding.");
    const f = item as Record<string, unknown>;
    if (typeof f.claim !== "string" || !f.claim.trim() || f.claim.length > 1000) throw new Error("Invalid hearing claim.");
    if (typeof f.startSeconds !== "number" || typeof f.endSeconds !== "number" || !Number.isFinite(f.startSeconds) || !Number.isFinite(f.endSeconds) || f.startSeconds < 0 || f.endSeconds <= f.startSeconds || f.endSeconds > duration) throw new Error("Hearing timestamp is outside the supplied audio.");
    if (f.task !== task || /\b(stereo|pann?ing|pan position|LUFS|dBFS|dBTP|true[- ]peak|threshold|compression ratio|attack time|release time|plugin settings?)\b/i.test(f.claim) || /\d\s*(?:dB|Hz|kHz|ms|:1)\b/i.test(f.claim)) {
      limitations.push("An unsupported task, spatial, exact measurement, or plugin-setting claim was suppressed.");
      continue;
    }
    findings.push({ task, claim: f.claim.trim(), startSeconds: f.startSeconds, endSeconds: f.endSeconds });
  }
  return { findings, limitations };
}
