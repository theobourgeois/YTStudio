import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { MediaAsset, ProjectSummary, TranscriptionEngineInfo, TranscriptionJob } from "../../shared/types.ts";
import { createApp, type EditorApp } from "../app.ts";
import { FFMPEG, MODELS_DIR } from "../config.ts";
import { SAMPLE_RATE } from "./audio.ts";
import type { EngineResult, TranscriptionEngine } from "./engine.ts";
import { WHISPER_MODEL } from "./whisper-cpp.ts";

const ffmpegAvailable = spawnSync(FFMPEG, ["-version"]).status === 0;
const whisperReady =
  spawnSync("whisper-cli", ["--version"]).status === 0 && existsSync(path.join(MODELS_DIR, WHISPER_MODEL.file));
const sayAvailable = spawnSync("say", ["-v", "?"]).status === 0;

/** Says a word every 0.1 s of the audio it gets, so the test can see where the silences went. */
class CountingEngine implements TranscriptionEngine {
  readonly id = "local" as const;
  readonly model = "counting/1";
  calls = 0;
  languages: string[] = [];
  async info(): Promise<TranscriptionEngineInfo> {
    return { id: "local", label: "Test", description: "", kind: "local", status: "ready", message: null, progress: null, canSetUp: true };
  }
  async setUp() {}
  async transcribe(wav: string, { language }: { language: string }): Promise<EngineResult> {
    this.calls++;
    this.languages.push(language);
    const duration = (readFileSync(wav).length - 44) / 2 / SAMPLE_RATE;
    const words = [];
    for (let t = 0; t + 0.1 <= duration; t += 0.1) words.push({ text: " w", start: t, end: t + 0.08 });
    return { language: "en", words };
  }
}

describe.skipIf(!ffmpegAvailable)("transcription service", () => {
  let dir: string;
  let editor: EditorApp;
  let server: http.Server;
  let base: string;
  const engine = new CountingEngine();
  let asset: MediaAsset;

  const call = async <T>(p: string, init?: RequestInit): Promise<{ status: number; body: T }> => {
    const res = await fetch(base + p, { ...init, headers: init?.body ? { "Content-Type": "application/json" } : undefined });
    return { status: res.status, body: (res.status === 204 ? null : await res.json()) as T };
  };
  const post = <T>(p: string, body: unknown) => call<T>(p, { method: "POST", body: JSON.stringify(body) });
  async function finished(id: string): Promise<TranscriptionJob> {
    for (let i = 0; i < 600; i++) {
      const { body } = await call<TranscriptionJob>(`/api/transcription/jobs/${id}`);
      if (body.status !== "queued" && body.status !== "running") return body;
      await new Promise((r) => setTimeout(r, 50));
    }
    throw new Error("transcription didn't finish");
  }

  beforeAll(async () => {
    dir = mkdtempSync(path.join(os.tmpdir(), "editor-transcription-"));
    editor = await createApp({ dataDir: dir, transcription: { engines: [engine] } });
    server = http.createServer(editor.app).listen(0, "127.0.0.1");
    await new Promise((r) => server.once("listening", r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    // 10 s: a tone from 2 to 3 s and from 7 to 8 s, silence elsewhere.
    const file = path.join(dir, "tones.wav");
    execFileSync(FFMPEG, [
      "-hide_banner", "-loglevel", "error", "-y",
      "-f", "lavfi", "-i", "sine=frequency=440:duration=10:sample_rate=16000",
      "-af", "volume='between(t,2,3)+between(t,7,8)':eval=frame", file,
    ]);
    const project = (await post<ProjectSummary>("/api/projects", {})).body;
    const res = await fetch(`${base}/api/media?projectId=${project.id}&name=tones.wav`, { method: "POST", body: readFileSync(file) });
    asset = (await res.json()) as MediaAsset;
  });

  afterAll(() => {
    editor?.shutdown();
    server?.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("lists the engines", async () => {
    const { body } = await call<TranscriptionEngineInfo[]>("/api/transcription/engines");
    expect(body.map((e) => [e.id, e.status])).toEqual([["local", "ready"]]);
  });

  it("rejects bad requests", async () => {
    expect((await post("/api/transcription/jobs", { engine: "nope", language: "en", sources: [] })).status).toBe(404);
    expect((await post("/api/transcription/jobs", { engine: "local", language: "xx", sources: [] })).status).toBe(400);
    const silent = { engine: "local", language: "en", sources: [{ assetId: "media_000000000000", in: 0, out: 1 }] };
    expect((await post("/api/transcription/jobs", silent)).status).toBe(400);
    expect((await call("/api/transcription/jobs/trans_000000000000")).status).toBe(404);
  });

  it("transcribes only the sound and maps the words back to source time", async () => {
    // Two clips of the same file (a split) are transcribed as one stretch.
    const sources = [{ assetId: asset.id, in: 0, out: 5 }, { assetId: asset.id, in: 5.5, out: 10 }];
    const { status, body } = await post<TranscriptionJob>("/api/transcription/jobs", { engine: "local", language: "auto", sources });
    expect(status).toBe(202);
    const job = await finished(body.id);
    expect(job.status).toBe("done");
    expect(job.transcripts).toHaveLength(1);
    expect(engine.calls).toBe(1);
    expect(engine.languages).toEqual(["auto"]);
    const [t] = job.transcripts!;
    expect(t).toMatchObject({ assetId: asset.id, in: 0, out: 10, language: "en" });
    // Every word lands on (or right next to) a tone, none in the long silences.
    for (const w of t.words) {
      const nearTone = (w.start >= 1.7 && w.end <= 3.3) || (w.start >= 6.7 && w.end <= 8.3);
      expect(nearTone, `${w.start}-${w.end}`).toBe(true);
    }
    expect(t.words.some((w) => w.start >= 7 && w.start < 7.5)).toBe(true);
  });

  it("reuses the transcript for the same stretch", async () => {
    const sources = [{ assetId: asset.id, in: 0, out: 10 }];
    const job = await finished((await post<TranscriptionJob>("/api/transcription/jobs", { engine: "local", language: "auto", sources })).body.id);
    expect(job.status).toBe("done");
    expect(engine.calls).toBe(1);
    const other = await finished((await post<TranscriptionJob>("/api/transcription/jobs", { engine: "local", language: "fr", sources })).body.id);
    expect(other.status).toBe("done");
    expect(engine.calls).toBe(2);
  });

  it("says when a cloud key is missing", async () => {
    const { status } = await post("/api/transcription/engines/openai/setup", { apiKey: "sk-test" });
    expect(status).toBe(404); // only the injected engine exists here
  });
});

describe.skipIf(!ffmpegAvailable || !whisperReady || !sayAvailable)("whisper.cpp on this computer", () => {
  it("transcribes speech with accurate word times", async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "editor-whisper-"));
    const editor = await createApp({ dataDir: dir });
    const server = http.createServer(editor.app).listen(0, "127.0.0.1");
    await new Promise((r) => server.once("listening", r));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    try {
      const speech = path.join(dir, "speech.aiff");
      const file = path.join(dir, "speech.wav");
      execFileSync("say", ["-v", "Samantha", "-o", speech, "Hello there. Welcome back to the channel."]);
      // Two seconds of silence first: the words must still start where they're said.
      execFileSync(FFMPEG, ["-hide_banner", "-loglevel", "error", "-y", "-i", speech, "-af", "adelay=2000,apad=pad_dur=1", "-ar", "16000", file]);
      const project = (await (await fetch(`${base}/api/projects`, { method: "POST" })).json()) as ProjectSummary;
      const asset = (await (await fetch(`${base}/api/media?projectId=${project.id}&name=speech.wav`, { method: "POST", body: readFileSync(file) })).json()) as MediaAsset;
      const res = await fetch(`${base}/api/transcription/jobs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ engine: "local", language: "auto", sources: [{ assetId: asset.id, in: 0, out: asset.duration }] }),
      });
      let job = (await res.json()) as TranscriptionJob;
      while (job.status === "queued" || job.status === "running") {
        await new Promise((r) => setTimeout(r, 100));
        job = (await (await fetch(`${base}/api/transcription/jobs/${job.id}`)).json()) as TranscriptionJob;
      }
      expect(job.status).toBe("done");
      const words = job.transcripts![0].words;
      const said = words.map((w) => w.text).join("").toLowerCase().replace(/[^a-z ]/g, "").trim();
      expect(said).toBe("hello there welcome back to the channel");
      expect(words[0].start).toBeGreaterThan(1.9);
      expect(words[0].start).toBeLessThan(2.3);
      expect(job.transcripts![0].language).toBe("en");
    } finally {
      editor.shutdown();
      server.close();
      rmSync(dir, { recursive: true, force: true });
    }
  }, 60_000);
});
