import type { ReferenceRecord } from "../../../shared/music/mix-reference.ts";
import { createMixExample, type DecisionExample } from "../../../shared/music/audio-intelligence/examples.ts";
import { hashJson } from "../../../shared/music/hash.ts";
import { isObject } from "../../storage.ts";

/** Bridge the Slice A data-quality subset into D without certifying units, intent or licensing. */
export function mixParamsExample(input: unknown, sourceSha256: string): DecisionExample {
  if (!isObject(input) || typeof input.id !== "string" || !/^mxp_[a-f0-9]+$/.test(input.id) || typeof input.recordingFamilyId !== "string" || !isObject(input.source) || !isObject(input.nativeValues) || !isObject(input.eligibility) || input.unitStatus !== "unverified" || input.eligibility.retrievalDisplay !== true || input.eligibility.executableProposal !== false || input.eligibility.training !== false || !Array.isArray(input.eligibility.reasons) || !Array.isArray(input.missing) || typeof input.plugin !== "string" || !["leadVocal", "backingVocal", "other"].includes(String(input.role))) throw new Error("Expected a Slice A reviewed MixParams record.");
  const r = input as unknown as ReferenceRecord;
  for (const key of ["song", "mix", "track"] as const) if (typeof r.source[key] !== "string" || !r.source[key].trim()) throw new Error("Invalid MixParams source identity.");
  if (r.source.genre !== null && typeof r.source.genre !== "string") throw new Error("Invalid MixParams genre.");
  if (r.missing.some(x => typeof x !== "string") || r.eligibility.reasons.some(x => typeof x !== "string")) throw new Error("Invalid MixParams caveats.");
  return createMixExample({ kind: "decision", title: `${r.source.song} / ${r.source.mix} / ${r.source.track}`, role: r.role, genre: r.source.genre, goal: null,
    recordingFamilies: [r.recordingFamilyId], provenance: [{ sourceId: r.id, sha256: sourceSha256, locator: `MixParams:${r.source.song}/${r.source.mix}/${r.source.track}#${r.source.chainIndex}`, method: "Slice A reviewed data-quality subset; annotated controls" }],
    permissions: { localAnalysis: true, retrievalDisplay: true, hostedAnalysis: false, training: false },
    review: { reviewer: "Slice A data-quality selection", note: "Reviewed for annotation completeness only; no listening quality, physical units or engineer intent certified." },
    engineer: null, sessionId: null, chain: [{ plugin: r.plugin, version: null, controls: Object.values(r.nativeValues).map(v => ({ name: v.sourceKey, value: v.value, unit: null, unitStatus: "unverified", readability: v.readability })) }],
    routing: null, automation: null, outcomeArtifactIds: [],
    missing: [...r.missing, "engineer", "goal", "plugin version", "source/output audio", "routing", "automation", "verified units"],
    limitations: [...r.eligibility.reasons, "Reference display only; no executable proposal or training permission.", `Source-record content hash: ${hashJson(input)}`],
  }) as DecisionExample;
}
