/**
 * Select the reviewed MixParams reference subset (`docs/audio-intelligence/mixparams-reference-subset.md`):
 * reads the dataset's readable JSONL splits, runs `selectReferenceSubset` and writes `reviewed-subset.jsonl`
 * and `reviewed-subset-summary.json`.
 *
 *   pnpm tsx scripts/select-mixparams.ts [--data <dir>] [--out <dir>] [--seed <text>] [--test-fraction <0..1>]
 *
 * MixParams has no explicit licence, so its rows never go in the repository: the output must be in a `data`
 * folder (git-ignored), and the script refuses anywhere else.
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { selectReferenceSubset, splitByRecordingFamily, type MixReferenceRow } from "../shared/music/mix-reference.ts";

const SPLIT_FILES = ["train.jsonl", "dev.jsonl", "test.jsonl"] as const;

function option(name: string): string | undefined {
  const at = process.argv.indexOf(`--${name}`);
  return at >= 0 ? process.argv[at + 1] : undefined;
}

const dataDir = path.resolve(option("data") ?? "data/research-datasets/mixparams");
const outDir = path.resolve(option("out") ?? dataDir);
const seed = option("seed") ?? "mixparams-reference-v1";
const testFraction = Number(option("test-fraction") ?? 0.25);
if (!(testFraction >= 0 && testFraction <= 1)) throw new Error("--test-fraction must be between 0 and 1.");

/** Where it's safe to write: under a `data` folder, and if that's inside a git checkout, the checkout's own `data/` and ignored by git. */
function checkOutputPlace(dir: string) {
  if (!dir.split(path.sep).includes("data")) throw new Error(`Refusing to write to ${dir}: the output must be inside a folder called "data".`);
  let root: string | null = null;
  try {
    root = execFileSync("git", ["rev-parse", "--show-toplevel"], { cwd: path.dirname(dir), stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
  } catch {
    // Not in a git checkout: the folder rule is all there is.
  }
  if (!root) return;
  const inside = path.relative(root, dir);
  if (inside.startsWith("..")) return;
  if (inside !== "data" && !inside.startsWith(`data${path.sep}`)) throw new Error(`Refusing to write to ${dir}: inside the repository, only its data/ folder is allowed.`);
  try {
    execFileSync("git", ["check-ignore", "-q", path.join(dir, "reviewed-subset.jsonl")], { cwd: root, stdio: "ignore" });
  } catch {
    throw new Error(`Refusing to write to ${dir}: git doesn't ignore it.`);
  }
}

const sha256 = (file: string) => createHash("sha256").update(fs.readFileSync(file)).digest("hex");

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}

function main() {
  checkOutputPlace(outDir);

  const sources: { file: string; sha256: string; rows: number }[] = [];
  const rows: MixReferenceRow[] = [];
  for (const file of SPLIT_FILES) {
    const full = path.join(dataDir, file);
    if (!fs.existsSync(full)) throw new Error(`${full} not found. Pass --data <the MixParams folder> (its train/dev/test .jsonl).`);
    const lines = fs.readFileSync(full, "utf8").split("\n").filter((line) => line.trim());
    const split = file.replace(/\.jsonl$/, "");
    for (const line of lines) rows.push({ ...(JSON.parse(line) as MixReferenceRow), split });
    sources.push({ file, sha256: sha256(full), rows: lines.length });
  }

  const selection = selectReferenceSubset(rows);
  const split = splitByRecordingFamily(selection.records, { seed, testFraction });
  const own = (family: string) => split.assignment[family];

  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(
    path.join(outDir, "reviewed-subset.jsonl"),
    selection.records.map((record) => JSON.stringify({ ...record, ourSplit: own(record.recordingFamilyId) })).join("\n") + "\n",
  );

  const rowsByDatasetSplit: Record<string, number> = {};
  for (const row of rows) rowsByDatasetSplit[row.split ?? "?"] = (rowsByDatasetSplit[row.split ?? "?"] ?? 0) + 1;
  const songs = new Set(rows.map((row) => row.song_name));
  const songMixPairs = new Set(rows.map((row) => `${row.song_name}\u0000${row.mix_name}`));
  const summary = {
    notice: "Derived from MixParams, which has no explicit licence. Research only: not for redistribution or training. Retrieval display only; no record is an executable setting.",
    selectedAt: new Date().toISOString(),
    sources,
    rowsByDatasetSplit,
    uniqueSongs: songs.size,
    uniqueSongMixPairs: songMixPairs.size,
    ...selection.summary,
    songsWithRecords: Object.keys(selection.summary.bySong).length,
    recordsByDatasetSplit: countBy(selection.records.map((record) => record.source.split ?? "?")),
    ourSplit: { seed, testFraction, ...split },
  };
  fs.writeFileSync(path.join(outDir, "reviewed-subset-summary.json"), JSON.stringify(summary, null, 2) + "\n");

  console.log(`${selection.summary.rows} rows -> ${selection.summary.records} records from ${selection.summary.rowsWithRecords} rows.`);
  console.log("Left out:", selection.summary.rejectedByReason);
  console.log(`Written to ${outDir}`);
}

function countBy(values: string[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const value of values) counts[value] = (counts[value] ?? 0) + 1;
  return counts;
}
