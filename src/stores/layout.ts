import { create } from "zustand";

const SIDEBAR_KEY = "editor-sidebar-open";

interface LayoutState {
  sidebarOpen: boolean;
  toggleSidebar: () => void;
}

export const useLayout = create<LayoutState>((set, get) => ({
  sidebarOpen: localStorage.getItem(SIDEBAR_KEY) !== "false",
  toggleSidebar() {
    const sidebarOpen = !get().sidebarOpen;
    localStorage.setItem(SIDEBAR_KEY, String(sidebarOpen));
    set({ sidebarOpen });
  },
}));
