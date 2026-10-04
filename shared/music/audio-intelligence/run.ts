/**
 * Mix runs (`types.ts`): one mixing task's record, kept apart from the conversation so it survives the model's
 * context being compacted. Pure: the phases a run may move through and the budgets that cap it are enforced here,
 * whatever the agent asks for ("the service enforces limits even if the agent requests more").
 *
 *   capture → inspect → hypothesise → propose → render → compare → present → accepted | discarded
 *                                       ▲                     │        │
 *                                       └──── a revision ─────┴────────┘      (any phase → abandoned)
 */
import {
  AUDIO_INTELLIGENCE_SCHEMA,
  RUN_OUTCOMES,
  RUN_PHASES,
  type BudgetKind,
  type MixRun,
  type RunBudgets,
  type RunOutcome,
  type RunPassage,
  type RunPhase,
  type RunUsage,
} from "./types.ts";
import { Problems, array, number, object, oneOf, string, stringList, toValidation, type Validation } from "./validation.ts";

/** The pilot's defaults (the plan's: three candidates, two revision rounds, passages of 10 to 20 seconds). They're a starting point, not a finding. */
export const DEFAULT_BUDGETS: RunBudgets = {
  maxCandidates: 3,
  maxRevisionRounds: 2,
  maxPassageSeconds: 20,
  maxRenderSeconds: 300,
  maxHostedCalls: 12,
  maxRunSeconds: 1800,
};

/** What no request can raise a budget past: the service's own ceiling. */
export const BUDGET_CEILINGS: RunBudgets = {
  maxCandidates: 6,
  maxRevisionRounds: 4,
  maxPassageSeconds: 30,
  maxRenderSeconds: 900,
  maxHostedCalls: 40,
  maxRunSeconds: 3600,
};

export const EMPTY_USAGE: RunUsage = { candidates: 0, revisionRounds: 0, renderSeconds: 0, hostedCalls: 0 };

const BUDGET_KEYS = Object.keys(DEFAULT_BUDGETS) as BudgetKind[];

/**
 * The budgets a request gets: its own where it's a sensible number, held to the ceiling, else the default. An
 * agent asking for more than the ceiling gets the ceiling; a nonsense value (zero, negative, NaN) gets the default.
 */
export function resolveBudgets(requested: Partial<Record<BudgetKind, unknown>> = {}): RunBudgets {
  const out = { ...DEFAULT_BUDGETS };
  for (const key of BUDGET_KEYS) {
    const value = requested[key];
    if (typeof value === "number" && Number.isFinite(value) && value > 0) out[key] = Math.min(key === "maxPassageSeconds" || key === "maxRenderSeconds" || key === "maxRunSeconds" ? value : Math.floor(value), BUDGET_CEILINGS[key]);
    if (out[key] < 1) out[key] = DEFAULT_BUDGETS[key];
  }
  return out;
}

export interface NewRun {
  id: string;
  projectId: string;
  goal: string;
  constraints?: readonly string[];
  snapshotId: string;
  budgets?: Partial<Record<BudgetKind, unknown>>;
  workflow?: MixRun["workflow"];
  now: number;
}

export function createRun(input: NewRun): MixRun {
  return {
    schema: AUDIO_INTELLIGENCE_SCHEMA,
    id: input.id,
    projectId: input.projectId,
    goal: input.goal,
    constraints: [...(input.constraints ?? [])],
    snapshotId: input.snapshotId,
    passages: [],
    workflow: input.workflow ?? null,
    evidenceIds: [],
    exampleIds: [],
    candidateIds: [],
    budgets: resolveBudgets(input.budgets),
    usage: { ...EMPTY_USAGE },
    phase: "capture",
    outcome: null,
    startedAt: input.now,
    updatedAt: input.now,
  };
}

export const TERMINAL_PHASES: readonly RunPhase[] = ["accepted", "discarded", "abandoned"];
export const isFinished = (run: Pick<MixRun, "phase">): boolean => TERMINAL_PHASES.includes(run.phase);

/** The phases a run may go to from each. A move back to `propose` is a revision. */
const NEXT: Record<RunPhase, readonly RunPhase[]> = {
  capture: ["inspect", "abandoned"],
  inspect: ["hypothesise", "abandoned"],
  hypothesise: ["propose", "abandoned"],
  propose: ["render", "abandoned"],
  render: ["compare", "abandoned"],
  compare: ["propose", "present", "abandoned"],
  present: ["propose", "accepted", "discarded", "abandoned"],
  accepted: [],
  discarded: [],
  abandoned: [],
};

export type RunStep = { ok: true; run: MixRun } | { ok: false; error: string };

/** The ways a run can end, by the phase that ends it: what each says about the result. */
const OUTCOMES: Record<"accepted" | "discarded" | "abandoned", readonly RunOutcome[]> = {
  accepted: ["improved", "tie"],
  discarded: ["no-change", "tie", "regression", "stale"],
  abandoned: ["budget", "failed", "stale", "no-change"],
};

/**
 * Moves a run to `to`. A move to a finished phase says how it ended (`outcome`); a revision (back to `propose`) uses
 * up one of the revision rounds, and is refused when they're spent. Returns the next record, or why not.
 */
export function advanceRun(run: MixRun, to: RunPhase, now: number, outcome?: RunOutcome): RunStep {
  if (!(NEXT[run.phase] as readonly RunPhase[]).includes(to)) {
    const allowed = NEXT[run.phase];
    return { ok: false, error: `Run ${run.id} is at ${run.phase}: it can't go to ${to}. ${allowed.length ? `From here: ${allowed.join(", ")}.` : "It has finished."}` };
  }
  const finishing = to === "accepted" || to === "discarded" || to === "abandoned";
  if (finishing) {
    if (!outcome) return { ok: false, error: `A run that ${to === "abandoned" ? "is abandoned" : `is ${to}`} must say how it ended: one of ${OUTCOMES[to].join(", ")}.` };
    if (!OUTCOMES[to].includes(outcome)) return { ok: false, error: `A run can't be ${to} with the outcome "${outcome}": use one of ${OUTCOMES[to].join(", ")}.` };
  } else if (outcome) {
    return { ok: false, error: `Only a run that finishes has an outcome, and ${to} doesn't finish it.` };
  }
  let usage = run.usage;
  if (to === "propose" && (run.phase === "compare" || run.phase === "present")) {
    if (usage.revisionRounds >= run.budgets.maxRevisionRounds) return { ok: false, error: `Run ${run.id} has used its ${run.budgets.maxRevisionRounds} revision rounds: present the best candidate, or finish.` };
    usage = { ...usage, revisionRounds: usage.revisionRounds + 1 };
  }
  return { ok: true, run: { ...run, phase: to, outcome: finishing ? (outcome as RunOutcome) : null, usage, updatedAt: now } };
}

const USAGE_BUDGET: Record<keyof RunUsage, BudgetKind> = {
  candidates: "maxCandidates",
  revisionRounds: "maxRevisionRounds",
  renderSeconds: "maxRenderSeconds",
  hostedCalls: "maxHostedCalls",
};

/** Spends `amount` of a budget, or says which cap it would pass. Nothing is spent on a refusal. */
export function chargeBudget(run: MixRun, kind: keyof RunUsage, amount: number, now: number): RunStep {
  if (isFinished(run)) return { ok: false, error: `Run ${run.id} has finished (${run.phase}).` };
  if (!Number.isFinite(amount) || amount < 0) return { ok: false, error: `A budget charge must be a number of zero or more, not ${amount}.` };
  const limit = run.budgets[USAGE_BUDGET[kind]];
  const spent = run.usage[kind] + amount;
  if (spent > limit) return { ok: false, error: `Run ${run.id} would use ${spent} of ${USAGE_BUDGET[kind]} (${limit}) for ${kind}: it has ${Math.max(0, limit - run.usage[kind])} left.` };
  return { ok: true, run: { ...run, usage: { ...run.usage, [kind]: spent }, updatedAt: now } };
}

/** Null when a passage of this many seconds may be rendered, else why not. */
export function passageError(run: Pick<MixRun, "id" | "budgets">, seconds: number): string | null {
  if (!Number.isFinite(seconds) || seconds <= 0) return `A passage must be longer than zero seconds, not ${seconds}.`;
  return seconds > run.budgets.maxPassageSeconds ? `A passage of ${seconds} s is longer than this run allows (${run.budgets.maxPassageSeconds} s): pick a shorter one.` : null;
}

/** The run has been going longer than its wall-clock budget. */
export const runExpired = (run: Pick<MixRun, "startedAt" | "budgets">, now: number): boolean => (now - run.startedAt) / 1000 > run.budgets.maxRunSeconds;

/** Adds a candidate, charging one of the budget. Adding the same one again costs nothing. */
export function addCandidate(run: MixRun, candidateId: string, now: number): RunStep {
  if (run.candidateIds.includes(candidateId)) return { ok: true, run };
  const charged = chargeBudget(run, "candidates", 1, now);
  return charged.ok ? { ok: true, run: { ...charged.run, candidateIds: [...run.candidateIds, candidateId] } } : charged;
}

/** Adds ids to a list of the run's, once each. */
export function addIds(run: MixRun, list: "evidenceIds" | "exampleIds", ids: readonly string[], now: number): MixRun {
  const fresh = ids.filter((id, i) => !run[list].includes(id) && ids.indexOf(id) === i);
  return fresh.length ? { ...run, [list]: [...run[list], ...fresh], updatedAt: now } : run;
}

/** Adds a passage the run will inspect, refusing one past the budget's length. */
export function addPassage(run: MixRun, passage: RunPassage, seconds: number, now: number): RunStep {
  const error = passageError(run, seconds);
  if (error) return { ok: false, error };
  if (passage.endTick <= passage.startTick) return { ok: false, error: "A passage must end after it starts." };
  return { ok: true, run: { ...run, passages: [...run.passages, { ...passage }], updatedAt: now } };
}

// ---------------------------------------------------------------------------------------------------------
// Reading one off the disk

export function validateRun(input: unknown): Validation<MixRun> {
  const p = new Problems();
  const o = object(input, "", p);
  if (o.schema !== AUDIO_INTELLIGENCE_SCHEMA) p.add("schema", `must be ${AUDIO_INTELLIGENCE_SCHEMA}`);

  const budgetsIn = object(o.budgets, "budgets", p);
  const budgets = Object.fromEntries(BUDGET_KEYS.map((key) => [key, number(budgetsIn[key], `budgets.${key}`, p, { min: 1, max: BUDGET_CEILINGS[key] })])) as unknown as RunBudgets;
  const usageIn = object(o.usage, "usage", p);
  const usage: RunUsage = {
    candidates: number(usageIn.candidates, "usage.candidates", p, { min: 0, int: true }),
    revisionRounds: number(usageIn.revisionRounds, "usage.revisionRounds", p, { min: 0, int: true }),
    renderSeconds: number(usageIn.renderSeconds, "usage.renderSeconds", p, { min: 0 }),
    hostedCalls: number(usageIn.hostedCalls, "usage.hostedCalls", p, { min: 0, int: true }),
  };
  for (const kind of Object.keys(USAGE_BUDGET) as (keyof RunUsage)[]) if (usage[kind] > budgets[USAGE_BUDGET[kind]]) p.add(`usage.${kind}`, `is ${usage[kind]}, past its budget (${budgets[USAGE_BUDGET[kind]]})`);

  const phase = oneOf(o.phase, RUN_PHASES, "phase", p);
  const outcome = o.outcome === null ? null : oneOf(o.outcome, RUN_OUTCOMES, "outcome", p);
  if (isFinished({ phase }) && outcome === null) p.add("outcome", `is missing on a ${phase} run`);
  if (!isFinished({ phase }) && outcome !== null) p.add("outcome", `is set on a run still at ${phase}`);
  if (outcome !== null && isFinished({ phase }) && !(OUTCOMES[phase as keyof typeof OUTCOMES] as readonly RunOutcome[]).includes(outcome)) p.add("outcome", `"${outcome}" isn't an outcome of a ${phase} run`);

  const candidateIds = stringList(o.candidateIds, "candidateIds", p);
  if (candidateIds.length > usage.candidates) p.add("usage.candidates", `is ${usage.candidates}, fewer than the ${candidateIds.length} candidates`);

  const workflow = o.workflow === null ? null : object(o.workflow, "workflow", p);
  const run: MixRun = {
    schema: AUDIO_INTELLIGENCE_SCHEMA,
    id: string(o.id, "id", p, { nonEmpty: true }),
    projectId: string(o.projectId, "projectId", p, { nonEmpty: true }),
    goal: string(o.goal, "goal", p, { nonEmpty: true, max: 2000 }),
    constraints: stringList(o.constraints, "constraints", p, 100),
    snapshotId: string(o.snapshotId, "snapshotId", p, { nonEmpty: true }),
    passages: array(o.passages, "passages", p, 1000).map((item, i) => {
      const x = object(item, `passages[${i}]`, p);
      const passage = { startTick: number(x.startTick, `passages[${i}].startTick`, p, { min: 0, int: true }), endTick: number(x.endTick, `passages[${i}].endTick`, p, { min: 0, int: true }), why: string(x.why, `passages[${i}].why`, p) };
      if (passage.endTick <= passage.startTick) p.add(`passages[${i}]`, "must end after it starts");
      return passage;
    }),
    workflow: workflow && { id: string(workflow.id, "workflow.id", p, { nonEmpty: true }), version: number(workflow.version, "workflow.version", p, { min: 1, int: true }) },
    evidenceIds: stringList(o.evidenceIds, "evidenceIds", p),
    exampleIds: stringList(o.exampleIds, "exampleIds", p),
    candidateIds,
    budgets,
    usage,
    phase,
    outcome,
    startedAt: number(o.startedAt, "startedAt", p, { min: 0 }),
    updatedAt: number(o.updatedAt, "updatedAt", p, { min: 0 }),
  };
  if (run.updatedAt < run.startedAt) p.add("updatedAt", "is before startedAt");
  return toValidation(p, run);
}
