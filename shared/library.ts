/**
 * The Library: media and saved clips shared by every project. Pure helpers for
 * its folder tree and for saved clips (`ClipTemplate`), used by the server
 * (validation) and the client (placing saved clips on a timeline).
 */
import { roundTime } from "./math.ts";
import { normalizeProject } from "./normalize.ts";
import { addTrack, clipDuration, clipEnd, createDefaultProject, createId, getTrack, isFree } from "./timeline.ts";
import type { Clip, ClipTemplate, LibraryFolder, LibraryItem, MediaAsset, Project, TrackKind } from "./types.ts";

/** The Library media an item uses: its file, or every file its saved clips show. */
export function itemMediaIds(item: LibraryItem): string[] {
  if (item.kind === "media") return [item.mediaId];
  return [...new Set(item.template.clips.map((c) => c.assetId).filter(Boolean))];
}

/** A folder and the folders it's in, from the top level down (empty for an unknown id). */
export function folderPath(folders: LibraryFolder[], id: string | null): LibraryFolder[] {
  const byId = new Map(folders.map((f) => [f.id, f]));
  const path: LibraryFolder[] = [];
  const seen = new Set<string>();
  for (let f = id ? byId.get(id) : undefined; f && !seen.has(f.id); f = f.parentId ? byId.get(f.parentId) : undefined) {
    seen.add(f.id);
    path.unshift(f);
  }
  return path;
}

/** A folder's id plus the ids of every folder inside it, at any depth. */
export function folderSubtree(folders: LibraryFolder[], id: string): Set<string> {
  const ids = new Set([id]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const f of folders) {
      if (f.parentId && ids.has(f.parentId) && !ids.has(f.id)) {
        ids.add(f.id);
        grew = true;
      }
    }
  }
  return ids;
}

/** Whether a folder can go into `parentId` (not into itself or one of its own subfolders). */
export function canMoveFolder(folders: LibraryFolder[], id: string, parentId: string | null): boolean {
  return parentId === null || !folderSubtree(folders, id).has(parentId);
}

/** Folders in tree order (each followed by its subfolders, siblings A to Z) with their depth. */
export function flattenFolders(folders: LibraryFolder[]): { folder: LibraryFolder; depth: number }[] {
  const children = new Map<string | null, LibraryFolder[]>();
  for (const f of folders) children.set(f.parentId, [...(children.get(f.parentId) ?? []), f]);
  const out: { folder: LibraryFolder; depth: number }[] = [];
  const visit = (parentId: string | null, depth: number) => {
    const list = [...(children.get(parentId) ?? [])].sort((a, b) => a.name.localeCompare(b.name));
    for (const folder of list) {
      out.push({ folder, depth });
      visit(folder.id, depth + 1);
    }
  };
  visit(null, 0);
  return out;
}

// ---------------------------------------------------------------------------
// Saved clips
// ---------------------------------------------------------------------------

/** The selected clips and the tracks they're on (in display order), as they are on the timeline. */
export function templateFromClips(project: Project, clipIds: string[]): ClipTemplate {
  const ids = new Set(clipIds);
  const clips = project.clips.filter((c) => ids.has(c.id));
  const used = new Set(clips.map((c) => c.trackId));
  return { tracks: project.tracks.filter((t) => used.has(t.id)), clips };
}

/**
 * Validate saved clips (untrusted) against the media they use, like a project:
 * see `normalizeProject`. Keeps only tracks with clips and moves everything so
 * the earliest clip starts at 0. Null when no clip is left.
 */
export function normalizeTemplate(
  input: ClipTemplate,
  assets: Record<string, Pick<MediaAsset, "kind" | "duration" | "hasVideo" | "hasAudio">>,
): ClipTemplate | null {
  const project = normalizeProject(
    {
      ...createDefaultProject(),
      tracks: Array.isArray(input?.tracks) ? input.tracks : [],
      clips: Array.isArray(input?.clips) ? input.clips : [],
    },
    assets,
  );
  if (project.clips.length === 0) return null;
  const first = Math.min(...project.clips.map((c) => c.start));
  const used = new Set(project.clips.map((c) => c.trackId));
  return {
    tracks: project.tracks.filter((t) => used.has(t.id)),
    clips: project.clips.map((c) => ({ ...c, start: roundTime(c.start - first) })),
  };
}

/** Point a template's clips at other media (e.g. the project's copies of its Library media). */
export function remapTemplateAssets(template: ClipTemplate, assetIds: ReadonlyMap<string, string>): ClipTemplate {
  return {
    ...template,
    clips: template.clips.map((c) => (c.assetId ? { ...c, assetId: assetIds.get(c.assetId) ?? c.assetId } : c)),
  };
}

export function templateDuration(template: ClipTemplate): number {
  if (template.clips.length === 0) return 0;
  return roundTime(Math.max(...template.clips.map(clipEnd)) - Math.min(...template.clips.map((c) => c.start)));
}

export interface PlaceTemplateOptions {
  /** Timeline time of the earliest clip (default 0). */
  at?: number;
  /** Track dropped on: the template's first track of that kind goes there if the clips fit. */
  trackId?: string;
  /** Dropped above the top track or below the bottom one: always on new tracks there. */
  newTrack?: "above" | "below";
}

/**
 * Put copies of saved clips on the timeline, keeping their timing and their
 * tracks' order. Each kind of track is placed on its own:
 * - video: on consecutive existing tracks from the one dropped on (default: the
 *   top one, so saved overlays show on top) when every clip fits there, else on
 *   new tracks at that place;
 * - audio: from the track dropped on, else the first run of tracks where
 *   everything fits, else on new tracks at the bottom.
 */
export function placeTemplate(
  project: Project,
  template: ClipTemplate,
  opts: PlaceTemplateOptions = {},
): { project: Project; clipIds: string[] } {
  if (template.clips.length === 0) return { project, clipIds: [] };
  const offset = Math.max(0, opts.at ?? 0) - Math.min(...template.clips.map((c) => c.start));
  const groups = template.tracks
    .map((track) => ({
      kind: track.kind,
      clips: template.clips
        .filter((c) => c.trackId === track.id)
        .map((c): Clip => ({ ...c, id: createId("clip"), start: roundTime(Math.max(0, c.start + offset)) })),
    }))
    .filter((g) => g.clips.length > 0);

  let p = project;
  const placed: Clip[] = [];
  for (const kind of ["video", "audio"] as TrackKind[]) {
    const own = groups.filter((g) => g.kind === kind);
    if (own.length === 0) continue;
    const tracks = p.tracks.filter((t) => t.kind === kind);
    const fitsFrom = (first: number) =>
      own.every((g, i) => {
        const track = tracks[first + i];
        return !!track && g.clips.every((c) => isFree(p, track.id, c.start, clipDuration(c)));
      });

    const target = opts.trackId ? getTrack(p, opts.trackId) : undefined;
    const onNew = opts.newTrack === (kind === "video" ? "above" : "below");
    const dropped = target?.kind === kind ? tracks.indexOf(target) : -1;
    let candidates: number[];
    if (onNew) candidates = [];
    else if (dropped >= 0) candidates = [dropped];
    else if (kind === "video") candidates = [0];
    else candidates = tracks.map((_, i) => i);
    const first = candidates.find(fitsFrom);

    let ids: string[];
    if (first !== undefined) {
      ids = own.map((_, i) => tracks[first + i].id);
    } else {
      // New tracks: video ones go above the track dropped on (or on top), audio ones at the bottom.
      ids = [];
      if (kind === "video") {
        const index = !onNew && dropped >= 0 ? p.tracks.indexOf(tracks[dropped]) : 0;
        for (let i = own.length - 1; i >= 0; i--) {
          const added = addTrack(p, "video", index);
          p = added.project;
          ids.unshift(added.trackId);
        }
      } else {
        for (let i = 0; i < own.length; i++) {
          const added = addTrack(p, "audio");
          p = added.project;
          ids.push(added.trackId);
        }
      }
    }
    own.forEach((g, i) => placed.push(...g.clips.map((c) => ({ ...c, trackId: ids[i] }))));
  }
  return { project: { ...p, clips: [...p.clips, ...placed] }, clipIds: placed.map((c) => c.id) };
}

// ---------------------------------------------------------------------------
// Browsing
// ---------------------------------------------------------------------------

/** What an item is, for filtering and display. */
export type LibraryItemKind = "video" | "audio" | "image" | "clips";

export function libraryItemKind(item: LibraryItem, media: ReadonlyMap<string, MediaAsset>): LibraryItemKind {
  if (item.kind === "clips") return "clips";
  return media.get(item.mediaId)?.kind ?? "video";
}

/** How long an item lasts on the timeline (0 when its media is missing). */
export function libraryItemDuration(item: LibraryItem, media: ReadonlyMap<string, MediaAsset>): number {
  return item.kind === "clips" ? templateDuration(item.template) : (media.get(item.mediaId)?.duration ?? 0);
}

/** The Library media whose picture stands for an item: its file, or the bottom picture of its saved clips. */
export function libraryItemCover(item: LibraryItem, media: ReadonlyMap<string, MediaAsset>): MediaAsset | undefined {
  if (item.kind === "media") return media.get(item.mediaId);
  const { tracks, clips } = item.template;
  const layer = (c: Clip) => tracks.findIndex((t) => t.id === c.trackId);
  const pictures = clips
    .filter((c) => c.assetId && tracks[layer(c)]?.kind === "video")
    .sort((a, b) => layer(b) - layer(a) || a.start - b.start);
  return media.get(pictures[0]?.assetId ?? "") ?? media.get(clips.find((c) => c.assetId)?.assetId ?? "");
}

/** Whether `a` and `b` are the same name, ignoring case and surrounding spaces. */
export function sameName(a: string, b: string): boolean {
  return a.trim().localeCompare(b.trim(), undefined, { sensitivity: "accent" }) === 0;
}

/** Items matching a search (by name, any word order), best matches first. */
export function searchItems(items: LibraryItem[], query: string): LibraryItem[] {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return items;
  const score = (item: LibraryItem) => {
    const name = item.name.toLowerCase();
    if (!words.every((w) => name.includes(w))) return -1;
    return name.startsWith(words[0]) ? 2 : name.split(/[\s_\-.]+/).some((part) => part.startsWith(words[0])) ? 1 : 0;
  };
  return items
    .map((item) => ({ item, s: score(item) }))
    .filter((x) => x.s >= 0)
    .sort((a, b) => b.s - a.s || a.item.name.localeCompare(b.item.name, undefined, { numeric: true, sensitivity: "base" }))
    .map((x) => x.item);
}

/** How many items "Recent" shows. */
export const RECENT_LIMIT = 24;

/** The most recently used items, newest first. */
export function recentItems(items: LibraryItem[]): LibraryItem[] {
  return items
    .filter((i) => i.usedAt !== null)
    .sort((a, b) => (b.usedAt ?? 0) - (a.usedAt ?? 0))
    .slice(0, RECENT_LIMIT);
}
