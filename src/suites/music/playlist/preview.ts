/**
 * A clip heard on its own (the clip menu's Preview, held as in FL Studio): while it's held, the engine is
 * sent a song that's only that clip, unmuted, in song mode, looping over the clip's time, and plays it
 * from its start; let go, it stops and the song comes back.
 */
import { clipContext, clipEnd } from "@shared/music/playlist";
import type { MusicProject } from "@shared/music/types";
import { cancelPlayWhenSent, playWhenSent, useTransport } from "../transport";
import { usePlaylist } from "./store";

/** What to send the engine while a clip is previewed (null: none is). */
export function clipPreview(song: MusicProject) {
  const id = usePlaylist.getState().previewing;
  const clip = id === null ? undefined : song.playlist.clips.find((c) => c.id === id);
  if (!clip) return null;
  return {
    song: { ...song, playlist: { tracks: [], clips: [{ ...clip, muted: false }] } },
    loop: { start: clip.start, end: clipEnd(clip, clipContext(song)) },
    mode: "song" as const,
  };
}

/** Start hearing a clip on its own; it stops when the pointer's let go anywhere. */
export function holdClipPreview(clipId: number) {
  usePlaylist.setState({ previewing: clipId });
  playWhenSent();
  const stop = () => {
    window.removeEventListener("pointerup", stop, true);
    window.removeEventListener("blur", stop);
    stopClipPreview();
  };
  window.addEventListener("pointerup", stop, true);
  window.addEventListener("blur", stop);
}

export function stopClipPreview() {
  if (usePlaylist.getState().previewing === null) return;
  cancelPlayWhenSent();
  useTransport.getState().stop();
  usePlaylist.setState({ previewing: null });
}
