import { create } from "zustand";
import { toast } from "sonner";
import { errorMessage } from "@shared/errors";
import { addChannels, addPluginChannel, getChannel, updateChannel } from "@shared/music/edits";
import { addAudioClips } from "@shared/music/playlist";
import { createId } from "@shared/ids";
import type { MusicProject, Pattern, PluginRef } from "@shared/music/types";
import type { MediaAsset } from "@shared/types";
import { ApiRequestError, api } from "@/lib/api";
import { createAutosaver } from "@/lib/autosaver";
import { DocumentGesture, type DocumentHistory, commit, historyOf, redo, rewrite, undo } from "@/lib/document-history";
import { useProjects } from "@/stores/projects";
import { musicApi } from "./api";
import { useTransport } from "./transport";
import { type DraftPattern, draftAsPattern, editWithDraft, stepPattern } from "./patterns";

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
  /** The next pattern, shown empty past the last one, not in the song until something's put in it (`patterns.ts`). */
  draftPattern: DraftPattern | null;

  open: (projectId: string) => Promise<void>;
  /** Read the project's media again (a file's waveform is made after it's added). */
  refreshAssets: () => Promise<void>;
  close: () => Promise<void>;
  rename: (name: string) => Promise<void>;
  /** Apply an edit as one undo step. */
  commit: (update: (song: MusicProject) => MusicProject) => void;
  undo: () => void;
  redo: () => void;
  selectPattern: (id: string) => void;
  /** Show the pattern a step up or down the selector (past the last one, a draft). */
  stepPattern: (direction: 1 | -1) => void;
  /**
   * Audio files (the Browser's, by path, or from Finder) as audio clips on the playlist (FL's): a channel of
   * its own for each, in the rack's Audio group, and a clip as long as the file, the first at `start` on
   * `track`, the next ones on the tracks below (`after`: one after another on that track). Returns the clips' ids.
   */
  addAudioClips: (source: { paths: string[] } | { files: File[] }, at: { start: number; track: number; after?: boolean }) => Promise<number[]>;
  /** Bring audio files into the project and add a channel for each, at the end of the rack or before channel `at`. */
  addSamples: (files: File[], at?: number) => Promise<void>;
  /** Add a channel playing an instrument plugin, or an empty sampler. Returns its id. */
  addChannel: (plugin: PluginRef | null) => string | null;
  /** The starter kit's drums (`public/kit/`), as four channels. */
  addStarterKit: () => Promise<void>;
  /** Give a channel another sample. */
  replaceSample: (channelId: string, file: File) => Promise<void>;
  /** The Browser's files (by path) as new channels, at the end of the rack or before channel `at`. Returns their ids. */
  addBrowserSamples: (paths: string[], at?: number) => Promise<string[]>;
  /**
   * Give a channel one of the Browser's files. `swap`: trying samples one after another (Shift+Up/Down),
   * each replacing the last as one undo step, so undo goes back to the sample from before.
   */
  replaceSampleFromBrowser: (channelId: string, path: string, options?: { swap?: boolean }) => Promise<void>;
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
/** The song as the last sample swap left it (`replaceSampleFromBrowser`), to replace that undo step with the next swap's. */
let lastSwap: { channelId: string; doc: MusicProject } | null = null;

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

  /** The Browser's files as the open project's media (copied the first time); the ones that fail are reported and left out. */
  async function fromBrowser(paths: string[]): Promise<MediaAsset[]> {
    const { projectId } = get();
    if (!projectId) return [];
    const got: MediaAsset[] = [];
    for (const path of paths) {
      try {
        const asset = await musicApi.useBrowserFile({ projectId, path });
        if (!asset.hasAudio) throw new Error("it has no sound");
        got.push(asset);
      } catch (err) {
        toast.error(`Couldn't add ${path.slice(path.lastIndexOf("/") + 1)}`, { description: errorMessage(err) });
      }
    }
    if (get().projectId !== projectId) return [];
    const known = new Set(get().assets.map((a) => a.id));
    const added = got.filter((a, i) => !known.has(a.id) && got.findIndex((b) => b.id === a.id) === i);
    if (added.length) set({ assets: [...get().assets, ...added] });
    return got;
  }

  return {
    projectId: null,
    history: null,
    assets: [],
    loading: false,
    loadError: null,
    patternId: null,
    draftPattern: null,

    async open(projectId) {
      if (get().projectId === projectId && get().history) return;
      await autosaver.flush();
      const token = ++openToken;
      set({ projectId, history: null, assets: [], loading: true, loadError: null, patternId: null, draftPattern: null });
      try {
        const [song, assets] = await Promise.all([api.getDocument("music", projectId), api.listMedia(projectId)]);
        if (token !== openToken) return;
        // A song with clips on its playlist opens in song mode (Théo); the mode isn't saved.
        useTransport.getState().setMode(song.playlist.clips.length ? "song" : "pattern");
        set({ history: historyOf(song), assets, loading: false, patternId: song.patterns[0].id });
      } catch (err) {
        if (token === openToken) set({ loading: false, loadError: errorMessage(err) });
      }
    },

    async refreshAssets() {
      const { projectId } = get();
      if (!projectId) return;
      const assets = await api.listMedia(projectId).catch(() => null);
      if (assets && get().projectId === projectId) set({ assets });
    },

    async close() {
      ++openToken;
      await autosaver.flush();
      set({ projectId: null, history: null, assets: [], loading: false, loadError: null, patternId: null, draftPattern: null });
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
      const next = commit(history, draftEdit(update));
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

    selectPattern: (patternId) => set({ patternId, draftPattern: get().draftPattern?.id === patternId ? get().draftPattern : null }),
    stepPattern(direction) {
      const { history, patternId, draftPattern } = get();
      if (!history) return;
      const next = stepPattern(history.doc, patternId, draftPattern, direction);
      set({ patternId: next.patternId, draftPattern: next.draft });
    },

    async addSamples(files, at) {
      const assets = await upload(files);
      get().commit((song) => addChannels(song, assets.map((a) => ({ name: channelName(a.name), sampleId: a.id })), at));
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

    async addAudioClips(source, at) {
      const assets = "paths" in source ? await fromBrowser(source.paths) : await upload(source.files);
      if (!assets.length || !get().history) return [];
      let clipIds: number[] = [];
      get().commit((song) => {
        const result = addAudioClips(
          song,
          assets.map((a) => ({ name: channelName(a.name), sampleId: a.id, seconds: a.duration })),
          at,
        );
        clipIds = result.clipIds;
        return result.song;
      });
      return clipIds;
    },

    async addBrowserSamples(paths, at) {
      const assets = await fromBrowser(paths);
      if (!assets.length) return [];
      const added = assets.map((a) => ({ id: createId("chan"), name: channelName(a.name), sampleId: a.id }));
      get().commit((song) => addChannels(song, added, at));
      return added.map((c) => c.id);
    },

    async replaceSampleFromBrowser(channelId, path, { swap = false } = {}) {
      const [asset] = await fromBrowser([path]);
      const { history } = get();
      if (!asset || !history) return;
      const edit = (song: MusicProject) => (getChannel(song, channelId) ? updateChannel(song, channelId, { sampleId: asset.id, name: channelName(asset.name) }) : song);
      // The swap before this one is taken back and this one made instead: one undo step for the lot.
      const replacing = swap && lastSwap?.channelId === channelId && lastSwap.doc === history.doc && history.gestureBase === null;
      const next = commit(replacing ? undo(history) : history, draftEdit(edit));
      if (next === history) return;
      set({ history: next });
      lastSwap = swap ? { channelId, doc: next.doc } : null;
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

/** An edit of the song as it's shown: with the draft pattern in it, if that's the one shown (`editWithDraft`). */
function draftEdit(update: (song: MusicProject) => MusicProject): (song: MusicProject) => MusicProject {
  const { patternId, draftPattern: draft } = useMusic.getState();
  return draft && draft.id === patternId ? (song) => editWithDraft(song, draft, update) : update;
}

/** A continuous edit of the song, applied as the song is shown (with the draft pattern, if it's shown). */
class SongGesture extends DocumentGesture<MusicProject> {
  apply(update: (song: MusicProject) => MusicProject) {
    super.apply(draftEdit(update));
  }
}

/** A drag or other continuous edit of the open song, as one undo step. */
export const songGesture = () =>
  new SongGesture({
    get: () => useMusic.getState().history,
    set: (history) => useMusic.setState({ history }),
  });

/** Part of the open song. Only for components under the workspace, which renders once it's loaded. */
export function useSong<T>(selector: (song: MusicProject) => T): T {
  return useMusic((s) => selector(s.history!.doc));
}

/** The pattern being edited: the one picked (maybe the draft), or the first if that one is gone (undone, removed). */
export function currentPattern(song: MusicProject, patternId: string | null): Pattern {
  const found = song.patterns.find((p) => p.id === patternId);
  if (found) return found;
  // The draft past the last pattern, shown empty.
  const draft = useMusic.getState().draftPattern;
  return draft && draft.id === patternId ? draftAsPattern(draft) : song.patterns[0];
}

export function useCurrentPattern<T>(selector: (pattern: Pattern, song: MusicProject) => T): T {
  return useMusic((s) => selector(currentPattern(s.history!.doc, s.patternId), s.history!.doc));
}
