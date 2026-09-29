/**
 * Subclips (Premiere's Make Subclip): named parts of a media file, kept on the project and
 * listed in the Media tab like files. Pure edits: each returns the same project when nothing changed.
 */
import { EPS, clamp, isFiniteNumber, roundTime } from "./math.ts";
import { MIN_CLIP_DURATION, createId } from "./timeline.ts";
import type { MediaAsset, Project, Subclip } from "./types.ts";

/** Longest name a subclip keeps. */
export const MAX_SUBCLIP_NAME = 120;

const NONE: readonly Subclip[] = [];

/** The project's subclips (none on projects that never had any). */
export function projectSubclips(project: Pick<Project, "subclips">): readonly Subclip[] {
  return project.subclips ?? NONE;
}

export function getSubclip(project: Pick<Project, "subclips">, id: string): Subclip | undefined {
  return project.subclips?.find((s) => s.id === id);
}

const byAssetCache = new WeakMap<readonly Subclip[], ReadonlyMap<string, readonly Subclip[]>>();

/** Each file's subclips, in the order they were made (cached per list, like `trackClips`: don't mutate). */
export function subclipsByAsset(project: Pick<Project, "subclips">): ReadonlyMap<string, readonly Subclip[]> {
  const list = projectSubclips(project);
  let map = byAssetCache.get(list);
  if (!map) {
    const groups = new Map<string, Subclip[]>();
    for (const s of list) {
      const group = groups.get(s.assetId);
      if (group) group.push(s);
      else groups.set(s.assetId, [s]);
    }
    byAssetCache.set(list, (map = groups));
  }
  return map;
}

/** Media that can have subclips: a file that plays (not a still). */
export function canSubclip(asset: Pick<MediaAsset, "kind" | "duration">): boolean {
  return asset.kind !== "image" && asset.duration > 0;
}

/** From `from` to `to` inside a file of `duration` (either order), or null when that's too short to be a clip. */
export function subclipRange(from: number, to: number, duration: number): { in: number; out: number } | null {
  if (!isFiniteNumber(from) || !isFiniteNumber(to) || !(duration > 0)) return null;
  const inPoint = roundTime(clamp(Math.min(from, to), 0, duration));
  const out = roundTime(clamp(Math.max(from, to), 0, duration));
  return out - inPoint >= MIN_CLIP_DURATION - EPS ? { in: inPoint, out } : null;
}

/** A usable name, or null when there's nothing left of it. */
export function cleanSubclipName(name: unknown): string | null {
  if (typeof name !== "string") return null;
  const clean = name.replace(/\s+/g, " ").trim().slice(0, MAX_SUBCLIP_NAME).trim();
  return clean || null;
}

/** What a new subclip of `asset` is called: the file's name without its extension, numbered ("Interview 3"). */
export function nextSubclipName(project: Pick<Project, "subclips">, asset: Pick<MediaAsset, "name">, taken?: Set<string>): string {
  const base = cleanSubclipName(asset.name.replace(/\.[^./]+$/, ""))?.slice(0, MAX_SUBCLIP_NAME - 5) ?? "Subclip";
  const names = taken ?? new Set(projectSubclips(project).map((s) => s.name));
  for (let n = 1; ; n++) {
    const name = `${base} ${n}`;
    if (!names.has(name)) return name;
  }
}

export interface NewSubclip {
  in: number;
  out: number;
  name?: string;
}

/**
 * Add subclips of `asset`, after the ones already there. A part that's too short (see
 * `subclipRange`) is skipped; one without a name gets `nextSubclipName`. Returns the new ids
 * in the order of `parts`.
 */
export function addSubclips(
  project: Project,
  asset: Pick<MediaAsset, "id" | "name" | "kind" | "duration">,
  parts: readonly NewSubclip[],
): { project: Project; ids: string[] } {
  if (!canSubclip(asset)) return { project, ids: [] };
  const taken = new Set(projectSubclips(project).map((s) => s.name));
  const added: Subclip[] = [];
  for (const part of parts) {
    const range = subclipRange(part.in, part.out, asset.duration);
    if (!range) continue;
    const name = cleanSubclipName(part.name) ?? nextSubclipName(project, asset, taken);
    taken.add(name);
    added.push({ id: createId("sub"), assetId: asset.id, name, ...range });
  }
  if (added.length === 0) return { project, ids: [] };
  return { project: { ...project, subclips: [...projectSubclips(project), ...added] }, ids: added.map((s) => s.id) };
}

/**
 * Rename a subclip or move its In/Out (inside a file of `duration`). A range that would be
 * too short, or an empty name, leaves that part as it was.
 */
export function updateSubclip(
  project: Project,
  id: string,
  patch: { name?: string; in?: number; out?: number },
  duration: number,
): Project {
  const current = getSubclip(project, id);
  if (!current) return project;
  const name = patch.name === undefined ? current.name : (cleanSubclipName(patch.name) ?? current.name);
  const range = subclipRange(patch.in ?? current.in, patch.out ?? current.out, duration) ?? current;
  if (name === current.name && Math.abs(range.in - current.in) < EPS && Math.abs(range.out - current.out) < EPS) return project;
  const next: Subclip = { ...current, name, in: range.in, out: range.out };
  return { ...project, subclips: projectSubclips(project).map((s) => (s.id === id ? next : s)) };
}

/** Remove subclips by id (the file and the timeline keep everything). */
export function removeSubclips(project: Project, ids: Iterable<string>): Project {
  const doomed = new Set(ids);
  const list = projectSubclips(project);
  if (!list.some((s) => doomed.has(s.id))) return project;
  return withSubclips(project, list.filter((s) => !doomed.has(s.id)));
}

/** `project` with this list of subclips (no field at all when it's empty, like projects that never had any). */
export function withSubclips(project: Project, subclips: Subclip[]): Project {
  if (subclips.length > 0) return { ...project, subclips };
  if (project.subclips === undefined) return project;
  const { subclips: _, ...rest } = project;
  return rest;
}

/**
 * Subclips from untrusted storage (see `normalizeProject`): drops anything that isn't one,
 * duplicates, and (given the media) parts of files that are gone or that are stills,
 * clamping ranges to the file.
 */
export function normalizeSubclips(
  input: unknown,
  assets?: Record<string, Pick<MediaAsset, "kind" | "duration">>,
): Subclip[] {
  if (!Array.isArray(input)) return [];
  const out: Subclip[] = [];
  const seen = new Set<string>();
  for (const raw of input as Partial<Subclip>[]) {
    if (!raw || typeof raw !== "object" || typeof raw.id !== "string" || !raw.id || seen.has(raw.id)) continue;
    if (typeof raw.assetId !== "string" || !raw.assetId) continue;
    const asset = assets?.[raw.assetId];
    if (assets && (!asset || !canSubclip(asset))) continue;
    const range = subclipRange(Number(raw.in), Number(raw.out), asset?.duration ?? Infinity);
    if (!range) continue;
    seen.add(raw.id);
    out.push({ id: raw.id, assetId: raw.assetId, name: cleanSubclipName(raw.name) ?? "Subclip", ...range });
  }
  return out;
}
