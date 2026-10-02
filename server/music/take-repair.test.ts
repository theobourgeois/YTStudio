import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { repairWav } from "./take-repair.ts";
import { readWav } from "./wav.ts";

describe("a take the engine didn't finish", () => {
  it("gets a header as long as what was written, whole frames", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "repair-"));
    const file = path.join(dir, "take.wav");
    // 32-bit float mono, its header saying no sound, then 1000 samples and half of one more.
    const header = Buffer.alloc(44);
    header.write("RIFF", 0);
    header.writeUInt32LE(36, 4);
    header.write("WAVEfmt ", 8);
    header.writeUInt32LE(16, 16);
    header.writeUInt16LE(3, 20);
    header.writeUInt16LE(1, 22);
    header.writeUInt32LE(48000, 24);
    header.writeUInt32LE(48000 * 4, 28);
    header.writeUInt16LE(4, 32);
    header.writeUInt16LE(32, 34);
    header.write("data", 36);
    header.writeUInt32LE(0, 40);
    const data = Buffer.alloc(1000 * 4 + 2);
    for (let i = 0; i < 1000; i++) data.writeFloatLE(0.25, i * 4);
    await fs.writeFile(file, Buffer.concat([header, data]));
    expect(await repairWav(file)).toEqual({ frames: 1000, channels: 1, sampleRate: 48000 });
    const { channels } = await readWav(file);
    expect(channels[0].length).toBe(1000);
    expect(channels[0][999]).toBe(0.25);
    await fs.writeFile(path.join(dir, "not.wav"), "hello there");
    expect(await repairWav(path.join(dir, "not.wav"))).toBeNull();
    await fs.rm(dir, { recursive: true, force: true });
  });
});
