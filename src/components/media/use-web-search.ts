import { useCallback, useEffect, useRef, useState } from "react";
import type { WebClip } from "@shared/types";
import { errorMessage } from "@shared/errors";
import { api } from "@/lib/api";

const SEARCH_DEBOUNCE_MS = 450;
/** Links are usually pasted whole, so look them up almost right away. */
const LINK_DEBOUNCE_MS = 100;

export type WebSearch =
  | { status: "idle" }
  /** `clips` are the previous results, kept on screen while the new ones load. */
  | { status: "loading"; link: boolean; clips: WebClip[] }
  | {
      status: "done";
      link: boolean;
      query: string;
      clips: WebClip[];
      /** The last page of results shown (a search's come 15 at a time), and whether YouTube has more. */
      page: number;
      more: boolean;
      loadingMore: boolean;
      /** The next page failed: shown under the list, which doesn't ask again by itself. */
      moreError: string | null;
    }
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
 * requests are cancelled). Either way the result is a list of clips; a search's
 * `loadMore` adds its next page (`useEndOfList` calls it as the list is scrolled to its end).
 */
export function useWebSearch(query: string): WebSearch & { loadMore: () => void } {
  const [search, setSearch] = useState<WebSearch>({ status: "idle" });
  const q = query.trim();
  const current = useRef(search);
  current.current = search;
  const more = useRef<AbortController | null>(null);

  const loadMore = useCallback(() => {
    const s = current.current;
    if (s.status !== "done" || !s.more || s.loadingMore) return;
    more.current?.abort();
    const controller = (more.current = new AbortController());
    const page = s.page + 1;
    const same = (cur: WebSearch): cur is Extract<WebSearch, { status: "done" }> => cur.status === "done" && cur.query === s.query && cur.page === s.page;
    setSearch({ ...s, loadingMore: true, moreError: null });
    api.searchWeb(s.query, controller.signal, page).then(
      (next) =>
        setSearch((cur) => {
          if (!same(cur)) return cur;
          // A clip already shown (YouTube's pages overlap now and then) isn't listed twice.
          const shown = new Set(cur.clips.map((c) => c.url));
          return { ...cur, page, more: next.more, loadingMore: false, clips: [...cur.clips, ...next.clips.filter((c) => !shown.has(c.url))] };
        }),
      (err) => {
        if (!controller.signal.aborted) setSearch((cur) => (same(cur) ? { ...cur, loadingMore: false, moreError: errorMessage(err) } : cur));
      },
    );
  }, []);

  useEffect(() => {
    more.current?.abort();
    if (!q) {
      setSearch({ status: "idle" });
      return;
    }
    const link = linkIn(q);
    const controller = new AbortController();
    const timer = setTimeout(
      () => {
        setSearch((s) => ({ status: "loading", link: !!link, clips: "clips" in s ? s.clips : [] }));
        const first = link
          ? api.resolveWebLink(link, controller.signal).then((clip) => ({ clips: [clip], more: false }))
          : api.searchWeb(q, controller.signal);
        first.then(
          ({ clips, more }) => setSearch({ status: "done", link: !!link, query: q, clips, page: 0, more, loadingMore: false, moreError: null }),
          (err) => {
            if (controller.signal.aborted) return;
            setSearch({ status: "error", link: !!link, message: errorMessage(err) });
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

  return { ...search, loadMore };
}

/**
 * A ref for an element at the end of a list: while it's in view (or nearly), `onEnd` is called (infinite
 * scroll). Watched again whenever `length` changes, so a list still too short to scroll keeps filling.
 */
export function useEndOfList(onEnd: () => void, enabled: boolean, length: number) {
  const [element, setElement] = useState<Element | null>(null);
  const call = useRef(onEnd);
  call.current = onEnd;
  useEffect(() => {
    if (!element || !enabled) return;
    const observer = new IntersectionObserver(([entry]) => entry?.isIntersecting && call.current(), { rootMargin: "200px" });
    observer.observe(element);
    return () => observer.disconnect();
  }, [element, enabled, length]);
  return setElement;
}
