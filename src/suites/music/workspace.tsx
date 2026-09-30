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
import { ChannelSettingsWindow } from "./channel-settings";
import { startEngineSync } from "./engine-sync";
import { type MusicKeyAction, isTyping, resolveMusicKey } from "./keys";
import { cloneSelected, copySteps, cutSteps, deleteSelected, moveSelected, muteAt, pasteSteps, rotate, selectNeighbour } from "./rack-actions";
import { useMusic, useSong } from "./store";
import { TransportBar } from "./transport-bar";
import { useTransport } from "./transport";
import { useMusicUi } from "./ui";
import { Desktop } from "./window";

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
          <Windows />
        </div>
        <AssistantPanel suite="music" />
      </div>
    </div>
  );
}

/** The editor's desktop and the windows open on it: the channel rack, and the settings of the channels clicked. */
function Windows() {
  const rackOpen = useMusicUi((s) => s.rackOpen);
  const openIds = useMusicUi((s) => s.openChannelIds);
  const channels = useSong((song) => song.channels);
  return (
    <Desktop>
      {rackOpen && <ChannelRack />}
      {channels.map((channel, index) => (openIds.includes(channel.id) && channel.kind === "sampler" ? <ChannelSettingsWindow key={channel.id} channel={channel} index={index} /> : null))}
    </Desktop>
  );
}

function runKey(action: MusicKeyAction) {
  const ui = useMusicUi.getState();
  switch (action.type) {
    case "togglePlay":
      return useTransport.getState().toggle();
    case "undo":
      return useMusic.getState().undo();
    case "redo":
      return useMusic.getState().redo();
    case "toggleRack":
      return ui.setRackOpen(!ui.rackOpen);
    case "toggleGraph":
      return ui.setGraphOpen(!ui.graphOpen);
    case "mute":
      return muteAt(action.index, false);
    case "solo":
      return muteAt(action.index, true);
    case "select":
      return selectNeighbour(action.direction, action.extend);
    case "move":
      return moveSelected(action.direction);
    case "rotate":
      return rotate(action.direction);
    case "clone":
      return cloneSelected();
    case "delete":
      return deleteSelected();
    case "copy":
      return copySteps();
    case "cut":
      return cutSteps();
    case "paste":
      return pasteSteps();
  }
}

/** The music editor's keys (`keys.ts`). (The video editor's shortcuts are off without a video open.) */
function useMusicKeys(enabled: boolean) {
  useEffect(() => {
    if (!enabled) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.isComposing || isTyping(e.target)) return;
      // Dialogs and open menus own the keyboard.
      if (document.querySelector(":is([role=dialog], [role=alertdialog], [role=menu]):not([data-state=closed])")) return;
      const action = resolveMusicKey(e);
      if (!action) return;
      // Copying text that's selected on the page is still the browser's.
      if (action.type === "copy" && window.getSelection()?.toString()) return;
      // A focused knob, number or list keeps its own arrows. (A menu's button doesn't: it opens with Enter.)
      const own = e.target instanceof HTMLElement && e.target.closest("[role=slider], [role=spinbutton], [role=combobox]");
      if (own && action.type === "select") return;
      e.preventDefault();
      // Ours alone: whatever has the focus (a menu's button opens on Alt+Down, a knob turns) doesn't see it too.
      e.stopPropagation();
      runKey(action);
    };
    // Before the page's own handlers, for the same reason.
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
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
