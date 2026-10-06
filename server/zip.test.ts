import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { writeZip } from "./zip.ts";

const hasUnzip = spawnSync("unzip", ["-v"]).status === 0;

describe("writeZip", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(path.join(os.tmpdir(), "zip-test-"));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  const files = () => {
    const made = [
      { name: "clip_00001.png", data: Buffer.from(Array.from({ length: 5000 }, (_, i) => (i * 7) % 256)) },
      { name: "empty.txt", data: Buffer.alloc(0) },
      { name: "Chanson été.wav", data: Buffer.from("RIFF and some sound") },
    ];
    for (const f of made) writeFileSync(path.join(dir, f.name), f.data);
    return made;
  };

  /** Every entry's name and size, from the central directory as an unzip reads it. */
  const listing = (zip: string) =>
    execFileSync("unzip", ["-Z", "-1", zip]).toString().trim().split("\n");

  it.skipIf(!hasUnzip)("stores files any unzip reads back, byte for byte", async () => {
    const made = files();
    const zip = path.join(dir, "out.zip");
    const counts: number[] = [];
    await writeZip(zip, made.map((f) => ({ name: f.name, path: path.join(dir, f.name) })), { onEntry: (n) => counts.push(n) });
    expect(counts).toEqual([1, 2, 3]);
    expect(execFileSync("unzip", ["-t", zip]).toString()).toMatch(/No errors detected/);
    expect(listing(zip)).toEqual(made.map((f) => f.name));
    for (const f of made) expect(execFileSync("unzip", ["-p", zip, f.name]).equals(f.data), f.name).toBe(true);
    // Stored: the archive is the files plus its records.
    expect(readFileSync(zip).length).toBeLessThan(5000 + 19 + 400);
  });

  it.skipIf(!hasUnzip)("writes ZIP64 records that unzip reads, when asked to on a small archive", async () => {
    const made = files();
    const zip = path.join(dir, "out64.zip");
    await writeZip(zip, made.map((f) => ({ name: f.name, path: path.join(dir, f.name) })), { zip64: true });
    expect(execFileSync("unzip", ["-t", zip]).toString()).toMatch(/No errors detected/);
    for (const f of made) expect(execFileSync("unzip", ["-p", zip, f.name]).equals(f.data), f.name).toBe(true);
    // The end of central directory record is ZIP64's (its locator just before the classic one).
    const bytes = readFileSync(zip);
    expect(bytes.readUInt32LE(bytes.length - 22 - 20)).toBe(0x07064b50);
  });

  it("removes each file once it's in, and stops when aborted", async () => {
    const made = files();
    const zip = path.join(dir, "out.zip");
    await writeZip(zip, made.map((f) => ({ name: f.name, path: path.join(dir, f.name) })), { removeAfter: true });
    for (const f of made) expect(existsSync(path.join(dir, f.name))).toBe(false);

    files();
    const controller = new AbortController();
    const promise = writeZip(zip, made.map((f) => ({ name: f.name, path: path.join(dir, f.name) })), {
      signal: controller.signal,
      onEntry: () => controller.abort(),
    });
    await expect(promise).rejects.toThrow();
  });
});
