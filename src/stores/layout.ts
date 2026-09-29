import { create } from "zustand";

const SIDEBAR_KEY = "editor-sidebar-open";

/** The tabs of the left panel: the project's media, online media, transitions, and the selection's properties. */
export type LeftPanel = "media" | "online" | "transitions" | "properties";

/** What a press on the canvas does: select and transform clips, or add text (Premiere's Type tool). */
export type CanvasTool = "select" | "text";

interface LayoutState {
  sidebarOpen: boolean;
  toggleSidebar: () => void;
  /** The keyboard shortcuts dialog. */
  shortcutsOpen: boolean;
  setShortcutsOpen: (open: boolean) => void;
  leftPanel: LeftPanel;
  setLeftPanel: (panel: LeftPanel) => void;
  tool: CanvasTool;
  setTool: (tool: CanvasTool) => void;
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
}));
