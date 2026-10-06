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
    for (let i = 0; i < 2000; i++) {
      const run = await audio.vocalMix.get(projectId, id);
      if (["ready", "failed", "interrupted", "cancelled"].includes(run.status)) return run;
      await new Promise(r => setTimeout(r, 30));
    }
    throw new Error("Comparison timed out");
  };
  it("measures, proposes from the measurements, renders and measures each proposal without client polling, and survives restart", async () => {
    const run = await create();
    expect(run.status).toBe("analysing");
    await fs.rm(source);
    // The server's watcher, rather than a tab, must move the run on.
    const persisted = (): Promise<VocalMixRun> => fs.readFile(path.join(root, "analysis", projectId, "vocal-mixes", `${run.id}.json`), "utf8").then(JSON.parse);
    await expect.poll(async () => (await persisted()).status, { timeout: 55000 }).toBe("ready");
    const stored = await persisted();
    // The stand-in engine plays the same tone for the vocal's stem and for the beat: 0 LU apart, 3 over "balanced".
    expect(stored.candidates[0].analyses[0]!.relation.medianLu).toBeCloseTo(0, 0);
    expect(stored.findings![0].map(f => f.kind)).toContain("level");
    expect(stored.candidates.map(c => c.id)).toEqual(expect.arrayContaining(["baseline", "level"]));
    const level = stored.candidates.find(c => c.id === "level")!;
    expect(level.change!.faderDb).toBe(-3);
    expect(level.effects[0]).toMatch(/^Vocal against the beat .*: 0\.0 → -3\.0 LU$/);
    expect(stored.candidates.every(c => c.renders.every(r => !!r.reportId && !!r.stemArtifactId && r.auditionGainDb !== null && r.auditionGainDb <= 0))).toBe(true);
    expect(stored.mixRun.phase).toBe("present");
    expect(stored.mixRun.candidateIds).toEqual(stored.candidates.slice(1).map(c => c.id));
    expect(stored.mixRun.usage.renderSeconds).toBeGreaterThan(0);
    audio.shutdown(); audio = new AudioIntelligence(options()); await audio.init();
    expect((await audio.vocalMix.get(projectId, run.id)).status).toBe("ready");
    await expect(audio.vocalMix.get(other, run.id)).rejects.toThrow(/No such/);
    const concluded = await audio.tool(projectId, "conclude_vocal_mix_run", { runId: run.id, candidateId: "level" }) as VocalMixRun;
    expect(concluded.mixRun.phase).toBe("accepted");
    expect(concluded.chosen!.candidateId).toBe("level");
  }, 60000);
  it("renders the assistant's own candidates instead, checked in their units, or measures only", async () => {
    await expect(create({ candidates: [{ label: "Too loud", change: { faderDb: 12 } }] })).rejects.toThrow(/candidates\[0\].*-6 to 6/);
    const own = await create({ candidates: [{ label: "Up a touch", reasons: ["Asked for a louder vocal."], change: { faderDb: 1 } }] });
    const done = await ready(own.id);
    expect(done.candidates.map(c => [c.id, c.label, c.source])).toEqual([["baseline", "Keep current mix", "baseline"], ["custom1", "Up a touch", "assistant"]]);
    expect(done.candidates[1].effects[0]).toMatch(/0\.0 → 1\.0 LU/);
    const measureOnly = await ready((await create({ candidates: [] })).id);
    expect(measureOnly.status).toBe("ready");
    expect(measureOnly.candidates).toHaveLength(1);
    expect(measureOnly.conclusion).toMatch(/Measured only/);
    expect(measureOnly.findings![0].length).toBeGreaterThan(0);
    expect(measureOnly.mixRun.phase).toBe("abandoned");
  }, 60000);
  it("rejects source and live-song changes before acceptance", async () => {
    const run = await create({ candidates: [] }); expect((await ready(run.id)).status).toBe("ready");
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
    expect([...cancelled.accompaniment.renders, ...cancelled.candidates.flatMap(c => c.renders)].every(r => !["queued", "running"].includes(audio.get(projectId, r.jobId).status))).toBe(true);
    expect(cancelled.mixRun.phase).toBe("abandoned");
  });
});
