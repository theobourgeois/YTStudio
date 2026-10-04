import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AudioIntelligence } from "./service.ts";
import type { PerceptionAdapter, PerceptionInput } from "./perception.ts";
import type { HearingTask } from "../../../shared/music/audio-intelligence/hearing.ts";
import type { AudioArtifact, AudioJob } from "../../../shared/music/audio-intelligence/types.ts";
import type { AudioEngine } from "../engine.ts";
import { readWav, writeWavChannels } from "../wav.ts";
const projectId = "proj_0123456789ab", other = "proj_abcdef012345";
describe("durable consent-checked hearing", () => {
  let root: string, source: string, service: AudioIntelligence;
  let verified: HearingTask[], configured: boolean;
  const perceive = vi.fn<PerceptionAdapter["perceive"]>();
  const provider: PerceptionAdapter = {
    capabilities: () => ({ configured, provider: "fake", model: "test-model", adapterVersion: "test-v1", destination: "test:no-network", verifiedTasks: verified, unavailable: ["stereo listening"] }),
    perceive,
  };
  const options = () => ({ root: path.join(root, "audio"), engine: {} as AudioEngine, perception: provider, projectDir: () => root, samplePath: (_p: string, id: string) => id === "media_test" ? source : null, isMusicProject: (id: string) => [projectId, other].includes(id) });
  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "hearing-tests-")); source = path.join(root, "source.wav");
    await writeWavChannels(source, [new Float32Array(44100).fill(0.2), new Float32Array(44100).fill(0.4)], 44100);
    verified = []; configured = true;
    perceive.mockReset().mockImplementation(async input => {
      await input.beforeSend();
      await input.onAttempt({ number: 1, startedAt: 1, endedAt: 2, status: "completed", inputTokens: 100, outputTokens: 20, costUsd: null });
      return { output: { findings: [{ task: input.task, claim: "A steady sound.", startSeconds: 0, endSeconds: 0.5 }], limitations: [] }, raw: { test: "local fake" }, resolvedModel: "test-build" };
    });
    service = new AudioIntelligence(options()); await service.init();
  });
  afterEach(async () => { service.shutdown(); await new Promise(resolve => setTimeout(resolve, 40)); await fs.rm(root, { recursive: true, force: true }); });
  const register = async () => await service.tool(projectId, "register_audio_artifact", { mediaId: "media_test" }) as AudioArtifact;
  const hear = async (artifactId: string) => await service.tool(projectId, "hear_audio_artifact", { artifactId, task: "tone", question: "Describe tone" }) as AudioJob;
  const complete = async (id: string) => {
    for (let i = 0; i < 200; i++) {
      const job = service.get(projectId, id);
      if (!["queued", "running"].includes(job.status)) return job;
      await new Promise(resolve => setTimeout(resolve, 15));
    }
    throw new Error("Job failed to settle");
  };
  it("requires song-specific user permission and has no assistant permission tool", async () => {
    const artifact = await register();
    expect((await service.hearingSettings(projectId)).enabled).toBe(false);
    await expect(hear(artifact.id)).rejects.toThrow(/Enable hosted/);
    await expect(service.tool(projectId, "set_hearing_settings", { enabled: true })).rejects.toThrow(/Unknown/);
    await service.setHearingSettings(other, true);
    await expect(hear(artifact.id)).rejects.toThrow(/Enable hosted/);
    expect(perceive).not.toHaveBeenCalled();
  });
  it("preserves original stereo measurements, records derived format and withholds unverified findings", async () => {
    const original = await register(); await service.setHearingSettings(projectId, true);
    const job = await complete((await hear(original.id)).id);
    expect(job.status, JSON.stringify(job.error)).toBe("succeeded");
    const receipt = await service.hearingReceipt(projectId, job.id);
    const report = await service.report(projectId, job.result!.evidenceIds[0]);
    const prepared = await service.artifact(projectId, receipt.preparedArtifactId);
    expect(prepared.format).toMatchObject({ channels: 1, sampleRate: 48000, sampleFormat: "pcm16" });
    expect(prepared.transforms.map(t => t.kind)).toEqual(["trim", "downmix", "resample", "encode"]);
    const audio = await readWav(service.audioFile(projectId, prepared.id));
    expect(audio.channels[0][100]).toBeCloseTo(0.3, 3);
    expect((await service.artifact(projectId, original.id)).permissions.hostedAnalysis).toBe(false);
    expect(prepared.permissions.hostedAnalysis).toBe(true);
    expect(report.measurements.every(m => m.span.artifactId === original.id)).toBe(true);
    expect(report.observations).toEqual([]);
    expect(report.limitations.some(l => l.code === "unverified-hearing-task")).toBe(true);
    expect(receipt.attempts[0]).toMatchObject({ inputTokens: 100, costUsd: null });
    expect(receipt.resolvedModel).toBe("test-build");
    const repeat = await hear(original.id); expect(repeat.id).toBe(job.id);
    expect(perceive).toHaveBeenCalledTimes(1);
    await service.setHearingSettings(projectId, false); await service.setHearingSettings(projectId, true);
    const cachedJob = await complete((await hear(original.id)).id);
    expect((await service.hearingReceipt(projectId, cachedJob.id)).cachedFrom).toBe(job.id);
    expect((await service.hearingReceipt(projectId, cachedJob.id)).attempts).toEqual([]);
    expect(perceive).toHaveBeenCalledTimes(1);
    await expect(service.hearingReceipt(other, job.id)).rejects.toThrow(/project/);
    service.shutdown(); service = new AudioIntelligence(options()); await service.init();
    expect((await service.hearingReceipt(projectId, job.id)).evidenceId).toBe(report.id);
  });
  it("keeps verified listening observations separate from measurements", async () => {
    verified = ["tone"];
    const artifact = await register(); await service.setHearingSettings(projectId, true);
    const job = await complete((await hear(artifact.id)).id);
    expect(job.status, JSON.stringify(job.error)).toBe("succeeded");
    const report = await service.report(projectId, job.result!.evidenceIds[0]);
    expect(report.observations).toHaveLength(1);
    expect(report.observations[0].source).toMatchObject({ kind: "hosted-perception", provider: "fake", model: "test-build", version: "test-v1" });
    expect(report.hypotheses).toEqual([]);
  });
  it("returns local evidence on unavailable providers and permits another attempt", async () => {
    const artifact = await register(); await service.setHearingSettings(projectId, true);
    perceive.mockRejectedValueOnce(new Error("Provider unavailable"));
    const job = await complete((await hear(artifact.id)).id);
    const report = await service.report(projectId, job.result!.evidenceIds[0]);
    expect(report.measurements.length).toBeGreaterThan(0);
    expect(report.observations).toEqual([]);
    expect((await service.hearingReceipt(projectId, job.id)).unavailableReason).toBe("Provider unavailable");
    const next = await hear(artifact.id); expect(next.id).not.toBe(job.id);
    await complete(next.id);
    expect((await hear(artifact.id)).id).toBe(next.id);
  });
  it("does not upload without a configured key", async () => {
    configured = false;
    const artifact = await register(); await service.setHearingSettings(projectId, true);
    const job = await complete((await hear(artifact.id)).id);
    expect((await service.hearingReceipt(projectId, job.id)).unavailableReason).toMatch(/key/);
    expect(perceive).not.toHaveBeenCalled();
  });
  it("revoking permission cancels an in-flight request and records its uncertain billing", async () => {
    let entered!: () => void;
    const started = new Promise<void>(resolve => { entered = resolve; });
    perceive.mockImplementation(async (input: PerceptionInput) => {
      entered();
      await new Promise((_, reject) => input.signal.addEventListener("abort", () => reject(input.signal.reason), { once: true }));
      throw new Error("unreachable");
    });
    const artifact = await register(); await service.setHearingSettings(projectId, true);
    const job = await hear(artifact.id); await started;
    await service.setHearingSettings(projectId, false);
    expect((await complete(job.id)).status).toBe("cancelled");
    expect((await service.hearingReceipt(projectId, job.id)).unavailableReason).toMatch(/billed/);
  });
});
