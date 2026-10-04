import { describe, expect, it, vi } from "vitest";
import { classifyMixerChannels, serumCategory } from "./mixer-setup.ts";
import type { ChannelEvidence } from "../../shared/music/mixer-setup.ts";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import express from "express";
import { DatabaseSync } from "node:sqlite";
import { mixerSetupRoutes } from "./mixer-setup.ts";
import { ApiKeyStore } from "../transcription/settings.ts";
import { HttpError } from "../storage.ts";
import { addChannels, addPluginChannel } from "../../shared/music/edits.ts";
import { createMusicProject } from "../../shared/music/project.ts";
import type { MediaAsset } from "../../shared/types.ts";

const evidence = (filename: string): ChannelEvidence => ({ channelId: "chan_kick", name: "Misleading lead display name", kind: "sampler", preset: null, category: null, filename, supported: true });
const reply = (choice: string, confidence: number, probabilities: Record<string, number>) => ({ model: "jev-1.13.0", answers: { channel_0: { type: "choice", choice, confidence, probabilities } } });
const mockedFetch = (data: unknown) => vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify(data)));

describe("Jev mixer classifier", () => {
  it("routes Serum choir to instr even when Jev leaves its vocal name unresolved", async () => {
    const choir: ChannelEvidence = { ...evidence(""), kind: "plugin", filename: null, preset: "VOX - String Vocal Follower", category: "Choir" };
    const result = await classifyMixerChannels([choir], "test", mockedFetch(reply("unknown", 0.9, { unknown: 0.9, instr: 0.1, bass: 0, drums: 0 })));
    expect(result.channels[0]).toMatchObject({ role: "instr", source: "rule", preset: choir.preset });
  });
  it("sends filename evidence, keeps the key in the header, and enforces 808 → bass", async () => {
    const fetcher = mockedFetch(reply("drums", 0.32, { drums: 0.49, bass: 0.18, instr: 0.01, unknown: 0.32 }));
    const result = await classifyMixerChannels([evidence("808 arcade.wav")], "test-key", fetcher);
    expect(result.channels[0]).toMatchObject({ role: "bass", source: "rule", confidence: 0.32 });
    const [, request] = fetcher.mock.calls[0];
    expect(request?.headers).toMatchObject({ Authorization: "Bearer test-key" });
    expect(JSON.parse(request!.body as string).state.channels[0]).toMatchObject({ filename: "808 arcade.wav" });
    expect(request!.body).not.toContain("test-key");
    expect(request!.body).not.toContain("Misleading lead");
  });
  it("leaves low confidence names unresolved and can handle empty/unsupported channels", async () => {
    const result = await classifyMixerChannels([evidence("Mystery.wav")], "test", mockedFetch(reply("instr", 0.5, { instr: 0.6, bass: 0.1, drums: 0.1, unknown: 0.2 })));
    expect(result.channels[0].role).toBe("unknown");
    const fetcher = vi.fn<typeof fetch>();
    expect((await classifyMixerChannels([{ ...evidence("x.wav"), supported: false }], "test", fetcher)).channels[0].source).toBe("unavailable");
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("rejects malformed, missing and invalid probability answers", async () => {
    for (const data of [{}, { model: "jev-1.13.0", answers: {} }, reply("bass", 2, {}), reply("bass", 1, { bass: 1, instr: 1, drums: 0, unknown: 0 })]) {
      await expect(classifyMixerChannels([evidence("bass.wav")], "test", mockedFetch(data))).rejects.toThrow(/invalid/);
    }
  });
  it("reports authentication and connectivity failures without exposing provider response/key", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response("secret provider error", { status: 401 }));
    await expect(classifyMixerChannels([evidence("kick.wav")], "test", fetcher)).rejects.toThrow("Jev rejected the API key");
    await expect(classifyMixerChannels([evidence("kick.wav")], "test", vi.fn<typeof fetch>().mockRejectedValue(new Error("secret-key")))).rejects.toThrow("Jev could not be reached");
    await expect(classifyMixerChannels([], "", fetcher)).rejects.toThrow("Add a Jev API key");
  });
  it("reads the catalog, and leaves duplicate or absent categories unresolved", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "serum-catalog-"));
    const file = path.join(dir, "presets.db");
    const db = new DatabaseSync(file);
    db.exec("CREATE TABLE Presets (name TEXT, category TEXT); INSERT INTO Presets VALUES ('BA - Candy', 'Bass'), ('Duplicate', 'Lead'), ('Duplicate', 'Bass');");
    db.close();
    vi.stubEnv("SERUM_PRESET_DATABASE", file);
    try {
      expect(await serumCategory("BA - Candy")).toBe("Bass");
      expect(await serumCategory("Duplicate")).toBe(null);
      expect(await serumCategory("Not present")).toBe(null);
    } finally { vi.unstubAllEnvs(); await fs.rm(dir, { recursive: true, force: true }); }
  });
});

it("serves real filenames/Serum metadata and keeps configured keys out of responses", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "jev-routes-"));
  const keys = new ApiKeyStore(path.join(dir, "settings.json"));
  await keys.load();
  const engine = { presetsForProject: vi.fn().mockResolvedValue({ currentName: "BA - Club - Candy", category: "", programs: [], program: -1, presets: [], preset: "" }) };
  const app = express();
  app.use(mixerSetupRoutes({ engine, keys, hasProject: (id) => id === "project_0123456789ab", assets: () => [{ id: "media_kick", name: "KICK Dance.wav" } as MediaAsset], category: async () => "Bass", fetcher: mockedFetch({}) }));
  app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => res.status(err instanceof HttpError ? err.status : 500).json({ error: err.message }));
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as { port: number };
  const url = `http://127.0.0.1:${address.port}`;
  const post = (path: string, body: unknown, method = "POST") => fetch(url + path, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  try {
    const settings = await post("/settings", { key: "test-private-key" }, "PUT");
    expect(await settings.json()).toEqual({ configured: true });
    const reloaded = new ApiKeyStore(path.join(dir, "settings.json")); await reloaded.load();
    expect(reloaded.get("jev")).toBe("test-private-key");
    expect((await fs.stat(path.join(dir, "settings.json"))).mode & 0o777).toBe(0o600);
    let song = addPluginChannel(createMusicProject("Evidence"), { id: "Serum2", name: "Serum 2", format: "VST3" }, "chan_serum");
    song = addChannels(song, [{ id: "chan_sample", name: "Renamed as lead", sampleId: "media_kick" }]);
    const response = await post("/evidence", { projectId: "project_0123456789ab", song });
    expect(response.status).toBe(200);
    const channels = await response.json();
    expect(channels[0]).toMatchObject({ preset: "BA - Club - Candy", category: "Bass", supported: true });
    expect(channels[1]).toMatchObject({ filename: "KICK Dance.wav", name: "Renamed as lead" });
    expect(JSON.stringify(channels)).not.toContain("test-private-key");
    engine.presetsForProject.mockRejectedValue(new Error("not loaded"));
    const fallback = await post("/evidence", { projectId: "project_0123456789ab", song });
    expect((await fallback.json())[0]).toMatchObject({ preset: null, supported: true });
    expect((await post("/evidence", { projectId: "project_ffffffffffff", song })).status).toBe(404);
    expect((await post("/settings", { key: "invalid whitespace" }, "PUT")).status).toBe(400);
    expect(await (await post("/settings", { key: null }, "PUT")).json()).toEqual({ configured: false });
  } finally {
    server.closeAllConnections(); await new Promise<void>((resolve) => server.close(() => resolve()));
    await fs.rm(dir, { recursive: true, force: true });
  }
});
