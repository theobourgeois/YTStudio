/**
 * Serum 2 in the offline audio engine (silent: no device is opened, no window shown), to check what Serum
 * makes of a state: each state is loaded into a plugin channel of its own, and we read back what Serum
 * shows (its 541 automatable controls: name, value, text) and what it saves again (its own re-save, which
 * says how it understood every module, the ones without a control too). Used by `serum-preset.ts verify`.
 * Nothing is written outside a temporary folder: the user's Serum library is only read by Serum itself.
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { addPluginChannel } from "../shared/music/edits.ts";
import { createMusicProject } from "../shared/music/project.ts";
import { AudioEngine } from "../server/music/engine.ts";
import { DataPaths } from "../server/storage.ts";

export const ENGINE_BINARY =
  process.env.EDITOR_ENGINE_PATH ??
  path.join(import.meta.dirname, "../engine/build/VaudioEngine_artefacts/Release/YTStudio Engine.app/Contents/MacOS/YTStudio Engine");
const VST3_FOLDER = "/Library/Audio/Plug-Ins/VST3";

export interface SerumControl {
  index: number;
  id: string;
  name: string;
  value: number;
  text: string;
}

export interface SerumLoad {
  controls: SerumControl[];
  /** The state Serum saved after loading it (a "VC2!" plugin state). */
  resaved: Uint8Array;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Start the engine with Serum 2 scanned, run `work` with a loader, and always shut the engine down. `load(null)`
 * loads Serum with no state: its re-save is Serum's own init state.
 */
export async function withSerum<T>(work: (load: (state: Uint8Array | null) => Promise<SerumLoad>) => Promise<T>, binary = ENGINE_BINARY): Promise<T> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "serum-readout-"));
  const engine = new AudioEngine(new DataPaths(dir), { offline: true, onlyPluginPaths: true, pluginPaths: [VST3_FOLDER], command: [binary] });
  try {
    await engine.command("scan", {});
    while ((await engine.command("status", {})).scanning) await sleep(100);
    const serum = (await engine.plugins()).find((p) => p.name === "Serum 2");
    if (!serum) throw new Error(`Serum 2 wasn't found in ${VST3_FOLDER}.`);
    const project = "proj_0123456789ab";
    const plugins = path.join(dir, "projects", project, "plugins");
    await fs.mkdir(plugins, { recursive: true });
    let n = 0;
    const load = async (state: Uint8Array | null): Promise<SerumLoad> => {
      const channel = `chan_s${String(n++).padStart(5, "0")}`;
      const file = path.join(plugins, `${channel}.bin`);
      if (state) await fs.writeFile(file, state);
      const song = addPluginChannel(createMusicProject("Serum"), { id: serum.id, name: "Serum 2", format: "VST3" }, channel);
      await engine.setSong({ projectId: project, song, patternId: null });
      for (let i = 0; ; i++) {
        const status = await engine.command("status", {});
        if (status.channels.loaded.some((c) => c.channel === channel)) break;
        if (status.channels.failed.length) throw new Error(`Serum didn't load: ${JSON.stringify(status.channels.failed)}`);
        if (i > 600) throw new Error("Serum took over a minute to load.");
        await sleep(50);
      }
      const controls = (await engine.parameters("channel", channel)) as unknown as SerumControl[];
      await engine.saveStates();
      const resaved = new Uint8Array(await fs.readFile(file));
      await fs.rm(file, { force: true });
      return { controls, resaved };
    };
    return await work(load);
  } finally {
    engine.shutdown();
    await sleep(200);
    await fs.rm(dir, { recursive: true, force: true });
  }
}
