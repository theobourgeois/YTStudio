/** Bounded live smoke/evaluation inputs, generated here. Never certifies listening quality. */
import fs from "node:fs/promises";
import path from "node:path";
import "../server/config.ts";
import { AudioIntelligence } from "../server/music/audio-intelligence/service.ts";
import { QwenPerception } from "../server/music/audio-intelligence/qwen-perception.ts";
import { GeminiPerception } from "../server/music/audio-intelligence/perception.ts";
import { FIXTURES, renderFixture } from "../shared/music/audio-intelligence/fixtures.ts";
import { writeWavChannels } from "../server/music/wav.ts";
import type { HearingTask } from "../shared/music/audio-intelligence/hearing.ts";
import type { AudioEngine } from "../server/music/engine.ts";
import type { AudioArtifact, AudioJob } from "../shared/music/audio-intelligence/types.ts";

const args = process.argv.slice(2);
const qwen = args.includes("--provider=qwen");
const key = qwen ? process.env.DASHSCOPE_API_KEY : process.env.GEMINI_API_KEY;
if (!key) throw new Error(`Set ${qwen ? "DASHSCOPE_API_KEY" : "GEMINI_API_KEY"} in the server environment or .env.`);
const root = path.resolve(args.find(a => !a.startsWith("--")) ?? (qwen ? "data/hearing-pilot-qwen" : "data/hearing-pilot"));
await fs.mkdir(root, { recursive: true });
const projectId = "proj_123456abcdef";
let source = "";
const provider = qwen ? new QwenPerception({ apiKey: key, baseUrl: process.env.DASHSCOPE_BASE_URL, model: process.env.EDITOR_QWEN_HEARING_MODEL })
  : new GeminiPerception({ apiKey: key, model: process.env.EDITOR_HEARING_MODEL });
const service = new AudioIntelligence({ root: path.join(root, "artifacts"), engine: {} as AudioEngine, perception: provider,
  projectDir: () => root, samplePath: (_p, mediaId) => mediaId === "media_fixture" ? source : null, isMusicProject: id => id === projectId });
await service.init();
await service.setHearingSettings(projectId, true);
const cases: { fixture: string; task: HearingTask; question: string }[] = [
  { fixture: "fixture_vocal_uneven", task: "dynamics", question: "Describe audible level changes across the clip. Do not suggest settings." },
  { fixture: "fixture_vocal_steady", task: "tone", question: "Describe audible tone without guessing the source or processor settings." },
  { fixture: "fixture_beat_120", task: "context", question: "Describe audible events in the clip, without exact measurements." },
  { fixture: "fixture_silence", task: "dynamics", question: "Are there audible level changes? Return no finding for silence." },
];
const results = [];
try {
  for (const test of cases) {
    const fixture = FIXTURES.find(f => f.id === test.fixture);
    if (!fixture) throw new Error(`Unknown generated fixture: ${test.fixture}`);
    const audio = renderFixture(fixture, FIXTURES);
    source = path.join(root, `${fixture.id}.wav`);
    await writeWavChannels(source, audio.channels, audio.sampleRate);
    const artifact = await service.tool(projectId, "register_audio_artifact", { mediaId: "media_fixture" }) as AudioArtifact;
    const job = await service.tool(projectId, "hear_audio_artifact", { artifactId: artifact.id, task: test.task, question: test.question }) as AudioJob;
    const deadline = Date.now() + 125_000;
    let settled = job;
    while (["queued", "running"].includes(settled.status) && Date.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, 100));
      settled = service.get(projectId, job.id);
    }
    if (settled.status !== "succeeded" || !settled.result) throw new Error(`Hearing job ${settled.status}.`);
    const receipt = await service.hearingReceipt(projectId, job.id);
    const report = await service.report(projectId, settled.result.evidenceIds[0]);
    results.push({ ...test, families: fixture.families, expected: fixture.expected, artifactId: artifact.id, receipt,
      dspOnly: { measurements: report.measurements, observations: [] },
      audioOnlyRawFile: path.join(root, "artifacts", projectId, "hearing-raw", `${job.id}.json`), combined: report,
      review: { usefulBeyondDsp: null, factualErrors: null, noChangeCorrect: null, reviewer: null } });
    console.log(`${test.fixture}: ${receipt.unavailableReason ?? "completed"}; ${receipt.attempts.length} provider attempt(s)`);
    // Stop after an unavailable API: avoid repeating a failed model/auth configuration.
    if (receipt.unavailableReason) break;
  }
  await fs.writeFile(path.join(root, "pilot.json"), JSON.stringify({ createdAt: Date.now(), capabilities: provider.capabilities(),
    acceptance: "not evaluated: generated smoke cases are not a held-out real-recording benchmark", results }, null, 2));
  console.log(`Evaluation record: ${path.join(root, "pilot.json")}`);
} finally { await service.setHearingSettings(projectId, false); service.shutdown(); }
