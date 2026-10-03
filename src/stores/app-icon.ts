import { create } from "zustand";
import { type AppIconId, appIconUrl, isAppIconId } from "@shared/app-icons";
import type {} from "@/lib/desktop";

const KEY = "editor-app-icon";

function savedIcon(): AppIconId {
  const saved = localStorage.getItem(KEY);
  return isAppIconId(saved) ? saved : "original";
}

function applyFavicon(id: AppIconId) {
  let link = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
  if (!link) {
    link = document.createElement("link");
    link.rel = "icon";
    document.head.append(link);
  }
  link.type = "image/png";
  link.href = appIconUrl(id);
}

interface AppIconState {
  choice: AppIconId;
  busy: boolean;
  error: string | null;
  init(): Promise<void>;
  setIcon(id: AppIconId): Promise<void>;
}

export const useAppIcon = create<AppIconState>((set, get) => ({
  choice: savedIcon(),
  busy: true,
  error: null,
  async init() {
    try {
      const desktop = window.editorDesktopInfo?.appIcon;
      const saved = desktop ? await desktop.get() : savedIcon();
      const choice = isAppIconId(saved) ? saved : "original";
      applyFavicon(choice);
      set({ choice, busy: false });
    } catch {
      set({ busy: false, error: "Couldn't load your app icon preference." });
    }
  },
  async setIcon(choice) {
    if (get().busy || !isAppIconId(choice)) return;
    set({ busy: true, error: null });
    try {
      await window.editorDesktopInfo?.appIcon?.set(choice);
      if (!window.editorDesktopInfo?.appIcon) localStorage.setItem(KEY, choice);
      applyFavicon(choice);
      set({ choice });
    } catch {
      set({ error: "Couldn't change the app icon. Please try again." });
    } finally {
      set({ busy: false });
    }
  },
}));
