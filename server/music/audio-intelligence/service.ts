/** Server-owned, project-scoped audio jobs. Manifests survive tabs and process restarts. */
import fs from "node:fs/promises";
import path from "node:path";
import { createId } from "../../../shared/ids.ts";
import { createArtifact, validateArtifact } from "../../../shared/music/audio-intelligence/artifact.ts";
import { validateEvidence } from "../../../shared/music/audio-intelligence/evidence.ts";
import { applyJobAction, createJob, idempotencyKey, recoverJobs, validateJob, type JobAction } from "../../../shared/music/audio-intelligence/job.ts";
import { documentHashes, validateSnapshot, type SnapshotBundle } from "../../../shared/music/audio-intelligence/snapshot.ts";
import { PRIVATE_USE, type AudioArtifact, type AudioJob, type EvidenceReport } from "../../../shared/music/audio-intelligence/types.ts";
import type { Validation } from "../../../shared/music/audio-intelligence/validation.ts";
import { createMusicProject, normalizeMusicProject } from "../../../shared/music/project.ts";
import { compileSong } from "../../../shared/music/compile.ts";
import { songSeconds } from "../../../shared/music/tempo.ts";
import type { MusicProject } from "../../../shared/music/types.ts";
import { createLimiter } from "../../queue.ts";
import { HttpError, isObject, isValidId, writeJson } from "../../storage.ts";
import type { AudioEngine, SamplePath } from "../engine.ts";
import { readWav } from "../wav.ts";
import { hashStream } from "./files.ts";
import { measureAudio } from "./measure.ts";
import { captureSnapshot } from "./snapshot.ts";

export const AUDIO_SERVER_TOOLS = ["render_audio_passage", "analyse_audio_artifact", "get_audio_job", "cancel_audio_job", "retry_audio_job", "get_audio_report", "register_audio_artifact"] as const;
const checked = <T>(result: Validation<T>): T => { if (!result.ok) throw new HttpError(409, result.errors.join("; ")); return result.value; };
const read = async (file: string): Promise<unknown> => {
  try { return JSON.parse(await fs.readFile(file, "utf8")); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") throw new HttpError(404, "No such audio record in this project.");
    throw error;
  }
};
const safeId = (value: unknown): string => { if (typeof value !== "string" || !/^[A-Za-z0-9_-]{1,100}$/.test(value)) throw new HttpError(400, "Invalid record id."); return value; };
interface RenderPlan { snapshotId: string; startTick: number; endTick: number; leadInTicks: number; tailSeconds: number }
type Plan = { kind: "render"; params: RenderPlan } | { kind: "analyse"; artifactId: string };
interface StoredJob { job: AudioJob; plan: Plan }
export interface AudioIntelligenceOptions {
  root: string;
  engine: Pick<AudioEngine, "devices" | "renderExport">;
  projectDir: (id: string) => string;
  samplePath: SamplePath;
  isMusicProject: (id: string) => boolean;
}

export class AudioIntelligence {
  private readonly jobs = new Map<string, StoredJob>();
  private readonly controllers = new Map<string, AbortController>();
  private readonly work = createLimiter(1);
  private readonly mutations = createLimiter(1);
  private stopped = false;
  constructor(private readonly options: AudioIntelligenceOptions) {}

  private folder(projectId: string) {
    if (!isValidId(projectId) || !this.options.isMusicProject(projectId)) throw new HttpError(404, "No such music project.");
    return path.join(this.options.root, projectId);
  }
  private file(projectId: string, kind: string, id: unknown) { return path.join(this.folder(projectId), kind, `${safeId(id)}.json`); }
  private jobFile(job: AudioJob) { return this.file(job.projectId, "jobs", job.id); }

  async init() {
    await fs.mkdir(this.options.root, { recursive: true });
    for (const projectId of await fs.readdir(this.options.root)) {
      if (!isValidId(projectId) || !this.options.isMusicProject(projectId)) continue;
      const folder = path.join(this.folder(projectId), "jobs");
      for (const file of await fs.readdir(folder).catch(error => {
        if (error.code === "ENOENT") return [] as string[];
        throw error;
      })) {
        if (!file.endsWith(".json")) continue;
        const stored = await read(path.join(folder, file));
        if (!isObject(stored)) throw new Error("Invalid audio job manifest.");
        const job = checked(validateJob(stored.job));
        if (job.projectId !== projectId || `${job.id}.json` !== file) throw new Error("Audio job scope mismatch.");
        const plan = this.parsePlan(stored.plan);
        const kind = plan.kind === "render" ? "render" : "analyse";
        const inputs = plan.kind === "render" ? [plan.params.snapshotId] : [plan.artifactId];
        if (job.kind !== kind || job.idempotencyKey !== idempotencyKey(kind, projectId, inputs, plan) || JSON.stringify(job.inputs) !== JSON.stringify(inputs)) throw new Error("Audio job request does not match its identity.");
        const recovered = recoverJobs([job], Date.now())[0] ?? job;
        this.jobs.set(job.id, { job: recovered, plan });
        if (recovered !== job) await this.persist(recovered.id);
      }
    }
    for (const stored of this.jobs.values()) if (stored.job.status === "queued") this.schedule(stored.job.id);
  }

  async capture(projectId: string, body: unknown): Promise<SnapshotBundle> {
    this.folder(projectId);
    if (!isObject(body) || !isObject(body.song)) throw new HttpError(400, "Capture needs the current song document.");
    const song = normalizeMusicProject(body.song);
    const devices = await this.options.engine.devices();
    const bundle = await captureSnapshot({ projectId, document: song, projectDir: this.options.projectDir(projectId), samplePath: id => this.options.samplePath(projectId, id),
      render: { sampleRate: devices.status.sampleRate, channelLayout: "stereo", mode: "song", resampling: "sinc", engineVersion: null },
      capture: { origin: body.live === true ? "live-document" : "saved-document", unsavedEdits: body.live === true ? null : false } });
    checked(validateSnapshot(bundle.snapshot));
    const folder = path.join(this.folder(projectId), "snapshots", bundle.snapshot.id);
    await fs.mkdir(folder, { recursive: true });
    // Copy the exact source bytes now. A later source edit must not change the render's inputs.
    for (const media of bundle.snapshot.media) {
      if (media.sha256 === null) continue;
      const source = this.options.samplePath(projectId, media.id);
      if (!source) throw new HttpError(409, "A captured source disappeared.");
      const target = path.join(folder, `${media.sha256}${path.extname(source)}`);
      const temp = `${target}.${createId("copy")}`;
      try {
        await fs.copyFile(source, temp);
        if ((await hashStream(temp)).sha256 !== media.sha256) throw new HttpError(409, "A source changed during snapshot capture. Capture again.");
        await fs.rename(temp, target);
      } finally { await fs.rm(temp, { force: true }); }
    }
    const manifest = this.file(projectId, "snapshots", bundle.snapshot.id);
    await this.immutableJson(manifest, bundle);
    return bundle;
  }

  async snapshot(projectId: string, id: unknown): Promise<SnapshotBundle> {
    const input = await read(this.file(projectId, "snapshots", id));
    if (!isObject(input) || !isObject(input.content)) throw new HttpError(409, "Invalid snapshot bundle.");
    const snapshot = checked(validateSnapshot(input.snapshot));
    if (snapshot.projectId !== projectId || snapshot.id !== id) throw new HttpError(409, "Snapshot scope mismatch.");
    const content = input.content as unknown as SnapshotBundle["content"];
    if (documentHashes(content).sha256 !== snapshot.document.sha256) throw new HttpError(409, "Snapshot document changed on disk.");
    return { snapshot, content };
  }

  async artifact(projectId: string, id: unknown) {
    const artifact = checked(validateArtifact(await read(this.file(projectId, "artifacts", id))));
    if (artifact.id !== id) throw new HttpError(409, "Artifact identity mismatch.");
    return artifact;
  }
  audioFile(projectId: string, id: unknown) { return path.join(this.folder(projectId), "audio", `${safeId(id)}.wav`); }
  async report(projectId: string, id: unknown): Promise<EvidenceReport> {
    const input = checked(validateEvidence(await read(this.file(projectId, "reports", id))));
    if (input.id !== id) throw new HttpError(409, "Report identity mismatch.");
    const artifacts = new Map<string, AudioArtifact>();
    for (const ref of input.artifactRefs) artifacts.set(ref.id, await this.artifact(projectId, ref.id));
    return checked(validateEvidence(input, { artifacts }));
  }

  async register(projectId: string, mediaId: unknown) {
    this.folder(projectId);
    const source = this.options.samplePath(projectId, safeId(mediaId));
    if (!source || path.extname(source).toLowerCase() !== ".wav") throw new HttpError(400, "Register a WAV from this project's media. Other formats aren't supported yet.");
    await fs.mkdir(this.folder(projectId), { recursive: true });
    const temp = path.join(this.folder(projectId), `${createId("registration")}.wav`);
    try {
      await fs.copyFile(source, temp);
      const audio = await this.decode(temp);
      const content = await hashStream(temp);
      const artifact = createArtifact({ contentSha256: content.sha256, bytes: content.bytes, role: "source-media", format: { sampleRate: audio.sampleRate, channels: audio.channels.length, frames: audio.channels[0].length, sampleFormat: await this.sampleFormat(temp) }, snapshotId: null, tap: { kind: "media", id: String(mediaId) }, passage: null, render: null, derivedFrom: null, transforms: [], jobId: null, recordingFamilyId: `project_${projectId}`, permissions: { ...PRIVATE_USE }, createdAt: Date.now() });
      await this.storeArtifact(projectId, artifact, temp);
      return artifact;
    } finally { await fs.rm(temp, { force: true }); }
  }

  private parseRender(input: unknown): RenderPlan {
    if (!isObject(input)) throw new HttpError(400, "Invalid passage.");
    const tick = (value: unknown, fallback?: number) => {
      if (value === undefined && fallback !== undefined) return fallback;
      if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0 || value > 100_000_000) throw new HttpError(400, "Passage ticks must be nonnegative integers.");
      return value;
    };
    const startTick = tick(input.startTick), endTick = tick(input.endTick);
    if (endTick <= startTick) throw new HttpError(400, "A passage must end after it starts.");
    const tailSeconds = input.tailSeconds === undefined ? 5 : input.tailSeconds;
    if (typeof tailSeconds !== "number" || !Number.isFinite(tailSeconds) || tailSeconds < 0 || tailSeconds > 10) throw new HttpError(400, "Tail must be 0 to 10 seconds.");
    return { snapshotId: safeId(input.snapshotId), startTick, endTick, leadInTicks: tick(input.leadInTicks, 768), tailSeconds };
  }
  private parsePlan(input: unknown): Plan {
    if (!isObject(input)) throw new HttpError(400, "Invalid audio job plan.");
    if (input.kind === "render") return { kind: "render", params: this.parseRender(input.params) };
    if (input.kind === "analyse") return { kind: "analyse", artifactId: safeId(input.artifactId) };
    throw new HttpError(400, "Unknown audio operation.");
  }

  async start(projectId: string, plan: Plan): Promise<AudioJob> {
    return this.mutations(async () => {
      if (this.stopped) throw new HttpError(503, "Audio jobs are shutting down.");
      this.folder(projectId);
      plan = this.parsePlan(plan);
      const inputs = plan.kind === "render" ? [plan.params.snapshotId] : [plan.artifactId];
      if (plan.kind === "render") {
        const bundle = await this.snapshot(projectId, plan.params.snapshotId);
        if (bundle.snapshot.plugins.some(p => p.storage !== "document")) throw new HttpError(409, "Analysis renders currently support built-in processors only. Outside plugin state restoration isn't verified.");
        if (bundle.snapshot.media.some(m => m.sha256 === null)) throw new HttpError(409, "Snapshot has missing or unreadable media.");
        const song = { ...createMusicProject(), ...bundle.content };
        const from = Math.max(0, plan.params.startTick - plan.params.leadInTicks);
        if (songSeconds(song, plan.params.endTick) - songSeconds(song, from) + plan.params.tailSeconds > 120) throw new HttpError(400, "Analysis renders are limited to 120 seconds including lead-in and tail.");
      } else await this.artifact(projectId, plan.artifactId);
      const job = createJob({ id: createId("audjob"), kind: plan.kind === "render" ? "render" : "analyse", projectId, inputs, params: plan, stages: plan.kind === "render" ? ["render", "register"] : ["measure"], now: Date.now() });
      const prior = [...this.jobs.values()].find(s => s.job.projectId === projectId && s.job.idempotencyKey === job.idempotencyKey && s.job.status !== "cancelled");
      if (prior) return structuredClone(prior.job);
      this.jobs.set(job.id, { job, plan });
      await this.persist(job.id);
      this.schedule(job.id);
      return structuredClone(job);
    });
  }
  get(projectId: string, id: unknown): AudioJob {
    this.folder(projectId);
    const stored = this.jobs.get(safeId(id));
    if (!stored || stored.job.projectId !== projectId) throw new HttpError(404, "No such audio job in this project.");
    return structuredClone(stored.job);
  }
  async cancel(projectId: string, id: unknown) {
    const job = this.get(projectId, id);
    await this.change(job.id, { type: "cancel" });
    this.controllers.get(job.id)?.abort(new Error("Audio job cancelled."));
    return this.get(projectId, id);
  }
  async retry(projectId: string, id: unknown) {
    const job = this.get(projectId, id);
    await this.change(job.id, { type: "retry" });
    this.schedule(job.id);
    return this.get(projectId, id);
  }
  shutdown() { this.stopped = true; for (const controller of this.controllers.values()) controller.abort(new Error("Server stopped.")); }

  private async persist(id: string) {
    const stored = this.jobs.get(id)!;
    checked(validateJob(stored.job));
    const file = this.jobFile(stored.job);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await writeJson(file, stored);
  }
  private async change(id: string, action: JobAction) {
    await this.mutations(async () => {
      const stored = this.jobs.get(id)!;
      const effective = action.type === "succeed" && stored.job.cancelRequested ? { type: "cancelled" as const } : action;
      const step = applyJobAction(stored.job, effective, Date.now());
      if (!step.ok) throw new HttpError(409, step.error);
      stored.job = step.job;
      await this.persist(id);
    });
  }
  private schedule(id: string) { void this.work(() => this.execute(id)).catch(error => console.error("[audio-intelligence] job persistence failed", error)); }
  private async execute(id: string) {
    const stored = this.jobs.get(id)!;
    if (this.stopped || stored.job.status !== "queued") return;
    const controller = new AbortController(); this.controllers.set(id, controller);
    const signal = controller.signal;
    const projectId = stored.job.projectId;
    const temp = path.join(this.folder(projectId), "work", id);
    try {
      await this.change(id, { type: "start" });
      await fs.mkdir(temp, { recursive: true });
      signal.throwIfAborted();
      if (stored.plan.kind === "render") {
        const params = stored.plan.params;
        const bundle = await this.snapshot(projectId, params.snapshotId);
        const song: MusicProject = { ...createMusicProject(), ...bundle.content };
        const mediaFolder = path.join(this.folder(projectId), "snapshots", bundle.snapshot.id);
        const files = await fs.readdir(mediaFolder);
        const sources = new Map<string, string>();
        for (const media of bundle.snapshot.media) {
          const file = files.find(f => f.startsWith(`${media.sha256}.`) && !f.includes("copy_"));
          if (!file || (await hashStream(path.join(mediaFolder, file))).sha256 !== media.sha256) throw new Error("Immutable snapshot media is missing or changed.");
          sources.set(media.id, path.join(mediaFolder, file));
        }
        const from = Math.max(0, params.startTick - params.leadInTicks);
        await this.change(id, { type: "progress", stage: "render", progress: 0 });
        let progress = 0;
        const result = await this.options.engine.renderExport({ id, projectId, song, patternId: null, mode: "song", loop: { start: from, end: params.endTick }, resampling: "sinc", folder: temp, mix: true, stems: false, tail: params.tailSeconds > 0 ? "ring" : "cut", maxTail: params.tailSeconds, samplePath: (_project, media) => sources.get(media) ?? null }, (done, frames) => {
          const next = frames > 0 ? Math.min(0.99, done / frames) : 0;
          if (next >= progress + 0.1) { progress = next; void this.change(id, { type: "progress", stage: "render", progress: next }).catch(() => {}); }
        }, signal);
        signal.throwIfAborted();
        if (result.state !== "done") throw new Error("Render was aborted.");
        if (result.sampleRate !== bundle.snapshot.render.sampleRate) throw new Error("Engine sample rate changed after capture. Capture a new snapshot.");
        const mix = result.files.find(f => f.id === "mix") ?? result.files[0];
        if (!mix) throw new Error("Engine returned no mix audio.");
        const audio = await this.decode(mix.file);
        const content = await hashStream(mix.file);
        const leadInFrames = Math.round((songSeconds(song, params.startTick) - songSeconds(song, from)) * result.sampleRate);
        const compiled = compileSong(song, null, { start: from, end: params.endTick }, "song");
        const bodyFrames = Math.ceil(compiled.loopTicks * 60 * result.sampleRate / (compiled.tempo * compiled.ppq));
        if (audio.channels[0].length < bodyFrames || audio.channels[0].length !== result.frames) throw new Error("Rendered length does not match the requested passage.");
        const artifact = createArtifact({ contentSha256: content.sha256, bytes: content.bytes, role: "mix", format: { sampleRate: audio.sampleRate, channels: audio.channels.length, sampleFormat: await this.sampleFormat(mix.file), frames: result.frames }, snapshotId: bundle.snapshot.id, tap: { kind: "master", id: null }, passage: { startTick: params.startTick, endTick: params.endTick, startSeconds: songSeconds(song, params.startTick), leadInFrames, tailFrames: result.frames - bodyFrames }, render: { start: "cold", blockSize: null, latencySeconds: result.latency / result.sampleRate, tail: { mode: params.tailSeconds > 0 ? "ringOut" : "cut", maxSeconds: params.tailSeconds }, plugins: bundle.snapshot.plugins.map(p => ({ ownerId: p.owner.id, load: "unknown" })), missingPlugins: result.missing }, derivedFrom: null, transforms: [], jobId: id, recordingFamilyId: `project_${projectId}`, permissions: { ...PRIVATE_USE }, createdAt: Date.now() });
        await this.change(id, { type: "progress", stage: "register", progress: 0 });
        signal.throwIfAborted();
        await this.storeArtifact(projectId, artifact, mix.file);
        signal.throwIfAborted();
        await this.change(id, { type: "succeed", result: { artifactIds: [artifact.id], snapshotIds: [bundle.snapshot.id], evidenceIds: [] } });
      } else {
        const artifact = await this.artifact(projectId, stored.plan.artifactId);
        const file = this.audioFile(projectId, artifact.id);
        if ((await hashStream(file)).sha256 !== artifact.contentSha256) throw new Error("Registered audio changed on disk.");
        await this.change(id, { type: "progress", stage: "measure", progress: 0 });
        const report = await measureAudio(artifact, await this.decode(file), signal);
        checked(validateEvidence(report, { artifacts: new Map([[artifact.id, artifact]]) }));
        signal.throwIfAborted();
        await this.immutableJson(this.file(projectId, "reports", report.id), report);
        signal.throwIfAborted();
        await this.change(id, { type: "succeed", result: { artifactIds: [artifact.id], snapshotIds: artifact.snapshotId ? [artifact.snapshotId] : [], evidenceIds: [report.id] } });
      }
    } catch (error) {
      const job = this.jobs.get(id)!.job;
      if (job.status === "running") await this.change(id, job.cancelRequested ? { type: "cancelled" } : this.stopped ? { type: "interrupt" } : { type: "fail", error: { message: error instanceof Error ? error.message : String(error), retryable: error instanceof HttpError && error.status >= 500 } });
    } finally { this.controllers.delete(id); await fs.rm(temp, { recursive: true, force: true }); }
  }

  private async immutableJson(file: string, value: unknown) {
    await fs.mkdir(path.dirname(file), { recursive: true });
    const temp = `${file}.${createId("write")}.tmp`;
    try {
      await fs.writeFile(temp, JSON.stringify(value));
      await fs.link(temp, file).catch(error => { if (error.code !== "EEXIST") throw error; });
    } finally { await fs.rm(temp, { force: true }); }
  }
  private async storeArtifact(projectId: string, artifact: AudioArtifact, source: string) {
    checked(validateArtifact(artifact));
    const target = this.audioFile(projectId, artifact.id);
    await fs.mkdir(path.dirname(target), { recursive: true });
    const temp = `${target}.${createId("write")}.tmp`;
    try {
      await fs.copyFile(source, temp);
      if ((await hashStream(temp)).sha256 !== artifact.contentSha256) throw new Error("Audio changed during registration.");
      await fs.link(temp, target).catch(async error => {
        if (error.code !== "EEXIST") throw error;
        if ((await hashStream(target)).sha256 !== artifact.contentSha256) throw new Error("Registered audio is corrupted.");
      });
    } finally { await fs.rm(temp, { force: true }); }
    await this.immutableJson(this.file(projectId, "artifacts", artifact.id), artifact);
  }
  private async sampleFormat(file: string): Promise<AudioArtifact["format"]["sampleFormat"]> {
    const bytes = await fs.readFile(file);
    if (bytes.length < 12 || bytes.toString("ascii", 0, 4) !== "RIFF" || bytes.toString("ascii", 8, 12) !== "WAVE") throw new Error("Only RIFF WAV audio is supported.");
    const end = bytes.readUInt32LE(4) + 8;
    if (end > bytes.length || end < 12) throw new Error("Truncated WAV.");
    let format: AudioArtifact["format"]["sampleFormat"] | null = null;
    let alignment = 0;
    let dataBytes: number | null = null;
    for (let at = 12; at < end;) {
      if (at + 8 > end) throw new Error("Truncated WAV chunk header.");
      const size = bytes.readUInt32LE(at + 4), body = at + 8;
      if (body + size > end) throw new Error("Truncated WAV chunk.");
      const kind = bytes.toString("ascii", at, at + 4);
      if (kind === "fmt ") {
        if (size < 16 || format) throw new Error("Invalid WAV format chunk.");
        const channels = bytes.readUInt16LE(body + 2), rate = bytes.readUInt32LE(body + 4);
        if (channels < 1 || channels > 2 || rate < 8000 || rate > 384000) throw new Error("Unsupported WAV channel count or sample rate.");
        let tag = bytes.readUInt16LE(body);
        const bits = bytes.readUInt16LE(body + 14);
        if (tag === 0xfffe && size >= 40) tag = bytes.readUInt16LE(body + 24);
        if (tag === 3 && bits === 32) format = "float32";
        else if (tag === 1 && bits === 16) format = "pcm16";
        else if (tag === 1 && bits === 24) format = "pcm24";
        else throw new Error("Supported WAV encodings: PCM16, PCM24, float32.");
        alignment = channels * bits / 8;
        if (bytes.readUInt16LE(body + 12) !== alignment || bytes.readUInt32LE(body + 8) !== rate * alignment) throw new Error("Invalid WAV sample alignment.");
      }
      if (kind === "data") {
        if (!format || dataBytes !== null) throw new Error("WAV data must follow a single format chunk.");
        dataBytes = size;
      }
      at = body + size + size % 2;
    }
    if (!format || !dataBytes || dataBytes % alignment !== 0) throw new Error("WAV has no complete audio frames.");
    return format;
  }
  private async decode(file: string) {
    if ((await fs.stat(file)).size > 128 * 1024 * 1024) throw new HttpError(400, "Audio analysis is limited to 128 MiB per artifact.");
    await this.sampleFormat(file);
    const audio = await readWav(file);
    if (audio.channels.length < 1 || audio.channels.length > 2 || !audio.channels[0].length || audio.channels[0].length / audio.sampleRate > 120) throw new HttpError(400, "Analysis supports nonempty mono/stereo WAVs up to 120 seconds.");
    return audio;
  }

  async tool(projectId: string, name: string, input: Record<string, unknown>) {
    switch (name) {
      case "render_audio_passage": return this.start(projectId, { kind: "render", params: this.parseRender(input) });
      case "analyse_audio_artifact": return this.start(projectId, { kind: "analyse", artifactId: safeId(input.artifactId) });
      case "get_audio_job": return this.get(projectId, input.jobId);
      case "cancel_audio_job": return this.cancel(projectId, input.jobId);
      case "retry_audio_job": return this.retry(projectId, input.jobId);
      case "get_audio_report": return this.report(projectId, input.reportId);
      case "register_audio_artifact": return this.register(projectId, input.mediaId);
      default: throw new HttpError(400, "Unknown audio tool.");
    }
  }
}
