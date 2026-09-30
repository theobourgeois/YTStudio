import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DataPaths } from "../storage.ts";
import { AudioEngine } from "./engine.ts";

const FAKE = [process.execPath, path.join(import.meta.dirname, "fake-engine.mjs")];

describe("AudioEngine", () => {
  let dir: string;
  let engine: AudioEngine;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "engine-test-"));
    engine = new AudioEngine(new DataPaths(dir), { command: FAKE, pluginPaths: [] });
  });
  afterEach(async () => {
    engine.shutdown();
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("starts the engine on the first command and answers with its status", async () => {
    const status = await engine.command("tone", { on: true });
    expect(status).toMatchObject({ device: "Fake Output", tone: true, instrument: null });
    expect(await engine.plugins()).toHaveLength(2);
  });

  it("loads a plugin and remembers which plugin a saved state is for", async () => {
    const [synth] = await engine.plugins();
    let status = await engine.command("load", { slot: "instrument", pluginId: synth.id });
    expect(status.instrument).toMatchObject({ name: "Fake Synth", hasSavedState: false });
    await expect(engine.command("restoreState", { slot: "instrument" })).rejects.toMatchObject({ status: 409 });
    status = await engine.command("saveState", { slot: "instrument" });
    expect(status.instrument?.hasSavedState).toBe(true);
    await engine.command("restoreState", { slot: "instrument" });
  });

  it("refuses commands that are malformed, and passes on the engine's own errors", async () => {
    await expect(engine.command("load", { slot: "master", pluginId: "x" })).rejects.toMatchObject({ status: 400 });
    await expect(engine.command("note", { pitch: "C" })).rejects.toMatchObject({ status: 400 });
    await expect(engine.command("reboot", {})).rejects.toMatchObject({ status: 404 });
    await expect(engine.command("editor", { slot: "effect", open: true })).rejects.toMatchObject({
      status: 409,
      message: "No plugin is loaded there.",
    });
  });

  it("starts again after the engine dies", async () => {
    await engine.command("status", {});
    // Reach past the validation to take the engine down mid-command, as a crashing plugin would.
    const request = (engine as unknown as { request(cmd: string, params: object): Promise<unknown> }).request.bind(engine);
    await expect(request("crash", {})).rejects.toMatchObject({ status: 503 });
    expect(await engine.command("status", {})).toMatchObject({ device: "Fake Output" });
  });

  it("says how to build the engine when it's missing", async () => {
    const missing = new AudioEngine(new DataPaths(dir), { command: [path.join(dir, "nope")], pluginPaths: [] });
    await expect(missing.command("status", {})).rejects.toMatchObject({ status: 503, message: expect.stringContaining("engine:build") });
  });
});
