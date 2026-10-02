/**
 * The Playlist's time markers (FL's, `docs/fl-studio/playlist.md`): named places on its ruler, and the
 * Start and Stop recording markers that punch a recording in and out. Pure edits that return the same song
 * when nothing changes, as every edit does.
 */
import { MAX_NAME, MAX_SONG_TICKS } from "./project.ts";
import { MARKER_KINDS, type MarkerKind, type MusicProject, type TimeMarker } from "./types.ts";

/** The most markers a song has. */
export const MAX_MARKERS = 500;

const NO_MARKERS: readonly TimeMarker[] = [];
/** The song's markers, in order of tick (a shared empty list when it has none). */
export const markersOf = (song: Pick<MusicProject, "playlist">): readonly TimeMarker[] => song.playlist.markers ?? NO_MARKERS;

const byTick = (a: TimeMarker, b: TimeMarker) => a.tick - b.tick || a.id - b.id;
const withMarkers = (song: MusicProject, markers: TimeMarker[]): MusicProject => {
  const { markers: _old, ...playlist } = song.playlist;
  return { ...song, playlist: markers.length ? { ...playlist, markers: markers.sort(byTick) } : playlist };
};

/** What a new marker of a kind is called: FL's names, or the next "Marker N". */
export function markerName(song: MusicProject, kind: MarkerKind): string {
  if (kind === "punchIn") return "Start recording";
  if (kind === "punchOut") return "Stop recording";
  const taken = new Set(markersOf(song).map((m) => m.name));
  for (let n = 1; ; n++) if (!taken.has(`Marker ${n}`)) return `Marker ${n}`;
}

/** Add a marker at `tick`; returns the song and its id (null if there's no room). */
export function addMarker(song: MusicProject, tick: number, options: { name?: string; kind?: MarkerKind } = {}): { song: MusicProject; id: number | null } {
  const markers = markersOf(song);
  if (markers.length >= MAX_MARKERS) return { song, id: null };
  const kind = options.kind && MARKER_KINDS.includes(options.kind) ? options.kind : "marker";
  const id = markers.reduce((max, m) => Math.max(max, m.id), 0) + 1;
  const name = options.name?.trim().slice(0, MAX_NAME) || markerName(song, kind);
  return { song: withMarkers(song, [...markers, { id, tick: clampTick(tick), name, kind }]), id };
}

const clampTick = (tick: number) => Math.min(MAX_SONG_TICKS - 1, Math.max(0, Math.round(tick)));

export type MarkerPatch = Partial<Pick<TimeMarker, "tick" | "name" | "kind">>;

/** Change a marker: where it is, its name, its kind. */
export function updateMarker(song: MusicProject, id: number, patch: MarkerPatch): MusicProject {
  const markers = markersOf(song);
  const at = markers.findIndex((m) => m.id === id);
  if (at < 0) return song;
  const now = markers[at];
  const next: TimeMarker = {
    ...now,
    tick: patch.tick === undefined ? now.tick : clampTick(patch.tick),
    name: patch.name === undefined ? now.name : patch.name.trim().slice(0, MAX_NAME) || now.name,
    kind: patch.kind && MARKER_KINDS.includes(patch.kind) ? patch.kind : now.kind,
  };
  if (next.tick === now.tick && next.name === now.name && next.kind === now.kind) return song;
  return withMarkers(song, markers.map((m, i) => (i === at ? next : m)));
}

export function removeMarker(song: MusicProject, id: number): MusicProject {
  const markers = markersOf(song);
  return markers.some((m) => m.id === id) ? withMarkers(song, markers.filter((m) => m.id !== id)) : song;
}

/** The markers from a saved song, checked (ids made unique, out-of-range ticks brought in). */
export function normalizeMarkers(input: unknown): TimeMarker[] | undefined {
  if (!Array.isArray(input)) return undefined;
  const seen = new Set<number>();
  const markers: TimeMarker[] = [];
  for (const raw of input.slice(0, MAX_MARKERS)) {
    if (typeof raw !== "object" || raw === null) continue;
    const r = raw as Record<string, unknown>;
    if (typeof r.tick !== "number" || !Number.isFinite(r.tick)) continue;
    let id = Number.isInteger(r.id) && (r.id as number) > 0 ? (r.id as number) : 0;
    if (!id || seen.has(id)) id = Math.max(0, ...seen) + 1;
    seen.add(id);
    const kind = MARKER_KINDS.includes(r.kind as MarkerKind) ? (r.kind as MarkerKind) : "marker";
    markers.push({ id, tick: clampTick(r.tick), name: typeof r.name === "string" && r.name.trim() ? r.name.trim().slice(0, MAX_NAME) : "Marker", kind });
  }
  return markers.length ? markers.sort(byTick) : undefined;
}

/**
 * Where a recording is punched in and out (FL's Start and Stop recording markers): the first start marker
 * at or after `from` and the first stop marker after it (or none: on to the end). Null without a start marker.
 */
export function punchRange(song: Pick<MusicProject, "playlist">, from: number): { start: number; end: number | null } | null {
  const markers = markersOf(song);
  const start = markers.find((m) => m.kind === "punchIn" && m.tick >= from);
  if (!start) return null;
  const end = markers.find((m) => m.kind === "punchOut" && m.tick > start.tick);
  return { start: start.tick, end: end?.tick ?? null };
}

/** The last named marker (not a recording one) past `after`, or null: where an export of the song ends, if any (FL's). */
export function lastMarkerAfter(song: Pick<MusicProject, "playlist">, after: number): number | null {
  const markers = markersOf(song).filter((m) => m.kind === "marker" && m.tick > after);
  return markers.length ? markers[markers.length - 1].tick : null;
}
