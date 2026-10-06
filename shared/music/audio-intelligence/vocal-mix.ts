/**
 * Vocal mix runs: measure the vocal against its beat, propose bounded changes from what was measured (or take
 * the assistant's own), render each, measure what it did, and let the person choose. Proposals are audition
 * candidates in the effects' own units, never quality scores; keeping the mix is always one of the choices.
 */
import { faderGain } from "../compile.ts";
import { freeSlot, getMixerTrack, setEffect, updateMixerTrack } from "../mixer.ts";
import { MASTER_TRACK_ID } from "../project.ts";
import { PRO_C_PLUGIN } from "../pro-c-presets.ts";
import { updateProC } from "../pro-c.ts";
import { DEFAULT_BAND, PRO_Q_PLUGIN } from "../pro-q-presets.ts";
import { editProQ } from "../pro-q.ts";
import type { MusicProject } from "../types.ts";
import { validateRun } from "./run.ts";
import { documentHashes, snapshotContent } from "./snapshot.ts";
import type { MixRun } from "./types.ts";
import { checkVocalChange, VOCAL_LEVEL_TARGETS, type VocalAnalysis, type VocalChange, type VocalFinding, type VocalLevel } from "./vocal-analysis.ts";

export interface VocalPassage { startTick: number; endTick: number }
export interface VocalRender {
  jobId: string; analysisJobId: string | null;
  /** The song's render, and the vocal track's stem from the same pass (null until rendered, or if the vocal was silent). */
  artifactId: string | null; stemArtifactId: string | null; reportId: string | null;
  /** Playback only: what brings this render to the passage's common loudness. */
  auditionGainDb: number | null;
  integratedLufs: number | null; truePeakDbtp: number | null; peakDbfs: number | null; rmsDbfs: number | null; fullScaleFraction: number | null;
}
export interface VocalCandidate {
  /** "baseline", a measured proposal's id ("level", "shape", "both") or an assistant's ("custom1"...). */
  id: string; label: string; source: "baseline" | "measured" | "assistant"; reasons: string[];
  /** Null for the baseline. */
  change: VocalChange | null;
  snapshotId: string; renders: VocalRender[];
  /** Per passage, this candidate's vocal against the (unchanged) beat. */
  analyses: (VocalAnalysis | null)[];
  /** What it measurably did against the baseline, in words with numbers. */
  effects: string[];
  /**
   * Set when its first render moved the vocal against the beat by this much more (LU) than its fader meant to
   * (a compressor or EQ changes the level too), so it was rendered again with its fader making up the difference.
   */
  levelMatchedLu?: number;
}
export const VOCAL_STATUSES = ["preparing", "analysing", "rendering", "ready", "interrupted", "failed", "cancelled"] as const;
export interface VocalMixRun {
  schema: 2; id: string; projectId: string; goal: string; vocalTrackId: string; level: VocalLevel;
  baseSnapshotId: string; baseRevision: string; passages: VocalPassage[];
  status: typeof VOCAL_STATUSES[number];
  error: string | null; createdAt: number;
  /** The song with the vocal muted, rendered over each passage: what the vocal is measured against. */
  accompaniment: { snapshotId: string; renders: { jobId: string; artifactId: string | null }[] };
  /** The assistant's own candidates, when it gave them (else the measured proposals are rendered). */
  requested: { label: string; reasons: string[]; change: VocalChange }[] | null;
  /** Per passage, what the baseline's measurements found. */
  findings: VocalFinding[][] | null;
  /** Set when there's nothing to render: why keeping the mix is the measured answer. */
  conclusion: string | null;
  candidates: VocalCandidate[];
  /** The task's generic record (phases, budgets, candidates, evidence). */
  mixRun: MixRun;
  /** What was chosen in the end, if anything yet. */
  chosen: { candidateId: string; at: number } | null;
  /** True once the level-matching round (one revision) has been taken. */
  levelMatched: boolean;
}

/** Drift smaller than this (LU) is left: a candidate's level is then what its fader meant. */
export const LEVEL_MATCH_LU = 1;

/**
 * What a candidate's fader should be to cancel the level its other changes moved: its measured move of the vocal
 * against the beat, minus what its fader meant, taken off its fader (half-dB steps, within ±6 dB). Null when the
 * drift is under `LEVEL_MATCH_LU`, unmeasured, or the candidate is the baseline.
 */
export function levelMatch(base: (VocalAnalysis | null)[], candidate: Pick<VocalCandidate, "change" | "analyses">): { faderDb: number; driftLu: number } | null {
  if (!candidate.change) return null;
  const moved = mean(candidate.analyses.map((a, i) => a && base[i] && a.relation.medianLu !== null && base[i]!.relation.medianLu !== null ? a.relation.medianLu - base[i]!.relation.medianLu! : null));
  if (moved === null) return null;
  const meant = candidate.change.faderDb ?? 0, drift = moved - meant;
  if (Math.abs(drift) < LEVEL_MATCH_LU) return null;
  const faderDb = Math.max(-6, Math.min(6, Math.round((meant - drift) * 2) / 2));
  return faderDb === meant ? null : { faderDb, driftLu: drift };
}
export const vocalRevision = (song: MusicProject) => documentHashes(snapshotContent(song)).sha256;

/** A fader position's gain in dB (the fader is cubic: `DEFAULT_FADER` is 0 dB, the top about +5.8). */
export const faderDbOf = (volume: number) => 20 * Math.log10(faderGain(volume));
/** The fader position `db` away from `volume`. */
export const faderMoved = (volume: number, db: number) => volume * 10 ** (db / 60);

export function checkVocalTarget(song: MusicProject, trackId: string) {
  const track = getMixerTrack(song, trackId);
  if (!track || trackId === MASTER_TRACK_ID) throw new Error("Choose a dedicated vocal insert, not the master.");
  if (track.muted || track.solo || song.mixer.tracks.some(t => t.solo)) throw new Error("Unmute the vocal and clear mixer solos before comparing the full mix.");
  if (!song.channels.some(c => c.mixerTrack === trackId) && !song.playlist.tracks.some(t => t.mixerTrack === trackId)) throw new Error("Route the vocal to this mixer insert first.");
  if (track.volume <= 0) throw new Error("The vocal fader is silent.");
  if (song.automations.some(a => a.target.kind === "mixer" && a.target.track === trackId && a.target.control === "volume") ||
      song.modulators.some(m => m.links.some(l => l.target.kind === "mixer" && l.target.track === trackId && l.target.control === "volume"))) {
    throw new Error("This vocal workflow cannot change an automated/modulated vocal fader.");
  }
}

/** The song with `change` on the vocal's track: its fader moved, a compressor and an EQ in free slots (ids from `prefix`). */
export function applyVocalChange(song: MusicProject, trackId: string, change: VocalChange, prefix: string): MusicProject {
  checkVocalTarget(song, trackId);
  const track = getMixerTrack(song, trackId)!;
  const slots = (change.compressor ? 1 : 0) + (change.eq?.length ? 1 : 0);
  if (track.effects.filter(e => !e).length < slots) throw new Error(`The vocal insert needs ${slots} empty effect slot${slots > 1 ? "s" : ""} for this change.`);
  let next = song;
  if (change.faderDb) {
    const volume = faderMoved(track.volume, change.faderDb);
    if (volume > 1 + 1e-9) throw new Error(`The vocal fader has no room for +${change.faderDb} dB (it would pass the top). Lower its input level first.`);
    next = updateMixerTrack(next, trackId, { volume: Math.min(1, volume) });
  }
  if (change.compressor) {
    const c = change.compressor, id = `${prefix}_comp`;
    next = setEffect(next, trackId, freeSlot(next, trackId)!, PRO_C_PLUGIN, id);
    next = updateProC(next, id, { style: "clean", threshold: c.threshold, slope: 1 - 1 / c.ratio, knee: c.knee, attack: c.attack, release: c.release, range: c.range, wet: c.makeup ?? 0, autoGain: false, autoRelease: false, mix: 1 });
  }
  if (change.eq?.length) {
    const id = `${prefix}_eq`;
    next = setEffect(next, trackId, freeSlot(next, trackId)!, PRO_Q_PLUGIN, id);
    next = editProQ(next, id, pq => ({ ...pq, autoGain: false, bands: change.eq!.map((b, i) => ({ ...DEFAULT_BAND, id: i + 1, shape: b.shape, frequency: b.frequency, gain: b.gain, q: b.q,
      ...(b.shape === "lowCut" ? { slope: b.slope ?? 12 } : {}), dynamics: !!b.range, range: b.range ?? 0, threshold: b.threshold ?? null })) }));
  }
  return next;
}

/** A candidate's song: the baseline's, or with its change. */
export const candidateSong = (song: MusicProject, run: Pick<VocalMixRun, "id" | "vocalTrackId">, candidate: Pick<VocalCandidate, "id" | "change">) =>
  candidate.change ? applyVocalChange(song, run.vocalTrackId, candidate.change, `fx_${run.id}_${candidate.id}`) : song;

/** One pure patch, committed by the live editor as one undo step. Never replaces a stale song. */
export function acceptVocalCandidate(song: MusicProject, run: VocalMixRun, candidateId: string): MusicProject {
  if (run.status !== "ready") throw new Error("Finish rendering and measuring both passages before applying an alternative.");
  if (vocalRevision(song) !== run.baseRevision) throw new Error("The song changed since this comparison. Start a fresh comparison before applying.");
  const candidate = run.candidates.find(c => c.id === candidateId);
  if (!candidate) throw new Error(`No candidate "${candidateId}" in this run: choose one of ${run.candidates.map(c => c.id).join(", ")}.`);
  if (candidate.renders.length !== 2 || candidate.renders.some(r => r.reportId === null || r.auditionGainDb === null)) throw new Error("Both passage reports are required.");
  if (candidate.change && candidate.renders.some(r => r.fullScaleFraction === null || r.fullScaleFraction > 0 || r.truePeakDbtp === null || r.truePeakDbtp >= 0)) {
    throw new Error("This alternative has insufficient measured headroom (its true peak reaches 0 dBTP). Keep the baseline or make a fresh comparison at lower levels.");
  }
  return candidateSong(song, run, candidate);
}

const mean = (values: (number | null | undefined)[]) => { const v = values.filter((x): x is number => typeof x === "number" && Number.isFinite(x)); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; };

/** What a candidate measurably did against the baseline, averaged over the passages: words with numbers, never a verdict. */
export function candidateEffects(base: (VocalAnalysis | null)[], next: (VocalAnalysis | null)[], level: VocalLevel): string[] {
  const lines: string[] = [];
  const pair = (pick: (a: VocalAnalysis) => number | null) => [mean(base.map(a => a && pick(a))), mean(next.map(a => a && pick(a)))] as const;
  // `signed`: a level or a difference (+/-); else a share, shown as a percentage of `of`.
  const show = (label: string, [b, n]: readonly [number | null, number | null], unit: string, { digits = 1, always = false, scale = 1, signed = true, of = "" } = {}) => {
    if (b === null || n === null || (!always && Math.abs(n - b) * scale < 0.3)) return;
    const f = (v: number) => `${signed && v > 0 ? "+" : ""}${(v * scale).toFixed(digits)}`;
    lines.push(`${label}: ${f(b)} → ${f(n)}${unit === "%" ? "%" : ` ${unit}`}${of}`);
  };
  show(`Vocal against the beat (median while singing; ${level} is ${VOCAL_LEVEL_TARGETS[level]} LU)`, pair(a => a.relation.medianLu), "LU", { always: true, signed: false });
  show("Beat over the vocal at 1–4 kHz", pair(a => a.masking.maskedFraction), "%", { digits: 0, scale: 100, signed: false, of: " of sung frames" });
  show("Phrase spread", pair(a => a.vocal.phraseSpreadLu), "LU");
  show("Low mids over mids", pair(a => a.shape.mudDb), "dB");
  show("Upper mids over mids", pair(a => a.shape.harshDb), "dB");
  show("Sibilant frames", pair(a => a.shape.sibilantFraction), "%", { digits: 0, scale: 100, signed: false, of: " of sung frames" });
  show("Energy under 80 Hz", pair(a => a.shape.rumbleDb), "dB", { signed: false });
  show("Mix loudness", pair(a => a.mix.integratedLufs), "LUFS", { always: true, signed: false });
  show("Mix true peak", pair(a => a.mix.truePeakDbtp), "dBTP", { always: true, signed: false });
  return lines;
}

/** Playback gains per passage: every render brought to the quietest's loudness, and never past -1 dBTP. */
export function auditionGains(rows: Pick<VocalRender, "integratedLufs" | "truePeakDbtp">[]): (number | null)[] {
  if (rows.some(r => r.integratedLufs === null || r.truePeakDbtp === null)) return rows.map(() => null);
  const target = Math.min(...rows.map(r => r.integratedLufs! - Math.max(0, r.truePeakDbtp! + 1)));
  return rows.map(r => target - r.integratedLufs!);
}

/** A persisted run checked for shape (the server then checks its snapshots against the song). */
export function validateVocalMixRun(input: unknown, id: string, projectId: string): VocalMixRun {
  const fail = (what: string): never => { throw new Error(`Invalid persisted vocal comparison: ${what}.`); };
  const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
  const str = (v: unknown) => typeof v === "string";
  const numOrNull = (v: unknown) => v === null || typeof v === "number" && Number.isFinite(v);
  if (!object(input)) fail("not an object");
  const o = input as Record<string, unknown>;
  if (o.schema !== 2) fail("made by an earlier version");
  if (o.id !== id || o.projectId !== projectId || ![o.goal, o.vocalTrackId, o.baseSnapshotId, o.baseRevision].every(str)) fail("identity");
  if (!(o.level as string in VOCAL_LEVEL_TARGETS)) fail("level");
  if (!Array.isArray(o.passages) || o.passages.length !== 2 || !o.passages.every(p => object(p) && Number.isSafeInteger(p.startTick) && Number.isSafeInteger(p.endTick) && Number(p.endTick) > Number(p.startTick))) fail("passages");
  if (!VOCAL_STATUSES.includes(o.status as typeof VOCAL_STATUSES[number]) || !(o.error === null || str(o.error)) || typeof o.createdAt !== "number") fail("status");
  const acc = o.accompaniment;
  if (!object(acc) || !str(acc.snapshotId) || !Array.isArray(acc.renders) || !acc.renders.every(r => object(r) && str(r.jobId) && (r.artifactId === null || str(r.artifactId)))) fail("accompaniment");
  if (o.requested !== null && (!Array.isArray(o.requested) || !o.requested.every(r => object(r) && str(r.label) && Array.isArray(r.reasons)))) fail("requested");
  if (Array.isArray(o.requested)) for (const r of o.requested as { change: unknown }[]) checkVocalChange(r.change);
  if (!(o.conclusion === null || str(o.conclusion)) || !(o.findings === null || Array.isArray(o.findings))) fail("findings");
  if (!Array.isArray(o.candidates) || !o.candidates.every(c => object(c) && str(c.id) && str(c.label) && ["baseline", "measured", "assistant"].includes(String(c.source)) && str(c.snapshotId) &&
      Array.isArray(c.reasons) && Array.isArray(c.effects) && Array.isArray(c.analyses) && Array.isArray(c.renders) && c.renders.length <= 2 &&
      c.renders.every(r => object(r) && str(r.jobId) && [r.analysisJobId, r.artifactId, r.stemArtifactId, r.reportId].every(v => v === null || str(v)) &&
        [r.auditionGainDb, r.integratedLufs, r.truePeakDbtp, r.peakDbfs, r.rmsDbfs, r.fullScaleFraction].every(numOrNull)))) fail("candidates");
  for (const c of o.candidates as { source: string; change: unknown }[]) if (c.source !== "baseline") checkVocalChange(c.change); else if (c.change !== null) fail("baseline change");
  const mixRun = validateRun(o.mixRun);
  if (!mixRun.ok) fail("mix run");
  if (!(o.chosen === null || object(o.chosen) && str(o.chosen.candidateId) && typeof o.chosen.at === "number")) fail("chosen");
  if (typeof o.levelMatched !== "boolean" || !(o.candidates as { levelMatchedLu?: unknown }[]).every(c => c.levelMatchedLu === undefined || typeof c.levelMatchedLu === "number")) fail("level matching");
  return o as unknown as VocalMixRun;
}
