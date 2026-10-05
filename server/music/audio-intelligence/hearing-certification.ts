import fs from "node:fs/promises";
import { evaluateHearing, parseHearingCertification, type HearingCertification } from "../../../shared/music/audio-intelligence/hearing-benchmark.ts";
import type { PerceptionAdapter, PerceptionInput, PerceptionResult } from "./perception.ts";
import { HEARING_PROMPT_VERSION } from "./perception.ts";

/** Operator-controlled local certification, never writable through assistant tools. */
export class CertifiedPerception implements PerceptionAdapter {
  constructor(private readonly adapter: PerceptionAdapter, private readonly certification: HearingCertification) {}
  capabilities() {
    const c = this.adapter.capabilities(), identity = this.certification.evaluation.identity;
    const matches = c.provider === identity.provider && c.model === identity.model && c.adapterVersion === identity.adapterVersion && c.destination === identity.destination && identity.promptVersion === HEARING_PROMPT_VERSION;
    return { ...c, verifiedTasks: matches ? evaluateHearing(this.certification.evaluation).filter(v => v.passed).map(v => v.task) : [],
      unavailable: [...c.unavailable, ...(!matches ? ["Hearing certification does not match the configured provider/model/prompt."] : [])] };
  }
  async perceive(input: PerceptionInput): Promise<PerceptionResult> { return this.adapter.perceive(input); }
  isCertifiedResult(task: string, resolvedModel: string | null) {
    const e = this.certification.evaluation;
    const ids = new Set(e.cases.filter(c => c.task === task && c.split === "heldout" && c.realRecording).map(c => c.id));
    return resolvedModel !== null && e.trials.some(t => ids.has(t.caseId) && t.completed && t.resolvedModel === resolvedModel);
  }
}

export async function loadHearingCertification(adapter: PerceptionAdapter, file: string): Promise<PerceptionAdapter> {
  try {
    if ((await fs.stat(file)).size > 5_000_000) throw new Error("Certification exceeds 5 MB.");
    return new CertifiedPerception(adapter, parseHearingCertification(JSON.parse(await fs.readFile(file, "utf8"))));
  } catch {
    // A broken/stale promotion file must not disable the editor or its local measurements.
    return {
      capabilities: () => ({ ...adapter.capabilities(), verifiedTasks: [], unavailable: [...adapter.capabilities().unavailable, "Hearing certification is missing or invalid; findings remain withheld."] }),
      perceive: input => adapter.perceive(input),
      isCertifiedResult: () => false,
    };
  }
}
