/** Convert the local A subset into a D review/import body; no application writes or network requests. */
import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { mixParamsExample } from "../server/music/audio-intelligence/mixparams-examples.ts";

const source = path.resolve(process.argv[2] ?? "data/research-datasets/mixparams/reviewed-subset.jsonl");
const output = path.resolve(process.argv[3] ?? "data/research-datasets/mixparams/example-import.json");
// A's reference rows have no redistribution licence; keep the derived body under this checkout's ignored data/.
const relative = path.relative(path.resolve("data"), output);
if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("Output must be under this checkout's data/ directory.");
const bytes = await fs.readFile(source);
if (bytes.length > 20_000_000) throw new Error("Reference subset exceeds 20 MB.");
const sha256 = createHash("sha256").update(bytes).digest("hex");
const examples = bytes.toString("utf8").split(/\r?\n/).filter(line => line.trim()).map(line => mixParamsExample(JSON.parse(line), sha256));
await fs.mkdir(path.dirname(output), { recursive: true });
await fs.writeFile(output, JSON.stringify({ examples, profiles: [] }, null, 2) + "\n", { flag: "wx" });
console.log(`Prepared ${examples.length} display-only references: ${output}`);
console.log("Import through POST /api/music/audio/:projectId/examples. Unknown units stay unknown; no training or editing permission is granted.");
