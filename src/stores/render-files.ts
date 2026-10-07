import type { StoreApi } from "zustand";
import { create } from "zustand";
import { RENDER_RESOLUTION, type RenderSegment, renderSegments } from "@shared/render-files";
import { errorMessage } from "@shared/errors";
import type { MediaAsset, Project, RenderJob } from "@shared/types";
import { layoutTexts } from "@/components/export/layout-texts";
import { api } from "@/lib/api";

/**
 * The open video's render files (Premiere's preview files, docs/render-files.md): which segments have one (by
 * key), and the render running. The render bar draws from this, and the Program monitor plays a segment's file
 * where it has one (`renderedAt`).
 */
interface RenderFilesState {
  projectId: string | null;
  keys: ReadonlySet<string>;
  job: RenderJob | null;
  /** Why the last render couldn't start or failed (shown by the render's status). */
  error: string | null;
  /** Render Effects In to Out: the video's heavy segments that have no file yet. */
  render: () => Promise<RenderJob | null>;
  cancel: () => void;
  /** Delete Render Files. */
  deleteAll: () => Promise<void>;
}

/** The editor store's parts used here (it hands itself over: `watchRenderFiles`). */
interface Editor {
  projectId: string | null;
  document: Project;
  assets: MediaAsset[];
}

const NO_KEYS: ReadonlySet<string> = new Set();
let editor: StoreApi<Editor> | null = null;
let polling = 0;

export const useRenderFiles = create<RenderFilesState>((set, get) => ({
  projectId: null,
  keys: NO_KEYS,
  job: null,
  error: null,

  async render() {
    const state = editor?.getState();
    const projectId = state?.projectId;
    if (!state || !projectId || get().projectId !== projectId) return null;
    set({ error: null });
    try {
      const texts = await layoutTexts(state.document, RENDER_RESOLUTION);
      const job = await api.renderEffects(projectId, { project: state.document, texts });
      if (get().projectId !== projectId) return null;
      set({ job });
      poll(projectId);
      return job;
    } catch (err) {
      if (get().projectId === projectId) set({ error: errorMessage(err) });
      return null;
    }
  },

  cancel() {
    const { job } = get();
    if (!job || (job.status !== "queued" && job.status !== "rendering")) return;
    set({ job: { ...job, status: "cancelled" } });
    api.cancelRender(job.id).catch((err) => console.warn("Couldn't cancel the render", err));
  },

  async deleteAll() {
    const { projectId } = get();
    if (!projectId) return;
    try {
      const state = await api.deleteRenderFiles(projectId);
      if (get().projectId === projectId) set({ keys: new Set(state.keys), job: null, error: null });
    } catch (err) {
      set({ error: errorMessage(err) });
    }
  },
}));

/** Load a video's render files (and follow a render of it already running). */
async function load(projectId: string | null) {
  polling++;
  useRenderFiles.setState({ projectId, keys: NO_KEYS, job: null, error: null });
  if (!projectId) return;
  try {
    const state = await api.renderFiles(projectId);
    if (useRenderFiles.getState().projectId !== projectId) return;
    useRenderFiles.setState({ keys: new Set(state.keys), job: state.job });
    if (state.job && running(state.job)) poll(projectId);
  } catch (err) {
    console.warn("Couldn't read the video's render files", err);
  }
}

const running = (job: RenderJob) => job.status === "queued" || job.status === "rendering";

/** Follow a render until it ends: its segments turn green as they're done. */
async function poll(projectId: string) {
  const mine = ++polling;
  for (;;) {
    await new Promise((r) => setTimeout(r, 400));
    if (mine !== polling || useRenderFiles.getState().projectId !== projectId) return;
    try {
      const state = await api.renderFiles(projectId);
      if (mine !== polling || useRenderFiles.getState().projectId !== projectId) return;
      const keys = new Set(state.keys);
      const same = keys.size === useRenderFiles.getState().keys.size && [...keys].every((k) => useRenderFiles.getState().keys.has(k));
      useRenderFiles.setState({
        ...(same ? {} : { keys }),
        job: state.job,
        ...(state.job?.status === "error" ? { error: state.job.error ?? "Rendering failed." } : {}),
      });
      if (!state.job || !running(state.job)) return;
    } catch (err) {
      console.warn("Couldn't follow the render", err);
    }
  }
}

/** Stores already watched. */
const watched = new WeakSet<object>();

/** Keep `useRenderFiles` on the editor's open video (called when one opens). */
export function watchRenderFiles(store: StoreApi<Editor>) {
  editor = store;
  if (useRenderFiles.getState().projectId !== store.getState().projectId) void load(store.getState().projectId);
  if (watched.has(store)) return;
  watched.add(store);
  store.subscribe((s, prev) => {
    if (s.projectId !== prev.projectId) void load(s.projectId);
  });
}

/** The last two videos' segments (the render bar's, held at a drag's start, and the monitor's, as it is). */
let memo: { document: Project; assets: MediaAsset[]; segments: RenderSegment[] }[] = [];
/** A video's main sequence's segments (worked out once per change of it or its media). */
export function segmentsOf(document: Project, assets: MediaAsset[]): RenderSegment[] {
  const known = memo.find((m) => m.document === document && m.assets === assets);
  if (known) return known.segments;
  const entry = { document, assets, segments: renderSegments(document, assets) };
  memo = [entry, ...memo.slice(0, 1)];
  return entry.segments;
}
