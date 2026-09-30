/**
 * Repairing projects from untrusted storage (a saved document, an export
 * request): the one place that decides what a valid project is. It runs when
 * a project is loaded, saved and exported, so a new field on `Project`,
 * `Track` or `Clip` must be validated here (and old documents upgraded here),
 * or it's dropped.
 */
import { clipKind, drawsNothing, hasMedia, isTextClip, normalizeEffects } from "./effects.ts";
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
import { normalizeSubclips } from "./subclips.ts";
import { sanitizeTransition } from "./transitions.ts";
import type { Clip, MediaAsset, Project, Track, TrackKind } from "./types.ts";

/** Clips saved before effects existed kept their volume and framing on the clip. */
type LegacyClip = { volume?: unknown; fit?: unknown };

/**
 * Repair a project from untrusted storage: guarantees at least one video
 * track, video tracks before audio tracks, drops invalid clips (unknown
 * track/asset, non-positive length, out of source range), validates effects
 * (upgrading clips saved before effects existed) and subclips, clamps values and
 * resolves overlaps. Pass `assets` to also validate clips against their media.
 */
export function normalizeProject(
  input: Project,
  assets?: Record<string, Pick<MediaAsset, "kind" | "duration" | "hasVideo" | "hasAudio">>,
): Project {
  const base = createDefaultProject();
  const tracksIn = Array.isArray(input?.tracks) ? input.tracks : [];
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
  for (const c of Array.isArray(input?.clips) ? input.clips : []) {
    if (!c || typeof c.id !== "string" || clipIds.has(c.id)) continue;
    const kind = trackKind.get(c.trackId);
    if (!kind) continue;
    const nums = [c.start, c.in, c.out];
    if (!nums.every((n) => typeof n === "number" && Number.isFinite(n))) continue;
    const effects = normalizeEffects(c.effects, Array.isArray(c.effects) ? undefined : (c as LegacyClip));
    // Text, solids and adjustment layers have no media, and are only ever drawn on a video track.
    const adjustment = c.adjustment === true && clipKind({ effects }) === "media";
    const noMedia = !hasMedia({ effects, adjustment: adjustment || undefined });
    if (noMedia && kind !== "video") continue;
    let out = c.out;
    // Without the media, a negative in-point may still be a valid still-image clip.
    let inPoint = c.in;
    if (assets && !noMedia) {
      const a = assets[c.assetId];
      if (!a || (kind === "video" ? !a.hasVideo : !a.hasAudio)) continue;
      const range = sourceRange(a);
      inPoint = Math.max(range.min, inPoint);
      out = Math.min(out, range.max);
    }
    if (out - inPoint < MIN_CLIP_DURATION - EPS) continue;
    clipIds.add(c.id);
    // Only media that plays (not stills, or clips without media) has a speed and a direction.
    const retimable = !noMedia && (!assets || assets[c.assetId]?.kind !== "image");
    const speed = retimable && isFiniteNumber(c.speed) && c.speed > 0 ? clampSpeed({ in: inPoint, out }, c.speed) : 1;
    const timing: Pick<Clip, "speed" | "reversed" | "keepPitch" | "timeInterpolation"> = {
      ...(speed !== 1 && { speed }),
      ...(retimable && c.reversed === true && { reversed: true as const }),
      ...(retimable && c.keepPitch === false && { keepPitch: false as const }),
      ...(retimable && kind === "video" && (c.timeInterpolation === "blend" || c.timeInterpolation === "flow") && { timeInterpolation: c.timeInterpolation }),
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
    const pictured = !drawsNothing({ effects, adjustment: adjustment || undefined });
    const transitionIn = kind === "video" && pictured ? sanitizeTransition(c.transitionIn) : undefined;
    const transitionOut = kind === "video" && pictured ? sanitizeTransition(c.transitionOut) : undefined;
    if (transitionIn) clip.transitionIn = transitionIn;
    if (transitionOut) clip.transitionOut = transitionOut;
    if (isTextClip(clip) && c.caption === true) clip.caption = true;
    if (adjustment) clip.adjustment = true;
    clips.push(clip);
  }

  const project: Project = {
    version: 1,
    name: typeof input?.name === "string" && input.name ? input.name : base.name,
    settings: {
      aspectRatio: ASPECT_RATIOS.includes(input?.settings?.aspectRatio)
        ? input.settings.aspectRatio
        : base.settings.aspectRatio,
      fps: clamp(Math.round(Number(input?.settings?.fps) || base.settings.fps), 1, 120),
    },
    tracks,
    clips: [],
  };

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
  const subclips = normalizeSubclips(input?.subclips, assets);
  return { ...project, clips: placed, ...(subclips.length > 0 && { subclips }) };
}
