/**
 * Autosave for any suite's documents: debounced, one request in flight at a time (so saves can't land
 * out of order), retried with backoff, and flushed on demand. Pending saves are keyed by project id,
 * so switching projects never mixes them up. (The video editor's `stores/autosave.ts` predates this.)
 */

import { log } from "@/lib/log";

const logger = log("autosave");

export interface AutosaverOptions<D, R> {
  /** Send a document. `keepalive` is for the page going away: the request must outlive it. */
  save(id: string, doc: D, keepalive: boolean): Promise<R>;
  /** The server confirmed a save. */
  onSaved?(result: R): void;
  /** The error means the project is gone, so the save is dropped rather than retried. */
  isGone?(error: unknown): boolean;
  debounceMs?: number;
}

export interface Autosaver<D> {
  /** Save this document soon (replacing one still waiting for the same project). */
  queue(id: string, doc: D): void;
  /** Save everything pending right now (waits for an in-flight save first). */
  flush(): Promise<void>;
  /** Forget a project's pending save (it was deleted). */
  discard(id: string): void;
  /** The page is going away: send what's pending (and what was in flight) so it outlives the page. */
  saveOnUnload(): void;
}

const MAX_RETRY_MS = 30_000;

export function createAutosaver<D, R>({ save, onSaved, isGone, debounceMs = 400 }: AutosaverOptions<D, R>): Autosaver<D> {
  const pending = new Map<string, D>();
  let saving: Promise<void> | null = null;
  /** The save whose request is in flight (re-sent on unload, since the page may abort it). */
  let inFlight: { id: string; doc: D } | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let retryDelay = 1000;

  function schedule(ms: number) {
    clearTimeout(timer);
    timer = setTimeout(() => void run(), ms);
  }

  async function run(): Promise<void> {
    clearTimeout(timer);
    if (saving || pending.size === 0) return;
    let failed = false;
    saving = (async () => {
      for (const [id, doc] of [...pending]) {
        pending.delete(id);
        inFlight = { id, doc };
        try {
          // Not `onSaved?.(await save(...))`: without a listener that wouldn't save at all.
          const result = await save(id, doc, false);
          onSaved?.(result);
        } catch (err) {
          if (isGone?.(err)) continue;
          logger.error("failed; retrying", err);
          if (!pending.has(id)) pending.set(id, doc);
          failed = true;
        } finally {
          inFlight = null;
        }
      }
    })();
    await saving;
    saving = null;
    if (failed) {
      retryDelay = Math.min(retryDelay * 2, MAX_RETRY_MS);
      schedule(retryDelay);
    } else {
      retryDelay = 1000;
      // Edits made while the requests were in flight.
      if (pending.size) schedule(0);
    }
  }

  return {
    queue(id, doc) {
      pending.set(id, doc);
      if (!saving) schedule(debounceMs);
    },
    async flush() {
      if (saving) await saving;
      await run();
    },
    discard(id) {
      pending.delete(id);
    },
    saveOnUnload() {
      if (inFlight && !pending.has(inFlight.id)) pending.set(inFlight.id, inFlight.doc);
      for (const [id, doc] of pending) void save(id, doc, true).catch(() => {});
    },
  };
}
