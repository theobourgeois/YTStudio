import { create } from "zustand";

const SIDEBAR_KEY = "editor-sidebar-open";
const KEYFRAMES_KEY = "editor-keyframes-open";

/**
 * The tabs of the left panel: the project's media, the Library shared by every project,
 * online media, transitions, captions, and the selection's properties.
 */
export type LeftPanelTab = "media" | "library" | "online" | "transitions" | "captions" | "properties";

/** What a press on the canvas does: select and transform clips, or add text (Premiere's Type tool). */
export type CanvasTool = "select" | "text";

interface LayoutState {
  sidebarOpen: boolean;
  toggleSidebar: () => void;
  /** The keyboard shortcuts dialog. */
  shortcutsOpen: boolean;
  setShortcutsOpen: (open: boolean) => void;
  leftPanel: LeftPanelTab;
  setLeftPanel: (panel: LeftPanelTab) => void;
  tool: CanvasTool;
  setTool: (tool: CanvasTool) => void;
  /** The Properties tab shows keyframe lanes next to the values (Premiere's Effect Controls timeline). */
  keyframesOpen: boolean;
  toggleKeyframes: () => void;
}

export const useLayout = create<LayoutState>((set, get) => ({
  sidebarOpen: localStorage.getItem(SIDEBAR_KEY) !== "false",
  toggleSidebar() {
    const sidebarOpen = !get().sidebarOpen;
    localStorage.setItem(SIDEBAR_KEY, String(sidebarOpen));
    set({ sidebarOpen });
  },
  shortcutsOpen: false,
  setShortcutsOpen(shortcutsOpen) {
    set({ shortcutsOpen });
  },
  leftPanel: "media",
  setLeftPanel(leftPanel) {
    set({ leftPanel });
  },
  tool: "select",
  setTool(tool) {
    set({ tool });
  },
  keyframesOpen: localStorage.getItem(KEYFRAMES_KEY) === "true",
  toggleKeyframes() {
    const keyframesOpen = !get().keyframesOpen;
    localStorage.setItem(KEYFRAMES_KEY, String(keyframesOpen));
    set({ keyframesOpen });
  },
}));
