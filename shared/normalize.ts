/**
 * Repairing projects from untrusted storage (a saved document, an export
 * request): the one place that decides what a valid project is. It runs when
 * a project is loaded, saved and exported, so a new field on `Project`,
 * `Track` or `Clip` must be validated here (and old documents upgraded here),
 * or it's dropped.
 */
import { TIME_REMAP, clipKind, drawsNothing, hasMedia, isRemapped, isTextClip, normalizeEffects } from "./effects.ts";
import { EPS, clamp, isFiniteNumber, roundTime } from "./math.ts";
import {
  ASPECT_RATIOS,
  MIN_CLIP_DURATION,
  TRACK_KIND_LABEL,
  clampSpeed,
  clipDuration,
  clipEnd,
  createDefaultProject,
  findFreeStart,
  roundSourceTime,
  sourceRange,
} from "./timeline.ts";
import { normalizeMarkers } from "./markers.ts";
import { normalizeSignalDefs } from "./links.ts";
import { pruneParents, sanitizeParent } from "./parenting.ts";
import { normalizeSubclips } from "./subclips.ts";
import { sanitizeTransition } from "./transitions.ts";
import { canNestIn, getSequence, isSequenceId, sequenceView, writeSequence } from "./sequences.ts";
import type { Clip, MediaAsset, Project, ProjectSettings, Sequence, SongTempo, Track, TrackKind } from "./types.ts";

/** Clips saved before effects existed kept their volume and framing on the clip. */
type LegacyClip = { volume?: unknown; fit?: unknown };

/**
 * Repair a project from untrusted storage: guarantees at least one video
 * track, video tracks before audio tracks, drops invalid clips (unknown
 * track/asset, non-positive length, out of source range), validates effects
 * (upgrading clips saved before effects existed) and subclips, clamps values and
 * resolves overlaps. Pass `assets` to also validate clips against their media.
 */
export function normalizeProject(input: Project, assets?: Assets): Project {
  const base = createDefaultProject();
  // Nested sequences first: their clips are checked like any media's, against the sequence as media.
  const sequenceIds = new Set<string>();
  const rawSequences = (Array.isArray(input?.sequences) ? input.sequences : []).filter((s) => {
    if (!s || typeof s !== "object" || typeof s.id !== "string" || !isSequenceId(s.id) || sequenceIds.has(s.id)) return false;
    sequenceIds.add(s.id);
    return true;
  });
  // Stand-ins for the sequences as media: anything goes (a sequence's length changes as it's edited).
  const withSequences: Assets | undefined = assets && {
    ...assets,
    ...Object.fromEntries([...sequenceIds].map((id) => [id, { kind: "video" as const, duration: Infinity, hasVideo: true, hasAudio: true }])),
  };
  const main = normalizeTimeline(input?.tracks, input?.clips, withSequences, sequenceIds);
  const sequences: Sequence[] = rawSequences.map((raw, i) => {
    const { tracks, clips } = normalizeTimeline(raw.tracks, raw.clips, withSequences, sequenceIds);
    const seq: Sequence = {
      id: raw.id,
      name: typeof raw.name === "string" && raw.name.trim() ? raw.name.trim().slice(0, 200) : `Nested Sequence ${i + 1}`,
      settings: normalizeSettings(raw.settings, input?.settings),
      tracks,
      clips,
    };
    if (isFiniteNumber(raw.duration) && raw.duration > 0) seq.duration = roundTime(Math.max(MIN_CLIP_DURATION, raw.duration));
    const markers = normalizeMarkers(raw.markers, 0);
    if (markers.length) seq.markers = markers;
    return seq;
  });
  const subclips = normalizeSubclips(input?.subclips, assets);
  const markers = normalizeMarkers(input?.markers, 0);
  const signals = normalizeSignalDefs(input?.signals);
  const tempo = normalizeSongTempo(input?.tempo);
  const project: Project = {
    version: 1,
    name: typeof input?.name === "string" && input.name ? input.name : base.name,
    settings: normalizeSettings(input?.settings),
    tracks: main.tracks,
    clips: main.clips,
    ...(markers.length > 0 && { markers }),
    ...(subclips.length > 0 && { subclips }),
    ...(signals.length > 0 && { signals }),
    ...(tempo && { tempo }),
    ...(sequences.length > 0 && { sequences }),
  };
  return withoutLoops(project);
}

/** Beats a song's tempo keeps at most (an hour at 300 BPM). */
export const MAX_SONG_BEATS = 18_000;

/** A song's beat (`Project.tempo`) from untrusted storage, or undefined if it isn't one. */
export function normalizeSongTempo(raw: unknown): SongTempo | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const v = raw as Partial<Record<keyof SongTempo, unknown>>;
  const assetIds = Array.isArray(v.assetIds) ? [...new Set(v.assetIds.filter((id): id is string => typeof id === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(id)))].slice(0, 64) : [];
  const beats: number[] = [];
  for (const t of Array.isArray(v.beats) ? v.beats.slice(0, MAX_SONG_BEATS) : []) {
    // In order, a millisecond apart at least.
    if (isFiniteNumber(t) && t >= 0 && (!beats.length || t > beats[beats.length - 1] + 0.001)) beats.push(Math.round(t * 1e4) / 1e4);
  }
  if (!assetIds.length || beats.length < 2) return undefined;
  const beatsPerBar = isFiniteNumber(v.beatsPerBar) ? clamp(Math.round(v.beatsPerBar), 1, 32) : 4;
  return { assetIds, beatsPerBar, beats };
}

type Assets = Record<string, Pick<MediaAsset, "kind" | "duration" | "hasVideo" | "hasAudio">>;

/** A sequence's size and frame rate (`fallback`'s, then the defaults', where they're missing). */
function normalizeSettings(raw: Partial<ProjectSettings> | undefined, fallback?: Partial<ProjectSettings>): ProjectSettings {
  const base = createDefaultProject().settings;
  const aspectRatio = [raw?.aspectRatio, fallback?.aspectRatio].find((a) => ASPECT_RATIOS.includes(a as ProjectSettings["aspectRatio"]));
  return {
    aspectRatio: (aspectRatio ?? base.aspectRatio) as ProjectSettings["aspectRatio"],
    fps: clamp(Math.round(Number(raw?.fps) || Number(fallback?.fps) || base.fps), 1, 120),
  };
}

/**
 * Nested clips that would put a sequence inside itself (directly or further down) are
 * dropped, as are clips of sequences that don't exist.
 */
function withoutLoops(project: Project): Project {
  let p = project;
  for (let pass = 0; pass < 64; pass++) {
    let changed = false;
    const fix = (view: Project, self: string | null): Project => {
      const bad = new Set(
        view.clips
          .filter((c) => isSequenceId(c.assetId) && (!getSequence(p, c.assetId) || (self !== null && !canNestIn(p, self, c.assetId))))
          .map((c) => c.id),
      );
      if (!bad.size) return view;
      changed = true;
      return { ...view, clips: pruneParents(view.clips.filter((c) => !bad.has(c.id))) };
    };
    p = fix(p, null);
    for (const seq of p.sequences ?? []) p = writeSequence(p, seq.id, fix(sequenceView(p, seq.id), seq.id));
    if (!changed) break;
  }
  return p;
}

/** One sequence's tracks and clips, repaired (see `normalizeProject`). */
function normalizeTimeline(
  tracksRaw: unknown,
  clipsRaw: unknown,
  assets: Assets | undefined,
  sequenceIds: ReadonlySet<string>,
): { tracks: Track[]; clips: Clip[] } {
  const base = createDefaultProject();
  const tracksIn = Array.isArray(tracksRaw) ? (tracksRaw as Track[]) : [];
  const seen = new Set<string>();
  const byKind: Record<TrackKind, Track[]> = { video: [], audio: [] };
  for (const t of tracksIn) {
    if (!t || typeof t.id !== "string" || seen.has(t.id)) continue;
    if (t.kind !== "video" && t.kind !== "audio") continue;
    seen.add(t.id);
    byKind[t.kind].push({
      id: t.id,
      kind: t.kind,
      name: String(t.name ?? TRACK_KIND_LABEL[t.kind]),
      muted: !!t.muted,
    });
  }
  if (byKind.video.length === 0) byKind.video.push({ ...base.tracks[0] });
  const tracks = [...byKind.video, ...byKind.audio];
  const trackKind = new Map(tracks.map((t) => [t.id, t.kind]));

  const clips: Clip[] = [];
  const clipIds = new Set<string>();
  for (const c of Array.isArray(clipsRaw) ? (clipsRaw as Clip[]) : []) {
    if (!c || typeof c.id !== "string" || clipIds.has(c.id)) continue;
    // A clip of a nested sequence that isn't there plays nothing.
    if (typeof c.assetId === "string" && isSequenceId(c.assetId) && !sequenceIds.has(c.assetId)) continue;
    const kind = trackKind.get(c.trackId);
    if (!kind) continue;
    const nums = [c.start, c.in, c.out];
    if (!nums.every((n) => typeof n === "number" && Number.isFinite(n))) continue;
    let effects = normalizeEffects(c.effects, Array.isArray(c.effects) ? undefined : (c as LegacyClip));
    // Text, solids and adjustment layers have no media, and are only ever drawn on a video track.
    const adjustment = c.adjustment === true && clipKind({ effects }) === "media";
    const nullObject = !adjustment && c.nullObject === true && clipKind({ effects }) === "media";
    const noMedia = !hasMedia({ effects, adjustment: adjustment || undefined, nullObject: nullObject || undefined });
    if (noMedia && kind !== "video") continue;
    // Only media that plays can be remapped; a remapped clip's in and out are its own clock, not its media's.
    if (noMedia || (assets && assets[c.assetId]?.kind === "image")) effects = effects.filter((e) => e.type !== TIME_REMAP.type);
    const remapped = isRemapped({ effects });
    let out = c.out;
    // Without the media, a negative in-point may still be a valid still-image clip.
    let inPoint = c.in;
    if (assets && !noMedia) {
      const a = assets[c.assetId];
      if (!a || (kind === "video" ? !a.hasVideo : !a.hasAudio)) continue;
      if (!remapped) {
        const range = sourceRange(a);
        inPoint = Math.max(range.min, inPoint);
        out = Math.min(out, range.max);
      }
    }
    if (out - inPoint < MIN_CLIP_DURATION - EPS) continue;
    clipIds.add(c.id);
    // Only media that plays (not stills, or clips without media) has a speed and a direction.
    const retimable = !noMedia && !remapped && (!assets || assets[c.assetId]?.kind !== "image");
    const speed = retimable && isFiniteNumber(c.speed) && c.speed > 0 ? clampSpeed({ in: inPoint, out }, c.speed) : 1;
    const timing: Pick<Clip, "speed" | "reversed" | "keepPitch" | "timeInterpolation"> = {
      ...(speed !== 1 && { speed }),
      ...(retimable && c.reversed === true && { reversed: true as const }),
      ...(retimable && c.keepPitch === false && { keepPitch: false as const }),
      ...(!noMedia && (!assets || assets[c.assetId]?.kind !== "image") && kind === "video" && (c.timeInterpolation === "blend" || c.timeInterpolation === "flow") && { timeInterpolation: c.timeInterpolation }),
    };
    const clip: Clip = {
      id: c.id,
      assetId: noMedia ? "" : String(c.assetId),
      trackId: c.trackId,
      start: roundTime(Math.max(0, c.start)),
      in: roundSourceTime(timing, inPoint),
      out: roundSourceTime(timing, out),
      ...timing,
      effects,
    };
    // Only pictures have transitions (an adjustment layer has no picture of its own).
    const pictured = !drawsNothing({ effects, adjustment: adjustment || undefined, nullObject: nullObject || undefined });
    const transitionIn = kind === "video" && pictured ? sanitizeTransition(c.transitionIn) : undefined;
    const transitionOut = kind === "video" && pictured ? sanitizeTransition(c.transitionOut) : undefined;
    if (transitionIn) clip.transitionIn = transitionIn;
    if (transitionOut) clip.transitionOut = transitionOut;
    if (isTextClip(clip) && c.caption === true) clip.caption = true;
    if (adjustment) clip.adjustment = true;
    if (nullObject) clip.nullObject = true;
    const parent = kind === "video" ? sanitizeParent(c.parent) : undefined;
    if (parent) clip.parent = parent;
    const clipMarkers = normalizeMarkers(c.markers);
    if (clipMarkers.length) clip.markers = clipMarkers;
    clips.push(clip);
  }

  // Re-insert clips one by one (in time order) so any overlaps get resolved, as `addClip` would.
  const placed: Clip[] = [];
  const byTrack = new Map<string, { clips: Clip[]; end: number }>();
  for (const c of clips.sort((a, b) => a.start - b.start)) {
    let track = byTrack.get(c.trackId);
    if (!track) byTrack.set(c.trackId, (track = { clips: [], end: 0 }));
    // Usually nothing placed so far reaches past its start, so it stays put without a search.
    const start = c.start >= track.end - EPS ? c.start : findFreeStart(track.clips, c.start, clipDuration(c));
    const clip = start === c.start ? c : { ...c, start };
    placed.push(clip);
    track.clips.push(clip);
    track.end = Math.max(track.end, clipEnd(clip));
  }
  return { tracks, clips: pruneParents(placed) };
}
