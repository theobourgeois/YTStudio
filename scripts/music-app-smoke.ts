/**
 * Try the packaged music app on a Mac end to end (after `pnpm build:desktop music`; `pnpm test:desktop --app music`
 * runs this). WKWebView has no remote debugging protocol, so the page is watched from outside: the server's API on
 * the app's port, and its log, where the page's own requests show (`EDITOR_LOG_LEVEL=debug`). Launched on a throwaway
 * data folder, it checks the page loads, ffmpeg and the engine are found, a song exports (rendered by the app's engine,
 * offline: nothing is heard), a `.ytsng` handed to the running app (as Finder's double-click does) opens in its page,
 * and quitting saves and stops everything. Quit an installed YTStudio Music first: it's one instance.
 */
import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { FFMPEG } from "../server/config.ts";
import { addChannels, setSteps } from "../shared/music/edits.ts";
import { DEFAULT_EXPORT_SETTINGS, type MusicExportJob } from "../shared/music/export.ts";
import { createMusicProject, FIRST_PATTERN_ID } from "../shared/music/project.ts";
import type { MediaAsset, ProjectSummary } from "../shared/types.ts";

/** Whether every check passed. */
export async function smokeMusicApp(executable: string): Promise<boolean> {
  let passed = true;
  const check = (label: string, ok: boolean, detail = "") => {
    console.log(`${ok ? "ok  " : "FAIL"} ${label}${detail ? `  ${detail}` : ""}`);
    if (!ok) passed = false;
  };
  const bundle = path.resolve(executable, "../../..");
  // Its real path: macOS hands the app `/private/var/...` for `/var/...`, which the server would take for a copy.
  const tmp = realpathSync(mkdtempSync(path.join(os.tmpdir(), "music-app-")));
  const data = path.join(tmp, "data");
  const none = path.join(tmp, "no-recents");
  mkdirSync(none);
  const port = await new Promise<number>((resolve) => {
    const probe = net.createServer().listen(0, "127.0.0.1", () => {
      const { port } = probe.address() as net.AddressInfo;
      probe.close(() => resolve(port));
    });
  });
  const base = `http://127.0.0.1:${port}`;
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    EDITOR_DATA_DIR: data,
    EDITOR_SERVER_PORT: String(port),
    // Not YTStudio's recents, which a packaged app starts with.
    EDITOR_RECENTS_FROM: none,
    EDITOR_LOG_LEVEL: "debug",
  };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = spawn(executable, [], { env, stdio: "ignore" });
  const exited = new Promise<number | null>((resolve) => app.once("exit", (code) => resolve(code)));

  const wait = async (what: () => boolean | Promise<boolean>, ms: number) => {
    for (const end = Date.now() + ms; Date.now() < end; await new Promise((r) => setTimeout(r, 250))) if (await what()) return true;
    return false;
  };
  const log = () => {
    try {
      return readFileSync(path.join(data, "logs", "ytstudio.log"), "utf8");
    } catch {
      return "";
    }
  };
  const api = async <T>(p: string, init?: RequestInit) => {
    const res = await fetch(base + p, init);
    if (!res.ok) throw new Error(`${init?.method ?? "GET"} ${p}: ${res.status} ${await res.text()}`);
    return (await res.json()) as T;
  };
  const post = <T>(p: string, body: unknown) => api<T>(p, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

  try {
    const up = await wait(() => fetch(`${base}/api/app`).then((r) => r.ok, () => false), 30_000);
    check("starts its server", up, base);
    if (!up) return false;
    const { app: which } = await api<{ app: string | null }>("/api/app");
    check("is the music app", which === "music", String(which));
    check("its page loads in its window", await wait(() => /"GET \/api\/projects 200/.test(log()), 20_000));
    const shown = execFileSync("lsappinfo", ["info", "-only", "applicationtype", String(app.pid)], { encoding: "utf8" });
    check("has a Dock icon", /Foreground/.test(shown), shown.trim());
    const health = await api<{ ffmpeg: { available: boolean } }>("/api/health");
    check("finds ffmpeg (login shell PATH)", health.ffmpeg.available);
    check("its server is connected to its engine", /connected \(port \d+\)/.test(log()));
    const helper = await api<{ decoder: string | null }>("/api/photo/lab/helper");
    check("the photo helper runs from the app's resources", /^sharp /.test(helper.decoder ?? ""), helper.decoder ?? "");

    // A song of a quiet sample, exported by the app's engine (offline) and encoded by ffmpeg.
    const project = await post<ProjectSummary>("/api/projects", { suite: "music", name: "Music app smoke" });
    const sampleFile = path.join(tmp, "Quiet sample.wav");
    execFileSync(FFMPEG, ["-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", "sine=frequency=220:duration=0.4", "-af", "volume=0.08", sampleFile]);
    const sample = await post<MediaAsset>("/api/media/import-file", { projectId: project.id, path: sampleFile });
    const song = setSteps(addChannels(createMusicProject("Music app smoke", 120), [{ id: "chan_smoke", name: "Quiet sample", sampleId: sample.id }]), FIRST_PATTERN_ID, "chan_smoke", [0, 4, 8, 12], true);
    await api(`/api/projects/${project.id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(song) });
    const started = Date.now();
    let job = await post<MusicExportJob>("/api/music/exports", { projectId: project.id, song, patternId: FIRST_PATTERN_ID, settings: { ...DEFAULT_EXPORT_SETTINGS, mode: "pattern", formats: ["wav", "mp3"] } });
    await wait(async () => {
      job = await api<MusicExportJob>(`/api/music/exports/${job.id}`);
      return job.state !== "rendering" && job.state !== "encoding";
    }, 60_000);
    check("exports a song (WAV and MP3)", job.state === "done" && job.files.length === 2, job.error ?? `${((Date.now() - started) / 1000).toFixed(1)} s, peak ${job.peakDb} dB`);
    check("the export has the song in it", job.peakDb !== null && job.peakDb > -60);

    // Handed a package while it runs (Finder's double-click): the page opens it.
    const summary = (await api<ProjectSummary[]>("/api/projects")).find((p) => p.id === project.id);
    // In the data folder's Documents/YTStudio: a given data folder never reaches the user's Documents.
    const inData = !!summary?.path?.startsWith(path.join(data, "Documents", "YTStudio") + path.sep);
    check("the song is a .ytsng package in its data folder", inData && summary!.path!.endsWith(".ytsng") && existsSync(path.join(summary!.path!, "project.json")), summary?.path);
    if (summary?.path) {
      execFileSync("open", ["-a", bundle, summary.path]);
      const opened = new RegExp(`"POST /api/projects/${project.id}/opened 200`);
      check("opens a song handed to it", await wait(() => opened.test(log()), 20_000));
    }
  } finally {
    // As the menu's Quit: the page is asked to save, the server stops, then the engine. (JUCE answers the Apple
    // event "cancelled" and quits a moment later, so osascript's error is expected.)
    try {
      execFileSync("osascript", ["-e", `tell application "${bundle}" to quit`], { stdio: "ignore" });
    } catch {}
    const code = await Promise.race([exited, new Promise<"hung">((r) => setTimeout(() => r("hung"), 15_000))]);
    check("quits", code === 0, `exit ${code}`);
    if (code === "hung") app.kill("SIGKILL");
    check("its server stops with it", /"exiting \(0\)"/.test(log()));
    const left = (() => {
      try {
        return execFileSync("pgrep", ["-f", bundle], { encoding: "utf8" }).trim();
      } catch {
        return "";
      }
    })();
    check("leaves nothing running", left === "", left);
    if (process.env.KEEP_SMOKE) console.log(`kept ${tmp}`);
    else rmSync(tmp, { recursive: true, force: true });
  }
  return passed;
}
