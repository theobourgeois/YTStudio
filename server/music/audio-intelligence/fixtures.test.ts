import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FIXTURES, renderFixture } from "../../../shared/music/audio-intelligence/fixtures.ts";
import { readWav, writeWavChannels } from "../wav.ts";

let dir: string;
beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "fixtures-"));
});
afterEach(() => fs.rm(dir, { recursive: true, force: true }));

describe("fixtures as WAV files", () => {
  it("survive a round trip through a file within 16-bit quantisation, every one", async () => {
    for (const spec of FIXTURES) {
      const audio = renderFixture(spec, FIXTURES);
      const file = path.join(dir, `${spec.id}.wav`);
      await writeWavChannels(file, audio.channels, audio.sampleRate);
      const read = await readWav(file);
      expect(read.sampleRate, spec.id).toBe(audio.sampleRate);
      expect(read.channels, spec.id).toHaveLength(audio.channels.length);
      let worst = 0;
      audio.channels.forEach((channel, c) => {
        expect(read.channels[c], spec.id).toHaveLength(channel.length);
        for (let i = 0; i < channel.length; i += 7) worst = Math.max(worst, Math.abs(read.channels[c][i] - channel[i]));
      });
      expect(worst, spec.id).toBeLessThan(1 / 32767);
    }
  });
});
