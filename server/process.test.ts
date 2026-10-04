import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { run, spawnStreaming } from "./process.ts";

describe("JavaScript external programs", () => {
  let directory: string;
  let file: string;
  beforeEach(async () => {
    directory = await fs.mkdtemp(path.join(os.tmpdir(), "vaudio process é "));
    file = path.join(directory, "echo arguments.cjs");
    await fs.writeFile(file, 'process.stdout.write(JSON.stringify(process.argv.slice(2)));');
  });
  afterEach(async () => { await fs.rm(directory, { recursive: true, force: true }); });

  it("runs script paths containing spaces and Unicode without shell interpretation", async () => {
    const args = ["space inside", "C:\\samples\\kick.wav", "$(not-a-command)", "a&b", 'a"b'];
    expect(JSON.parse(await run(file, args))).toEqual(args);
  });

  it("supports the same script launch with streamed output", async () => {
    const { child, done } = spawnStreaming([file, "with spaces"], "ignore", "pipe");
    const output: Buffer[] = [];
    child.stdout!.on("data", (chunk: Buffer) => output.push(chunk));
    await done;
    expect(JSON.parse(Buffer.concat(output).toString())).toEqual(["with spaces"]);
  });
});
