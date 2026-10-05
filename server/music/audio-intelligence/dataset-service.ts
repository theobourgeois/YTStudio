import fs from "node:fs/promises";
import { createWriteStream, constants } from "node:fs";
import path from "node:path";
import { Transform, type Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createId } from "../../../shared/ids.ts";
import { createDatasetPackage, createDatasetReview, datasetAssetId, guessDatasetRole, parseDatasetPackage, parseDatasetReview, safePackagePath, type DatasetAsset, type DatasetPackage, type DatasetReview } from "../../../shared/music/audio-intelligence/datasets.ts";
import { createMixExample, createEngineerProfile, type MixExample } from "../../../shared/music/audio-intelligence/examples.ts";
import { createLimiter } from "../../queue.ts";
import { FFPROBE } from "../../config.ts";
import { run } from "../../process.ts";
import { HttpError, isObject, isValidId, writeJson } from "../../storage.ts";
import { hashStream } from "./files.ts";
import { inventoryPackageZip, PACKAGE_LIMITS, readPackageZipEntry } from "./package-zip.ts";
import type { ExampleLibrary } from "./example-library.ts";

export const DATASET_SERVER_TOOLS = ["list_dataset_packages", "get_dataset_package", "get_dataset_import", "cancel_dataset_import", "retry_dataset_import", "register_dataset_audio"] as const;
export interface DatasetImportJob {
  id: string; projectId: string; status: "queued" | "running" | "succeeded" | "failed" | "cancelled" | "interrupted";
  completedFiles: number; totalFiles: number | null; packageId: string | null; error: string | null; createdAt: number;
}
interface StoredImport { job: DatasetImportJob; sourcePath: string; label: string; attempts: number }
const packageId = (id: unknown): string => { if (typeof id !== "string" || !/^pack_[a-f0-9]{20}$/.test(id)) throw new HttpError(400, "Invalid package id."); return id; };
const FORMATS: Record<string, string> = { ".wav": "wav", ".wave": "wav", ".aif": "aiff", ".aiff": "aiff", ".flac": "flac", ".mp3": "mp3", ".ogg": "ogg", ".m4a": "mov" };
export const datasetAudioFormat = (name: string) => FORMATS[path.extname(name).toLowerCase()] ?? null;
const kindOf = (name: string): DatasetAsset["kind"] => datasetAudioFormat(name) ? "audio" : /\.(flp|ptx|pts|ptf|rpp|als|logicx|dawproject)$/i.test(name) ? "session" : /\.(vstpreset|fxp|fxb|tfx|bin)$/i.test(name) ? "plugin-state" : /\.(txt|md|json|xml|csv)$/i.test(name) ? "notes" : "other";

/** Ordinary packages are inventoried, never executed, loaded into a DAW, or treated as readable plugin settings. */
export class DatasetService {
  private readonly jobs = new Map<string, StoredImport>();
  private readonly controllers = new Map<string, AbortController>();
  private readonly work = createLimiter(1);
  private readonly reviews = createLimiter(1);
  private stopped = false;
  constructor(private readonly root: string, private readonly isMusicProject: (id: string) => boolean, private readonly examples: ExampleLibrary) {}
  private folder(projectId: string) {
    if (!isValidId(projectId) || !this.isMusicProject(projectId)) throw new HttpError(404, "No such music project.");
    return path.join(this.root, projectId, "datasets");
  }
  private async persist(stored: StoredImport) {
    const dir = path.join(this.folder(stored.job.projectId), "imports"); await fs.mkdir(dir, { recursive: true }); await writeJson(path.join(dir, `${stored.job.id}.json`), stored);
  }
  async init() {
    for (const projectId of await fs.readdir(this.root).catch(error => { if (error.code === "ENOENT") return []; throw error; })) {
      if (!isValidId(projectId) || !this.isMusicProject(projectId)) continue;
      const folder = path.join(this.folder(projectId), "imports");
      for (const file of await fs.readdir(folder).catch(error => { if (error.code === "ENOENT") return []; throw error; })) {
        if (!/^ingest_[a-f0-9]{12}\.json$/.test(file)) continue;
        const value = JSON.parse(await fs.readFile(path.join(folder, file), "utf8"));
        if (!isObject(value) || !isObject(value.job) || value.job.projectId !== projectId || `${value.job.id}.json` !== file || typeof value.sourcePath !== "string" || !path.isAbsolute(value.sourcePath) || typeof value.label !== "string" || !Number.isSafeInteger(value.attempts) || Number(value.attempts) < 1 || Number(value.attempts) > 3 || !["queued", "running", "succeeded", "failed", "cancelled", "interrupted"].includes(String(value.job.status))) throw new Error("Invalid dataset import record.");
        const stored = value as unknown as StoredImport;
        if (stored.job.status === "running") { stored.job.status = "interrupted"; stored.job.error = "Server stopped during import; explicit retry is available."; await this.persist(stored); }
        this.jobs.set(stored.job.id, stored);
      }
    }
    for (const stored of this.jobs.values()) if (stored.job.status === "queued") this.schedule(stored);
  }
  async importPath(projectId: string, input: unknown, label?: string): Promise<DatasetImportJob> {
    this.folder(projectId);
    if (this.stopped) throw new HttpError(409, "Dataset importer is stopping.");
    if (typeof input !== "string" || !path.isAbsolute(input)) throw new HttpError(400, "Select an absolute local folder, ZIP or audio file path.");
    const stat = await fs.lstat(input);
    if (stat.isSymbolicLink() || (!stat.isFile() && !stat.isDirectory())) throw new HttpError(400, "Import a regular file or directory, not a link/special file.");
    const displayLabel = label ?? path.basename(input);
    if (!displayLabel.trim() || displayLabel.length > 200 || /[\u0000-\u001f]/.test(displayLabel)) throw new HttpError(400, "Invalid package label.");
    const stored: StoredImport = { job: { id: createId("ingest"), projectId, status: "queued", completedFiles: 0, totalFiles: null, packageId: null, error: null, createdAt: Date.now() }, sourcePath: input, label: displayLabel, attempts: 1 };
    await this.persist(stored); this.jobs.set(stored.job.id, stored); this.schedule(stored);
    return structuredClone(stored.job);
  }
  async upload(projectId: string, body: Readable, rawName: unknown) {
    const folder = this.folder(projectId);
    if (typeof rawName !== "string" || !safePackagePath(rawName) || rawName.includes("/") || !/\.zip$/i.test(rawName)) throw new HttpError(400, "Upload an ordinary ZIP package with a filename.");
    const directory = path.join(folder, "uploads"); await fs.mkdir(directory, { recursive: true });
    const file = path.join(directory, `${createId("upload")}.zip`);
    let bytes = 0;
    const bounded = new Transform({ transform(chunk: Buffer, _encoding, callback) { bytes += chunk.length; callback(bytes > PACKAGE_LIMITS.archiveBytes ? new HttpError(413, "ZIP upload exceeds 256 MiB.") : null, chunk); } });
    try { await pipeline(body, bounded, createWriteStream(file, { flags: "wx" })); return await this.importPath(projectId, file, rawName); }
    catch (error) { await fs.rm(file, { force: true }); throw error; }
  }
  getImport(projectId: string, id: unknown) {
    this.folder(projectId); const stored = typeof id === "string" ? this.jobs.get(id) : null;
    if (!stored || stored.job.projectId !== projectId) throw new HttpError(404, "No such dataset import in this project.");
    return structuredClone(stored.job);
  }
  async cancel(projectId: string, id: unknown) {
    const job = this.getImport(projectId, id), stored = this.jobs.get(job.id)!;
    if (job.status === "queued") { stored.job.status = "cancelled"; await this.persist(stored); }
    else if (job.status === "running") this.controllers.get(job.id)?.abort(new Error("Import cancelled."));
    return this.getImport(projectId, id);
  }
  async retry(projectId: string, id: unknown) {
    const job = this.getImport(projectId, id), stored = this.jobs.get(job.id)!;
    if (!["failed", "interrupted"].includes(job.status) || stored.attempts >= 3) throw new HttpError(409, "Only failed/interrupted imports can retry, at most three attempts.");
    stored.attempts++; stored.job = { ...stored.job, status: "queued", error: null, completedFiles: 0, totalFiles: null }; await this.persist(stored); this.schedule(stored); return this.getImport(projectId, id);
  }
  private schedule(stored: StoredImport) {
    void this.work(async () => {
      if (this.stopped || stored.job.status !== "queued") return;
      const controller = new AbortController(); this.controllers.set(stored.job.id, controller);
      stored.job.status = "running";
      try { await this.persist(stored); const pack = await this.process(stored, controller.signal); controller.signal.throwIfAborted(); stored.job.status = "succeeded"; stored.job.packageId = pack.id; }
      catch (error) { stored.job.status = controller.signal.aborted ? this.stopped ? "interrupted" : "cancelled" : "failed"; stored.job.error = error instanceof Error ? error.message.slice(0, 2000) : "Package import failed."; }
      finally { await this.persist(stored); this.controllers.delete(stored.job.id); }
    }).catch(error => { stored.job.status = "failed"; stored.job.error = error instanceof Error ? error.message.slice(0, 2000) : "Import persistence failed."; });
  }
  private async putBlob(projectId: string, source: string, sha256: string) {
    const folder = path.join(this.folder(projectId), "blobs"); await fs.mkdir(folder, { recursive: true });
    const target = path.join(folder, sha256);
    try {
      if ((await hashStream(target)).sha256 !== sha256) throw new Error("Preserved package bytes changed.");
      return;
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    const temporary = `${target}.${createId("copy")}.tmp`;
    try {
      await fs.copyFile(source, temporary, constants.COPYFILE_EXCL);
      if ((await hashStream(temporary)).sha256 !== sha256) throw new Error("Source bytes changed during preservation.");
      await fs.rename(temporary, target);
    } finally { await fs.rm(temporary, { force: true }); }
  }
  private async process(stored: StoredImport, signal: AbortSignal) {
    const { projectId } = stored.job;
    const temp = path.join(this.folder(projectId), `${stored.job.id}-${createId("stage")}`); await fs.mkdir(temp, { recursive: true });
    const assets: DatasetAsset[] = [];
    let archive: DatasetPackage["archive"] = null;
    try {
      const sourceStat = await fs.lstat(stored.sourcePath);
      if (sourceStat.isSymbolicLink()) throw new Error("Source became a link; select the package again.");
      if (sourceStat.isFile() && /\.zip$/i.test(stored.sourcePath)) {
        if (sourceStat.size > PACKAGE_LIMITS.archiveBytes) throw new Error("ZIP exceeds 256 MiB.");
        const bytes = await fs.readFile(stored.sourcePath), entries = inventoryPackageZip(bytes);
        const file = path.join(temp, "archive.zip"); await fs.writeFile(file, bytes);
        const content = await hashStream(file); archive = { ...content, name: stored.label }; await this.putBlob(projectId, file, content.sha256);
        stored.job.totalFiles = entries.length;
        for (let i = 0; i < entries.length; i++) {
          signal.throwIfAborted(); const entry = entries[i], file = path.join(temp, `entry-${i}`);
          await fs.writeFile(file, await readPackageZipEntry(bytes, entry, signal));
          assets.push(await this.inspect(projectId, file, entry.name, signal));
          stored.job.completedFiles++; await this.persist(stored);
        }
      } else {
        const files: { source: string; relative: string; size: number }[] = [];
        let visited = 0;
        const visit = async (source: string, relative: string) => {
          if (++visited > PACKAGE_LIMITS.files * 2 || relative.split("/").length > 20) throw new Error("Package directory count/depth exceeds the supported limit.");
          signal.throwIfAborted(); const stat = await fs.lstat(source);
          if (stat.isSymbolicLink()) throw new Error("Package contains a symbolic link; copy its real files into the package first.");
          if (stat.isDirectory()) {
            for (const name of (await fs.readdir(source)).sort()) await visit(path.join(source, name), relative ? `${relative}/${name}` : name);
          } else if (stat.isFile()) {
            if (!safePackagePath(relative) || stat.size > PACKAGE_LIMITS.fileBytes || files.length >= PACKAGE_LIMITS.files) throw new Error("Unsafe filename, large file or too many files in package.");
            files.push({ source, relative, size: stat.size });
          } else throw new Error("Package contains a special file.");
        };
        if (sourceStat.isDirectory()) await visit(stored.sourcePath, ""); else if (sourceStat.isFile()) await visit(stored.sourcePath, path.basename(stored.sourcePath)); else throw new Error("Invalid package source.");
        if (!files.length || files.reduce((n, f) => n + f.size, 0) > PACKAGE_LIMITS.totalBytes) throw new Error("Package is empty or exceeds 512 MiB.");
        stored.job.totalFiles = files.length;
        for (let i = 0; i < files.length; i++) {
          signal.throwIfAborted(); const source = files[i], file = path.join(temp, `entry-${i}`);
          const before = await fs.lstat(source.source); if (!before.isFile() || before.isSymbolicLink() || before.size !== source.size) throw new Error("Package source changed during import.");
          const original = await hashStream(source.source); await fs.copyFile(source.source, file);
          const after = await fs.lstat(source.source), copied = await hashStream(file);
          if (!after.isFile() || after.size !== before.size || after.mtimeMs !== before.mtimeMs || original.sha256 !== copied.sha256) throw new Error("Package source changed during import.");
          assets.push(await this.inspect(projectId, file, source.relative, signal));
          stored.job.completedFiles++; await this.persist(stored);
        }
      }
      signal.throwIfAborted();
      assets.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
      const session = assets.some(a => a.kind === "session"), states = assets.some(a => a.kind === "plugin-state"), audio = assets.filter(a => a.kind === "audio");
      const pack = createDatasetPackage({ label: stored.label, assets, archive,
        coverage: [
          { category: "source-files", status: "extracted", method: "bounded inventory + SHA-256", note: "Original bytes preserved; filenames and roles are discovery hints." },
          { category: "audio-metadata", status: audio.some(a => a.error) ? "failed" : audio.length ? "extracted" : "missing", method: "FFprobe with declared audio demuxer", note: "Readable and failed audio are reported independently per file." },
          { category: "native-session", status: session ? "preserved-opaque" : "missing", method: "original-byte preservation", note: "FLP/PTX and other native formats are preserved, not decoded or rendered. No tested native extraction adapter is enabled." },
          { category: "plugin-state", status: states ? "preserved-opaque" : "missing", method: "original-byte preservation", note: "State blobs are not readable parameter values." },
          ...["parameters", "arrangement", "routing", "automation", "external-dependencies"].map(category => ({ category, status: session ? "unsupported" as const : "not-applicable" as const, method: "ordinary-package-v1", note: "No verified session/version/plugin matrix; unknown fields stay unknown." })),
        ], limitations: ["Role/song/version guesses require user review.", "Same filenames or durations do not establish raw/processed pairs or a common export origin.", "No DAW/plugin settings, engineer intent or musical quality are inferred from audio.", "Audio analysis, retrieval/display, hosted upload and training permissions are separate; import grants no hosted upload, display or training rights."] });
      const dir = path.join(this.folder(projectId), "packages"); await fs.mkdir(dir, { recursive: true });
      await writeJson(path.join(dir, `${pack.id}.json`), pack);
      return pack;
    } finally { await fs.rm(temp, { recursive: true, force: true }); }
  }
  private async inspect(projectId: string, file: string, relativePath: string, signal: AbortSignal): Promise<DatasetAsset> {
    const content = await hashStream(file), kind = kindOf(relativePath);
    await this.putBlob(projectId, file, content.sha256);
    let audio: DatasetAsset["audio"] = null, error: string | null = null;
    if (kind === "audio") {
      try {
        const json = await run(FFPROBE, ["-v", "error", "-protocol_whitelist", "file,pipe", "-f", datasetAudioFormat(relativePath)!, "-show_entries", "stream=codec_type,codec_name,sample_rate,channels,duration:format=duration", "-of", "json", file], { signal: AbortSignal.any([signal, AbortSignal.timeout(15000)]) });
        const data = JSON.parse(json), streams = Array.isArray(data.streams) ? data.streams.filter((s: Record<string, unknown>) => s.codec_type === "audio") : [];
        if (streams.length !== 1) throw new Error("Expected exactly one audio stream.");
        const s = streams[0], durationSeconds = Number(data.format?.duration ?? s.duration), sampleRate = Number(s.sample_rate), channels = Number(s.channels);
        if (!(durationSeconds > 0) || !Number.isFinite(durationSeconds) || !Number.isSafeInteger(sampleRate) || sampleRate <= 0 || !Number.isSafeInteger(channels) || channels <= 0 || typeof s.codec_name !== "string") throw new Error("Incomplete audio metadata.");
        audio = { durationSeconds, sampleRate, channels, codec: s.codec_name };
      } catch { signal.throwIfAborted(); error = "Audio metadata could not be decoded; original bytes are preserved."; }
    }
    const parts = relativePath.split("/"), folder = parts.length > 1 ? parts.slice(0, -1).join("/") : null;
    return { id: datasetAssetId(content.sha256, relativePath), relativePath, ...content, kind, guessedRole: kind === "audio" ? guessDatasetRole(path.basename(relativePath)) : "unknown", guessedSong: folder, guessedVersion: /(?:^|[ _-])(v\d+|mix\d+|rev\d+)(?:[ _.-]|$)/i.exec(relativePath)?.[1] ?? null, audio, error };
  }
  async list(projectId: string) {
    const dir = path.join(this.folder(projectId), "packages");
    const files = await fs.readdir(dir).catch(error => { if (error.code === "ENOENT") return []; throw error; });
    const summaries = [];
    for (const file of files) if (/^pack_[a-f0-9]{20}\.json$/.test(file)) { const pack = await this.get(projectId, file.slice(0, -5)); summaries.push({ id: pack.id, label: pack.label, files: pack.assets.length, readableAudio: pack.assets.filter(a => a.audio).length, coverage: pack.coverage }); }
    return summaries;
  }
  async get(projectId: string, id: unknown): Promise<DatasetPackage> {
    const file = path.join(this.folder(projectId), "packages", `${packageId(id)}.json`);
    try { const pack = parseDatasetPackage(JSON.parse(await fs.readFile(file, "utf8"))); if (pack.id !== id) throw new Error("Package identity mismatch."); return pack; }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") throw new HttpError(404, "No such dataset package in this project."); throw error; }
  }
  async review(projectId: string, id: unknown): Promise<DatasetReview | null> {
    const pack = await this.get(projectId, id), file = path.join(this.folder(projectId), "reviews", `${pack.id}.json`);
    try { return parseDatasetReview(JSON.parse(await fs.readFile(file, "utf8")), pack); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; }
  }
  async saveReview(projectId: string, id: unknown, input: unknown) {
    if (!isObject(input) || !(input.expectedRevision === null || typeof input.expectedRevision === "string") || !isObject(input.review)) throw new HttpError(400, "Provide a review and expectedRevision (null for the first review).");
    const reviewInput = input.review;
    return this.reviews(async () => {
      const pack = await this.get(projectId, id), prior = await this.review(projectId, id);
      if ((prior?.revision ?? null) !== input.expectedRevision) throw new HttpError(409, "Package review changed; reload before saving.");
      const next = createDatasetReview({ ...reviewInput, packageId: pack.id } as unknown as Omit<DatasetReview, "schema" | "revision">, pack);
      const folder = path.join(this.folder(projectId), "reviews"); await fs.mkdir(folder, { recursive: true });
      await this.examples.removePackageSources(projectId, pack.id);
      await writeJson(path.join(folder, `${pack.id}.json`), next);
      return next;
    });
  }
  async readiness(projectId: string, id: unknown) {
    const pack = await this.get(projectId, id), review = await this.review(projectId, id);
    const unresolved = pack.assets.filter(a => a.kind === "audio" && !review?.assets.some(r => r.assetId === a.id)).map(a => a.id);
    const pairings = (review?.pairs ?? []).map(p => ({ ...p, readyForEffectComparison: p.offsetSeconds !== null && p.gainDifferenceDb !== null && p.inputTap !== null && p.outputTap !== null && p.latencyReviewed,
      limitations: ["Alignment, tap points and gain differences are reviewer-supplied, not inferred ground truth."] }));
    const paired = new Set(pairings.flatMap(p => [p.inputAssetId, p.outputAssetId]));
    return { package: pack, review, readiness: { audioReady: pack.assets.some(a => a.audio && a.audio.channels <= 2), structuredSession: "unsupported", parameterReadability: "unknown", reproductionReady: false, unresolvedAssetIds: unresolved,
      unknownRoleAssetIds: review?.assets.filter(a => a.role === "unknown").map(a => a.assetId) ?? [],
      unknownTimeOriginAssetIds: review?.assets.filter(a => a.timeOriginSeconds === null).map(a => a.assetId) ?? [],
      unpairedVocalAssetIds: review?.assets.filter(a => ["raw-vocal", "processed-vocal"].includes(a.role) && !paired.has(a.assetId)).map(a => a.assetId) ?? [], pairings }, permissions: "Private/local by default; dataset hosted approval is distinct from per-song hearing permission." };
  }
  async assetFile(projectId: string, id: unknown, assetId: unknown) {
    const pack = await this.get(projectId, id), asset = pack.assets.find(a => a.id === assetId);
    if (!asset) throw new HttpError(404, "No such asset in this package.");
    const file = path.join(this.folder(projectId), "blobs", asset.sha256);
    if ((await hashStream(file)).sha256 !== asset.sha256) throw new HttpError(409, "Preserved package bytes changed.");
    const reviewed = await this.review(projectId, id);
    return { asset, file, review: reviewed?.assets.find(a => a.assetId === asset.id) ?? null, reviewRevision: reviewed?.revision ?? null };
  }
  /** Build only reviewed observations of supplied exports, never invented chains/settings. */
  async buildProfile(projectId: string, id: unknown, input: unknown) {
    if (!isObject(input) || typeof input.name !== "string" || typeof input.expectedRevision !== "string") throw new HttpError(400, "Provide a profile name and expected review revision.");
    const name = input.name;
    return this.reviews(async () => {
      const pack = await this.get(projectId, id), review = await this.review(projectId, id);
      if (!review || review.revision !== input.expectedRevision) throw new HttpError(409, "Review the package first; its revision must match.");
      const examples: MixExample[] = [];
      for (const r of review.assets.filter(r => r.permissions.retrievalDisplay)) {
        const a = pack.assets.find(a => a.id === r.assetId)!;
        if (!a.audio) continue;
        examples.push(createMixExample({ kind: "decision", title: `${r.song} / ${r.version} / ${a.relativePath}`, role: r.role, genre: null, goal: null, recordingFamilies: [r.recordingFamily],
          provenance: [{ sourceId: pack.id, sha256: a.sha256, locator: a.relativePath, method: `ordinary-package-v1 / review ${review.revision}` }], permissions: { ...r.permissions, hostedAnalysis: false, training: false }, review: { reviewer: review.reviewer, note: "Reviewed export role/stage; processing decisions and musical quality remain unknown." },
          missing: ["plugin parameters", "engineer intent", "routing", "automation"], limitations: ["Role/stage annotations describe supplied evidence, not the engineer's full practice.", "An opaque session/state file does not reveal settings."], engineer: name, sessionId: pack.assets.find(a => a.kind === "session")?.id ?? null,
          chain: [], routing: null, automation: null, outcomeArtifactIds: [a.id] }));
      }
      for (const pair of review.pairs) {
        const source = review.assets.find(a => a.assetId === pair.inputAssetId)!, output = review.assets.find(a => a.assetId === pair.outputAssetId)!;
        if (!source.permissions.retrievalDisplay || !output.permissions.retrievalDisplay) continue;
        const inputAsset = pack.assets.find(a => a.id === source.assetId)!, outputAsset = pack.assets.find(a => a.id === output.assetId)!;
        examples.push(createMixExample({ kind: "effect", title: `${source.song}: reviewed ${source.role} → ${output.role}`, role: output.role, genre: null, goal: null, recordingFamilies: [source.recordingFamily],
          provenance: [inputAsset, outputAsset].map(a => ({ sourceId: pack.id, sha256: a.sha256, locator: a.relativePath, method: `ordinary-package-v1 / pair review ${review.revision}` })),
          permissions: { localAnalysis: source.permissions.localAnalysis && output.permissions.localAnalysis, hostedAnalysis: false, retrievalDisplay: true, training: false }, review: { reviewer: review.reviewer, note: pair.note },
          missing: ["plugin identity/version", "readable controls", "fixed controls", "input level"], limitations: ["Pair alignment, gain and tap points are reviewer-supplied.", "Audio does not reveal exact settings or a causal processing chain."],
          inputArtifactId: source.assetId, outputArtifactId: output.assetId, plugin: { name: "Unknown processor/chain", version: null, stateSha256: null }, controls: [], fixedControls: [],
          alignment: { reviewed: pair.latencyReviewed, offsetSeconds: pair.offsetSeconds, gainDifferenceDb: pair.gainDifferenceDb, tapPoint: pair.inputTap && pair.outputTap ? `${pair.inputTap} → ${pair.outputTap}` : null }, inputLevelDbfs: null }));
      }
      if (!examples.length) throw new HttpError(409, "At least one reviewed audio export needs retrieval/display permission.");
      const profile = createEngineerProfile({ name, reviewedBy: review.reviewer,
        tendencies: examples.slice(0, 30).map(e => ({ claim: `The reviewed package supplies a ${e.role} export: ${e.title}.`, exampleIds: [e.id], applicability: "This reviewed package/version only; not a general engineer-style claim.", exceptions: ["Processing chain, intent and quality are unknown."] })),
        limitations: ["Inventory-backed profile: no averaged settings, causal technique or listener preference is inferred.", "Native session metadata/plugin parameters remain unsupported.", ...review.notes.slice(0, 10)] });
      await this.examples.add(projectId, { examples, profiles: [profile] });
      return { profile, exampleIds: examples.map(e => e.id) };
    });
  }
  async tool(projectId: string, name: string, input: Record<string, unknown>) {
    if (name === "list_dataset_packages") return this.list(projectId);
    if (name === "get_dataset_package") return this.readiness(projectId, input.packageId);
    if (name === "get_dataset_import") return this.getImport(projectId, input.importId);
    if (name === "cancel_dataset_import") return this.cancel(projectId, input.importId);
    if (name === "retry_dataset_import") return this.retry(projectId, input.importId);
    throw new HttpError(400, "Unknown dataset tool.");
  }
  shutdown() { this.stopped = true; for (const c of this.controllers.values()) c.abort(new Error("Importer stopped.")); }
}
