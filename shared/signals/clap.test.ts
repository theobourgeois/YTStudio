import { describe, expect, it } from "vitest";
import { CLAP_FRAMES, CLAP_MELS, CLAP_SAMPLES, clapFeatures } from "./clap.ts";
import reference from "./clap.fixture.json" with { type: "json" };

/** Three sines (one sweeping) and seeded noise, ten seconds at 48 kHz: the sound the fixture was made from. */
function testSound(): Float32Array {
  const sound = new Float32Array(CLAP_SAMPLES);
  let s = 12345;
  for (let i = 0; i < CLAP_SAMPLES; i++) {
    s = (s * 1664525 + 1013904223) >>> 0;
    const t = i / 48000;
    sound[i] = 0.3 * Math.sin(2 * Math.PI * 220 * t) + 0.2 * Math.sin(2 * Math.PI * 1760 * t * (1 + t / 20)) + 0.1 * Math.sin(2 * Math.PI * 7000 * t) + 0.05 * ((s / 4294967296) * 2 - 1);
  }
  return sound;
}

describe("clapFeatures", () => {
  it("is CLAP's log-mel spectrogram, as transformers.js makes it", () => {
    const features = clapFeatures(testSound());
    expect(features).toHaveLength(CLAP_FRAMES * CLAP_MELS);
    for (const [frame, values] of Object.entries(reference.frames)) {
      values.forEach((v, m) => expect(features[Number(frame) * CLAP_MELS + m], `frame ${frame}, band ${m}`).toBeCloseTo(v, 3));
    }
  });

  it("fills ten seconds with what there is, repeated, and takes the last ten of more", () => {
    const sound = testSound();
    const half = clapFeatures(sound.subarray(0, CLAP_SAMPLES / 2));
    // The first five seconds again: the second half's frames are the first's.
    expect(half[700 * CLAP_MELS + 10]).toBeCloseTo(half[200 * CLAP_MELS + 10], 3);
    const longer = new Float32Array(CLAP_SAMPLES + 1000);
    longer.set(sound, 1000);
    expect(clapFeatures(longer)[500 * CLAP_MELS + 5]).toBeCloseTo(clapFeatures(sound)[500 * CLAP_MELS + 5], 3);
    // Silence is the floor, not a failure.
    expect(clapFeatures(new Float32Array(0))[0]).toBe(-100);
  });
});
