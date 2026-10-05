/** Inspect real audio/MIDI devices on disposable engine data; --tone briefly auditions the output. */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { AudioEngine } from "../server/music/engine.ts";
import { DataPaths } from "../server/storage.ts";

const directory = await fs.mkdtemp(path.join(os.tmpdir(), "vaudio-audio-device-"));
const engine = new AudioEngine(new DataPaths(directory), { onlyPluginPaths: true });
try {
  const devices = await engine.devices();
  console.log(JSON.stringify(devices, null, 2));
  if (!devices.status.device) throw new Error("No audio output opened. Check Windows audio settings and the engine's device selection.");
  if (process.argv.includes("--tone")) {
    await engine.command("tone", { on: true });
    await new Promise((resolve) => setTimeout(resolve, 1000));
    await engine.command("tone", { on: false });
  }
} finally {
  engine.shutdown();
  await fs.rm(directory, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
}
