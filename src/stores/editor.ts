import { create } from "zustand";
import { toast } from "sonner";
import type {
  Clip,
  MediaAsset,
  MusicTrack,
  Project,
  ProjectSettings,
  ProjectSummary,
} from "@shared/types";
import {
  MAIN_TRACK_ID,
  addAudioTrack,
  addClip,
  appendToMain,
  canPlaceOnTrack,
  clipAtTime,
  createDefaultProject,
  createId,
  getClip,
  getTrack,
  insertIntoMain,
  mainInsertIndex,
  normalizeProject,
  projectDuration,
  removeAssetClips,
  removeClips,
  splitClip,
} from "@shared/timeline";
import { ApiRequestError, api } from "@/lib/api";
import { usePlayback } from "./playback";

const HISTORY_LIMIT = 100;
export const MIN_ZOOM = 5;
export const MAX_ZOOM = 400;

export interface Upload {
  id: string;
  name: string;
  /** 0..1 */
  progress: number;
  /** Set for a song being downloaded from the Music tab. */
  trackId?: string;
}

export const DEFAULT_PROJECT_NAME = "Untitled";

interface EditorState {
  /** The open project's id, or null when no project is open. */
  projectId: string | null;
  /** True while a project is being fetched. */
  loading: boolean;
  loadError: string | null;
  project: Project;
  /** The open project's media, newest first. */
  assets: MediaAsset[];
  uploads: Upload[];
  selectedClipId: string | null;
  /** Timeline zoom in pixels per second. */
  zoom: number;
  snapping: boolean;

  past: Project[];
  future: Project[];
  /** Project snapshot taken at `beginGesture`, while a drag is in progress. */
  gestureBase: Project | null;
  /** Id of the latest gesture; a gesture is active while `gestureBase` is set. */
  gestureId: number;

  /** Open a project (saving the current one first). Resets history, selection and playback. */
  openProject: (projectId: string) => Promise<void>;
  /** Close the open project (saving it first), leaving the editor empty. */
  closeProject: () => Promise<void>;
  /** Rename the open project. Names aren't part of undo history. */
  renameProject: (name: string) => void;

  /**
   * Apply an edit as one undoable step. An edit arriving mid-gesture (e.g. an
   * upload finishing during a drag) first finalises that gesture, so nothing is lost.
   */
  commit: (update: (p: Project) => Project) => void;
  /**
   * Start a continuous edit (drag/trim) and return its id. Use `preview` for live
   * updates, then end or cancel with the same id. Gesture owners should derive
   * each preview from the store's current `gestureBase` and stop once
   * `gestureId` changes or the gesture is no longer active.
   */
  beginGesture: () => number;
  /** Live update during a gesture; not recorded in history on its own. No-op without a gesture. */
  preview: (update: (p: Project) => Project) => void;
  /** Finish the gesture as one undo step. With an id, only if that gesture is still active. */
  endGesture: (id?: number) => void;
  /** Revert to the gesture's starting state. With an id, only if that gesture is still active. */
  cancelGesture: (id?: number) => void;
  undo: () => void;
  redo: () => void;

  select: (clipId: string | null) => void;
  setZoom: (zoom: number) => void;
  toggleSnapping: () => void;
  updateSettings: (patch: Partial<ProjectSettings>) => void;

  /**
   * Upload files into the open project's media. Resolves with the assets that imported
   * successfully (none if the user switched projects meanwhile). The first import into
   * an unnamed project names it after the file.
   */
  importFiles: (files: File[]) => Promise<MediaAsset[]>;
  /** Download a song into the open project's media and put it on the timeline. Resolves true if it was added. */
  addMusic: (track: MusicTrack) => Promise<boolean>;
  deleteAsset: (assetId: string) => Promise<void>;
  getAsset: (assetId: string) => MediaAsset | undefined;

  /**
   * Put assets on the timeline as one undoable step.
   * - `trackId` omitted or incompatible: video -> main track, audio-only -> first audio track.
   * - `at` = timeline time under the pointer. Main track: inserted at the nearest slot
   *   (appended when omitted). Audio: first clip's left edge (0 when omitted), the rest follow.
   * Returns the ids of the created clips.
   */
  addAssetsToTimeline: (assetIds: string[], opts?: { trackId?: string; at?: number }) => string[];
  /** Split the selected clip at the playhead, or the main-track clip under it. */
  splitAtPlayhead: () => void;
  deleteSelected: () => void;
}

let openToken = 0;

const emptyEditor = () => ({
  project: createDefaultProject(),
  assets: [] as MediaAsset[],
  uploads: [] as Upload[],
  selectedClipId: null,
  past: [] as Project[],
  future: [] as Project[],
  gestureBase: null,
});

export const useEditor = create<EditorState>((set, get) => ({
  projectId: null,
  loading: false,
  loadError: null,
  project: createDefaultProject(),
  assets: [],
  uploads: [],
  selectedClipId: null,
  zoom: 60,
  snapping: true,
  past: [],
  future: [],
  gestureBase: null,
  gestureId: 0,

  async openProject(projectId) {
    if (get().projectId === projectId && !get().loadError) return;
    const token = ++openToken;
    get().endGesture();
    usePlayback.getState().pause();
    set({ loading: true, loadError: null });
    try {
      await flushAutosave();
      const [project, assets] = await Promise.all([
        api.getProject(projectId),
        api.listMedia(projectId),
      ]);
      if (token !== openToken) return;
      const byId = Object.fromEntries(assets.map((a) => [a.id, a]));
      // One `set` so subscribers see the project switch atomically (autosave ignores it).
      set({ ...emptyEditor(), projectId, project: normalizeProject(project, byId), assets, loading: false });
      usePlayback.getState().seek(0);
      startAutosave();
      pollProcessingAssets();
    } catch (err) {
      if (token !== openToken) return;
      set({ loading: false, loadError: err instanceof Error ? err.message : String(err) });
    }
  },

  async closeProject() {
    ++openToken;
    get().endGesture();
    usePlayback.getState().pause();
    await flushAutosave();
    set({ ...emptyEditor(), projectId: null, loading: false, loadError: null });
    usePlayback.getState().seek(0);
  },

  renameProject(name) {
    const trimmed = name.trim();
    if (!trimmed || trimmed === get().project.name) return;
    const rename = (p: Project) => ({ ...p, name: trimmed });
    const { project, past, future, gestureBase } = get();
    set({
      project: rename(project),
      past: past.map(rename),
      future: future.map(rename),
      gestureBase: gestureBase ? rename(gestureBase) : null,
    });
  },

  commit(update) {
    if (get().gestureBase) get().endGesture();
    const { project, past } = get();
    const next = update(project);
    if (next === project) return;
    set({ project: next, past: [...past, project].slice(-HISTORY_LIMIT), future: [] });
    fixSelection();
  },

  beginGesture() {
    if (get().gestureBase) get().endGesture();
    const gestureId = get().gestureId + 1;
    set({ gestureBase: get().project, gestureId });
    return gestureId;
  },

  preview(update) {
    if (!get().gestureBase) return;
    const next = update(get().project);
    if (next !== get().project) set({ project: next });
  },

  endGesture(id) {
    const { gestureBase, gestureId, project, past } = get();
    if (!gestureBase || (id !== undefined && id !== gestureId)) return;
    if (gestureBase === project || JSON.stringify(gestureBase) === JSON.stringify(project)) {
      set({ gestureBase: null, project: gestureBase });
      return;
    }
    set({ gestureBase: null, past: [...past, gestureBase].slice(-HISTORY_LIMIT), future: [] });
    fixSelection();
  },

  cancelGesture(id) {
    const { gestureBase, gestureId } = get();
    if (!gestureBase || (id !== undefined && id !== gestureId)) return;
    set({ project: gestureBase, gestureBase: null });
  },

  undo() {
    const { past, project, future, gestureBase } = get();
    if (gestureBase || past.length === 0) return;
    set({ project: past[past.length - 1], past: past.slice(0, -1), future: [project, ...future] });
    fixSelection();
  },

  redo() {
    const { past, project, future, gestureBase } = get();
    if (gestureBase || future.length === 0) return;
    set({ project: future[0], future: future.slice(1), past: [...past, project] });
    fixSelection();
  },

  select(clipId) {
    set({ selectedClipId: clipId });
  },

  setZoom(zoom) {
    set({ zoom: Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom)) });
  },

  toggleSnapping() {
    set({ snapping: !get().snapping });
  },

  updateSettings(patch) {
    get().commit((p) => ({ ...p, settings: { ...p.settings, ...patch } }));
  },

  async importFiles(files) {
    const projectId = get().projectId;
    if (!projectId) return [];
    const stillOpen = () => get().projectId === projectId;
    const results = await Promise.all(
      files.map(async (file) => {
        const upload: Upload = { id: createId("up"), name: file.name, progress: 0 };
        set({ uploads: [...get().uploads, upload] });
        try {
          const asset = await api.uploadMedia(projectId, file, (progress) => {
            if (!stillOpen()) return;
            set({ uploads: get().uploads.map((u) => (u.id === upload.id ? { ...u, progress } : u)) });
          });
          if (!stillOpen()) return null;
          set({ assets: [asset, ...get().assets.filter((a) => a.id !== asset.id)] });
          if (get().project.name === DEFAULT_PROJECT_NAME) {
            get().renameProject(asset.name.replace(/\.[^.]+$/, ""));
          }
          return asset;
        } catch (err) {
          toast.error(`Couldn't import ${file.name}`, {
            description: err instanceof Error ? err.message : String(err),
          });
          return null;
        } finally {
          if (stillOpen()) set({ uploads: get().uploads.filter((u) => u.id !== upload.id) });
        }
      }),
    );
    if (!stillOpen()) return [];
    pollProcessingAssets();
    return results.filter((a): a is MediaAsset => a !== null);
  },

  async addMusic(track) {
    const projectId = get().projectId;
    if (!projectId || get().uploads.some((u) => u.trackId === track.id)) return false;
    const stillOpen = () => get().projectId === projectId;
    const upload: Upload = { id: createId("up"), name: track.title, progress: 0, trackId: track.id };
    set({ uploads: [...get().uploads, upload] });
    try {
      const asset = await api.importMusic({ projectId, trackId: track.id, title: track.title });
      if (!stillOpen()) return false;
      set({ assets: [asset, ...get().assets.filter((a) => a.id !== asset.id)] });
      get().addAssetsToTimeline([asset.id]);
      pollProcessingAssets();
      return true;
    } catch (err) {
      toast.error(`Couldn't add “${track.title}”`, {
        description: err instanceof Error ? err.message : String(err),
      });
      return false;
    } finally {
      if (stillOpen()) set({ uploads: get().uploads.filter((u) => u.id !== upload.id) });
    }
  },

  async deleteAsset(assetId) {
    try {
      await api.deleteMedia(assetId);
    } catch (err) {
      toast.error("Couldn't delete media", {
        description: err instanceof Error ? err.message : String(err),
      });
      return;
    }
    // Removing an asset's clips is an edit (undoable), but the asset itself is gone,
    // so strip it from history too to keep undo from resurrecting dangling clips.
    const strip = (p: Project) => removeAssetClips(p, assetId);
    const { project, past, future, assets, gestureBase } = get();
    set({
      assets: assets.filter((a) => a.id !== assetId),
      project: strip(project),
      past: past.map(strip),
      future: future.map(strip),
      gestureBase: gestureBase ? strip(gestureBase) : null,
    });
    fixSelection();
  },

  getAsset(assetId) {
    return get().assets.find((a) => a.id === assetId);
  },

  addAssetsToTimeline(assetIds, opts = {}) {
    const assets = assetIds
      .map((id) => get().getAsset(id))
      .filter((a): a is MediaAsset => !!a && a.duration > 0);
    if (assets.length === 0) return [];
    const created: string[] = [];

    get().commit((project) => {
      let p = project;
      // Group by destination track, honouring the requested track when compatible.
      const requested = opts.trackId ? getTrack(p, opts.trackId) : undefined;
      const destination = (a: MediaAsset): string => {
        if (requested && canPlaceOnTrack(a, requested)) return requested.id;
        if (a.hasVideo) return MAIN_TRACK_ID;
        const audio = p.tracks.find((t) => t.kind === "audio");
        if (audio) return audio.id;
        const added = addAudioTrack(p);
        p = added.project;
        return added.trackId;
      };

      let mainIndex = opts.at === undefined ? null : mainInsertIndex(p, opts.at);
      const audioCursor = new Map<string, number>();
      for (const asset of assets) {
        const trackId = destination(asset);
        const clip: Clip = {
          id: createId("clip"),
          assetId: asset.id,
          trackId,
          start: 0,
          in: 0,
          out: asset.duration,
          volume: 1,
          fit: "contain",
        };
        if (trackId === MAIN_TRACK_ID) {
          if (mainIndex === null) {
            p = appendToMain(p, clip);
          } else {
            p = insertIntoMain(p, clip, mainIndex);
            mainIndex++;
          }
        } else {
          const at = audioCursor.get(trackId) ?? Math.max(0, opts.at ?? 0);
          p = addClip(p, { ...clip, start: at });
          const placed = getClip(p, clip.id)!;
          audioCursor.set(trackId, placed.start + (placed.out - placed.in));
        }
        created.push(clip.id);
      }
      return p;
    });

    if (created.length) set({ selectedClipId: created[created.length - 1] });
    return created;
  },

  splitAtPlayhead() {
    const time = usePlayback.getState().time;
    const { project, selectedClipId } = get();
    const selected = selectedClipId ? getClip(project, selectedClipId) : undefined;
    const target =
      selected && clipAtTime(project, selected.trackId, time)?.id === selected.id
        ? selected
        : clipAtTime(project, MAIN_TRACK_ID, time);
    if (!target) {
      toast("Nothing to split here", { description: "Move the playhead over a clip." });
      return;
    }
    const result = splitClip(project, target.id, time);
    if (!result.newClipId) {
      toast("Too close to the clip edge to split");
      return;
    }
    get().commit(() => result.project);
  },

  deleteSelected() {
    const { selectedClipId } = get();
    if (!selectedClipId) return;
    get().commit((p) => removeClips(p, [selectedClipId]));
    set({ selectedClipId: null });
  },
}));

/** Drop the selection if the selected clip no longer exists. */
function fixSelection() {
  const { selectedClipId, project } = useEditor.getState();
  if (selectedClipId && !getClip(project, selectedClipId)) {
    useEditor.setState({ selectedClipId: null });
  }
}

// Keep the playback clock's duration in sync with the timeline.
useEditor.subscribe((state, prev) => {
  if (state.project !== prev.project) {
    usePlayback.getState().setDuration(projectDuration(state.project));
  }
});

// ---------------------------------------------------------------------------
// Autosave: debounced, one request in flight at a time (so saves can't land out
// of order), retried with backoff, flushed before switching projects and on
// unload. Pending saves are keyed by project id, so switching never mixes them
// up. Mid-gesture states aren't saved; the result is saved when the gesture ends.
// ---------------------------------------------------------------------------

const pendingSaves = new Map<string, Project>();
const savedListeners = new Set<(summary: ProjectSummary) => void>();
let saving: Promise<void> | null = null;
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
      try {
        const summary = await api.saveProject(id, project);
        for (const listener of savedListeners) listener(summary);
      } catch (err) {
        // A deleted project can't be saved; anything else is retried.
        if (err instanceof ApiRequestError && err.status === 404) continue;
        console.error("Autosave failed; retrying", err);
        if (!pendingSaves.has(id)) pendingSaves.set(id, project);
        failed = true;
      }
    }
  })();
  await saving;
  saving = null;
  if (failed) {
    retryDelay = Math.min(retryDelay * 2, 30_000);
    scheduleSave(retryDelay);
  } else {
    retryDelay = 1000;
    // Edits made while the requests were in flight.
    if (pendingSaves.size) scheduleSave(0);
  }
}

/** Save everything pending right now (waits for an in-flight save first). */
async function flushAutosave(): Promise<void> {
  if (saving) await saving;
  await runSaves();
}

let autosaveStarted = false;
function startAutosave() {
  if (autosaveStarted) return;
  autosaveStarted = true;

  useEditor.subscribe((state, prev) => {
    // Opening/closing a project swaps the document; that isn't an edit.
    if (!state.projectId || state.projectId !== prev.projectId) return;
    const gestureEnded = prev.gestureBase !== null && state.gestureBase === null;
    if (state.gestureBase || (state.project === prev.project && !gestureEnded)) return;
    pendingSaves.set(state.projectId, state.project);
    if (!saving) scheduleSave(400);
  });

  window.addEventListener("pagehide", () => {
    for (const [id, project] of pendingSaves) void api.saveProject(id, project, true).catch(() => {});
  });
}

// ---------------------------------------------------------------------------
// Poll assets whose filmstrip/waveform are still being generated.
// ---------------------------------------------------------------------------

let polling = false;
async function pollProcessingAssets() {
  if (polling) return;
  polling = true;
  try {
    while (useEditor.getState().assets.some((a) => a.status === "processing")) {
      await new Promise((r) => setTimeout(r, 1000));
      const pending = useEditor.getState().assets.filter((a) => a.status === "processing");
      const gone = new Set<string>();
      const updated = await Promise.all(
        pending.map((a) =>
          api.getMedia(a.id).catch((err) => {
            // Deleted on the server: stop polling it. Other errors: try again next tick.
            if (err instanceof ApiRequestError && err.status === 404) gone.add(a.id);
            return null;
          }),
        ),
      );
      const byId = new Map(updated.filter((a): a is MediaAsset => !!a).map((a) => [a.id, a]));
      useEditor.setState({
        assets: useEditor
          .getState()
          .assets.filter((a) => !gone.has(a.id))
          .map((a) => byId.get(a.id) ?? a),
      });
    }
  } finally {
    polling = false;
  }
}
