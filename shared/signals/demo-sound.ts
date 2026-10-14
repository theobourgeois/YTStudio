/**
 * A made-up song to listen to when there's nothing to (Now Playing's stand-in player, the tests, the looks' sheet):
 * made a chunk at a time and never played, only measured. It goes round a song's shape, 16 bars at 124 BPM:
 * a breakdown (a soft pad and hats, no kick: `DEMO_SECTIONS.breakdown`), a build-up (a snare roll speeding up and a
 * riser, no kick), a drop (kick, clap, hats and a bassline, loud), then again.
 */

/** Seeded noise, so every run sounds the same. */
function noise(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return (s / 0x100000000) * 2 - 1;
  };
}

const BPM = 124;
const BAR = (4 * 60) / BPM;

/** Where each part of the song is (seconds into each round of it), for tests and sheets to look at. */
export const DEMO_SECTIONS = {
  breakdown: { from: 0, to: 4 * BAR },
  build: { from: 4 * BAR, to: 8 * BAR },
  drop: { from: 8 * BAR, to: 16 * BAR },
} as const;
/** A round of the song (seconds). */
export const DEMO_LENGTH = 16 * BAR;

/** The made-up song (stereo, interleaved): `next(frames)` makes the next stretch of it. */
export function demoSong(sampleRate: number) {
  const beat = 60 / BPM;
  const random = noise(3);
  const roll = noise(5);
  const hatNoise = noise(9);
  const riser = noise(11);
  let previous = 0;
  let previousRiser = 0;
  let i = 0;
  // A bass note a beat, round the bar; the pad's chord.
  const notes = [55, 55, 65.4, 49];
  const chord = [220, 261.6, 329.6];
  return {
    next(frames: number): Float32Array {
      const out = new Float32Array(frames * 2);
      for (let k = 0; k < frames; k++, i++) {
        const t = (i / sampleRate) % DEMO_LENGTH;
        const beatIndex = Math.floor(t / beat);
        const sinceBeat = t - beatIndex * beat;
        const n = hatNoise();
        const high = n - previous;
        previous = n;
        const sinceEighth = t % (beat / 2);
        let v = 0;
        if (t < DEMO_SECTIONS.breakdown.to) {
          // The pad, breathing, and a few soft hats.
          v += 0.06 * (0.6 + 0.4 * Math.sin(t * 0.7)) * chord.reduce((s, f) => s + Math.sin(2 * Math.PI * f * t), 0) / 3;
          if (sinceEighth < 0.03 && Math.floor(t / (beat / 2)) % 2 === 1) v += 0.06 * high * Math.exp(-sinceEighth / 0.01);
        } else if (t < DEMO_SECTIONS.build.to) {
          // A snare roll from one a beat to four, and a riser growing louder and brighter.
          const x = (t - DEMO_SECTIONS.build.from) / (DEMO_SECTIONS.build.to - DEMO_SECTIONS.build.from);
          const per = beat / (1 + Math.floor(x * 4));
          const since = t % per;
          const r = riser();
          const bright = r - previousRiser * (1 - x);
          previousRiser = r;
          v += 0.22 * (0.4 + 0.6 * x) * roll() * Math.exp(-since / 0.04) + 0.25 * x * x * bright;
        } else {
          // The drop: kick, clap on 2 and 4, hats on the sixteenths, the bassline.
          const phase = 2 * Math.PI * (50 * sinceBeat + (100 / 30) * (1 - Math.exp(-30 * sinceBeat)));
          v += 0.8 * Math.sin(phase) * Math.exp(-sinceBeat / 0.09);
          if (beatIndex % 2 === 1) v += 0.4 * random() * Math.exp(-sinceBeat / 0.07);
          const sixteenth = beat / 4;
          const s16 = t % sixteenth;
          v += 0.2 * high * Math.exp(-s16 / 0.012);
          v += 0.3 * Math.sin(2 * Math.PI * notes[Math.floor(beatIndex / 4) % notes.length] * t) * (0.5 + 0.5 * Math.exp(-sinceBeat / 0.25));
        }
        out[k * 2] = 0.6 * v;
        out[k * 2 + 1] = 0.6 * v * 0.95;
      }
      return out;
    },
  };
}
