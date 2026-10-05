/** Bounded vocal alternatives. These are audition proposals, never quality scores. */
import { freeSlot, getMixerTrack, setEffect, updateMixerTrack } from "../mixer.ts";
import { MASTER_TRACK_ID } from "../project.ts";
import { PRO_C_PLUGIN } from "../pro-c-presets.ts";
import { updateProC } from "../pro-c.ts";
import { DEFAULT_BAND, PRO_Q_PLUGIN } from "../pro-q-presets.ts";
import { editProQ } from "../pro-q.ts";
import type { MusicProject } from "../types.ts";
import { documentHashes, snapshotContent } from "./snapshot.ts";

export const VOCAL_VARIANTS = ["baseline", "lift", "steady", "presence"] as const;
export type VocalVariant = typeof VOCAL_VARIANTS[number];
export const VOCAL_LABELS: Record<VocalVariant, string> = {
  baseline: "Keep current mix", lift: "Vocal +2 dB", steady: "Gentle vocal compression", presence: "Gentle compression + presence EQ",
};
export const VOCAL_DESCRIPTIONS: Record<VocalVariant, string> = {
  baseline: "No change. Keep this option if the alternatives do not help.",
  lift: "Raise only the vocal fader by 2 dB.",
  steady: "Add clean 3:1 compression at -24 dBFS, 10 ms attack, 150 ms release, then raise the vocal fader by 1 dB.",
  presence: "The same compression/fader proposal, followed by a broad +1.5 dB bell at 3 kHz.",
};
export interface VocalPassage { startTick: number; endTick: number }
export interface VocalRender {
  jobId: string; analysisJobId: string | null; artifactId: string | null; reportId: string | null;
  auditionGainDb: number | null; peakDbfs: number | null; rmsDbfs: number | null;
  fullScaleFraction: number | null;
}
export interface VocalCandidate { variant: VocalVariant; snapshotId: string; renders: VocalRender[] }
export interface VocalMixRun {
  schema: 1; id: string; projectId: string; goal: string; vocalTrackId: string;
  baseSnapshotId: string; baseRevision: string; passages: VocalPassage[];
  status: "preparing" | "rendering" | "ready" | "interrupted" | "failed" | "cancelled";
  error: string | null; createdAt: number; candidates: VocalCandidate[];
}
export const vocalRevision = (song: MusicProject) => documentHashes(snapshotContent(song)).sha256;

export function checkVocalTarget(song: MusicProject, trackId: string) {
  const track = getMixerTrack(song, trackId);
  if (!track || trackId === MASTER_TRACK_ID) throw new Error("Choose a dedicated vocal insert, not the master.");
  if (track.muted || track.solo || song.mixer.tracks.some(t => t.solo)) throw new Error("Unmute the vocal and clear mixer solos before comparing the full mix.");
  if (!song.channels.some(c => c.mixerTrack === trackId) && !song.playlist.tracks.some(t => t.mixerTrack === trackId)) throw new Error("Route the vocal to this mixer insert first.");
  if (track.volume <= 0) throw new Error("The vocal fader is silent.");
  if (song.automations.some(a => a.target.kind === "mixer" && a.target.track === trackId && a.target.control === "volume") ||
      song.modulators.some(m => m.links.some(l => l.target.kind === "mixer" && l.target.track === trackId && l.target.control === "volume"))) {
    throw new Error("This first vocal workflow cannot change an automated/modulated vocal fader.");
  }
  if (track.effects.filter(e => !e).length < 2) throw new Error("The vocal insert needs two empty slots for comparison effects.");
  if (track.volume * 10 ** (2 / 40) > 1) throw new Error("The vocal fader lacks room for the +2 dB alternative. Lower its input level first.");
}

export function vocalAlternative(song: MusicProject, trackId: string, variant: VocalVariant, runId: string): MusicProject {
  if (!VOCAL_VARIANTS.includes(variant)) throw new Error("Unknown vocal alternative.");
  if (variant === "baseline") return song;
  checkVocalTarget(song, trackId);
  const track = getMixerTrack(song, trackId)!;
  // FL-style faders use squared gain; 20*log10(gain) = 40*log10(fader ratio).
  let next = updateMixerTrack(song, trackId, { volume: track.volume * 10 ** ((variant === "lift" ? 2 : 1) / 40) });
  if (variant === "lift") return next;
  const compId = `fx_${runId}_comp`;
  next = setEffect(next, trackId, freeSlot(next, trackId)!, PRO_C_PLUGIN, compId);
  next = updateProC(next, compId, { style: "clean", threshold: -24, slope: 1 - 1 / 3, knee: 6,
    attack: .01, release: .15, range: 12, autoGain: false, autoRelease: false, mix: 1 });
  if (variant === "presence") {
    const eqId = `fx_${runId}_eq`;
    next = setEffect(next, trackId, freeSlot(next, trackId)!, PRO_Q_PLUGIN, eqId);
    next = editProQ(next, eqId, pq => ({ ...pq, autoGain: false, bands: [
      { ...DEFAULT_BAND, id: 1, shape: "bell", frequency: 3000, gain: 1.5, q: .7, dynamics: false },
    ] }));
  }
  return next;
}

/** One pure patch, committed by the live editor as one undo step. Never replace a stale song. */
export function acceptVocalAlternative(song: MusicProject, run: VocalMixRun, variant: VocalVariant): MusicProject {
  if (run.status !== "ready") throw new Error("Finish rendering and measuring both passages before applying an alternative.");
  if (vocalRevision(song) !== run.baseRevision) throw new Error("The song changed since this comparison. Start a fresh comparison before applying.");
  const candidate = run.candidates.find(c => c.variant === variant);
  if (!candidate || candidate.renders.length !== 2 || candidate.renders.some(r => r.reportId === null || r.auditionGainDb === null)) throw new Error("Both passage reports are required.");
  if (variant !== "baseline" && candidate.renders.some(r => r.fullScaleFraction === null || r.fullScaleFraction > 0 || r.peakDbfs === null || r.peakDbfs >= 0)) throw new Error("This alternative has insufficient measured headroom. Keep the baseline or make a fresh comparison at lower levels.");
  return vocalAlternative(song, run.vocalTrackId, variant, run.id);
}
