import { describe, expect, it } from "vitest";
import { MAX_JOB_EVENTS, applyJobAction, canRetry, createJob, idempotencyKey, isTerminal, recoverJobs, validateJob, type JobAction } from "./job.ts";
import type { AudioJob, JobResult } from "./types.ts";

const RESULT: JobResult = { artifactIds: ["art_1"], evidenceIds: [], snapshotIds: ["snap_1"] };
const make = (over: Partial<Parameters<typeof createJob>[0]> = {}) =>
  createJob({ id: "job_1", kind: "render", projectId: "proj_1", inputs: ["snap_1"], stages: ["snapshot", "render", "measure"], now: 100, ...over });

/** Applies the actions in order, expecting each to be allowed. */
function run(job: AudioJob, ...actions: JobAction[]): AudioJob {
  let t = 100;
  for (const action of actions) {
    const step = applyJobAction(job, action, ++t);
    if (!step.ok) throw new Error(`${action.type}: ${step.error}`);
    job = step.job;
  }
  return job;
}

const refused = (job: AudioJob, action: JobAction) => {
  const step = applyJobAction(job, action, 999);
  expect(step.ok, `${action.type} on a ${job.status} job`).toBe(false);
  return step.ok ? "" : step.error;
};

describe("createJob", () => {
  it("is queued, with its stages pending and nothing tried yet", () => {
    const job = make();
    expect(job).toMatchObject({ status: "queued", attempts: 0, maxAttempts: 3, cancelRequested: false, result: null, error: null, runId: null, createdAt: 100, updatedAt: 100 });
    expect(job.stages).toEqual([
      { name: "snapshot", status: "pending", progress: 0 },
      { name: "render", status: "pending", progress: 0 },
      { name: "measure", status: "pending", progress: 0 },
    ]);
    expect(job.events).toEqual([{ at: 100, type: "queued" }]);
    expect(validateJob(job).ok).toBe(true);
  });

  it("copies its inputs and stages: changing what was passed in changes nothing", () => {
    const inputs = ["a"];
    const job = make({ inputs });
    inputs.push("b");
    expect(job.inputs).toEqual(["a"]);
  });
});

describe("idempotencyKey", () => {
  it("is the same for the same request, and a hash", () => {
    expect(idempotencyKey("render", "p", ["a", "b"], { range: [0, 4] })).toBe(idempotencyKey("render", "p", ["a", "b"], { range: [0, 4] }));
    expect(idempotencyKey("render", "p", ["a"])).toMatch(/^[0-9a-f]{64}$/);
  });

  it("doesn't depend on the order keys were written in", () => {
    expect(idempotencyKey("render", "p", ["a"], { x: 1, y: { a: 1, b: 2 } })).toBe(idempotencyKey("render", "p", ["a"], { y: { b: 2, a: 1 }, x: 1 }));
  });

  it("differs by kind, project, input, input order and parameters", () => {
    const keys = [
      idempotencyKey("render", "p", ["a", "b"]),
      idempotencyKey("analyse", "p", ["a", "b"]),
      idempotencyKey("render", "q", ["a", "b"]),
      idempotencyKey("render", "p", ["a"]),
      idempotencyKey("render", "p", ["b", "a"]),
      idempotencyKey("render", "p", ["a", "b"], { stems: true }),
    ];
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("treats an absent parameter and null as the same", () => {
    expect(idempotencyKey("render", "p", ["a"])).toBe(idempotencyKey("render", "p", ["a"], null));
  });

  it("is on the job, from its request", () => {
    expect(make().idempotencyKey).toBe(idempotencyKey("render", "proj_1", ["snap_1"]));
    expect(make({ params: { stems: true } }).idempotencyKey).toBe(idempotencyKey("render", "proj_1", ["snap_1"], { stems: true }));
  });
});

describe("the happy path", () => {
  it("queued → running → succeeded, with each stage done and the result kept", () => {
    const job = run(make(), { type: "start" }, { type: "progress", stage: "snapshot", progress: 1 }, { type: "progress", stage: "render", progress: 0.5 }, { type: "succeed", result: RESULT });
    expect(job.status).toBe("succeeded");
    expect(job.result).toEqual(RESULT);
    expect(job.attempts).toBe(1);
    expect(job.stages.every((s) => s.status === "done" && s.progress === 1)).toBe(true);
    expect(job.events.map((e) => e.type)).toEqual(["queued", "started", "progress", "progress", "succeeded"]);
    expect(isTerminal(job)).toBe(true);
    expect(validateJob(job).ok).toBe(true);
  });

  it("never changes the record it was given", () => {
    const before = make();
    const frozen = JSON.stringify(before);
    applyJobAction(before, { type: "start" }, 5);
    expect(JSON.stringify(before)).toBe(frozen);
  });

  it("stamps each change with when it happened", () => {
    const job = run(make(), { type: "start" });
    expect(job.updatedAt).toBe(101);
    expect(job.createdAt).toBe(100);
  });
});

describe("progress", () => {
  const started = () => run(make(), { type: "start" });

  it("marks earlier stages done and later ones waiting", () => {
    const job = run(started(), { type: "progress", stage: "render", progress: 0.25 });
    expect(job.stages.map((s) => [s.status, s.progress])).toEqual([["done", 1], ["running", 0.25], ["pending", 0]]);
  });

  it("finishes a stage at 1", () => {
    const job = run(started(), { type: "progress", stage: "snapshot", progress: 1 });
    expect(job.stages[0]).toEqual({ name: "snapshot", status: "done", progress: 1 });
  });

  it("only moves forward", () => {
    const job = run(started(), { type: "progress", stage: "render", progress: 0.6 });
    expect(refused(job, { type: "progress", stage: "render", progress: 0.2 })).toMatch(/can't go back/);
    // Not even in a finished stage.
    expect(refused(job, { type: "progress", stage: "snapshot", progress: 0.5 })).toMatch(/can't go back/);
  });

  it("refuses an unknown stage, naming the real ones, and a progress outside 0..1", () => {
    expect(refused(started(), { type: "progress", stage: "bake", progress: 0.5 })).toMatch(/snapshot, render, measure/);
    for (const progress of [-0.1, 1.1, NaN, Infinity]) refused(started(), { type: "progress", stage: "render", progress });
  });

  it("is only for a running job", () => {
    refused(make(), { type: "progress", stage: "render", progress: 0.5 });
  });
});

describe("failing and retrying", () => {
  const failed = (retryable: boolean, over: Partial<Parameters<typeof createJob>[0]> = {}) => run(make(over), { type: "start" }, { type: "fail", error: { message: "engine busy", retryable } });

  it("fails with a message, and says whether a retry could help", () => {
    const job = failed(true);
    expect(job).toMatchObject({ status: "failed", error: { message: "engine busy", retryable: true } });
    expect(job.events.at(-1)).toMatchObject({ type: "failed", message: "engine busy" });
    expect(validateJob(job).ok).toBe(true);
  });

  it("retries a retryable failure: back to queued, stages cleared, error cleared, attempts kept", () => {
    const job = run(failed(true), { type: "retry" });
    expect(job).toMatchObject({ status: "queued", error: null, attempts: 1 });
    expect(job.stages.every((s) => s.status === "pending" && s.progress === 0)).toBe(true);
    expect(validateJob(job).ok).toBe(true);
    expect(run(job, { type: "start" }).attempts).toBe(2);
  });

  it("won't retry what a retry can't fix", () => {
    expect(canRetry(failed(false))).toBe(false);
    expect(refused(failed(false), { type: "retry" })).toMatch(/isn't one a retry could fix/);
  });

  it("stops retrying at its attempts, however retryable the error", () => {
    let job = make({ maxAttempts: 2 });
    for (let i = 0; i < 2; i++) job = run(job, { type: "start" }, { type: "fail", error: { message: "x", retryable: true } }, ...(i === 0 ? [{ type: "retry" } as const] : []));
    expect(job.attempts).toBe(2);
    expect(canRetry(job)).toBe(false);
    expect(refused(job, { type: "retry" })).toMatch(/used its 2 attempts/);
  });

  it("can't fail unless running, and can't be retried unless failed or interrupted", () => {
    refused(make(), { type: "fail", error: { message: "x", retryable: false } });
    refused(make(), { type: "retry" });
    refused(run(make(), { type: "start" }), { type: "retry" });
    refused(run(make(), { type: "start" }, { type: "succeed", result: RESULT }), { type: "retry" });
  });

  it("can't start twice, or after succeeding", () => {
    refused(run(make(), { type: "start" }), { type: "start" });
    refused(run(make(), { type: "start" }, { type: "succeed", result: RESULT }), { type: "start" });
  });
});

describe("cancelling", () => {
  it("cancels a queued job at once", () => {
    const job = run(make(), { type: "cancel" });
    expect(job.status).toBe("cancelled");
    expect(isTerminal(job)).toBe(true);
    expect(validateJob(job).ok).toBe(true);
  });

  it("only asks a running job to stop: it's cancelled when it says it has let go", () => {
    const asked = run(make(), { type: "start" }, { type: "cancel" });
    expect(asked).toMatchObject({ status: "running", cancelRequested: true });
    expect(validateJob(asked).ok).toBe(true);
    const done = run(asked, { type: "cancelled" });
    expect(done).toMatchObject({ status: "cancelled", cancelRequested: false });
    expect(validateJob(done).ok).toBe(true);
  });

  it("asking twice changes nothing", () => {
    const asked = run(make(), { type: "start" }, { type: "cancel" });
    const again = applyJobAction(asked, { type: "cancel" }, 500);
    expect(again).toEqual({ ok: true, job: asked });
  });

  it("can't finish cancelling a job nobody asked to stop", () => {
    refused(run(make(), { type: "start" }), { type: "cancelled" });
    refused(make(), { type: "cancelled" });
  });

  it("lets a job that finishes despite the request succeed, and says so, keeping its results", () => {
    const job = run(make(), { type: "start" }, { type: "cancel" }, { type: "succeed", result: RESULT });
    expect(job).toMatchObject({ status: "succeeded", result: RESULT, cancelRequested: true });
    expect(job.events.at(-1)?.type).toBe("succeeded-despite-cancel");
  });

  it("doesn't cancel a failed job, and a cancelled job stays cancelled", () => {
    refused(run(make(), { type: "start" }, { type: "fail", error: { message: "x", retryable: true } }), { type: "cancel" });
    const cancelled = run(make(), { type: "cancel" });
    for (const action of [{ type: "start" }, { type: "cancel" }, { type: "retry" }, { type: "interrupt" }, { type: "succeed", result: RESULT }] as const) refused(cancelled, action);
  });

  it("a failure clears a pending cancel request: it failed, it wasn't cancelled", () => {
    const job = run(make(), { type: "start" }, { type: "cancel" }, { type: "fail", error: { message: "x", retryable: false } });
    expect(job).toMatchObject({ status: "failed", cancelRequested: false });
    expect(validateJob(job).ok).toBe(true);
  });
});

describe("restart recovery", () => {
  it("turns a running job into an interrupted one, which can be retried or cancelled", () => {
    const running = run(make(), { type: "start" }, { type: "progress", stage: "render", progress: 0.4 });
    const [recovered] = recoverJobs([running], 700);
    expect(recovered).toMatchObject({ status: "interrupted", updatedAt: 700 });
    expect(recovered.events.at(-1)).toMatchObject({ type: "interrupted" });
    expect(canRetry(recovered)).toBe(true);
    expect(run(recovered, { type: "retry" }).status).toBe("queued");
    expect(run(recovered, { type: "cancel" }).status).toBe("cancelled");
    expect(validateJob(recovered).ok).toBe(true);
  });

  it("cancels one that was asked to stop: nothing is left to wait for", () => {
    const [recovered] = recoverJobs([run(make(), { type: "start" }, { type: "cancel" })], 700);
    expect(recovered.status).toBe("cancelled");
    expect(recovered.cancelRequested).toBe(false);
    expect(validateJob(recovered).ok).toBe(true);
  });

  it("leaves every other job alone and returns only what changed", () => {
    const queued = make({ id: "q" });
    const done = run(make({ id: "d" }), { type: "start" }, { type: "succeed", result: RESULT });
    const failed = run(make({ id: "f" }), { type: "start" }, { type: "fail", error: { message: "x", retryable: false } });
    const running = run(make({ id: "r" }), { type: "start" });
    expect(recoverJobs([queued, done, failed, running], 700).map((j) => j.id)).toEqual(["r"]);
    expect(recoverJobs([], 700)).toEqual([]);
  });

  it("an interrupted job that has used every attempt can't be retried", () => {
    const job = run(make({ maxAttempts: 1 }), { type: "start" });
    const [recovered] = recoverJobs([job], 700);
    expect(canRetry(recovered)).toBe(false);
  });
});

describe("events", () => {
  it("keeps the latest ones", () => {
    let job = run(make(), { type: "start" });
    for (let i = 0; i < MAX_JOB_EVENTS + 50; i++) job = run(job, { type: "progress", stage: "render", progress: Math.min(0.9, i / 1000) });
    expect(job.events).toHaveLength(MAX_JOB_EVENTS);
    expect(job.events.at(-1)?.type).toBe("progress");
    expect(validateJob(job).ok).toBe(true);
  });
});

describe("validateJob", () => {
  const errorsOf = (value: unknown) => {
    const read = validateJob(value);
    return read.ok ? [] : read.errors;
  };

  it("accepts every state the machine produces, after JSON", () => {
    const started = run(make(), { type: "start" });
    const states = [
      make(),
      started,
      run(started, { type: "progress", stage: "render", progress: 0.3 }),
      run(started, { type: "succeed", result: RESULT }),
      run(started, { type: "fail", error: { message: "x", retryable: true } }),
      run(started, { type: "cancel" }),
      run(started, { type: "cancel" }, { type: "cancelled" }),
      run(started, { type: "interrupt" }),
      run(make(), { type: "cancel" }),
    ];
    for (const job of states) {
      const read = validateJob(JSON.parse(JSON.stringify(job)));
      expect(read.ok && read.value, job.status).toEqual(job);
    }
  });

  it("refuses junk and a wrong schema", () => {
    for (const junk of [null, 1, [], {}]) expect(errorsOf(junk).length).toBeGreaterThan(0);
    expect(errorsOf({ ...make(), schema: 4 })).toContain("schema: must be 1");
  });

  it("refuses an unknown kind or status", () => {
    expect(errorsOf({ ...make(), kind: "bake" }).join()).toMatch(/kind: must be one of/);
    expect(errorsOf({ ...make(), status: "paused" }).join()).toMatch(/status: must be one of/);
  });

  it("refuses a status its fields contradict", () => {
    const ran = run(make(), { type: "start" });
    expect(errorsOf({ ...ran, status: "succeeded" }).join()).toMatch(/result: is missing on a succeeded job/);
    expect(errorsOf({ ...ran, result: RESULT }).join()).toMatch(/result: is set on a running job/);
    expect(errorsOf({ ...ran, status: "failed" }).join()).toMatch(/error: is missing on a failed job/);
    expect(errorsOf({ ...ran, error: { message: "x", retryable: true } }).join()).toMatch(/error: is set on a running job/);
    expect(errorsOf({ ...make(), status: "running" }).join()).toMatch(/never started/);
    expect(errorsOf({ ...make(), cancelRequested: true }).join()).toMatch(/only a running one is told to stop/);
  });

  it("refuses attempts past the maximum, and stages that disagree with themselves", () => {
    const ran = run(make(), { type: "start" });
    expect(errorsOf({ ...ran, attempts: 9 }).join()).toMatch(/past maxAttempts/);
    expect(errorsOf({ ...ran, stages: [{ name: "a", status: "done", progress: 0.5 }] }).join()).toMatch(/is done, so its progress is 1/);
    expect(errorsOf({ ...ran, stages: [{ name: "a", status: "pending", progress: 1 }] }).join()).toMatch(/isn't done, so its progress isn't 1/);
    expect(errorsOf({ ...ran, stages: [{ name: "a", status: "pending", progress: 0 }, { name: "a", status: "pending", progress: 0 }] }).join()).toMatch(/two stages of one name/);
  });

  it("refuses a bad idempotency key and a job updated before it was made", () => {
    expect(errorsOf({ ...make(), idempotencyKey: "abc" }).join()).toMatch(/idempotencyKey/);
    expect(errorsOf({ ...make(), updatedAt: 1 }).join()).toMatch(/updatedAt: is before createdAt/);
  });

  it("never throws on junk", () => {
    for (const junk of [{ stages: [null] }, { events: [3] }, { result: 4 }, { error: [] }, { inputs: "x" }]) expect(() => validateJob(junk)).not.toThrow();
  });
});
