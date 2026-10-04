import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createMusicProject } from "../../../shared/music/project.ts";
import { addChannels } from "../../../shared/music/edits.ts";
import { addPluginChannel } from "../../../shared/music/edits.ts";
import { AudioEngine } from "../engine.ts";
import { DataPaths, writeJson } from "../../storage.ts";
import { writeWav } from "../wav.ts";
import { applyJobAction, createJob } from "../../../shared/music/audio-intelligence/job.ts";
import { AudioIntelligence } from "./service.ts";
const projectId = "proj_0123456789ab", other = "proj_abcdef012345";

describe("durable project audio jobs", () => {
  let root: string, engine: AudioEngine, service: AudioIntelligence;
  let source: string;
  const options = () => ({ root: path.join(root, "audio"), engine, projectDir: () => root, samplePath: (_p: string, id: string) => id === "media_test" ? source : null, isMusicProject: (id: string) => [projectId, other].includes(id) });
  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "audio-jobs-")); source = path.join(root, "source.wav");
    await writeWav(source, new Float32Array(48000).fill(0.25), 48000);
    engine = new AudioEngine(new DataPaths(root), { command: [process.execPath, path.resolve(import.meta.dirname, "../fake-engine.mjs")] });
    service = new AudioIntelligence(options()); await service.init();
  });
  afterEach(async () => { service.shutdown(); engine.shutdown(); await new Promise(r => setTimeout(r, 100)); await fs.rm(root, { recursive: true, force: true }); });
  const complete = async (id: string) => {
    for (let i = 0; i < 100; i++) {
      const job = service.get(projectId, id);
      if (["succeeded", "failed", "cancelled", "interrupted"].includes(job.status)) return job;
      await new Promise(r => setTimeout(r, 30));
    }
    throw new Error("Audio job did not settle.");
  };
  it("registers immutable audio, measures it, preserves results across restart and scopes access", async () => {
    const artifact = await service.register(projectId, "media_test");
    await writeWav(source, new Float32Array(48000).fill(0.75), 48000);
    const job = await service.tool(projectId, "analyse_audio_artifact", { artifactId: artifact.id }) as { id: string };
    const done = await complete(job.id);
    expect(done.status).toBe("succeeded");
    const report = await service.report(projectId, done.result!.evidenceIds[0]);
    expect(report.measurements.find(m => m.name === "rmsDbfs")!.value).toBeCloseTo(-12.04, 1);
    expect(() => service.get(other, job.id)).toThrow(/project/);
    await expect(service.report(other, report.id)).rejects.toThrow();
    await expect(service.artifact(projectId, "../../escape")).rejects.toThrow(/Invalid/);
    service.shutdown(); service = new AudioIntelligence(options()); await service.init();
    expect(service.get(projectId, job.id).status).toBe("succeeded");
    expect((await service.report(projectId, report.id)).id).toBe(report.id);
    const repeated = await service.tool(projectId, "analyse_audio_artifact", { artifactId: artifact.id }) as { id: string };
    expect(repeated.id).toBe(job.id);
  });
  it("captures source bytes, renders a passage, persists progress and cancels safely", async () => {
    const song = addChannels(createMusicProject("Analysis", 120), [{ id: "chan_test", name: "Test", sampleId: "media_test" }]);
    const bundle = await service.capture(projectId, { song, live: true });
    await fs.rm(source);
    const render = await service.tool(projectId, "render_audio_passage", { snapshotId: bundle.snapshot.id, startTick: 192, endTick: 384, leadInTicks: 96, tailSeconds: 0 }) as { id: string };
    const done = await complete(render.id);
    expect(done.status, done.error?.message).toBe("succeeded");
    const artifact = await service.artifact(projectId, done.result!.artifactIds[0]);
    expect(artifact.passage).toMatchObject({ startSeconds: 1, leadInFrames: 24000, tailFrames: 0 });
    expect(artifact.format.frames).toBe(72000);
    const cancelled = await service.tool(projectId, "render_audio_passage", { snapshotId: bundle.snapshot.id, startTick: 0, endTick: 384, tailSeconds: 0 }) as { id: string };
    await new Promise(r => setTimeout(r, 150));
    await service.cancel(projectId, cancelled.id);
    expect((await complete(cancelled.id)).status).toBe("cancelled");
    expect((await engine.command("status", {})).exporting).toBeNull();
  });
  it("keeps a pending cancellation cancelled when the server shuts down", async () => {
    const bundle = await service.capture(projectId, { song: createMusicProject() });
    const render = await service.tool(projectId, "render_audio_passage", { snapshotId: bundle.snapshot.id, startTick: 0, endTick: 384 }) as { id: string };
    await new Promise(r => setTimeout(r, 150));
    expect((await service.cancel(projectId, render.id)).cancelRequested).toBe(true);
    service.shutdown(); engine.shutdown();
    expect((await complete(render.id)).status).toBe("cancelled");
  });
  it("refuses outside plugins and oversized passages", async () => {
    const song = addPluginChannel(createMusicProject(), { id: "VST3-Test-1", name: "Test", format: "VST3" }, "chan_test");
    const bundle = await service.capture(projectId, { song });
    await expect(service.tool(projectId, "render_audio_passage", { snapshotId: bundle.snapshot.id, startTick: 0, endTick: 384 })).rejects.toThrow(/built-in/);
    const clean = await service.capture(projectId, { song: createMusicProject() });
    await expect(service.tool(projectId, "render_audio_passage", { snapshotId: clean.snapshot.id, startTick: 0, endTick: 100000 })).rejects.toThrow(/120 seconds/);
  });
  it("detects changed artifact bytes rather than returning invented measurements", async () => {
    const artifact = await service.register(projectId, "media_test");
    await fs.writeFile(service.audioFile(projectId, artifact.id), "bad");
    const job = await service.tool(projectId, "analyse_audio_artifact", { artifactId: artifact.id }) as { id: string };
    const done = await complete(job.id);
    expect(done.status).toBe("failed"); expect(done.error?.message).toMatch(/changed/);
    expect(done.result).toBeNull();
  });
  it("refuses truncated WAVs rather than silently analyzing their remaining bytes", async () => {
    const bytes = await fs.readFile(source);
    await fs.writeFile(source, bytes.subarray(0, bytes.length - 16));
    await expect(service.register(projectId, "media_test")).rejects.toThrow(/Truncated/);
  });
  it("recovers running jobs as interrupted and allows bounded explicit retries", async () => {
    const artifact = await service.register(projectId, "media_test");
    const job = createJob({ id: "audjob_restart", kind: "analyse", projectId, inputs: [artifact.id], params: { kind: "analyse", artifactId: artifact.id }, stages: ["measure"], now: Date.now() });
    const started = applyJobAction(job, { type: "start" }, Date.now()); if (!started.ok) throw new Error(started.error);
    await fs.mkdir(path.join(root, "audio", projectId, "jobs"), { recursive: true });
    await writeJson(path.join(root, "audio", projectId, "jobs", `${job.id}.json`), { job: started.job, plan: { kind: "analyse", artifactId: artifact.id } });
    service.shutdown(); service = new AudioIntelligence(options()); await service.init();
    expect(service.get(projectId, job.id).status).toBe("interrupted");
    await service.retry(projectId, job.id);
    const done = await complete(job.id);
    expect(done.status).toBe("succeeded"); expect(done.attempts).toBe(2);
  });
});
