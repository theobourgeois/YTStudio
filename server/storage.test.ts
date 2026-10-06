import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { diskError, renameRetrying, writeFileDurably, writeJsonDurably } from "./storage.ts";

const busy = (code: string) => Object.assign(new Error(code), { code });

describe("renameRetrying", () => {
  it.runIf(process.platform === "win32")("tries again while Windows says the file is in use", async () => {
    let calls = 0;
    await renameRetrying("a", "b", async () => {
      if (++calls < 3) throw busy("EPERM");
    });
    expect(calls).toBe(3);
  });

  it("gives up on other errors at once", async () => {
    let calls = 0;
    await expect(
      renameRetrying("a", "b", async () => {
        calls++;
        throw busy("ENOENT");
      }),
    ).rejects.toThrow("ENOENT");
    expect(calls).toBe(1);
  });

  it.runIf(process.platform === "win32")("gives up after about a second", async () => {
    let calls = 0;
    await expect(
      renameRetrying("a", "b", async () => {
        calls++;
        throw busy("EBUSY");
      }),
    ).rejects.toThrow("EBUSY");
    expect(calls).toBe(11);
  });
});

describe("writeFileDurably", () => {
  it("writes whole files into folders it makes, leaving nothing else", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "durable-"));
    try {
      const file = path.join(root, "a", "b", "doc.json");
      await writeJsonDurably(file, { x: 1 });
      await writeFileDurably(file, '{"x":2}');
      expect(JSON.parse(await fs.readFile(file, "utf8"))).toEqual({ x: 2 });
      expect(await fs.readdir(path.dirname(file))).toEqual(["doc.json"]);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("says a full disk is full, as a 507", () => {
    expect(diskError(busy("ENOSPC"), "/x/project.json")).toMatchObject({ status: 507, message: expect.stringContaining("project.json") });
    const other = busy("EACCES");
    expect(diskError(other, "/x/project.json")).toBe(other);
  });
});
