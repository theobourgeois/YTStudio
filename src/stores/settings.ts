import { create } from "zustand";
import type { SuiteId } from "@shared/suites";

/** A page of Settings: the app's own, or a suite's (`ClientSuite.settings`). */
export type SettingsSection = "general" | SuiteId;

/**
 * Settings (⌘,, `components/settings/`): a page of its own over the whole window, open or not, and which
 * section it shows. What's set lives with what it changes (the theme in `theme.ts`, each suite's in its own
 * stores); this is only the page.
 */
interface SettingsState {
  open: boolean;
  section: SettingsSection;
  /** Opens Settings on a section (by default, the one it was last on). */
  show: (section?: SettingsSection) => void;
  setSection: (section: SettingsSection) => void;
  close: () => void;
}

export const useSettings = create<SettingsState>((set, get) => ({
  open: false,
  section: "general",
  show: (section = get().section) => set({ open: true, section }),
  setSection: (section) => set({ section }),
  close: () => set({ open: false }),
}));
