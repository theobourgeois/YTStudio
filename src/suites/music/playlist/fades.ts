/**
 * Deleted clips don't just vanish: as the Piano roll's notes do (`piano/fades.ts`), each shrinks and
 * fades for a moment where it was, so a delete (a right-click, a sweep, the Delete key, a menu) is seen.
 * Nothing here is part of the song; the Playlist draws what's fading and keeps drawing until it's gone.
 */
import type { PlaylistClip } from "@shared/music/types";

/** How long a clip takes to go (ms). */
export const FADE_MS = 180;

export interface VanishingClip {
  clip: PlaylistClip;
  selected: boolean;
  /** 0 (just deleted) .. 1 (gone). */
  progress: number;
}

let fading: { clip: PlaylistClip; selected: boolean; at: number }[] = [];
const listeners = new Set<() => void>();

/** Start fading these clips out (they've just been deleted, or are about to be). */
export function fadeOutClips(clips: Iterable<PlaylistClip>, selected: ReadonlySet<number> = new Set()) {
  const at = performance.now();
  for (const clip of clips) fading.push({ clip, selected: selected.has(clip.id), at });
  for (const listener of listeners) listener();
}

/** The clips fading now, and how far along each is. Those done are forgotten. */
export function vanishingClips(now: number): VanishingClip[] {
  if (!fading.length) return [];
  fading = fading.filter((f) => now - f.at < FADE_MS);
  return fading.map((f) => ({ clip: f.clip, selected: f.selected, progress: Math.max(0, (now - f.at) / FADE_MS) }));
}

/** Be told when clips start fading (to draw them). */
export function onClipFade(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
