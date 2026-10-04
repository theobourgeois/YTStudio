/**
 * A reviewed reference subset of MixParams (`docs/audio-intelligence/mixparams-reference-subset.md`): the
 * human compressor settings in that dataset, checked for *data quality only* and kept as they were annotated.
 *
 * What this is not. Nothing here turns a row into an instruction: `eligibility.executableProposal` is `false`
 * on every record, whatever the row says, because the dataset doesn't certify units (a number can be a knob
 * position, a dB or a millisecond depending on the plugin) and annotations are a snapshot of a person's
 * settings, not a recipe. Nothing here is training data either: MixParams has no explicit licence. A record
 * may be *shown* (retrieval display), with its limits beside it.
 *
 * Values are never converted. `nativeValues` keeps each number or string exactly as written, under the key
 * as spelled and a normalised key (`thresh` / `thres` / `threshold` are all `threshold`).
 *
 * Pure, no Node: the rows come from a script (`scripts/select-mixparams.ts`) and the dataset's own files are
 * never copied into the repository.
 */
import type { ParameterReadability } from "./audio-intelligence/types.ts";

// ---------------------------------------------------------------------------------------------------------
// The raw rows

/**
 * One MixParams row as the dataset gives it (a track in one mix), with the fields this module reads.
 * `parameters` is a JSON string in the dataset's own splits and an object in some derived files.
 */
export interface MixReferenceRow {
  song_name: string;
  mix_name: string;
  track_name: string;
  /** DRUMS, VOCALS, GUITARS... */
  track_instrument_type: string;
  /** For vocals LEAD or BACKGROUND; one row has ELECTRIC. */
  track_instrument_subtype: string;
  genre?: string;
  artist_name?: string;
  /** The dataset's own split, when the caller knows it (the file the row was read from). */
  split?: string;
  parameters: unknown;
}

// ---------------------------------------------------------------------------------------------------------
// Records

export const REFERENCE_ROLES = ["leadVocal", "backingVocal", "other"] as const;
export type ReferenceRole = (typeof REFERENCE_ROLES)[number];

/** A value exactly as annotated: a number, or a string (`"3.0:1"`), a list (`pan`), a flag. Never converted. */
export type NativeScalar = number | string | boolean | number[];

/** One annotated entry of a compressor: what was written, under which key, and how far it can be trusted. */
export interface NativeValue {
  /** The key as the dataset spelled it (`thres`). */
  sourceKey: string;
  /** The key as we group it (`threshold`). The same as `sourceKey` when there's nothing to normalise. */
  key: string;
  /** Exactly as annotated. `null` only when the dataset has the key with no value (then `unavailable`). */
  value: NativeScalar | null;
  /** `annotated`: a person wrote it. `estimated` only where the dataset says so (it doesn't, per value). Never `exact` here. */
  readability: ParameterReadability;
}

/** The compressor fields that a record names as missing when absent: what a reader would look for first. */
export const CORE_FIELDS = ["threshold", "ratio", "attack", "release", "gain", "knee"] as const;
export type CoreField = (typeof CORE_FIELDS)[number];

/** The core fields as numbers, parsed from `nativeValues` for the checks and for display (`ratio` "3.0:1" is 3). Not units. */
export type ReferenceCompressorSettings = Partial<Record<CoreField, number>>;

export interface ReferenceEligibility {
  /** May be shown as an example, with its limits. True for every record the selector keeps. */
  retrievalDisplay: boolean;
  /** Always false in this slice: no row becomes an instruction. */
  executableProposal: false;
  /** Always false: no licence. */
  training: false;
  /** Why, in the words a model or a reviewer should read. */
  reasons: string[];
}

export interface ReferenceRecord {
  /** `mxp_` + a hash of song, mix, track and the compressor's place in its chain and content: the same row, the same id. */
  id: string;
  /** The song: mixes reuse the same source recordings, so a family is a song, not a mix. `song_` + a slug. */
  recordingFamilyId: string;
  source: {
    song: string;
    mix: string;
    track: string;
    /** The dataset's own split, if it was known. Not independent: see `splitByRecordingFamily`. */
    split: string | null;
    genre: string | null;
    subtype: string;
    /** Position of this compressor in the track's chain, from 0. */
    chainIndex: number;
    chainLength: number;
  };
  role: ReferenceRole;
  /** The plugin's label exactly as given (`Channel Strip`): not a certified identity. */
  plugin: string;
  /** By normalised key. */
  nativeValues: Record<string, NativeValue>;
  /** What the checks and displays read; see `ReferenceCompressorSettings`. */
  settings: ReferenceCompressorSettings;
  /** Core fields the annotation has no value for. */
  missing: CoreField[];
  /** Always `unverified`: the dataset doesn't certify units; a knob position and a physical unit aren't told apart. */
  unitStatus: "unverified";
  eligibility: ReferenceEligibility;
}

// ---------------------------------------------------------------------------------------------------------
// Criteria (data quality only)

/**
 * Why a row, or one compressor in its chain, was left out. Row-level reasons are checked in this order and
 * stop at the first; instance-level reasons are all collected.
 */
export const REJECTION_REASONS = [
  // Row level
  "missingIdentity",
  "notVocal",
  "inconsistentSubtype",
  "roleNotSelected",
  "invalidParameters",
  "noCompression",
  // One compressor in the chain
  "invalidEntry",
  "unrecognisedPlugin",
  "missingThreshold",
  "missingRatio",
  "nonFiniteValue",
  "ratioNotNumeric",
  "conflictingKeys",
  "duplicate",
] as const;
export type RejectionReason = (typeof REJECTION_REASONS)[number];

/**
 * Labels in the dataset that name a compressor with a threshold and a ratio. `Channel Strip` is a
 * compressor here only through the fields it carries (threshold and ratio are required of every record);
 * `Maxim` is a limiter and `BF-3A` / `UAD 1176SE` appear with a name only, so they fail on the fields.
 */
export const RECOGNISED_COMPRESSORS: readonly string[] = ["Compressor/Limiter", "Channel Strip", "Compressor", "BF-76", "UAD 1176SE", "BF-3A"];

/** Spellings that mean the same field. Everything else keeps its own name. Matched case-insensitively. */
const KEY_ALIASES: Record<string, string> = { thresh: "threshold", thres: "threshold", threshold: "threshold" };
export const normaliseKey = (key: string): string => {
  const lower = key.trim().toLowerCase();
  return KEY_ALIASES[lower] ?? lower;
};

/** Keys whose value has to be a finite number (or a ratio) for the record to be kept. */
const NUMERIC_KEYS = new Set<string>(CORE_FIELDS);

export interface SelectOptions {
  /** Which roles are kept. Default: lead vocals only. */
  roles?: readonly ReferenceRole[];
  /** Plugin labels taken as compressors. Default: `RECOGNISED_COMPRESSORS`. */
  recognisedPlugins?: readonly string[];
}

export interface Rejected {
  /** `song | mix | track`, and `#c<n>` for the n-th compressor of the track's chain. Not the row's position: stable under reordering. */
  rowKey: string;
  reasons: RejectionReason[];
}

export interface SelectionSummary {
  /** Rows given. */
  rows: number;
  /** Rows that kept at least one record. */
  rowsWithRecords: number;
  /** Compressors kept (a chain of three is up to three records). */
  records: number;
  /** Rejections: one per row left out at row level, one per compressor left out within a row. */
  rejected: number;
  rejectedByReason: Partial<Record<RejectionReason, number>>;
  bySong: Record<string, number>;
  byRole: Partial<Record<ReferenceRole, number>>;
  byPlugin: Record<string, number>;
  /** Over every annotated value kept. */
  byReadability: Partial<Record<ParameterReadability, number>>;
  /** How many records lack each core field. */
  missingByField: Partial<Record<CoreField, number>>;
}

export interface Selection {
  /** Sorted by id, so the same rows in any order give the same records. */
  records: ReferenceRecord[];
  rejected: Rejected[];
  summary: SelectionSummary;
}

// ---------------------------------------------------------------------------------------------------------
// Small pure helpers

/** Two 32-bit FNV-1a passes with different bases, 16 hex digits: stable ids, not security. */
export function shortHash(text: string): string {
  let a = 0x811c9dc5;
  let b = 0x9747b28c;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    a = Math.imul(a ^ c, 0x01000193);
    b = Math.imul(b ^ (c + i), 0x85ebca6b);
    b ^= b >>> 13;
  }
  a = Math.imul(a ^ (a >>> 16), 0x85ebca6b);
  b = Math.imul(b ^ (b >>> 15), 0xc2b2ae35);
  return (a >>> 0).toString(16).padStart(8, "0") + (b >>> 0).toString(16).padStart(8, "0");
}

/** `Under A Covered Sky` → `under-a-covered-sky`. */
const slug = (text: string) =>
  text
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

export const recordingFamilyId = (song: string): string => `song_${slug(song) || shortHash(song)}`;

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

const keyOf = (row: MixReferenceRow) => `${row.song_name} | ${row.mix_name} | ${row.track_name}`;

/** `"3.0:1"` → 3, `4` → 4. Anything else (`"LMTR"`, `"None"`) is not a ratio we can read. A parse for checks, not a conversion. */
export function parseRatio(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) && value > 0 ? value : null;
  if (typeof value !== "string") return null;
  const match = /^\s*(\d+(?:\.\d+)?)\s*:\s*1\s*$/.exec(value);
  if (!match) return null;
  const ratio = Number(match[1]);
  return Number.isFinite(ratio) && ratio > 0 ? ratio : null;
}

function parseParameters(raw: unknown): Record<string, unknown> | null {
  if (typeof raw === "string") {
    try {
      const parsed: unknown = JSON.parse(raw);
      return isRecord(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }
  return isRecord(raw) ? raw : null;
}

const roleOf = (row: MixReferenceRow): ReferenceRole => {
  if (row.track_instrument_type !== "VOCALS") return "other";
  if (row.track_instrument_subtype === "LEAD") return "leadVocal";
  if (row.track_instrument_subtype === "BACKGROUND") return "backingVocal";
  return "other";
};

const isNativeScalar = (value: unknown): value is NativeScalar =>
  typeof value === "number" || typeof value === "string" || typeof value === "boolean" || (Array.isArray(value) && value.every((x) => typeof x === "number"));

const ELIGIBILITY_REASONS = [
  "Units unverified: a value may be a knob position, not dB or ms; the dataset doesn't say which (per plugin).",
  "Annotated by a person from the plugin as it was left, not read out by the processor; no automation, a snapshot.",
  "MixParams has no explicit licence: not for training or redistribution.",
  "Settings alone don't say why the engineer chose them.",
];

/** One compressor of a track, or the reasons it can't be a record. */
function readCompressor(
  row: MixReferenceRow,
  entry: unknown,
  chainIndex: number,
  chainLength: number,
  role: ReferenceRole,
  recognised: ReadonlySet<string>,
): ReferenceRecord | RejectionReason[] {
  if (!isRecord(entry) || typeof entry.name !== "string" || entry.name.trim() === "") return ["invalidEntry"];
  const reasons = new Set<RejectionReason>();
  const plugin = entry.name;
  if (!recognised.has(plugin)) reasons.add("unrecognisedPlugin");

  const nativeValues: Record<string, NativeValue> = {};
  const settings: ReferenceCompressorSettings = {};
  for (const [sourceKey, value] of Object.entries(entry)) {
    if (sourceKey === "name") continue;
    const key = normaliseKey(sourceKey);
    if (key in nativeValues) {
      reasons.add("conflictingKeys");
      continue;
    }
    if (value === null || value === undefined) {
      nativeValues[key] = { sourceKey, key, value: null, readability: "unavailable" };
      continue;
    }
    if (!isNativeScalar(value)) {
      reasons.add("invalidEntry");
      continue;
    }
    nativeValues[key] = { sourceKey, key, value, readability: "annotated" };
    if (!NUMERIC_KEYS.has(key)) continue;
    if (key === "ratio") {
      const ratio = parseRatio(value);
      if (ratio === null) reasons.add("ratioNotNumeric");
      else settings.ratio = ratio;
    } else if (typeof value === "number" && Number.isFinite(value)) {
      settings[key as CoreField] = value;
    } else {
      reasons.add("nonFiniteValue");
    }
  }
  if (settings.threshold === undefined && !reasons.has("nonFiniteValue")) reasons.add("missingThreshold");
  if (settings.ratio === undefined && !reasons.has("ratioNotNumeric")) reasons.add("missingRatio");
  if (reasons.size > 0) return [...reasons];

  const family = recordingFamilyId(row.song_name);
  const content = JSON.stringify(Object.entries(entry).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
  return {
    id: `mxp_${shortHash(`${row.song_name}\u0000${row.mix_name}\u0000${row.track_name}\u0000${chainIndex}\u0000${content}`)}`,
    recordingFamilyId: family,
    source: {
      song: row.song_name,
      mix: row.mix_name,
      track: row.track_name,
      split: row.split ?? null,
      genre: row.genre ?? null,
      subtype: row.track_instrument_subtype,
      chainIndex,
      chainLength,
    },
    role,
    plugin,
    nativeValues,
    settings,
    missing: CORE_FIELDS.filter((field) => settings[field] === undefined),
    unitStatus: "unverified",
    eligibility: { retrievalDisplay: true, executableProposal: false, training: false, reasons: [...ELIGIBILITY_REASONS] },
  };
}

/**
 * Pick the records worth showing from MixParams rows, for data quality: lead vocals (by default) with a
 * parseable parameters object, and a recognised compressor carrying a finite threshold and a ratio. Every
 * entry the annotator wrote is kept as given, attack and release included, with how readable it is. The
 * criteria say nothing about whether a setting is good.
 */
export function selectReferenceSubset(rows: readonly MixReferenceRow[], options: SelectOptions = {}): Selection {
  const roles = new Set<ReferenceRole>(options.roles ?? ["leadVocal"]);
  const recognised = new Set(options.recognisedPlugins ?? RECOGNISED_COMPRESSORS);
  const records = new Map<string, ReferenceRecord>();
  const rejected: Rejected[] = [];
  const rowsWithRecords = new Set<number>();

  rows.forEach((row, index) => {
    const rowKey = keyOf(row);
    const reject = (reason: RejectionReason, key = rowKey) => rejected.push({ rowKey: key, reasons: [reason] });
    if (!row.song_name?.trim() || !row.mix_name?.trim() || !row.track_name?.trim()) return reject("missingIdentity");
    if (row.track_instrument_type !== "VOCALS") return reject("notVocal");
    const role = roleOf(row);
    if (role === "other") return reject("inconsistentSubtype");
    if (!roles.has(role)) return reject("roleNotSelected");
    const parameters = parseParameters(row.parameters);
    if (!parameters) return reject("invalidParameters");
    const chain = parameters.compression;
    if (!Array.isArray(chain) || chain.length === 0) return reject("noCompression");

    chain.forEach((entry, chainIndex) => {
      const result = readCompressor(row, entry, chainIndex, chain.length, role, recognised);
      const instanceKey = `${rowKey}#c${chainIndex}`;
      if (Array.isArray(result)) return void rejected.push({ rowKey: instanceKey, reasons: result });
      if (records.has(result.id)) return reject("duplicate", instanceKey);
      records.set(result.id, result);
      rowsWithRecords.add(index);
    });
  });

  const sorted = [...records.values()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return { records: sorted, rejected, summary: summarise(rows.length, rowsWithRecords.size, sorted, rejected) };
}

function summarise(rows: number, rowsWithRecords: number, records: ReferenceRecord[], rejected: Rejected[]): SelectionSummary {
  const summary: SelectionSummary = {
    rows,
    rowsWithRecords,
    records: records.length,
    rejected: rejected.length,
    rejectedByReason: {},
    bySong: {},
    byRole: {},
    byPlugin: {},
    byReadability: {},
    missingByField: {},
  };
  const bump = <K extends string>(counts: Partial<Record<K, number>>, key: K) => void (counts[key] = (counts[key] ?? 0) + 1);
  for (const item of rejected) for (const reason of item.reasons) bump(summary.rejectedByReason, reason);
  for (const record of records) {
    bump(summary.bySong, record.source.song);
    bump(summary.byRole, record.role);
    bump(summary.byPlugin, record.plugin);
    for (const value of Object.values(record.nativeValues)) bump(summary.byReadability, value.readability);
    for (const field of record.missing) bump(summary.missingByField, field);
  }
  return summary;
}

// ---------------------------------------------------------------------------------------------------------
// Splits by recording family

export const REFERENCE_SPLITS = ["train", "dev", "test"] as const;
export type ReferenceSplit = (typeof REFERENCE_SPLITS)[number];

export interface SplitOptions {
  /** Any string: the same seed gives the same assignment. */
  seed: string;
  /** Share of *songs* (not records) held out for test, 0..1. */
  testFraction: number;
  /** Share of songs for dev. Default 0. */
  devFraction?: number;
}

export interface SplitResult {
  /** Family id → split. Every family of the records, in exactly one. */
  assignment: Record<string, ReferenceSplit>;
  counts: Record<ReferenceSplit, { families: number; records: number }>;
}

/**
 * Whole songs to a split, so no recording is in two: the dataset's own splits share all 13 songs and are
 * not independent. Songs are ordered by a hash of the seed and their id (not by the order of the records),
 * then the first ones go to test, the next to dev, the rest to train. At least one song stays in train, and
 * a non-zero fraction gets at least one song when there are two or more. Counted in songs, so records per
 * split are as uneven as the songs are.
 */
export function splitByRecordingFamily(records: readonly Pick<ReferenceRecord, "recordingFamilyId">[], options: SplitOptions): SplitResult {
  const families = [...new Set(records.map((record) => record.recordingFamilyId))].sort();
  const ordered = families
    .map((family) => ({ family, score: shortHash(`${options.seed}\u0000${family}`) }))
    .sort((a, b) => (a.score < b.score ? -1 : a.score > b.score ? 1 : a.family < b.family ? -1 : 1));

  const n = ordered.length;
  const fraction = (value: number | undefined) => Math.min(1, Math.max(0, Number.isFinite(value) ? (value as number) : 0));
  const want = (value: number) => (value > 0 && n >= 2 ? Math.max(1, Math.round(value * n)) : 0);
  let test = want(fraction(options.testFraction));
  let dev = want(fraction(options.devFraction));
  while (test + dev > Math.max(0, n - 1)) {
    if (dev > 0 && dev >= test) dev--;
    else if (test > 0) test--;
    else break;
  }

  const assignment: Record<string, ReferenceSplit> = {};
  ordered.forEach(({ family }, i) => (assignment[family] = i < test ? "test" : i < test + dev ? "dev" : "train"));
  const counts: SplitResult["counts"] = { train: { families: 0, records: 0 }, dev: { families: 0, records: 0 }, test: { families: 0, records: 0 } };
  for (const family of families) counts[assignment[family]].families++;
  for (const record of records) counts[assignment[record.recordingFamilyId]].records++;
  return { assignment, counts };
}
