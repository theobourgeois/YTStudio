/** Render a short saved-song mix in an independent, silent engine. */
import fs from "node:fs/promises";
import path from "node:path";
import { compileSong } from "../../shared/music/compile.ts";
import { PPQ, type MusicProject } from "../../shared/music/types.ts";
import { songTick, tempoMap } from "../../shared/music/tempo.ts";
import { createId } from "../../shared/ids.ts";
import { AudioEngine, type EngineOptions } from "./engine.ts";
import { DataPaths } from "../storage.ts";
import { FFMPEG } from "../config.ts";
import { run } from "../process.ts";

export async function renderSongPreview(
  paths: DataPaths, options: EngineOptions, id: string, song: MusicProject, folder: string, signal: AbortSignal,
): Promise<string | null> {
  // An unarranged beat still has something to preview: its first pattern.
  const mode = song.playlist.clips.length ? "song" : "pattern";
  const patternId = song.patterns[0]?.id ?? null;
  const compiled = compileSong(song, patternId, null, mode);
  if (!compiled.notes.length && !compiled.audioClips.length) return null;
  const ticks = (30 * song.settings.tempo * PPQ) / 60;
  const end = mode === "song" ? songTick(tempoMap(song), ticks) : ticks;
  // A separate data folder also isolates plugin discovery and engine state files.
  const workerPaths = new DataPaths(path.join(paths.root, "preview-engine"));
  await fs.mkdir(workerPaths.engine, { recursive: true });
  // Reuse discovery from the live engine without sharing files it can write.
  await fs.copyFile(path.join(paths.engine, "plugins.xml"), path.join(workerPaths.engine, "plugins.xml")).catch((err: NodeJS.ErrnoException) => {
    if (err.code !== "ENOENT") throw err;
  });
  const snapshot = path.join(folder, "song");
  await fs.mkdir(snapshot, { recursive: true });
  await fs.cp(path.join(options.projectDir?.(id) ?? paths.projectDir(id), "plugins"), path.join(snapshot, "plugins"), { recursive: true }).catch((err: NodeJS.ErrnoException) => {
    if (err.code !== "ENOENT") throw err;
  });
  // Offline engines save plugin state on exit too: give them a disposable copy.
  const engine = new AudioEngine(workerPaths, { ...options, projectDir: () => snapshot, offline: true });
  const exportId = createId("preview");
  let rejectAbort: ((reason: unknown) => void) | undefined;
  const cancel = () => {
    rejectAbort?.(signal.reason);
    void engine.abortExport(exportId).catch(() => {});
  };
  try {
    signal.throwIfAborted();
    await engine.plugins();
    signal.throwIfAborted();
    const aborted = new Promise<never>((_resolve, reject) => { rejectAbort = reject; });
    signal.addEventListener("abort", cancel, { once: true });
    const result = await Promise.race([engine.renderExport({
      id: exportId, projectId: id, song, patternId, mode,
      loop: { start: 0, end: Math.min(end, mode === "song" ? songTick(tempoMap(song), compiled.loopTicks) : compiled.loopTicks) },
      resampling: "sinc", folder, mix: true, stems: false, tail: "cut", threads: 1,
    }), aborted]);
    signal.throwIfAborted();
    if (result.state === "aborted") throw new Error("Preview generation stopped.");
    if (result.missing.length) throw new Error("Some instruments or samples are unavailable. Open the song to check them.");
    const mix = result.files.find((f) => f.id === "mix");
    if (!mix) throw new Error("The song renderer produced no audio.");
    const output = path.join(folder, "preview.m4a");
    await run(FFMPEG, ["-v", "error", "-y", "-i", mix.file, "-t", "30", "-c:a", "aac", "-b:a", "128k", output], { signal });
    return output;
  } finally {
    signal.removeEventListener("abort", cancel);
    engine.shutdown();
    await fs.rm(path.join(folder, "mix.wav"), { force: true });
  }
}
