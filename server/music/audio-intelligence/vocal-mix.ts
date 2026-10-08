/**
 * Vocal mix runs on the durable audio jobs: the beat (the vocal muted) and the song with the vocal's stem are
 * rendered over two passages, measured against each other, changes proposed from the measurements (or the
 * assistant's own), rendered and measured again. Each step moves the run's `MixRun` through its phases.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { createId } from "../../../shared/ids.ts";
import { hashJson } from "../../../shared/music/hash.ts";
import { createMusicProject } from "../../../shared/music/project.ts";
import { getMixerTrack, updateMixerTrack } from "../../../shared/music/mixer.ts";
import { songSeconds } from "../../../shared/music/tempo.ts";
import { passageFrames } from "../../../shared/music/audio-intelligence/artifact.ts";
import { integratedLoudness, loudnessChunks, truePeak } from "../../../shared/music/audio-intelligence/loudness.ts";
import { addCandidate, addIds, addPassage, advanceRun, chargeBudget, createRun, type RunStep } from "../../../shared/music/audio-intelligence/run.ts";
import type { MixRun } from "../../../shared/music/audio-intelligence/types.ts";
import { analyseVocal, checkVocalChange, proposeVocalChanges, VOCAL_LEVEL_TARGETS, VOCAL_THRESHOLDS, type VocalLevel } from "../../../shared/music/audio-intelligence/vocal-analysis.ts";
import { applyVocalChange, auditionGains, candidateEffects, candidateSong, checkVocalTarget, faderDbOf, levelMatch, validateVocalMixRun, vocalRevision,
  type VocalCandidate, type VocalMixRun, type VocalRender } from "../../../shared/music/audio-intelligence/vocal-mix.ts";
import type { MusicProject } from "../../../shared/music/types.ts";
import { createLimiter } from "../../queue.ts";
import { HttpError, isValidId, writeJson } from "../../storage.ts";
import { readWav } from "../wav.ts";
import type { AudioIntelligence } from "./service.ts";
import { log } from "../../log.ts";

const logger = log("vocal-mix");

export const VOCAL_SERVER_TOOLS = ["get_vocal_mixing_workflow", "create_vocal_mix_run", "get_vocal_mix_run", "cancel_vocal_mix_run", "retry_vocal_mix_run", "validate_vocal_mix_apply", "conclude_vocal_mix_run"] as const;
const safe = (id: unknown) => { if (typeof id !== "string" || !/^mixrun_[a-zA-Z0-9_-]{1,64}$/.test(id)) throw new HttpError(400, "Invalid vocal comparison id."); return id; };
const LEAD_IN_TICKS = 768, TAIL_SECONDS = 4;
const newRender = (jobId: string): VocalRender => ({ jobId, analysisJobId: null, artifactId: null, stemArtifactId: null, reportId: null, auditionGainDb: null, integratedLufs: null, truePeakDbtp: null, peakDbfs: null, rmsDbfs: null, fullScaleFraction: null });
const stepped = (step: RunStep): MixRun => { if (!step.ok) throw new HttpError(409, step.error); return step.run; };

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
        // A comparison an earlier version made, or a damaged one, is left alone (reading it says why).
        const run = await this.read(projectId, file.slice(0, -5)).catch(() => null);
        if (!run) continue;
        if (run.status === "preparing") {
          for (const jobId of this.jobsOf(run)) if (["queued", "running"].includes(this.audio.get(projectId, jobId).status)) await this.audio.cancel(projectId, jobId);
          run.status = "failed"; run.error = "Comparison preparation was interrupted. Start a fresh comparison."; await this.save(run);
        } else if (run.status === "rendering" || run.status === "analysing") this.watch(projectId, run.id);
      }
    }
  }
  shutdown() { this.stopped = true; for (const timer of this.timers.values()) clearTimeout(timer); this.timers.clear(); }
  private jobsOf(run: VocalMixRun) {
    return [...run.accompaniment.renders.map(r => r.jobId), ...run.candidates.flatMap(c => c.renders.flatMap(r => [r.jobId, r.analysisJobId].filter((x): x is string => !!x)))];
  }
  /** The server moves a run on by itself, with no tab polling. */
  private watch(projectId: string, id: string) {
    if (this.stopped || this.timers.has(id)) return;
    const timer = setTimeout(async () => {
      this.timers.delete(id);
      if (this.stopped) return;
      try { const run = await this.get(projectId, id); if (run.status === "rendering" || run.status === "analysing") this.watch(projectId, id); }
      catch (error) { if (!this.stopped) logger.error("comparison progress failed", error); }
    }, 300);
    timer.unref(); this.timers.set(id, timer);
  }
  private async baseSong(projectId: string, snapshotId: string) {
    const base = await this.audio.snapshot(projectId, snapshotId);
    return { base, song: { ...createMusicProject(), ...base.content } as MusicProject };
  }
  private async read(projectId: string, id: unknown): Promise<VocalMixRun> {
    const input: unknown = await fs.readFile(this.file(projectId, id), "utf8").then(JSON.parse).catch(e => {
      if (e.code === "ENOENT") throw new HttpError(404, "No such vocal comparison in this project."); throw e;
    });
    let run: VocalMixRun;
    try { run = validateVocalMixRun(input, String(id), projectId); }
    catch (error) { throw new HttpError(409, `${error instanceof Error ? error.message : "Invalid vocal comparison."} Start a fresh comparison.`); }
    const { base, song } = await this.baseSong(projectId, run.baseSnapshotId);
    if (base.snapshot.document.sha256 !== run.baseRevision) throw new HttpError(409, "Comparison revision mismatch.");
    if (run.accompaniment.snapshotId) {
      const acc = await this.audio.snapshot(projectId, run.accompaniment.snapshotId);
      if (acc.snapshot.document.sha256 !== vocalRevision(updateMixerTrack(song, run.vocalTrackId, { muted: true }))) throw new HttpError(409, "The comparison's accompaniment changed on disk.");
    }
    for (const candidate of run.candidates) {
      const snapshot = await this.audio.snapshot(projectId, candidate.snapshotId);
      if (snapshot.snapshot.document.sha256 !== vocalRevision(candidateSong(song, run, candidate))) throw new HttpError(409, "Candidate settings changed on disk.");
    }
    return run;
  }
  private render(projectId: string, snapshotId: string, passage: { startTick: number; endTick: number }, stemTrackId?: string) {
    return this.audio.tool(projectId, "render_audio_passage", { snapshotId, ...passage, leadInTicks: LEAD_IN_TICKS, tailSeconds: TAIL_SECONDS, ...(stemTrackId ? { stemTrackId } : {}) }) as Promise<{ id: string }>;
  }
  /** Charge a render's seconds (lead-in, passage and tail) to the run's budget. */
  private charge(run: VocalMixRun, song: MusicProject, passage: { startTick: number; endTick: number }) {
    const from = Math.max(0, passage.startTick - LEAD_IN_TICKS);
    run.mixRun = stepped(chargeBudget(run.mixRun, "renderSeconds", songSeconds(song, passage.endTick) - songSeconds(song, from) + TAIL_SECONDS, Date.now()));
  }
  async create(projectId: string, input: Record<string, unknown>) {
    return this.mutations(async () => {
      if (typeof input.snapshotId !== "string" || typeof input.vocalTrackId !== "string") throw new HttpError(400, "Capture a snapshot and identify its vocal mixer insert.");
      const { base, song } = await this.baseSong(projectId, input.snapshotId);
      try { checkVocalTarget(song, input.vocalTrackId); } catch (error) { throw new HttpError(400, error instanceof Error ? error.message : String(error)); }
      if (base.snapshot.plugins.some(p => p.storage !== "document") || base.snapshot.media.some(m => m.sha256 === null)) throw new HttpError(409, "Use complete source audio and built-in plugins for this workflow.");
      const level = (input.level ?? "balanced") as VocalLevel;
      if (!(level in VOCAL_LEVEL_TARGETS)) throw new HttpError(400, `level is one of ${Object.keys(VOCAL_LEVEL_TARGETS).join(", ")}.`);
      const passages = [{ startTick: input.startTick, endTick: input.endTick }, { startTick: input.checkStartTick, endTick: input.checkEndTick }].map(p => {
        if (!Number.isSafeInteger(p.startTick) || !Number.isSafeInteger(p.endTick) || Number(p.startTick) < 0 || Number(p.endTick) <= Number(p.startTick)) throw new HttpError(400, "Choose two valid passage ranges in song ticks.");
        const startTick = Number(p.startTick), endTick = Number(p.endTick), seconds = songSeconds(song, endTick) - songSeconds(song, startTick);
        if (seconds < 5 || seconds > 20) throw new HttpError(400, "Each comparison passage must be 5 to 20 seconds.");
        return { startTick, endTick };
      });
      if (passages[0].endTick > passages[1].startTick && passages[1].endTick > passages[0].startTick) throw new HttpError(400, "The second passage must not overlap the first.");
      const id = createId("mixrun");
      let mixRun = createRun({ id: `run_${hashJson(id).slice(0, 12)}`, projectId, goal: typeof input.goal === "string" && input.goal.trim() ? input.goal.slice(0, 2000) : "Sit the vocal in the beat",
        constraints: ["Only the vocal's insert changes: its fader, one compressor, one EQ.", "Built-in effects only."], snapshotId: base.snapshot.id, workflow: { id: "vocal-balance", version: 2 },
        // Up to ten renders (the beat, the baseline, three candidates; two passages each) with their lead-ins and tails.
        budgets: { maxRenderSeconds: 600 }, now: Date.now() });
      passages.forEach((p, i) => { mixRun = stepped(addPassage(mixRun, { ...p, why: i ? "check passage" : "primary passage" }, songSeconds(song, p.endTick) - songSeconds(song, p.startTick), Date.now())); });
      let requested: VocalMixRun["requested"] = null;
      if (input.candidates !== undefined) {
        if (!Array.isArray(input.candidates) || input.candidates.length > mixRun.budgets.maxCandidates) throw new HttpError(400, `candidates is a list of at most ${mixRun.budgets.maxCandidates}; leave it out to render the measured proposals.`);
        requested = input.candidates.map((c: unknown, i: number) => {
          const o = (c && typeof c === "object" ? c : {}) as Record<string, unknown>;
          const label = typeof o.label === "string" && o.label.trim() ? o.label.trim().slice(0, 60) : `Alternative ${i + 1}`;
          const reasons = Array.isArray(o.reasons) ? o.reasons.filter((r): r is string => typeof r === "string").slice(0, 6).map(r => r.slice(0, 400)) : [];
          try {
            const change = checkVocalChange(o.change);
            applyVocalChange(song, input.vocalTrackId as string, change, "fx_check");
            return { label, reasons, change };
          } catch (error) { throw new HttpError(400, `candidates[${i}]: ${error instanceof Error ? error.message : String(error)}`); }
        });
      }
      const run: VocalMixRun = { schema: 2, id, projectId, goal: mixRun.goal, vocalTrackId: input.vocalTrackId, level, baseSnapshotId: base.snapshot.id, baseRevision: base.snapshot.document.sha256,
        passages, status: "preparing", error: null, createdAt: Date.now(), accompaniment: { snapshotId: "", renders: [] }, requested, findings: null, conclusion: null, candidates: [], mixRun, chosen: null, levelMatched: false };
      await fs.mkdir(this.folder(projectId), { recursive: true });
      await this.save(run);
      try {
        const accompaniment = await this.audio.forkSnapshot(projectId, base.snapshot.id, updateMixerTrack(song, run.vocalTrackId, { muted: true }));
        run.accompaniment.snapshotId = accompaniment.snapshot.id;
        for (const p of passages) { run.accompaniment.renders.push({ jobId: (await this.render(projectId, accompaniment.snapshot.id, p)).id, artifactId: null }); this.charge(run, song, p); }
        const baseline: VocalCandidate = { id: "baseline", label: "Keep current mix", source: "baseline", reasons: ["No change."], change: null, snapshotId: base.snapshot.id, renders: [], analyses: [null, null], effects: [] };
        for (const p of passages) { baseline.renders.push(newRender((await this.render(projectId, base.snapshot.id, p, run.vocalTrackId)).id)); this.charge(run, song, p); }
        run.candidates.push(baseline);
        run.mixRun = stepped(advanceRun(run.mixRun, "inspect", Date.now()));
        run.status = "analysing";
        await this.save(run);
        this.watch(projectId, run.id);
      } catch (e) {
        run.status = "failed"; run.error = e instanceof Error ? e.message : String(e);
        for (const jobId of this.jobsOf(run)) await this.audio.cancel(projectId, jobId).catch(() => {});
        await this.save(run); throw e;
      }
      return run;
    });
  }
  /** A job's state folded into the run's: "done", "pending", or a stop ("interrupted", "failed"). */
  private state(projectId: string, jobId: string, run: VocalMixRun): "done" | "pending" | "interrupted" | "failed" {
    const job = this.audio.get(projectId, jobId);
    if (job.status === "succeeded") return "done";
    if (job.status === "interrupted") return "interrupted";
    if (job.status === "failed" || job.status === "cancelled") { run.error = job.error?.message ?? "A comparison job was cancelled."; return "failed"; }
    return "pending";
  }
  /** A render's artifacts and its mix's report, started or read; and its playback numbers once measured. */
  private async advanceRender(projectId: string, run: VocalMixRun, candidate: VocalCandidate, passage: number, states: Set<string>) {
    const r = candidate.renders[passage], render = this.state(projectId, r.jobId, run);
    states.add(render);
    if (render !== "done") return;
    const result = this.audio.get(projectId, r.jobId).result!;
    const artifact = await this.audio.artifact(projectId, result.artifactIds[0]);
    if (artifact.snapshotId !== candidate.snapshotId) throw new HttpError(409, "Comparison artifact belongs to a different snapshot.");
    if (artifact.passage?.startTick !== run.passages[passage].startTick || artifact.passage.endTick !== run.passages[passage].endTick) throw new HttpError(409, "Comparison passage mismatch.");
    r.artifactId = artifact.id;
    r.stemArtifactId = result.artifactIds[1] ?? null;
    if (!r.analysisJobId) r.analysisJobId = (await this.audio.tool(projectId, "analyse_audio_artifact", { artifactId: artifact.id }) as { id: string }).id;
    const analysis = this.state(projectId, r.analysisJobId, run);
    states.add(analysis);
    if (analysis !== "done") return;
    const reportId = this.audio.get(projectId, r.analysisJobId).result!.evidenceIds[0];
    if (r.reportId === reportId && r.integratedLufs !== null) return;
    r.reportId = reportId;
    await this.audio.report(projectId, reportId);
    run.mixRun = addIds(run.mixRun, "evidenceIds", [reportId], Date.now());
    // Playback numbers: loudness over the passage's body, peaks over everything heard (tails included).
    const audio = await readWav(this.audio.audioFile(projectId, artifact.id)), range = passageFrames(artifact)!;
    let peak = 0, sum = 0, full = 0;
    for (const channel of audio.channels) {
      for (let i = 0; i < channel.length; i++) {
        const v = Math.abs(channel[i]);
        if (!Number.isFinite(v)) throw new HttpError(409, "Nonfinite comparison audio.");
        if (v > peak) peak = v;
        if (v >= 1) full++;
      }
      for (let i = range.first; i < range.end; i++) sum += channel[i] ** 2;
    }
    const rms = Math.sqrt(sum / ((range.end - range.first) * audio.channels.length)), tp = truePeak(audio.channels, audio.sampleRate);
    r.peakDbfs = peak > 0 ? 20 * Math.log10(peak) : null;
    r.rmsDbfs = rms > 1e-8 ? 20 * Math.log10(rms) : null;
    r.truePeakDbtp = tp > 0 ? 20 * Math.log10(tp) : null;
    r.integratedLufs = integratedLoudness(loudnessChunks(audio.channels.map(c => c.subarray(range.first, range.end)), audio.sampleRate));
    r.fullScaleFraction = full / (audio.channels.length * audio.channels[0].length);
    if (r.integratedLufs === null) { states.add("failed"); run.error = "A comparison passage is silent. Choose active vocal/instrumental passages."; }
  }
  /** The vocal (this candidate's stem) against the beat and in the song, for one passage. */
  /** Candidates are measured over the baseline's singing (see `VocalAnalysis.sounding`). */
  private async analyse(projectId: string, run: VocalMixRun, candidate: VocalCandidate, passage: number) {
    const r = candidate.renders[passage], acc = run.accompaniment.renders[passage];
    if (!r.stemArtifactId) throw new HttpError(409, `The vocal made no sound in passage ${passage + 1}. Choose passages where it sings.`);
    const [mixArt, stemArt, accArt] = await Promise.all([r.artifactId!, r.stemArtifactId, acc.artifactId!].map(id => this.audio.artifact(projectId, id)));
    const [mix, stem, beat] = await Promise.all([mixArt, stemArt, accArt].map(a => readWav(this.audio.audioFile(projectId, a.id))));
    const range = passageFrames(mixArt)!, accRange = passageFrames(accArt)!, length = Math.min(range.end - range.first, accRange.end - accRange.first);
    const body = (audio: { channels: Float32Array[] }, from: number) => audio.channels.map(c => c.subarray(from, from + length));
    const reference = candidate.id === "baseline" ? undefined : run.candidates[0].analyses[passage]?.sounding;
    return analyseVocal(body(stem, range.first), body(beat, accRange.first), body(mix, range.first), mix.sampleRate, reference);
  }
  async get(projectId: string, id: unknown) {
    return this.mutations(async () => {
      const run = await this.read(projectId, id);
      if (run.status !== "analysing" && run.status !== "rendering" && run.status !== "interrupted") return run;
      const states = new Set<string>();
      for (const [i, acc] of run.accompaniment.renders.entries()) {
        const s = this.state(projectId, acc.jobId, run);
        states.add(s);
        if (s === "done") acc.artifactId = this.audio.get(projectId, acc.jobId).result!.artifactIds[0];
        void i;
      }
      for (const c of run.candidates) for (let p = 0; p < c.renders.length; p++) await this.advanceRender(projectId, run, c, p, states);
      const stopped = states.has("failed") ? "failed" : states.has("interrupted") ? "interrupted" : null;
      if (stopped || states.has("pending")) {
        if (stopped) run.status = stopped;
        await this.save(run);
        return run;
      }
      const song = (await this.baseSong(projectId, run.baseSnapshotId)).song;
      const baseline = run.candidates[0];
      try {
        if (run.candidates.length === 1 && !run.findings) {
          // The baseline is measured: what does it show, and what's worth trying?
          const analyses = await Promise.all([0, 1].map(p => this.analyse(projectId, run, baseline, p)));
          baseline.analyses = analyses;
          const track = getMixerTrack(song, run.vocalTrackId)!;
          const measured = proposeVocalChanges(analyses, faderDbOf(track.volume), run.level);
          run.findings = measured.findings;
          run.mixRun = stepped(advanceRun(run.mixRun, "hypothesise", Date.now()));
          run.mixRun = stepped(advanceRun(run.mixRun, "propose", Date.now()));
          const proposals = run.requested
            ? run.requested.map((r, i) => ({ id: `custom${i + 1}`, label: r.label, reasons: r.reasons, change: r.change, source: "assistant" as const }))
            : measured.proposals.map(p => ({ ...p, source: "measured" as const }));
          if (!proposals.length) {
            run.conclusion = run.requested ? "Measured only: no candidates were asked for." : `Nothing measured passes its starting point in both passages (the vocal within ${VOCAL_THRESHOLDS.levelTolerance} LU of ${VOCAL_LEVEL_TARGETS[run.level]} LU against the beat, phrases, mud, rumble, harshness, sibilance and masking under their thresholds). Keeping the current mix is the measured answer.`;
            run.mixRun = stepped(advanceRun(run.mixRun, "abandoned", Date.now(), "no-change"));
            this.finish(run);
          } else {
            for (const proposal of proposals) {
              const candidate: VocalCandidate = { ...proposal, snapshotId: "", renders: [], analyses: [null, null], effects: [] };
              const snapshot = await this.audio.forkSnapshot(projectId, run.baseSnapshotId, candidateSong(song, run, candidate));
              candidate.snapshotId = snapshot.snapshot.id;
              run.mixRun = stepped(addCandidate(run.mixRun, candidate.id, Date.now()));
              for (const p of run.passages) { candidate.renders.push(newRender((await this.render(projectId, candidate.snapshotId, p, run.vocalTrackId)).id)); this.charge(run, song, p); }
              run.candidates.push(candidate);
            }
            run.mixRun = stepped(advanceRun(run.mixRun, "render", Date.now()));
            run.status = "rendering";
            this.watch(projectId, run.id);
          }
        } else {
          // Every candidate is rendered: what did each do against the baseline?
          for (const c of run.candidates.slice(1)) {
            c.analyses = await Promise.all([0, 1].map(p => this.analyse(projectId, run, c, p)));
            c.effects = candidateEffects(baseline.analyses, c.analyses, run.level);
          }
          run.mixRun = stepped(advanceRun(run.mixRun, "compare", Date.now()));
          // One revision: a compressor or EQ that moved the vocal's level (more than its fader meant) is rendered
          // again with its fader making up the difference, so the comparison is of tone and dynamics, not of loudness.
          const matches = run.levelMatched ? [] : run.candidates.slice(1).map(c => ({ c, m: levelMatch(baseline.analyses, c) })).filter(x => x.m && (() => {
            try { applyVocalChange(song, run.vocalTrackId, { ...x.c.change!, faderDb: x.m!.faderDb }, "fx_check"); return true; } catch { return false; }
          })());
          run.levelMatched = true;
          if (matches.length && run.mixRun.usage.revisionRounds < run.mixRun.budgets.maxRevisionRounds) {
            run.mixRun = stepped(advanceRun(run.mixRun, "propose", Date.now()));
            for (const { c, m } of matches) {
              c.change = { ...c.change!, faderDb: m!.faderDb };
              c.levelMatchedLu = m!.driftLu;
              c.reasons = [...c.reasons, `Level-matched: its first render moved the vocal ${m!.driftLu > 0 ? "up" : "down"} ${Math.abs(m!.driftLu).toFixed(1)} LU more than its fader meant, so its fader is now ${m!.faderDb > 0 ? "+" : ""}${m!.faderDb} dB.`];
              c.snapshotId = (await this.audio.forkSnapshot(projectId, run.baseSnapshotId, candidateSong(song, run, c))).snapshot.id;
              c.renders = [];
              c.analyses = [null, null];
              c.effects = [];
              for (const p of run.passages) { c.renders.push(newRender((await this.render(projectId, c.snapshotId, p, run.vocalTrackId)).id)); this.charge(run, song, p); }
            }
            run.mixRun = stepped(advanceRun(run.mixRun, "render", Date.now()));
            run.status = "rendering";
            this.watch(projectId, run.id);
          } else {
            run.mixRun = stepped(advanceRun(run.mixRun, "present", Date.now()));
            this.finish(run);
          }
        }
      } catch (error) {
        run.status = "failed"; run.error = error instanceof Error ? error.message : String(error);
      }
      await this.save(run);
      return run;
    });
  }
  /** Ready: every render's playback gain, per passage. */
  private finish(run: VocalMixRun) {
    for (let p = 0; p < 2; p++) {
      const rows = run.candidates.map(c => c.renders[p]), gains = auditionGains(rows);
      rows.forEach((row, i) => { row.auditionGainDb = gains[i]; });
    }
    run.status = "ready"; run.error = null;
  }
  async cancel(projectId: string, id: unknown) {
    return this.mutations(async () => {
      const run = await this.read(projectId, id); run.status = "cancelled";
      for (const jobId of this.jobsOf(run)) if (["queued", "running"].includes(this.audio.get(projectId, jobId).status)) await this.audio.cancel(projectId, jobId);
      if (!["accepted", "discarded", "abandoned"].includes(run.mixRun.phase)) run.mixRun = stepped(advanceRun(run.mixRun, "abandoned", Date.now(), "failed"));
      await this.save(run); return run;
    });
  }
  async retry(projectId: string, id: unknown) {
    return this.mutations(async () => {
      const run = await this.read(projectId, id);
      if (run.status === "cancelled" || run.status === "preparing" || !run.candidates.length) throw new HttpError(409, "Start a fresh comparison.");
      for (const jobId of this.jobsOf(run)) if (["failed", "interrupted"].includes(this.audio.get(projectId, jobId).status)) await this.audio.retry(projectId, jobId);
      run.status = run.candidates.length > 1 ? "rendering" : "analysing"; run.error = null; await this.save(run); this.watch(projectId, run.id); return run;
    });
  }
  /** The person's choice, once the tab committed it (or kept the mix): the run's outcome. */
  async conclude(projectId: string, input: Record<string, unknown>) {
    return this.mutations(async () => {
      const run = await this.read(projectId, input.runId);
      const candidate = run.candidates.find(c => c.id === input.candidateId);
      if (!candidate) throw new HttpError(400, `Choose one of ${run.candidates.map(c => c.id).join(", ")}.`);
      run.chosen = { candidateId: candidate.id, at: Date.now() };
      if (run.mixRun.phase === "present") run.mixRun = stepped(advanceRun(run.mixRun, candidate.change ? "accepted" : "discarded", Date.now(), candidate.change ? "improved" : "no-change"));
      await this.save(run); return run;
    });
  }
  async tool(projectId: string, name: string, input: Record<string, unknown>) {
    if (name === "get_vocal_mixing_workflow") {
      this.folder(projectId);
      return { id: "vocal-balance-v2", prerequisites: ["The vocal on a mixer insert of its own (not soloed or muted), the beat on others", "Built-in plugins only", "Two nonoverlapping passages of 5–20 seconds where the vocal sings"],
        steps: ["Capture the song (capture_audio_snapshot)", "create_vocal_mix_run: the beat (vocal muted) and the song with the vocal's stem are rendered and measured; changes are proposed from the measurements, or pass your own candidates", "Poll get_vocal_mix_run: findings, then each candidate's measured effects", "review_vocal_mix_run: the person listens at matched loudness", "apply_vocal_mix_candidate with their choice (one undo step), or keep the baseline"],
        measured: ["The vocal against the beat (LU, median while singing; targets: forward -1, balanced -3, blended -6)", "How often the beat is 6 dB or more over the vocal at 1–4 kHz", "Phrase spread (momentary loudness P90 − P10)", "Mud, rumble, harshness, sibilance from the vocal's own spectrum", "Mix loudness (LUFS) and true peak"],
        thresholds: VOCAL_THRESHOLDS, levels: VOCAL_LEVEL_TARGETS,
        limitations: ["Thresholds and level targets are stated starting points, not standards or taste", "A finding counts only when both passages show it", "Only the vocal's own insert changes: its fader, one compressor (YT-C clean), one EQ (YT-EQ, up to four bands)", "Measurements, not listening: the person decides by ear"] };
    }
    if (name === "create_vocal_mix_run") return this.create(projectId, input);
    if (name === "get_vocal_mix_run") return this.get(projectId, input.runId);
    if (name === "cancel_vocal_mix_run") return this.cancel(projectId, input.runId);
    if (name === "retry_vocal_mix_run") return this.retry(projectId, input.runId);
    if (name === "conclude_vocal_mix_run") return this.conclude(projectId, input);
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
