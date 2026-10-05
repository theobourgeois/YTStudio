import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DataPaths } from "../../storage.ts";
import { createMusicProject } from "../../../shared/music/project.ts";
import { addAudioClips } from "../../../shared/music/playlist.ts";
import { addMixerTracks, updateMixerTrack } from "../../../shared/music/mixer.ts";
import type { MusicProject } from "../../../shared/music/types.ts";
import type { VocalMixRun } from "../../../shared/music/audio-intelligence/vocal-mix.ts";
import { AudioEngine } from "../engine.ts";
import { writeWav } from "../wav.ts";
import { AudioIntelligence } from "./service.ts";

describe("durable vocal comparisons", () => {
  const projectId = "proj_0123456789ab", other = "proj_abcdef012345";
  let root: string, source: string, engine: AudioEngine, audio: AudioIntelligence;
  let baseSong: MusicProject;
  const options = () => ({ root: path.join(root, "analysis"), engine, projectDir: () => root,
    samplePath: () => source, isMusicProject: (id: string) => [projectId, other].includes(id) });
  const makeSong = () => {
    const base = addAudioClips(addMixerTracks(createMusicProject("Vocal", 120), null, 1, ["insert_vocal"]),
      [{ channelId: "chan_vocal", name: "Vocal", sampleId: "media_vocal", seconds: 40 }], { start: 0, track: 0 }).song;
    return { ...base, channels: base.channels.map(c => c.id === "chan_vocal" ? { ...c, mixerTrack: "insert_vocal" } : c) };
  };
  const song = () => baseSong;
  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "vocal-comparison-")); source = path.join(root, "vocal.wav");
    await writeWav(source, new Float32Array(48000).fill(.2), 48000);
    engine = new AudioEngine(new DataPaths(root), { command: [process.execPath, path.resolve(import.meta.dirname, "../fake-engine.mjs")] });
    audio = new AudioIntelligence(options()); await audio.init();
    baseSong = makeSong();
  });
  afterEach(async () => { audio.shutdown(); engine.shutdown(); await new Promise(r => setTimeout(r, 100)); await fs.rm(root, { recursive: true, force: true }); });
  const create = async (extra: Record<string, unknown> = {}) => {
    const captured = await audio.capture(projectId, { song: song(), live: true });
    return audio.tool(projectId, "create_vocal_mix_run", { snapshotId: captured.snapshot.id, vocalTrackId: "insert_vocal",
      startTick: 0, endTick: 1920, checkStartTick: 3840, checkEndTick: 5760, ...extra }) as Promise<VocalMixRun>;
  };
  const ready = async (id: string) => {
    for (let i = 0; i < 800; i++) {
      const run = await audio.vocalMix.get(projectId, id);
      if (["ready", "failed", "interrupted", "cancelled"].includes(run.status)) return run;
      await new Promise(r => setTimeout(r, 30));
    }
    throw new Error("Comparison timed out");
  };
  it("finishes render and analysis without client polling, preserves source copies and survives restart", async () => {
    const run = await create();
    await fs.rm(source);
    // The server's watcher, rather than a tab, must start the analysis jobs.
    const persisted = () => fs.readFile(path.join(root, "analysis", projectId, "vocal-mixes", `${run.id}.json`), "utf8").then(JSON.parse);
    await expect.poll(async () => (await persisted()).status, { timeout: 25000 }).toBe("ready");
    const stored = await persisted();
    expect(stored.status).toBe("ready");
    expect(stored.candidates.every((c: VocalMixRun["candidates"][number]) => c.renders.every(r => !!r.reportId && r.auditionGainDb !== null && r.auditionGainDb <= 0))).toBe(true);
    audio.shutdown(); audio = new AudioIntelligence(options()); await audio.init();
    expect((await audio.vocalMix.get(projectId, run.id)).status).toBe("ready");
    await expect(audio.vocalMix.get(other, run.id)).rejects.toThrow(/No such/);
  }, 30000);
  it("rejects source and live-song changes before acceptance", async () => {
    const run = await create(); expect((await ready(run.id)).status).toBe("ready");
    await expect(audio.tool(projectId, "validate_vocal_mix_apply", { runId: run.id, song: song() })).resolves.toHaveProperty("run.id", run.id);
    await expect(audio.tool(projectId, "validate_vocal_mix_apply", { runId: run.id, song: updateMixerTrack(song(), "insert_vocal", { pan: .2 }) })).rejects.toThrow(/changed/);
    await writeWav(source, new Float32Array(48000).fill(.3), 48000);
    await expect(audio.tool(projectId, "validate_vocal_mix_apply", { runId: run.id, song: song() })).rejects.toThrow(/changed/);
  }, 30000);
  it("rejects overlapping or too-long passages and the master as a vocal target", async () => {
    await expect(create({ checkStartTick: 960, checkEndTick: 2880 })).rejects.toThrow(/overlap/);
    await expect(create({ endTick: 6000 })).rejects.toThrow(/5 to 20/);
    await expect(create({ vocalTrackId: "master" })).rejects.toThrow(/dedicated/);
  });
  it("cancels every queued/running job and refuses acceptance", async () => {
    const run = await create(), cancelled = await audio.vocalMix.cancel(projectId, run.id);
    expect(cancelled.status).toBe("cancelled");
    await expect(audio.tool(projectId, "validate_vocal_mix_apply", { runId: run.id, song: song() })).rejects.toThrow(/not ready/);
    await new Promise(r => setTimeout(r, 200));
    expect(cancelled.candidates.flatMap(c => c.renders).every(r => !["queued", "running"].includes(audio.get(projectId, r.jobId).status))).toBe(true);
  });
});
