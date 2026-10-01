/**
 * The pattern selector's patterns, FL Studio's way: scrolled past the last pattern, it shows the next
 * one, empty, which isn't in the song yet (a draft) and becomes a pattern of the song only when
 * something is put in it. Pure, so it's tested; the store keeps the draft (`useMusic.draftPattern`).
 */
import { createId } from "@shared/ids";
import { addPattern, nextPatternName } from "@shared/music/edits";
import { createPattern } from "@shared/music/project";
import type { MusicProject, Pattern } from "@shared/music/types";

/** A pattern shown but not yet in the song. */
export interface DraftPattern {
  id: string;
  name: string;
}

const asPatterns = new WeakMap<DraftPattern, Pattern>();

/** The draft as a pattern (empty), the same object each time for the same draft (stores select it). */
export function draftAsPattern(draft: DraftPattern): Pattern {
  let pattern = asPatterns.get(draft);
  if (!pattern) asPatterns.set(draft, (pattern = createPattern(draft.name, draft.id)));
  return pattern;
}

/** The draft, if it's the pattern shown and isn't in the song (yet, or any more: undone). */
export const activeDraft = (song: MusicProject, patternId: string | null, draft: DraftPattern | null): DraftPattern | null =>
  draft && draft.id === patternId && !song.patterns.some((p) => p.id === draft.id) ? draft : null;

/** The song as it plays and is edited while a draft is shown: with the draft, empty, after the others. */
export const withDraftPattern = (song: MusicProject, draft: DraftPattern | null): MusicProject =>
  draft && !song.patterns.some((p) => p.id === draft.id) ? addPattern(song, draft) : song;

/**
 * An edit made while a draft is shown: it's applied to the song with the draft in it, which stays
 * only if the edit changed it (a note put in it, its length set) or put it on the playlist. The same
 * song back when nothing changed, so no-ops still skip the undo history.
 */
export function editWithDraft(song: MusicProject, draft: DraftPattern | null, update: (song: MusicProject) => MusicProject): MusicProject {
  if (!draft || song.patterns.some((p) => p.id === draft.id)) return update(song);
  const base = addPattern(song, draft);
  const next = update(base);
  if (next === base) return song;
  const before = base.patterns.find((p) => p.id === draft.id);
  const after = next.patterns.find((p) => p.id === draft.id);
  const placed = next.playlist.clips.some((c) => c.kind === "pattern" && c.ref === draft.id);
  return after === before && !placed ? { ...next, patterns: next.patterns.filter((p) => p.id !== draft.id) } : next;
}

/**
 * The pattern a step up (1) or down (-1) the selector goes to: the next or previous of the song's,
 * and past the last one, a draft (only one: further up stays on it). Returns the pattern to show and
 * the draft to keep (null once it's left).
 */
export function stepPattern(song: MusicProject, patternId: string | null, draft: DraftPattern | null, direction: 1 | -1): { patternId: string; draft: DraftPattern | null } {
  const patterns = song.patterns;
  const shownDraft = activeDraft(song, patternId, draft);
  if (shownDraft) return direction > 0 ? { patternId: shownDraft.id, draft: shownDraft } : { patternId: patterns[patterns.length - 1].id, draft: null };
  const index = Math.max(0, patterns.findIndex((p) => p.id === patternId));
  const next = index + direction;
  if (next < 0) return { patternId: patterns[0].id, draft: null };
  if (next < patterns.length) return { patternId: patterns[next].id, draft: null };
  const made = { id: createId("pat"), name: nextPatternName(song) };
  return { patternId: made.id, draft: made };
}
