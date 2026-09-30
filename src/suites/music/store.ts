import { create } from "zustand";
import { toast } from "sonner";
import { errorMessage } from "@shared/errors";
import type { MusicProject } from "@shared/music/types";
import { api } from "@/lib/api";
import { useProjects } from "@/stores/projects";

/**
 * The open song. A shell for now: it loads the document and renames it. Edits will follow the video
 * editor's rules (`stores/editor.ts`): pure `(MusicProject) => MusicProject` changes from `shared/music/`,
 * committed as undo steps and autosaved.
 */
interface MusicState {
  projectId: string | null;
  song: MusicProject | null;
  loading: boolean;
  loadError: string | null;
  open: (projectId: string) => Promise<void>;
  close: () => Promise<void>;
  rename: (name: string) => Promise<void>;
}

/** Bumped by every open/close, so a load that's been overtaken is dropped. */
let openToken = 0;

export const useMusic = create<MusicState>((set, get) => ({
  projectId: null,
  song: null,
  loading: false,
  loadError: null,

  async open(projectId) {
    if (get().projectId === projectId && get().song) return;
    const token = ++openToken;
    set({ projectId, song: null, loading: true, loadError: null });
    try {
      const song = await api.getDocument("music", projectId);
      if (token === openToken) set({ song, loading: false });
    } catch (err) {
      if (token === openToken) set({ loading: false, loadError: errorMessage(err) });
    }
  },

  async close() {
    ++openToken;
    set({ projectId: null, song: null, loading: false, loadError: null });
  },

  async rename(name) {
    const { projectId, song } = get();
    const trimmed = name.trim();
    if (!projectId || !song || !trimmed || trimmed === song.name) return;
    set({ song: { ...song, name: trimmed } });
    try {
      useProjects.getState().setSummary(await api.updateProject(projectId, { name: trimmed }));
    } catch (err) {
      if (get().projectId === projectId) set({ song: get().song && { ...get().song!, name: song.name } });
      toast.error("Couldn't rename the song", { description: errorMessage(err) });
    }
  },
}));
