import { describe, expect, it } from "vitest";
import {
  BUDGET_CEILINGS,
  DEFAULT_BUDGETS,
  addCandidate,
  addIds,
  addPassage,
  advanceRun,
  chargeBudget,
  createRun,
  isFinished,
  passageError,
  resolveBudgets,
  runExpired,
  validateRun,
} from "./run.ts";
import type { MixRun, RunOutcome, RunPhase } from "./types.ts";

const make = (over: Partial<Parameters<typeof createRun>[0]> = {}) =>
  createRun({ id: "run_1", projectId: "proj_1", goal: "Make the vocal sit on the beat", constraints: ["leave the beat alone"], snapshotId: "snap_1", now: 1000, ...over });

/** Walks a run through phases, expecting each move to be allowed. */
function walk(run: MixRun, ...phases: (RunPhase | [RunPhase, RunOutcome])[]): MixRun {
  let t = 1000;
  for (const step of phases) {
    const [to, outcome] = Array.isArray(step) ? step : [step, undefined];
    const next = advanceRun(run, to, ++t, outcome);
    if (!next.ok) throw new Error(`${to}: ${next.error}`);
    run = next.run;
  }
  return run;
}

const refused = (step: ReturnType<typeof advanceRun>) => {
  expect(step.ok).toBe(false);
  return step.ok ? "" : step.error;
};

const toCompare = (run = make()) => walk(run, "inspect", "hypothesise", "propose", "render", "compare");

describe("createRun", () => {
  it("starts at capture with nothing spent, the pilot's budgets and no outcome", () => {
    const run = make();
    expect(run).toMatchObject({ phase: "capture", outcome: null, usage: { candidates: 0, revisionRounds: 0, renderSeconds: 0, hostedCalls: 0 }, budgets: DEFAULT_BUDGETS, startedAt: 1000, updatedAt: 1000, workflow: null, passages: [], candidateIds: [] });
    expect(validateRun(run).ok).toBe(true);
  });

  it("copies its constraints", () => {
    const constraints = ["a"];
    const run = make({ constraints });
    constraints.push("b");
    expect(run.constraints).toEqual(["a"]);
  });

  it("has the plan's defaults: three candidates, two revision rounds", () => {
    expect(DEFAULT_BUDGETS.maxCandidates).toBe(3);
    expect(DEFAULT_BUDGETS.maxRevisionRounds).toBe(2);
  });
});

describe("resolveBudgets", () => {
  it("takes a sensible request", () => {
    expect(resolveBudgets({ maxCandidates: 2, maxPassageSeconds: 15.5 })).toEqual({ ...DEFAULT_BUDGETS, maxCandidates: 2, maxPassageSeconds: 15.5 });
  });

  it("holds a request to the ceiling, however much it asks", () => {
    const got = resolveBudgets({ maxCandidates: 500, maxRevisionRounds: 99, maxPassageSeconds: 9999, maxRenderSeconds: 1e9, maxHostedCalls: 1e6, maxRunSeconds: 1e12 });
    expect(got).toEqual(BUDGET_CEILINGS);
  });

  it("gives the default for nonsense: zero, negative, NaN, text, fractions of a whole count", () => {
    for (const bad of [0, -3, NaN, Infinity, "5", null, undefined, {}, 0.4]) expect(resolveBudgets({ maxCandidates: bad }).maxCandidates, String(bad)).toBe(DEFAULT_BUDGETS.maxCandidates);
  });

  it("rounds a count down to a whole number", () => {
    expect(resolveBudgets({ maxCandidates: 2.9 }).maxCandidates).toBe(2);
  });

  it("is applied when a run is made", () => {
    expect(make({ budgets: { maxCandidates: 100 } }).budgets.maxCandidates).toBe(BUDGET_CEILINGS.maxCandidates);
  });

  it("never has a ceiling below its default", () => {
    for (const key of Object.keys(DEFAULT_BUDGETS) as (keyof typeof DEFAULT_BUDGETS)[]) expect(BUDGET_CEILINGS[key]).toBeGreaterThanOrEqual(DEFAULT_BUDGETS[key]);
  });
});

describe("advanceRun", () => {
  it("walks the whole loop to an accepted result", () => {
    const run = walk(make(), "inspect", "hypothesise", "propose", "render", "compare", "present", ["accepted", "improved"]);
    expect(run).toMatchObject({ phase: "accepted", outcome: "improved", updatedAt: 1007 });
    expect(isFinished(run)).toBe(true);
    expect(validateRun(run).ok).toBe(true);
  });

  it("never changes the record it was given", () => {
    const before = make();
    const frozen = JSON.stringify(before);
    advanceRun(before, "inspect", 5);
    expect(JSON.stringify(before)).toBe(frozen);
  });

  it("won't skip a phase or go backwards, and says where it can go", () => {
    expect(refused(advanceRun(make(), "render", 1))).toMatch(/at capture: it can't go to render. From here: inspect, abandoned/);
    expect(refused(advanceRun(walk(make(), "inspect"), "capture", 1))).toMatch(/can't go to capture/);
    expect(refused(advanceRun(toCompare(), "render", 1))).toMatch(/can't go to render/);
  });

  it("can abandon from any phase before it finishes", () => {
    for (const phases of [[], ["inspect"], ["inspect", "hypothesise", "propose"], ["inspect", "hypothesise", "propose", "render", "compare", "present"]] as RunPhase[][]) {
      const run = walk(make(), ...phases, ["abandoned", "budget"]);
      expect(run).toMatchObject({ phase: "abandoned", outcome: "budget" });
      expect(validateRun(run).ok).toBe(true);
    }
  });

  it("is over once finished: nothing moves a finished run", () => {
    const done = walk(toCompare(), "present", ["discarded", "no-change"]);
    for (const to of ["capture", "inspect", "propose", "present", "accepted", "discarded", "abandoned"] as RunPhase[]) expect(refused(advanceRun(done, to, 9, "tie")), to).toMatch(/It has finished/);
  });

  it("makes a finishing move say how it ended, and only with outcomes that fit", () => {
    const present = walk(toCompare(), "present");
    expect(refused(advanceRun(present, "accepted", 9))).toMatch(/must say how it ended: one of improved, tie/);
    expect(refused(advanceRun(present, "accepted", 9, "regression"))).toMatch(/can't be accepted with the outcome "regression"/);
    expect(refused(advanceRun(present, "discarded", 9, "improved"))).toMatch(/can't be discarded with the outcome "improved"/);
    expect(advanceRun(present, "accepted", 9, "tie").ok).toBe(true);
    expect(advanceRun(present, "discarded", 9, "regression").ok).toBe(true);
    expect(advanceRun(present, "discarded", 9, "stale").ok).toBe(true);
    expect(advanceRun(present, "abandoned", 9, "failed").ok).toBe(true);
  });

  it("gives an outcome only to a move that finishes", () => {
    expect(refused(advanceRun(make(), "inspect", 9, "improved"))).toMatch(/doesn't finish it/);
  });

  it("a revision goes back to propose and uses a round, from compare or from present", () => {
    const first = walk(toCompare(), "propose");
    expect(first.usage.revisionRounds).toBe(1);
    const second = walk(first, "render", "compare", "present", "propose");
    expect(second.usage.revisionRounds).toBe(2);
    expect(validateRun(second).ok).toBe(true);
  });

  it("refuses a revision past the rounds, telling the agent what to do instead", () => {
    const spent = walk(toCompare(), "propose", "render", "compare", "propose", "render", "compare");
    expect(spent.usage.revisionRounds).toBe(2);
    expect(refused(advanceRun(spent, "propose", 9))).toMatch(/used its 2 revision rounds: present the best candidate, or finish/);
    // It can still present or abandon.
    expect(advanceRun(spent, "present", 9).ok).toBe(true);
  });

  it("holds revision rounds to the run's own budget", () => {
    const one = toCompare(make({ budgets: { maxRevisionRounds: 1 } }));
    const revised = walk(one, "propose", "render", "compare");
    expect(refused(advanceRun(revised, "propose", 9))).toMatch(/used its 1 revision rounds/);
  });

  it("a first proposal isn't a revision", () => {
    expect(walk(make(), "inspect", "hypothesise", "propose").usage.revisionRounds).toBe(0);
  });
});

describe("chargeBudget", () => {
  it("spends, and says how much is left when it can't", () => {
    let run = make();
    for (let i = 0; i < 3; i++) {
      const step = chargeBudget(run, "candidates", 1, 5);
      expect(step.ok).toBe(true);
      if (step.ok) run = step.run;
    }
    expect(run.usage.candidates).toBe(3);
    const over = chargeBudget(run, "candidates", 1, 6);
    expect(over.ok).toBe(false);
    expect(over.ok ? "" : over.error).toMatch(/would use 4 of maxCandidates \(3\) for candidates: it has 0 left/);
  });

  it("refuses all of a charge that doesn't fit, spending none of it", () => {
    const run = make();
    const over = chargeBudget(run, "renderSeconds", 301, 5);
    expect(over.ok).toBe(false);
    expect(run.usage.renderSeconds).toBe(0);
    const ok = chargeBudget(run, "renderSeconds", 300, 5);
    expect(ok.ok && ok.run.usage.renderSeconds).toBe(300);
  });

  it("charges fractions of a second of audio", () => {
    const a = chargeBudget(make(), "renderSeconds", 12.5, 5);
    const b = a.ok ? chargeBudget(a.run, "renderSeconds", 7.25, 6) : a;
    expect(b.ok && b.run.usage.renderSeconds).toBe(19.75);
  });

  it("refuses a negative or non-finite charge, and any charge to a finished run", () => {
    for (const amount of [-1, NaN, Infinity]) expect(chargeBudget(make(), "hostedCalls", amount, 5).ok, String(amount)).toBe(false);
    const done = walk(make(), ["abandoned", "failed"]);
    expect(chargeBudget(done, "hostedCalls", 1, 5)).toMatchObject({ ok: false });
  });

  it("charges each of the four budgets against its own cap", () => {
    const run = make({ budgets: { maxHostedCalls: 2 } });
    expect(chargeBudget(run, "hostedCalls", 3, 5).ok).toBe(false);
    expect(chargeBudget(run, "hostedCalls", 2, 5).ok).toBe(true);
    expect(chargeBudget(run, "candidates", 3, 5).ok).toBe(true);
    expect(chargeBudget(run, "revisionRounds", 3, 5).ok).toBe(false);
  });
});

describe("candidates, evidence and passages", () => {
  it("adding a candidate charges one, and adding it again costs nothing", () => {
    const one = addCandidate(make(), "cand_a", 5);
    expect(one.ok && one.run).toMatchObject({ candidateIds: ["cand_a"], usage: { candidates: 1 } });
    const again = one.ok ? addCandidate(one.run, "cand_a", 6) : one;
    expect(again.ok && again.run.usage.candidates).toBe(1);
  });

  it("refuses a fourth candidate, and leaves the run as it was", () => {
    let run = make();
    for (const id of ["a", "b", "c"]) {
      const step = addCandidate(run, id, 5);
      if (step.ok) run = step.run;
    }
    const fourth = addCandidate(run, "d", 6);
    expect(fourth.ok).toBe(false);
    expect(run.candidateIds).toEqual(["a", "b", "c"]);
  });

  it("collects evidence and example ids once each", () => {
    let run = addIds(make(), "evidenceIds", ["ev_1", "ev_2", "ev_1"], 5);
    expect(run.evidenceIds).toEqual(["ev_1", "ev_2"]);
    expect(addIds(run, "evidenceIds", ["ev_2"], 6)).toBe(run);
    run = addIds(run, "exampleIds", ["ex_1"], 7);
    expect(run.exampleIds).toEqual(["ex_1"]);
  });

  it("refuses a passage longer than the run allows, or empty, and says what to do", () => {
    const run = make();
    expect(passageError(run, 20)).toBeNull();
    expect(passageError(run, 20.01)).toMatch(/longer than this run allows \(20 s\): pick a shorter one/);
    for (const seconds of [0, -1, NaN]) expect(passageError(run, seconds)).toMatch(/longer than zero/);
    expect(addPassage(run, { startTick: 0, endTick: 100, why: "peak" }, 30, 5).ok).toBe(false);
    expect(addPassage(run, { startTick: 100, endTick: 100, why: "peak" }, 5, 5).ok).toBe(false);
    const ok = addPassage(run, { startTick: 0, endTick: 384, why: "loudest line" }, 5, 5);
    expect(ok.ok && ok.run.passages).toEqual([{ startTick: 0, endTick: 384, why: "loudest line" }]);
  });
});

describe("runExpired", () => {
  it("is when the wall clock passes the budget", () => {
    const run = make({ budgets: { maxRunSeconds: 60 } });
    expect(runExpired(run, 1000 + 60_000)).toBe(false);
    expect(runExpired(run, 1000 + 60_001)).toBe(true);
  });
});

describe("validateRun", () => {
  const errorsOf = (value: unknown) => {
    const read = validateRun(value);
    return read.ok ? [] : read.errors;
  };

  it("accepts every run the machine makes, after JSON", () => {
    const states = [make(), toCompare(), walk(toCompare(), "propose"), walk(toCompare(), "present", ["accepted", "tie"]), walk(make(), ["abandoned", "budget"])];
    for (const run of states) {
      const read = validateRun(JSON.parse(JSON.stringify(run)));
      expect(read.ok && read.value, run.phase).toEqual(run);
    }
  });

  it("refuses junk and a wrong schema", () => {
    for (const junk of [null, 0, [], {}]) expect(errorsOf(junk).length).toBeGreaterThan(0);
    expect(errorsOf({ ...make(), schema: 2 })).toContain("schema: must be 1");
  });

  it("refuses a finished run with no outcome, an unfinished one with one, and an outcome that doesn't fit its end", () => {
    expect(errorsOf({ ...make(), phase: "accepted" }).join()).toMatch(/outcome: is missing on a accepted run/);
    expect(errorsOf({ ...make(), outcome: "improved" }).join()).toMatch(/outcome: is set on a run still at capture/);
    expect(errorsOf({ ...make(), phase: "accepted", outcome: "regression" }).join()).toMatch(/isn't an outcome of a accepted run/);
  });

  it("refuses budgets above the ceiling, usage above the budget, and fewer candidates counted than listed", () => {
    expect(errorsOf({ ...make(), budgets: { ...make().budgets, maxCandidates: 999 } }).join()).toMatch(/budgets.maxCandidates/);
    expect(errorsOf({ ...make(), usage: { ...make().usage, hostedCalls: 99 } }).join()).toMatch(/usage.hostedCalls: is 99, past its budget/);
    expect(errorsOf({ ...make(), candidateIds: ["a", "b"] }).join()).toMatch(/usage.candidates: is 0, fewer than the 2 candidates/);
  });

  it("refuses an unknown phase, an empty goal, a backwards passage and a run updated before it started", () => {
    expect(errorsOf({ ...make(), phase: "daydream" }).join()).toMatch(/phase: must be one of/);
    expect(errorsOf({ ...make(), goal: "" }).join()).toMatch(/goal: must not be empty/);
    expect(errorsOf({ ...make(), passages: [{ startTick: 9, endTick: 3, why: "x" }] }).join()).toMatch(/passages\[0\]: must end after it starts/);
    expect(errorsOf({ ...make(), updatedAt: 1 }).join()).toMatch(/updatedAt: is before startedAt/);
  });

  it("never throws on junk", () => {
    for (const junk of [{ budgets: 3 }, { usage: [] }, { passages: [null] }, { workflow: 4 }, { constraints: "x" }]) expect(() => validateRun(junk)).not.toThrow();
  });
});
