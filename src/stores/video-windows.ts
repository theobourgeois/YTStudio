import { create } from "zustand";
import { createWindows } from "@/components/windows/store";
import { useEditor } from "./editor";

/**
 * The video editor's windows, floating over it (`components/workspace/video-desktop.tsx`): what were its
 * dialogs. Its main layout (the left panel, the Program monitor, the timeline) stays docked, as Premiere's.
 */
export type VideoWindowId = "export" | "video-settings" | "captions" | "save-to-library";

/** Where the video editor's windows are, and which is in front. */
export const useVideoWindows = createWindows<VideoWindowId>();

/**
 * Whether the export and video settings windows are open. (Auto captions and Save to Library keep theirs
 * with what they work on: `useCaptions`, `useSaveToLibrary`.)
 */
interface OpenVideoWindows {
  export: boolean;
  settings: boolean;
  /** Open one, in front (or bring it to the front if it's open). */
  show: (which: "export" | "settings") => void;
  close: (which: "export" | "settings") => void;
}

const WINDOW: Record<"export" | "settings", VideoWindowId> = { export: "export", settings: "video-settings" };

export const useOpenVideoWindows = create<OpenVideoWindows>((set) => ({
  export: false,
  settings: false,
  show(which) {
    useVideoWindows.getState().focus(WINDOW[which]);
    set({ [which]: true });
  },
  close: (which) => set({ [which]: false }),
}));

// Another video: its own export and settings, closed (the windows' places are kept, as the app's are).
useEditor.subscribe((state, prev) => {
  if (state.projectId !== prev.projectId) useOpenVideoWindows.setState({ export: false, settings: false });
});
