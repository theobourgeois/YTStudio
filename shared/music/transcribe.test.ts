import { describe, expect, it } from "vitest";
import fixtures from "./transcribe-fixtures.json";
import {
  ACTIVATION_SCALE,
  ANALYSIS_RATE,
  DRUM_FEATURES,
  type Drum,
  FRAME_SECONDS,
  type HeardAudio,
  KEYS,
  LOWEST_KEY,
  drumFeatures,
  frameTime,
  heardFromJson,
  heardToJson,
  packDrums,
  pickDrumHits,
  pickFrameNotes,
  pickNotes,
} from "./transcribe.ts";

/** The fixture's sparse activations as the worker's dense 16-bit ones. */
function dense(entries: number[][], frames: number) {
  const out = new Uint16Array(frames * KEYS);
  for (const [t, k, v] of entries) out[t * KEYS + k] = v;
  return out;
}

const heard = { frames: fixtures.frames, notes: dense(fixtures.notes, fixtures.frames), onsets: dense(fixtures.onsets, fixtures.frames) };

describe("Basic Pitch's note picking", () => {
  // scripts/basic-pitch-fixtures.py: Spotify's own `output_to_notes_polyphonic` on these activations.
  for (const [name, expected] of Object.entries(fixtures.expected)) {
    it(`picks exactly the notes Basic Pitch does (${name})`, () => {
      const [onsetThreshold, frameThreshold, minFrames, inferOnsets, melodia] = expected.settings as [number, number, number, boolean, boolean];
      const ours = pickFrameNotes(heard, { onsetThreshold, frameThreshold, minFrames, lowest: 0, highest: 127, inferOnsets, melodia });
      const picked = ours.map((n) => [n.start, n.end, n.key + LOWEST_KEY, n.amplitude]).sort((a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2]);
      expect(picked.map((n) => n.slice(0, 3))).toEqual(expected.notes.map((n) => n.slice(0, 3)));
      picked.forEach((n, i) => expect(n[3]).toBeCloseTo(expected.notes[i][3], 5));
    });
  }

  it("finds a note without an onset only with the Melodia trick", () => {
    const settings = { onsetThreshold: 0.5, frameThreshold: 0.3, minFrames: 11, lowest: 0, highest: 127, inferOnsets: false };
    const key = (n: { key: number }) => n.key === 20;
    expect(pickFrameNotes(heard, settings).some(key)).toBe(true);
    expect(pickFrameNotes(heard, { ...settings, melodia: false }).some(key)).toBe(false);
  });

  it("keeps only the range asked for", () => {
    const notes = pickNotes(heard, { onsetThreshold: 0.5, frameThreshold: 0.3, minFrames: 11, lowest: 55, highest: 70 });
    expect(notes.length).toBeGreaterThan(0);
    expect(notes.every((n) => n.pitch >= 55 && n.pitch <= 70)).toBe(true);
  });

  it("gives seconds as Basic Pitch does: each 2-second window's frames a little early", () => {
    expect(frameTime(0)).toBe(0);
    expect(frameTime(171)).toBeCloseTo(171 * FRAME_SECONDS, 9);
    // From the second window on, Basic Pitch's `model_frames_to_time` takes ~10 ms off per window.
    expect(frameTime(172)).toBeCloseTo(172 * FRAME_SECONDS - 0.01032, 4);
  });

  it("finds nothing in silence", () => {
    const silent = { frames: 200, notes: new Uint16Array(200 * KEYS), onsets: new Uint16Array(200 * KEYS) };
    expect(pickNotes(silent, { onsetThreshold: 0.5, frameThreshold: 0.3, minFrames: 11, lowest: 21, highest: 108 })).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Drums, on drums synthesised here: a kick (a falling sine), a snare (a body and a rattle of noise), a hat (hiss).
// ---------------------------------------------------------------------------

function noise(seed: number) {
  let s = seed;
  return () => ((s = (s * 1_103_515_245 + 12_345) & 0x7fffffff) / 0x7fffffff) * 2 - 1;
}

const SOUNDS: Record<Drum, Float32Array> = (() => {
  const n = Math.round(0.3 * ANALYSIS_RATE);
  const kick = new Float32Array(n);
  const snare = new Float32Array(n);
  const hat = new Float32Array(Math.round(0.08 * ANALYSIS_RATE));
  let phase = 0;
  const rnd = noise(3);
  // The rattle: noise between about 200 Hz and 5 kHz (a snare has almost nothing below its body, and less above).
  const pole = (hz: number) => Math.exp((-2 * Math.PI * hz) / ANALYSIS_RATE);
  const [high, low] = [pole(5000), pole(200)];
  let under5k = 0;
  let under200 = 0;
  for (let i = 0; i < n; i++) {
    const t = i / ANALYSIS_RATE;
    phase += (2 * Math.PI * (50 + 100 * Math.exp(-t * 30))) / ANALYSIS_RATE;
    kick[i] = 0.9 * Math.sin(phase) * Math.exp(-t * 9);
    const x = rnd();
    under5k = x + high * (under5k - x);
    under200 = x + low * (under200 - x);
    snare[i] = 0.4 * Math.sin(2 * Math.PI * 190 * t) * Math.exp(-t * 25) + 0.8 * (under5k - under200) * Math.exp(-t * 18);
  }
  // A hat: noise with its lows taken out (each sample less the one before, twice).
  const hiss = noise(11);
  let a = 0;
  let b = 0;
  for (let i = 0; i < hat.length; i++) {
    const x = hiss();
    const d1 = x - a;
    a = x;
    hat[i] = 0.06 * (d1 - b) * Math.exp(-(i / ANALYSIS_RATE) * 45);
    b = d1;
  }
  return { kick, snare, hat };
})();

/** Eight bars at 120 BPM in 16ths: `pattern(step)` says which drums play. */
function beat(pattern: (step: number) => Drum[]) {
  const step = 0.125;
  const steps = 8 * 16;
  const mix = new Float32Array(Math.ceil((steps * step + 1) * ANALYSIS_RATE));
  const truth: { drum: Drum; time: number }[] = [];
  for (let s = 0; s < steps; s++)
    for (const drum of pattern(s)) {
      const time = 0.25 + s * step;
      truth.push({ drum, time });
      const at = Math.round(time * ANALYSIS_RATE);
      SOUNDS[drum].forEach((v, i) => (mix[at + i] += v));
    }
  return { mix, truth };
}

function score(mix: Float32Array, truth: { drum: Drum; time: number }[], sensitivity = 0.5) {
  const { frames, features } = drumFeatures(mix);
  const hits = pickDrumHits({ drums: packDrums(features, frames), drumFrames: frames }, sensitivity);
  return Object.fromEntries(
    (["kick", "snare", "hat"] as const).map((drum) => {
      const want = truth.filter((t) => t.drum === drum);
      const got = hits.filter((h) => h.drum === drum);
      const found = want.filter((w) => got.some((g) => Math.abs(g.time - w.time) < 0.03)).length;
      return [drum, { found, of: want.length, extra: got.length - found }];
    }),
  ) as Record<Drum, { found: number; of: number; extra: number }>;
}

describe("drum hearing", () => {
  it("measures every frame of the file: an onset strength, each band's gain and rise", () => {
    const { frames, features } = drumFeatures(new Float32Array(ANALYSIS_RATE));
    expect(frames).toBe(Math.floor((ANALYSIS_RATE - 1) / 256) + 1);
    expect(features).toHaveLength(DRUM_FEATURES.length);
    expect(features.every((f) => f.length === frames && f.every((v) => v >= 0 && v <= 1))).toBe(true);
  });

  it("hears a rock beat's kicks, snares and hats (but a hat struck with a snare is the snare)", () => {
    const rock = (s: number): Drum[] => [...(s % 8 === 0 ? (["kick"] as const) : []), ...(s % 8 === 4 ? (["snare"] as const) : []), ...(s % 2 === 0 ? (["hat"] as const) : [])];
    const result = score(beat(rock).mix, beat(rock).truth);
    expect(result.kick).toEqual({ found: 16, of: 16, extra: 0 });
    expect(result.snare).toEqual({ found: 16, of: 16, extra: 0 });
    expect(result.hat.extra).toBe(0);
    // Every hat not under a snare.
    expect(result.hat.found).toBeGreaterThanOrEqual(64 - 16);
  });

  it("tells a kick's falling pitch from a new kick when hats play between", () => {
    const busy = (s: number): Drum[] => [...([0, 3, 6, 10].includes(s % 16) ? (["kick"] as const) : []), ...([4, 12].includes(s % 16) ? (["snare"] as const) : []), "hat"];
    const { mix, truth } = beat(busy);
    const result = score(mix, truth);
    expect(result.kick).toEqual({ found: 32, of: 32, extra: 0 });
    expect(result.snare.found).toBe(16);
    expect(result.hat.extra).toBe(0);
    expect(result.hat.found).toBeGreaterThan(0.6 * 128);
  });

  it("hears more of quiet hits as sensitivity rises", () => {
    const quiet = (s: number): Drum[] => (s % 2 === 0 ? ["hat"] : []);
    const { mix, truth } = beat((s) => [...(s % 16 === 0 ? (["kick"] as const) : []), ...quiet(s)]);
    // Every other hat at a fifth of the level.
    const loud = beat((s) => (s % 16 === 0 ? ["kick"] : []));
    const quieter = mix.map((v, i) => loud.mix[i] + (v - loud.mix[i]) * (Math.floor(i / (ANALYSIS_RATE * 0.25)) % 2 ? 0.2 : 1));
    const low = score(quieter, truth, 0.2).hat.found;
    const high = score(quieter, truth, 0.9).hat.found;
    expect(high).toBeGreaterThanOrEqual(low);
  });

  it("hears nothing in silence", () => {
    const { frames, features } = drumFeatures(new Float32Array(ANALYSIS_RATE * 2));
    expect(pickDrumHits({ drums: packDrums(features, frames), drumFrames: frames }, 1)).toEqual([]);
  });
});

describe("what travels", () => {
  it("comes back as it went", () => {
    const original: HeardAudio = {
      duration: 1.5,
      frames: 3,
      notes: Uint16Array.from({ length: 3 * KEYS }, (_, i) => (i * 7919) % ACTIVATION_SCALE),
      onsets: Uint16Array.from({ length: 3 * KEYS }, (_, i) => (i * 104_729) % ACTIVATION_SCALE),
      drums: Uint16Array.from({ length: 5 * DRUM_FEATURES.length }, (_, i) => i * 1000),
      drumFrames: 5,
    };
    const back = heardFromJson(JSON.parse(JSON.stringify(heardToJson(original))));
    expect(back).toEqual(original);
  });
});
