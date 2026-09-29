import { create } from "zustand";

const SIDEBAR_KEY = "editor-sidebar-open";
const KEYFRAMES_KEY = "editor-keyframes-open";

/** The tabs of the left panel: media (from `MediaSource`), transitions, captions, and the selection's properties. */
export type LeftPanelTab = "media" | "transitions" | "captions" | "properties";

/**
 * Where the Media tab's files come from: this video's own media, the Library shared by every
 * video, or online. One tab with a switch, like CapCut's Media panel, so the tab strip stays short.
 */
export type MediaSource = "project" | "library" | "online";

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
  mediaSource: MediaSource;
  /** Shows the Media tab on this source. */
  showMedia: (source: MediaSource) => void;
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
  mediaSource: "project",
  showMedia(mediaSource) {
    set({ leftPanel: "media", mediaSource });
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
