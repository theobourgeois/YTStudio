/** Reviewed reference material is data, never executable workflow instructions. */
import { hashJson } from "../hash.ts";
import { PRIVATE_USE, PARAMETER_READABILITY, type ParameterReadability, type UsePermissions } from "./types.ts";
import { Problems, array, boolean, hash, nullableNumber, object, oneOf, string, stringList } from "./validation.ts";

export const EXAMPLE_KINDS = ["effect", "decision", "preference"] as const;
export type ExampleKind = typeof EXAMPLE_KINDS[number];
export interface ExampleControl {
  name: string;
  value: number | string | boolean | number[] | null;
  unit: string | null;
  unitStatus: "verified" | "unverified";
  readability: ParameterReadability;
}
export interface ExampleSource { sourceId: string; sha256: string; locator: string; method: string }
interface ExampleBase {
  schema: 1; id: string; kind: ExampleKind;
  title: string; role: string; genre: string | null; goal: string | null;
  recordingFamilies: string[]; provenance: ExampleSource[];
  permissions: UsePermissions;
  /** Review of data fidelity/use, not proof that its settings sound good. */
  review: { reviewer: string; note: string } | null;
  missing: string[]; limitations: string[];
}
export interface EffectExample extends ExampleBase {
  kind: "effect";
  inputArtifactId: string; outputArtifactId: string;
  plugin: { name: string; version: string | null; stateSha256: string | null };
  controls: ExampleControl[]; fixedControls: ExampleControl[];
  alignment: { reviewed: boolean; offsetSeconds: number | null; gainDifferenceDb: number | null; tapPoint: string | null };
  inputLevelDbfs: number | null;
}
export interface DecisionExample extends ExampleBase {
  kind: "decision";
  engineer: string | null; sessionId: string | null;
  chain: { plugin: string; version: string | null; controls: ExampleControl[] }[];
  routing: string | null; automation: string | null;
  outcomeArtifactIds: string[];
}
export interface PreferenceExample extends ExampleBase {
  kind: "preference";
  candidates: { id: string; snapshotId: string; settingsSha256: string; artifactId: string }[];
  anonymizedOrder: string[];
  levelMatchMethod: string | null;
  judge: string; choice: string | "tie" | "uncertain";
  reason: string | null; listeningEnvironment: string | null;
}
export type MixExample = EffectExample | DecisionExample | PreferenceExample;
export type ExampleInput = MixExample extends infer E ? E extends MixExample ? Omit<E, "schema" | "id"> : never : never;
export function createMixExample(input: ExampleInput): MixExample {
  const content = { ...input, schema: 1 as const };
  Reflect.deleteProperty(content, "id");
  return parseMixExample({ ...content, id: `ex_${hashJson(content).slice(0, 20)}` });
}
export function parseMixExample(input: unknown): MixExample {
  const p = new Problems(), o = object(input, "example", p);
  const text = (v: unknown, path: string) => string(v, path, p, { nonEmpty: true, max: 2000 });
  const nullableText = (v: unknown, path: string) => v === null ? null : text(v, path);
  const list = (v: unknown, path: string) => array(v, path, p, 100).map((x, i) => text(x, `${path}[${i}]`));
  const permissions = object(o.permissions, "permissions", p);
  const review = o.review === null ? null : object(o.review, "review", p);
  const base = {
    schema: 1 as const, kind: oneOf(o.kind, EXAMPLE_KINDS, "kind", p),
    title: text(o.title, "title"), role: text(o.role, "role"), genre: nullableText(o.genre, "genre"), goal: nullableText(o.goal, "goal"),
    recordingFamilies: list(o.recordingFamilies, "recordingFamilies"),
    provenance: array(o.provenance, "provenance", p, 100).map((v, i) => { const s = object(v, `provenance[${i}]`, p); return { sourceId: text(s.sourceId, "sourceId"), sha256: hash(s.sha256, "sha256", p), locator: text(s.locator, "locator"), method: text(s.method, "method") }; }),
    permissions: Object.fromEntries(Object.keys(PRIVATE_USE).map(k => [k, boolean(permissions[k], `permissions.${k}`, p)])) as unknown as UsePermissions,
    review: review ? { reviewer: text(review.reviewer, "review.reviewer"), note: text(review.note, "review.note") } : null,
    missing: list(o.missing, "missing"), limitations: list(o.limitations, "limitations"),
  };
  if (o.schema !== 1) p.add("schema", "must be 1");
  if (!base.recordingFamilies.length || !base.provenance.length) p.add("provenance", "source provenance and recording families are required");
  const controls = (value: unknown, path: string): ExampleControl[] => array(value, path, p, 200).map((v, i) => {
    const c = object(v, `${path}[${i}]`, p), scalar = c.value;
    if (!(scalar === null || typeof scalar === "boolean" || (typeof scalar === "number" && Number.isFinite(scalar)) || (typeof scalar === "string" && scalar.length <= 2000) || (Array.isArray(scalar) && scalar.length <= 100 && scalar.every(x => typeof x === "number" && Number.isFinite(x))))) p.add(path, "invalid native value");
    const unit = nullableText(c.unit, `${path}.unit`), unitStatus = oneOf(c.unitStatus, ["verified", "unverified"] as const, `${path}.unitStatus`, p);
    if (unitStatus === "verified" && unit === null) p.add(path, "verified units need a declared unit (use 'unitless' for ratios)");
    return { name: text(c.name, `${path}.name`), value: scalar as ExampleControl["value"], unit, unitStatus, readability: oneOf(c.readability, PARAMETER_READABILITY, `${path}.readability`, p) };
  });
  let content: Omit<MixExample, "id">;
  if (base.kind === "effect") {
    const plugin = object(o.plugin, "plugin", p), alignment = object(o.alignment, "alignment", p);
    content = { ...base, kind: "effect", inputArtifactId: text(o.inputArtifactId, "inputArtifactId"), outputArtifactId: text(o.outputArtifactId, "outputArtifactId"),
      plugin: { name: text(plugin.name, "plugin.name"), version: nullableText(plugin.version, "plugin.version"), stateSha256: plugin.stateSha256 === null ? null : hash(plugin.stateSha256, "plugin.stateSha256", p) },
      controls: controls(o.controls, "controls"), fixedControls: controls(o.fixedControls, "fixedControls"),
      alignment: { reviewed: boolean(alignment.reviewed, "alignment.reviewed", p), offsetSeconds: nullableNumber(alignment.offsetSeconds, "offsetSeconds", p), gainDifferenceDb: nullableNumber(alignment.gainDifferenceDb, "gainDifferenceDb", p), tapPoint: nullableText(alignment.tapPoint, "tapPoint") },
      inputLevelDbfs: nullableNumber(o.inputLevelDbfs, "inputLevelDbfs", p),
    } as Omit<EffectExample, "id">;
  } else if (base.kind === "decision") {
    content = { ...base, kind: "decision", engineer: nullableText(o.engineer, "engineer"), sessionId: nullableText(o.sessionId, "sessionId"),
      chain: array(o.chain, "chain", p, 100).map((v, i) => { const c = object(v, `chain[${i}]`, p); return { plugin: text(c.plugin, "chain.plugin"), version: nullableText(c.version, "chain.version"), controls: controls(c.controls, "chain.controls") }; }),
      routing: nullableText(o.routing, "routing"), automation: nullableText(o.automation, "automation"), outcomeArtifactIds: list(o.outcomeArtifactIds, "outcomeArtifactIds"),
    } as Omit<DecisionExample, "id">;
  } else {
    const candidates = array(o.candidates, "candidates", p, 20).map(v => { const c = object(v, "candidate", p); return { id: text(c.id, "candidate.id"), snapshotId: text(c.snapshotId, "candidate.snapshotId"), settingsSha256: hash(c.settingsSha256, "candidate.settingsSha256", p), artifactId: text(c.artifactId, "candidate.artifactId") }; });
    const anonymizedOrder = list(o.anonymizedOrder, "anonymizedOrder"), choice = text(o.choice, "choice");
    if (candidates.length < 2 || new Set(candidates.map(c => c.id)).size !== candidates.length || anonymizedOrder.length !== candidates.length || new Set(anonymizedOrder).size !== candidates.length || anonymizedOrder.some(id => !candidates.some(c => c.id === id)) || !["tie", "uncertain", ...candidates.map(c => c.id)].includes(choice)) p.add("candidates", "require distinct candidates, a complete anonymous order and a valid choice");
    content = { ...base, kind: "preference", candidates, anonymizedOrder, levelMatchMethod: nullableText(o.levelMatchMethod, "levelMatchMethod"), judge: text(o.judge, "judge"), choice, reason: nullableText(o.reason, "reason"), listeningEnvironment: nullableText(o.listeningEnvironment, "listeningEnvironment") } as Omit<PreferenceExample, "id">;
  }
  const id = `ex_${hashJson(content).slice(0, 20)}`;
  if (o.id !== id) p.add("id", "does not match the content");
  if (p.any) throw new Error(p.list.join("; "));
  return { ...content, id } as MixExample;
}

export interface ExampleQuery { query?: string; kind?: ExampleKind; role?: string; plugin?: string; goal?: string; genre?: string; purpose?: "reference" | "effect-comparison" | "preference"; limit?: number }
export function exampleEligibility(e: MixExample, purpose: ExampleQuery["purpose"] = "reference") {
  const reasons: string[] = [];
  if (!e.permissions.retrievalDisplay) reasons.push("Retrieval/display permission is absent.");
  if (!e.review) reasons.push("Record has not been reviewed.");
  if (purpose === "effect-comparison" && (e.kind !== "effect" || !e.alignment.reviewed || e.alignment.offsetSeconds === null || e.alignment.gainDifferenceDb === null || e.alignment.tapPoint === null)) reasons.push("A reviewed aligned input/output pair, gain difference and known tap point are required.");
  if (purpose === "preference" && (e.kind !== "preference" || !e.levelMatchMethod || !e.listeningEnvironment)) reasons.push("Reviewed level matching and listening context are required.");
  return { eligible: reasons.length === 0, reasons, executableProposal: false as const };
}
export function searchMixExamples(records: readonly MixExample[], q: ExampleQuery) {
  const lower = (s: string) => s.toLocaleLowerCase();
  const words = lower(q.query ?? "").split(/\W+/).filter(Boolean);
  const results = records.flatMap(example => {
    const eligibility = exampleEligibility(example, q.purpose);
    if (!eligibility.eligible || (q.kind && example.kind !== q.kind) || (q.role && lower(example.role) !== lower(q.role)) || (q.goal && lower(example.goal ?? "") !== lower(q.goal))) return [];
    const plugins = example.kind === "effect" ? [example.plugin.name] : example.kind === "decision" ? example.chain.map(c => c.plugin) : [];
    if (q.plugin && !plugins.some(p => lower(p).includes(lower(q.plugin!)))) return [];
    const text = lower([example.title, example.role, example.goal, example.genre, ...plugins].join(" "));
    const score = words.reduce((n, word) => n + Number(text.includes(word)), 0);
    if (words.length && !score) return [];
    const genreMatch = !q.genre ? "unspecified" : lower(example.genre ?? "") === lower(q.genre) ? "exact" : "weak";
    return [{ example, eligibility, relevance: { score: score + Number(genreMatch === "exact"), genreMatch, limitations: genreMatch === "weak" ? ["Genre differs or is unknown; applicability is limited."] : [] } }];
  });
  return results.sort((a, b) => b.relevance.score - a.relevance.score || a.example.id.localeCompare(b.example.id)).slice(0, q.limit ?? 5);
}

export function parseExampleQuery(input: Record<string, unknown>): ExampleQuery {
  const q: ExampleQuery = {};
  for (const key of ["query", "role", "plugin", "goal", "genre"] as const) if (input[key] !== undefined) {
    if (typeof input[key] !== "string" || input[key].length > 500 || !input[key].trim()) throw new Error(`Invalid example ${key}.`);
    q[key] = input[key].trim();
  }
  if (input.kind !== undefined) { if (!(EXAMPLE_KINDS as readonly unknown[]).includes(input.kind)) throw new Error("Invalid example kind."); q.kind = input.kind as ExampleKind; }
  if (input.purpose !== undefined) { if (!["reference", "effect-comparison", "preference"].includes(String(input.purpose))) throw new Error("Invalid example purpose."); q.purpose = input.purpose as ExampleQuery["purpose"]; }
  if (input.limit !== undefined) { if (!Number.isSafeInteger(input.limit) || Number(input.limit) < 1 || Number(input.limit) > 5) throw new Error("Example limit must be 1–5."); q.limit = Number(input.limit); }
  return q;
}

export interface EngineerProfile {
  schema: 1; id: string; name: string; reviewedBy: string;
  tendencies: { claim: string; exampleIds: string[]; applicability: string; exceptions: string[] }[];
  limitations: string[];
}
export function createEngineerProfile(input: Omit<EngineerProfile, "id" | "schema">): EngineerProfile {
  const content = { ...input, schema: 1 as const };
  return parseEngineerProfile({ ...content, id: `profile_${hashJson(content).slice(0, 20)}` });
}
export function parseEngineerProfile(input: unknown): EngineerProfile {
  const p = new Problems(), o = object(input, "profile", p);
  const text = (v: unknown, path: string) => string(v, path, p, { nonEmpty: true, max: 2000 });
  const content = { schema: 1 as const, name: text(o.name, "name"), reviewedBy: text(o.reviewedBy, "reviewedBy"),
    tendencies: array(o.tendencies, "tendencies", p, 30).map(v => { const t = object(v, "tendency", p); const exampleIds = stringList(t.exampleIds, "exampleIds", p, 30); if (!exampleIds.length || exampleIds.some(id => !/^ex_[a-f0-9]{20}$/.test(id))) p.add("exampleIds", "reviewed example ids are required"); return { claim: text(t.claim, "claim"), exampleIds, applicability: text(t.applicability, "applicability"), exceptions: stringList(t.exceptions, "exceptions", p, 30) }; }),
    limitations: stringList(o.limitations, "limitations", p, 30) };
  const id = `profile_${hashJson(content).slice(0, 20)}`;
  if (o.schema !== 1 || o.id !== id) p.add("id", "invalid schema or content identity");
  if (!content.tendencies.length) p.add("tendencies", "must cite at least one supported tendency");
  if (p.any) throw new Error(p.list.join("; "));
  return { ...content, id };
}
