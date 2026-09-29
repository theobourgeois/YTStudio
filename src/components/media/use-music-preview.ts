import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import type { MusicTrack } from "@shared/types";
import { ApiRequestError, api, errorMessage } from "@/lib/api";
import { usePlayback } from "@/stores/playback";

export type PreviewStatus = "loading" | "playing" | "paused";

export interface MusicPreview {
  trackId: string | null;
  status: PreviewStatus;
  /** Play a track, or pause/resume it if it's already the current one. */
  toggle: (track: MusicTrack) => void;
  stop: () => void;
}

/**
 * One song preview at a time. The server downloads the song on the first request
 * (a few seconds), so the file is fetched up front: that way a failure comes back
 * with a real error message, and adding the song afterwards is instant.
 * Previewing pauses the timeline, and playing the timeline stops the preview.
 */
export function useMusicPreview(): MusicPreview {
  const [trackId, setTrackId] = useState<string | null>(null);
  const [status, setStatus] = useState<PreviewStatus>("paused");
  const audio = useRef<HTMLAudioElement | null>(null);
  const load = useRef<AbortController | null>(null);
  const objectUrl = useRef<string | null>(null);

  const stop = useCallback(() => {
    load.current?.abort();
    load.current = null;
    audio.current?.pause();
    audio.current?.removeAttribute("src");
    if (objectUrl.current) URL.revokeObjectURL(objectUrl.current);
    objectUrl.current = null;
    setTrackId(null);
    setStatus("paused");
  }, []);

  const player = () => {
    if (!audio.current) {
      const el = new Audio();
      el.addEventListener("playing", () => setStatus("playing"));
      // Also fires when the song ends; playing again restarts it.
      el.addEventListener("pause", () => setStatus("paused"));
      audio.current = el;
    }
    return audio.current;
  };

  const toggle = useCallback(
    (track: MusicTrack) => {
      const el = player();
      if (track.id === trackId) {
        if (status === "loading") stop();
        else if (el.paused) {
          usePlayback.getState().pause();
          void el.play();
        } else el.pause();
        return;
      }
      stop();
      usePlayback.getState().pause();
      const controller = new AbortController();
      load.current = controller;
      setTrackId(track.id);
      setStatus("loading");
      void (async () => {
        try {
          const res = await fetch(api.musicAudioUrl(track.id), { signal: controller.signal });
          if (!res.ok) throw new ApiRequestError(await errorMessage(res), res.status);
          const url = URL.createObjectURL(await res.blob());
          if (controller.signal.aborted) return URL.revokeObjectURL(url);
          objectUrl.current = url;
          el.src = url;
          await el.play();
        } catch (err) {
          if (controller.signal.aborted) return;
          stop();
          toast.error(`Couldn't play “${track.title}”`, {
            description: err instanceof Error ? err.message : String(err),
          });
        }
      })();
    },
    [trackId, status, stop],
  );

  // The timeline and the preview never play over each other.
  useEffect(
    () =>
      usePlayback.subscribe((s, prev) => {
        if (s.playing && !prev.playing) stop();
      }),
    [stop],
  );
  useEffect(() => stop, [stop]);

  return { trackId, status, toggle, stop };
}
