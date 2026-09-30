import { useEffect } from "react";
import { PiArrowUUpLeft, PiArrowUUpRight } from "react-icons/pi";
import { AssistantButton } from "@/components/assistant/assistant-button";
import { AssistantPanel } from "@/components/assistant/assistant-panel";
import { SettleButton, SettledBadge, SidebarLead } from "@/components/header/header";
import { ProjectName } from "@/components/header/project-name";
import { ThemeMenu } from "@/components/header/theme-menu";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { PlainWorkspace, WorkspaceError, WorkspaceLoading } from "@/components/workspace/plain-workspace";
import { canRedo, canUndo } from "@/lib/document-history";
import { ChannelRack } from "./channel-rack";
import { startEngineSync } from "./engine-sync";
import { isTyping, resolveMusicKey } from "./keys";
import { Panel } from "./panel";
import { useMusic, useSong } from "./store";
import { TransportBar } from "./transport-bar";
import { useTransport } from "./transport";

/** The music suite's main column (`clientSuite("music").Workspace`): its header and toolbar, its panels, its assistant. */
export default function MusicWorkspace() {
  const projectId = useMusic((s) => s.projectId);
  const loaded = useMusic((s) => s.history !== null);
  const loadError = useMusic((s) => s.loadError);

  // The engine plays the open song for as long as it's open.
  useEffect(() => (projectId && loaded ? startEngineSync() : undefined), [projectId, loaded]);
  useMusicKeys(loaded);

  if (!projectId || !loaded) {
    return <PlainWorkspace>{loadError ? <WorkspaceError noun="song" error={loadError} /> : <WorkspaceLoading />}</PlainWorkspace>;
  }
  return (
    <div key={projectId} className="flex min-h-0 flex-1 flex-col" data-suite="music">
      <MusicHeader />
      <div className="flex min-h-0 flex-1">
        <div className="flex min-w-0 flex-1 flex-col">
          <TransportBar />
          <section className="min-h-0 flex-1 overflow-auto bg-stage p-4" aria-label="Song">
            <Panel title="Channel rack">
              <ChannelRack />
            </Panel>
          </section>
        </div>
        <AssistantPanel suite="music" />
      </div>
    </div>
  );
}

/** Space plays and stops; ⌘Z and ⇧⌘Z undo and redo. (The video editor's shortcuts are off without a video open.) */
function useMusicKeys(enabled: boolean) {
  useEffect(() => {
    if (!enabled) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.isComposing || isTyping(e.target)) return;
      // Dialogs and open menus own the keyboard.
      if (document.querySelector(":is([role=dialog], [role=alertdialog], [role=menu]):not([data-state=closed])")) return;
      const action = resolveMusicKey(e);
      if (!action) return;
      e.preventDefault();
      if (action === "togglePlay") useTransport.getState().toggle();
      else if (action === "undo") useMusic.getState().undo();
      else useMusic.getState().redo();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [enabled]);
}

function MusicHeader() {
  const name = useSong((song) => song.name);
  const undoable = useMusic((s) => !!s.history && canUndo(s.history));
  const redoable = useMusic((s) => !!s.history && canRedo(s.history));
  return (
    <header data-titlebar="header" className="flex h-13 shrink-0 items-center gap-2 border-b bg-background px-3">
      <SidebarLead />
      <ProjectName name={name} onRename={(next) => void useMusic.getState().rename(next)} />
      <SettledBadge />
      <div className="ml-auto flex items-center gap-0.5">
        <HistoryButton label="Undo" shortcut="⌘Z" disabled={!undoable} onClick={() => useMusic.getState().undo()}>
          <PiArrowUUpLeft />
        </HistoryButton>
        <HistoryButton label="Redo" shortcut="⇧⌘Z" disabled={!redoable} onClick={() => useMusic.getState().redo()}>
          <PiArrowUUpRight />
        </HistoryButton>
        <Separator orientation="vertical" className="mx-1.5 data-[orientation=vertical]:h-5" />
        <ThemeMenu />
        <div className="ml-1.5 flex items-center gap-2">
          <SettleButton />
        </div>
        <Separator orientation="vertical" className="mx-1.5 data-[orientation=vertical]:h-5" />
        <AssistantButton />
      </div>
    </header>
  );
}

function HistoryButton({ label, shortcut, disabled, onClick, children }: { label: string; shortcut: string; disabled: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button variant="ghost" size="icon-sm" className="text-muted-foreground hover:text-foreground" aria-label={label} disabled={disabled} onClick={onClick}>
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>
        {label} ({shortcut})
      </TooltipContent>
    </Tooltip>
  );
}
