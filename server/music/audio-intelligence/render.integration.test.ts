/** Real engine proof that snapshot media, passage clocks, lead-in and tails agree. */
import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { ENGINE } from "../../config.ts";
import { DataPaths } from "../../storage.ts";
import { createMusicProject } from "../../../shared/music/project.ts";
import { controlOf, createAutomation, editPoints, updateAutomation } from "../../../shared/music/automation.ts";
import { songSeconds } from "../../../shared/music/tempo.ts";
import { addAudioClips } from "../../../shared/music/playlist.ts";
import { AudioEngine } from "../engine.ts";
import { writeWav } from "../wav.ts";
import { AudioIntelligence } from "./service.ts";

it.skipIf(!existsSync(ENGINE))("renders preserved source audio and measures only the passage in the real engine", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "audio-native-"));
  const source = path.join(root, "tone.wav");
  const projectId = "proj_0123456789ab";
  await writeWav(source, Float32Array.from({ length: 48000 * 4 }, (_, i) => 0.5*Math.sin(i*2*Math.PI*1000/48000)), 48000);
  const engine = new AudioEngine(new DataPaths(root), { offline: true, onlyPluginPaths: true, pluginPaths: [], samplePath: () => source });
  const service = new AudioIntelligence({ root: path.join(root, "analysis"), engine, projectDir: () => root, samplePath: () => source, isMusicProject: id => id === projectId });
  try {
    await service.init();
    const song = addAudioClips(createMusicProject("Known tone", 120), [{ name: "Tone", sampleId: "media_tone", seconds: 4 }], { start: 0, track: 0 }).song;
    const bundle = await service.capture(projectId, { song });
    await writeWav(source, new Float32Array(48000*4), 48000);
    const job = await service.tool(projectId, "render_audio_passage", { snapshotId: bundle.snapshot.id, startTick: 192, endTick: 384, leadInTicks: 192, tailSeconds: 1 }) as { id: string };
    const wait = async (id: string) => {
      for (let i = 0; i < 400; i++) {
        const job = service.get(projectId, id);
        if (["succeeded", "failed"].includes(job.status)) { expect(job.status, job.error?.message).toBe("succeeded"); return job; }
        await new Promise(r => setTimeout(r, 25));
      }
      throw new Error("Native job timed out.");
    };
    const done = await wait(job.id);
    const artifact = await service.artifact(projectId, done.result!.artifactIds[0]);
    expect(artifact.passage).toMatchObject({ startSeconds: 1, leadInFrames: 48000 });
    expect(artifact.passage!.tailFrames).toBeGreaterThan(0);
    const analysis = await service.tool(projectId, "analyse_audio_artifact", { artifactId: artifact.id }) as { id: string };
    const measured = await wait(analysis.id);
    const report = await service.report(projectId, measured.result!.evidenceIds[0]);
    expect(report.measurements.find(m => m.name === "peakDbfs")!.value).toBeGreaterThan(-20);
    expect(report.coverage.inspected[0]).toMatchObject({ startSeconds: 1, endSeconds: 2 });
    // Passage frame counts also follow an automated tempo, including a render starting mid-clip.
    const made = createAutomation(song, { kind: "tempo" }, { start: 96, length: 384 });
    const tempo = controlOf(made.song, { kind: "tempo" });
    const warped = editPoints(updateAutomation(made.song, made.automationId, { min: 0, max: 1 }), made.automationId,
      () => [{ tick: 0, value: tempo.fromControl(137), curve: "single", tension: 0 }, { tick: 384, value: tempo.fromControl(213), curve: "single", tension: 0 }]);
    const captured = await service.capture(projectId, { song: warped });
    const changing = await service.tool(projectId, "render_audio_passage", { snapshotId: captured.snapshot.id, startTick: 211, endTick: 467, leadInTicks: 96, tailSeconds: 0 }) as { id: string };
    const changed = await wait(changing.id);
    const tempoArtifact = await service.artifact(projectId, changed.result!.artifactIds[0]);
    expect(tempoArtifact.passage!.startSeconds).toBeCloseTo(songSeconds(warped, 211), 6);
    const passageSeconds = (tempoArtifact.format.frames - tempoArtifact.passage!.leadInFrames) / tempoArtifact.format.sampleRate;
    expect(Math.abs(passageSeconds - (songSeconds(warped, 467) - songSeconds(warped, 211)))).toBeLessThan(2 / tempoArtifact.format.sampleRate);
  } finally { service.shutdown(); engine.shutdown(); await fs.rm(root, { recursive: true, force: true }); }
});
