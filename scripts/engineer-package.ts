/** Local user/operator intake and review. No donor tools, hosted uploads or automatic approvals. */
import fs from "node:fs/promises";
import path from "node:path";
import { PRIVATE_USE } from "../shared/music/audio-intelligence/types.ts";
import type { DatasetPackage, DatasetReview } from "../shared/music/audio-intelligence/datasets.ts";
import type { DatasetImportJob } from "../server/music/audio-intelligence/dataset-service.ts";

const args = process.argv.slice(2), command = args[0];
function option(name: string, required = true) {
  const index = args.indexOf(`--${name}`), value = index >= 0 ? args[index + 1] : undefined;
  if (required && (!value || value.startsWith("--"))) throw new Error(`Provide --${name}.`);
  return value;
}
const server = new URL(option("server", false) ?? "http://127.0.0.1:5311");
if (!["127.0.0.1", "localhost", "[::1]"].includes(server.hostname) || server.protocol !== "http:" || server.username || server.password) throw new Error("Use the local editor's HTTP server address.");
const project = option("project")!;
const base = new URL(`/api/music/audio/${encodeURIComponent(project)}/`, server);
async function api(endpoint: string, body?: unknown, method = "POST") {
  const response = await fetch(new URL(endpoint, base), body === undefined ? {} : { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const value = await response.json();
  if (!response.ok) throw new Error(typeof value.error === "string" ? value.error : `Editor returned HTTP ${response.status}.`);
  return value;
}
if (command === "import") {
  const source = path.resolve(option("path")!);
  let job = await api("datasets/import-path", { path: source }) as DatasetImportJob;
  console.log(`Import ${job.id} continues on the server if this command stops.`);
  const deadline = Date.now() + 15 * 60_000;
  let completed = -1;
  while (["queued", "running"].includes(job.status) && Date.now() < deadline) {
    if (job.completedFiles !== completed) { completed = job.completedFiles; console.log(`Preserved ${completed}/${job.totalFiles ?? "?"} files.`); }
    await new Promise(resolve => setTimeout(resolve, 250));
    job = await api("tools/get_dataset_import", { importId: job.id });
  }
  console.log(JSON.stringify(job, null, 2));
  if (job.status === "failed") process.exitCode = 1;
} else if (command === "show") {
  console.log(JSON.stringify(await api(`datasets/${encodeURIComponent(option("package")!)}`), null, 2));
} else if (command === "draft") {
  const result = await api(`datasets/${encodeURIComponent(option("package")!)}`) as { package: DatasetPackage; review: DatasetReview | null };
  const output = path.resolve(option("out")!);
  const review = result.review ?? { packageId: result.package.id, reviewer: "REPLACE_WITH_REVIEWER", assets: result.package.assets.filter(a => a.audio).map(a => ({ assetId: a.id, song: "REPLACE_WITH_SONG", version: "REPLACE_WITH_VERSION", recordingFamily: "REPLACE_WITH_RECORDING_FAMILY", role: a.guessedRole, stage: null, masteringStatus: "unknown", timeOriginSeconds: null, permissions: { ...PRIVATE_USE } })), pairs: [], notes: [] };
  await fs.mkdir(path.dirname(output), { recursive: true });
  await fs.writeFile(output, JSON.stringify({ expectedRevision: result.review?.revision ?? null, review }, null, 2) + "\n", { flag: "wx" });
  console.log(`Review draft: ${output}. Confirm roles/source families and permissions; unknown tap points, gain and timing may stay null.`);
} else if (command === "review") {
  const bytes = await fs.readFile(path.resolve(option("file")!)); if (bytes.length > 2_000_000) throw new Error("Review exceeds 2 MB.");
  const body = JSON.parse(bytes.toString("utf8"));
  if (JSON.stringify(body).includes("REPLACE_WITH_")) throw new Error("Complete the review placeholders before saving.");
  console.log(JSON.stringify(await api(`datasets/${encodeURIComponent(option("package")!)}/review`, body, "PATCH"), null, 2));
} else if (command === "profile") {
  const id = option("package")!, result = await api(`datasets/${encodeURIComponent(id)}`) as { review: DatasetReview | null };
  if (!result.review) throw new Error("Review roles and grant retrieval/display permission before building a profile.");
  console.log(JSON.stringify(await api(`datasets/${encodeURIComponent(id)}/profile`, { name: option("name"), expectedRevision: result.review.revision }), null, 2));
} else {
  throw new Error("Use import --path, show --package, draft --package --out, review --package --file, or profile --package --name; every command needs --project and optionally --server.");
}
