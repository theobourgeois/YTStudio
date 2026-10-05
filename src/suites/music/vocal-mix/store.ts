import { create } from "zustand";
import { request } from "@/lib/api";
import { acceptVocalAlternative, type VocalMixRun, type VocalVariant } from "@shared/music/audio-intelligence/vocal-mix";
import { useMusic } from "../store";

export const vocalMixTool = <T>(projectId: string, name: string, input: object) =>
  request<T>(`/api/music/audio/${encodeURIComponent(projectId)}/tools/${name}`, { method: "POST", body: JSON.stringify(input) });

export const useVocalMix = create<{ projectId: string | null; open: boolean; runId: string | null;
  show: (projectId: string, runId?: string) => void; close: () => void; remember: (runId: string) => void }>((set, get) => ({
  projectId: null, open: false, runId: null,
  show(projectId, runId) {
    const remembered = localStorage.getItem(`vaudio.vocalMix.${projectId}`);
    set({ projectId, open: true, runId: runId ?? (get().projectId === projectId ? get().runId : null) ?? remembered });
  },
  close: () => set({ open: false }),
  remember(runId) {
    const projectId = get().projectId;
    if (projectId) localStorage.setItem(`vaudio.vocalMix.${projectId}`, runId);
    set({ runId });
  },
}));

/** Revalidate source files on the server, then commit synchronously against the live revision. */
export async function applyVocalMix(projectId: string, runId: string, variant: VocalVariant) {
  const initial = useMusic.getState();
  if (initial.projectId !== projectId || !initial.history) throw new Error("Open this comparison's song before applying it.");
  const { run } = await vocalMixTool<{ run: VocalMixRun }>(projectId, "validate_vocal_mix_apply", { runId, song: initial.history.doc });
  const current = useMusic.getState();
  if (current.projectId !== projectId || !current.history) throw new Error("The open song changed while validating.");
  current.commit(song => acceptVocalAlternative(song, run, variant));
}
