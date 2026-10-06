import { create } from "zustand";
import { useEditor } from "./editor";
import { useVideoWindows } from "./video-windows";

/** The shader editor's window id. */
export const SHADER_WINDOW = "shader" as const;

/**
 * The shader editor (the visualizer's V6, `components/shader/`): which clip's Shader effect it edits, if
 * it's open. One at a time, as Premiere opens one effect's settings.
 */
interface ShaderEditorState {
  target: { clipId: string; effectId: string } | null;
  /** Open it (in front) on a clip's Shader effect. */
  open: (clipId: string, effectId: string) => void;
  close: () => void;
}

export const useShaderEditor = create<ShaderEditorState>((set) => ({
  target: null,
  open(clipId, effectId) {
    useVideoWindows.getState().focus(SHADER_WINDOW);
    set({ target: { clipId, effectId } });
  },
  close: () => set({ target: null }),
}));

// Another video: its shaders aren't this one's.
useEditor.subscribe((state, prev) => {
  if (state.projectId !== prev.projectId) useShaderEditor.setState({ target: null });
});
