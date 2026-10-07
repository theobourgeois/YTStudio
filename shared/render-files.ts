/**
 * Render files (Premiere's preview files, docs/render-files.md): the main sequence cut into segments, each
 * with a key that changes whenever anything its frames depend on does. The tab draws the render bar and plays the
 * files from these; the server names the files by them. Both run this same function, so they always agree.
 */
import { usesSignals } from "./audio-signals.ts";
import { clipKind, definitionOf, findEffect, hasMedia } from "./effects.ts";
import { isNestedClip, nestedSequence } from "./sequences.ts";
import { type TransitionWindow, trackTransitions } from "./transition-windows.ts";
import { clipEnd, clipsById, projectDuration, trackClips, videoTracks } from "./timeline.ts";
import type { Clip, ExportResolution, MediaAsset, Project, Sequence, Track } from "./types.ts";

/** A segment is at most this long (seconds), so a small change re-renders little. */
export const MAX_SEGMENT = 2;
/** The size render files are made at (the sequence's 1080p frame, as Premiere's preview files are). */
export const RENDER_RESOLUTION: ExportResolution = "1080p";
/** Bumped when what the renderer draws changes: every render file made before is stale. */
export const RENDER_VERSION = 1;

/** The media a segment's key says it showed: anything that changes its pictures. */
export type SegmentAsset = Pick<MediaAsset, "id" | "src" | "kind" | "duration" | "width" | "height" | "fps" | "hasAudio"> & Partial<Pick<MediaAsset, "reversed">>;

export interface RenderSegment {
  /** Frames [from, to) of the main sequence, on its frame grid. */
  from: number;
  to: number;
  /** What its frames depend on, hashed: its file's name. */
  key: string;
  /** It shows something worth rendering (effects, a transition, an adjustment layer, a nest, a 3D layer): red when it isn't. */
  heavy: boolean;
}

/** The first frame at or after time `t` (the export's grid, `planRender`'s). */
export const frameAt = (t: number, fps: number) => Math.ceil(t * fps - 1e-3);

/** Every segment of the main sequence, in time order. */
export function renderSegments(project: Project, assets: ReadonlyMap<string, SegmentAsset> | readonly SegmentAsset[]): RenderSegment[] {
  const byId = Array.isArray(assets) ? new Map((assets as readonly SegmentAsset[]).map((a) => [a.id, a])) : (assets as ReadonlyMap<string, SegmentAsset>);
  const fps = project.settings.fps;
  const total = frameAt(projectDuration(project), fps);
  if (!(total > 0)) return [];
  const tracks = videoTracks(project);
  const windows = new Map(tracks.map((t) => [t.id, trackTransitions(project, t.id)]));

  // Cut wherever what any video track shows changes, and every MAX_SEGMENT besides.
  const cuts = new Set<number>([0, total]);
  for (const track of tracks) {
    for (const clip of trackClips(project, track.id)) {
      cuts.add(frameAt(clip.start, fps));
      cuts.add(frameAt(clipEnd(clip), fps));
    }
    for (const w of windows.get(track.id) ?? []) {
      cuts.add(frameAt(w.start, fps));
      cuts.add(frameAt(w.end, fps));
    }
  }
  const edges = [...cuts].filter((f) => f >= 0 && f <= total).sort((a, b) => a - b);
  const longest = Math.max(1, Math.round(MAX_SEGMENT * fps));

  // What reacts to sound hears every clip that sounds: one list for every segment that does.
  let sound: string | null = null;
  const soundOf = () =>
    (sound ??= hash(
      stable([
        project.signals ?? null,
        project.tempo ?? null,
        project.tracks.filter((t) => t.kind === "audio"),
        project.clips.filter((c) => c.assetId && (byId.get(c.assetId)?.hasAudio || nestedSequence(project, c))).map(clipText),
      ]),
    ));

  // Each track's clips and transitions in time order (neither overlaps another of its track), each with a
  // cursor that only moves forward as the segments do: what's under each segment is found in one pass.
  const lanes: Lane[] = tracks.map((track) => ({
    track,
    clips: trackClips(project, track.id),
    windows: [...(windows.get(track.id) ?? [])].sort((a, b) => a.start - b.start),
    clip: 0,
    window: 0,
  }));
  const segments: RenderSegment[] = [];
  for (let i = 0; i + 1 < edges.length; i++) {
    for (let from = edges[i]; from < edges[i + 1]; from += longest) {
      const to = Math.min(edges[i + 1], from + longest);
      segments.push(segment(project, byId, lanes, from, to, soundOf));
    }
  }
  return segments;
}

/** A video track as the segments are walked: its clips and transitions, and the first of each not yet passed. */
interface Lane {
  track: Track;
  clips: readonly Clip[];
  windows: TransitionWindow[];
  clip: number;
  window: number;
}

/** The index of the segment showing frame `frame`, or -1 (segments in time order: a binary search). */
export function segmentIndexAt(segments: readonly RenderSegment[], frame: number): number {
  let lo = 0;
  let hi = segments.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const s = segments[mid];
    if (frame < s.from) hi = mid - 1;
    else if (frame >= s.to) lo = mid + 1;
    else return mid;
  }
  return -1;
}

/** The segment showing frame `frame`, or null. */
export function segmentAt(segments: readonly RenderSegment[], frame: number): RenderSegment | null {
  return segments[segmentIndexAt(segments, frame)] ?? null;
}

function segment(
  project: Project,
  assets: ReadonlyMap<string, SegmentAsset>,
  lanes: Lane[],
  from: number,
  to: number,
  soundOf: () => string,
): RenderSegment {
  const fps = project.settings.fps;
  const byId = clipsById(project);
  let heavy = false;
  let hears = false;

  // What each video track shows, top first: its clips under the segment (and the ones its transitions show).
  const shown = new Set<Clip>();
  const tracks = lanes.map((lane) => {
    const { track } = lane;
    while (lane.clip < lane.clips.length && frameAt(clipEnd(lane.clips[lane.clip]), fps) <= from) lane.clip++;
    while (lane.window < lane.windows.length && frameAt(lane.windows[lane.window].end, fps) <= from) lane.window++;
    const clips = new Set<Clip>();
    for (let k = lane.clip; k < lane.clips.length && frameAt(lane.clips[k].start, fps) < to; k++) {
      if (frameAt(clipEnd(lane.clips[k]), fps) > from) clips.add(lane.clips[k]);
    }
    const transitions: TransitionWindow[] = [];
    for (let k = lane.window; k < lane.windows.length && frameAt(lane.windows[k].start, fps) < to; k++) {
      if (frameAt(lane.windows[k].end, fps) > from) transitions.push(lane.windows[k]);
    }
    for (const w of transitions) {
      heavy = true;
      if (w.from) clips.add(w.from);
      if (w.to) clips.add(w.to);
    }
    for (const clip of clips) shown.add(clip);
    return { id: track.id, muted: track.muted, clips: [...clips].sort((a, b) => a.start - b.start).map((c) => c.id) };
  });

  // And what those depend on: their parents, the sequences they nest (and what those nest), their media.
  const clips = new Map<string, Clip>();
  const sequences = new Map<string, Sequence>();
  const media = new Set<string>();
  const add = (clip: Clip, inside: Project | Sequence) => {
    if (clips.has(clip.id)) return;
    clips.set(clip.id, clip);
    const facts = factsOf(clip);
    if (facts.heavy) heavy = true;
    if (facts.hears) hears = true;
    const seq = nestedSequence(project, clip);
    if (seq && !sequences.has(seq.id)) {
      sequences.set(seq.id, seq);
      for (const inner of seq.clips) add(inner, seq);
    } else if (hasMedia(clip) && clip.assetId) media.add(clip.assetId);
    const parent = clip.parent && (inside === project ? byId.get(clip.parent.id) : inside.clips.find((c) => c.id === clip.parent!.id));
    if (parent) add(parent, inside);
  };
  for (const clip of shown) add(clip, project);

  // Everything as one line of the pieces' own hashes (each worked out once per object).
  const key = hash(
    [
      RENDER_VERSION,
      RENDER_RESOLUTION,
      settingsText(project.settings),
      from,
      to,
      tracks.map((t) => `${t.id}:${t.muted ? 1 : 0}:${t.clips.join(",")}`).join(";"),
      [...clips.values()].sort((a, b) => (a.id < b.id ? -1 : 1)).map(clipText).join(","),
      [...sequences.values()].sort((a, b) => (a.id < b.id ? -1 : 1)).map(sequenceText).join(","),
      [...media].sort().map((id) => assetText(assets.get(id), id)).join(","),
      hears ? soundOf() : "",
    ].join("|"),
  );
  return { from, to, key, heavy };
}

/** What a clip says about a segment it's in: worth rendering, and hearing the sound (worked out once per clip object). */
const facts = new WeakMap<Clip, { heavy: boolean; hears: boolean }>();
function factsOf(clip: Clip): { heavy: boolean; hears: boolean } {
  let known = facts.get(clip);
  if (!known) facts.set(clip, (known = { heavy: isHeavy(clip), hears: usesSignals({ clips: [clip] } as Project) }));
  return known;
}

/** Whether a clip makes its segment worth rendering: what costs the GPU more than drawing a picture. */
function isHeavy(clip: Clip): boolean {
  const kind = clipKind(clip);
  if (kind === "adjustment") return true;
  if (isNestedClip(clip)) return true;
  const motion = findEffect(clip, "motion")?.params;
  if (motion?.threeD === true || motion?.motionBlur === true) return true;
  return clip.effects.some((e) => e.enabled && !!definitionOf(e)?.shader);
}

// Hashed once per clip or sequence object (they're never changed in place), so an edit hashes only what it changed.
const clipHashes = new WeakMap<Clip, string>();
const sequenceHashes = new WeakMap<Sequence, string>();
const clipText = (clip: Clip) => {
  let text = clipHashes.get(clip);
  if (text === undefined) clipHashes.set(clip, (text = hash(stable(clip))));
  return text;
};
const sequenceText = (seq: Sequence) => {
  let text = sequenceHashes.get(seq);
  if (text === undefined) sequenceHashes.set(seq, (text = hash(stable(seq))));
  return text;
};
const assetTexts = new WeakMap<SegmentAsset, string>();
const assetText = (asset: SegmentAsset | undefined, id: string) => {
  if (!asset) return `missing:${id}`;
  let text = assetTexts.get(asset);
  if (text === undefined) {
    text = hash(stable([asset.id, asset.src, asset.kind, asset.duration, asset.width, asset.height, asset.fps, asset.reversed?.status ?? null]));
    assetTexts.set(asset, text);
  }
  return text;
};
const settingsTexts = new WeakMap<object, string>();
const settingsText = (settings: Project["settings"]) => {
  let text = settingsTexts.get(settings);
  if (text === undefined) settingsTexts.set(settings, (text = stable(settings)));
  return text;
};

/** JSON with every object's keys in order, so the same content always reads the same. */
export function stable(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map((v) => (v === undefined ? "null" : stable(v))).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stable(v)}`).join(",")}}`;
}

/** A 106-bit hash of a string as 27 hex digits (two cyrb53s): a file name, not a secret. */
export function hash(text: string): string {
  const half = (seed: number) => {
    let h1 = 0xdeadbeef ^ seed;
    let h2 = 0x41c6ce57 ^ seed;
    for (let i = 0; i < text.length; i++) {
      const ch = text.charCodeAt(i);
      h1 = Math.imul(h1 ^ ch, 2654435761);
      h2 = Math.imul(h2 ^ ch, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16).padStart(14, "0");
  };
  return half(1) + half(2).slice(1);
}
