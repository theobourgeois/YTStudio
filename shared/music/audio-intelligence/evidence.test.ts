import { describe, expect, it } from "vitest";
import { sha256 } from "../hash.ts";
import { createArtifact } from "./artifact.ts";
import { coveredSeconds, createEvidence, evidenceId, inspectedFraction, refOf, validateEvidence, type NewEvidence } from "./evidence.ts";
import { PRIVATE_USE, type AudioArtifact, type EvidenceReport } from "./types.ts";

const RATE = 48000;

/** A 12 s render with a 10 s passage between a 1 s lead-in and a 1 s tail. */
const vocal = (permissions = PRIVATE_USE): AudioArtifact =>
  createArtifact({
    contentSha256: sha256("vocal"),
    bytes: 100,
    role: "track-stem",
    format: { sampleRate: RATE, channels: 2, sampleFormat: "float32", frames: 12 * RATE },
    snapshotId: "snap_aaaaaaaaaaaaaaaaaaaa",
    tap: { kind: "track", id: "insert_1" },
    passage: { startTick: 0, endTick: 3840, startSeconds: 0, leadInFrames: RATE, tailFrames: RATE },
    render: null,
    derivedFrom: null,
    transforms: [],
    jobId: null,
    recordingFamilyId: null,
    permissions,
    createdAt: 1,
  });

const A = vocal();
const span = (startSeconds: number, endSeconds: number, artifactId = A.id) => ({ artifactId, startSeconds, endSeconds });

const input = (over: Partial<NewEvidence> = {}): NewEvidence => ({
  snapshotId: "snap_aaaaaaaaaaaaaaaaaaaa",
  task: "levels",
  artifactRefs: [refOf(A)],
  measurements: [
    { id: "m1", name: "peakDbfs", value: -3.2, unit: "dBFS", span: span(1, 11), channel: "all", method: { name: "sample-peak", version: "1" } },
    { id: "m2", name: "truePeakDbtp", value: null, unit: "dBTP", span: span(1, 11), channel: "all", method: { name: "true-peak", version: "1" }, note: "needs 4x oversampling, not run" },
  ],
  observations: [
    { id: "o1", source: { kind: "listener", }, claim: "the third phrase is much quieter", spans: [span(6, 8)], strength: "moderate" },
    { id: "o2", source: { kind: "hosted-perception", provider: "gemini", model: "m-1", version: "2026-10" }, claim: "sibilant at the start", spans: [span(1, 3)], strength: "weak", question: "Is it harsh?" },
  ],
  hypotheses: [{ id: "h1", text: "phrase 3 may need a gain ride rather than compression", supportedBy: ["m1", "o1"], strength: "weak" }],
  limitations: [{ code: "downmixed", text: "the hosted model heard mono", affects: ["o2"] }],
  coverage: { inspected: [span(1, 11)], unavailable: ["spectral-balance"] },
  createdAt: 5,
  ...over,
});

const report = (over: Partial<NewEvidence> = {}): EvidenceReport => createEvidence(input(over));
const errorsOf = (value: unknown, artifacts?: ReadonlyMap<string, AudioArtifact>) => {
  const read = validateEvidence(value, { artifacts });
  return read.ok ? [] : read.errors;
};
const reId = (r: EvidenceReport): EvidenceReport => ({ ...r, id: evidenceId(r) });

describe("createEvidence", () => {
  it("has the id its content gives it, whenever it was made", () => {
    expect(report().id).toMatch(/^ev_[0-9a-f]{20}$/);
    expect(report({ createdAt: 999 }).id).toBe(report().id);
    expect(report({ task: "tone" }).id).not.toBe(report().id);
  });

  it("refs an artifact by id and content hash", () => {
    expect(refOf(A)).toEqual({ id: A.id, contentSha256: A.contentSha256 });
  });
});

describe("coverage of what was listened to", () => {
  it("counts overlapping spans once, and only the named artifact's", () => {
    expect(coveredSeconds([span(0, 4), span(2, 6), span(10, 11), span(0, 99, "other")], A.id)).toBe(7);
    expect(coveredSeconds([], A.id)).toBe(0);
    expect(coveredSeconds([span(5, 5), span(7, 3)], A.id)).toBe(0);
  });

  it("is how much of the passage was inspected, the lead-in and tail not counting", () => {
    const half = report({ coverage: { inspected: [span(1, 6)], unavailable: [] } });
    expect(inspectedFraction(half, A)).toBeCloseTo(0.5);
    const everything = report({ coverage: { inspected: [span(0, 12)], unavailable: [] } });
    expect(inspectedFraction(everything, A)).toBe(1);
    const onlyLead = report({ coverage: { inspected: [span(0, 1), span(11, 12)], unavailable: [] } });
    expect(inspectedFraction(onlyLead, A)).toBe(0);
    const none = report({ coverage: { inspected: [], unavailable: [] }, measurements: [], observations: [], hypotheses: [], limitations: [] });
    expect(inspectedFraction(none, A)).toBe(0);
  });
});

describe("validateEvidence", () => {
  it("accepts what createEvidence makes, and it survives JSON", () => {
    const r = report();
    const read = validateEvidence(JSON.parse(JSON.stringify(r)));
    expect(read.ok && read.value).toEqual(r);
  });

  it("accepts a report with no findings at all, a clean 'we looked at nothing'", () => {
    const empty = report({ measurements: [], observations: [], hypotheses: [], limitations: [], coverage: { inspected: [], unavailable: ["hosted-perception"] } });
    expect(validateEvidence(empty).ok).toBe(true);
  });

  it("refuses junk, the wrong schema and a changed report", () => {
    for (const junk of [null, 1, [], "x", {}]) expect(errorsOf(junk).length).toBeGreaterThan(0);
    expect(errorsOf({ ...report(), schema: 3 })).toContain("schema: must be 1");
    expect(errorsOf({ ...report(), task: "tone" })).toContain("id: is not the hash of what the report holds");
  });

  it("makes a measurement name its method and version, and say why it has no value", () => {
    const r = report();
    const noMethod = { ...r, measurements: [{ ...r.measurements[0], method: { name: "", version: "" } }, r.measurements[1]] };
    expect(errorsOf(noMethod).join()).toMatch(/measurements\[0\].method.name: must not be empty/);
    const noWhy = { ...r, measurements: [r.measurements[0], { ...r.measurements[1], note: undefined }] };
    expect(errorsOf(noWhy)).toContain("measurements[1]: has no value and doesn't say why");
  });

  it("refuses a non-finite measurement value", () => {
    const r = report();
    expect(errorsOf({ ...r, measurements: [{ ...r.measurements[0], value: Infinity }] }).join()).toMatch(/measurements\[0\].value: must be a finite number/);
    expect(errorsOf({ ...r, measurements: [{ ...r.measurements[0], value: "loud" }] }).join()).toMatch(/measurements\[0\].value/);
  });

  it("refuses a span of an artifact the report doesn't name, or that ends before it starts", () => {
    const r = report();
    expect(errorsOf({ ...r, measurements: [{ ...r.measurements[0], span: span(1, 2, "art_other") }, r.measurements[1]] }).join()).toMatch(/art_other isn't in artifactRefs/);
    expect(errorsOf({ ...r, observations: [{ ...r.observations[0], spans: [span(5, 5)] }, r.observations[1]] }).join()).toMatch(/must end after it starts/);
  });

  it("makes an observation say what it's about, and a hosted one say which build said it", () => {
    const r = report();
    expect(errorsOf({ ...r, observations: [{ ...r.observations[0], spans: [] }, r.observations[1]] }).join()).toMatch(/must say which part of the audio/);
    const unnamed = { ...r.observations[1], source: { kind: "hosted-perception" as const, provider: "gemini" } };
    expect(errorsOf({ ...r, observations: [r.observations[0], unnamed] }).join()).toMatch(/must name its provider, model and version/);
  });

  it("allows only qualitative strengths, never a made-up probability", () => {
    const r = report();
    expect(errorsOf({ ...r, observations: [{ ...r.observations[0], strength: 0.93 }, r.observations[1]] }).join()).toMatch(/strength: must be one of weak, moderate, strong/);
    expect(errorsOf({ ...r, hypotheses: [{ ...r.hypotheses[0], strength: "certain" }] }).join()).toMatch(/hypotheses\[0\].strength/);
  });

  it("refuses a hypothesis resting on nothing, or on something that isn't in the report", () => {
    const r = report();
    expect(errorsOf({ ...r, hypotheses: [{ ...r.hypotheses[0], supportedBy: [] }] }).join()).toMatch(/must name the measurements or observations/);
    expect(errorsOf({ ...r, hypotheses: [{ ...r.hypotheses[0], supportedBy: ["m9"] }] }).join()).toMatch(/m9 is neither a measurement nor an observation/);
    // A hypothesis can't rest on another hypothesis: guesses don't hold each other up.
    expect(errorsOf({ ...r, hypotheses: [r.hypotheses[0], { id: "h2", text: "x", supportedBy: ["h1"], strength: "weak" }] }).join()).toMatch(/h1 is neither/);
  });

  it("refuses two findings with the same id, across lists", () => {
    const r = report();
    expect(errorsOf({ ...r, observations: [{ ...r.observations[0], id: "m1" }, r.observations[1]] }).join()).toMatch(/"m1" appears twice/);
  });

  it("refuses a limitation about something not in the report", () => {
    const r = report();
    expect(errorsOf({ ...r, limitations: [{ code: "x", text: "y", affects: ["o9"] }] }).join()).toMatch(/o9 isn't in this report/);
    expect(validateEvidence(reId({ ...r, limitations: [{ code: "x", text: "y", affects: ["h1"] }] })).ok).toBe(true);
  });

  it("won't let findings stand with nothing said about what was inspected", () => {
    const r = report();
    expect(errorsOf({ ...r, coverage: { inspected: [], unavailable: [] } }).join()).toMatch(/must list what was inspected/);
  });

  it("drops fields it doesn't know", () => {
    const read = validateEvidence({ ...report(), verdict: "great mix" });
    expect(read.ok && "verdict" in read.value).toBe(false);
  });

  it("never throws on junk", () => {
    for (const junk of [{ measurements: [null] }, { observations: [{ source: 3 }] }, { coverage: 1 }, { artifactRefs: [{}] }, { hypotheses: "x" }]) expect(() => validateEvidence(junk)).not.toThrow();
  });
});

describe("validateEvidence against the artifacts", () => {
  const registry = (...artifacts: AudioArtifact[]) => new Map(artifacts.map((a) => [a.id, a]));

  it("is fine when the artifacts are there and agree, hosted opinions allowed", () => {
    const allowed = vocal({ ...PRIVATE_USE, hostedAnalysis: true });
    const r = createEvidence(
      input({
        artifactRefs: [refOf(allowed)],
        measurements: [{ id: "m1", name: "peakDbfs", value: -3, unit: "dBFS", span: span(1, 11, allowed.id), channel: "all", method: { name: "sample-peak", version: "1" } }],
        observations: [{ id: "o2", source: { kind: "hosted-perception", provider: "g", model: "m", version: "1" }, claim: "x", spans: [span(1, 3, allowed.id)], strength: "weak" }],
        hypotheses: [],
        limitations: [],
        coverage: { inspected: [span(1, 11, allowed.id)], unavailable: [] },
      }),
    );
    expect(errorsOf(r, registry(allowed))).toEqual([]);
  });

  it("refuses a report about an artifact that isn't registered", () => {
    expect(errorsOf(report(), registry()).join()).toMatch(/isn't registered/);
  });

  it("refuses one whose audio changed under it: the hash is not the artifact's", () => {
    const r = report();
    const changed = { ...A, contentSha256: sha256("different") };
    expect(errorsOf(r, registry(changed)).join()).toMatch(/the audio changed under the report/);
  });

  it("refuses a span past the end of the audio", () => {
    const r = report({ coverage: { inspected: [span(1, 99)], unavailable: [] } });
    expect(errorsOf(r, registry(A)).join()).toMatch(/past the end of/);
  });

  it("refuses a hosted observation about audio that may not leave this computer", () => {
    // `report()` has a hosted observation (o2) about A, which is private.
    const errors = errorsOf(report(), registry(A));
    expect(errors.join()).toMatch(/observations\[1\].*sent to a hosted service/);
  });

  it("leaves a listener's or local model's observation alone on private audio", () => {
    const r = report({ observations: [{ id: "o1", source: { kind: "listener" }, claim: "quiet", spans: [span(6, 8)], strength: "weak" }], hypotheses: [], limitations: [] });
    expect(errorsOf(r, registry(A))).toEqual([]);
  });
});
