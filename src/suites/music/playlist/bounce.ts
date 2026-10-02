import { toast } from "sonner";
import { createId } from "@shared/ids";
import { errorMessage } from "@shared/errors";
import { DEFAULT_EXPORT_SETTINGS, type MusicExportJob } from "@shared/music/export";
import { addAudioClips, clipContext, clipEnd, editClips, setClipProps, trackName } from "@shared/music/playlist";
import { MAX_PLAYLIST_TRACKS } from "@shared/music/project";
import type { MusicProject, PlaylistClip } from "@shared/music/types";
import { musicApi } from "../api";
import { useMusicPreferences } from "../preferences";
import { useMusic } from "../store";
import { useTransport } from "../transport";

/** How often a bounce's progress is asked for. */
const POLL_MS = 150;

/** What a bounce made: the new clip's id and where it is, or why it couldn't. */
export type BounceResult = { clipId: number; track: number; start: number; seconds: number; name: string } | { error: string };

/**
 * FL's Render as audio clip and Consolidate (`docs/fl-studio/export.md`): the clips in `ids` (pattern and
 * audio clips; automation keeps playing as it does in the song) rendered through the mixer, as the export
 * renders, from the first's start to the last's end and their tail, into a WAV that becomes the project's
 * media and an audio clip there. Render as audio clip puts it on the first free track below them;
 * Consolidate (`replace`) puts it on the first one's track and mutes them. One undo step.
 */
export async function bounceClips(ids: ReadonlySet<number>, options: { replace: boolean; name?: string }): Promise<BounceResult> {
  const { history, projectId } = useMusic.getState();
  if (!history || !projectId) return { error: "No song is open." };
  if (useTransport.getState().exporting) return { error: "A song is being exported: wait for it to finish." };
  const song = history.doc;
  const ctx = clipContext(song);
  const chosen = song.playlist.clips.filter((c) => ids.has(c.id) && c.kind !== "automation");
  if (!chosen.length) return { error: "No pattern or audio clips to render." };
  const start = Math.min(...chosen.map((c) => c.start));
  const end = Math.max(...chosen.map((c) => clipEnd(c, ctx)));
  const first = chosen.reduce((a, b) => (b.track < a.track ? b : a));
  const name = options.name ?? (options.replace ? `${trackName(song, first.track)} (consolidated)` : `${sourceName(song, chosen[0])} (rendered)`);
  // The song with only them (and its automation), from their start to their end, ringing out.
  const rendered: MusicProject = { ...song, playlist: { ...song.playlist, clips: song.playlist.clips.filter((c) => ids.has(c.id) || c.kind === "automation") } };
  const settings = { ...DEFAULT_EXPORT_SETTINGS, mode: "song" as const, tail: "ring" as const, resampling: useMusicPreferences.getState().exportResampling };
  useTransport.setState({ exporting: true, playing: false, pausedAt: null });
  let job: MusicExportJob;
  try {
    job = await musicApi.startExport({ projectId, song: rendered, patternId: null, selection: { start, end }, settings, destination: null, bounce: { name } });
    while (job.state === "rendering" || job.state === "encoding") {
      await new Promise((resolve) => setTimeout(resolve, POLL_MS));
      job = await musicApi.exportJob(job.id);
    }
  } catch (err) {
    return { error: errorMessage(err) };
  } finally {
    useTransport.setState({ exporting: false });
  }
  const media = job.media;
  if (job.state !== "done" || !media) return { error: job.error ?? "The render didn't finish." };
  useMusic.setState({ assets: [...useMusic.getState().assets.filter((a) => a.id !== media.id), media] });
  const seconds = media.duration ?? (end - start) * ctx.secondsPerTick;
  let placed: { clipId: number; track: number } | null = null;
  useMusic.getState().commit((doc) => {
    const track = options.replace ? first.track : freeTrack(doc, Math.max(...chosen.map((c) => c.track)) + 1, start, start + Math.round(seconds / ctx.secondsPerTick));
    const added = addAudioClips(doc, [{ name, sampleId: media.id, seconds, channelId: createId("chan") }], { start, track });
    placed = { clipId: added.clipIds[0], track };
    return options.replace ? editClips(added.song, (clips) => setClipProps(clips, new Set(chosen.map((c) => c.id)), { muted: true })) : added.song;
  });
  if (!placed) return { error: "It couldn't be placed." };
  const { clipId, track } = placed as { clipId: number; track: number };
  return { clipId, track, start, seconds, name };
}

/** The first track from `from` down that's free over `[start, end)`. */
function freeTrack(song: MusicProject, from: number, start: number, end: number): number {
  const ctx = clipContext(song);
  const busy = (track: number) => song.playlist.clips.some((c) => c.track === track && c.start < end && clipEnd(c, ctx) > start);
  let track = Math.min(from, MAX_PLAYLIST_TRACKS - 1);
  while (track < MAX_PLAYLIST_TRACKS - 1 && busy(track)) track++;
  return track;
}

const sourceName = (song: MusicProject, clip: PlaylistClip) =>
  (clip.kind === "pattern" ? song.patterns.find((p) => p.id === clip.ref)?.name : song.channels.find((c) => c.id === clip.ref)?.name) ?? "Clips";

/** Bounce, saying how it went (the clip menu's and the track menu's). */
export async function bounceWithToast(ids: ReadonlySet<number>, replace: boolean) {
  const id = toast.loading(replace ? "Consolidating…" : "Rendering…");
  const result = await bounceClips(ids, { replace });
  if ("error" in result) toast.error(replace ? "Couldn't consolidate" : "Couldn't render", { id, description: result.error });
  else toast.success(`${result.name}: ${result.seconds.toFixed(1)} s`, { id, description: replace ? "The clips it replaces are muted." : "On the first free track below them." });
}
