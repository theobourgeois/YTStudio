/** Small persisted vocal comparison runs built on the existing durable audio jobs. */
import fs from "node:fs/promises";
import path from "node:path";
import { createId } from "../../../shared/ids.ts";
import { hashJson } from "../../../shared/music/hash.ts";
import { createMusicProject } from "../../../shared/music/project.ts";
import { songSeconds } from "../../../shared/music/tempo.ts";
import { passageFrames } from "../../../shared/music/audio-intelligence/artifact.ts";
import { checkVocalTarget, VOCAL_VARIANTS, VOCAL_DESCRIPTIONS, VOCAL_LABELS, vocalAlternative, vocalRevision,
  type VocalMixRun } from "../../../shared/music/audio-intelligence/vocal-mix.ts";
import { createLimiter } from "../../queue.ts";
import { HttpError, isObject, isValidId, writeJson } from "../../storage.ts";
import { readWav } from "../wav.ts";
import type { AudioIntelligence } from "./service.ts";

export const VOCAL_SERVER_TOOLS = ["get_vocal_mixing_workflow", "create_vocal_mix_run", "get_vocal_mix_run", "cancel_vocal_mix_run", "retry_vocal_mix_run", "validate_vocal_mix_apply"] as const;
const safe = (id: unknown) => { if (typeof id !== "string" || !/^mixrun_[a-zA-Z0-9_-]{1,64}$/.test(id)) throw new HttpError(400, "Invalid vocal comparison id."); return id; };

export class VocalMixService {
  private readonly mutations = createLimiter(1);
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();
  private stopped = false;
  constructor(private readonly audio: AudioIntelligence, private readonly root: string, private readonly isMusic: (id: string) => boolean) {}
  private folder(projectId: string) {
    if (!isValidId(projectId) || !this.isMusic(projectId)) throw new HttpError(404, "No such music project.");
    return path.join(this.root, projectId, "vocal-mixes");
  }
  private file(projectId: string, id: unknown) { return path.join(this.folder(projectId), `${safe(id)}.json`); }
  private save(run: VocalMixRun) { return writeJson(this.file(run.projectId, run.id), run); }
  async init() {
    for (const projectId of await fs.readdir(this.root)) {
      if (!isValidId(projectId) || !this.isMusic(projectId)) continue;
      for (const file of await fs.readdir(this.folder(projectId)).catch(e => { if (e.code === "ENOENT") return []; throw e; })) {
        if (!file.endsWith(".json")) continue;
        const run = await this.read(projectId, file.slice(0, -5));
        if (run.status === "preparing") {
          for (const c of run.candidates) for (const r of c.renders) if (["queued", "running"].includes(this.audio.get(projectId, r.jobId).status)) await this.audio.cancel(projectId, r.jobId);
          run.status = "failed"; run.error = "Comparison preparation was interrupted. Start a fresh comparison."; await this.save(run);
        } else if (run.status === "rendering") this.watch(projectId, run.id);
      }
    }
  }
  shutdown() { this.stopped = true; for (const timer of this.timers.values()) clearTimeout(timer); this.timers.clear(); }
  private watch(projectId: string, id: string) {
    if (this.stopped || this.timers.has(id)) return;
    const timer = setTimeout(async () => {
      this.timers.delete(id);
      if (this.stopped) return;
      try { const run = await this.get(projectId, id); if (run.status === "rendering") this.watch(projectId, id); }
      catch (error) { if (!this.stopped) console.error("[vocal-mix] comparison progress failed", error); }
    }, 300);
    timer.unref(); this.timers.set(id, timer);
  }
  private async read(projectId: string, id: unknown): Promise<VocalMixRun> {
    const input: unknown = await fs.readFile(this.file(projectId, id), "utf8").then(JSON.parse).catch(e => {
      if (e.code === "ENOENT") throw new HttpError(404, "No such vocal comparison in this project."); throw e;
    });
    if (!isObject(input) || input.schema !== 1 || input.id !== id || input.projectId !== projectId ||
        typeof input.baseSnapshotId !== "string" || typeof input.baseRevision !== "string" || typeof input.vocalTrackId !== "string" ||
        typeof input.goal !== "string" || !Array.isArray(input.passages) || input.passages.length !== 2 ||
        !input.passages.every(p => isObject(p) && Number.isSafeInteger(p.startTick) && Number.isSafeInteger(p.endTick) && Number(p.endTick) > Number(p.startTick)) ||
        !["preparing", "rendering", "ready", "interrupted", "failed", "cancelled"].includes(String(input.status)) ||
        !Array.isArray(input.candidates) || !input.candidates.every((c, i) => isObject(c) && c.variant === VOCAL_VARIANTS[i] &&
          typeof c.snapshotId === "string" && Array.isArray(c.renders) && c.renders.length <= 2 && c.renders.every(r => isObject(r) && typeof r.jobId === "string" &&
            [r.analysisJobId, r.artifactId, r.reportId].every(v => v === null || typeof v === "string") &&
            [r.auditionGainDb, r.peakDbfs, r.rmsDbfs, r.fullScaleFraction].every(v => v === null || typeof v === "number" && Number.isFinite(v))))) {
      throw new HttpError(409, "Invalid persisted vocal comparison.");
    }
    const run = input as unknown as VocalMixRun;
    const base = await this.audio.snapshot(projectId, run.baseSnapshotId);
    if (base.snapshot.document.sha256 !== run.baseRevision) throw new HttpError(409, "Comparison revision mismatch.");
    const song = { ...createMusicProject(), ...base.content };
    for (const candidate of run.candidates) {
      const snapshot = await this.audio.snapshot(projectId, candidate.snapshotId);
      if (snapshot.snapshot.document.sha256 !== vocalRevision(vocalAlternative(song, run.vocalTrackId, candidate.variant, run.id))) throw new HttpError(409, "Candidate settings changed on disk.");
    }
    return run;
  }
  async create(projectId: string, input: Record<string, unknown>) {
    return this.mutations(async () => {
      if (typeof input.snapshotId !== "string" || typeof input.vocalTrackId !== "string") throw new HttpError(400, "Capture a snapshot and identify its vocal mixer insert.");
      const base = await this.audio.snapshot(projectId, input.snapshotId);
      const song = { ...createMusicProject(), ...base.content };
      checkVocalTarget(song, input.vocalTrackId);
      if (base.snapshot.plugins.some(p => p.storage !== "document") || base.snapshot.media.some(m => m.sha256 === null)) throw new HttpError(409, "Use complete source audio and built-in plugins for this first workflow.");
      const passages = [{ startTick: input.startTick, endTick: input.endTick }, { startTick: input.checkStartTick, endTick: input.checkEndTick }].map(p => {
        if (!Number.isSafeInteger(p.startTick) || !Number.isSafeInteger(p.endTick) || Number(p.startTick) < 0 || Number(p.endTick) <= Number(p.startTick)) throw new HttpError(400, "Choose two valid passage ranges in song ticks.");
        const startTick = Number(p.startTick), endTick = Number(p.endTick), seconds = songSeconds(song, endTick) - songSeconds(song, startTick);
        if (seconds < 5 || seconds > 20) throw new HttpError(400, "Each comparison passage must be 5 to 20 seconds.");
        return { startTick, endTick };
      });
      if (passages[0].endTick > passages[1].startTick && passages[1].endTick > passages[0].startTick) throw new HttpError(400, "The second passage must not overlap the first.");
      const run: VocalMixRun = { schema: 1, id: createId("mixrun"), projectId, goal: typeof input.goal === "string" ? input.goal.slice(0, 2000) : "Audition vocal balance, compression and presence",
        vocalTrackId: input.vocalTrackId, baseSnapshotId: base.snapshot.id, baseRevision: base.snapshot.document.sha256,
        passages, status: "preparing", error: null, createdAt: Date.now(), candidates: [] };
      await fs.mkdir(this.folder(projectId), { recursive: true });
      await this.save(run);
      try {
        for (const variant of VOCAL_VARIANTS) {
          const candidateSong = vocalAlternative(song, run.vocalTrackId, variant, run.id);
          const snapshot = variant === "baseline" ? base : await this.audio.forkSnapshot(projectId, base.snapshot.id, candidateSong);
          const candidate = { variant, snapshotId: snapshot.snapshot.id, renders: [] as VocalMixRun["candidates"][number]["renders"] };
          run.candidates.push(candidate);
          for (const p of passages) {
            const job = await this.audio.tool(projectId, "render_audio_passage", { snapshotId: snapshot.snapshot.id, ...p, leadInTicks: 768, tailSeconds: 4 }) as { id: string };
            candidate.renders.push({ jobId: job.id, analysisJobId: null, artifactId: null, reportId: null, auditionGainDb: null, peakDbfs: null, rmsDbfs: null, fullScaleFraction: null });
          }
          await this.save(run);
        }
        run.status = "rendering";
        await this.save(run);
        this.watch(projectId, run.id);
      } catch (e) {
        run.status = "failed"; run.error = String(e);
        for (const c of run.candidates) for (const r of c.renders) await this.audio.cancel(projectId, r.jobId).catch(() => {});
        await this.save(run); throw e;
      }
      return run;
    });
  }
  async get(projectId: string, id: unknown) {
    return this.mutations(async () => {
      const run = await this.read(projectId, id);
      if (["cancelled", "preparing"].includes(run.status)) return run;
      if (run.candidates.length !== 4 || run.candidates.some(c => c.renders.length !== 2)) {
        run.status = "failed"; run.error = "Comparison preparation was interrupted. Start a fresh comparison.";
        await this.save(run); return run;
      }
      let pending = false, interrupted = false, failed = false;
      for (const c of run.candidates) for (const [passageIndex, r] of c.renders.entries()) {
        const render = this.audio.get(projectId, r.jobId);
        if (render.status === "interrupted") interrupted = true;
        else if (["failed", "cancelled"].includes(render.status)) { failed = true; run.error = render.error?.message ?? "A comparison render was cancelled."; }
        else if (render.status !== "succeeded") pending = true;
        if (render.status !== "succeeded") continue;
        const artifactId = render.result!.artifactIds[0];
        const artifact = await this.audio.artifact(projectId, artifactId);
        if (artifact.snapshotId !== c.snapshotId) throw new HttpError(409, "Comparison artifact belongs to a different snapshot.");
        if (artifact.passage?.startTick !== run.passages[passageIndex].startTick || artifact.passage.endTick !== run.passages[passageIndex].endTick) throw new HttpError(409, "Comparison passage mismatch.");
        r.artifactId = artifactId;
        if (!r.analysisJobId) r.analysisJobId = (await this.audio.tool(projectId, "analyse_audio_artifact", { artifactId }) as { id: string }).id;
        const analysis = this.audio.get(projectId, r.analysisJobId);
        if (analysis.status === "interrupted") interrupted = true;
        else if (["failed", "cancelled"].includes(analysis.status)) { failed = true; run.error = analysis.error?.message ?? "Comparison measurements were cancelled."; }
        else if (analysis.status !== "succeeded") pending = true;
        if (analysis.status !== "succeeded") continue;
        if (r.reportId === analysis.result!.evidenceIds[0] && r.peakDbfs !== null && r.rmsDbfs !== null && r.fullScaleFraction !== null) continue;
        r.reportId = analysis.result!.evidenceIds[0];
        await this.audio.report(projectId, r.reportId);
        // Audition uses one scalar over the passage body, excluding warm-up/tails.
        const audio = await readWav(this.audio.audioFile(projectId, artifactId));
        const range = passageFrames(artifact)!;
        let peak = 0, sum = 0;
        for (const channel of audio.channels) {
          for (let i = 0; i < channel.length; i++) {
            if (!Number.isFinite(channel[i])) throw new HttpError(409, "Nonfinite comparison audio.");
            peak = Math.max(peak, Math.abs(channel[i]));
          }
          for (let i = range.first; i < range.end; i++) sum += channel[i] ** 2;
        }
        const rms = Math.sqrt(sum / ((range.end - range.first) * audio.channels.length));
        r.peakDbfs = peak > 0 ? 20 * Math.log10(peak) : null;
        r.rmsDbfs = rms > 1e-8 ? 20 * Math.log10(rms) : null;
        r.fullScaleFraction = audio.channels.reduce((sum, channel) => sum + channel.filter(x => Math.abs(x) >= 1).length, 0) / (audio.channels.length * audio.channels[0].length);
        if (r.rmsDbfs === null) { failed = true; run.error = "A comparison passage is silent. Choose active vocal/instrumental passages."; }
      }
      run.status = failed ? "failed" : interrupted ? "interrupted" : pending ? "rendering" : "ready";
      if (run.status === "ready") for (let i = 0; i < 2; i++) {
        const rows = run.candidates.map(c => c.renders[i]);
        const target = Math.min(...rows.map(r => r.rmsDbfs!), ...rows.map(r => -1 - (r.peakDbfs! - r.rmsDbfs!)));
        for (const row of rows) row.auditionGainDb = target - row.rmsDbfs!;
      }
      await this.save(run);
      return run;
    });
  }
  async cancel(projectId: string, id: unknown) {
    return this.mutations(async () => {
      const run = await this.read(projectId, id); run.status = "cancelled";
      for (const c of run.candidates) for (const r of c.renders) for (const jobId of [r.jobId, r.analysisJobId]) if (jobId) {
        const job = this.audio.get(projectId, jobId);
        if (["queued", "running"].includes(job.status)) await this.audio.cancel(projectId, jobId);
      }
      await this.save(run); return run;
    });
  }
  async retry(projectId: string, id: unknown) {
    return this.mutations(async () => {
      const run = await this.read(projectId, id);
      if (run.status === "cancelled" || run.candidates.length !== 4) throw new HttpError(409, "Start a fresh comparison.");
      for (const c of run.candidates) for (const r of c.renders) for (const jobId of [r.jobId, r.analysisJobId]) if (jobId && ["failed", "interrupted"].includes(this.audio.get(projectId, jobId).status)) await this.audio.retry(projectId, jobId);
      run.status = "rendering"; run.error = null; await this.save(run); this.watch(projectId, run.id); return run;
    });
  }
  async tool(projectId: string, name: string, input: Record<string, unknown>) {
    if (name === "get_vocal_mixing_workflow") {
      this.folder(projectId);
      return { id: "vocal-balance-v1", prerequisites: ["Separate vocal insert and instrumental", "Built-in plugins only", "Two nonoverlapping active passages of 5–20 seconds"],
        steps: ["Capture current song", "Create vocal comparison", "Poll get_vocal_mix_run", "Review both passages at matched levels", "Keep baseline, or apply a chosen candidate with undo"],
        alternatives: VOCAL_VARIANTS.map(variant => ({ variant, label: VOCAL_LABELS[variant], description: VOCAL_DESCRIPTIONS[variant] })),
        limitations: ["Fixed bounded proposals, not genre-trained recommendations", "RMS matching, not LUFS", "No listening-quality score or neural model required"] };
    }
    if (name === "create_vocal_mix_run") return this.create(projectId, input);
    if (name === "get_vocal_mix_run") return this.get(projectId, input.runId);
    if (name === "cancel_vocal_mix_run") return this.cancel(projectId, input.runId);
    if (name === "retry_vocal_mix_run") return this.retry(projectId, input.runId);
    if (name === "validate_vocal_mix_apply") {
      const run = await this.get(projectId, input.runId);
      if (run.status !== "ready") throw new HttpError(409, "Comparison is not ready.");
      const current = await this.audio.capture(projectId, { song: input.song, live: true });
      if (current.snapshot.id !== run.baseSnapshotId) throw new HttpError(409, "The song, audio sources or render conditions changed. Start a fresh comparison.");
      return { run, validationId: hashJson({ snapshotId: current.snapshot.id, runId: run.id }) };
    }
    throw new HttpError(400, "Unknown vocal comparison operation.");
  }
}
