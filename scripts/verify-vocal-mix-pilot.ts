/** Run B and the first comparison through the real app's project-bound MCP tools. */
import fs from "node:fs/promises";
import path from "node:path";
import type { AudioJob, EvidenceReport } from "../shared/music/audio-intelligence/types.ts";
import type { VocalMixRun } from "../shared/music/audio-intelligence/vocal-mix.ts";

const root = path.resolve("data/vocal-mix-pilot");
const config = JSON.parse(await fs.readFile(path.join(root, "app-pilot.json"), "utf8")) as { projectId: string; server: string };
const call = async <T>(name: string, args: object = {}): Promise<T> => {
  const response = await fetch(`${config.server}/mcp?chat=${config.projectId}`, { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }) });
  const body = await response.json();
  if (!response.ok || body.error || body.result?.isError) throw new Error(JSON.stringify(body));
  const text = body.result.content.find((c: { type: string }) => c.type === "text").text;
  return (text.startsWith("{") || text.startsWith("[") ? JSON.parse(text) : text) as T;
};
if (process.argv.includes("--review-only")) {
  const saved = JSON.parse(await fs.readFile(path.join(root, "assistant-verification.json"), "utf8"));
  await call("review_vocal_mix_run", { runId: saved.comparison.id });
  console.log("Verified the existing native comparison and opened playback through MCP");
  process.exit(0);
}
const complete = async (id: string) => {
  for (let i = 0; i < 300; i++) {
    const job = await call<AudioJob>("get_audio_job", { jobId: id });
    if (job.status === "succeeded") return job;
    if (["failed", "cancelled", "interrupted"].includes(job.status)) throw new Error(JSON.stringify(job));
    await new Promise(r => setTimeout(r, 100));
  }
  throw new Error("Audio job timed out");
};
const snapshot = await call<{ id: string; capture: { origin: string } }>("capture_audio_snapshot");
if (snapshot.capture.origin !== "live-document") throw new Error("Capture did not use the live assistant bridge");
const render = await call<AudioJob>("render_audio_passage", { snapshotId: snapshot.id, startTick: 768, endTick: 3072, leadInTicks: 768, tailSeconds: 4 });
const rendered = await complete(render.id);
const analysis = await call<AudioJob>("analyse_audio_artifact", { artifactId: rendered.result!.artifactIds[0] });
const measured = await complete(analysis.id);
const report = await call<EvidenceReport>("get_audio_report", { reportId: measured.result!.evidenceIds[0] });
if (!report.measurements.some(m => m.name === "rmsDbfs" && m.value !== null) || report.observations.length) throw new Error("Missing local evidence or invented observations");
console.log("B verified: live assistant capture → native passage render → local measurements → report");
const created = await call<VocalMixRun>("create_vocal_mix_run", { snapshotId: snapshot.id, vocalTrackId: "insert_vocal", goal: "Audition vocal balance against the recorded accompaniment",
  startTick: 768, endTick: 3072, checkStartTick: 3840, checkEndTick: 6144 });
let comparison = created;
for (let i = 0; i < 300 && comparison.status !== "ready"; i++) {
  await new Promise(r => setTimeout(r, 200));
  comparison = await call<VocalMixRun>("get_vocal_mix_run", { runId: created.id });
  if (["failed", "interrupted", "cancelled"].includes(comparison.status)) throw new Error(JSON.stringify(comparison));
}
if (comparison.status !== "ready" || comparison.candidates.length < 1 || comparison.candidates.some(c => c.renders.some(r => !r.reportId || r.auditionGainDb === null || r.auditionGainDb > 0))) throw new Error("Incomplete comparison or invalid audition gains");
await fs.writeFile(path.join(root, "assistant-verification.json"), JSON.stringify({ snapshot, render: rendered, analysis: measured, report, comparison }, null, 2));
console.log(`Comparison ready: ${comparison.id}; ${comparison.candidates.length - 1} measured alternative(s) and the baseline, two passages each`);
await call("review_vocal_mix_run", { runId: comparison.id });
console.log("Opened native app comparison playback");
