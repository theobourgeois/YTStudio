/**
 * Deleted notes don't just vanish: as in FL Studio, each shrinks and fades for a moment where it was,
 * so a delete (a click, a right-drag across notes, the Delete key) is seen. Nothing here is part of
 * the song; the Piano roll draws what's fading (`vanishing`) and keeps drawing until it's gone.
 */
import type { Note } from "@shared/music/types";
import type { Vanishing } from "./draw";

/** How long a note takes to go (ms). */
export const FADE_MS = 160;

let fading: { note: Note; selected: boolean; at: number }[] = [];
const listeners = new Set<() => void>();

/** Start fading these notes out (they've just been deleted, or are about to be). */
export function fadeOut(notes: Iterable<Note>, selected: ReadonlySet<number> = new Set()) {
  const at = performance.now();
  for (const note of notes) fading.push({ note, selected: selected.has(note.id), at });
  for (const listener of listeners) listener();
}

/** The notes fading now, and how far along each is. Those done are forgotten. */
export function vanishing(now: number): Vanishing[] {
  if (!fading.length) return [];
  fading = fading.filter((f) => now - f.at < FADE_MS);
  return fading.map((f) => ({ note: f.note, selected: f.selected, progress: Math.max(0, (now - f.at) / FADE_MS) }));
}

/** Be told when notes start fading (to draw them). */
export function onFade(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Forget what's fading (another channel or song is shown). */
export function clearFades() {
  fading = [];
}
