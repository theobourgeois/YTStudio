import { create } from "zustand";
import { toast } from "sonner";
import { errorMessage } from "@shared/errors";
import { addChannels, addPluginChannel, getChannel, updateChannel } from "@shared/music/edits";
import { createId } from "@shared/ids";
import type { MusicProject, Pattern, PluginRef } from "@shared/music/types";
import type { MediaAsset } from "@shared/types";
import { ApiRequestError, api } from "@/lib/api";
import { createAutosaver } from "@/lib/autosaver";
import { DocumentGesture, type DocumentHistory, commit, historyOf, redo, rewrite, undo } from "@/lib/document-history";
import { useProjects } from "@/stores/projects";

/**
 * The open song: its document with undo (`lib/document-history.ts`), the project's media (its
 * samples), and the pattern shown. (What's selected and which windows are open is in `ui.ts`.) Every change to the document is a pure edit from
 * `shared/music/edits.ts`, through `commit` (one undo step) or a `songGesture()` (a drag).
 * The audio engine follows the document from `engine-sync.ts`; this store knows nothing of it.
 */
interface MusicState {
  projectId: string | null;
  history: DocumentHistory<MusicProject> | null;
  /** The project's media: a channel's `sampleId` is one of these. */
  assets: MediaAsset[];
  loading: boolean;
  loadError: string | null;
  /** The pattern the channel rack shows and the engine loops (UI state, not part of the song). */
  patternId: string | null;

  open: (projectId: string) => Promise<void>;
  close: () => Promise<void>;
  rename: (name: string) => Promise<void>;
  /** Apply an edit as one undo step. */
  commit: (update: (song: MusicProject) => MusicProject) => void;
  undo: () => void;
  redo: () => void;
  selectPattern: (id: string) => void;
  /** Bring audio files into the project and add a channel for each. */
  addSamples: (files: File[]) => Promise<void>;
  /** Add a channel playing an instrument plugin, or an empty sampler. Returns its id. */
  addChannel: (plugin: PluginRef | null) => string | null;
  /** The starter kit's drums (`public/kit/`), as four channels. */
  addStarterKit: () => Promise<void>;
  /** Give a channel another sample. */
  replaceSample: (channelId: string, file: File) => Promise<void>;
}

/** The starter kit, in the order FL Studio's default rack has them. */
export const STARTER_KIT = ["kick", "clap", "hat", "snare"] as const;

const autosaver = createAutosaver<MusicProject, Awaited<ReturnType<typeof api.saveDocument>>>({
  save: (id, song, keepalive) => api.saveDocument("music", id, song, keepalive),
  onSaved: (summary) => useProjects.getState().setSummary(summary),
  isGone: (err) => err instanceof ApiRequestError && err.status === 404,
});

/** Bumped by every open/close, so a load that's been overtaken is dropped. */
let openToken = 0;

const channelName = (fileName: string) => fileName.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").trim() || "Sample";

export const useMusic = create<MusicState>((set, get) => {
  /** Upload files as the open project's media; the ones that fail are reported and left out. */
  async function upload(files: File[]): Promise<MediaAsset[]> {
    const { projectId } = get();
    if (!projectId) return [];
    const added: MediaAsset[] = [];
    for (const file of files) {
      try {
        const asset = await api.uploadMedia(projectId, file);
        if (!asset.hasAudio) {
          void api.deleteMedia(asset.id).catch(() => {});
          throw new Error("it has no sound");
        }
        added.push(asset);
      } catch (err) {
        toast.error(`Couldn't add ${file.name}`, { description: errorMessage(err) });
      }
    }
    if (get().projectId === projectId) set({ assets: [...get().assets, ...added] });
    return get().projectId === projectId ? added : [];
  }

  return {
    projectId: null,
    history: null,
    assets: [],
    loading: false,
    loadError: null,
    patternId: null,

    async open(projectId) {
      if (get().projectId === projectId && get().history) return;
      await autosaver.flush();
      const token = ++openToken;
      set({ projectId, history: null, assets: [], loading: true, loadError: null, patternId: null });
      try {
        const [song, assets] = await Promise.all([api.getDocument("music", projectId), api.listMedia(projectId)]);
        if (token === openToken) set({ history: historyOf(song), assets, loading: false, patternId: song.patterns[0].id });
      } catch (err) {
        if (token === openToken) set({ loading: false, loadError: errorMessage(err) });
      }
    },

    async close() {
      ++openToken;
      await autosaver.flush();
      set({ projectId: null, history: null, assets: [], loading: false, loadError: null, patternId: null });
    },

    async rename(name) {
      const { projectId, history } = get();
      const trimmed = name.trim();
      if (!projectId || !history || !trimmed || trimmed === history.doc.name) return;
      // Not an undoable edit: undo mustn't bring the old name back.
      set({ history: rewrite(history, (song) => ({ ...song, name: trimmed })) });
    },

    commit(update) {
      const { history } = get();
      if (!history) return;
      const next = commit(history, update);
      if (next !== history) set({ history: next });
    },

    undo() {
      const { history } = get();
      if (history) set({ history: undo(history) });
    },

    redo() {
      const { history } = get();
      if (history) set({ history: redo(history) });
    },

    selectPattern: (patternId) => set({ patternId }),

    async addSamples(files) {
      const assets = await upload(files);
      get().commit((song) => addChannels(song, assets.map((a) => ({ name: channelName(a.name), sampleId: a.id }))));
    },

    addChannel(plugin) {
      if (!get().history) return null;
      const id = createId("chan");
      get().commit((song) => (plugin ? addPluginChannel(song, plugin, id) : addChannels(song, [{ id, name: "Sampler", sampleId: null }])));
      return id;
    },

    async addStarterKit() {
      try {
        const files = await Promise.all(
          STARTER_KIT.map(async (name) => {
            const response = await fetch(`/kit/${name}.wav`);
            if (!response.ok) throw new Error(`The starter kit's ${name} is missing.`);
            return new File([await response.blob()], `${name[0].toUpperCase()}${name.slice(1)}.wav`, { type: "audio/wav" });
          }),
        );
        await get().addSamples(files);
      } catch (err) {
        toast.error("Couldn't add the starter kit", { description: errorMessage(err) });
      }
    },

    async replaceSample(channelId, file) {
      const [asset] = await upload([file]);
      if (!asset) return;
      get().commit((song) => (getChannel(song, channelId) ? updateChannel(song, channelId, { sampleId: asset.id, name: channelName(asset.name) }) : song));
    },
  };
});

// Save the song when it changes outside a gesture (a gesture's result is saved when it ends).
useMusic.subscribe((state, prev) => {
  if (!state.projectId || state.projectId !== prev.projectId || !state.history || !prev.history) return;
  const gestureEnded = prev.history.gestureBase !== null && state.history.gestureBase === null;
  if (state.history.gestureBase || (state.history.doc === prev.history.doc && !gestureEnded)) return;
  autosaver.queue(state.projectId, state.history.doc);
});

if (typeof window !== "undefined") {
  window.addEventListener("pagehide", () => {
    const { projectId, history } = useMusic.getState();
    // Keep a gesture's current state rather than lose it.
    if (projectId && history?.gestureBase && history.doc !== history.gestureBase) autosaver.queue(projectId, history.doc);
    autosaver.saveOnUnload();
  });
}

export const flushSongs = () => autosaver.flush();
export const discardSong = (projectId: string) => autosaver.discard(projectId);

/** A drag or other continuous edit of the open song, as one undo step. */
export const songGesture = () =>
  new DocumentGesture<MusicProject>({
    get: () => useMusic.getState().history,
    set: (history) => useMusic.setState({ history }),
  });

/** Part of the open song. Only for components under the workspace, which renders once it's loaded. */
export function useSong<T>(selector: (song: MusicProject) => T): T {
  return useMusic((s) => selector(s.history!.doc));
}

/** The pattern being edited: the one picked, or the first if that one is gone (undone, removed). */
export const currentPattern = (song: MusicProject, patternId: string | null): Pattern => song.patterns.find((p) => p.id === patternId) ?? song.patterns[0];

export function useCurrentPattern<T>(selector: (pattern: Pattern, song: MusicProject) => T): T {
  return useMusic((s) => selector(currentPattern(s.history!.doc, s.patternId), s.history!.doc));
}
