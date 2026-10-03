/** Real plugins must resolve from the live catalog, while previewing leaves the editor and its saved state alone. */
import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { createMusicProject, FIRST_PATTERN_ID } from "../../shared/music/project.ts";
import { addPluginChannel, setSteps } from "../../shared/music/edits.ts";
import { ENGINE, ENGINE_PLUGIN_PATHS } from "../config.ts";
import { DataPaths } from "../storage.ts";
import { inspectPreview } from "../preview-media.ts";
import { AudioEngine } from "./engine.ts";
import { renderSongPreview } from "./project-preview.ts";

it.skipIf(!existsSync(ENGINE) || !ENGINE_PLUGIN_PATHS.every(existsSync))("renders plugin audio in isolation with actual waveform peaks", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "song-preview-"));
  const paths = new DataPaths(root);
  const id = "project_123456789abc";
  const options = { offline: true, onlyPluginPaths: true, projectDir: () => paths.projectDir(id) };
  const live = new AudioEngine(paths, options);
  try {
    await paths.init();
    await live.command("scan", {});
    await expect.poll(async () => !!(await live.command("status", {})).scanning).toBe(false);
    const plugin = (await live.plugins()).find((p) => p.name === "Vaudio Test Synth")!;
    expect(plugin).toBeDefined();
    let song = addPluginChannel(createMusicProject("Beat", 120), { id: plugin.id, name: plugin.name, format: plugin.format }, "chan_123456789abc");
    song = setSteps(song, FIRST_PATTERN_ID, song.channels[0].id, [0, 4, 8, 12], true);
    await live.setSong({ projectId: id, song, patternId: FIRST_PATTERN_ID, mode: "pattern" });
    await expect.poll(async () => (await live.command("status", {})).channels.loaded.length).toBe(1);
    await live.saveStates();
    const stateFile = path.join(paths.projectDir(id), "plugins", `${song.channels[0].id}.bin`);
    const original = await fs.readFile(stateFile);
    const before = await live.command("status", {});
    const folder = path.join(paths.tmp, "preview");
    await fs.mkdir(folder);
    const file = await renderSongPreview(paths, options, id, song, folder, new AbortController().signal);
    expect(file).not.toBeNull();
    const result = await inspectPreview(file!, folder, "music", new AbortController().signal);
    expect(result.duration).toBeCloseTo(2, 0);
    expect(Math.max(...result.peaks!)).toBeGreaterThan(0.5);
    expect(result.peaks!.length).toBeLessThanOrEqual(240);
    expect(await fs.readFile(stateFile)).toEqual(original);
    const after = await live.command("status", {});
    expect(after.channels).toEqual(before.channels);
    expect(after.exporting).toBeNull();
  } finally {
    live.shutdown();
    await fs.rm(root, { recursive: true, force: true });
  }
}, 30_000);
