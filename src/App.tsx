import { useEffect } from "react";
import { PiSpinnerGap } from "react-icons/pi";
import { SettingsWindow, useSettingsShortcut } from "@/components/settings/settings-window";
import { ShortcutsDialog } from "@/components/shortcuts/shortcuts-dialog";
import { Home } from "@/components/home/home";
import { HomeButton } from "@/components/home/home-button";
import { useDesktopCommands } from "@/components/home/desktop-commands";
import { NewProjectDialog } from "@/components/home/new-project-dialog";
import { OpenProjectDialog } from "@/components/home/open-project-dialog";
import { ProjectSearchDialog, useProjectShortcuts } from "@/components/home/project-search-dialog";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Desktop } from "@/components/windows/floating-window";
import { Workspace } from "@/components/workspace/workspace";
import { usePreventFileNavigation } from "@/hooks/use-prevent-file-navigation";
import { useShortcuts } from "@/hooks/use-shortcuts";
import { startAssistantBridge } from "@/assistant/bridge";
import { useAppWindows } from "@/stores/app-windows";
import { useProjects } from "@/stores/projects";
import { useSettings } from "@/stores/settings";

export default function App() {
  const loaded = useProjects((s) => s.loaded);
  const loadError = useProjects((s) => s.loadError);
  const settingsOpen = useSettings((s) => s.open);
  const home = useProjects((s) => s.openId === null);

  useEffect(() => {
    void useProjects.getState().init();
  }, []);
  // Agents (the assistant, or any MCP client) run their tools in this tab.
  useEffect(() => startAssistantBridge(), []);
  useShortcuts();
  useSettingsShortcut();
  useProjectShortcuts();
  useDesktopCommands();
  usePreventFileNavigation();

  return (
    <TooltipProvider delayDuration={400}>
      {loaded ? (
        <div className="flex h-full">
          {home ? (
            <Home />
          ) : (
            <main className="flex min-w-0 flex-1 flex-col">
              <Workspace />
            </main>
          )}
          {/* After the headers: in the desktop app, drag regions later in the page win over earlier ones, so before
              them the header (which drags the window) would take the button's clicks. */}
          <HomeButton />
        </div>
      ) : (
        <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
          {loadError ? (
            <p>Couldn't reach the editor server: {loadError}. Is `pnpm dev` running?</p>
          ) : (
            <PiSpinnerGap className="size-5 animate-spin" />
          )}
        </div>
      )}
      {/* The app's own windows float over everything (but menus and dialogs, which are drawn after it). */}
      {settingsOpen && (
        <Desktop windows={useAppWindows} name="app" label="Windows" overlay className="fixed inset-0 z-50">
          <SettingsWindow />
        </Desktop>
      )}
      <ShortcutsDialog />
      <NewProjectDialog />
      <ProjectSearchDialog />
      <OpenProjectDialog />
      <Toaster position="bottom-right" />
    </TooltipProvider>
  );
}
