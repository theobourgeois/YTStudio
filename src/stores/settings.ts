import { create } from "zustand";
import type { SuiteId } from "@shared/suites";
import { useAppWindows } from "./app-windows";

/** A tab of Settings: the app's own, or a suite's (`ClientSuite.settings`). */
export type SettingsSection = "general" | SuiteId;

/**
 * Settings (⌘,, `components/settings/`): a window over the whole app, as FL Studio's, open or not, and
 * which tab it shows. What's set lives with what it changes (the theme in `theme.ts`, each suite's in its
 * own stores); this is only the window.
 */
interface SettingsState {
  open: boolean;
  section: SettingsSection;
  /** Opens Settings on a tab (by default, the one it was last on), in front. */
  show: (section?: SettingsSection) => void;
  setSection: (section: SettingsSection) => void;
  close: () => void;
}

export const useSettings = create<SettingsState>((set, get) => ({
  open: false,
  section: "general",
  show(section = get().section) {
    useAppWindows.getState().focus("settings");
    set({ open: true, section });
  },
  setSection: (section) => set({ section }),
  close: () => set({ open: false }),
}));
