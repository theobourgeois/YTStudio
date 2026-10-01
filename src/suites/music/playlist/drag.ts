/**
 * What a drag on the Playlist does to the clips (`PlaylistDrag`, in `store.ts`). One function, used
 * twice: every frame to draw the clips as the drag would leave them, and once, when it's let go, to make
 * the edit. So what's drawn while dragging is exactly what's kept.
 */
import {
  type ClipContext,
  type CreatedClips,
  addClips,
  clipsInRect,
  cloneClips,
  moveClips,
  removeClips,
  resizeClips,
  setClipProps,
  sliceClips,
  slipClips,
} from "@shared/music/playlist";
import type { PlaylistClip } from "@shared/music/types";
import type { PlaylistDrag } from "./store";

/** The clips after a drag, and the ones it made (to select them). A selection rectangle and the playback tool change none. */
export function applyDrag(clips: PlaylistClip[], drag: PlaylistDrag | null, ctx: ClipContext): CreatedClips {
  const same = (list: PlaylistClip[]): CreatedClips => ({ clips: list, created: [] });
  if (!drag) return same(clips);
  switch (drag.kind) {
    case "move":
      return drag.clone ? cloneClips(clips, drag.ids, drag.ticks, drag.tracks, ctx) : same(moveClips(clips, drag.ids, drag.ticks, drag.tracks, ctx));
    case "resize":
      return same(resizeClips(clips, drag.ids, drag.edge, drag.ticks, ctx));
    case "slip":
      return same(slipClips(clips, drag.ids, drag.ticks, ctx));
    case "add":
      return addClips(clips, drag.clips);
    case "erase":
      return same(removeClips(clips, drag.ids));
    case "mute":
      return same(setClipProps(clips, drag.ids, { muted: drag.muted }));
    case "slice":
      return sliceClips(clips, drag.tick, drag.top, drag.bottom, ctx);
    case "rect":
    case "playback":
      return same(clips);
  }
}

/** What a selection rectangle selects: the clips it touches, with (`add`) what was selected before. */
export function rectSelection(clips: readonly PlaylistClip[], drag: Extract<PlaylistDrag, { kind: "rect" }>, selected: ReadonlySet<number>, ctx: ClipContext): Set<number> {
  const inside = clipsInRect(clips, Math.min(drag.from, drag.to), Math.max(drag.from, drag.to), Math.min(drag.top, drag.bottom), Math.max(drag.top, drag.bottom), ctx);
  return new Set(drag.add ? [...selected, ...inside] : inside);
}
