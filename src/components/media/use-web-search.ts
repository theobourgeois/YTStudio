import { useEffect, useState } from "react";
import type { WebClip } from "@shared/types";
import { api } from "@/lib/api";

const SEARCH_DEBOUNCE_MS = 450;
/** Links are usually pasted whole, so look them up almost right away. */
const LINK_DEBOUNCE_MS = 100;

export type WebSearch =
  | { status: "idle" }
  /** `clips` are the previous results, kept on screen while the new ones load. */
  | { status: "loading"; link: boolean; clips: WebClip[] }
  | { status: "done"; link: boolean; query: string; clips: WebClip[] }
  | { status: "error"; link: boolean; message: string };

/**
 * The link in `query`, if it is one: `https://…`, or a bare `site.tld/path` as
 * copied from some address bars. Anything else is a search.
 */
export function linkIn(query: string): string | null {
  const q = query.trim();
  if (/\s/.test(q)) return null;
  if (/^https?:\/\/\S+$/i.test(q)) return q;
  if (/^[\w-]+(\.[\w-]+)+\/\S*$/.test(q)) return `https://${q}`;
  return null;
}

/**
 * Search YouTube as the user types, or look up a pasted link (debounced; stale
 * requests are cancelled). Either way the result is a list of clips.
 */
export function useWebSearch(query: string): WebSearch {
  const [search, setSearch] = useState<WebSearch>({ status: "idle" });
  const q = query.trim();

  useEffect(() => {
    if (!q) {
      setSearch({ status: "idle" });
      return;
    }
    const link = linkIn(q);
    const controller = new AbortController();
    const timer = setTimeout(
      () => {
        setSearch((s) => ({ status: "loading", link: !!link, clips: "clips" in s ? s.clips : [] }));
        const clips = link
          ? api.resolveWebLink(link, controller.signal).then((clip) => [clip])
          : api.searchWeb(q, controller.signal);
        clips.then(
          (clips) => setSearch({ status: "done", link: !!link, query: q, clips }),
          (err) => {
            if (controller.signal.aborted) return;
            setSearch({ status: "error", link: !!link, message: err instanceof Error ? err.message : String(err) });
          },
        );
      },
      link ? LINK_DEBOUNCE_MS : SEARCH_DEBOUNCE_MS,
    );
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [q]);

  return search;
}
