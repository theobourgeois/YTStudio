import { useCallback, useEffect, useRef, useState } from "react";
import { errorMessage } from "@shared/errors";
import type { ModelResult, ModelSource } from "@shared/types";
import { api } from "@/lib/api";

/** How long typing rests before it's searched (ms). */
const DEBOUNCE_MS = 350;

export type ModelSearchState =
  | { status: "idle" }
  | { status: "loading" | "done"; results: ModelResult[]; more: boolean; loadingMore: boolean; moreError: boolean }
  | { status: "error"; message: string };

/**
 * A model site searched for `query` as it's typed (`GET /api/models/search`), a page at a time: `loadMore` the next.
 * A new query, site or filter starts again (the one before it dropped); `generation` searches again (a key saved).
 */
export function useModelSearch(query: string, source: ModelSource, animated: boolean, generation = 0) {
  const [state, setState] = useState<ModelSearchState>({ status: "idle" });
  const next = useRef<string | null>(null);
  const asked = useRef(0);
  const words = query.trim();
  useEffect(() => {
    const ticket = ++asked.current;
    next.current = null;
    if (!words) {
      setState({ status: "idle" });
      return;
    }
    setState((s) => (s.status === "done" || s.status === "loading" ? { ...s, status: "loading" } : { status: "loading", results: [], more: false, loadingMore: false, moreError: false }));
    const abort = new AbortController();
    const t = setTimeout(() => {
      api.searchModels(words, source, animated, null, abort.signal).then(
        (page) => {
          if (ticket !== asked.current) return;
          next.current = page.next;
          setState({ status: "done", results: page.results, more: page.next !== null, loadingMore: false, moreError: false });
        },
        (err) => ticket === asked.current && !abort.signal.aborted && setState({ status: "error", message: errorMessage(err) }),
      );
    }, DEBOUNCE_MS);
    return () => {
      clearTimeout(t);
      abort.abort();
    };
  }, [words, source, animated, generation]);
  const loadMore = useCallback(() => {
    const cursor = next.current;
    if (!cursor || !words) return;
    const ticket = asked.current;
    next.current = null;
    setState((s) => (s.status === "done" ? { ...s, loadingMore: true, moreError: false } : s));
    api.searchModels(words, source, animated, cursor).then(
      (page) => {
        if (ticket !== asked.current) return;
        next.current = page.next;
        setState((s) => {
          if (s.status !== "done") return s;
          const seen = new Set(s.results.map((r) => r.id));
          return { ...s, results: [...s.results, ...page.results.filter((r) => !seen.has(r.id))], more: page.next !== null, loadingMore: false };
        });
      },
      () => {
        if (ticket !== asked.current) return;
        next.current = cursor;
        setState((s) => (s.status === "done" ? { ...s, loadingMore: false, moreError: true } : s));
      },
    );
  }, [words, source, animated]);
  return { ...state, loadMore };
}
