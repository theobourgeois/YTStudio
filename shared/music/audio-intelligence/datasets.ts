import { hashJson } from "../hash.ts";
import { PRIVATE_USE, type UsePermissions } from "./types.ts";
import { Problems, array, boolean, hash, nullableNumber, object, oneOf, string, stringList } from "./validation.ts";

export const DATASET_COVERAGE = ["extracted", "preserved-opaque", "unsupported", "missing", "failed", "not-applicable"] as const;
export const DATASET_ROLES = ["raw-vocal", "processed-vocal", "vocal", "instrumental", "drums", "bass", "stem", "final-mix", "premaster", "unknown"] as const;
export type DatasetRole = typeof DATASET_ROLES[number];
export interface DatasetAsset {
  id: string; relativePath: string; sha256: string; bytes: number;
  kind: "audio" | "session" | "plugin-state" | "notes" | "other";
  guessedRole: DatasetRole; guessedSong: string | null; guessedVersion: string | null;
  audio: { durationSeconds: number; sampleRate: number; channels: number; codec: string } | null;
  error: string | null;
}
export interface DatasetPackage {
  schema: 1; id: string; label: string; adapterVersion: "ordinary-package-v1";
  assets: DatasetAsset[];
  archive: { sha256: string; bytes: number; name: string } | null;
  coverage: { category: string; status: typeof DATASET_COVERAGE[number]; method: string; note: string }[];
  limitations: string[];
}
export interface DatasetAssetReview {
  assetId: string; song: string; version: string; recordingFamily: string;
  role: DatasetRole; stage: string | null; masteringStatus: "mastered" | "unmastered" | "unknown";
  timeOriginSeconds: number | null;
  permissions: UsePermissions;
}
export interface DatasetPairReview {
  inputAssetId: string; outputAssetId: string;
  offsetSeconds: number | null; gainDifferenceDb: number | null;
  inputTap: string | null; outputTap: string | null;
  latencyReviewed: boolean; note: string;
}
export interface DatasetReview {
  schema: 1; revision: string; packageId: string; reviewer: string;
  assets: DatasetAssetReview[]; pairs: DatasetPairReview[]; notes: string[];
}
const textOptions = { nonEmpty: true, max: 2000 };
export function datasetAssetId(sha256: string, relativePath: string) { return `asset_${hashJson({ sha256, relativePath }).slice(0, 20)}`; }
export function createDatasetPackage(input: Omit<DatasetPackage, "schema" | "id" | "adapterVersion">): DatasetPackage {
  const content = { ...input, schema: 1 as const, adapterVersion: "ordinary-package-v1" as const };
  return parseDatasetPackage({ ...content, id: `pack_${hashJson(content).slice(0, 20)}` });
}
export function parseDatasetPackage(input: unknown): DatasetPackage {
  const p = new Problems(), o = object(input, "package", p);
  const text = (v: unknown, path: string) => string(v, path, p, textOptions);
  const nullableText = (v: unknown, path: string) => v === null ? null : text(v, path);
  const assets = array(o.assets, "assets", p, 1000).map((v, i) => {
    const a = object(v, `assets[${i}]`, p), audio = a.audio === null ? null : object(a.audio, "audio", p);
    const relativePath = text(a.relativePath, "relativePath"), sha256 = hash(a.sha256, "sha256", p);
    if (!safePackagePath(relativePath)) p.add("relativePath", "must be a safe package-relative filename");
    if (!Number.isSafeInteger(a.bytes) || Number(a.bytes) < 0) p.add("bytes", "must be nonnegative");
    if (a.id !== datasetAssetId(sha256, relativePath)) p.add("asset.id", "content identity mismatch");
    if (audio && (!(Number(audio.durationSeconds) > 0) || !Number.isFinite(audio.durationSeconds) || !Number.isSafeInteger(audio.sampleRate) || Number(audio.sampleRate) < 1 || !Number.isSafeInteger(audio.channels) || Number(audio.channels) < 1)) p.add("audio", "invalid audio metadata");
    return { id: String(a.id), relativePath, sha256, bytes: Number(a.bytes), kind: oneOf(a.kind, ["audio", "session", "plugin-state", "notes", "other"] as const, "kind", p),
      guessedRole: oneOf(a.guessedRole, DATASET_ROLES, "guessedRole", p), guessedSong: nullableText(a.guessedSong, "guessedSong"), guessedVersion: nullableText(a.guessedVersion, "guessedVersion"),
      audio: audio ? { durationSeconds: Number(audio.durationSeconds), sampleRate: Number(audio.sampleRate), channels: Number(audio.channels), codec: text(audio.codec, "codec") } : null,
      error: nullableText(a.error, "error") };
  });
  if (!assets.length || new Set(assets.map(a => a.id)).size !== assets.length || new Set(assets.map(a => a.relativePath.toLocaleLowerCase())).size !== assets.length) p.add("assets", "must be nonempty with unique identities and filenames");
  const archive = o.archive === null ? null : object(o.archive, "archive", p);
  if (archive && (!Number.isSafeInteger(archive.bytes) || Number(archive.bytes) < 0)) p.add("archive.bytes", "invalid size");
  const content = { schema: 1 as const, adapterVersion: "ordinary-package-v1" as const, label: text(o.label, "label"), assets,
    archive: archive ? { sha256: hash(archive.sha256, "archive.sha256", p), bytes: Number(archive.bytes), name: text(archive.name, "archive.name") } : null,
    coverage: array(o.coverage, "coverage", p, 100).map(v => { const c = object(v, "coverage", p); return { category: text(c.category, "category"), status: oneOf(c.status, DATASET_COVERAGE, "status", p), method: text(c.method, "method"), note: text(c.note, "note") }; }),
    limitations: stringList(o.limitations, "limitations", p, 100) };
  const id = `pack_${hashJson(content).slice(0, 20)}`;
  if (o.schema !== 1 || o.adapterVersion !== "ordinary-package-v1" || o.id !== id) p.add("id", "invalid schema/adapter/content identity");
  if (p.any) throw new Error(p.list.join("; "));
  return { ...content, id };
}
export function safePackagePath(name: string) {
  return name.length > 0 && name.length <= 1000 && !/[\\\u0000-\u001f:]/.test(name) && !name.startsWith("/") && name.split("/").every(part => part && part !== "." && part !== ".." && !/[. ]$/.test(part) && !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part));
}
export function guessDatasetRole(filename: string): DatasetRole {
  const name = filename.toLowerCase().replace(/[_\-.]/g, " ");
  if (/\bpremaster\b|\bpre master\b/.test(name)) return "premaster";
  if (/\b(final|master|mixdown|finished)\b/.test(name)) return "final-mix";
  if (/\b(vocals?|vox|lead ?voc)\b/.test(name)) {
    if (/\b(raw|dry|unprocessed)\b/.test(name)) return "raw-vocal";
    if (/\b(wet|processed|print)\b/.test(name)) return "processed-vocal";
    return "vocal";
  }
  if (/\b(instrumental|beat|accompaniment)\b/.test(name)) return "instrumental";
  if (/\b(drums?|kick|snare|hats?|percussion)\b/.test(name)) return "drums";
  if (/\b(bass|808)\b/.test(name)) return "bass";
  if (/\bstems?\b/.test(name)) return "stem";
  return "unknown";
}
export function createDatasetReview(input: Omit<DatasetReview, "schema" | "revision">, pack: DatasetPackage): DatasetReview {
  const content = { ...input, schema: 1 as const };
  Reflect.deleteProperty(content, "revision");
  return parseDatasetReview({ ...content, revision: hashJson(content) }, pack);
}
export function parseDatasetReview(input: unknown, pack: DatasetPackage): DatasetReview {
  const p = new Problems(), o = object(input, "review", p);
  const text = (v: unknown, path: string) => string(v, path, p, textOptions);
  const nullableText = (v: unknown, path: string) => v === null ? null : text(v, path);
  const assets = array(o.assets, "assets", p, 1000).map(v => {
    const a = object(v, "asset review", p), permissions = object(a.permissions, "permissions", p);
    const assetId = text(a.assetId, "assetId");
    if (!pack.assets.some(a => a.id === assetId)) p.add("assetId", "not in this package");
    const permissionsValue = Object.fromEntries(Object.keys(PRIVATE_USE).map(k => [k, boolean(permissions[k], `permissions.${k}`, p)])) as unknown as UsePermissions;
    if (permissionsValue.training) p.add("training", "training approval is outside this ingestion slice");
    return { assetId, song: text(a.song, "song"), version: text(a.version, "version"), recordingFamily: text(a.recordingFamily, "recordingFamily"), role: oneOf(a.role, DATASET_ROLES, "role", p), stage: nullableText(a.stage, "stage"), masteringStatus: oneOf(a.masteringStatus, ["mastered", "unmastered", "unknown"] as const, "masteringStatus", p), timeOriginSeconds: nullableNumber(a.timeOriginSeconds, "timeOriginSeconds", p), permissions: permissionsValue };
  });
  if (new Set(assets.map(a => a.assetId)).size !== assets.length) p.add("assets", "duplicate asset review");
  const sourceFamilies = new Map<string, string>();
  for (const review of assets) {
    const source = pack.assets.find(a => a.id === review.assetId);
    if (!source) continue;
    if (sourceFamilies.has(source.sha256) && sourceFamilies.get(source.sha256) !== review.recordingFamily) p.add("recordingFamily", "identical source bytes cannot belong to different recording families");
    sourceFamilies.set(source.sha256, review.recordingFamily);
  }
  const pairs = array(o.pairs, "pairs", p, 1000).map(v => {
    const pair = object(v, "pair", p), inputAssetId = text(pair.inputAssetId, "inputAssetId"), outputAssetId = text(pair.outputAssetId, "outputAssetId");
    const a = assets.find(a => a.assetId === inputAssetId), b = assets.find(a => a.assetId === outputAssetId);
    if (!a || !b || a.assetId === b.assetId || a.recordingFamily !== b.recordingFamily || a.song !== b.song) p.add("pair", "must reference two reviewed assets of the same recording family/song");
    if (![inputAssetId, outputAssetId].every(id => pack.assets.some(a => a.id === id && a.audio !== null))) p.add("pair", "requires readable audio");
    return { inputAssetId, outputAssetId, offsetSeconds: nullableNumber(pair.offsetSeconds, "offsetSeconds", p), gainDifferenceDb: nullableNumber(pair.gainDifferenceDb, "gainDifferenceDb", p), inputTap: nullableText(pair.inputTap, "inputTap"), outputTap: nullableText(pair.outputTap, "outputTap"), latencyReviewed: boolean(pair.latencyReviewed, "latencyReviewed", p), note: text(pair.note, "note") };
  });
  if (new Set(pairs.map(p => `${p.inputAssetId}/${p.outputAssetId}`)).size !== pairs.length) p.add("pairs", "duplicate pairing");
  const content = { schema: 1 as const, packageId: text(o.packageId, "packageId"), reviewer: text(o.reviewer, "reviewer"), assets, pairs, notes: stringList(o.notes, "notes", p, 100) };
  const revision = hashJson(content);
  if (o.schema !== 1 || o.revision !== revision || content.packageId !== pack.id) p.add("revision", "invalid review identity/package");
  if (p.any) throw new Error(p.list.join("; "));
  return { ...content, revision };
}
