import { useShallow } from "zustand/react/shallow";
import { tabsVisible } from "@/stores/project-tabs";
import { useProjects } from "@/stores/projects";
import { useWindowChrome } from "@/stores/window-chrome";

/** The projects open as tabs that can still be shown (a package moved away has nothing to open). */
export function useTabIds(): string[] {
  return useProjects(
    useShallow((s) => s.tabs.filter((id) => s.projects.some((p) => p.id === id && !p.missing))),
  );
}

/** Whether the strip shows (`tabsVisible`); the Home button gives way to it, and headers lose their room for it. */
export function useTabsShown(): boolean {
  const count = useTabIds().length;
  const home = useProjects((s) => s.openId === null);
  const hidden = useWindowChrome((s) => s.tabsHidden);
  return tabsVisible(count, home, hidden);
}
