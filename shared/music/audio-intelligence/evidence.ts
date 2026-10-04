/**
 * Evidence reports (`types.ts`): what the assistant is told about audio, in lists that stay apart. A measurement
 * is a number from a named method; an observation is somebody's or something's opinion about what's audible; a
 * hypothesis says what follows and rests on the others. A report that says nothing is wrong says only that
 * nothing was found in what it looked at, so it must say what that was.
 */
import { useError } from "./artifact.ts";
import {
  AUDIO_INTELLIGENCE_SCHEMA,
  EVIDENCE_STRENGTHS,
  type ArtifactRef,
  type ArtifactSpan,
  type AudioArtifact,
  type EvidenceReport,
  type Hypothesis,
  type Limitation,
  type Measurement,
  type Observation,
} from "./types.ts";
import { passageSeconds } from "./artifact.ts";
import {
  Problems,
  array,
  contentId,
  hash,
  nullableNumber,
  number,
  object,
  oneOf,
  optionalString,
  string,
  stringList,
  toValidation,
  unique,
  type Validation,
} from "./validation.ts";

const NOT_IDENTITY = ["createdAt"] as const;

export const evidenceId = (report: Omit<EvidenceReport, "id">): string => contentId("ev", report, NOT_IDENTITY);

export type NewEvidence = Omit<EvidenceReport, "schema" | "id">;

/** Makes the record, with the id its content gives it. */
export function createEvidence(input: NewEvidence): EvidenceReport {
  const record = { schema: AUDIO_INTELLIGENCE_SCHEMA, ...input } as Omit<EvidenceReport, "id">;
  return { ...record, id: evidenceId(record) };
}

/** An artifact as a report refers to it. */
export const refOf = (artifact: Pick<AudioArtifact, "id" | "contentSha256">): ArtifactRef => ({ id: artifact.id, contentSha256: artifact.contentSha256 });

/** Seconds of `artifactId`'s audio covered by `spans`, overlaps counted once. */
export function coveredSeconds(spans: readonly ArtifactSpan[], artifactId: string): number {
  const mine = spans.filter((s) => s.artifactId === artifactId && s.endSeconds > s.startSeconds).sort((a, b) => a.startSeconds - b.startSeconds);
  let total = 0;
  let end = -Infinity;
  for (const span of mine) {
    const from = Math.max(span.startSeconds, end);
    if (span.endSeconds > from) total += span.endSeconds - from;
    end = Math.max(end, span.endSeconds);
  }
  return total;
}

/**
 * How much of an artifact's passage the report listened to or measured, 0..1: what makes "nothing found" mean
 * something. The lead-in and the tail aren't the passage; spans over them don't count.
 */
export function inspectedFraction(report: Pick<EvidenceReport, "coverage">, artifact: Pick<AudioArtifact, "id" | "format" | "passage">): number {
  const length = passageSeconds(artifact);
  if (length <= 0) return 0;
  const lead = artifact.passage ? artifact.passage.leadInFrames / artifact.format.sampleRate : 0;
  const clipped = report.coverage.inspected
    .filter((s) => s.artifactId === artifact.id)
    .map((s) => ({ ...s, startSeconds: Math.max(s.startSeconds, lead), endSeconds: Math.min(s.endSeconds, lead + length) }));
  return Math.min(1, coveredSeconds(clipped, artifact.id) / length);
}

// ---------------------------------------------------------------------------------------------------------
// Reading one off the disk

function readSpan(input: unknown, at: string, p: Problems): ArtifactSpan {
  const o = object(input, at, p);
  const span = {
    artifactId: string(o.artifactId, `${at}.artifactId`, p, { nonEmpty: true }),
    startSeconds: number(o.startSeconds, `${at}.startSeconds`, p, { min: 0 }),
    endSeconds: number(o.endSeconds, `${at}.endSeconds`, p, { min: 0 }),
  };
  if (span.endSeconds <= span.startSeconds) p.add(at, "must end after it starts");
  return span;
}

/** What else a report is checked against, when the caller has it: the artifacts it refers to, by id. */
export interface EvidenceContext {
  artifacts?: ReadonlyMap<string, AudioArtifact>;
}

/**
 * Checks a report: well-formed, its references all resolve inside it, every claim names its method or its source,
 * and (given the artifacts) its spans fall inside their audio and no hosted opinion rests on audio that may not leave
 * this computer.
 */
export function validateEvidence(input: unknown, context: EvidenceContext = {}): Validation<EvidenceReport> {
  const p = new Problems();
  const o = object(input, "", p);
  if (o.schema !== AUDIO_INTELLIGENCE_SCHEMA) p.add("schema", `must be ${AUDIO_INTELLIGENCE_SCHEMA}`);

  const artifactRefs: ArtifactRef[] = array(o.artifactRefs, "artifactRefs", p, 1000).map((item, i) => {
    const r = object(item, `artifactRefs[${i}]`, p);
    return { id: string(r.id, `artifactRefs[${i}].id`, p, { nonEmpty: true }), contentSha256: hash(r.contentSha256, `artifactRefs[${i}].contentSha256`, p) };
  });
  unique(artifactRefs, (r) => r.id, "artifactRefs", p);
  const known = new Set(artifactRefs.map((r) => r.id));

  /** A span must be of an artifact the report names. */
  const span = (input: unknown, at: string): ArtifactSpan => {
    const s = readSpan(input, at, p);
    if (s.artifactId && !known.has(s.artifactId)) p.add(`${at}.artifactId`, `${s.artifactId} isn't in artifactRefs`);
    return s;
  };

  const measurements: Measurement[] = array(o.measurements, "measurements", p).map((item, i) => {
    const at = `measurements[${i}]`;
    const m = object(item, at, p);
    const method = object(m.method, `${at}.method`, p);
    const value = nullableNumber(m.value, `${at}.value`, p);
    const note = optionalString(m.note, `${at}.note`, p);
    if (value === null && !note) p.add(at, "has no value and doesn't say why");
    return {
      id: string(m.id, `${at}.id`, p, { nonEmpty: true }),
      name: string(m.name, `${at}.name`, p, { nonEmpty: true }),
      value,
      unit: string(m.unit, `${at}.unit`, p),
      span: span(m.span, `${at}.span`),
      channel: string(m.channel, `${at}.channel`, p, { nonEmpty: true }),
      method: { name: string(method.name, `${at}.method.name`, p, { nonEmpty: true }), version: string(method.version, `${at}.method.version`, p, { nonEmpty: true }) },
      ...(note === undefined ? {} : { note }),
    };
  });

  const observations: Observation[] = array(o.observations, "observations", p).map((item, i) => {
    const at = `observations[${i}]`;
    const x = object(item, at, p);
    const source = object(x.source, `${at}.source`, p);
    const kind = oneOf(source.kind, ["hosted-perception", "listener", "model"], `${at}.source.kind`, p);
    const provider = optionalString(source.provider, `${at}.source.provider`, p);
    const model = optionalString(source.model, `${at}.source.model`, p);
    const version = optionalString(source.version, `${at}.source.version`, p);
    // An opinion from a service can't be told from another build's unless the build is named.
    if (kind === "hosted-perception" && !(provider && model && version)) p.add(`${at}.source`, "a hosted observation must name its provider, model and version");
    const spans = array(x.spans, `${at}.spans`, p, 1000).map((s, j) => span(s, `${at}.spans[${j}]`));
    if (spans.length === 0) p.add(`${at}.spans`, "must say which part of the audio it is about");
    const question = optionalString(x.question, `${at}.question`, p);
    return {
      id: string(x.id, `${at}.id`, p, { nonEmpty: true }),
      source: { kind, ...(provider === undefined ? {} : { provider }), ...(model === undefined ? {} : { model }), ...(version === undefined ? {} : { version }) },
      claim: string(x.claim, `${at}.claim`, p, { nonEmpty: true, max: 2000 }),
      spans,
      strength: oneOf(x.strength, EVIDENCE_STRENGTHS, `${at}.strength`, p),
      ...(question === undefined ? {} : { question }),
    };
  });

  const ids = [...measurements.map((m) => m.id), ...observations.map((x) => x.id)];
  const hypothesisIn = array(o.hypotheses, "hypotheses", p);
  const hypotheses: Hypothesis[] = hypothesisIn.map((item, i) => {
    const at = `hypotheses[${i}]`;
    const h = object(item, at, p);
    const supportedBy = stringList(h.supportedBy, `${at}.supportedBy`, p);
    // A guess nothing measured or heard supports is a guess.
    if (supportedBy.length === 0) p.add(`${at}.supportedBy`, "must name the measurements or observations it rests on");
    for (const id of supportedBy) if (!ids.includes(id)) p.add(`${at}.supportedBy`, `${id} is neither a measurement nor an observation of this report`);
    return { id: string(h.id, `${at}.id`, p, { nonEmpty: true }), text: string(h.text, `${at}.text`, p, { nonEmpty: true, max: 2000 }), supportedBy, strength: oneOf(h.strength, EVIDENCE_STRENGTHS, `${at}.strength`, p) };
  });
  unique([...measurements.map((m) => m.id), ...observations.map((x) => x.id), ...hypotheses.map((h) => h.id)], (id) => id, "ids", p);

  const limitations: Limitation[] = array(o.limitations, "limitations", p).map((item, i) => {
    const at = `limitations[${i}]`;
    const l = object(item, at, p);
    const affects = stringList(l.affects, `${at}.affects`, p);
    for (const id of affects) if (!ids.includes(id) && !hypotheses.some((h) => h.id === id)) p.add(`${at}.affects`, `${id} isn't in this report`);
    return { code: string(l.code, `${at}.code`, p, { nonEmpty: true }), text: string(l.text, `${at}.text`, p, { nonEmpty: true }), affects };
  });

  const cov = object(o.coverage, "coverage", p);
  const inspected = array(cov.inspected, "coverage.inspected", p, 10_000).map((s, i) => span(s, `coverage.inspected[${i}]`));
  if (inspected.length === 0 && (measurements.length > 0 || observations.length > 0)) p.add("coverage.inspected", "must list what was inspected: a finding without it can't be told from a look at the whole");

  const report: EvidenceReport = {
    schema: AUDIO_INTELLIGENCE_SCHEMA,
    id: string(o.id, "id", p, { nonEmpty: true }),
    snapshotId: o.snapshotId === null ? null : string(o.snapshotId, "snapshotId", p, { nonEmpty: true }),
    task: string(o.task, "task", p, { nonEmpty: true }),
    artifactRefs,
    measurements,
    observations,
    hypotheses,
    limitations,
    coverage: { inspected, unavailable: stringList(cov.unavailable, "coverage.unavailable", p) },
    createdAt: number(o.createdAt, "createdAt", p, { min: 0 }),
  };

  if (context.artifacts) checkAgainstArtifacts(report, context.artifacts, p);
  if (!p.any && report.id !== evidenceId(report)) p.add("id", "is not the hash of what the report holds");
  return toValidation(p, report);
}

/** What only the artifacts can say: the hashes agree, spans are inside the audio, and hosted opinions were allowed. */
function checkAgainstArtifacts(report: EvidenceReport, artifacts: ReadonlyMap<string, AudioArtifact>, p: Problems) {
  for (const [i, ref] of report.artifactRefs.entries()) {
    const artifact = artifacts.get(ref.id);
    if (!artifact) p.add(`artifactRefs[${i}]`, `artifact ${ref.id} isn't registered`);
    else if (artifact.contentSha256 !== ref.contentSha256) p.add(`artifactRefs[${i}].contentSha256`, `is not artifact ${ref.id}'s: the audio changed under the report`);
  }
  const inside = (s: ArtifactSpan, at: string) => {
    const artifact = artifacts.get(s.artifactId);
    if (!artifact) return;
    const length = artifact.format.frames / artifact.format.sampleRate;
    if (s.endSeconds > length + 1e-9) p.add(at, `ends at ${s.endSeconds} s, past the end of ${s.artifactId} (${length} s)`);
  };
  report.measurements.forEach((m, i) => inside(m.span, `measurements[${i}].span`));
  report.observations.forEach((x, i) => x.spans.forEach((s, j) => inside(s, `observations[${i}].spans[${j}]`)));
  report.coverage.inspected.forEach((s, i) => inside(s, `coverage.inspected[${i}]`));
  report.observations.forEach((x, i) => {
    if (x.source.kind !== "hosted-perception") return;
    for (const s of x.spans) {
      const artifact = artifacts.get(s.artifactId);
      const error = artifact && useError(artifact, "hostedAnalysis");
      if (error) p.add(`observations[${i}]`, error);
    }
  });
}
