import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import http from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PhotoModelSpec, PhotoModelStatus } from "../../shared/photo/models.ts";
import { PhotoModel } from "./models.ts";

/** Two files a model is made of (a graph and its weights), served over HTTP, one of them slowly enough to be seen. */
const files: Record<string, Buffer> = { "/graph.onnx": Buffer.alloc(1000, 1), "/graph.onnx_data": Buffer.alloc(200_000, 2) };
let server: http.Server;
let base = "";
let dir = "";

beforeAll(async () => {
  server = http.createServer((req, res) => {
    const body = files[req.url ?? ""];
    if (!body) return void res.writeHead(404).end();
    res.writeHead(200, { "Content-Length": body.length });
    res.end(body);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "vaudio-models-"));
});

afterAll(async () => {
  server.close();
  await fs.rm(dir, { recursive: true, force: true });
});

const sha = (b: Buffer) => createHash("sha256").update(b).digest("hex");
const spec = (graphSha = sha(files["/graph.onnx"])): PhotoModelSpec => ({
  command: "Test",
  does: "tests",
  files: [
    { name: "graph", file: "test-graph.onnx", url: `${base}/graph.onnx`, size: 1000, sha256: graphSha },
    { name: "weights", file: "test-graph.onnx_data", url: `${base}/graph.onnx_data`, size: 200_000, sha256: sha(files["/graph.onnx_data"]), location: "graph.onnx_data" },
  ],
});

async function settled(model: PhotoModel): Promise<PhotoModelStatus> {
  for (;;) {
    const status = await model.status();
    if (status.status !== "downloading") return status;
    await new Promise((r) => setTimeout(r, 10));
  }
}

describe("a photo model of several files", () => {
  it("is missing until every file is here, downloads them all, and serves each by name", async () => {
    const model = new PhotoModel(path.join(dir, "ok"), false, spec());
    expect(await model.status()).toMatchObject({ status: "missing", size: 201_000 });
    expect(await model.file()).toBeNull();
    await model.setUp();
    expect(await settled(model)).toMatchObject({ status: "ready", error: null });
    expect(await model.file()).toBe(path.join(dir, "ok", "test-graph.onnx"));
    expect(await model.file("test-graph.onnx_data")).toBe(path.join(dir, "ok", "test-graph.onnx_data"));
    expect(await model.file("other.onnx")).toBeNull();
    // A file gone (or cut short) makes the model missing again; setting it up fetches only that one.
    await fs.rm(path.join(dir, "ok", "test-graph.onnx"));
    expect((await model.status()).status).toBe("missing");
    await model.setUp();
    expect((await settled(model)).status).toBe("ready");
  });

  it("refuses a file whose checksum differs, keeping nothing of it", async () => {
    const model = new PhotoModel(path.join(dir, "bad"), false, spec("0".repeat(64)));
    await model.setUp();
    const status = await settled(model);
    expect(status.status).toBe("error");
    expect(status.error).toMatch(/graph/);
    expect((await fs.readdir(path.join(dir, "bad"))).filter((f) => f.startsWith("test-graph.onnx") && !f.endsWith("_data"))).toEqual([]);
  });
});
