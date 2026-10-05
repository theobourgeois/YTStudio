/**
 * The hearing benchmark (Slice C's acceptance), from cleared recordings to a certificate:
 *
 *   pnpm tsx scripts/hearing-benchmark.ts fetch                 download the pinned recordings, check hashes and licences
 *   pnpm tsx scripts/hearing-benchmark.ts prepare               make every case's clip (cases.json + cases/*.wav)
 *   pnpm tsx scripts/hearing-benchmark.ts run --provider=qwen --split=development [--repeats=1] [--task=tone] [--parallel=4]
 *   pnpm tsx scripts/hearing-benchmark.ts compare               development runs side by side, to pick a provider (compare.html)
 *   pnpm tsx scripts/hearing-benchmark.ts review --run=heldout-qwen [--port=5330]   the blind review page
 *   pnpm tsx scripts/hearing-benchmark.ts score --run=heldout-qwen [--certify=file.json]
 *
 * Everything lives in the gitignored data/hearing-benchmark/. Reviews are people's: nothing here writes one.
 */
import { createWriteStream } from "node:fs";
import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { FFMPEG } from "../server/config.ts";
import { run as runProgram } from "../server/process.ts";
import { readWav, writeWavChannels } from "../server/music/wav.ts";
import { hashStream } from "../server/music/audio-intelligence/files.ts";
import { AudioIntelligence } from "../server/music/audio-intelligence/service.ts";
import { GeminiPerception, HEARING_PROMPT_VERSION, type PerceptionAdapter } from "../server/music/audio-intelligence/perception.ts";
import { QwenPerception } from "../server/music/audio-intelligence/qwen-perception.ts";
import type { AudioEngine } from "../server/music/engine.ts";
import { hashJson } from "../shared/music/hash.ts";
import { HEARING_TASKS, type HearingReceipt, type HearingTask } from "../shared/music/audio-intelligence/hearing.ts";
import { createHearingCertification, evaluateHearing, HEARING_ARMS, type HearingEvaluation, type HearingReview, type HearingTrial } from "../shared/music/audio-intelligence/hearing-benchmark.ts";
import { activeSpan, armTexts, assembleEvaluation, BENCHMARK_QUESTIONS, BENCHMARK_SOURCES, benchmarkCases, blindOrder, deriveAudio, evaluationCase, knownFacts, MIX_EVALUATION, PASSAGE_SECONDS, steadiestSpan, windowRmsDb,
  type ArmTexts, type BenchmarkSource, type CaseSpec, type ProviderFindings } from "../shared/music/audio-intelligence/hearing-pack.ts";
import type { AudioArtifact, AudioJob } from "../shared/music/audio-intelligence/types.ts";

const ROOT = path.resolve(import.meta.dirname, "..", "data", "hearing-benchmark");
const SOURCES = path.join(ROOT, "sources"), CASES = path.join(ROOT, "cases"), RUNS = path.join(ROOT, "runs");
const RATE = 48000;
const [command, ...rest] = process.argv.slice(2);
const flag = (name: string) => rest.find(a => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const readJson = async <T>(file: string): Promise<T> => JSON.parse(await fs.readFile(file, "utf8")) as T;
const writeJson = async (file: string, value: unknown) => { await fs.mkdir(path.dirname(file), { recursive: true }); await fs.writeFile(file, `${JSON.stringify(value, null, 2)}\n`); };
const exists = (file: string) => fs.stat(file).then(() => true, () => false);

interface SourceFile { sourceId: string; name: string; repoPath: string; file: string; sha256: string; bytes: number }
interface SourcesManifest { dataset: typeof MIX_EVALUATION; licencesSha256: string; files: SourceFile[]; sources: BenchmarkSource[] }
interface PreparedCase { spec: CaseSpec; question: string; facts: string[]; start: number; gainDb: number; file: string; sha256: string }
interface TrialRecord extends HearingTrial { task: HearingTask; jobId: string | null; unavailableReason: string | null; arms: ArmTexts | null; receipt: HearingReceipt | null }
interface RunManifest { split: string; provider: string; identity: HearingEvaluation["identity"]; trials: TrialRecord[] }

// fetch: the pinned files, each checked against the hash the repository gives it, and the licences they're used under.

const resolveUrl = (p: string) => `https://huggingface.co/datasets/${MIX_EVALUATION.repo}/resolve/${MIX_EVALUATION.revision}/${p.split("/").map(encodeURIComponent).join("/")}`;
async function expectedHashes(dir: string): Promise<Map<string, string>> {
  const response = await fetch(`https://huggingface.co/api/datasets/${MIX_EVALUATION.repo}/tree/${MIX_EVALUATION.revision}/${dir.split("/").map(encodeURIComponent).join("/")}`);
  if (!response.ok) throw new Error(`Listing ${dir}: HTTP ${response.status}`);
  const entries = await response.json() as { path: string; lfs?: { oid: string } }[];
  return new Map(entries.filter(e => e.lfs).map(e => [e.path, e.lfs!.oid]));
}
async function download(repoPath: string, file: string, expected: string | undefined) {
  if (await exists(file)) {
    const { sha256 } = await hashStream(file);
    if (!expected || sha256 === expected) return;
  }
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temp = `${file}.part`;
  // A dropped connection leaves a short file: try again, at most three times.
  for (let attempt = 1; ; attempt++) {
    const response = await fetch(resolveUrl(repoPath));
    if (!response.ok || !response.body) throw new Error(`Downloading ${repoPath}: HTTP ${response.status}`);
    await pipeline(Readable.fromWeb(response.body as never), createWriteStream(temp));
    const { sha256 } = await hashStream(temp);
    if (!expected || sha256 === expected) break;
    await fs.rm(temp, { force: true });
    if (attempt === 3) throw new Error(`${repoPath}: SHA-256 ${sha256} isn't the repository's ${expected}.`);
  }
  await fs.rename(temp, file);
}
async function fetchSources() {
  const licencesFile = path.join(SOURCES, MIX_EVALUATION.licences);
  await download(MIX_EVALUATION.licences, licencesFile, undefined);
  const xml = await fs.readFile(licencesFile, "utf8");
  const files: SourceFile[] = [];
  const listed = new Map<string, Map<string, string>>();
  for (const source of BENCHMARK_SOURCES) {
    const block = [...xml.matchAll(/<song id="(\w+)">([\s\S]*?)<\/song>/g)].find(m => m[1] === source.songId);
    const licence = block?.[2].match(/<license>(.*?)<\/license>/)?.[1] ?? "";
    if (licence !== source.licence.replace("CC", "Creative Commons")) throw new Error(`${source.song}: songs.xml says "${licence || "nothing"}", not ${source.licence}.`);
    for (const [name, repoPath] of Object.entries(source.files)) {
      const dir = path.posix.dirname(repoPath);
      if (!listed.has(dir)) listed.set(dir, await expectedHashes(dir));
      const expected = listed.get(dir)!.get(repoPath);
      if (!expected) throw new Error(`${repoPath} isn't in the repository at ${MIX_EVALUATION.revision}.`);
      const file = path.join(SOURCES, repoPath);
      process.stdout.write(`${source.id} ${name}… `);
      await download(repoPath, file, expected);
      const { sha256, bytes } = await hashStream(file);
      files.push({ sourceId: source.id, name, repoPath, file: path.relative(ROOT, file), sha256, bytes });
      console.log(`${(bytes / 1e6).toFixed(1)} MB ok`);
    }
  }
  const manifest: SourcesManifest = { dataset: MIX_EVALUATION, licencesSha256: (await hashStream(licencesFile)).sha256, files, sources: BENCHMARK_SOURCES };
  await writeJson(path.join(ROOT, "sources.json"), manifest);
  console.log(`${files.length} files from ${BENCHMARK_SOURCES.length} sources: ${path.join(ROOT, "sources.json")}`);
}

// prepare: each case's clip, from its source's passage.

/** A file through ffmpeg into 32-bit float samples: `input` options go before it (seeking), `output` after. */
async function decode(file: string, input: string[], output: string[]) {
  const temp = path.join(ROOT, `decode-${process.pid}-${Math.random().toString(16).slice(2)}.wav`);
  try {
    await runProgram(FFMPEG, ["-v", "error", "-y", ...input, "-i", file, ...output, "-c:a", "pcm_f32le", temp]);
    return await readWav(temp);
  } finally { await fs.rm(temp, { force: true }); }
}
async function prepareCases() {
  const manifest = await readJson<SourcesManifest>(path.join(ROOT, "sources.json"));
  const fileOf = (sourceId: string, name: string) => { const f = manifest.files.find(x => x.sourceId === sourceId && x.name === name); if (!f) throw new Error(`Fetch first: no ${sourceId} ${name}.`); return path.join(ROOT, f.file); };
  const levels = new Map<string, number[]>();
  const levelsOf = async (file: string) => {
    if (!levels.has(file)) levels.set(file, windowRmsDb((await decode(file, [], ["-ac", "1", "-ar", "8000"])).channels, 8000));
    return levels.get(file)!;
  };
  const prepared: PreparedCase[] = [];
  await fs.mkdir(CASES, { recursive: true });
  for (const spec of benchmarkCases()) {
    const source = BENCHMARK_SOURCES.find(s => s.id === spec.sourceId)!;
    const d = spec.derivation;
    const used = source.kind === "mix" ? ["mix"] : d.kind === "solo" ? [d.stem] : Object.keys(source.files);
    let start = 0, steadySpreadDb: number | undefined;
    if (spec.placement.kind === "at") start = spec.placement.start;
    else if (spec.placement.kind === "steadiest") ({ start, spreadDb: steadySpreadDb } = steadiestSpan(await levelsOf(fileOf(source.id, used[0])), PASSAGE_SECONDS));
    else start = activeSpan(await Promise.all(spec.placement.stems.map(s => levelsOf(fileOf(source.id, s)))), PASSAGE_SECONDS);
    const clip = async (name: string) => (await decode(fileOf(source.id, name), ["-ss", String(start), "-t", String(PASSAGE_SECONDS)], ["-ac", "2", "-ar", String(RATE)])).channels;
    const input = source.kind === "mix" ? { mix: await clip("mix") } : { stems: Object.fromEntries(await Promise.all(used.map(async n => [n, await clip(n)] as const))) };
    const { channels, gainDb } = deriveAudio(d, RATE, input);
    const file = path.join(CASES, `${spec.id}.wav`);
    await writeWavChannels(file, channels, RATE);
    const { sha256 } = await hashStream(file);
    prepared.push({ spec, question: BENCHMARK_QUESTIONS[spec.task], facts: knownFacts(spec, source, { steadySpreadDb }), start, gainDb, file: path.relative(ROOT, file), sha256 });
    console.log(`${spec.id}: ${start}–${start + PASSAGE_SECONDS} s${gainDb < 0 ? `, scaled ${gainDb.toFixed(1)} dB` : ""}`);
  }
  await writeJson(path.join(ROOT, "cases.json"), prepared);
  const summary = HEARING_TASKS.map(task => {
    const held = prepared.filter(c => c.spec.task === task && c.spec.split === "heldout");
    return `${task}: ${held.length} held-out (${held.filter(c => c.spec.control).length} controls) from ${new Set(held.map(c => c.spec.family)).size} families, ${prepared.filter(c => c.spec.task === task && c.spec.split === "development").length} development`;
  });
  console.log(summary.join("\n"));
  await writeListeningSheet(prepared, manifest);
}

/** One page with every clip and what was done to it: for checking the recordings before anything is sent anywhere. */
async function writeListeningSheet(cases: PreparedCase[], manifest: SourcesManifest) {
  const esc = (s: string) => s.replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
  const rows = cases.map(c => `<tr><td><b>${esc(c.spec.id)}</b><br><small>${c.spec.split} · ${c.spec.family}${c.spec.control ? " · <b>control</b>" : ""}</small></td><td><audio controls preload="none" src="${esc(c.file)}"></audio></td><td>${c.facts.map(esc).join("<br>")}<br><small>source ${c.start}–${c.start + PASSAGE_SECONDS} s</small></td></tr>`);
  const sources = manifest.sources.map(s => `<li>${esc(s.song)} — ${esc(s.artist)} (${s.licence}, ${esc(s.origin)}; ${s.split}, family ${s.family})</li>`);
  await fs.writeFile(path.join(ROOT, "recordings.html"), `<!doctype html><meta charset="utf-8"><title>Hearing benchmark recordings</title><style>body{font:14px system-ui;margin:24px}td{border-top:1px solid #ccc;padding:8px;vertical-align:top}</style>
<h1>Hearing benchmark: recordings</h1><p>Mix Evaluation Dataset 2.0 (${MIX_EVALUATION.repo} @ ${MIX_EVALUATION.revision.slice(0, 10)}), licences from songs.xml. Check each clip is what its line says.</p><ul>${sources.join("")}</ul><table>${rows.join("\n")}</table>`);
  console.log(`Listening sheet: ${path.join(ROOT, "recordings.html")}`);
}

// run: each case through the app's own hearing pipeline, twice for held-out cases (each repeat its own project, so no cache).

function provider(name: string): PerceptionAdapter {
  if (name === "qwen") {
    if (!process.env.DASHSCOPE_API_KEY) throw new Error("Set DASHSCOPE_API_KEY in .env.");
    return new QwenPerception({ apiKey: process.env.DASHSCOPE_API_KEY, baseUrl: process.env.DASHSCOPE_BASE_URL, model: process.env.EDITOR_QWEN_HEARING_MODEL });
  }
  if (name === "gemini") {
    if (!process.env.GEMINI_API_KEY) throw new Error("Set GEMINI_API_KEY in .env.");
    return new GeminiPerception({ apiKey: process.env.GEMINI_API_KEY, model: process.env.EDITOR_HEARING_MODEL });
  }
  throw new Error("--provider is gemini or qwen.");
}
async function runProvider() {
  const providerName = flag("provider") ?? "", split = flag("split") ?? "development", only = flag("task");
  if (!["development", "heldout"].includes(split)) throw new Error("--split is development or heldout.");
  const repeats = Number(flag("repeats") ?? (split === "heldout" ? 2 : 1));
  const cases = (await readJson<PreparedCase[]>(path.join(ROOT, "cases.json"))).filter(c => c.spec.split === split && (!only || c.spec.task === only));
  const adapter = provider(providerName), caps = adapter.capabilities();
  const dir = path.join(RUNS, `${split}-${providerName}`), manifestFile = path.join(dir, "run.json");
  const identity = { provider: caps.provider, model: caps.model, adapterVersion: caps.adapterVersion, destination: caps.destination, promptVersion: HEARING_PROMPT_VERSION };
  const manifest: RunManifest = await exists(manifestFile) ? await readJson<RunManifest>(manifestFile) : { split, provider: providerName, identity, trials: [] };
  if (hashJson(manifest.identity) !== hashJson(identity)) throw new Error(`${dir} was run with ${JSON.stringify(manifest.identity)}; move it aside to run another model.`);
  const projects = Array.from({ length: repeats }, (_, r) => `proj_${(0xb000 + r).toString(16).padStart(12, "0")}`);
  // Workers each have a store of their own (jobs run one at a time per store); each repeat is a project of its own, so never cached.
  const parallel = Math.max(1, Number(flag("parallel") ?? 1));
  const queue = cases.flatMap(c => Array.from({ length: repeats }, (_, repeat) => ({ c, repeat }))).filter(({ c, repeat }) => !manifest.trials.find(t => t.id === `${c.spec.id}-r${repeat}`)?.completed);
  let stop: Error | null = null, writing = Promise.resolve();
  const save = () => (writing = writing.then(() => writeJson(manifestFile, manifest)));
  const worker = async (w: number) => {
    const store = path.join(dir, "store", `w${w}`), media = new Map<string, string>();
    const service = new AudioIntelligence({ root: store, engine: {} as AudioEngine, perception: adapter, projectDir: () => dir,
      samplePath: (_project, mediaId) => media.get(mediaId) ?? null, isMusicProject: id => projects.includes(id) });
    await service.init();
    try {
      for (const project of projects) await service.setHearingSettings(project, true);
      for (let next = queue.shift(); next && !stop; next = queue.shift()) {
        const { c, repeat } = next, id = `${c.spec.id}-r${repeat}`, project = projects[repeat];
        media.set(c.spec.id, path.join(ROOT, c.file));
        const artifact = await service.tool(project, "register_audio_artifact", { mediaId: c.spec.id }) as AudioArtifact;
        if (artifact.contentSha256 !== c.sha256) throw new Error(`${c.file} changed since prepare.`);
        const job = await service.tool(project, "hear_audio_artifact", { artifactId: artifact.id, task: c.spec.task, question: c.question }) as AudioJob;
        let settled = job;
        for (const deadline = Date.now() + 600_000; ["queued", "running"].includes(settled.status) && Date.now() < deadline; ) { await new Promise(r => setTimeout(r, 250)); settled = service.get(project, job.id); }
        const receipt = settled.status === "succeeded" ? await service.hearingReceipt(project, job.id) : null;
        const heard = receipt && !receipt.unavailableReason ? await validatedOutput(path.join(store, project), job.id) : null;
        const report = settled.result?.evidenceIds[0] ? await service.report(project, settled.result.evidenceIds[0]) : null;
        const trial: TrialRecord = { id, caseId: c.spec.id, repeat, task: c.spec.task, completed: Boolean(heard && receipt?.resolvedModel), resolvedModel: receipt?.resolvedModel ?? null,
          outputSha256: hashJson(heard ?? receipt?.unavailableReason ?? settled.status), jobId: job.id, unavailableReason: receipt?.unavailableReason ?? (settled.status !== "succeeded" ? `job ${settled.status}` : null),
          arms: heard && report ? armTexts(report.measurements, heard) : null, receipt };
        manifest.trials = [...manifest.trials.filter(t => t.id !== id), trial];
        await save();
        const tokens = receipt?.attempts.reduce((n, a) => n + (a.inputTokens ?? 0) + (a.outputTokens ?? 0), 0) ?? 0;
        console.log(`${id}: ${trial.completed ? `${heard!.findings.length} finding(s)` : `NOT completed (${trial.unavailableReason})`}; ${receipt?.attempts.length ?? 0} attempt(s), ${tokens} tokens`);
        if (!trial.completed && /key|auth|configured|Free Tier/i.test(trial.unavailableReason ?? "")) stop = new Error("Stopping: the provider refused the configuration.");
      }
    } finally {
      for (const project of projects) await service.setHearingSettings(project, false).catch(() => {});
      service.shutdown();
    }
  };
  await Promise.all(Array.from({ length: parallel }, (_, w) => worker(w)));
  if (stop) throw stop;
  const trials = manifest.trials.filter(t => cases.some(c => c.spec.id === t.caseId));
  console.log(`${trials.filter(t => t.completed).length}/${trials.length} trials completed: ${manifestFile}`);
}
/** The provider's findings after the app's validation (what the assistant would be given), from the job's cache entry. */
async function validatedOutput(projectStore: string, jobId: string): Promise<ProviderFindings | null> {
  const dir = path.join(projectStore, "hearing-cache");
  for (const name of await fs.readdir(dir).catch(() => [] as string[])) {
    const entry = await readJson<{ jobId?: string; output?: ProviderFindings }>(path.join(dir, name));
    if (entry.jobId === jobId && entry.output) return entry.output;
  }
  return null;
}

// compare: the development runs side by side (not blind: it only picks which provider goes to the held-out review).

async function compare() {
  const cases = (await readJson<PreparedCase[]>(path.join(ROOT, "cases.json"))).filter(c => c.spec.split === "development");
  const runs: RunManifest[] = [];
  for (const name of await fs.readdir(RUNS).catch(() => [] as string[])) if (name.startsWith("development-")) runs.push(await readJson<RunManifest>(path.join(RUNS, name, "run.json")));
  if (!runs.length) throw new Error("Run a provider on the development split first.");
  const esc = (s: string) => s.replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
  const rows = cases.map(c => `<section><h3>${esc(c.spec.id)}${c.spec.control ? " (control)" : ""}</h3><audio controls preload="none" src="${esc(c.file)}"></audio><p><i>${esc(c.question)}</i></p><p>${c.facts.map(esc).join("<br>")}</p><div class="cols">${runs.map(r => {
    const t = r.trials.filter(x => x.caseId === c.spec.id);
    return `<div><h4>${esc(r.identity.provider)} · ${esc(r.identity.model)}</h4>${t.map(x => `<pre>${esc(x.arms?.audio ?? `Not completed: ${x.unavailableReason}`)}</pre>`).join("") || "<p>not run</p>"}</div>`;
  }).join("")}</div></section>`);
  await fs.writeFile(path.join(ROOT, "compare.html"), `<!doctype html><meta charset="utf-8"><title>Hearing: development comparison</title><style>body{font:14px system-ui;margin:24px;max-width:1200px}.cols{display:grid;grid-template-columns:repeat(${runs.length},1fr);gap:16px}pre{white-space:pre-wrap;background:#f4f4f4;padding:8px}section{border-top:1px solid #ccc;margin-top:16px}</style><h1>Development comparison</h1>${rows.join("\n")}`);
  console.log(`${path.join(ROOT, "compare.html")}`);
}

// review: a local page; each reviewer scores each completed trial's three arms, unlabelled and in their own order.

async function review() {
  const runName = flag("run") ?? "", dir = path.join(RUNS, runName), port = Number(flag("port") ?? 5330);
  const manifest = await readJson<RunManifest>(path.join(dir, "run.json"));
  const cases = new Map((await readJson<PreparedCase[]>(path.join(ROOT, "cases.json"))).map(c => [c.spec.id, c]));
  const reviewsFile = (reviewer: string) => path.join(dir, "reviews", `${reviewer.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}.json`);
  const send = (res: http.ServerResponse, status: number, body: string | Buffer, type = "application/json") => { res.writeHead(status, { "Content-Type": type }); res.end(body); };
  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", "http://localhost");
      if (url.pathname === "/") return send(res, 200, REVIEW_PAGE, "text/html; charset=utf-8");
      if (url.pathname.startsWith("/audio/")) {
        const c = cases.get(decodeURIComponent(url.pathname.slice(7)));
        return c ? send(res, 200, await fs.readFile(path.join(ROOT, c.file)), "audio/wav") : send(res, 404, "{}");
      }
      const reviewer = (url.searchParams.get("reviewer") ?? "").trim();
      if (!/^[\p{L}\p{N} .'-]{2,60}$/u.test(reviewer)) return send(res, 400, JSON.stringify({ error: "Enter your name (2 to 60 letters)." }));
      const file = reviewsFile(reviewer);
      const saved: HearingReview[] = await exists(file) ? await readJson(file) : [];
      if (url.pathname === "/api/items" && req.method === "GET") {
        const items = manifest.trials.filter(t => t.completed && t.arms).sort((a, b) => hashJson([a.id, reviewer]).localeCompare(hashJson([b.id, reviewer]))).map(t => {
          const c = cases.get(t.caseId)!, order = blindOrder(t.id, reviewer);
          return { trialId: t.id, caseId: t.caseId, task: t.task, control: c.spec.control, question: c.question, facts: c.facts,
            arms: order.map((arm, i) => ({ label: "ABC"[i], text: t.arms![arm] })),
            scores: order.map(arm => saved.find(r => r.trialId === t.id && r.arm === arm) ?? null) };
        });
        return send(res, 200, JSON.stringify({ items }));
      }
      if (url.pathname === "/api/review" && req.method === "POST") {
        const body = JSON.parse(await new Promise<string>(resolve => { let s = ""; req.on("data", d => { s += d; }); req.on("end", () => resolve(s)); })) as { trialId: string; scores: Omit<HearingReview, "trialId" | "reviewer" | "arm">[] };
        const trial = manifest.trials.find(t => t.id === body.trialId && t.completed);
        if (!trial || !Array.isArray(body.scores) || body.scores.length !== 3) return send(res, 400, JSON.stringify({ error: "Unknown trial or scores." }));
        const order = blindOrder(trial.id, reviewer);
        const reviews = body.scores.map((s, i): HearingReview => ({ trialId: trial.id, reviewer, arm: order[i], usefulness: Number(s.usefulness), factualError: s.factualError === true,
          unsupportedClaim: s.unsupportedClaim === true, timestampsCorrect: s.timestampsCorrect !== false, noChangeCorrect: s.noChangeCorrect !== false }));
        if (reviews.some(r => !Number.isInteger(r.usefulness) || r.usefulness < 0 || r.usefulness > 3)) return send(res, 400, JSON.stringify({ error: "Usefulness is 0 to 3." }));
        await writeJson(file, [...saved.filter(r => r.trialId !== trial.id), ...reviews]);
        return send(res, 200, JSON.stringify({ ok: true }));
      }
      send(res, 404, "{}");
    } catch (error) { send(res, 500, JSON.stringify({ error: error instanceof Error ? error.message : String(error) })); }
  });
  server.listen(port, "127.0.0.1", () => console.log(`Review ${runName} at http://127.0.0.1:${port}/ (Ctrl+C to stop; every answer is saved as it's given)`));
}

// score: the gate, from the run and every reviewer's file. A certificate only if a task passes.

async function score() {
  const runName = flag("run") ?? "", dir = path.join(RUNS, runName);
  const manifest = await readJson<RunManifest>(path.join(dir, "run.json"));
  const cases = (await readJson<PreparedCase[]>(path.join(ROOT, "cases.json"))).filter(c => c.spec.split === manifest.split);
  const reviews: HearingReview[] = [];
  for (const name of await fs.readdir(path.join(dir, "reviews")).catch(() => [] as string[])) reviews.push(...await readJson<HearingReview[]>(path.join(dir, "reviews", name)));
  const evaluation = assembleEvaluation(manifest.identity, cases.map(c => evaluationCase(c.spec, c.sha256)),
    manifest.trials.map(({ id, caseId, repeat, completed, resolvedModel, outputSha256 }) => ({ id, caseId, repeat, completed, resolvedModel, outputSha256 })), reviews);
  const verdicts = evaluateHearing(evaluation);
  const reviewers = new Set(reviews.map(r => r.reviewer));
  console.log(`${manifest.identity.provider} ${manifest.identity.model}: ${reviews.length} reviews by ${reviewers.size} reviewer(s)`);
  for (const v of verdicts) console.log(`\n${v.task}: ${v.passed ? "PASSED" : "not passed"} · ${v.cases} cases, ${v.families} families, ${v.reviewedTrials} fully reviewed trials, improvement ${v.improvementRate === null ? "n/a" : `${Math.round(v.improvementRate * 100)}%`}\n${v.reasons.slice(0, 12).map(r => `  - ${r}`).join("\n")}${v.reasons.length > 12 ? `\n  … ${v.reasons.length - 12} more` : ""}`);
  const perArm = HEARING_ARMS.map(arm => { const rs = reviews.filter(r => r.arm === arm); return `${arm}: mean usefulness ${rs.length ? (rs.reduce((n, r) => n + r.usefulness, 0) / rs.length).toFixed(2) : "n/a"}, ${rs.filter(r => r.factualError || r.unsupportedClaim).length} flagged`; });
  console.log(`\n${perArm.join("\n")}`);
  await writeJson(path.join(dir, "evaluation.json"), evaluation);
  const certify = flag("certify");
  if (certify) {
    if (!verdicts.some(v => v.passed)) throw new Error("No task passed: no certificate.");
    await writeJson(path.resolve(certify), createHearingCertification(evaluation));
    console.log(`Certificate: ${path.resolve(certify)} (set EDITOR_HEARING_CERTIFICATION to it and restart the server)`);
  }
}

const REVIEW_PAGE = `<!doctype html><meta charset="utf-8"><title>Hearing review</title>
<style>body{font:14px system-ui;margin:0;background:#f3f4f6;color:#111}main{max-width:1100px;margin:24px auto;padding:0 16px}header{display:flex;gap:12px;align-items:center}
.card{background:#fff;border:1px solid #d4d4d8;border-radius:6px;padding:16px;margin-top:16px}.arms{display:grid;grid-template-columns:repeat(3,1fr);gap:12px}pre{white-space:pre-wrap;font:12px ui-monospace,monospace;background:#f8f8f8;padding:8px;max-height:340px;overflow:auto}
label{display:block;margin:4px 0}.facts{background:#fffbe6;padding:8px;border-radius:4px}button{padding:6px 14px}.muted{color:#666}</style>
<main><header><h2 style="margin:0">Hearing review</h2><input id="name" placeholder="Your name"><button id="start">Start</button><span id="progress" class="muted"></span></header>
<p class="muted">Listen to the clip, then score each answer for this question. A, B and C are in a random order. Usefulness: 0 useless, 1 limited, 2 useful, 3 very useful. Flag any claim about the audio that is wrong (factual error) or that the audio can't support (unsupported). Answers that only measure can't have wrong times: leave their box ticked.</p>
<div id="item"></div></main>
<script>
let items=[],at=0,reviewer="";const $=s=>document.querySelector(s),esc=s=>s.replace(/[&<>]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;"})[c]);
$("#name").value=localStorage.reviewer||"";
$("#start").onclick=async()=>{reviewer=$("#name").value.trim();localStorage.reviewer=reviewer;const r=await fetch("/api/items?reviewer="+encodeURIComponent(reviewer));const j=await r.json();if(j.error)return alert(j.error);items=j.items;at=Math.max(0,items.findIndex(i=>i.scores.some(s=>!s)));if(at<0)at=0;show()};
function show(){const done=items.filter(i=>i.scores.every(s=>s)).length;$("#progress").textContent=done+" of "+items.length+" done";const i=items[at];if(!i){$("#item").innerHTML="<div class=card>Nothing to review.</div>";return}
$("#item").innerHTML='<div class=card><b>'+(at+1)+' / '+items.length+'</b> · '+i.task+(i.control?' · <b>no-change control</b>':'')+'<p><audio controls src="/audio/'+encodeURIComponent(i.caseId)+'"></audio></p><p><b>Question:</b> '+esc(i.question)+'</p><div class=facts><b>What is known about this clip</b><br>'+i.facts.map(esc).join("<br>")+'</div></div><div class="card arms">'+i.arms.map((a,k)=>{const s=i.scores[k]||{usefulness:null,factualError:false,unsupportedClaim:false,timestampsCorrect:true,noChangeCorrect:true};return '<div><h3>'+a.label+'</h3><pre>'+esc(a.text)+'</pre>'+[0,1,2,3].map(u=>'<label style="display:inline;margin-right:8px"><input type=radio name=u'+k+' value='+u+(s.usefulness===u?' checked':'')+'> '+u+'</label>').join("")+
'<label><input type=checkbox id=f'+k+(s.factualError?' checked':'')+'> factual error</label><label><input type=checkbox id=x'+k+(s.unsupportedClaim?' checked':'')+'> unsupported claim</label><label><input type=checkbox id=t'+k+(s.timestampsCorrect?' checked':'')+'> times correct</label>'+(i.control?'<label><input type=checkbox id=n'+k+(s.noChangeCorrect?' checked':'')+'> correctly reports no change</label>':'')+'</div>'}).join("")+'</div><p><button id=prev>Previous</button> <button id=save>Save and next</button></p>';
$("#prev").onclick=()=>{at=Math.max(0,at-1);show()};$("#save").onclick=save}
async function save(){const i=items[at];const scores=[0,1,2].map(k=>{const u=document.querySelector('input[name=u'+k+']:checked');return{usefulness:u?Number(u.value):null,factualError:$("#f"+k).checked,unsupportedClaim:$("#x"+k).checked,timestampsCorrect:$("#t"+k).checked,noChangeCorrect:i.control?$("#n"+k).checked:true}});
if(scores.some(s=>s.usefulness===null))return alert("Give each answer a usefulness score.");const r=await fetch("/api/review?reviewer="+encodeURIComponent(reviewer),{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({trialId:i.trialId,scores})});const j=await r.json();if(j.error)return alert(j.error);i.scores=scores;at=Math.min(items.length-1,at+1);show()}
</script>`;

const commands: Record<string, () => Promise<void>> = { fetch: fetchSources, prepare: prepareCases, run: runProvider, compare, review, score };
if (!commands[command]) { console.error("Usage: pnpm tsx scripts/hearing-benchmark.ts fetch | prepare | run --provider=gemini|qwen [--split=development|heldout] | compare | review --run=<name> | score --run=<name> [--certify=file]"); process.exit(1); }
await commands[command]();
