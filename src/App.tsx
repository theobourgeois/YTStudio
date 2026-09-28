import { useEffect } from "react";
import { PiSpinnerGap } from "react-icons/pi";
import { Sidebar } from "@/components/sidebar/sidebar";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Workspace } from "@/components/workspace/workspace";
import { usePreventFileNavigation } from "@/hooks/use-prevent-file-navigation";
import { useShortcuts } from "@/hooks/use-shortcuts";
import { useProjects } from "@/stores/projects";

export default function App() {
  const loaded = useProjects((s) => s.loaded);
  const loadError = useProjects((s) => s.loadError);

  useEffect(() => {
    void useProjects.getState().init();
  }, []);
  useShortcuts();
  usePreventFileNavigation();

  return (
    <TooltipProvider delayDuration={400}>
      {loaded ? (
        <div className="flex h-full">
          <Sidebar />
          <main className="flex min-w-0 flex-1 flex-col">
            <Workspace />
          </main>
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
      <Toaster position="bottom-right" />
    </TooltipProvider>
  );
}
