/**
 * A vocal measured against its accompaniment: where it sits (loudness, how often the beat covers its
 * presence range), how even it is, and where its own energy is (mud, rumble, harshness, sibilance). Then
 * what a mix engineer would try first, as bounded changes in the effects' own units, each with the
 * measured reason for it. Pure. Thresholds are stated starting points, never findings about taste: every
 * proposal is rendered and measured again, and the person listening decides.
 */
import { CHUNK_SECONDS, integratedLoudness, loudnessChunks, loudnessRange, lufs, truePeak, windowEnergies } from "./loudness.ts";
import { bandBalance, bandFrames, mono, type BandBalance } from "./spectrum.ts";

export const VOCAL_ANALYSIS_METHOD = { name: "vocal-vs-accompaniment", version: "1" } as const;

/** How far under the accompaniment the vocal is aimed (LU, vocal minus beat): a preference, not a standard. */
export const VOCAL_LEVEL_TARGETS = { forward: -1, balanced: -3, blended: -6 } as const;
export type VocalLevel = keyof typeof VOCAL_LEVEL_TARGETS;

/** The starting points findings are tested against, each named where it's used and reported with it. */
export const VOCAL_THRESHOLDS = {
  /** Fader moves smaller than this aren't proposed (LU). */
  levelTolerance: 1.5,
  /** The beat covers the vocal's 1–4 kHz when it's this much louder there (dB)... */
  maskingDb: 6,
  /** ...in at least this share of the vocal's sounding frames. */
  maskedFraction: 0.3,
  /** Phrase-to-phrase spread (momentary loudness, P90 − P10 while singing) that suggests compression (LU). */
  spreadLu: 9,
  /** Low mids (250–500 Hz) above the mids (500 Hz–2 kHz), each against pink noise (dB). */
  mudDb: 4,
  /** Energy under 80 Hz as a share of the vocal's (dB): rumble and plosives. */
  rumbleDb: -25,
  /** Upper mids (2–4 kHz) above the mids, each against pink noise (dB). */
  harshDb: 5,
  /** Frames whose 5–9 kHz is louder than their 1–4 kHz: sibilant... */
  sibilantFraction: 0.08,
} as const;

export interface VocalAnalysis {
  method: typeof VOCAL_ANALYSIS_METHOD;
  seconds: number;
  vocal: { integratedLufs: number | null; truePeakDbtp: number | null; loudnessRangeLu: number | null; activeFraction: number; phraseSpreadLu: number | null; balance: BandBalance[] };
  accompaniment: { integratedLufs: number | null };
  mix: { integratedLufs: number | null; truePeakDbtp: number | null; loudnessRangeLu: number | null };
  /** Vocal minus accompaniment, LU: integrated, and per second while the vocal sounds (median and spread). */
  relation: { integratedLu: number | null; medianLu: number | null; p10Lu: number | null; p90Lu: number | null; seconds: { start: number; lu: number }[] };
  /** The beat against the vocal between 1 and 4 kHz while it sounds: median dB (+ is the beat louder) and the share of frames over `maskingDb`. */
  masking: { medianDb: number | null; maskedFraction: number | null };
  /** Spectral shape of the vocal while it sounds. */
  shape: { mudDb: number | null; rumbleDb: number | null; harshDb: number | null; sibilantFraction: number | null; mudHz: number | null; harshHz: number | null; sibilanceHz: number | null };
  /** For a compressor's threshold: the vocal's loud 50 ms RMS and peaks (P90 while it sounds, dBFS, after its fader). */
  loudRmsDbfs: number | null;
  loudPeakDbfs: number | null;
  /** For a de-esser's threshold: the usual level (median while it sounds, 10 ms RMS, dBFS, after its fader) around `shape.sibilanceHz`. */
  sibilanceLevelDbfs: number | null;
  /**
   * When the vocal sounds, as "1"/"0" per 100 ms chunk and per spectrum frame. A candidate is measured over the
   * baseline's (the singing's timing doesn't change), or compression, lowering the vocal, would let its breaths in.
   */
  sounding: { chunks: string; frames: string };
}

const finite = (v: number) => Number.isFinite(v) ? v : null;
const percentile = (values: number[], p: number) => { if (!values.length) return null; const s = [...values].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.max(0, Math.round(p * (s.length - 1))))]; };
const db = (p: number) => p > 0 ? 10 * Math.log10(p) : -Infinity;

/** Bins' power summed between two frequencies. */
function binSum(bins: Float64Array, binHz: number, low: number, high: number) {
  let s = 0;
  for (let k = Math.max(1, Math.round(low / binHz)); k < Math.min(bins.length, Math.round(high / binHz)); k++) s += bins[k];
  return s;
}
/** The frequency in a range where frames' summed power peaks (smoothed over a third of an octave). */
function peakHz(bins: Float64Array[], active: boolean[], binHz: number, low: number, high: number): number | null {
  const sum = new Float64Array(bins[0]?.length ?? 0);
  bins.forEach((b, f) => { if (active[f]) for (let k = 0; k < b.length; k++) sum[k] += b[k]; });
  let best = -1, at: number | null = null;
  for (let hz = low; hz <= high; hz *= 2 ** (1 / 12)) {
    const p = binSum(sum, binHz, hz / 2 ** (1 / 6), hz * 2 ** (1 / 6));
    if (p > best) { best = p; at = Math.round(hz); }
  }
  return best > 0 ? at : null;
}

/**
 * The analysis of one passage: `vocal` (the vocal's track, after its fader), `accompaniment` (the song with
 * the vocal muted) and `mix` (the song), all the same length and rate, lead-in and tails already cut.
 */
export function analyseVocal(vocal: Float32Array[], accompaniment: Float32Array[], mix: Float32Array[], sampleRate: number, reference?: VocalAnalysis["sounding"]): VocalAnalysis {
  const seconds = vocal[0].length / sampleRate;
  const vc = loudnessChunks(vocal, sampleRate), ac = loudnessChunks(accompaniment, sampleRate), mc = loudnessChunks(mix, sampleRate);
  const vocalLufs = integratedLoudness(vc), accLufs = integratedLoudness(ac);
  // Sounding: a chunk within 20 LU of the vocal's integrated loudness (and above -60).
  const sounding = reference ? [...vc].map((_, i) => reference.chunks[i] === "1") : [...vc].map(e => vocalLufs !== null && lufs(e) > Math.max(-60, vocalLufs - 20));
  const activeFraction = sounding.length ? sounding.filter(Boolean).length / sounding.length : 0;
  // Per second: vocal minus beat, where the vocal sounds for at least half of it.
  const per = Math.round(1 / CHUNK_SECONDS), secondsRows: { start: number; lu: number }[] = [];
  for (let s = 0; (s + 1) * per <= vc.length; s++) {
    let ve = 0, ae = 0, on = 0;
    for (let c = s * per; c < (s + 1) * per; c++) { ve += vc[c]; ae += ac[c]; if (sounding[c]) on++; }
    if (on >= per / 2 && ae > 0) secondsRows.push({ start: s, lu: lufs(ve / per) - lufs(ae / per) });
  }
  // Phrase spread: momentary loudness (400 ms) while singing.
  const momentary = [...windowEnergies(vc, 0.4, 0.1)].map((e, i) => sounding[i] && sounding[Math.min(sounding.length - 1, i + 3)] ? lufs(e) : NaN).filter(Number.isFinite);
  const p90m = percentile(momentary, 0.9), p10m = percentile(momentary, 0.1);
  // Frames: the vocal's shape and the beat over its presence range.
  const vf = bandFrames(mono(vocal), sampleRate), af = bandFrames(mono(accompaniment), sampleRate);
  const framePower = vf.bins.map(b => b.reduce((a, x) => a + x, 0)), loud = percentile(framePower, 0.9) ?? 0;
  const active = reference ? framePower.map((_, f) => reference.frames[f] === "1") : framePower.map(p => p > 0 && db(p) > db(loud) - 25);
  const masking: number[] = [], sibilant: boolean[] = [];
  vf.bins.forEach((b, f) => {
    if (!active[f]) return;
    const presence = binSum(b, vf.binHz, 1000, 4000), beat = af.bins[f] ? binSum(af.bins[f], af.binHz, 1000, 4000) : 0;
    if (presence > 0 && beat > 0) masking.push(db(beat) - db(presence));
    sibilant.push(binSum(b, vf.binHz, 5000, 9000) > presence);
  });
  const balance = bandBalance(vf, sampleRate, active), rel = (id: string) => balance.find(x => x.band === id)!.relativeToPinkDb;
  let total = 0, under80 = 0;
  vf.bins.forEach((b, f) => { if (active[f]) { total += b.reduce((a, x) => a + x, 0); under80 += binSum(b, vf.binHz, 20, 80); } });
  // The loud 50 ms RMS and peaks (the louder channel), for a compressor's threshold.
  const size = Math.round(sampleRate * 0.05), rms: number[] = [], peaks: number[] = [];
  for (let at = 0; at + size <= vocal[0].length; at += size) {
    let best = 0, peak = 0;
    for (const c of vocal) { let s = 0; for (let i = at; i < at + size; i++) { s += c[i] * c[i]; peak = Math.max(peak, Math.abs(c[i])); } best = Math.max(best, s / size); }
    const chunk = Math.floor(at / sampleRate / CHUNK_SECONDS);
    if (sounding[chunk]) { rms.push(10 * Math.log10(best || 1e-20)); peaks.push(20 * Math.log10(peak || 1e-10)); }
  }
  // The sibilance band's usual level: a band-pass (Q 2) at its peak, 10 ms windows while singing.
  const sibilanceHz = peakHz(vf.bins, active, vf.binHz, 5000, 9000);
  let sibilanceLevel: number | null = null;
  if (sibilanceHz) {
    const w = 2 * Math.PI * sibilanceHz / sampleRate, alpha = Math.sin(w) / 4, a0 = 1 + alpha;
    const b0 = alpha / a0, b2 = -alpha / a0, a1 = -2 * Math.cos(w) / a0, a2 = (1 - alpha) / a0;
    const x = mono(vocal), win = Math.round(sampleRate * 0.01), levels: number[] = [];
    let x1 = 0, x2 = 0, y1 = 0, y2 = 0, sum = 0;
    for (let i = 0; i < x.length; i++) {
      const y = b0 * x[i] + b2 * x2 - a1 * y1 - a2 * y2;
      x2 = x1; x1 = x[i]; y2 = y1; y1 = y; sum += y * y;
      if ((i + 1) % win === 0) { if (sounding[Math.floor(i / sampleRate / CHUNK_SECONDS)] && sum > 0) levels.push(10 * Math.log10(sum / win)); sum = 0; }
    }
    sibilanceLevel = percentile(levels, 0.5);
  }
  const vocalPeak = truePeak(vocal, sampleRate), mixPeak = truePeak(mix, sampleRate);
  return {
    method: VOCAL_ANALYSIS_METHOD, seconds,
    vocal: { integratedLufs: vocalLufs, truePeakDbtp: vocalPeak > 0 ? 20 * Math.log10(vocalPeak) : null, loudnessRangeLu: loudnessRange(vc), activeFraction, phraseSpreadLu: p90m !== null && p10m !== null ? p90m - p10m : null, balance },
    accompaniment: { integratedLufs: accLufs },
    mix: { integratedLufs: integratedLoudness(mc), truePeakDbtp: mixPeak > 0 ? 20 * Math.log10(mixPeak) : null, loudnessRangeLu: loudnessRange(mc) },
    relation: { integratedLu: vocalLufs !== null && accLufs !== null ? vocalLufs - accLufs : null, medianLu: percentile(secondsRows.map(r => r.lu), 0.5), p10Lu: percentile(secondsRows.map(r => r.lu), 0.1), p90Lu: percentile(secondsRows.map(r => r.lu), 0.9), seconds: secondsRows },
    masking: { medianDb: percentile(masking, 0.5), maskedFraction: masking.length ? masking.filter(m => m >= VOCAL_THRESHOLDS.maskingDb).length / masking.length : null },
    shape: {
      mudDb: finite(rel("lowMid") - rel("mid")), rumbleDb: total > 0 ? finite(db(under80 / total)) : null, harshDb: finite(rel("upperMid") - rel("mid")),
      sibilantFraction: sibilant.length ? sibilant.filter(Boolean).length / sibilant.length : null,
      mudHz: peakHz(vf.bins, active, vf.binHz, 200, 500), harshHz: peakHz(vf.bins, active, vf.binHz, 2000, 5000), sibilanceHz,
    },
    loudRmsDbfs: percentile(rms, 0.9), loudPeakDbfs: percentile(peaks, 0.9), sibilanceLevelDbfs: sibilanceLevel,
    sounding: { chunks: sounding.map(x => x ? "1" : "0").join(""), frames: active.map(x => x ? "1" : "0").join("") },
  };
}

// What to try: findings, then bounded changes in the effects' own units.

export type FindingKind = "level" | "masking" | "dynamics" | "mud" | "rumble" | "harsh" | "sibilance";
export interface VocalFinding { kind: FindingKind; text: string; value: number; threshold: number }

/** A vocal's change, as the run renders and applies it: the fader, one compressor, one EQ. Every field optional. */
export interface VocalChange {
  /** dB on the vocal's fader. */
  faderDb?: number;
  /** YT-C (Pro-C) in a free slot. Times in seconds; `makeup` is its wet gain (dB). */
  compressor?: { threshold: number; ratio: number; attack: number; release: number; knee: number; range: number; makeup?: number };
  /**
   * YT-EQ (Pro-Q) in a free slot: up to four bands. A dynamic band (range ≠ 0) cuts only when that range is loud,
   * from `threshold` (dBFS of the band, before the fader; absent: Auto, 4 dB over its long average).
   */
  eq?: { shape: "bell" | "lowCut" | "highShelf" | "lowShelf"; frequency: number; gain: number; q: number; slope?: 12 | 18 | 24; range?: number; threshold?: number }[];
}
export interface VocalProposal { id: string; label: string; reasons: string[]; change: VocalChange }

/** What each finding means for one passage, when it passes its starting point. */
export function vocalFindings(a: VocalAnalysis, level: VocalLevel = "balanced"): VocalFinding[] {
  const t = VOCAL_THRESHOLDS, out: VocalFinding[] = [];
  const target = VOCAL_LEVEL_TARGETS[level], median = a.relation.medianLu;
  if (median !== null && Math.abs(median - target) >= t.levelTolerance) out.push({ kind: "level", value: median, threshold: target,
    text: `The vocal sits ${Math.abs(median).toFixed(1)} LU ${median < 0 ? "under" : "over"} the beat (median while singing); a ${level} vocal is aimed at ${target} LU.` });
  if (a.masking.maskedFraction !== null && a.masking.maskedFraction >= t.maskedFraction) out.push({ kind: "masking", value: a.masking.maskedFraction, threshold: t.maskedFraction,
    text: `The beat is ${t.maskingDb} dB or more over the vocal between 1 and 4 kHz in ${Math.round(a.masking.maskedFraction * 100)}% of its sung frames.` });
  if (a.vocal.phraseSpreadLu !== null && a.vocal.phraseSpreadLu >= t.spreadLu) out.push({ kind: "dynamics", value: a.vocal.phraseSpreadLu, threshold: t.spreadLu,
    text: `Its phrases vary by ${a.vocal.phraseSpreadLu.toFixed(1)} LU (momentary loudness, 90th minus 10th percentile while singing).` });
  if (a.shape.mudDb !== null && a.shape.mudDb >= t.mudDb) out.push({ kind: "mud", value: a.shape.mudDb, threshold: t.mudDb,
    text: `Its low mids (250–500 Hz) are ${a.shape.mudDb.toFixed(1)} dB over its mids, against pink noise${a.shape.mudHz ? `, most around ${a.shape.mudHz} Hz` : ""}.` });
  if (a.shape.rumbleDb !== null && a.shape.rumbleDb >= t.rumbleDb) out.push({ kind: "rumble", value: a.shape.rumbleDb, threshold: t.rumbleDb,
    text: `${(10 ** (a.shape.rumbleDb / 10) * 100).toFixed(1)}% of its energy is under 80 Hz (rumble, plosives).` });
  if (a.shape.harshDb !== null && a.shape.harshDb >= t.harshDb) out.push({ kind: "harsh", value: a.shape.harshDb, threshold: t.harshDb,
    text: `Its upper mids (2–4 kHz) are ${a.shape.harshDb.toFixed(1)} dB over its mids, against pink noise${a.shape.harshHz ? `, most around ${(a.shape.harshHz / 1000).toFixed(1)} kHz` : ""}.` });
  if (a.shape.sibilantFraction !== null && a.shape.sibilantFraction >= t.sibilantFraction) out.push({ kind: "sibilance", value: a.shape.sibilantFraction, threshold: t.sibilantFraction,
    text: `${Math.round(a.shape.sibilantFraction * 100)}% of its sung frames have more 5–9 kHz than 1–4 kHz (sibilant)${a.shape.sibilanceHz ? `, most around ${(a.shape.sibilanceHz / 1000).toFixed(1)} kHz` : ""}.` });
  return out;
}

const round = (v: number, step: number) => Math.round(v / step) * step;

/**
 * Up to three proposals from both passages' findings (a finding counts when both show it, so one odd
 * passage doesn't steer the mix): the level alone, the tone and dynamics fixes alone, and both. None
 * when nothing passes its starting point: keeping the mix is then the measured answer.
 */
export function proposeVocalChanges(passages: VocalAnalysis[], faderDb: number, level: VocalLevel = "balanced"): { findings: VocalFinding[][]; proposals: VocalProposal[] } {
  const findings = passages.map(p => vocalFindings(p, level));
  const both = (kind: FindingKind) => findings.every(list => list.some(f => f.kind === kind)) ? findings.map(list => list.find(f => f.kind === kind)!) : null;
  const mean = (values: (number | null)[]) => { const v = values.filter((x): x is number => x !== null); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; };
  const reasons: string[] = [], fixes: VocalChange = {}, eq: NonNullable<VocalChange["eq"]> = [];
  const levelFinding = both("level");
  const levelDb = levelFinding ? Math.max(-6, Math.min(6, round(VOCAL_LEVEL_TARGETS[level] - mean(levelFinding.map(f => f.value))!, 0.5))) : 0;
  const dynamics = both("dynamics");
  if (dynamics) {
    // A compressor's detector follows peaks, and it sits before the fader: 6 dB under the loud words' peaks
    // without the fader takes about 4 dB off them at 3:1; 2 dB of make-up gives back some of the level.
    const loud = mean(passages.map(p => p.loudPeakDbfs));
    const threshold = loud === null ? -24 : Math.max(-50, Math.min(-6, round(loud - faderDb - 6, 0.5)));
    fixes.compressor = { threshold, ratio: 3, attack: 0.01, release: 0.15, knee: 6, range: 12, makeup: 2 };
    reasons.push(`Uneven phrases (${dynamics.map(f => f.value.toFixed(1)).join(" and ")} LU): 3:1 compression from ${threshold} dBFS (6 dB under the loud words' peaks), 10 ms attack, 150 ms release, at most 12 dB, 2 dB make-up.`);
  }
  if (both("rumble")) { eq.push({ shape: "lowCut", frequency: 80, gain: 0, q: 0.7, slope: 12 }); reasons.push("Energy under 80 Hz: a 12 dB/octave low cut at 80 Hz."); }
  const mud = both("mud");
  if (mud) {
    const hz = Math.round(mean(passages.map(p => p.shape.mudHz)) ?? 300);
    eq.push({ shape: "bell", frequency: hz, gain: -3, q: 1.2 }); reasons.push(`Low-mid build-up (${mud.map(f => f.value.toFixed(1)).join(" and ")} dB): −3 dB around ${hz} Hz.`);
  }
  const harsh = both("harsh");
  if (harsh) {
    const hz = Math.round(mean(passages.map(p => p.shape.harshHz)) ?? 3000);
    eq.push({ shape: "bell", frequency: hz, gain: -2.5, q: 2 }); reasons.push(`Upper-mid edge (${harsh.map(f => f.value.toFixed(1)).join(" and ")} dB): −2.5 dB around ${(hz / 1000).toFixed(1)} kHz.`);
  } else if (both("masking")) {
    eq.push({ shape: "bell", frequency: 3000, gain: 2, q: 0.8 }); reasons.push(`Covered by the beat at 1–4 kHz (${both("masking")!.map(f => `${Math.round(f.value * 100)}%`).join(" and ")} of sung frames): +2 dB of presence around 3 kHz.`);
  }
  const sibilance = both("sibilance");
  if (sibilance) {
    const hz = Math.round(mean(passages.map(p => p.shape.sibilanceHz)) ?? 7000), level = mean(passages.map(p => p.sibilanceLevelDbfs));
    // From the band's usual level (before the fader), so the esses, well over it, are what's cut.
    const threshold = level === null ? undefined : Math.max(-60, Math.min(0, round(level - faderDb, 0.5)));
    eq.push({ shape: "bell", frequency: hz, gain: 0, q: 2, range: -6, ...(threshold !== undefined ? { threshold } : {}) });
    reasons.push(`Sibilance (${sibilance.map(f => `${Math.round(f.value * 100)}%`).join(" and ")} of sung frames): a dynamic band at ${(hz / 1000).toFixed(1)} kHz that cuts up to 6 dB only on the esses${threshold !== undefined ? `, from ${threshold} dBFS (the band's usual level)` : ""}.`);
  }
  if (eq.length) fixes.eq = eq.slice(0, 4);
  const proposals: VocalProposal[] = [];
  const levelReason = levelFinding ? `The vocal sits ${levelFinding.map(f => `${f.value.toFixed(1)}`).join(" and ")} LU against the beat; a ${level} vocal is aimed at ${VOCAL_LEVEL_TARGETS[level]} LU: ${levelDb > 0 ? "+" : ""}${levelDb} dB on its fader.` : "";
  if (levelDb) proposals.push({ id: "level", label: "Vocal level", reasons: [levelReason], change: { faderDb: levelDb } });
  if (fixes.compressor || fixes.eq) proposals.push({ id: "shape", label: "Vocal tone & dynamics", reasons, change: fixes });
  if (levelDb && (fixes.compressor || fixes.eq)) proposals.push({ id: "both", label: "Level + tone & dynamics", reasons: [levelReason, ...reasons], change: { ...fixes, faderDb: levelDb } });
  return { findings, proposals };
}

/** A change's own units checked (a model's proposal included): what the run may render and apply. */
export function checkVocalChange(input: unknown): VocalChange {
  const fail = (message: string): never => { throw new Error(`Invalid vocal change: ${message}`); };
  const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
  const num = (v: unknown, name: string, min: number, max: number) => { if (typeof v !== "number" || !Number.isFinite(v) || v < min || v > max) fail(`${name} must be ${min} to ${max}.`); return v as number; };
  if (!object(input)) fail("expected an object with faderDb, compressor and/or eq.");
  const o = input as Record<string, unknown>, out: VocalChange = {};
  if (o.faderDb !== undefined) out.faderDb = num(o.faderDb, "faderDb (dB)", -6, 6);
  if (o.compressor !== undefined && o.compressor !== null) {
    if (!object(o.compressor)) fail("compressor must be an object.");
    const c = o.compressor as Record<string, unknown>;
    out.compressor = { threshold: num(c.threshold, "compressor.threshold (dBFS)", -50, 0), ratio: num(c.ratio, "compressor.ratio", 1.2, 8), attack: num(c.attack, "compressor.attack (s)", 0.0005, 0.08),
      release: num(c.release, "compressor.release (s)", 0.02, 1), knee: num(c.knee ?? 6, "compressor.knee (dB)", 0, 24), range: num(c.range ?? 12, "compressor.range (dB)", 3, 24),
      ...(c.makeup !== undefined ? { makeup: num(c.makeup, "compressor.makeup (dB)", 0, 12) } : {}) };
  }
  if (o.eq !== undefined && o.eq !== null) {
    if (!Array.isArray(o.eq) || o.eq.length > 4) fail("eq is at most four bands.");
    out.eq = (o.eq as unknown[]).map((b, i) => {
      if (!object(b)) fail(`eq[${i}] must be an object.`);
      const x = b as Record<string, unknown>;
      if (!["bell", "lowCut", "highShelf", "lowShelf"].includes(String(x.shape))) fail(`eq[${i}].shape is bell, lowCut, highShelf or lowShelf.`);
      const shape = x.shape as "bell" | "lowCut" | "highShelf" | "lowShelf";
      const band: NonNullable<VocalChange["eq"]>[number] = { shape, frequency: num(x.frequency, `eq[${i}].frequency (Hz)`, 20, 20000), gain: shape === "lowCut" ? 0 : num(x.gain ?? 0, `eq[${i}].gain (dB)`, -9, 6), q: num(x.q ?? 1, `eq[${i}].q`, 0.3, 6) };
      if (shape === "lowCut") { const slope = x.slope ?? 12; if (![12, 18, 24].includes(slope as number)) fail(`eq[${i}].slope is 12, 18 or 24.`); band.slope = slope as 12 | 18 | 24; if (band.frequency > 300) fail(`eq[${i}]: a vocal's low cut is at most 300 Hz.`); }
      if (x.range !== undefined && x.range !== 0) { if (shape !== "bell") fail(`eq[${i}]: only a bell can be dynamic.`); band.range = num(x.range, `eq[${i}].range (dB)`, -12, -1); }
      if (x.threshold !== undefined && x.threshold !== null) { if (!band.range) fail(`eq[${i}]: a threshold needs a range (a dynamic band).`); band.threshold = num(x.threshold, `eq[${i}].threshold (dBFS)`, -60, 0); }
      return band;
    });
  }
  if (out.faderDb === undefined && !out.compressor && !out.eq?.length) fail("it changes nothing: give faderDb, a compressor or eq bands.");
  return out;
}
