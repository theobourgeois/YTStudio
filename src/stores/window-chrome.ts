import { create } from "zustand";

const TABS_HIDDEN_KEY = "editor-tabs-hidden";

/**
 * How the window starts (Settings › General): with the tab strip, or without it, the menu row at the top. In the
 * desktop app on a Mac, without the strip the system's window buttons go and the page's own sit at the right of the
 * top bar (`WindowButtons`); Windows keeps the system's, which are already there.
 */
interface WindowChromeState {
  tabsHidden: boolean;
  setTabsHidden: (hidden: boolean) => void;
}

export const useWindowChrome = create<WindowChromeState>((set) => ({
  tabsHidden: localStorage.getItem(TABS_HIDDEN_KEY) === "true",
  setTabsHidden(tabsHidden) {
    localStorage.setItem(TABS_HIDDEN_KEY, String(tabsHidden));
    set({ tabsHidden });
  },
}));
