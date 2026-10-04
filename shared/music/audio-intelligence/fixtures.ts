/**
 * The cleared fixture collection: audio made here, from code, so nothing in it has a licence to wonder about, and
 * each one's properties are known by construction (a tone's level, a vocal phrase's peak, two channels' correlation).
 * The measurements, the hearing tests and the mixing loop are all tried against these before real recordings.
 *
 * What's here is a starting set, not a benchmark of vocals on beats: the voice is a synthetic one (a harmonic
 * source through formant peaks), good for dynamics and tone tests, and it doesn't stand for singers. Real,
 * cleared recordings come later (the plan's pilot of 20 to 30) and use the same manifest, with their own licence.
 *
 * Generation is deterministic from the seed (a seeded generator, no `Math.random`), but not bit-exact across
 * platforms (`Math.sin` may differ in its last digit), so tests check properties, never hashes of the audio.
 */
import type { UsePermissions } from "./types.ts";
import { Problems, array, number, object, oneOf, string, stringList, toValidation, unique, type Validation } from "./validation.ts";

export const FIXTURE_ROLES = ["vocal", "beat", "mix", "tone", "noise", "stereo", "silence"] as const;
export type FixtureRole = (typeof FIXTURE_ROLES)[number];

/** How a fixture is made. `mix` sums other fixtures by their ids. */
export type FixtureGenerator =
  | { kind: "voice"; seed: number; f0Hz: number; /** Each phrase's peak level in dBFS: the dynamics to be evened out. */ phrasePeaksDb: number[]; sibilance: number }
  | { kind: "beat"; seed: number; tempo: number; peakDb: number }
  | { kind: "mix"; sources: { fixture: string; gainDb: number }[] }
  | { kind: "tone"; hz: number; peakDb: number }
  | { kind: "noise"; seed: number; rmsDb: number }
  | { kind: "stereoNoise"; seed: number; rmsDb: number; relation: "identical" | "antiPhase" | "independent" }
  | { kind: "square"; hz: number }
  | { kind: "silence" };

/** What is true of a fixture by construction. Only what's known is listed; tolerances are in dB, or in correlation. */
export interface FixtureExpectation {
  peakDbfs?: number;
  rmsDbfs?: number;
  /** Pearson correlation of the left and right channels, whole file. */
  correlation?: number;
  /** For a voice: each phrase's span in seconds, and its peak. */
  phrases?: { startSeconds: number; endSeconds: number; peakDbfs: number }[];
  /** For a beat: where the drum hits are (seconds). */
  hitsSeconds?: number[];
  /** The least peak (no more) the mix of two can have: a bound, not a measurement. */
  peakAtMostDbfs?: number;
  toleranceDb: number;
}

export interface FixtureSpec {
  /** `fixture_<name>`. */
  id: string;
  role: FixtureRole;
  description: string;
  /** The recording this audio is (or the recordings it's made from, for a mix): see `families.ts`. */
  families: string[];
  /** Who may use it. Made here, so cleared to every use but training, which is a decision for later. */
  license: "generated";
  permissions: UsePermissions;
  sampleRate: number;
  channels: 1 | 2;
  seconds: number;
  generator: FixtureGenerator;
  expected: FixtureExpectation;
}

export interface FixtureAudio {
  sampleRate: number;
  channels: Float32Array[];
}

/** Everything a fixture may be used for: it's synthetic. Training stays off until someone decides it. */
export const CLEARED_USE: UsePermissions = { localAnalysis: true, hostedAnalysis: true, retrievalDisplay: true, training: false };

// ---------------------------------------------------------------------------------------------------------
// The generators

/** dB to a linear gain, and back. */
export const dbToGain = (db: number): number => 10 ** (db / 20);
export const gainToDb = (gain: number): number => 20 * Math.log10(gain);

/** A small seeded generator (mulberry32): the same seed gives the same numbers anywhere. */
export function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Scales `samples[from..to)` so its largest sample is `peakDb` dBFS. A silent span stays silent. */
function setPeak(samples: Float32Array, from: number, to: number, peakDb: number) {
  let peak = 0;
  for (let i = from; i < to; i++) peak = Math.max(peak, Math.abs(samples[i]));
  if (peak === 0) return;
  const gain = dbToGain(peakDb) / peak;
  for (let i = from; i < to; i++) samples[i] *= gain;
}

/** Formants (Hz) of five vowels: where the voice's harmonics are loud. */
const VOWELS: readonly (readonly [number, number, number])[] = [
  [800, 1200, 2500],
  [400, 2000, 2600],
  [300, 2300, 3000],
  [500, 900, 2500],
  [350, 600, 2400],
];

/** The gain a formant peak gives a harmonic at `hz`: three resonances of about a tenth of their frequency in width. */
function formantGain(hz: number, formants: readonly number[]): number {
  let total = 0.04;
  for (const f of formants) total += 1 / (1 + ((hz - f) / (f * 0.12)) ** 2);
  return total;
}

const PHRASE_SECONDS = 1.5;
const PHRASE_GAP_SECONDS = 0.3;
const SYLLABLES = 4;

/** Where each phrase of a voice fixture is, in seconds. */
export function voicePhrases(count: number): { startSeconds: number; endSeconds: number }[] {
  return Array.from({ length: count }, (_, i) => {
    const startSeconds = 0.2 + i * (PHRASE_SECONDS + PHRASE_GAP_SECONDS);
    return { startSeconds, endSeconds: startSeconds + PHRASE_SECONDS };
  });
}

/**
 * Sung syllables: a harmonic series on a gliding pitch with a little vibrato, shaped by each syllable's vowel, each
 * with a breath of high-passed noise at its start (the sibilance). Every phrase is then set to its own peak, so the
 * phrases differ in level by exactly what the spec says.
 */
function voice(g: Extract<FixtureGenerator, { kind: "voice" }>, rate: number, frames: number): Float32Array {
  const out = new Float32Array(frames);
  const random = seeded(g.seed);
  const phrases = voicePhrases(g.phrasePeaksDb.length);
  const scale = [0, 2, 4, 7, 9, 12, 14];
  phrases.forEach((phrase, p) => {
    const first = Math.floor(phrase.startSeconds * rate);
    const syllableFrames = Math.floor((PHRASE_SECONDS * rate) / SYLLABLES);
    for (let s = 0; s < SYLLABLES; s++) {
      const start = first + s * syllableFrames;
      const f0 = g.f0Hz * 2 ** (scale[Math.floor(random() * scale.length)] / 12);
      const vowel = VOWELS[Math.floor(random() * VOWELS.length)];
      const harmonics = Math.floor(Math.min(5000, rate / 2 - 500) / f0);
      const weights = Array.from({ length: harmonics }, (_, h) => formantGain(f0 * (h + 1), vowel) / (h + 1) ** 0.5);
      let phase = random() * Math.PI * 2;
      const sung = Math.floor(syllableFrames * 0.9);
      for (let n = 0; n < sung && start + n < frames; n++) {
        const t = n / rate;
        const vibrato = 1 + 0.008 * Math.sin(2 * Math.PI * 5.5 * t);
        phase += (2 * Math.PI * f0 * vibrato) / rate;
        const attack = Math.min(1, t / 0.02);
        const release = Math.min(1, (sung - n) / (0.06 * rate));
        let sample = 0;
        for (let h = 0; h < harmonics; h++) sample += weights[h] * Math.sin((h + 1) * phase);
        out[start + n] += sample * attack * release;
      }
      // The consonant: noise through a first difference (a high-pass), in the syllable's first 70 ms.
      const breath = Math.floor(0.07 * rate);
      let previous = 0;
      for (let n = 0; n < breath && start + n < frames; n++) {
        const noise = random() * 2 - 1;
        out[start + n] += (noise - previous) * g.sibilance * 6 * (1 - n / breath);
        previous = noise;
      }
    }
    const end = Math.min(frames, Math.floor(phrase.endSeconds * rate));
    setPeak(out, first, end, g.phrasePeaksDb[p]);
  });
  return out;
}

/** Drum hits of a beat: kick on 1 and 3 (and an extra before 4), snare on 2 and 4, hats on eighths. */
export function beatHits(tempo: number, seconds: number): { kind: "kick" | "snare" | "hat"; at: number }[] {
  const beat = 60 / tempo;
  const hits: { kind: "kick" | "snare" | "hat"; at: number }[] = [];
  for (let eighth = 0; eighth * beat * 0.5 < seconds - 0.2; eighth++) {
    const at = eighth * beat * 0.5;
    const inBar = eighth % 8;
    hits.push({ kind: "hat", at });
    if (inBar === 0 || inBar === 4 || inBar === 7) hits.push({ kind: "kick", at });
    if (inBar === 2 || inBar === 6) hits.push({ kind: "snare", at });
  }
  return hits.sort((a, b) => a.at - b.at);
}

/** Kick, snare and hats on a grid: the hats panned left and right, the rest in the middle; peak set exactly. */
function beat(g: Extract<FixtureGenerator, { kind: "beat" }>, rate: number, frames: number): Float32Array[] {
  const left = new Float32Array(frames);
  const right = new Float32Array(frames);
  const random = seeded(g.seed);
  let hat = 0;
  for (const { kind, at } of beatHits(g.tempo, frames / rate)) {
    const start = Math.floor(at * rate);
    const length = Math.floor((kind === "kick" ? 0.3 : kind === "snare" ? 0.18 : 0.05) * rate);
    let phase = 0;
    let previous = 0;
    const pan = kind === "hat" ? (hat++ % 2 === 0 ? 0.3 : 0.7) : 0.5;
    const [gl, gr] = [Math.cos((pan * Math.PI) / 2), Math.sin((pan * Math.PI) / 2)];
    for (let n = 0; n < length && start + n < frames; n++) {
      const t = n / rate;
      let sample: number;
      if (kind === "kick") {
        // A sine sweeping down from 120 Hz to 45 Hz.
        phase += (2 * Math.PI * (45 + 75 * Math.exp(-t * 40))) / rate;
        sample = Math.sin(phase) * Math.exp(-t * 14);
      } else if (kind === "snare") {
        const noise = random() * 2 - 1;
        sample = (noise * 0.7 + Math.sin(2 * Math.PI * 190 * t) * 0.5) * Math.exp(-t * 22);
      } else {
        const noise = random() * 2 - 1;
        sample = (noise - previous) * 0.35 * Math.exp(-t * 90);
        previous = noise;
      }
      left[start + n] += sample * gl;
      right[start + n] += sample * gr;
    }
  }
  // One scale for both channels (the stereo picture stays), set so the louder channel's peak is `peakDb`.
  let peak = 0;
  for (let i = 0; i < frames; i++) peak = Math.max(peak, Math.abs(left[i]), Math.abs(right[i]));
  const gain = peak === 0 ? 0 : dbToGain(g.peakDb) / peak;
  for (let i = 0; i < frames; i++) {
    left[i] *= gain;
    right[i] *= gain;
  }
  return [left, right];
}

/** Makes a fixture's audio. `all` is the collection a mix draws its sources from. */
export function renderFixture(spec: FixtureSpec, all: readonly FixtureSpec[] = [spec], depth = 0): FixtureAudio {
  const rate = spec.sampleRate;
  const frames = Math.round(spec.seconds * rate);
  const g = spec.generator;
  let channels: Float32Array[];
  switch (g.kind) {
    case "voice": {
      const mono = voice(g, rate, frames);
      channels = spec.channels === 2 ? [mono, Float32Array.from(mono)] : [mono];
      break;
    }
    case "beat":
      channels = beat(g, rate, frames);
      break;
    case "mix": {
      if (depth > 4) throw new Error(`Fixture ${spec.id}: mixes nest too deep (a mix of itself?)`);
      channels = Array.from({ length: spec.channels }, () => new Float32Array(frames));
      for (const source of g.sources) {
        const part = all.find((s) => s.id === source.fixture);
        if (!part) throw new Error(`Fixture ${spec.id} mixes ${source.fixture}, which isn't in the collection.`);
        if (part.sampleRate !== rate) throw new Error(`Fixture ${spec.id} mixes ${source.fixture} at ${part.sampleRate} Hz, not ${rate}.`);
        const audio = renderFixture(part, all, depth + 1);
        const gain = dbToGain(source.gainDb);
        for (let c = 0; c < spec.channels; c++) {
          const from = audio.channels[Math.min(c, audio.channels.length - 1)];
          for (let i = 0; i < Math.min(frames, from.length); i++) channels[c][i] += from[i] * gain;
        }
      }
      break;
    }
    case "tone": {
      const mono = new Float32Array(frames);
      const gain = dbToGain(g.peakDb);
      for (let i = 0; i < frames; i++) mono[i] = gain * Math.sin((2 * Math.PI * g.hz * i) / rate);
      channels = spec.channels === 2 ? [mono, Float32Array.from(mono)] : [mono];
      break;
    }
    case "noise": {
      const random = seeded(g.seed);
      // Uniform noise has an RMS of 1/√3 of its peak: scale so the RMS is `rmsDb`.
      const gain = dbToGain(g.rmsDb) * Math.sqrt(3);
      const mono = Float32Array.from({ length: frames }, () => (random() * 2 - 1) * gain);
      channels = spec.channels === 2 ? [mono, Float32Array.from(mono)] : [mono];
      break;
    }
    case "stereoNoise": {
      if (spec.channels !== 2) throw new Error(`Fixture ${spec.id}: stereo noise is two channels.`);
      const random = seeded(g.seed);
      const gain = dbToGain(g.rmsDb) * Math.sqrt(3);
      const a = Float32Array.from({ length: frames }, () => (random() * 2 - 1) * gain);
      const b = g.relation === "identical" ? Float32Array.from(a) : g.relation === "antiPhase" ? a.map((v) => -v) : Float32Array.from({ length: frames }, () => (random() * 2 - 1) * gain);
      channels = [a, b];
      break;
    }
    case "square": {
      const mono = new Float32Array(frames);
      const period = rate / g.hz;
      for (let i = 0; i < frames; i++) mono[i] = i % period < period / 2 ? 1 : -1;
      channels = spec.channels === 2 ? [mono, Float32Array.from(mono)] : [mono];
      break;
    }
    case "silence":
      channels = Array.from({ length: spec.channels }, () => new Float32Array(frames));
      break;
  }
  return { sampleRate: rate, channels };
}

// ---------------------------------------------------------------------------------------------------------
// The collection

const RATE = 48000;

/** The phrases' peaks: a wide spread (what a compressor is for) and a steady one (what it should leave alone). */
const UNEVEN_VOCAL = [-6, -18, -9, -22];
const STEADY_VOCAL = [-9, -10, -9.5, -10.5];

const phrasesOf = (peaks: number[]) => voicePhrases(peaks.length).map((span, i) => ({ ...span, peakDbfs: peaks[i] }));
const SECONDS = 8;

const base = {
  license: "generated" as const,
  permissions: CLEARED_USE,
  sampleRate: RATE,
};

/**
 * The starting collection. `families` are recordings: the two vocals and the beat are one each, a mix is made of the
 * families of what's in it, and a known-signal fixture is a family of its own.
 */
export const FIXTURES: readonly FixtureSpec[] = [
  {
    ...base,
    id: "fixture_vocal_uneven",
    role: "vocal",
    description: "Four sung phrases peaking at -6, -18, -9 and -22 dBFS: a vocal with a wide dynamic range.",
    families: ["family_vocal_uneven"],
    channels: 1,
    seconds: SECONDS,
    generator: { kind: "voice", seed: 11, f0Hz: 130, phrasePeaksDb: UNEVEN_VOCAL, sibilance: 0.4 },
    expected: { peakDbfs: -6, phrases: phrasesOf(UNEVEN_VOCAL), toleranceDb: 0.1 },
  },
  {
    ...base,
    id: "fixture_vocal_steady",
    role: "vocal",
    description: "Four sung phrases peaking within 1.5 dB of each other, with sharper consonants: a vocal that needs no levelling.",
    families: ["family_vocal_steady"],
    channels: 1,
    seconds: SECONDS,
    generator: { kind: "voice", seed: 23, f0Hz: 220, phrasePeaksDb: STEADY_VOCAL, sibilance: 1 },
    expected: { peakDbfs: -9, phrases: phrasesOf(STEADY_VOCAL), toleranceDb: 0.1 },
  },
  {
    ...base,
    id: "fixture_beat_120",
    role: "beat",
    description: "Four bars of kick, snare and eighth-note hats at 120 BPM, stereo, peaking at -3 dBFS.",
    families: ["family_beat_120"],
    channels: 2,
    seconds: SECONDS,
    generator: { kind: "beat", seed: 5, tempo: 120, peakDb: -3 },
    expected: { peakDbfs: -3, hitsSeconds: beatHits(120, SECONDS).map((h) => h.at), toleranceDb: 0.1 },
  },
  {
    ...base,
    id: "fixture_mix_uneven_over_120",
    role: "mix",
    description: "The uneven vocal 6 dB down over the beat 6 dB down: a vocal on a beat. Made of two recordings, so both stay on one side of a split.",
    families: ["family_vocal_uneven", "family_beat_120"],
    channels: 2,
    seconds: SECONDS,
    generator: { kind: "mix", sources: [{ fixture: "fixture_vocal_uneven", gainDb: -6 }, { fixture: "fixture_beat_120", gainDb: -6 }] },
    // The sum of the two peaks, -12 dBFS and -9 dBFS, can't pass -5.3.
    expected: { peakAtMostDbfs: gainToDb(dbToGain(-12) + dbToGain(-9)), toleranceDb: 0.1 },
  },
  {
    ...base,
    id: "fixture_tone_1k",
    role: "tone",
    description: "A 1 kHz sine peaking at -6 dBFS, stereo, identical channels.",
    families: ["family_tone_1k"],
    channels: 2,
    seconds: 4,
    generator: { kind: "tone", hz: 1000, peakDb: -6 },
    expected: { peakDbfs: -6, rmsDbfs: -6 - 3.0103, correlation: 1, toleranceDb: 0.05 },
  },
  {
    ...base,
    id: "fixture_noise_m20",
    role: "noise",
    description: "Seeded white noise at -20 dBFS RMS, stereo, identical channels.",
    families: ["family_noise_m20"],
    channels: 2,
    seconds: 4,
    generator: { kind: "noise", seed: 99, rmsDb: -20 },
    expected: { rmsDbfs: -20, correlation: 1, toleranceDb: 0.1 },
  },
  {
    ...base,
    id: "fixture_stereo_antiphase",
    role: "stereo",
    description: "Noise in the left channel and its opposite in the right: correlation -1, silent in mono.",
    families: ["family_stereo_antiphase"],
    channels: 2,
    seconds: 4,
    generator: { kind: "stereoNoise", seed: 7, rmsDb: -18, relation: "antiPhase" },
    expected: { rmsDbfs: -18, correlation: -1, toleranceDb: 0.1 },
  },
  {
    ...base,
    id: "fixture_stereo_independent",
    role: "stereo",
    description: "Two independent noises of the same level: correlation near 0, wide.",
    families: ["family_stereo_independent"],
    channels: 2,
    seconds: 4,
    generator: { kind: "stereoNoise", seed: 8, rmsDb: -18, relation: "independent" },
    expected: { rmsDbfs: -18, correlation: 0, toleranceDb: 0.1 },
  },
  {
    ...base,
    id: "fixture_clipped_square",
    role: "tone",
    description: "A 500 Hz square wave at full scale: peak 0 dBFS, RMS 0 dBFS, no crest.",
    families: ["family_clipped_square"],
    channels: 2,
    seconds: 2,
    generator: { kind: "square", hz: 500 },
    expected: { peakDbfs: 0, rmsDbfs: 0, correlation: 1, toleranceDb: 0.05 },
  },
  {
    ...base,
    id: "fixture_silence",
    role: "silence",
    description: "Two seconds of digital silence.",
    families: ["family_silence"],
    channels: 2,
    seconds: 2,
    generator: { kind: "silence" },
    expected: { toleranceDb: 0 },
  },
];

export const fixtureById = (id: string): FixtureSpec | undefined => FIXTURES.find((f) => f.id === id);

// ---------------------------------------------------------------------------------------------------------
// Checking a collection

const level = { min: -120, max: 24 } as const;

function readGenerator(g: Record<string, unknown>, kind: FixtureGenerator["kind"], at: string, p: Problems): FixtureGenerator {
  const n = (key: string, range: { min?: number; max?: number; int?: boolean } = {}) => number(g[key], `${at}.${key}`, p, range);
  switch (kind) {
    case "voice": {
      const peaks = array(g.phrasePeaksDb, `${at}.phrasePeaksDb`, p, 16).map((v, i) => number(v, `${at}.phrasePeaksDb[${i}]`, p, { min: -120, max: 0 }));
      if (peaks.length === 0) p.add(`${at}.phrasePeaksDb`, "needs at least one phrase");
      return { kind, seed: n("seed", { int: true }), f0Hz: n("f0Hz", { min: 40, max: 1000 }), phrasePeaksDb: peaks, sibilance: n("sibilance", { min: 0, max: 4 }) };
    }
    case "beat":
      return { kind, seed: n("seed", { int: true }), tempo: n("tempo", { min: 40, max: 240 }), peakDb: n("peakDb", { min: -120, max: 0 }) };
    case "mix": {
      const sources = array(g.sources, `${at}.sources`, p, 16).map((item, i) => {
        const x = object(item, `${at}.sources[${i}]`, p);
        return { fixture: string(x.fixture, `${at}.sources[${i}].fixture`, p, { nonEmpty: true }), gainDb: number(x.gainDb, `${at}.sources[${i}].gainDb`, p, level) };
      });
      if (sources.length === 0) p.add(`${at}.sources`, "needs at least one source");
      return { kind, sources };
    }
    case "tone":
      return { kind, hz: n("hz", { min: 20, max: 20000 }), peakDb: n("peakDb", { min: -120, max: 0 }) };
    case "noise":
      return { kind, seed: n("seed", { int: true }), rmsDb: n("rmsDb", { min: -120, max: 0 }) };
    case "stereoNoise":
      return { kind, seed: n("seed", { int: true }), rmsDb: n("rmsDb", { min: -120, max: 0 }), relation: oneOf(g.relation, ["identical", "antiPhase", "independent"], `${at}.relation`, p) };
    case "square":
      return { kind, hz: n("hz", { min: 20, max: 20000 }) };
    case "silence":
      return { kind };
  }
}

function readExpectation(input: unknown, at: string, p: Problems): FixtureExpectation {
  const e = object(input, at, p);
  const optional = (key: string, range: { min?: number; max?: number }) => (e[key] === undefined ? {} : { [key]: number(e[key], `${at}.${key}`, p, range) });
  const phrases = e.phrases === undefined ? {} : { phrases: array(e.phrases, `${at}.phrases`, p, 16).map((item, i) => {
    const x = object(item, `${at}.phrases[${i}]`, p);
    return { startSeconds: number(x.startSeconds, `${at}.phrases[${i}].startSeconds`, p, { min: 0 }), endSeconds: number(x.endSeconds, `${at}.phrases[${i}].endSeconds`, p, { min: 0 }), peakDbfs: number(x.peakDbfs, `${at}.phrases[${i}].peakDbfs`, p, { min: -120, max: 24 }) };
  }) };
  const hits = e.hitsSeconds === undefined ? {} : { hitsSeconds: array(e.hitsSeconds, `${at}.hitsSeconds`, p, 10_000).map((v, i) => number(v, `${at}.hitsSeconds[${i}]`, p, { min: 0 })) };
  return {
    ...optional("peakDbfs", level),
    ...optional("rmsDbfs", level),
    ...optional("correlation", { min: -1, max: 1 }),
    ...optional("peakAtMostDbfs", level),
    ...phrases,
    ...hits,
    toleranceDb: number(e.toleranceDb, `${at}.toleranceDb`, p, { min: 0, max: 6 }),
  };
}

/** Checks a fixture manifest (the built-in one, or a collection a person adds real recordings to). */
export function validateFixtures(input: unknown): Validation<FixtureSpec[]> {
  const p = new Problems();
  const list = array(input, "fixtures", p, 1000);
  const specs: FixtureSpec[] = list.map((item, i) => {
    const at = `fixtures[${i}]`;
    const o = object(item, at, p);
    const id = string(o.id, `${at}.id`, p, { nonEmpty: true });
    if (id && !/^fixture_[a-z0-9_]+$/.test(id)) p.add(`${at}.id`, "must be fixture_ and lower-case letters, digits or underscores");
    const role = oneOf(o.role, FIXTURE_ROLES, `${at}.role`, p);
    const families = stringList(o.families, `${at}.families`, p, 50);
    if (families.length === 0) p.add(`${at}.families`, "must name the recording or recordings it's made of");
    // A vocal or a beat is one recording; only a mix is made of several.
    if (role !== "mix" && families.length > 1) p.add(`${at}.families`, `a ${role} is one recording, not ${families.length}`);
    const channels = number(o.channels, `${at}.channels`, p, { min: 1, max: 2, int: true });
    if (o.license !== "generated") p.add(`${at}.license`, 'must be "generated": a recording from outside needs its licence added to the manifest\'s type first');
    const perms = object(o.permissions, `${at}.permissions`, p);
    const gen = object(o.generator, `${at}.generator`, p);
    const generator = oneOf(gen.kind, ["voice", "beat", "mix", "tone", "noise", "stereoNoise", "square", "silence"], `${at}.generator.kind`, p);
    if (role === "mix" && generator !== "mix") p.add(`${at}.generator`, "a mix is made by mixing");
    if (role !== "mix" && generator === "mix") p.add(`${at}.generator`, `only a mix is made by mixing, not a ${role}`);
    const expected = readExpectation(o.expected, `${at}.expected`, p);
    return {
      id,
      role,
      description: string(o.description, `${at}.description`, p, { nonEmpty: true }),
      families,
      license: "generated",
      permissions: {
        localAnalysis: perms.localAnalysis === true,
        hostedAnalysis: perms.hostedAnalysis === true,
        retrievalDisplay: perms.retrievalDisplay === true,
        training: perms.training === true,
      },
      sampleRate: number(o.sampleRate, `${at}.sampleRate`, p, { min: 8000, max: 192000, int: true }),
      channels: channels === 2 ? 2 : 1,
      seconds: number(o.seconds, `${at}.seconds`, p, { min: 0.1, max: 600 }),
      generator: readGenerator(gen, generator, `${at}.generator`, p),
      expected,
    };
  });
  unique(specs, (s) => s.id, "fixtures", p);
  const ids = new Set(specs.map((s) => s.id));
  specs.forEach((s, i) => {
    if (s.generator.kind !== "mix") return;
    const at = `fixtures[${i}]`;
    for (const source of s.generator.sources) if (!ids.has(source.fixture)) p.add(`${at}.generator`, `mixes ${source.fixture}, which isn't in the collection`);
    // A mix's families are exactly its sources' families: that's what keeps a mix beside its sources in a split.
    const expected = [...new Set(s.generator.sources.flatMap((x) => specs.find((o) => o.id === x.fixture)?.families ?? []))].sort();
    if (JSON.stringify([...s.families].sort()) !== JSON.stringify(expected)) p.add(`${at}.families`, `must be the families of what it mixes (${expected.join(", ")})`);
  });
  return toValidation(p, specs);
}
