/**
 * The hearing benchmark's material: cleared real recordings, the cases made from them (some untouched, some
 * changed in a known way so reviewers can check claims against the truth), the review's blinding, and the
 * evaluation it adds up to. Pure: the script `scripts/hearing-benchmark.ts` downloads, renders and runs.
 */
import { hashJson } from "../hash.ts";
import type { HearingTask } from "./hearing.ts";
import { HEARING_ARMS, HEARING_PROTOCOL, type HearingArm, type HearingBenchmarkCase, type HearingEvaluation, type HearingReview, type HearingTrial } from "./hearing-benchmark.ts";

/** Mix Evaluation Dataset 2.0's Hugging Face mirror, pinned: every file is read at this revision. */
export const MIX_EVALUATION = {
  repo: "sparrowreivun/Mix-Evaluation-Dataset-2.0",
  revision: "ac28ccd742b5cf1380838098b7921f4ebc82d041",
  licences: "Evaluation/MixEvaluation/songs.xml",
} as const;

export type SourceSplit = "development" | "heldout";
export interface BenchmarkSource {
  id: string;
  /** The song's id in songs.xml, whose licence it's used under. */
  songId: string;
  song: string;
  artist: string;
  /** One family per artist: songs by one band may share a studio, players and engineer. */
  family: string;
  split: SourceSplit;
  licence: "CC BY 3.0" | "CC BY-NC 4.0";
  origin: string;
  /** `mix`: an engineer's mixed excerpt (MP3). `stems`: one engineer's stems of the whole song, aligned. */
  kind: "mix" | "stems";
  /** Repository paths: a mix is one file; stems are named by their file (`vocal`, `bass`...). */
  files: Record<string, string>;
}

const OMT = "Open Multitrack Testbed (multitrack.eecs.qmul.ac.uk)";
const SHAKING = "Shaking Through (weathervanemusic.org/shakingthrough)";
const mix = (id: string, song: string, artist: string, family: string, split: SourceSplit, licence: BenchmarkSource["licence"], folder: string, file: string): BenchmarkSource =>
  ({ id, songId: folder, song, artist, family, split, licence, origin: licence === "CC BY 3.0" ? OMT : SHAKING, kind: "mix", files: { mix: `Evaluation/MixEvaluation/audio/${folder}/${file}` } });
const stems = (id: string, song: string, artist: string, family: string, folder: string, names: string[]): BenchmarkSource =>
  ({ id, songId: folder.replace(/Stems$/, ""), song, artist, family, split: "heldout", licence: "CC BY 3.0", origin: OMT, kind: "stems", files: Object.fromEntries(names.map(n => [n, `Evaluation/audio/${folder}/McG-A/${n}.wav`])) });

/** Only songs.xml's Creative Commons songs; its copyrighted ones and the songs it doesn't list are left out. */
export const BENCHMARK_SOURCES: BenchmarkSource[] = [
  stems("notalone-stems", "Not Alone", "Fredy V", "fredy-v", "NotAloneStems", ["vocal", "bass", "kick", "snare", "rest"]),
  stems("redtoblue-stems", "Red To Blue", "Broken Crank", "broken-crank", "RedToBlueStems", ["vocal", "bass", "kick", "snare", "rest"]),
  stems("leadme-stems", "Lead Me", "The DoneFors", "donefors", "LeadMeStems", ["acguitar", "bass"]),
  mix("leadme-mcg-a", "Lead Me", "The DoneFors", "donefors", "heldout", "CC BY 3.0", "LeadMe", "McG-A.mp3"),
  mix("covered-mcg-i", "Under A Covered Sky", "The DoneFors", "donefors", "heldout", "CC BY 3.0", "UnderACoveredSky", "McG-I.mp3"),
  mix("pouring-mcg-q", "Pouring Room", "The DoneFors", "donefors", "heldout", "CC BY 3.0", "PouringRoom", "McG-Q.mp3"),
  mix("meantime-du-h", "In The Meantime", "Fredy V", "fredy-v", "heldout", "CC BY 3.0", "InTheMeantime", "DU-H.mp3"),
  mix("redtoblue-mcg-b", "Red To Blue", "Broken Crank", "broken-crank", "heldout", "CC BY 3.0", "RedToBlue", "McG-B.mp3"),
  mix("newskin-du-o", "New Skin", "Torres", "torres", "heldout", "CC BY-NC 4.0", "NewSkin", "DU-O.mp3"),
  mix("newskin-du-p", "New Skin", "Torres", "torres", "heldout", "CC BY-NC 4.0", "NewSkin", "DU-P.mp3"),
  mix("idlike-pxl-s1", "I'd Like To Know", "Filthybird", "filthybird", "heldout", "CC BY-NC 4.0", "IdLikeToKnow", "PXL-S1.mp3"),
  mix("idlike-pxl-s2", "I'd Like To Know", "Filthybird", "filthybird", "heldout", "CC BY-NC 4.0", "IdLikeToKnow", "PXL-S2.mp3"),
  mix("vermont-du-o2", "Vermont", "The Districts", "districts", "heldout", "CC BY-NC 4.0", "Vermont", "DU-O2.mp3"),
  mix("vermont-pxl-l1", "Vermont", "The Districts", "districts", "heldout", "CC BY-NC 4.0", "Vermont", "PXL-L1.mp3"),
  mix("lush-uh-1", "Lush", "The Tontons", "tontons", "heldout", "CC BY-NC 4.0", "Lush", "UH-1.mp3"),
  mix("lush-uh-2", "Lush", "The Tontons", "tontons", "heldout", "CC BY-NC 4.0", "Lush", "UH-2.mp3"),
  mix("oldtree-ucp-a1", "Old Tree", "Creepoid", "creepoid", "development", "CC BY-NC 4.0", "OldTree", "UCP-A1.mp3"),
  mix("oldtree-ucp-a2", "Old Tree", "Creepoid", "creepoid", "development", "CC BY-NC 4.0", "OldTree", "UCP-A2.mp3"),
  mix("lolita-ucp-a1", "Lolita", "Purling Hiss", "purling-hiss", "development", "CC BY-NC 4.0", "Lolita", "UCP-A1.mp3"),
  mix("lolita-ucp-a2", "Lolita", "Purling Hiss", "purling-hiss", "development", "CC BY-NC 4.0", "Lolita", "UCP-A2.mp3"),
];

/** One question per task, the same for every case of it, so the question never gives the answer away. */
export const BENCHMARK_QUESTIONS: Record<HearingTask, string> = {
  context: "Which instruments and voices can be heard, and does any of them enter or drop out during the clip? Give the times of any entry or exit.",
  tone: "Describe the tonal balance (for example bright, dull, muddy, boomy, harsh or thin) and whether it changes during the clip. Give the times of any change.",
  dynamics: "Describe how the loudness changes over the clip, including any sudden or gradual change. Give the times.",
};

export type ToneFilter = "dull" | "bright" | "boomy" | "thin" | "harsh" | "boxy" | "telephone";
export type Derivation =
  | { kind: "none" }
  /** A stem group (stems summed) leaves or arrives at `at` seconds into the passage; the others play throughout. */
  | { kind: "stem-exit" | "stem-entry"; group: string; stems: string[]; at: number }
  /** One stem alone. */
  | { kind: "solo"; stem: string }
  /** From `at`, the passage goes through `filter` (crossfaded over 50 ms). */
  | { kind: "tone"; filter: ToneFilter; at: number }
  /** From `at`, the gain moves by `db` over `over` seconds (0.05: a step). */
  | { kind: "gain"; db: number; at: number; over: number };
/** Where a passage starts: fixed, or found in the audio (`steadiest`: least 1-second RMS spread; `active`: every listed stem playing). */
export type Placement = { kind: "at"; start: number } | { kind: "steadiest" } | { kind: "active"; stems: string[] };
export interface CaseSpec {
  id: string;
  task: HearingTask;
  sourceId: string;
  family: string;
  split: SourceSplit;
  /** A no-change case: the correct answer reports no entry/exit, no tonal change, no level change. */
  control: boolean;
  placement: Placement;
  derivation: Derivation;
}
export const PASSAGE_SECONDS = 20;
const TONE_LABEL: Record<ToneFilter, string> = {
  dull: "a high shelf cut (−10 dB from 3 kHz): duller",
  bright: "a high shelf boost (+8 dB from 4 kHz): brighter",
  boomy: "a low shelf boost (+9 dB below 150 Hz): boomier",
  thin: "a low cut (high-pass at 300 Hz, 12 dB/octave): thinner",
  harsh: "an upper-mid boost (+9 dB at 3 kHz): harsher",
  boxy: "a low-mid boost (+8 dB at 600 Hz): boxier",
  telephone: "a band-pass (300 Hz to 3 kHz): telephone-like",
};
const GROUPS: Record<string, string[]> = { vocal: ["vocal"], bass: ["bass"], drums: ["kick", "snare"] };

/** A change lands between 7 and 13 seconds, by the case id: reviewers and models can't learn one moment. */
export function changeTime(id: string) { return 7 + (parseInt(hashJson(id).slice(0, 8), 16) % 601) / 100; }

/** Every case, by task: held-out families get at least ten real cases a task and controls from two families or more. */
export function benchmarkCases(): CaseSpec[] {
  const source = (id: string) => { const s = BENCHMARK_SOURCES.find(x => x.id === id); if (!s) throw new Error(`Unknown source ${id}`); return s; };
  const cases: CaseSpec[] = [];
  const add = (task: HearingTask, sourceId: string, control: boolean, placement: Placement, derivation: (id: string) => Derivation, tag: string) => {
    const s = source(sourceId), id = `${task}-${sourceId}-${tag}`;
    cases.push({ id, task, sourceId, family: s.family, split: s.split, control, placement, derivation: derivation(id) });
  };
  const all = ["vocal", "bass", "kick", "snare", "rest"];
  const moves: [string, "stem-exit" | "stem-entry", string][] = [
    ["notalone-stems", "stem-exit", "vocal"], ["notalone-stems", "stem-entry", "drums"], ["notalone-stems", "stem-exit", "bass"],
    ["redtoblue-stems", "stem-exit", "bass"], ["redtoblue-stems", "stem-entry", "vocal"], ["redtoblue-stems", "stem-exit", "drums"],
  ];
  for (const [src, kind, group] of moves) add("context", src, false, { kind: "active", stems: all }, id => ({ kind, group, stems: GROUPS[group], at: changeTime(id) }), `${kind}-${group}`);
  for (const src of ["covered-mcg-i", "newskin-du-o", "idlike-pxl-s1", "vermont-du-o2", "lush-uh-1", "oldtree-ucp-a1", "lolita-ucp-a1"]) add("context", src, false, { kind: "at", start: 10 }, () => ({ kind: "none" }), "natural");
  for (const [src, stem] of [["notalone-stems", "vocal"], ["redtoblue-stems", "bass"], ["leadme-stems", "acguitar"]] as const) add("context", src, true, { kind: "active", stems: [stem] }, () => ({ kind: "solo", stem }), `solo-${stem}`);

  const tones: [string, ToneFilter][] = [["leadme-mcg-a", "dull"], ["meantime-du-h", "bright"], ["redtoblue-mcg-b", "boomy"], ["newskin-du-o", "thin"], ["idlike-pxl-s1", "harsh"],
    ["vermont-du-o2", "boxy"], ["lush-uh-1", "telephone"], ["pouring-mcg-q", "harsh"], ["oldtree-ucp-a1", "dull"], ["lolita-ucp-a1", "bright"]];
  for (const [src, filter] of tones) add("tone", src, false, { kind: "at", start: 5 }, id => ({ kind: "tone", filter, at: changeTime(id) }), filter);
  for (const src of ["pouring-mcg-q", "newskin-du-p", "vermont-pxl-l1", "lush-uh-2", "oldtree-ucp-a2", "lolita-ucp-a2"]) add("tone", src, true, { kind: "steadiest" }, () => ({ kind: "none" }), "untouched");

  const gains: [string, number, number][] = [["leadme-mcg-a", -9, 0.05], ["meantime-du-h", 8, 0.05], ["redtoblue-mcg-b", -18, 6], ["newskin-du-p", -10, 0.05], ["idlike-pxl-s2", 9, 4],
    ["vermont-pxl-l1", -8, 0.05], ["lush-uh-2", -15, 5], ["covered-mcg-i", 7, 0.05], ["oldtree-ucp-a2", -9, 0.05], ["lolita-ucp-a2", -16, 5]];
  for (const [src, db, over] of gains) add("dynamics", src, false, { kind: "steadiest" }, id => ({ kind: "gain", db, at: Math.min(changeTime(id), PASSAGE_SECONDS - over - 1), over }), `${db > 0 ? "up" : "down"}${Math.abs(db)}-${over > 1 ? "ramp" : "step"}`);
  for (const src of ["covered-mcg-i", "meantime-du-h", "idlike-pxl-s2", "lush-uh-1", "oldtree-ucp-a1", "lolita-ucp-a1"]) add("dynamics", src, true, { kind: "steadiest" }, () => ({ kind: "none" }), "untouched");
  return cases;
}

/** What reviewers are told about a case's audio: what was done to it, so claims can be checked against the truth. */
export function knownFacts(spec: CaseSpec, source: BenchmarkSource, measured: { steadySpreadDb?: number }): string[] {
  const facts = [`${source.song} by ${source.artist} (${source.licence}, ${source.origin}). ${source.kind === "stems" ? "Built from one engineer's stems" : "An engineer's mix"}, ${PASSAGE_SECONDS} seconds.`];
  const d = spec.derivation, at = (s: number) => `${s.toFixed(1)} s`;
  if (d.kind === "none") facts.push(spec.task === "context" ? "Untouched: there is no constructed truth, so judge what's audible by listening." : "Untouched: nothing was changed in this clip. Any change it has is the music's own.");
  if (d.kind === "stem-exit") facts.push(`The ${d.group} stem${d.stems.length > 1 ? "s" : ""} (${d.stems.join(" + ")}) stop at ${at(d.at)} (50 ms fade). The other stems play throughout.`);
  if (d.kind === "stem-entry") facts.push(`The ${d.group} stem${d.stems.length > 1 ? "s" : ""} (${d.stems.join(" + ")}) come in at ${at(d.at)} (50 ms fade). The other stems play throughout.`);
  if (d.kind === "solo") facts.push(`Only the ${d.stem} stem: anything else audible is at most spill into its microphone.`);
  if (d.kind === "tone") facts.push(`From ${at(d.at)}, the clip goes through ${TONE_LABEL[d.filter]}. Before it, untouched.`);
  if (d.kind === "gain") facts.push(d.over < 1 ? `At ${at(d.at)} the level ${d.db > 0 ? "jumps up" : "drops"} by ${Math.abs(d.db)} dB.` : `From ${at(d.at)} the level ${d.db > 0 ? "rises" : "falls"} by ${Math.abs(d.db)} dB over ${d.over} s, then stays.`);
  if (measured.steadySpreadDb !== undefined) facts.push(`Before any change, its 1-second RMS levels lie within ${measured.steadySpreadDb.toFixed(1)} dB.`);
  return facts;
}

// Signal processing on plain arrays: what makes each case's audio.

/** 1-second (or `window`) RMS levels in dB of a passage's channels summed to mono. */
export function windowRmsDb(channels: Float32Array[], sampleRate: number, window = 1): number[] {
  const size = Math.round(sampleRate * window), out: number[] = [];
  for (let at = 0; at + size <= channels[0].length; at += size) {
    let sum = 0;
    for (let i = at; i < at + size; i++) { let x = 0; for (const c of channels) x += c[i] / channels.length; sum += x * x; }
    out.push(10 * Math.log10(sum / size + 1e-20));
  }
  return out;
}
/** The start (whole seconds) of the `length`-second span whose window levels spread least, and that spread. */
export function steadiestSpan(levels: number[], length: number, from = 0): { start: number; spreadDb: number } {
  let best = { start: from, spreadDb: Infinity };
  for (let s = from; s + length <= levels.length; s++) {
    const span = levels.slice(s, s + length), spread = Math.max(...span) - Math.min(...span);
    if (spread < best.spreadDb && Math.min(...span) > -50) best = { start: s, spreadDb: spread };
  }
  if (!Number.isFinite(best.spreadDb)) throw new Error("No audible span long enough.");
  return best;
}
/** The first `length`-second span where every stem's window level stays above `floorDb`, else the one whose quietest stem is loudest. */
export function activeSpan(stemLevels: number[][], length: number, floorDb = -45): number {
  let best = { start: 0, worst: -Infinity };
  for (let s = 0; s + length <= Math.min(...stemLevels.map(l => l.length)); s++) {
    const worst = Math.min(...stemLevels.map(l => Math.min(...l.slice(s, s + length))));
    if (worst > floorDb) return s;
    if (worst > best.worst) best = { start: s, worst };
  }
  return best.start;
}

interface Biquad { b0: number; b1: number; b2: number; a1: number; a2: number }
/** Robert Bristow-Johnson's cookbook filters. */
function biquad(kind: "lowshelf" | "highshelf" | "peak" | "highpass" | "lowpass", f: number, sampleRate: number, db = 0, q = Math.SQRT1_2): Biquad {
  const A = 10 ** (db / 40), w = 2 * Math.PI * f / sampleRate, cos = Math.cos(w), alpha = Math.sin(w) / (2 * q), s = 2 * Math.sqrt(A) * alpha;
  const c = kind === "lowshelf" ? [A * ((A + 1) - (A - 1) * cos + s), 2 * A * ((A - 1) - (A + 1) * cos), A * ((A + 1) - (A - 1) * cos - s), (A + 1) + (A - 1) * cos + s, -2 * ((A - 1) + (A + 1) * cos), (A + 1) + (A - 1) * cos - s]
    : kind === "highshelf" ? [A * ((A + 1) + (A - 1) * cos + s), -2 * A * ((A - 1) + (A + 1) * cos), A * ((A + 1) + (A - 1) * cos - s), (A + 1) - (A - 1) * cos + s, 2 * ((A - 1) - (A + 1) * cos), (A + 1) - (A - 1) * cos - s]
    : kind === "peak" ? [1 + alpha * A, -2 * cos, 1 - alpha * A, 1 + alpha / A, -2 * cos, 1 - alpha / A]
    : kind === "highpass" ? [(1 + cos) / 2, -(1 + cos), (1 + cos) / 2, 1 + alpha, -2 * cos, 1 - alpha]
    : [(1 - cos) / 2, 1 - cos, (1 - cos) / 2, 1 + alpha, -2 * cos, 1 - alpha];
  return { b0: c[0] / c[3], b1: c[1] / c[3], b2: c[2] / c[3], a1: c[4] / c[3], a2: c[5] / c[3] };
}
const TONE_FILTERS: Record<ToneFilter, (rate: number) => Biquad[]> = {
  dull: r => [biquad("highshelf", 3000, r, -10)],
  bright: r => [biquad("highshelf", 4000, r, 8)],
  boomy: r => [biquad("lowshelf", 150, r, 9)],
  thin: r => [biquad("highpass", 300, r)],
  harsh: r => [biquad("peak", 3000, r, 9, 1)],
  boxy: r => [biquad("peak", 600, r, 8, 1.2)],
  telephone: r => [biquad("highpass", 300, r), biquad("highpass", 300, r), biquad("lowpass", 3000, r), biquad("lowpass", 3000, r)],
};
function filtered(samples: Float32Array, filters: Biquad[]): Float32Array {
  let x = samples;
  for (const f of filters) {
    const y = new Float32Array(x.length);
    let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
    for (let i = 0; i < x.length; i++) { const v = f.b0 * x[i] + f.b1 * x1 + f.b2 * x2 - f.a1 * y1 - f.a2 * y2; x2 = x1; x1 = x[i]; y2 = y1; y1 = v; y[i] = v; }
    x = y;
  }
  return x;
}
/** 0 before `at`, 1 after `at + over`, a straight line between (in gain, or in dB for gains). */
const ramp = (t: number, at: number, over: number) => t <= at ? 0 : t >= at + over ? 1 : (t - at) / over;
const FADE = 0.05;

/**
 * A case's audio from its source passage: `stems` (each a list of channels) for stem derivations, else `mix`.
 * The result is scaled down as a whole if it would clip (never up), so changes inside it are exactly as described.
 */
export function deriveAudio(derivation: Derivation, sampleRate: number, input: { mix?: Float32Array[]; stems?: Record<string, Float32Array[]> }): { channels: Float32Array[]; gainDb: number } {
  const need = <T>(v: T | undefined, what: string): T => { if (!v) throw new Error(`This derivation needs ${what}.`); return v; };
  let out: Float32Array[];
  if (derivation.kind === "stem-exit" || derivation.kind === "stem-entry" || (derivation.kind === "none" && input.stems && !input.mix)) {
    const stems = need(input.stems, "stems"), names = Object.keys(stems), first = stems[names[0]];
    out = first.map(c => new Float32Array(c.length));
    for (const name of names) {
      const moving = derivation.kind !== "none" && derivation.stems.includes(name);
      stems[name].forEach((c, ch) => { for (let i = 0; i < c.length; i++) {
        const g = !moving ? 1 : derivation.kind === "stem-exit" ? 1 - ramp(i / sampleRate, derivation.at, FADE) : ramp(i / sampleRate, (derivation as { at: number }).at, FADE);
        out[ch][i] += c[i] * g;
      } });
    }
  } else if (derivation.kind === "solo") {
    out = need(input.stems, "stems")[derivation.stem].map(c => Float32Array.from(c));
  } else {
    const mix = need(input.mix, "a mix");
    if (derivation.kind === "tone") {
      const filters = TONE_FILTERS[derivation.filter](sampleRate);
      out = mix.map(c => { const wet = filtered(c, filters), y = new Float32Array(c.length); for (let i = 0; i < c.length; i++) { const k = ramp(i / sampleRate, derivation.at, FADE); y[i] = c[i] * (1 - k) + wet[i] * k; } return y; });
    } else if (derivation.kind === "gain") {
      out = mix.map(c => { const y = new Float32Array(c.length); for (let i = 0; i < c.length; i++) y[i] = c[i] * 10 ** (derivation.db * ramp(i / sampleRate, derivation.at, derivation.over) / 20); return y; });
    } else out = mix.map(c => Float32Array.from(c));
  }
  let peak = 0;
  for (const c of out) for (const x of c) peak = Math.max(peak, Math.abs(x));
  const limit = 10 ** (-1 / 20), scale = peak > limit ? limit / peak : 1;
  if (scale !== 1) for (const c of out) for (let i = 0; i < c.length; i++) c[i] *= scale;
  return { channels: out, gainDb: 20 * Math.log10(scale) };
}

// The review.

/** What a reviewer reads for one arm. DSP is the local measurements; audio the provider's findings; combined both. */
export interface ArmTexts { dsp: string; audio: string; combined: string }
export interface ProviderFindings { findings: { claim: string; startSeconds: number; endSeconds: number }[]; limitations: string[] }
export interface MeasurementLike { name: string; value: number | null; unit: string; channel: string; method: { name: string } }
const MEASURE_LABEL: Record<string, string> = {
  peakDbfs: "Sample peak", rmsDbfs: "RMS level", crestDb: "Crest factor (peak to RMS)", dcOffset: "DC offset", fullScaleSampleFraction: "Samples at full scale",
  rmsWindowSpreadDb: "Level spread (50 ms windows, 90th minus 10th percentile)", lowBandRmsDbfs: "Energy below ~200 Hz", highBandRmsDbfs: "Energy above ~200 Hz",
  firstActivitySeconds: "First sound above −60 dBFS", lastActivitySeconds: "Last sound above −60 dBFS", stereoCorrelation: "Stereo correlation", sideToMidDb: "Side to mid energy",
};
export function armTexts(measurements: MeasurementLike[], heard: ProviderFindings): ArmTexts {
  const fmt = (v: number | null, unit: string) => v === null ? "undefined" : `${Math.abs(v) < 0.01 && v !== 0 ? v.toExponential(1) : v.toFixed(unit === "coefficient" || unit === "fraction" ? 3 : 1)}${unit === "dBFS" || unit === "dB" ? ` ${unit}` : unit === "seconds" ? " s" : ""}`;
  const dsp = ["Measurements of the whole clip:", ...measurements.map(m => `• ${MEASURE_LABEL[m.name] ?? m.name}${m.channel === "all" || m.channel === "mono" ? "" : ` (${m.channel})`}: ${fmt(m.value, m.unit)}`)].join("\n");
  const audio = [heard.findings.length ? "What was heard:" : "What was heard: no findings.", ...heard.findings.map(f => `• ${f.startSeconds.toFixed(1)}–${f.endSeconds.toFixed(1)} s: ${f.claim}`),
    ...(heard.limitations.length ? ["Stated limitations:", ...heard.limitations.map(l => `• ${l}`)] : [])].join("\n");
  return { dsp, audio, combined: `${dsp}\n\n${audio}` };
}

/** The order a reviewer sees a trial's arms in, labelled A, B, C: fixed per reviewer and trial, different between them. */
export function blindOrder(trialId: string, reviewer: string): HearingArm[] {
  const arms = [...HEARING_ARMS], h = hashJson([trialId, reviewer.trim().toLowerCase()]);
  for (let i = arms.length - 1; i > 0; i--) { const j = parseInt(h.slice(i * 8, i * 8 + 8), 16) % (i + 1); [arms[i], arms[j]] = [arms[j], arms[i]]; }
  return arms;
}

/** A reviewed case, as the evaluation counts it. */
export function evaluationCase(spec: CaseSpec, audioSha256: string): HearingBenchmarkCase {
  return { id: spec.id, family: spec.family, split: spec.split, task: spec.task, control: spec.control, realRecording: true, audioSha256 };
}
export function assembleEvaluation(identity: HearingEvaluation["identity"], cases: HearingBenchmarkCase[], trials: HearingTrial[], reviews: HearingReview[]): HearingEvaluation {
  return { protocol: HEARING_PROTOCOL, identity, cases, trials, reviews };
}
