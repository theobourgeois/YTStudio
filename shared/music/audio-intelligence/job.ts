/**
 * Jobs (`types.ts`): the state machine of a long operation. Pure: the server keeps the record on disk and
 * runs the work; every change to it is `applyJobAction`, which refuses what the machine doesn't allow, so
 * a job can't be cancelled twice, succeed after failing, or retried past its attempts.
 *
 *   queued ──start──▶ running ──succeed──▶ succeeded
 *      │                │ ├──fail──▶ failed ──retry──▶ queued
 *      │                │ ├──interrupt──▶ interrupted ──retry──▶ queued
 *      │                │ └──cancel──▶ (cancelRequested) ──cancelled──▶ cancelled
 *      └──cancel──▶ cancelled   (a queued, failed or interrupted job is cancelled at once)
 */
import { canonicalJson, hashJson } from "../hash.ts";
import {
  AUDIO_INTELLIGENCE_SCHEMA,
  JOB_KINDS,
  JOB_STATUSES,
  type AudioJob,
  type JobError,
  type JobEvent,
  type JobKind,
  type JobResult,
  type JobStage,
  type JobStatus,
} from "./types.ts";
import {
  Problems,
  array,
  boolean,
  hash,
  number,
  object,
  oneOf,
  optionalString,
  string,
  stringList,
  toValidation,
  type Validation,
} from "./validation.ts";

/** The most events kept: the oldest go first. */
export const MAX_JOB_EVENTS = 200;
export const DEFAULT_MAX_ATTEMPTS = 3;

export const TERMINAL_STATUSES: readonly JobStatus[] = ["succeeded", "cancelled"];
export const isTerminal = (job: Pick<AudioJob, "status">): boolean => TERMINAL_STATUSES.includes(job.status);

/**
 * What a request is, so asking for the same thing twice finds the first job: a hash of the kind, the project, the
 * inputs and any other parameters (in canonical JSON, so key order doesn't matter). The input ids' order is part of
 * it; callers sort them where order doesn't matter.
 */
export const idempotencyKey = (kind: JobKind, projectId: string, inputs: readonly string[], params: unknown = null): string =>
  hashJson({ kind, projectId, inputs, params: JSON.parse(canonicalJson(params)) });

export interface NewJob {
  id: string;
  kind: JobKind;
  projectId: string;
  inputs: readonly string[];
  /** What else the request says, for the idempotency key. */
  params?: unknown;
  /** The stages it passes through, in order (`snapshot`, `render`, `measure`...). */
  stages: readonly string[];
  runId?: string | null;
  maxAttempts?: number;
  now: number;
}

export function createJob(input: NewJob): AudioJob {
  return {
    schema: AUDIO_INTELLIGENCE_SCHEMA,
    id: input.id,
    kind: input.kind,
    projectId: input.projectId,
    idempotencyKey: idempotencyKey(input.kind, input.projectId, input.inputs, input.params ?? null),
    runId: input.runId ?? null,
    inputs: [...input.inputs],
    status: "queued",
    stages: input.stages.map((name) => ({ name, status: "pending", progress: 0 })),
    attempts: 0,
    maxAttempts: input.maxAttempts ?? DEFAULT_MAX_ATTEMPTS,
    cancelRequested: false,
    result: null,
    error: null,
    events: [{ at: input.now, type: "queued" }],
    createdAt: input.now,
    updatedAt: input.now,
  };
}

export type JobAction =
  | { type: "start" }
  /** Working on `stage` and this far through it (0..1): earlier stages are done, later ones wait. 1 finishes the stage. */
  | { type: "progress"; stage: string; progress: number }
  | { type: "succeed"; result: JobResult }
  | { type: "fail"; error: JobError }
  /** Asked for: a running job is told to stop (and ends `cancelled` when it has), any other is cancelled now. */
  | { type: "cancel" }
  /** A running job that was asked to stop has stopped and let go of what it held. */
  | { type: "cancelled" }
  /** The server went away while it ran (found at startup). */
  | { type: "interrupt" }
  | { type: "retry" };

export type JobStep = { ok: true; job: AudioJob } | { ok: false; error: string };

const no = (job: AudioJob, action: JobAction): JobStep => ({ ok: false, error: `Job ${job.id} is ${job.status}: it can't ${describe(action)}.` });

const describe = (action: JobAction): string =>
  ({ start: "start", progress: "report progress", succeed: "succeed", fail: "fail", cancel: "be cancelled", cancelled: "finish cancelling", interrupt: "be interrupted", retry: "be retried" })[action.type];

/** Whether a retry is possible now: a failure that could pass, or an interruption, with attempts left. */
export function canRetry(job: AudioJob): boolean {
  if (job.attempts >= job.maxAttempts) return false;
  return job.status === "interrupted" || (job.status === "failed" && job.error?.retryable === true);
}

/** Applies one action, returning the next record (the given one is never changed) or why it can't be. */
export function applyJobAction(job: AudioJob, action: JobAction, now: number): JobStep {
  const next = (changes: Partial<AudioJob>, event: Omit<JobEvent, "at">): JobStep => ({
    ok: true,
    job: { ...job, ...changes, updatedAt: now, events: [...job.events, { at: now, ...event }].slice(-MAX_JOB_EVENTS) },
  });

  switch (action.type) {
    case "start":
      if (job.status !== "queued") return no(job, action);
      return next({ status: "running", attempts: job.attempts + 1, error: null }, { type: "started", message: `attempt ${job.attempts + 1} of ${job.maxAttempts}` });

    case "progress": {
      if (job.status !== "running") return no(job, action);
      const at = job.stages.findIndex((s) => s.name === action.stage);
      if (at < 0) return { ok: false, error: `Job ${job.id} has no stage "${action.stage}": its stages are ${job.stages.map((s) => s.name).join(", ")}.` };
      if (!Number.isFinite(action.progress) || action.progress < 0 || action.progress > 1) return { ok: false, error: `Progress must be between 0 and 1, not ${action.progress}.` };
      const stages: JobStage[] = job.stages.map((s, i) => {
        if (i < at) return { ...s, status: "done", progress: 1 };
        if (i === at) return action.progress === 1 ? { ...s, status: "done", progress: 1 } : { ...s, status: "running", progress: action.progress };
        return s.status === "done" ? { ...s, status: "pending", progress: 0 } : s;
      });
      // Progress only moves forward, even in a finished stage (a rewind is a bug in the worker).
      if (action.progress < job.stages[at].progress) return { ok: false, error: `Stage "${action.stage}" is at ${job.stages[at].progress}: progress can't go back to ${action.progress}.` };
      return next({ stages }, { type: "progress", stage: action.stage });
    }

    case "succeed":
      if (job.status !== "running") return no(job, action);
      return next(
        { status: "succeeded", result: action.result, error: null, stages: job.stages.map((s) => ({ ...s, status: "done", progress: 1 })) },
        { type: job.cancelRequested ? "succeeded-despite-cancel" : "succeeded" },
      );

    case "fail":
      if (job.status !== "running") return no(job, action);
      return next({ status: "failed", error: action.error, cancelRequested: false }, { type: "failed", message: action.error.message });

    case "cancel":
      if (job.status === "running") return job.cancelRequested ? { ok: true, job } : next({ cancelRequested: true }, { type: "cancel-requested" });
      if (job.status === "queued" || job.status === "interrupted") return next({ status: "cancelled" }, { type: "cancelled" });
      return no(job, action);

    case "cancelled":
      if (job.status !== "running" || !job.cancelRequested) return no(job, action);
      return next({ status: "cancelled", cancelRequested: false }, { type: "cancelled" });

    case "interrupt":
      if (job.status !== "running") return no(job, action);
      return next({ status: "interrupted", cancelRequested: false }, { type: "interrupted", message: "the server stopped while it was running" });

    case "retry":
      if (!canRetry(job)) {
        const why = job.attempts >= job.maxAttempts ? `it has used its ${job.maxAttempts} attempts` : job.status === "failed" ? "its error isn't one a retry could fix" : `it is ${job.status}`;
        return { ok: false, error: `Job ${job.id} can't be retried: ${why}.` };
      }
      return next(
        { status: "queued", error: null, cancelRequested: false, stages: job.stages.map((s) => ({ ...s, status: "pending", progress: 0 })) },
        { type: "retry" },
      );
  }
}

/**
 * What a restart does to what it finds: a job that was running can't still be (its worker died with the server), so
 * it becomes interrupted, and one that was asked to stop is cancelled. Returns only the jobs that changed.
 */
export function recoverJobs(jobs: readonly AudioJob[], now: number): AudioJob[] {
  const changed: AudioJob[] = [];
  for (const job of jobs) {
    if (job.status !== "running") continue;
    const interrupted = applyJobAction(job, { type: "interrupt" }, now);
    if (!interrupted.ok) continue;
    const settled = job.cancelRequested ? applyJobAction(interrupted.job, { type: "cancel" }, now) : interrupted;
    if (settled.ok) changed.push(settled.job);
  }
  return changed;
}

// ---------------------------------------------------------------------------------------------------------
// Reading one off the disk

/** Checks a job from a manifest: well-formed, and with fields that agree with its status. */
export function validateJob(input: unknown): Validation<AudioJob> {
  const p = new Problems();
  const o = object(input, "", p);
  if (o.schema !== AUDIO_INTELLIGENCE_SCHEMA) p.add("schema", `must be ${AUDIO_INTELLIGENCE_SCHEMA}`);

  const status = oneOf(o.status, JOB_STATUSES, "status", p);
  const stages: JobStage[] = array(o.stages, "stages", p, 100).map((item, i) => {
    const at = `stages[${i}]`;
    const s = object(item, at, p);
    const stage = { name: string(s.name, `${at}.name`, p, { nonEmpty: true }), status: oneOf(s.status, ["pending", "running", "done"], `${at}.status`, p), progress: number(s.progress, `${at}.progress`, p, { min: 0, max: 1 }) };
    if ((stage.status === "done") !== (stage.progress === 1) && stage.status !== "running") p.add(at, stage.status === "done" ? "is done, so its progress is 1" : "isn't done, so its progress isn't 1");
    return stage;
  });
  if (new Set(stages.map((s) => s.name)).size !== stages.length) p.add("stages", "has two stages of one name");

  const attempts = number(o.attempts, "attempts", p, { min: 0, int: true });
  const maxAttempts = number(o.maxAttempts, "maxAttempts", p, { min: 1, max: 20, int: true });
  if (attempts > maxAttempts) p.add("attempts", `is ${attempts}, past maxAttempts (${maxAttempts})`);
  // A queued job can be cancelled before it ever starts; no other job can have no attempts.
  if (status !== "queued" && status !== "cancelled" && attempts === 0) p.add("attempts", `is 0, but the job is ${status}: it never started`);

  const cancelRequested = boolean(o.cancelRequested, "cancelRequested", p);
  if (cancelRequested && status !== "running") p.add("cancelRequested", `is set on a ${status} job: only a running one is told to stop`);

  let result: JobResult | null = null;
  if (o.result !== null) {
    const r = object(o.result, "result", p);
    result = { artifactIds: stringList(r.artifactIds, "result.artifactIds", p), evidenceIds: stringList(r.evidenceIds, "result.evidenceIds", p), snapshotIds: stringList(r.snapshotIds, "result.snapshotIds", p) };
  }
  let error: JobError | null = null;
  if (o.error !== null) {
    const e = object(o.error, "error", p);
    error = { message: string(e.message, "error.message", p, { nonEmpty: true }), retryable: boolean(e.retryable, "error.retryable", p) };
  }
  if (status === "succeeded" && result === null) p.add("result", "is missing on a succeeded job");
  if (status !== "succeeded" && result !== null) p.add("result", `is set on a ${status} job`);
  if (status === "failed" && error === null) p.add("error", "is missing on a failed job");
  if ((status === "succeeded" || status === "queued" || status === "running") && error !== null) p.add("error", `is set on a ${status} job`);

  const events: JobEvent[] = array(o.events, "events", p, MAX_JOB_EVENTS).map((item, i) => {
    const e = object(item, `events[${i}]`, p);
    const stage = optionalString(e.stage, `events[${i}].stage`, p);
    const message = optionalString(e.message, `events[${i}].message`, p);
    return { at: number(e.at, `events[${i}].at`, p, { min: 0 }), type: string(e.type, `events[${i}].type`, p, { nonEmpty: true }), ...(stage === undefined ? {} : { stage }), ...(message === undefined ? {} : { message }) };
  });

  const job: AudioJob = {
    schema: AUDIO_INTELLIGENCE_SCHEMA,
    id: string(o.id, "id", p, { nonEmpty: true }),
    kind: oneOf(o.kind, JOB_KINDS, "kind", p),
    projectId: string(o.projectId, "projectId", p, { nonEmpty: true }),
    idempotencyKey: hash(o.idempotencyKey, "idempotencyKey", p),
    runId: o.runId === null ? null : string(o.runId, "runId", p, { nonEmpty: true }),
    inputs: stringList(o.inputs, "inputs", p),
    status,
    stages,
    attempts,
    maxAttempts,
    cancelRequested,
    result,
    error,
    events,
    createdAt: number(o.createdAt, "createdAt", p, { min: 0 }),
    updatedAt: number(o.updatedAt, "updatedAt", p, { min: 0 }),
  };
  if (job.updatedAt < job.createdAt) p.add("updatedAt", "is before createdAt");
  // The key is what the request was, so it can't be checked without its params: it only has to be a hash.
  return toValidation(p, job);
}
