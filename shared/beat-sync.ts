/**
 * Beat sync: a song's beats as markers on its clip (so clips, keyframes and the playhead
 * snap to them), and cutting clips to the markers so every cut lands on one. The beats
 * themselves come from the server's analysis (`MusicAnalysis`, `server/beats.ts`).
 */
import { EPS, roundTime, tidy } from "./math.ts";
import { isRemapped } from "./effects.ts";
import { allMarkers } from "./markers.ts";
import { MIN_CLIP_DURATION, clipDuration, clipEnd, clipSpeed, createId, getClip, roundSourceTime, trackClips } from "./timeline.ts";
import type { Clip, Marker, MusicAnalysis, Project } from "./types.ts";

/** Which of a song's moments to mark. */
export type BeatMarks = "beats" | "bars" | "drops";

export const BEAT_MARKS: readonly { value: BeatMarks; label: string }[] = [
  { value: "beats", label: "Every beat" },
  { value: "bars", label: "Every bar" },
  { value: "drops", label: "Drops only" },
];

/** The source times to mark for a song, in order. Bars are blue, drops red and named; plain beats the usual green. */
export function beatMarks(music: MusicAnalysis, which: BeatMarks): Pick<Marker, "time" | "label" | "color">[] {
  const drops = new Set(music.drops.map((d) => roundTime(d.time)));
  const bars = new Set(music.downbeats.map(roundTime));
  const times = which === "drops" ? music.drops.map((d) => d.time) : which === "bars" ? music.downbeats : music.beats;
  return [...new Set(times.map(roundTime))]
    .sort((a, b) => a - b)
    .map((time) => ({
      time,
      ...(drops.has(time) ? { label: "Drop", color: "red" as const } : which === "beats" && bars.has(time) ? { color: "blue" as const } : {}),
    }));
}

/**
 * Give a clip these beat markers (source times), in place of the beat markers it had; with
 * none, its beat markers are just removed. Markers the user put on it stay (a beat landing
 * on one leaves it alone). The same project when nothing changes.
 */
export function setBeatMarkers(project: Project, clipId: string, marks: readonly Pick<Marker, "time" | "label" | "color">[]): Project {
  const clip = getClip(project, clipId);
  if (!clip) return project;
  const own = (clip.markers ?? []).filter((m) => !m.beat);
  if (!marks.length && own.length === (clip.markers?.length ?? 0)) return project;
  const beats: Marker[] = marks
    .filter((b) => !own.some((m) => Math.abs(m.time - b.time) < 1e-3))
    .map((b) => ({ id: createId("marker"), time: tidy(b.time), ...(b.label && { label: b.label }), ...(b.color && { color: b.color }), beat: true as const }));
  const markers = [...own, ...beats].sort((a, b) => a.time - b.time);
  const next: Clip = { ...clip, markers };
  if (!markers.length) delete next.markers;
  return { ...project, clips: project.clips.map((c) => (c === clip ? next : c)) };
}

/** How many beat markers a clip has. */
export const beatMarkerCount = (clip: Pick<Clip, "markers">) => clip.markers?.filter((m) => m.beat).length ?? 0;

export interface CutOptions {
  /** A cut on every Nth marker from each clip's start; absent: each clip ends on the marker nearest to where it ends now. */
  every?: number;
  /** The most a clip can play (its media's source range); absent for one that can be any length (text, stills, layers). */
  range: (clip: Clip) => { min: number; max: number } | undefined;
}

/**
 * Cut clips to the beat: each one's end moves to a marker (any marker on the timeline that
 * isn't on the clips themselves), and whatever comes after it on its track moves along, so
 * clips that were back to back stay so and every cut between them lands on a marker. A clip
 * is only made longer as far as its media goes; then it ends on the last marker it reaches.
 * `moved` is how many clips changed length.
 */
export function cutToMarkers(project: Project, clipIds: readonly string[], opts: CutOptions): { project: Project; moved: number } {
  // The song itself (a clip carrying beat markers) isn't cut to its own beats.
  const ids = new Set(clipIds.filter((id) => !beatMarkerCount(getClip(project, id) ?? {})));
  const beats = [...new Set(allMarkers(project, ids).map((m) => m.time))].sort((a, b) => a - b);
  if (!beats.length || !ids.size) return { project, moved: 0 };
  const changed = new Map<string, Clip>();
  let moved = 0;
  for (const trackId of new Set(project.clips.filter((c) => ids.has(c.id)).map((c) => c.trackId))) {
    // How far everything from here on has moved (clips before the first one cut stay put).
    let offset = 0;
    for (const clip of trackClips(project, trackId)) {
      const start = roundTime(clip.start + offset);
      if (!ids.has(clip.id)) {
        if (offset !== 0) changed.set(clip.id, { ...clip, start });
        continue;
      }
      const duration = clipDuration(clip);
      const speed = clipSpeed(clip);
      const range = opts.range(clip);
      // A remapped clip's length is its remap's; media only goes as far as the file does.
      const most = isRemapped(clip)
        ? duration
        : range
          ? clip.reversed
            ? (clip.out - range.min) / speed
            : (range.max - clip.in) / speed
          : Infinity;
      const reachable = beats.filter((b) => b > start + MIN_CLIP_DURATION - EPS && b <= start + most + 1e-3);
      let end: number | undefined;
      if (opts.every && opts.every >= 1) {
        const after = beats.filter((b) => b > start + 1e-3);
        const wanted = after[Math.round(opts.every) - 1];
        end = wanted !== undefined && wanted <= start + most + 1e-3 && wanted > start + MIN_CLIP_DURATION - EPS ? wanted : reachable.at(-1);
      } else {
        const now = start + duration;
        end = reachable.reduce<number | undefined>((best, b) => (best === undefined || Math.abs(b - now) < Math.abs(best - now) ? b : best), undefined);
      }
      const length = end === undefined ? duration : Math.min(most, end - start);
      const next: Clip = { ...clip, start };
      if (Math.abs(length - duration) > 1e-6) {
        // Its end edge is where its source runs out: `out`, or played backwards `in`.
        if (clip.reversed) next.in = roundSourceTime(clip, clip.out - length * speed);
        else next.out = roundSourceTime(clip, clip.in + length * speed);
        moved++;
      }
      if (next.start !== clip.start || next.in !== clip.in || next.out !== clip.out) changed.set(clip.id, next);
      offset = roundTime(clipEnd(next) - clipEnd(clip));
    }
  }
  if (!changed.size) return { project, moved: 0 };
  return { project: { ...project, clips: project.clips.map((c) => changed.get(c.id) ?? c) }, moved };
}
