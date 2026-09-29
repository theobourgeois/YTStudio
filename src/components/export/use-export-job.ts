import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import type { ExportJob, ExportRequest } from "@shared/types";
import { api, ApiRequestError } from "@/lib/api";

const POLL_MS = 500;
/** Consecutive failed polls tolerated before giving up (e.g. a server restart blip). */
const MAX_POLL_FAILURES = 3;

export type ExportPhase =
  | { status: "idle" }
  | { status: "starting" }
  | { status: "running"; job: ExportJob; startedAt: number }
  | { status: "done"; job: ExportJob; elapsedMs: number }
  | { status: "error"; message: string };

const noop = () => {};
const errorMessage = (err: unknown) => (err instanceof Error ? err.message : String(err));

/**
 * Drives one export at a time: start -> poll -> done/error. Any render still
 * running when the component unmounts is cancelled, and no state is set after
 * unmount.
 */
export function useExportJob() {
  const [phase, setPhase] = useState<ExportPhase>({ status: "idle" });
  const mounted = useRef(false);
  /** Id of the job currently rendering on the server, if any. */
  const activeId = useRef<string | null>(null);
  /** Bumped on reset so a `start` still awaiting the server knows it was abandoned. */
  const session = useRef(0);

  const cancelActive = useCallback(() => {
    session.current++;
    const id = activeId.current;
    activeId.current = null;
    if (id) api.cancelExport(id).catch(noop);
  }, []);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      cancelActive();
    };
  }, [cancelActive]);

  /** Start an export (the request may still be being prepared, e.g. drawing the texts). */
  const start = useCallback(async (request: ExportRequest | Promise<ExportRequest>) => {
    const current = ++session.current;
    setPhase({ status: "starting" });
    try {
      const prepared = await request;
      if (!mounted.current || session.current !== current) return;
      const job = await api.startExport(prepared);
      if (!mounted.current || session.current !== current) {
        api.cancelExport(job.id).catch(noop);
        return;
      }
      activeId.current = job.id;
      setPhase({ status: "running", job, startedAt: Date.now() });
    } catch (err) {
      if (mounted.current && session.current === current) {
        setPhase({ status: "error", message: errorMessage(err) });
      }
    }
  }, []);

  /** Back to idle, cancelling any pending or running render. */
  const reset = useCallback(() => {
    cancelActive();
    setPhase({ status: "idle" });
  }, [cancelActive]);

  const runningId = phase.status === "running" ? phase.job.id : null;
  useEffect(() => {
    if (!runningId) return;
    let alive = true;
    let failures = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const poll = async () => {
      let job: ExportJob;
      try {
        job = await api.getExport(runningId);
      } catch (err) {
        if (!alive) return;
        const gone = err instanceof ApiRequestError && err.status === 404;
        if (!gone && ++failures < MAX_POLL_FAILURES) {
          timer = setTimeout(poll, POLL_MS);
          return;
        }
        cancelActive();
        setPhase({ status: "error", message: gone ? "The export job was lost." : errorMessage(err) });
        return;
      }
      if (!alive) return;
      failures = 0;

      if (job.status === "queued" || job.status === "rendering") {
        setPhase((p) => (p.status === "running" && p.job.id === job.id ? { ...p, job } : p));
        timer = setTimeout(poll, POLL_MS);
        return;
      }
      activeId.current = null;
      if (job.status === "done") {
        setPhase((p) => ({
          status: "done",
          job,
          elapsedMs: p.status === "running" ? Date.now() - p.startedAt : 0,
        }));
        toast.success("Export complete", { description: `${job.fileName} is ready to download.` });
      } else if (job.status === "error") {
        setPhase({ status: "error", message: job.error ?? "The render failed." });
      } else {
        setPhase({ status: "idle" });
      }
    };

    timer = setTimeout(poll, POLL_MS);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [runningId, cancelActive]);

  return { phase, start, reset };
}
