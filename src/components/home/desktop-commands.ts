import { useEffect } from "react";
import type { SuiteId } from "@shared/suites";
import { appSuites } from "@/lib/app";
import { onDesktopCommand } from "@/lib/desktop";
import { useLayout } from "@/stores/layout";
import { useProjects } from "@/stores/projects";
import { showOpenDialog } from "./open-project-dialog";

/** What the desktop app's File menu does (electron/main.ts asks the page: `DesktopCommand`). */
export function useDesktopCommands() {
  useEffect(
    () =>
      onDesktopCommand((name) => {
        const projects = useProjects.getState();
        if (name === "home") void projects.goHome();
        else if (name === "closeTab") {
          if (projects.openId) void projects.closeTab(projects.openId);
        } else if (name === "open") showOpenDialog();
        else if (name === "newProject") useLayout.getState().setNewProjectOpen(true);
        else if (name === "reveal" && projects.openId) void projects.reveal(projects.openId);
        else if (name.startsWith("new:")) {
          const suite = name.slice("new:".length);
          if ((appSuites() as string[]).includes(suite)) void projects.create({ suite: suite as SuiteId });
        }
      }),
    [],
  );
}
