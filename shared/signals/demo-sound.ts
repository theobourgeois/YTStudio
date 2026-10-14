/**
 * A made-up song to listen to when there's nothing to (Now Playing's stand-in player, the tests): a drum loop
 * with a bassline, made a chunk at a time and never played, only measured. Each section of 8 bars is quieter
 * or louder, so drops come round too.
 */

/** Seeded noise, so every run sounds the same. */
function noise(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return (s / 0x100000000) * 2 - 1;
  };
}

/** A drum loop at `bpm` (stereo, interleaved): `next(frames)` makes the next stretch of it. */
export function demoSong(sampleRate: number, bpm = 124) {
  const beat = 60 / bpm;
  const random = noise(3);
  const hatNoise = noise(9);
  let previous = 0;
  let i = 0;
  // A bass note a beat, round the bar.
  const notes = [55, 55, 65.4, 49];
  return {
    next(frames: number): Float32Array {
      const out = new Float32Array(frames * 2);
      for (let k = 0; k < frames; k++, i++) {
        const t = i / sampleRate;
        const beatIndex = Math.floor(t / beat);
        const sinceBeat = t - beatIndex * beat;
        const section = Math.floor(beatIndex / 32) % 2;
        const loud = section === 1;
        const n = hatNoise();
        const high = n - previous;
        previous = n;
        let v = 0;
        // The kick (only when it's loud), the snare on 2 and 4, hats on the eighths, the bass.
        if (loud) {
          const phase = 2 * Math.PI * (50 * sinceBeat + (100 / 30) * (1 - Math.exp(-30 * sinceBeat)));
          v += 0.75 * Math.sin(phase) * Math.exp(-sinceBeat / 0.07);
        }
        if (beatIndex % 2 === 1) v += (loud ? 0.3 : 0.18) * random() * Math.exp(-sinceBeat / 0.06);
        const sinceEighth = t % (beat / 2);
        if (sinceEighth < 0.04) v += (loud ? 0.22 : 0.12) * high * Math.exp(-sinceEighth / 0.012);
        const note = notes[Math.floor(beatIndex / 4) % notes.length];
        v += (loud ? 0.22 : 0.1) * Math.sin(2 * Math.PI * note * t) * (0.6 + 0.4 * Math.exp(-sinceBeat / 0.2));
        out[k * 2] = v;
        out[k * 2 + 1] = v * 0.92;
      }
      return out;
    },
  };
}
