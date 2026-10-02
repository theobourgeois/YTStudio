import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { readWav } from "./wav.ts";
import { wrapTail } from "./wrap.ts";

/** A 32-bit float stereo WAV (as the engine's exports are) of these frames, the same on both sides. */
async function floatWav(file: string, samples: number[]) {
  const data = Buffer.alloc(samples.length * 8);
  samples.forEach((v, i) => {
    data.writeFloatLE(v, i * 8);
    data.writeFloatLE(v, i * 8 + 4);
  });
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + data.length, 4);
  header.write("WAVEfmt ", 8);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(3, 20);
  header.writeUInt16LE(2, 22);
  header.writeUInt32LE(48000, 24);
  header.writeUInt32LE(48000 * 8, 28);
  header.writeUInt16LE(8, 32);
  header.writeUInt16LE(32, 34);
  header.write("data", 36);
  header.writeUInt32LE(data.length, 40);
  await fs.writeFile(file, Buffer.concat([header, data]));
}

describe("wrap remainder", () => {
  it("folds what rings past the end onto the start, round again if it's longer, and cuts the file at the end", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "wrap-"));
    const file = path.join(dir, "mix.wav");
    // Four frames of song, then six of tail: the tail's first four onto the start, its last two onto them again.
    await floatWav(file, [1, 1, 1, 1, 0.5, 0.25, 0.125, 0, 0.5, 0.5]);
    await wrapTail(file, 4);
    const { channels } = await readWav(file);
    expect([...channels[0]]).toEqual([2, 1.75, 1.125, 1]);
    expect([...channels[1]]).toEqual([2, 1.75, 1.125, 1]);
    // Nothing past the end: nothing to do.
    await wrapTail(file, 4);
    expect((await readWav(file)).channels[0].length).toBe(4);
    await fs.rm(dir, { recursive: true, force: true });
  });
});
