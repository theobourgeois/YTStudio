import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { fileTempo } from "../../shared/music/stretch.ts";
import { detectTempo } from "./tempo.ts";
import { writeWav } from "./wav.ts";

const RATE = 44_100;

/** A drum loop: a kick on every beat and a hat between, `bars` bars at `bpm`. */
function loop(bpm: number, bars: number): Float32Array {
  const beat = (60 / bpm) * RATE;
  const out = new Float32Array(Math.round(bars * 4 * beat));
  for (let b = 0; b < bars * 4; b++) {
    const at = Math.round(b * beat);
    for (let i = 0; i < 4000 && at + i < out.length; i++) out[at + i] += 0.8 * Math.sin((2 * Math.PI * 60 * i) / RATE) * Math.exp(-i / 900);
    const hat = Math.round(at + beat / 2);
    for (let i = 0; i < 600 && hat + i < out.length; i++) out[hat + i] += 0.3 * (Math.random() * 2 - 1) * Math.exp(-i / 150);
  }
  return out;
}

describe("detecting a file's tempo", () => {
  let dir: string;
  beforeAll(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "tempo-"));
  });
  afterAll(() => fs.rm(dir, { recursive: true, force: true }));

  it("hears a loop's tempo, and the loop is then a whole number of beats", async () => {
    const file = path.join(dir, "loop.wav");
    await writeWav(file, loop(100, 4), RATE);
    const heard = await detectTempo(file);
    expect(heard.seconds).toBeCloseTo(9.6, 2);
    expect(heard.bpm).not.toBeNull();
    expect(Math.abs(heard.bpm! - 100)).toBeLessThan(3);
    expect(fileTempo(heard.seconds, heard.bpm)).toBe(100);
  });
});
