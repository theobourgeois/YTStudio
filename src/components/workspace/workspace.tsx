import { PiSpinnerGap } from "react-icons/pi";
import { Header, SidebarLead } from "@/components/header/header";
import { SaveToLibraryDialog } from "@/components/library/library-dialogs";
import { ThemeMenu } from "@/components/header/theme-menu";
import { Preview } from "@/components/preview/preview";
import { Timeline } from "@/components/timeline/timeline";
import { Button } from "@/components/ui/button";
import { useEditor } from "@/stores/editor";
import { EmptyState } from "./empty-state";
import { LeftPanel } from "./left-panel";

/** The main column: the open video's editor, or an empty state when none is open. */
export function Workspace() {
  const projectId = useEditor((s) => s.projectId);
  const loading = useEditor((s) => s.loading);
  const loadError = useEditor((s) => s.loadError);

  if (projectId) {
    return (
      // Keyed so per-project UI state (scroll, zoom anchors, dialogs) starts fresh.
      <div key={projectId} className="flex min-h-0 flex-1 flex-col">
        <Header />
        <div className="flex min-h-0 flex-1">
          <LeftPanel />
          <Preview />
        </div>
        <Timeline />
        <SaveToLibraryDialog />
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex h-13 shrink-0 items-center gap-2 border-b bg-background px-3">
        <SidebarLead />
        <div className="ml-auto">
          <ThemeMenu />
        </div>
      </header>
      {loadError ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 text-sm text-muted-foreground">
          <p>Couldn't open this video: {loadError}</p>
          <Button variant="outline" size="sm" onClick={() => location.reload()}>
            Reload
          </Button>
        </div>
      ) : loading ? (
        <div className="flex flex-1 items-center justify-center text-muted-foreground">
          <PiSpinnerGap className="size-5 animate-spin" />
        </div>
      ) : (
        <EmptyState />
      )}
    </div>
  );
}
