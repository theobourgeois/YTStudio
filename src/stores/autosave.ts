/**
 * Autosave of the open project: debounced, one request in flight at a time
 * (so saves can't land out of order), retried with backoff, flushed before
 * switching projects and on unload. Pending saves are keyed by project id, so
 * switching never mixes them up. Mid-gesture states aren't saved; the result
 * is saved when the gesture ends (or, on unload, whatever is on screen).
 */
import type { StoreApi } from "zustand";
import type { Project, ProjectSummary } from "@shared/types";
import { ApiRequestError, api } from "@/lib/api";

/** What autosave needs from the editor store. */
interface Saveable {
  projectId: string | null;
  project: Project;
  gestureBase: Project | null;
}

const DEBOUNCE_MS = 400;
const MAX_RETRY_MS = 30_000;

const pendingSaves = new Map<string, Project>();
const savedListeners = new Set<(summary: ProjectSummary) => void>();
let saving: Promise<void> | null = null;
/** The save whose request is in flight (re-sent on unload, since the page may abort it). */
let inFlight: { id: string; project: Project } | null = null;
let saveTimer: ReturnType<typeof setTimeout> | undefined;
let retryDelay = 1000;

/** Be told whenever the server confirms a save (with the refreshed summary). */
export function onProjectSaved(listener: (summary: ProjectSummary) => void): () => void {
  savedListeners.add(listener);
  return () => savedListeners.delete(listener);
}

/** Forget unsaved changes for a project (e.g. it was deleted). */
export function discardPendingSave(projectId: string) {
  pendingSaves.delete(projectId);
}

/**
 * Save a project that isn't open in the editor (the assistant editing it in the background), in the
 * same queue as the open one's: debounced, in order, and flushed before any project is opened.
 */
export function queueSave(projectId: string, project: Project) {
  pendingSaves.set(projectId, project);
  if (!saving) scheduleSave(DEBOUNCE_MS);
}

function scheduleSave(ms: number) {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => void runSaves(), ms);
}

async function runSaves(): Promise<void> {
  clearTimeout(saveTimer);
  if (saving || pendingSaves.size === 0) return;
  let failed = false;
  saving = (async () => {
    for (const [id, project] of [...pendingSaves]) {
      pendingSaves.delete(id);
      inFlight = { id, project };
      try {
        const summary = await api.saveProject(id, project);
        for (const listener of savedListeners) listener(summary);
      } catch (err) {
        // A deleted project can't be saved; anything else is retried.
        if (err instanceof ApiRequestError && err.status === 404) continue;
        console.error("Autosave failed; retrying", err);
        if (!pendingSaves.has(id)) pendingSaves.set(id, project);
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
    scheduleSave(retryDelay);
  } else {
    retryDelay = 1000;
    // Edits made while the requests were in flight.
    if (pendingSaves.size) scheduleSave(0);
  }
}

/** Save everything pending right now (waits for an in-flight save first). */
export async function flushAutosave(): Promise<void> {
  if (saving) await saving;
  await runSaves();
}

let started = false;

/** Start saving the store's project whenever it changes (idempotent). */
export function startAutosave(store: StoreApi<Saveable>) {
  if (started) return;
  started = true;

  store.subscribe((state, prev) => {
    // Opening/closing a project swaps the document; that isn't an edit.
    if (!state.projectId || state.projectId !== prev.projectId) return;
    const gestureEnded = prev.gestureBase !== null && state.gestureBase === null;
    if (state.gestureBase || (state.project === prev.project && !gestureEnded)) return;
    pendingSaves.set(state.projectId, state.project);
    if (!saving) scheduleSave(DEBOUNCE_MS);
  });

  window.addEventListener("pagehide", () => {
    const { projectId, project, gestureBase } = store.getState();
    // Keep a gesture's current state (e.g. text being typed) rather than lose it.
    if (projectId && gestureBase && project !== gestureBase) pendingSaves.set(projectId, project);
    if (inFlight && !pendingSaves.has(inFlight.id)) pendingSaves.set(inFlight.id, inFlight.project);
    // Keepalive requests are capped (64 KiB in Chromium); bigger ones may not make it.
    for (const [id, p] of pendingSaves) void api.saveProject(id, p, true).catch(() => {});
  });
}
