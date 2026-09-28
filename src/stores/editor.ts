import { create } from "zustand";
import { toast } from "sonner";
import type { Clip, MediaAsset, Project, ProjectSettings } from "@shared/types";
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
}

interface EditorState {
  loaded: boolean;
  loadError: string | null;
  project: Project;
  /** Newest first. */
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

  init: () => Promise<void>;

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

  /** Upload files to the media library. Resolves with the assets that imported successfully. */
  importFiles: (files: File[]) => Promise<MediaAsset[]>;
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

export const useEditor = create<EditorState>((set, get) => ({
  loaded: false,
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

  async init() {
    try {
      const [assets, project] = await Promise.all([api.listMedia(), api.getProject()]);
      const byId = Object.fromEntries(assets.map((a) => [a.id, a]));
      set({ assets, project: normalizeProject(project, byId), loaded: true, loadError: null });
      startAutosave();
      pollProcessingAssets();
    } catch (err) {
      set({ loadError: err instanceof Error ? err.message : String(err) });
    }
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
    const results = await Promise.all(
      files.map(async (file) => {
        const upload: Upload = { id: createId("up"), name: file.name, progress: 0 };
        set({ uploads: [...get().uploads, upload] });
        try {
          const asset = await api.uploadMedia(file, (progress) => {
            set({ uploads: get().uploads.map((u) => (u.id === upload.id ? { ...u, progress } : u)) });
          });
          set({ assets: [asset, ...get().assets.filter((a) => a.id !== asset.id)] });
          return asset;
        } catch (err) {
          toast.error(`Couldn't import ${file.name}`, {
            description: err instanceof Error ? err.message : String(err),
          });
          return null;
        } finally {
          set({ uploads: get().uploads.filter((u) => u.id !== upload.id) });
        }
      }),
    );
    pollProcessingAssets();
    return results.filter((a): a is MediaAsset => a !== null);
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
// Autosave: debounced, one request in flight at a time (so saves can't land
// out of order), retried with backoff on failure, flushed on unload.
// Mid-gesture states are never saved; the result is saved when the gesture ends.
// ---------------------------------------------------------------------------

let autosaveStarted = false;
function startAutosave() {
  if (autosaveStarted) return;
  autosaveStarted = true;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let dirty = false;
  let saving = false;
  let retryDelay = 1000;

  const schedule = (ms: number) => {
    clearTimeout(timer);
    timer = setTimeout(flush, ms);
  };

  async function flush() {
    const { project, gestureBase } = useEditor.getState();
    if (!dirty || saving || gestureBase) return;
    dirty = false;
    saving = true;
    try {
      await api.saveProject(project);
      retryDelay = 1000;
    } catch (err) {
      console.error("Autosave failed; retrying", err);
      dirty = true;
      retryDelay = Math.min(retryDelay * 2, 30_000);
      schedule(retryDelay);
      return;
    } finally {
      saving = false;
    }
    // Edits made while the request was in flight.
    if (dirty) schedule(0);
  }

  useEditor.subscribe((state, prev) => {
    const gestureEnded = prev.gestureBase !== null && state.gestureBase === null;
    if (state.gestureBase || (state.project === prev.project && !gestureEnded)) return;
    dirty = true;
    if (!saving) schedule(400);
  });

  window.addEventListener("pagehide", () => {
    if (!dirty) return;
    const { project, gestureBase } = useEditor.getState();
    void api.saveProject(gestureBase ?? project, true).catch(() => {});
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
