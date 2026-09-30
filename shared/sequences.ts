/**
 * Nested sequences (Premiere's nests, After Effects' precomps). A project's own tracks and
 * clips are its main sequence; `Project.sequences` holds the others, each a timeline of its
 * own with its own size, frame rate and length. A clip plays a sequence the way it plays a
 * video: its `assetId` is the sequence's id, and `sequenceAsset` describes the sequence as
 * media (its length, size and frame rate), so the clip is trimmed, retimed, remapped and
 * placed like any video clip. Only the renderers look inside it.
 *
 * Every edit in `shared/` works on a `Project`, so a sequence is edited through a view of it
 * shaped like a project (`sequenceView`: the project with the sequence's settings, tracks
 * and clips) and the result is written back (`writeSequence`). The main sequence's view is
 * the project itself.
 */
import { defaultEffects, hasMedia, isRemapped } from "./effects.ts";
import { EPS, roundTime } from "./math.ts";
import {
  MIN_CLIP_DURATION,
  TRACK_KIND_LABEL,
  addTrack,
  clipEnd,
  createId,
  getTrack,
  isFree,
  outputSize,
  splitClips,
} from "./timeline.ts";
import { pruneParents } from "./parenting.ts";
import type { Clip, MediaAsset, Project, ProjectSettings, Sequence, Track } from "./types.ts";

export const SEQUENCE_PREFIX = "seq_";
export const isSequenceId = (id: string) => id.startsWith(SEQUENCE_PREFIX);

export function getSequence(project: Pick<Project, "sequences">, id: string): Sequence | undefined {
  return project.sequences?.find((s) => s.id === id);
}

/** The sequence a clip plays, if it's a nested sequence's clip. */
export function nestedSequence(project: Pick<Project, "sequences">, clip: Pick<Clip, "assetId">): Sequence | undefined {
  return isSequenceId(clip.assetId) ? getSequence(project, clip.assetId) : undefined;
}

/** Whether a clip plays a nested sequence (whether or not that sequence still exists). */
export const isNestedClip = (clip: Pick<Clip, "assetId">) => isSequenceId(clip.assetId);

/** Where a sequence's clips end (0 when it has none). */
function contentEnd(clips: readonly Clip[]): number {
  let end = 0;
  for (const c of clips) end = Math.max(end, clipEnd(c));
  return roundTime(end);
}

/** How long a sequence is: its set length, else as long as its clips. */
export function sequenceDuration(seq: Pick<Sequence, "clips" | "duration">): number {
  return seq.duration ?? contentEnd(seq.clips);
}

/** A sequence's frame at 100% (its size at 1080p). */
export const sequenceSize = (seq: Pick<Sequence, "settings">) => outputSize(seq.settings.aspectRatio, "1080p");

const views = new WeakMap<Sequence, Project>();

/**
 * A sequence as a project (the one every edit and renderer takes): `project` with the
 * sequence's settings, tracks and clips, the same object for as long as nothing in it
 * changes. `null` is the main sequence: `project` itself.
 */
export function sequenceView(project: Project, id: string | null): Project {
  if (id === null) return project;
  const seq = getSequence(project, id);
  if (!seq) return project;
  const cached = views.get(seq);
  if (cached && cached.sequences === project.sequences && cached.name === project.name && cached.subclips === project.subclips) return cached;
  const { sequences, subclips } = project;
  const view: Project = {
    version: 1,
    name: project.name,
    settings: seq.settings,
    tracks: seq.tracks,
    clips: seq.clips,
    ...(subclips && { subclips }),
    ...(sequences && { sequences }),
  };
  views.set(seq, view);
  return view;
}

/**
 * Put an edited view of sequence `id` back into the project: its settings, tracks and clips
 * go into the sequence, and anything else it changed that belongs to the whole project (its
 * sequences, subclips) is kept. The main sequence's view is the project.
 */
export function writeSequence(project: Project, id: string | null, view: Project): Project {
  if (id === null) return view;
  if (view === sequenceView(project, id)) return project;
  const sequences = (view.sequences ?? []).map((s) =>
    s.id === id ? { ...s, settings: view.settings, tracks: view.tracks, clips: view.clips } : s,
  );
  const next: Project = { ...project, sequences };
  if (view.subclips) next.subclips = view.subclips;
  else delete next.subclips;
  return next;
}

/** Apply an edit to every sequence of a project (the main one too), e.g. removing a file's clips. */
export function everySequence(project: Project, edit: (view: Project) => Project): Project {
  let p = edit(project);
  for (const seq of p.sequences ?? []) p = writeSequence(p, seq.id, edit(sequenceView(p, seq.id)));
  return p;
}

/** Every clip of every sequence (the main one first). */
export function allClips(project: Pick<Project, "clips" | "sequences">): Clip[] {
  return [...project.clips, ...(project.sequences ?? []).flatMap((s) => s.clips)];
}

const assetCache = new WeakMap<Sequence, MediaAsset>();

/**
 * A sequence described as media for its clips (never sent to the server): a video as long
 * and as big as the sequence, at its frame rate, with sound if anything in it plays some.
 */
export function sequenceAsset(seq: Sequence): MediaAsset {
  const cached = assetCache.get(seq);
  if (cached) return cached;
  const { width, height } = sequenceSize(seq);
  const asset: MediaAsset = {
    id: seq.id,
    projectId: null,
    name: seq.name,
    kind: "video",
    duration: sequenceDuration(seq),
    width,
    height,
    fps: seq.settings.fps,
    hasVideo: true,
    hasAudio: seq.clips.some((c) => hasMedia(c)),
    size: 0,
    createdAt: 0,
    status: "ready",
    src: "",
    poster: null,
    filmstrip: null,
    waveform: null,
    sequence: true,
  };
  assetCache.set(seq, asset);
  return asset;
}

const assetLists = new WeakMap<Sequence[], MediaAsset[]>();
const NO_ASSETS: MediaAsset[] = [];

/** Every nested sequence as media (the same array while the sequences don't change). */
export function sequenceAssets(project: Pick<Project, "sequences">): MediaAsset[] {
  const list = project.sequences;
  if (!list?.length) return NO_ASSETS;
  let assets = assetLists.get(list);
  if (!assets) assetLists.set(list, (assets = list.map(sequenceAsset)));
  return assets;
}

/** The sequences a sequence plays, and theirs, and so on (not itself, unless it loops). */
export function sequencesWithin(project: Pick<Project, "sequences" | "clips">, id: string | null): Set<string> {
  const found = new Set<string>();
  const visit = (clips: readonly Clip[]) => {
    for (const c of clips) {
      if (!isSequenceId(c.assetId) || found.has(c.assetId)) continue;
      found.add(c.assetId);
      const seq = getSequence(project, c.assetId);
      if (seq) visit(seq.clips);
    }
  };
  visit(id === null ? project.clips : (getSequence(project, id)?.clips ?? []));
  return found;
}

/** Whether sequence `inner` can be nested in sequence `container` (null: the main one) without it ending up inside itself. */
export function canNestIn(project: Project, container: string | null, inner: string): boolean {
  if (!getSequence(project, inner)) return false;
  if (container === null) return true;
  return inner !== container && !sequencesWithin(project, inner).has(container);
}

/** A name for a new sequence: "Nested Sequence 3". */
export function newSequenceName(project: Pick<Project, "sequences">, base = "Nested Sequence"): string {
  const names = new Set((project.sequences ?? []).map((s) => s.name));
  for (let n = 1; ; n++) if (!names.has(`${base} ${n}`)) return `${base} ${n}`;
}

/** An empty sequence with `view`'s settings (or `settings`), added to the project. */
export function createSequence(
  view: Project,
  opts: { name?: string; settings?: Partial<ProjectSettings>; duration?: number } = {},
): { project: Project; sequenceId: string } {
  const id = createId("seq");
  const seq: Sequence = {
    id,
    name: opts.name?.trim() || newSequenceName(view),
    settings: { ...view.settings, ...opts.settings },
    tracks: [
      { id: "main", kind: "video", name: TRACK_KIND_LABEL.video + " 1", muted: false },
      { id: "audio_1", kind: "audio", name: TRACK_KIND_LABEL.audio + " 1", muted: false },
    ],
    clips: [],
    ...(opts.duration !== undefined && opts.duration > 0 && { duration: roundTime(opts.duration) }),
  };
  return { project: { ...view, sequences: [...(view.sequences ?? []), seq] }, sequenceId: id };
}

/** A new clip playing all of sequence `seq`, from `start` on track `trackId`. */
export function sequenceClip(seq: Sequence, trackId: string, start: number): Clip {
  return {
    id: createId("clip"),
    assetId: seq.id,
    trackId,
    start: roundTime(Math.max(0, start)),
    in: 0,
    out: roundTime(Math.max(MIN_CLIP_DURATION, sequenceDuration(seq))),
    effects: defaultEffects(),
  };
}

/**
 * Nest (Premiere's Nest, After Effects' Pre-compose): the clips become a new sequence (on
 * copies of their tracks, the earliest starting at 0), and one clip playing it takes their
 * place, on the top video track they were on (or the top audio track, for sound only), or a
 * new track above when something else is in the way. Parent links out of the selection are
 * dropped. Null when there's nothing to nest.
 */
export function nestClips(view: Project, clipIds: readonly string[], name?: string): { project: Project; sequenceId: string; clipId: string } | null {
  const ids = new Set(clipIds);
  const chosen = view.clips.filter((c) => ids.has(c.id));
  if (chosen.length === 0) return null;
  const t0 = Math.min(...chosen.map((c) => c.start));
  const end = Math.max(...chosen.map(clipEnd));
  const used = new Set(chosen.map((c) => c.trackId));
  const tracks: Track[] = view.tracks.filter((t) => used.has(t.id)).map((t) => ({ ...t, muted: false }));
  // A sequence always has a video track.
  if (!tracks.some((t) => t.kind === "video")) tracks.unshift({ id: "main", kind: "video", name: "Video 1", muted: false });
  const inner = pruneParents(chosen.map((c) => ({ ...c, start: roundTime(c.start - t0) })));
  const seq: Sequence = {
    id: createId("seq"),
    name: name?.trim() || newSequenceName(view),
    settings: { ...view.settings },
    tracks,
    clips: inner,
  };
  let p: Project = { ...view, clips: view.clips.filter((c) => !ids.has(c.id)), sequences: [...(view.sequences ?? []), seq] };
  const visual = chosen.some((c) => getTrack(view, c.trackId)?.kind === "video");
  let trackId = view.tracks.find((t) => used.has(t.id) && t.kind === (visual ? "video" : "audio"))!.id;
  const clip = sequenceClip(seq, trackId, t0);
  clip.out = roundTime(Math.max(MIN_CLIP_DURATION, end - t0));
  if (!isFree(p, trackId, clip.start, clip.out - clip.in)) {
    const index = p.tracks.findIndex((t) => t.id === trackId);
    const added = addTrack(p, visual ? "video" : "audio", visual ? index : index + 1);
    p = added.project;
    trackId = added.trackId;
  }
  p = { ...p, clips: [...p.clips, { ...clip, trackId }] };
  return { project: p, sequenceId: seq.id, clipId: clip.id };
}

/**
 * Break a nested clip apart (Premiere's Restore Unnested): the part of its sequence it plays
 * goes back on the timeline in its place, each of the sequence's tracks on a new track (video
 * tracks where the clip was, audio ones at the top of the audio tracks). Its own Motion,
 * Opacity and effects are dropped. Only for a clip playing at normal speed, forwards and not
 * remapped (anything else couldn't be put back as it plays). Null when it can't.
 */
export function breakApart(view: Project, clipId: string): { project: Project; clipIds: string[] } | null {
  const clip = view.clips.find((c) => c.id === clipId);
  const seq = clip && nestedSequence(view, clip);
  if (!clip || !seq || (clip.speed ?? 1) !== 1 || clip.reversed || isRemapped(clip)) return null;
  // The part it plays: cut at its in and out, and only what's between.
  let inner = sequenceView(view, seq.id);
  inner = splitClips(inner, inner.clips.map((c) => c.id), clip.in).project;
  inner = splitClips(inner, inner.clips.map((c) => c.id), clip.out).project;
  const kept = inner.clips.filter((c) => c.start >= clip.in - EPS && clipEnd(c) <= clip.out + EPS);
  const offset = clip.start - clip.in;
  const ids = new Map(kept.map((c) => [c.id, createId("clip")]));
  let p: Project = { ...view, clips: view.clips.filter((c) => c.id !== clipId) };
  // New tracks, in the sequence's order: video ones above the clip's track, audio ones first among the audio tracks.
  const trackFor = new Map<string, string>();
  const at = p.tracks.findIndex((t) => t.id === clip.trackId);
  const innerVideo = seq.tracks.filter((t) => t.kind === "video" && kept.some((c) => c.trackId === t.id));
  const innerAudio = seq.tracks.filter((t) => t.kind === "audio" && kept.some((c) => c.trackId === t.id));
  innerVideo.forEach((t, i) => {
    const added = addTrack(p, "video", Math.max(0, at) + i);
    p = added.project;
    trackFor.set(t.id, added.trackId);
  });
  const firstAudio = p.tracks.findIndex((t) => t.kind === "audio");
  innerAudio.forEach((t, i) => {
    const added = addTrack(p, "audio", (firstAudio < 0 ? p.tracks.length : firstAudio) + i);
    p = added.project;
    trackFor.set(t.id, added.trackId);
  });
  const placed = kept.map((c) => {
    const parent = c.parent && ids.has(c.parent.id) ? { ...c.parent, id: ids.get(c.parent.id)! } : undefined;
    const { parent: _, ...rest } = c;
    return { ...rest, id: ids.get(c.id)!, trackId: trackFor.get(c.trackId)!, start: roundTime(c.start + offset), ...(parent && { parent }) };
  });
  p = { ...p, clips: [...p.clips, ...placed] };
  return { project: p, clipIds: placed.map((c) => c.id) };
}

/** Rename a sequence (and what its clips are called). */
export function renameSequence(project: Project, id: string, name: string): Project {
  const trimmed = name.trim();
  const seq = getSequence(project, id);
  if (!seq || !trimmed || seq.name === trimmed) return project;
  return { ...project, sequences: project.sequences!.map((s) => (s.id === id ? { ...s, name: trimmed } : s)) };
}

/** Set a sequence's length (null: as long as its clips). */
export function setSequenceDuration(project: Project, id: string, duration: number | null): Project {
  const seq = getSequence(project, id);
  if (!seq) return project;
  const next = duration === null || !(duration > 0) ? undefined : roundTime(Math.max(MIN_CLIP_DURATION, duration));
  if (next === seq.duration) return project;
  return {
    ...project,
    sequences: project.sequences!.map((s) => {
      if (s.id !== id) return s;
      const { duration: _, ...rest } = s;
      return next === undefined ? rest : { ...rest, duration: next };
    }),
  };
}

/** Delete a sequence and every clip that plays it (in any sequence). */
export function deleteSequence(project: Project, id: string): Project {
  if (!getSequence(project, id)) return project;
  const without: Project = { ...project, sequences: project.sequences!.filter((s) => s.id !== id) };
  return everySequence(without, (v) => {
    const clips = v.clips.filter((c) => c.assetId !== id);
    return clips.length === v.clips.length ? v : { ...v, clips: pruneParents(clips) };
  });
}
