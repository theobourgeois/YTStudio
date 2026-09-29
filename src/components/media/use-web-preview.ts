import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import type { WebClip } from "@shared/types";
import { errorMessage } from "@shared/errors";
import { api } from "@/lib/api";
import { usePlayback } from "@/stores/playback";

export type PreviewStatus = "loading" | "playing" | "paused";

export interface WebPreview {
  /** URL of the clip being previewed. */
  url: string | null;
  status: PreviewStatus;
  /** Play a clip's sound, or pause/resume it if it's already the current one. */
  toggle: (clip: WebClip) => void;
  stop: () => void;
}

/**
 * One sound preview at a time (for videos too: it's quicker than fetching the
 * video). The server downloads the audio on the first request (a few seconds), so
 * the file is fetched up front: that way a failure comes back with a real error
 * message, and adding the audio afterwards is instant.
 * Previewing pauses the timeline, and playing the timeline stops the preview.
 */
export function useWebPreview(): WebPreview {
  const [url, setUrl] = useState<string | null>(null);
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
    setUrl(null);
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
    (clip: WebClip) => {
      const el = player();
      if (clip.url === url) {
        if (status === "loading") stop();
        else if (el.paused) {
          usePlayback.getState().pause();
          el.play().catch(() => {});
        } else el.pause();
        return;
      }
      stop();
      usePlayback.getState().pause();
      const controller = new AbortController();
      load.current = controller;
      setUrl(clip.url);
      setStatus("loading");
      void (async () => {
        try {
          const blobUrl = URL.createObjectURL(await api.webAudio(clip.url, controller.signal));
          if (controller.signal.aborted) return URL.revokeObjectURL(blobUrl);
          objectUrl.current = blobUrl;
          el.src = blobUrl;
          await el.play();
        } catch (err) {
          if (controller.signal.aborted) return;
          stop();
          toast.error(`Couldn't play “${clip.title}”`, {
            description: errorMessage(err),
          });
        }
      })();
    },
    [url, status, stop],
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

  return { url, status, toggle, stop };
}
