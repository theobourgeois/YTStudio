/**
 * Stretching audio clips from the menus (`docs/fl-studio/playlist.md`, Stretching audio clips): FL's MODE
 * and TIME menu, for audio clips (the clip menu: their own stretch, FL 2025's variants) or an audio clip
 * channel (its settings' Time stretching: what its clips with none of their own play by). Each change keeps
 * every clip's content (`setClipStretch`, `stretchChannel`).
 */
import { toast } from "sonner";
import { errorMessage } from "@shared/errors";
import { clipContext, editClips, resetPitch, setClipStretch, stretchChannel } from "@shared/music/playlist";
import { fileTempo, tempoForBeats, tempoOfFile } from "@shared/music/stretch";
import { type AudioStretch, type MusicProject, PPQ, STEP_TICKS, type StretchMode } from "@shared/music/types";
import { stepsPerBar } from "@shared/music/project";
import { musicApi } from "./api";
import { useMusicPreferences } from "./preferences";
import { useMusic } from "./store";

/** What a menu stretches: audio clips (by id), or a channel. */
export type StretchTarget = { kind: "clips"; ids: ReadonlySet<number> } | { kind: "channel"; id: string };

/** FL's TIME menu (Beat/Bar #), in beats; bars are the song's. */
export const BEAT_CHOICES = [1, 2] as const;
export const BAR_CHOICES = [1, 2, 4, 8, 16] as const;

const song = () => useMusic.getState().history?.doc ?? null;

/** The audio clips a target names, each with its channel (the same part of the song as the menu's). */
function targetGroups(doc: MusicProject, target: StretchTarget): { channelId: string; ids: Set<number> }[] {
  if (target.kind === "channel") return [{ channelId: target.id, ids: new Set() }];
  const groups = new Map<string, Set<number>>();
  for (const clip of doc.playlist.clips) {
    if (clip.kind !== "audio" || !target.ids.has(clip.id)) continue;
    let ids = groups.get(clip.ref);
    if (!ids) groups.set(clip.ref, (ids = new Set()));
    ids.add(clip.id);
  }
  return [...groups].map(([channelId, ids]) => ({ channelId, ids }));
}

/** The stretch a target plays by now: a channel's, or the first of its clips' (their own, else their channel's). */
export function currentStretch(doc: MusicProject, target: StretchTarget): AudioStretch | null {
  if (target.kind === "channel") return doc.channels.find((c) => c.id === target.id)?.stretch ?? null;
  const clip = doc.playlist.clips.find((c) => c.kind === "audio" && target.ids.has(c.id));
  return clip ? clipContext(doc).stretchOf(clip) : null;
}

/** Whether any of a target's clips has a stretch of its own (they can follow their channel's again). */
export const hasOwnStretch = (doc: MusicProject, target: StretchTarget) =>
  target.kind === "clips" && doc.playlist.clips.some((c) => c.kind === "audio" && target.ids.has(c.id) && c.stretch);

/** Each of a target's channels' new stretch (by channel id) applied: to its clips, or to the channel. */
function apply(doc: MusicProject, target: StretchTarget, stretchOf: (channelId: string) => AudioStretch | null | undefined): MusicProject {
  let next = doc;
  for (const { channelId, ids } of targetGroups(doc, target)) {
    const stretch = stretchOf(channelId);
    // Undefined: nothing to do for this one (no file to measure, say).
    if (stretch === undefined) continue;
    next = target.kind === "channel" ? stretchChannel(next, channelId, stretch) : editClips(next, (clips, ctx) => setClipStretch(clips, ids, stretch, ctx));
  }
  return next;
}

const commit = (target: StretchTarget, stretchOf: (doc: MusicProject, channelId: string) => AudioStretch | null | undefined) =>
  useMusic.getState().commit((doc) => apply(doc, target, (channelId) => stretchOf(doc, channelId)));

/** The mode (FL's MODE) a target is stretched in from now on, its time kept. */
export function setStretchMode(target: StretchTarget, mode: StretchMode) {
  commit(target, (doc, channelId) => {
    const was = currentStretch(doc, target.kind === "channel" ? target : { kind: "clips", ids: idsOf(doc, target, channelId) });
    return { mode, tempo: was?.tempo ?? null };
  });
}

const idsOf = (doc: MusicProject, target: StretchTarget, channelId: string) => targetGroups(doc, target).find((g) => g.channelId === channelId)?.ids ?? new Set<number>();

/** The mode a target's new time is in: the one it has, or Settings' Stretch mode. */
const modeOf = (doc: MusicProject, target: StretchTarget) => currentStretch(doc, target)?.mode ?? useMusicPreferences.getState().stretchMode;

/** No stretching (FL's TIME "(none)"): the file at its own speed (a clip so even if its channel is stretched). */
export const clearStretch = (target: StretchTarget) => commit(target, (doc) => (target.kind === "channel" ? null : { mode: modeOf(doc, target), tempo: null }));

/** Its own stretch taken away: a clip follows its channel's again. */
export const followChannel = (target: StretchTarget) => commit(target, () => null);

/** Stretched to the song's tempo now (FL's "Project tempo"): as it sounds at this tempo, following the tempo from now on. */
export const setProjectTempo = (target: StretchTarget) => commit(target, (doc) => ({ mode: modeOf(doc, target), tempo: doc.settings.tempo }));

/** A file's length in seconds (its project media's), or null if it isn't known. */
function fileSeconds(doc: MusicProject, channelId: string): number | null {
  const sampleId = doc.channels.find((c) => c.id === channelId)?.sampleId;
  const asset = useMusic.getState().assets.find((a) => a.id === sampleId);
  return asset?.duration && asset.duration > 0 ? asset.duration : null;
}

/** The file lasts `beats` beats (FL's Beat/Bar #). */
export const setBeats = (target: StretchTarget, beats: number) =>
  commit(target, (doc, channelId) => {
    const seconds = fileSeconds(doc, channelId);
    const mode = modeOf(doc, target);
    return seconds === null ? undefined : { mode, tempo: tempoForBeats(seconds, beats) };
  });

/** Beats in a bar of the song (quarter notes). */
export const beatsPerBar = (doc: MusicProject) => (stepsPerBar(doc.settings.timeSignature) * STEP_TICKS) / PPQ;

/** Twice as long (`factor` 2) or half (FL's MUL): the time scaled, whatever it was. */
export const scaleTime = (target: StretchTarget, factor: number) =>
  commit(target, (doc) => {
    const was = currentStretch(doc, target);
    return { mode: was?.mode ?? modeOf(doc, target), tempo: (was?.tempo ?? doc.settings.tempo) * factor };
  });

/** FL's Autodetect: each file's tempo as heard (rounded to whole beats), then stretched to the song's. */
export async function autodetectTempo(target: StretchTarget) {
  const doc = song();
  const projectId = useMusic.getState().projectId;
  if (!doc || !projectId) return;
  const heard = new Map<string, number | null>();
  try {
    for (const { channelId } of targetGroups(doc, target)) {
      const sampleId = doc.channels.find((c) => c.id === channelId)?.sampleId;
      if (!sampleId) continue;
      const detected = await musicApi.detectTempo({ projectId, sampleId });
      heard.set(channelId, fileTempo(detected.seconds, detected.bpm));
    }
  } catch (error) {
    toast.error("Couldn't detect the tempo", { description: errorMessage(error) });
    return;
  }
  if ([...heard.values()].every((t) => t === null)) return void toast.info("No tempo heard", { description: "The file is too short to tell." });
  commit(target, (now, channelId) => {
    const tempo = heard.get(channelId);
    return tempo ? { mode: modeOf(now, target), tempo: tempoOfFile(tempo) } : undefined;
  });
  const tempi = [...new Set([...heard.values()].filter((t): t is number => t !== null))];
  toast.success(`Tempo detected: ${tempi.map((t) => `${Math.round(t * 10) / 10} BPM`).join(", ")}`, { id: "detect-tempo" });
}

const pitchTarget = (target: StretchTarget) => (target.kind === "channel" ? { channel: target.id } : { clips: target.ids });

/** Whether a target is heard higher or lower than its file (its channel's pitch, or Resample): what Reset pitch undoes. */
export const isPitched = (doc: MusicProject, target: StretchTarget) => resetPitch(doc, pitchTarget(target)) !== doc;

/**
 * Back to the file's own pitch, the speed kept (sped up the Resample way, it stays as fast, at the pitch it
 * was recorded at): Stretch mode at the speed it plays now (`resetPitch`).
 */
export const resetTargetPitch = (target: StretchTarget) => useMusic.getState().commit((doc) => resetPitch(doc, pitchTarget(target)));

/** How a stretch reads (FL's TIME display): its tempo, or "None". */
export function stretchLabel(stretch: AudioStretch | null): string {
  if (!stretch?.tempo) return "None";
  const tempo = Math.round(stretch.tempo * 100) / 100;
  return `${tempo} BPM`;
}
