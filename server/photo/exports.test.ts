/**
 * Banded exports' bookkeeping: one export per file at a time, cancel letting go of everything, and exports a tab
 * abandoned let go of. (Encoding is the helper's: helper.test.ts.)
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { ABANDONED_MS, PhotoExports } from "./exports.ts";
import { PhotoHelper } from "./helper.ts";

let dir: string;
let exports: PhotoExports;
const helper = new PhotoHelper(path.join(import.meta.dirname, "helper-process.mjs"));
const request = { name: "Cover.png", width: 8, height: 4, bits: 8 as const, format: "png" as const };

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "photo-exports-"));
  exports = new PhotoExports(helper, path.join(dir, "work"));
});
afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});
afterAll(() => helper.close());

const samples = async () => (await fs.readdir(path.join(dir, "work"))).filter((n) => n.startsWith("samples-"));

describe("photo exports", () => {
  it("writes one file at a time: a second export to it waits for the first to finish or be cancelled", async () => {
    const out = path.join(dir, "Cover.png");
    const first = await exports.begin(request, { destination: out });
    await expect(exports.begin(request, { destination: out })).rejects.toMatchObject({ status: 409, message: expect.stringContaining("Cover.png") });
    // Another file is fine meanwhile.
    await exports.cancel(await exports.begin(request, { destination: path.join(dir, "Other.png") }));
    await exports.rows(first, 0, Buffer.alloc(8 * 4 * 4, 200));
    await exports.finish(first);
    await exports.cancel(await exports.begin(request, { destination: out }));
  });

  it("lets go of everything when cancelled: its samples, its file's turn, and nothing is written", async () => {
    const out = path.join(dir, "Cancelled.png");
    const id = await exports.begin(request, { destination: out });
    await exports.rows(id, 0, Buffer.alloc(8 * 2 * 4, 1));
    expect(await samples()).toHaveLength(1);
    await exports.cancel(id);
    expect(await samples()).toEqual([]);
    await expect(fs.stat(out)).rejects.toThrow();
    await expect(exports.rows(id, 2, Buffer.alloc(8 * 2 * 4, 1))).rejects.toMatchObject({ status: 404 });
    await exports.cancel(await exports.begin(request, { destination: out }));
  });

  it("lets go of an export its tab abandoned once it's been quiet long enough", async () => {
    const out = path.join(dir, "Abandoned.png");
    const now = Date.now();
    await exports.begin(request, { destination: out, now });
    await expect(exports.begin(request, { destination: out, now: now + 60_000 })).rejects.toMatchObject({ status: 409 });
    const id = await exports.begin(request, { destination: out, now: now + ABANDONED_MS + 1 });
    expect(await samples()).toHaveLength(1);
    await exports.cancel(id);
  });
});
