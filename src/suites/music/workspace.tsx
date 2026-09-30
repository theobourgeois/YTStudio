import { AssistantButton } from "@/components/assistant/assistant-button";
import { AssistantPanel } from "@/components/assistant/assistant-panel";
import { SettleButton, SettledBadge, SidebarLead } from "@/components/header/header";
import { ProjectName } from "@/components/header/project-name";
import { ThemeMenu } from "@/components/header/theme-menu";
import { Separator } from "@/components/ui/separator";
import { PlainWorkspace, WorkspaceError, WorkspaceLoading } from "@/components/workspace/plain-workspace";
import { EnginePanel } from "./engine-panel";
import { useMusic } from "./store";

/** The music suite's main column (`clientSuite("music").Workspace`). For now the audio engine's test bench, beside its assistant. */
export default function MusicWorkspace() {
  const projectId = useMusic((s) => s.projectId);
  const loaded = useMusic((s) => s.song !== null);
  const loadError = useMusic((s) => s.loadError);

  if (!projectId || !loaded) {
    return <PlainWorkspace>{loadError ? <WorkspaceError noun="song" error={loadError} /> : <WorkspaceLoading />}</PlainWorkspace>;
  }
  return (
    <div key={projectId} className="flex min-h-0 flex-1 flex-col" data-suite="music">
      <MusicHeader />
      <div className="flex min-h-0 flex-1">
        <EnginePanel />
        <AssistantPanel suite="music" />
      </div>
    </div>
  );
}

function MusicHeader() {
  const name = useMusic((s) => s.song?.name ?? "");
  const tempo = useMusic((s) => s.song?.settings.tempo);
  const timeSignature = useMusic((s) => s.song?.settings.timeSignature.join("/"));
  return (
    <header data-titlebar="header" className="flex h-13 shrink-0 items-center gap-2 border-b bg-background px-3">
      <SidebarLead />
      <ProjectName name={name} onRename={(next) => void useMusic.getState().rename(next)} />
      <SettledBadge />
      <span className="text-xs text-muted-foreground tabular-nums">
        {tempo} BPM · {timeSignature}
      </span>
      <div className="ml-auto flex items-center gap-0.5">
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
