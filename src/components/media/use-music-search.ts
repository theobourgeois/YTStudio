import { useEffect, useState } from "react";
import type { MusicTrack } from "@shared/types";
import { api } from "@/lib/api";

const DEBOUNCE_MS = 450;

export type MusicSearch =
  | { status: "idle" }
  /** `tracks` are the previous results, kept on screen while the new ones load. */
  | { status: "loading"; tracks: MusicTrack[] }
  | { status: "done"; query: string; tracks: MusicTrack[] }
  | { status: "error"; message: string };

/** Search YouTube for songs as the user types (debounced; stale searches are cancelled). */
export function useMusicSearch(query: string): MusicSearch {
  const [search, setSearch] = useState<MusicSearch>({ status: "idle" });
  const q = query.trim();

  useEffect(() => {
    if (!q) {
      setSearch({ status: "idle" });
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => {
      setSearch((s) => ({ status: "loading", tracks: "tracks" in s ? s.tracks : [] }));
      api.searchMusic(q, controller.signal).then(
        (tracks) => setSearch({ status: "done", query: q, tracks }),
        (err) => {
          if (controller.signal.aborted) return;
          setSearch({ status: "error", message: err instanceof Error ? err.message : String(err) });
        },
      );
    }, DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [q]);

  return search;
}
