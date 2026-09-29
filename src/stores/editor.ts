import { create } from "zustand";
import { toast } from "sonner";
import type {
  Clip,
  LibraryItem,
  MediaAsset,
  Project,
  ProjectSettings,
  Subclip,
  UseLibraryItemResponse,
  WebClip,
  WebDownloadProgress,
  WebMediaKind,
} from "@shared/types";
import { type CopiedEffects, addEffect, copyEffects, defaultEffects, effectDefinition, isTextClip, pasteEffects } from "@shared/effects";
import { placeTemplate } from "@shared/library";
import {
  type CopiedClip,
  addClip,
  addTrack,
  adjacentTrack,
  appendToTrack,
  canPlaceOnTrack,
  clipEnd,
  clipsAtTime,
  closeGap,
  copyClips,
  DEFAULT_PROJECT_NAME,
  createDefaultProject,
  createId,
  gapAt,
  getClip,
  getTrack,
  insertClip,
  isOnVideoTrack,
  moveClips,
  pasteClips,
  projectDuration,
  pruneEmptyTrack,
  removeAssetClips,
  removeClips,
  rippleDelete,
  rippleTrimTo,
  splitClips,
  videoTracks,
} from "@shared/timeline";
import {
  type TransitionRef,
  addTransition,
  findWindow,
  nearestEdge,
  removeTransition,
} from "@shared/transition-windows";
import { transitionDefinition } from "@shared/transitions";
import { errorMessage } from "@shared/errors";
import { normalizeProject } from "@shared/normalize";
import { type NewSubclip, addSubclips, getSubclip, removeSubclips, updateSubclip } from "@shared/subclips";
import { api } from "@/lib/api";
import { pollProcessingAssets, pollWebDownload, requestReversedCopies } from "./asset-polling";
import { flushAutosave, startAutosave } from "./autosave";
import { usePlayback } from "./playback";
import { assetMarkedRange, useSourceMarks } from "./source-marks";

export { discardPendingSave, flushAutosave, onProjectSaved, queueSave } from "./autosave";

const HISTORY_LIMIT = 100;
/** Hard zoom limits (px per second). The timeline's usable minimum depends on the edit's length (`minZoomFor`). */
export const MIN_ZOOM = 0.05;
export const MAX_ZOOM = 400;

export interface Upload {
  id: string;
  name: string;
  /** 0..1 */
  progress: number;
  /** Set for a clip being downloaded from the Online tab, with how far it's got. */
  download?: { url: string; kind: WebMediaKind; state: WebDownloadProgress };
}

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
  /** Selected clips, in selection order (the last one is shown in the Properties tab). */
  selectedClipIds: string[];
  /**
   * The empty stretch of a track selected by clicking it (never together with
   * clips). Deleting it closes it. Cleared by any edit, since the gap may have
   * moved or gone.
   */
  selectedGap: { trackId: string; start: number; end: number } | null;
  /** The selected transition (never together with clips or a gap). */
  selectedTransition: TransitionRef | null;
  /** Clips copied with ⌘C / cut with ⌘X. */
  clipboard: CopiedClip[];
  /** A clip's effects copied with Copy effects (⌥⌘C), to paste onto other clips. */
  effectsClipboard: CopiedEffects | null;
  /** Timeline zoom in pixels per second. */
  zoom: number;
  snapping: boolean;
  /**
   * Auto ripple (CapCut's, Premiere's ripple edits): deleting closes the gap, trimming moves
   * the clips after on the track along, and dropping media pushes them right. Kept in this browser.
   */
  autoRipple: boolean;

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

  /** Select just this clip (or nothing). */
  select: (clipId: string | null) => void;
  /** Select the gap at `time` on `trackId`; selects nothing when there's no gap there. */
  selectGap: (trackId: string, time: number) => void;
  setSelection: (clipIds: string[]) => void;
  selectTransition: (ref: TransitionRef | null) => void;
  /** Add the clip to the selection, or remove it if it's already selected. */
  toggleSelected: (clipId: string) => void;
  selectAll: () => void;
  setZoom: (zoom: number) => void;
  toggleSnapping: () => void;
  toggleAutoRipple: () => void;
  updateSettings: (patch: Partial<ProjectSettings>) => void;

  /**
   * Upload files into the open project's media. Resolves with the assets that imported
   * successfully (none if the user switched projects meanwhile). The first import into
   * an unnamed project names it after the file.
   */
  importFiles: (files: File[]) => Promise<MediaAsset[]>;
  /**
   * Download an online clip's audio or whole video into the open project's media and
   * put it on the timeline (see `addAssetsToTimeline`). Resolves true if it was added.
   */
  addWebMedia: (clip: WebClip, kind: WebMediaKind) => Promise<boolean>;
  /**
   * Put a Library item on the timeline. Its media is copied into the project (or
   * found there) first; then a file goes where `addAssetsToTimeline` puts it, and
   * saved clips where `placeTemplate` does (`at` defaults to the playhead).
   * Resolves with the item as the server updated it, or null if nothing was added.
   */
  addLibraryItem: (itemId: string, opts?: AddToTimelineOptions) => Promise<LibraryItem | null>;
  /**
   * Put several Library items on the timeline as one undoable step, one after
   * another from where the first goes. Resolves with the items that were added.
   */
  addLibraryItems: (itemIds: string[], opts?: AddToTimelineOptions) => Promise<LibraryItem[]>;
  deleteAsset: (assetId: string) => Promise<void>;
  getAsset: (assetId: string) => MediaAsset | undefined;
  /** Add media imported some other way (by the assistant) to the open project's list. */
  addImportedAssets: (assets: MediaAsset[]) => void;

  /**
   * Make subclips of a media file (named parts of it, listed in the Media tab) as one
   * undoable step. Returns their ids (none when the file can't have any or the parts are too short).
   */
  makeSubclips: (assetId: string, parts: NewSubclip[]) => string[];
  renameSubclip: (subclipId: string, name: string) => void;
  /** Delete subclips (undoable; their file and clips stay). */
  deleteSubclips: (subclipIds: string[]) => void;
  getSubclip: (subclipId: string) => Subclip | undefined;

  /**
   * Put media on the timeline as one undoable step, and select the last one. `ids` are
   * media files or subclips (which add their part of their file).
   * - `trackId` omitted or incompatible: pictures go on the bottom video track,
   *   sound only on the top audio track (created when there's none).
   * - `at` = timeline time of the first clip's left edge (the rest follow it). Without
   *   it, clips are appended after a video track's last clip, or start at 0 on audio.
   * - A file with In/Out marks (set in the source preview) adds only the marked part.
   * Returns the ids of the created clips.
   */
  addAssetsToTimeline: (ids: string[], opts?: AddToTimelineOptions) => string[];
  /**
   * Split at the playhead: the selected clips under it or, when none are, every
   * video-track clip under it.
   */
  splitAtPlayhead: () => void;
  /** Split specific clips at a timeline time (e.g. where a clip was right-clicked). */
  splitAt: (clipIds: string[], time: number) => void;
  /**
   * Put a transition on a clip edge (replacing the one there) and select it.
   * Returns false when it can't go there.
   */
  addTransitionAt: (ref: TransitionRef, type: string) => boolean;
  /**
   * Put a transition on the edit point nearest the playhead, like Premiere's
   * "Apply Default Transition": on the selected transition's place, else the
   * selected clip's track, else any video track.
   */
  applyTransition: (type: string) => void;
  /**
   * Add a video effect to these clips (those on video tracks), selecting them unless one
   * of them already is. False when none can have it.
   */
  addEffectTo: (clipIds: string[], type: string) => boolean;
  /** Add a video effect to the selected clips, or when none are, to the top clip under the playhead. */
  applyEffect: (type: string) => void;
  /**
   * Delete the selection; `ripple` (default: `autoRipple`) also closes the gaps it leaves.
   * A selected gap is always closed.
   */
  deleteSelected: (ripple?: boolean) => void;
  copySelected: () => void;
  cutSelected: () => void;
  /** Paste the clipboard with its first clip at `at` (default: the playhead). */
  paste: (at?: number) => void;
  /** Copy a clip's effects (default: the first selected clip's). */
  copyEffects: (clipId?: string) => void;
  /** Paste copied effects (just `types`, or all) onto the selected clips. */
  pasteEffects: (types?: string[]) => void;
  /** Copy the selection and paste it right after itself. */
  duplicateSelected: () => void;
  /** Move the selection by `seconds` if there's room (no jumping over other clips). */
  nudgeSelected: (seconds: number) => void;
  /** Move the selection to the next track of the same kind above (-1) or below (1), creating one at the edge. */
  moveSelectedToTrack: (dir: -1 | 1) => void;
  /** Cut the part before (`start`) or after (`end`) the playhead off the clips under it, closing the gap. */
  trimToPlayhead: (edge: "start" | "end") => void;
}

export interface AddToTimelineOptions {
  /** Track under the pointer; ignored when incompatible. */
  trackId?: string;
  /** Timeline time under the pointer. */
  at?: number;
  /**
   * Dropped above the top track ("above") or below the bottom one ("below"):
   * compatible assets go on a new video track on top, or a new audio track at the bottom.
   */
  newTrack?: "above" | "below";
  /**
   * The part of each file to use (source seconds, by asset id); the rest use all of theirs.
   * `addAssetsToTimeline` defaults it to the files' In/Out marks (`useSourceMarks`).
   */
  ranges?: Record<string, { in: number; out: number }>;
  /**
   * Insert at `at`, pushing the clips after it right (`insertClip`) instead of finding it a
   * free spot. `addAssetsToTimeline` defaults it to `autoRipple`.
   */
  ripple?: boolean;
}

let openToken = 0;
/** The project being opened (until it's loaded, or fails to). */
let opening: string | null = null;

/** The project the editor is opening or has open: the one whose document is the editor's (see `src/assistant/doc.ts`). */
export const editorProjectId = (): string | null => opening ?? useEditor.getState().projectId;

const emptyEditor = () => ({
  project: createDefaultProject(),
  assets: [] as MediaAsset[],
  uploads: [] as Upload[],
  selectedClipIds: [] as string[],
  selectedGap: null,
  selectedTransition: null,
  past: [] as Project[],
  future: [] as Project[],
  gestureBase: null,
});

const AUTO_RIPPLE_KEY = "editor-auto-ripple";

export const useEditor = create<EditorState>((set, get) => ({
  projectId: null,
  loading: false,
  loadError: null,
  project: createDefaultProject(),
  assets: [],
  uploads: [],
  selectedClipIds: [],
  selectedGap: null,
  selectedTransition: null,
  clipboard: [],
  effectsClipboard: null,
  zoom: 60,
  snapping: true,
  autoRipple: localStorage.getItem(AUTO_RIPPLE_KEY) === "true",
  past: [],
  future: [],
  gestureBase: null,
  gestureId: 0,

  async openProject(projectId) {
    // Already open (a click on another project that's still loading doesn't count).
    if (get().projectId === projectId && !get().loading && !get().loadError) return;
    const token = ++openToken;
    get().endGesture();
    usePlayback.getState().pause();
    opening = projectId;
    set({ loading: true, loadError: null });
    try {
      await flushAutosave();
      const [project, assets] = await Promise.all([
        api.getProject(projectId),
        api.listMedia(projectId),
      ]);
      if (token !== openToken) return;
      opening = null;
      const byId = Object.fromEntries(assets.map((a) => [a.id, a]));
      // One `set` so subscribers see the project switch atomically (autosave ignores it).
      set({ ...emptyEditor(), projectId, project: normalizeProject(project, byId), assets, loading: false });
      usePlayback.getState().seek(0);
      startAutosave(useEditor);
      requestReversedCopies(useEditor);
      pollProcessingAssets(useEditor);
    } catch (err) {
      if (token !== openToken) return;
      opening = null;
      // The previous project was saved above; show the error instead of it.
      set({ ...emptyEditor(), projectId: null, loading: false, loadError: errorMessage(err) });
    }
  },

  async closeProject() {
    ++openToken;
    opening = null;
    get().endGesture();
    usePlayback.getState().pause();
    await flushAutosave();
    set({ ...emptyEditor(), projectId: null, loading: false, loadError: null });
    usePlayback.getState().seek(0);
  },

  renameProject(name) {
    const trimmed = name.trim();
    if (!trimmed || trimmed === get().project.name) return;
    set(rewriteHistory(get(), (p) => ({ ...p, name: trimmed })));
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
    set({ selectedClipIds: clipId ? [clipId] : [], selectedGap: null, selectedTransition: null });
  },

  selectGap(trackId, time) {
    const gap = gapAt(get().project, trackId, time);
    set({ selectedClipIds: [], selectedGap: gap && { trackId, ...gap }, selectedTransition: null });
  },

  setSelection(clipIds) {
    set({ selectedClipIds: [...new Set(clipIds)], selectedGap: null, selectedTransition: null });
  },

  selectTransition(ref) {
    set({ selectedTransition: ref, selectedClipIds: [], selectedGap: null });
  },

  toggleSelected(clipId) {
    const ids = get().selectedClipIds;
    set({
      selectedClipIds: ids.includes(clipId) ? ids.filter((id) => id !== clipId) : [...ids, clipId],
      selectedGap: null,
      selectedTransition: null,
    });
  },

  selectAll() {
    set({ selectedClipIds: get().project.clips.map((c) => c.id), selectedGap: null, selectedTransition: null });
  },

  setZoom(zoom) {
    set({ zoom: Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom)) });
  },

  toggleSnapping() {
    set({ snapping: !get().snapping });
  },

  toggleAutoRipple() {
    const autoRipple = !get().autoRipple;
    set({ autoRipple });
    localStorage.setItem(AUTO_RIPPLE_KEY, String(autoRipple));
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
            description: errorMessage(err),
          });
          return null;
        } finally {
          if (stillOpen()) set({ uploads: get().uploads.filter((u) => u.id !== upload.id) });
        }
      }),
    );
    if (!stillOpen()) return [];
    pollProcessingAssets(useEditor);
    return results.filter((a): a is MediaAsset => a !== null);
  },

  async addWebMedia(clip, kind) {
    const projectId = get().projectId;
    if (!projectId || get().uploads.some((u) => u.download?.url === clip.url && u.download.kind === kind)) {
      return false;
    }
    const stillOpen = () => get().projectId === projectId;
    const upload: Upload = {
      id: createId("up"),
      name: clip.title,
      progress: 0,
      download: { url: clip.url, kind, state: { status: "waiting", progress: null } },
    };
    set({ uploads: [...get().uploads, upload] });
    void pollWebDownload(useEditor, upload.id);
    try {
      const asset = await api.importWebMedia({ projectId, url: clip.url, title: clip.title, kind });
      if (!stillOpen()) return false;
      set({ assets: [asset, ...get().assets.filter((a) => a.id !== asset.id)] });
      get().addAssetsToTimeline([asset.id]);
      pollProcessingAssets(useEditor);
      return true;
    } catch (err) {
      toast.error(`Couldn't add “${clip.title}”`, {
        description: errorMessage(err),
      });
      return false;
    } finally {
      if (stillOpen()) set({ uploads: get().uploads.filter((u) => u.id !== upload.id) });
    }
  },

  async addLibraryItem(itemId, opts = {}) {
    return (await get().addLibraryItems([itemId], opts))[0] ?? null;
  },

  async addLibraryItems(itemIds, opts = {}) {
    const projectId = get().projectId;
    if (!projectId || itemIds.length === 0) return [];
    // One at a time: each copies its media into the project, and a later one may reuse it.
    const used: UseLibraryItemResponse[] = [];
    for (const itemId of itemIds) {
      try {
        used.push(await api.useLibraryItem(itemId, { projectId }));
      } catch (err) {
        toast.error("Couldn't add it from the Library", { description: errorMessage(err) });
      }
      if (get().projectId !== projectId) return [];
    }
    if (used.length === 0) return [];
    const known = new Set(get().assets.map((a) => a.id));
    const fresh = new Map<string, MediaAsset>();
    for (const a of used.flatMap((u) => u.assets)) if (!known.has(a.id)) fresh.set(a.id, a);
    set({ assets: [...fresh.values(), ...get().assets] });

    let lastIds: string[] = [];
    let lastIsTemplate = false;
    get().commit((project) => {
      let p = project;
      let at = opts.at;
      for (const { template, assets } of used) {
        const placed = template
          ? placeTemplate(p, template, { ...opts, at: at ?? usePlayback.getState().time })
          : placeAssets(p, assets.filter((a) => a.duration > 0), {
              ...opts,
              at,
              ranges: opts.ranges ?? libraryRanges(assets),
              ripple: opts.ripple ?? get().autoRipple,
            });
        if (placed.clipIds.length === 0) continue;
        p = placed.project;
        lastIds = placed.clipIds;
        lastIsTemplate = !!template;
        // The next item starts where this one ends.
        at = Math.max(...placed.clipIds.map((id) => clipEnd(getClip(p, id)!)));
      }
      return p;
    });
    // Like adding one: saved clips select all of theirs, a file its clip.
    if (lastIds.length) get().setSelection(lastIsTemplate ? lastIds : [lastIds[lastIds.length - 1]]);
    pollProcessingAssets(useEditor);
    return used.map((u) => u.item);
  },

  async deleteAsset(assetId) {
    try {
      await api.deleteMedia(assetId);
    } catch (err) {
      toast.error("Couldn't delete media", {
        description: errorMessage(err),
      });
      return;
    }
    // Removing an asset's clips is an edit (undoable), but the asset itself is gone,
    // so strip it from history too to keep undo from resurrecting dangling clips.
    set({
      assets: get().assets.filter((a) => a.id !== assetId),
      ...rewriteHistory(get(), (p) => removeAssetClips(p, assetId)),
    });
    useSourceMarks.getState().clear(assetId);
    fixSelection();
  },

  getAsset(assetId) {
    return get().assets.find((a) => a.id === assetId);
  },

  addImportedAssets(assets) {
    const mine = assets.filter((a) => a.projectId === get().projectId);
    if (mine.length === 0) return;
    const ids = new Set(mine.map((a) => a.id));
    set({ assets: [...mine, ...get().assets.filter((a) => !ids.has(a.id))] });
    if (get().project.name === DEFAULT_PROJECT_NAME) get().renameProject(mine[0].name.replace(/\.[^.]+$/, ""));
    pollProcessingAssets(useEditor);
  },

  makeSubclips(assetId, parts) {
    const asset = get().getAsset(assetId);
    if (!asset) return [];
    let ids: string[] = [];
    get().commit((project) => {
      const made = addSubclips(project, asset, parts);
      ids = made.ids;
      return made.project;
    });
    return ids;
  },

  renameSubclip(subclipId, name) {
    const subclip = get().getSubclip(subclipId);
    const asset = subclip && get().getAsset(subclip.assetId);
    if (asset) get().commit((p) => updateSubclip(p, subclipId, { name }, asset.duration));
  },

  deleteSubclips(subclipIds) {
    get().commit((p) => removeSubclips(p, subclipIds));
  },

  getSubclip(subclipId) {
    return getSubclip(get().project, subclipId);
  },

  addAssetsToTimeline(ids, opts = {}) {
    const items: Placeable[] = [];
    for (const id of ids) {
      const subclip = get().getSubclip(id);
      const asset = get().getAsset(subclip?.assetId ?? id);
      if (!asset || !(asset.duration > 0)) continue;
      items.push(subclip ? { asset, range: { in: subclip.in, out: subclip.out } } : asset);
    }
    if (items.length === 0) return [];
    const ranges = opts.ranges ?? markedRanges(items.filter((i): i is MediaAsset => !("asset" in i)));
    let created: string[] = [];
    get().commit((project) => {
      const placed = placeAssets(project, items, { ...opts, ranges, ripple: opts.ripple ?? get().autoRipple });
      created = placed.clipIds;
      return placed.project;
    });
    if (created.length) get().setSelection([created[created.length - 1]]);
    return created;
  },

  splitAtPlayhead() {
    const time = usePlayback.getState().time;
    const targets = clipsToCutAt(time);
    if (targets.length === 0) {
      toast("Nothing to split here", { description: "Move the playhead over a clip." });
      return;
    }
    get().splitAt(targets.map((c) => c.id), time);
  },

  splitAt(clipIds, time) {
    const result = splitClips(get().project, clipIds, time);
    if (result.newClipIds.length === 0) {
      toast("Too close to the clip edge to split");
      return;
    }
    get().commit(() => result.project);
  },

  addTransitionAt(ref, type) {
    const result = addTransition(get().project, ref, type);
    if (!result.ref) return false;
    get().commit(() => result.project);
    get().selectTransition(result.ref);
    return true;
  },

  applyTransition(type) {
    const { project, selectedTransition, selectedClipIds } = get();
    const label = transitionDefinition(type)?.label ?? "transition";
    if (selectedTransition && findWindow(project, selectedTransition)) {
      get().addTransitionAt(selectedTransition, type);
      return;
    }
    const time = usePlayback.getState().time;
    const selected = selectedClipIds.map((id) => getClip(project, id)).find((c) => c && isOnVideoTrack(project, c));
    const ref = nearestEdge(project, time, selected ? [selected.trackId] : undefined);
    if (!ref || !get().addTransitionAt(ref, type)) {
      toast(`Nowhere to put the ${label}`, { description: "Add a clip to a video track first." });
    }
  },

  addEffectTo(clipIds, type) {
    const { project, added } = addEffect(get().project, clipIds, type);
    if (added.size === 0) return false;
    get().commit(() => project);
    const ids = [...added.keys()];
    if (!ids.some((id) => get().selectedClipIds.includes(id))) get().setSelection(ids);
    return true;
  },

  applyEffect(type) {
    const { project, selectedClipIds } = get();
    const label = effectDefinition(type)?.label ?? "effect";
    const time = usePlayback.getState().time;
    const onTop = videoTracks(project)
      .map((t) => clipsAtTime(project, time).find((c) => c.trackId === t.id))
      .find(Boolean);
    const targets = selectedClipIds.length ? selectedClipIds : onTop ? [onTop.id] : [];
    if (!get().addEffectTo(targets, type)) {
      toast(`Nothing to add ${label} to`, { description: "Select a clip on a video track, or drag the effect onto one." });
    }
  },

  deleteSelected(ripple = get().autoRipple) {
    const transition = get().selectedTransition;
    if (transition) {
      get().commit((p) => removeTransition(p, transition));
      set({ selectedTransition: null });
      return;
    }
    const gap = get().selectedGap;
    if (gap) {
      get().commit((p) => closeGap(p, gap.trackId, gap.start));
      return;
    }
    const ids = get().selectedClipIds;
    if (ids.length === 0) return;
    get().commit((p) => (ripple ? rippleDelete(p, ids) : removeClips(p, ids)));
    set({ selectedClipIds: [] });
  },

  copyEffects(clipId) {
    const { project, selectedClipIds } = get();
    const clip = getClip(project, clipId ?? selectedClipIds[0] ?? "");
    if (clip) set({ effectsClipboard: copyEffects(clip) });
  },

  pasteEffects(types) {
    const { effectsClipboard, selectedClipIds } = get();
    if (!effectsClipboard || selectedClipIds.length === 0) return;
    get().commit((p) => pasteEffects(p, selectedClipIds, effectsClipboard, types));
  },

  copySelected() {
    const copied = copyClips(get().project, get().selectedClipIds);
    if (copied.length) set({ clipboard: copied });
  },

  cutSelected() {
    const copied = copyClips(get().project, get().selectedClipIds);
    if (copied.length === 0) return;
    set({ clipboard: copied });
    get().deleteSelected();
  },

  paste(at) {
    const assetIds = new Set(get().assets.map((a) => a.id));
    // The media may have been deleted (or belong to another project) since the copy.
    const copied = get().clipboard.filter((c) => isTextClip(c.clip) || assetIds.has(c.clip.assetId));
    if (copied.length === 0) {
      if (get().clipboard.length) toast("The copied clips' media isn't in this project");
      return;
    }
    let clipIds: string[] = [];
    get().commit((p) => {
      const res = pasteClips(p, copied, at ?? usePlayback.getState().time);
      clipIds = res.clipIds;
      return res.project;
    });
    get().setSelection(clipIds);
  },

  duplicateSelected() {
    const { project, selectedClipIds } = get();
    const copied = copyClips(project, selectedClipIds);
    if (copied.length === 0) return;
    const end = Math.max(...copied.map((c) => clipEnd(c.clip)));
    let clipIds: string[] = [];
    get().commit((p) => {
      const res = pasteClips(p, copied, end);
      clipIds = res.clipIds;
      return res.project;
    });
    get().setSelection(clipIds);
  },

  nudgeSelected(seconds) {
    const ids = get().selectedClipIds;
    if (ids.length === 0) return;
    get().commit((p) => {
      const next = moveClips(p, ids, seconds);
      // Only if everything moved by exactly that much (moveClips would jump over neighbours).
      const exact = ids.every((id) => {
        const [a, b] = [getClip(p, id), getClip(next, id)];
        return !a || !b || Math.abs(b.start - (a.start + seconds)) < 1e-4;
      });
      return exact ? next : p;
    });
  },

  moveSelectedToTrack(dir) {
    const ids = get().selectedClipIds;
    if (ids.length === 0) return;
    get().commit((project) => {
      let p = project;
      const target = new Map<string, string>();
      const sources = new Set<string>();
      for (const id of ids) {
        const clip = getClip(p, id);
        if (!clip) continue;
        sources.add(clip.trackId);
        if (target.has(clip.trackId)) continue;
        const kind = getTrack(p, clip.trackId)?.kind;
        const next = adjacentTrack(p, clip.trackId, dir);
        if (next) {
          target.set(clip.trackId, next.id);
        } else if ((kind === "video" && dir === -1) || (kind === "audio" && dir === 1)) {
          const added = addTrack(p, kind);
          p = added.project;
          target.set(clip.trackId, added.trackId);
        } else {
          return project; // already at the edge
        }
      }
      const moved = moveClips(p, ids, 0, (c) => target.get(c.trackId) ?? c.trackId);
      // Only when every clip fits right where it is on its new track.
      const stayed = ids.every((id) => getClip(moved, id)?.start === getClip(p, id)?.start);
      if (!stayed) return project;
      let result = moved;
      for (const trackId of sources) result = pruneEmptyTrack(result, trackId);
      return result;
    });
  },

  trimToPlayhead(edge) {
    const time = usePlayback.getState().time;
    const targets = clipsToCutAt(time);
    if (targets.length === 0) return;
    get().commit((p) => targets.reduce((q, c) => rippleTrimTo(q, c.id, edge, time), p));
    // The playhead now sits on the cut; start trims pull the clip under it.
    if (edge === "start") {
      const starts = targets.map((c) => getClip(get().project, c.id)?.start ?? time);
      usePlayback.getState().seek(Math.min(...starts));
    }
  },
}));

/**
 * The clips a playhead edit (split, trim to playhead) applies to: the selected
 * clips under `time` or, when none are, every video-track clip under it.
 */
function clipsToCutAt(time: number): Clip[] {
  const { project, selectedClipIds } = useEditor.getState();
  const under = clipsAtTime(project, time);
  const selected = under.filter((c) => selectedClipIds.includes(c.id));
  return selected.length ? selected : under.filter((c) => isOnVideoTrack(project, c));
}

/** A file to put on the timeline, or a part of one (a subclip), whatever `ranges` says about the file. */
export type Placeable = MediaAsset | { asset: MediaAsset; range: { in: number; out: number } };

/**
 * Where `addAssetsToTimeline` puts assets (see its doc), as a pure edit: the project with them
 * placed, and the new clips' ids. Also used for videos that aren't open (the assistant).
 */
export function placeAssets(project: Project, items: readonly Placeable[], opts: AddToTimelineOptions = {}): { project: Project; clipIds: string[] } {
  const created: string[] = [];
  let p = project;
  const requested = opts.trackId ? getTrack(p, opts.trackId) : undefined;
  let newVideo: string | null = null;
  let newAudio: string | null = null;
  const destination = (a: MediaAsset): string => {
    if (requested && canPlaceOnTrack(a, requested)) return requested.id;
    if (opts.newTrack === "above" && a.hasVideo) {
      if (!newVideo) ({ project: p, trackId: newVideo } = addTrack(p, "video"));
      return newVideo;
    }
    if (opts.newTrack === "below" && !a.hasVideo) {
      if (!newAudio) ({ project: p, trackId: newAudio } = addTrack(p, "audio"));
      return newAudio;
    }
    // Default homes: the bottom video track, the top audio track.
    if (a.hasVideo) return videoTracks(p).at(-1)!.id;
    const audio = p.tracks.find((t) => t.kind === "audio");
    if (audio) return audio.id;
    const added = addTrack(p, "audio");
    p = added.project;
    return added.trackId;
  };

  // Assets dropped together are laid end to end on each track.
  const cursor = new Map<string, number>();
  for (const item of items) {
    const asset = "asset" in item ? item.asset : item;
    const range = "asset" in item ? item.range : opts.ranges?.[asset.id];
    const trackId = destination(asset);
    const clip: Clip = {
      id: createId("clip"),
      assetId: asset.id,
      trackId,
      start: 0,
      in: range?.in ?? 0,
      out: range?.out ?? asset.duration,
      effects: defaultEffects(),
    };
    const at = cursor.get(trackId) ?? opts.at;
    if (at === undefined && getTrack(p, trackId)?.kind === "video") {
      p = appendToTrack(p, clip, trackId);
    } else {
      const placed = { ...clip, start: Math.max(0, at ?? 0) };
      p = opts.ripple && at !== undefined ? insertClip(p, placed) : addClip(p, placed);
    }
    cursor.set(trackId, clipEnd(getClip(p, clip.id)!));
    created.push(clip.id);
  }
  return { project: p, clipIds: created };
}

/**
 * The marked part of each of `assets` just copied from the Library: the marks were set on
 * the Library's copy of the file (its `origin`), unless the project's copy has its own.
 */
function libraryRanges(assets: MediaAsset[]): Record<string, { in: number; out: number }> {
  const ranges: Record<string, { in: number; out: number }> = {};
  for (const a of assets) {
    const range = assetMarkedRange(a) ?? (a.origin ? assetMarkedRange({ ...a, id: a.origin }) : null);
    if (range) ranges[a.id] = range;
  }
  return ranges;
}

/** The marked part of each of `assets` that has In/Out marks. */
function markedRanges(assets: MediaAsset[]): Record<string, { in: number; out: number }> {
  const ranges: Record<string, { in: number; out: number }> = {};
  for (const a of assets) {
    const range = assetMarkedRange(a);
    if (range) ranges[a.id] = range;
  }
  return ranges;
}

/**
 * A change that isn't an edit of its own (a rename, media that's gone) applied
 * to the document and every snapshot in the history, so undo can't bring back
 * the old state.
 */
function rewriteHistory(
  state: Pick<EditorState, "project" | "past" | "future" | "gestureBase">,
  rewrite: (p: Project) => Project,
): Pick<EditorState, "project" | "past" | "future" | "gestureBase"> {
  return {
    project: rewrite(state.project),
    past: state.past.map(rewrite),
    future: state.future.map(rewrite),
    gestureBase: state.gestureBase ? rewrite(state.gestureBase) : null,
  };
}

/**
 * After an edit: drop clips that no longer exist from the selection, any
 * selected gap, and the selected transition once it no longer plays.
 */
function fixSelection() {
  const { selectedClipIds, selectedGap, selectedTransition, project } = useEditor.getState();
  const kept = selectedClipIds.filter((id) => getClip(project, id));
  if (kept.length !== selectedClipIds.length) useEditor.setState({ selectedClipIds: kept });
  if (selectedGap) useEditor.setState({ selectedGap: null });
  if (selectedTransition && !findWindow(project, selectedTransition)) useEditor.setState({ selectedTransition: null });
}

// Keep the playback clock's duration in sync with the timeline.
useEditor.subscribe((state, prev) => {
  if (state.project !== prev.project) {
    usePlayback.getState().setDuration(projectDuration(state.project));
  }
});
