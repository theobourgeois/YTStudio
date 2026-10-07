/**
 * Synthesise the music suite's starter kit (kick, clap, hat, snare) into public/kit/: four small
 * drum sounds, so a new song can make a beat before any samples are brought in. And a tone, the sampler
 * Convert to notes plays its melodies on until it's replaced by an instrument.
 *
 *   pnpm tsx scripts/make-kit.ts
 */
import fs from "node:fs/promises";
import path from "node:path";
import { writeWav } from "../server/music/wav.ts";

const RATE = 44_100;
const OUT = path.resolve(import.meta.dirname, "..", "public", "kit");

/** The same noise every run, so the files don't change when the script is run again. */
function noiseSource(seed: number) {
  let state = seed;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) | 0;
    return state / 0x80000000;
  };
}

const render = (seconds: number, at: (t: number, i: number) => number) => Float32Array.from({ length: Math.round(seconds * RATE) }, (_, i) => at(i / RATE, i));

/** One-pole filters, for shaping noise. */
function lowpass(samples: Float32Array, hz: number): Float32Array {
  const a = 1 - Math.exp((-2 * Math.PI * hz) / RATE);
  let y = 0;
  return samples.map((x) => (y += a * (x - y)));
}
const highpass = (samples: Float32Array, hz: number) => {
  const low = lowpass(samples, hz);
  return samples.map((x, i) => x - low[i]);
};

/** Scale to a peak, and fade the last few milliseconds so nothing clicks at the end. */
function finish(samples: Float32Array, peak: number): Float32Array {
  const max = samples.reduce((m, x) => Math.max(m, Math.abs(x)), 0) || 1;
  const fade = Math.round(0.005 * RATE);
  return samples.map((x, i) => ((x / max) * peak * Math.min(1, (samples.length - i) / fade)));
}

function kick(): Float32Array {
  let phase = 0;
  return finish(
    render(0.45, (t) => {
      // The pitch drops from a thump to a sub in a few hundredths of a second.
      const hz = 46 + 170 * Math.exp(-t / 0.035);
      phase += hz / RATE;
      const body = Math.sin(2 * Math.PI * phase) * Math.exp(-t / 0.16);
      const click = Math.exp(-t / 0.002) * 0.6;
      return Math.tanh((body + click) * 1.6);
    }),
    0.95,
  );
}

function snare(): Float32Array {
  const noise = noiseSource(7);
  const hiss = highpass(render(0.26, (t) => noise() * Math.exp(-t / 0.07)), 1400);
  let phase = 0;
  return finish(
    render(0.26, (t, i) => {
      phase += (185 + 90 * Math.exp(-t / 0.02)) / RATE;
      return Math.sin(2 * Math.PI * phase) * Math.exp(-t / 0.05) * 0.7 + hiss[i] * 0.9;
    }),
    0.85,
  );
}

function clap(): Float32Array {
  const noise = noiseSource(21);
  // Several hands, a few milliseconds apart, then the room.
  const hits = [0, 0.011, 0.023, 0.034];
  const raw = render(0.3, (t) => {
    const bursts = hits.reduce((sum, at) => sum + (t >= at ? Math.exp(-(t - at) / 0.004) : 0), 0);
    const tail = t >= 0.034 ? Math.exp(-(t - 0.034) / 0.075) : 0;
    return noise() * (bursts * 0.7 + tail);
  });
  return finish(lowpass(highpass(raw, 900), 5200), 0.8);
}

function hat(): Float32Array {
  const noise = noiseSource(99);
  return finish(highpass(highpass(render(0.09, (t) => noise() * Math.exp(-t / 0.022)), 7000), 7000), 0.6);
}

/** A soft keyboard tone at middle C (the sampler's root, `ROOT_PITCH`): a few harmonics, the higher dying sooner. */
function tone(): Float32Array {
  const hz = 440 * 2 ** ((60 - 69) / 12);
  const partials = [
    [1, 1, 1.4],
    [2, 0.35, 0.7],
    [3, 0.14, 0.45],
    [4, 0.07, 0.3],
  ];
  return finish(
    render(2.5, (t) => {
      const attack = Math.min(1, t / 0.006);
      return attack * partials.reduce((sum, [n, gain, decay]) => sum + gain * Math.sin(2 * Math.PI * hz * n * t) * Math.exp(-t / decay), 0);
    }),
    0.7,
  );
}

await fs.mkdir(OUT, { recursive: true });
for (const [name, samples] of Object.entries({ kick: kick(), clap: clap(), hat: hat(), snare: snare(), tone: tone() })) {
  await writeWav(path.join(OUT, `${name}.wav`), samples, RATE);
  console.log(`public/kit/${name}.wav  ${(samples.length / RATE).toFixed(2)} s`);
}
