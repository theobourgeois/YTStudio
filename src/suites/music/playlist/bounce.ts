import { toast } from "sonner";
import { createId } from "@shared/ids";
import { errorMessage } from "@shared/errors";
import { type BouncedFile, bounceRender, consolidationOf, placeBounced, rerendered, unconsolidate } from "@shared/music/consolidate";
import { DEFAULT_EXPORT_SETTINGS, type MusicExportJob } from "@shared/music/export";
import { trackName as mixerTrackName } from "@shared/music/mixer";
import { clipContext, trackName } from "@shared/music/playlist";
import type { MusicProject, PlaylistClip } from "@shared/music/types";
import { musicApi } from "../api";
import { useMusicPreferences } from "../preferences";
import { useMusic } from "../store";
import { useTransport } from "../transport";
import { usePlaylist } from "./store";

/** How often a bounce's progress is asked for. */
const POLL_MS = 150;

/** What a bounce made: the new clips (one per mixer track the clips play into) and where, or why it couldn't. */
export type BounceResult = { clips: { id: number; track: number; name: string }[]; start: number; seconds: number } | { error: string };

/**
 * Render clips as they reach their mixer tracks (`bounceRender`: before the tracks' effects, a file for each
 * track), from the first's start to the last's end and their tail, through the export (`bounce`): the files
 * become the project's media. `nameOf` names a mixer track's file (`many`: there's more than one).
 */
async function render(song: MusicProject, clips: readonly PlaylistClip[], nameOf: (into: string, many: boolean) => string): Promise<{ files: BouncedFile[]; start: number } | { error: string }> {
  const { projectId } = useMusic.getState();
  if (!projectId) return { error: "No song is open." };
  if (useTransport.getState().exporting) return { error: "A song is being exported: wait for it to finish." };
  const plan = bounceRender(song, clips);
  if (!plan) return { error: "They play nothing: their channels are muted or their patterns are empty." };
  const names = Object.fromEntries(plan.stems.map((s) => [s.track, nameOf(s.into, plan.stems.length > 1).slice(0, 80)]));
  const settings = { ...DEFAULT_EXPORT_SETTINGS, mode: "song" as const, tail: "ring" as const, resampling: useMusicPreferences.getState().exportResampling };
  useTransport.setState({ exporting: true, playing: false, pausedAt: null });
  let job: MusicExportJob;
  try {
    const bounce = { name: names[plan.stems[0].track], names };
    job = await musicApi.startExport({ projectId, song: plan.song, patternId: null, selection: { start: plan.start, end: plan.end }, settings, destination: null, bounce });
    while (job.state === "rendering" || job.state === "encoding") {
      await new Promise((resolve) => setTimeout(resolve, POLL_MS));
      job = await musicApi.exportJob(job.id);
    }
  } catch (err) {
    return { error: errorMessage(err) };
  } finally {
    useTransport.setState({ exporting: false });
  }
  if (job.state !== "done") return { error: job.error ?? "The render didn't finish." };
  const bounced = job.bounced ?? [];
  const media = bounced.map((b) => b.media);
  useMusic.setState({ assets: [...useMusic.getState().assets.filter((a) => !media.some((m) => m.id === a.id)), ...media] });
  const fallback = (plan.end - plan.start) * clipContext(song).secondsPerTick;
  const files = plan.stems.flatMap((stem) => {
    const made = bounced.find((b) => b.track === stem.track);
    return made ? [{ into: stem.into, sampleId: made.media.id, seconds: made.media.duration ?? fallback, name: names[stem.track] }] : [];
  });
  if (!files.length) return { error: "They made no sound." };
  return { files, start: plan.start };
}

/** What clips are called, for the files made of them: their pattern's or channel's name when they're all one, else their track's. */
function sourcesName(song: MusicProject, clips: readonly PlaylistClip[]): string {
  const refs = new Set(clips.map((c) => c.ref));
  const first = [...clips].sort((a, b) => a.track - b.track || a.start - b.start)[0];
  if (refs.size === 1) {
    const name = first.kind === "pattern" ? song.patterns.find((p) => p.id === first.ref)?.name : song.channels.find((c) => c.id === first.ref)?.name;
    if (name) return name.replace(/ \((consolidated|rendered)\)$/, "");
  }
  return trackName(song, first.track);
}

/**
 * FL's Render as audio clip and Consolidate, ours (`shared/music/consolidate.ts`): the clips in `ids`
 * (pattern and audio clips) rendered as they reach their mixer tracks, a clip for each track, playing back
 * into it. Render as audio clip puts them on the first free tracks below; Consolidate (`replace`) puts them
 * in the clips' place, with the clips inside them. One undo step.
 */
export async function bounceClips(ids: ReadonlySet<number>, options: { replace: boolean }): Promise<BounceResult> {
  const song = useMusic.getState().history?.doc;
  if (!song) return { error: "No song is open." };
  const chosen = song.playlist.clips.filter((c) => ids.has(c.id) && c.kind !== "automation");
  if (!chosen.length) return { error: "No pattern or audio clips to render." };
  const base = sourcesName(song, chosen);
  const suffix = options.replace ? "consolidated" : "rendered";
  const rendered = await render(song, chosen, (into, many) => (many ? `${base} – ${mixerTrackName(song, into)} (${suffix})` : `${base} (${suffix})`));
  if ("error" in rendered) return rendered;
  let placed: number[] = [];
  useMusic.getState().commit((doc) => {
    // Only the clips still there (edits go on while it renders).
    const result = placeBounced(doc, ids, rendered.files, options.replace ? createId("cons") : null);
    placed = result.clipIds;
    return result.song;
  });
  return resultOf(placed, rendered.start, rendered.files);
}

/** The clips placed, as a result. */
function resultOf(ids: number[], start: number, files: readonly BouncedFile[]): BounceResult {
  const doc = useMusic.getState().history?.doc;
  if (!doc || !ids.length) return { error: "They couldn't be placed: the clips are gone." };
  const clips = ids.flatMap((id) => {
    const clip = doc.playlist.clips.find((c) => c.id === id);
    return clip ? [{ id, track: clip.track, name: doc.channels.find((c) => c.id === clip.ref)?.name ?? "" }] : [];
  });
  return { clips, start, seconds: Math.max(...files.map((f) => f.seconds)) };
}

/**
 * Re-render a consolidated clip: the clips inside it rendered again as they are now (their patterns, their
 * instruments), each of its mixer tracks' channels playing the new file. One undo step.
 */
export async function rerenderClip(clipId: number): Promise<BounceResult> {
  const song = useMusic.getState().history?.doc;
  const consolidation = song && consolidationOf(song, clipId);
  if (!song || !consolidation) return { error: "That clip isn't a consolidated one." };
  const exists = (c: PlaylistClip) => (c.kind === "pattern" ? song.patterns.some((p) => p.id === c.ref) : song.channels.some((ch) => ch.id === c.ref));
  const sources = consolidation.clips.filter(exists);
  if (!sources.length) return { error: "The clips it was made from are gone: their patterns or channels were deleted." };
  // Each mixer track's file keeps its channel's name.
  const made = song.playlist.clips.filter((c) => c.consolidated?.id === consolidation.id);
  const channelName = (into: string) => song.channels.find((ch) => made.some((c) => c.ref === ch.id && c.consolidated!.into === into))?.name;
  const base = sourcesName(song, sources);
  const rendered = await render(song, sources, (into, many) => channelName(into) ?? (many ? `${base} – ${mixerTrackName(song, into)} (consolidated)` : `${base} (consolidated)`));
  if ("error" in rendered) return rendered;
  const assets = useMusic.getState().assets;
  let placed: number[] = [];
  useMusic.getState().commit((doc) => {
    const spt = clipContext(doc).secondsPerTick;
    const oldTicks = (sampleId: string) => {
      const seconds = assets.find((a) => a.id === sampleId)?.duration;
      return seconds ? Math.round(seconds / spt) : null;
    };
    const result = rerendered(doc, consolidation.id, rendered.files, oldTicks);
    placed = result.clipIds;
    return result.song;
  });
  const doc = useMusic.getState().history?.doc;
  const now = doc?.playlist.clips.filter((c) => c.consolidated?.id === consolidation.id).map((c) => c.id) ?? [];
  return resultOf([...new Set([...now, ...placed])], rendered.start, rendered.files);
}

/** Unconsolidate (`unconsolidate`): the consolidated clips in `ids` give back the clips inside them, which are selected. How many came back. */
export function unconsolidateClips(ids: ReadonlySet<number>): number {
  let restored: number[] = [];
  useMusic.getState().commit((doc) => {
    const result = unconsolidate(doc, ids);
    restored = result.restored;
    return result.song;
  });
  if (restored.length) usePlaylist.getState().select(restored);
  return restored.length;
}

/** Bounce, saying how it went (the clip menu's, the track menu's and Ctrl+Alt+C). */
export async function bounceWithToast(ids: ReadonlySet<number>, replace: boolean) {
  const id = toast.loading(replace ? "Consolidating…" : "Rendering…");
  const result = await bounceClips(ids, { replace });
  if ("error" in result) toast.error(replace ? "Couldn't consolidate" : "Couldn't render", { id, description: result.error });
  else toast.success(summary(result), { id, description: replace ? "The clips are inside it: its menu's Unconsolidate brings them back." : "On the first free track below them." });
}

/** Re-render, saying how it went (the clip menu's). */
export async function rerenderWithToast(clipId: number) {
  const id = toast.loading("Rendering again…");
  const result = await rerenderClip(clipId);
  if ("error" in result) toast.error("Couldn't render it again", { id, description: result.error });
  else toast.success(summary(result), { id, description: "Rendered again from the clips inside it." });
}

const summary = (result: Exclude<BounceResult, { error: string }>) =>
  result.clips.length === 1 ? `${result.clips[0].name}: ${result.seconds.toFixed(1)} s` : `${result.clips.length} clips, one per mixer track: ${result.seconds.toFixed(1)} s`;
