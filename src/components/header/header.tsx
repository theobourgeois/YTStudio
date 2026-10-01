import type { IconType } from "react-icons";
import { PiArrowCounterClockwise, PiArrowUUpLeft, PiArrowUUpRight, PiCheckCircle } from "react-icons/pi";
import { DEFAULT_SUITE, suiteNoun } from "@shared/suites";
import { AssistantButton } from "@/components/assistant/assistant-button";
import { ExportDialog } from "@/components/export/export-dialog";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { SHORTCUT_KEYS } from "@/hooks/shortcuts";
import { useEditor } from "@/stores/editor";
import { useProjects } from "@/stores/projects";
import { ProjectName } from "./project-name";
import { SettingsDialog } from "./settings-dialog";
import { ThemeMenu } from "./theme-menu";

export function Header() {
  const canUndo = useEditor((s) => s.past.length > 0 && !s.gestureBase);
  const canRedo = useEditor((s) => s.future.length > 0 && !s.gestureBase);

  return (
    <header data-titlebar="header" className="flex h-13 shrink-0 items-center gap-2 border-b bg-background px-3">
      <VideoName />
      <SettledBadge />
      <SettingsDialog />

      <div className="ml-auto flex items-center gap-0.5">
        <HistoryButton
          icon={PiArrowUUpLeft}
          label="Undo"
          shortcut={SHORTCUT_KEYS.undo}
          disabled={!canUndo}
          onClick={() => useEditor.getState().undo()}
        />
        <HistoryButton
          icon={PiArrowUUpRight}
          label="Redo"
          shortcut={SHORTCUT_KEYS.redo}
          disabled={!canRedo}
          onClick={() => useEditor.getState().redo()}
        />
        <Separator orientation="vertical" className="mx-1.5 data-[orientation=vertical]:h-5" />
        <ThemeMenu />
        <div className="ml-1.5 flex items-center gap-2">
          <SettleButton />
          <ExportDialog />
        </div>
        <Separator orientation="vertical" className="mx-1.5 data-[orientation=vertical]:h-5" />
        <AssistantButton />
      </div>
    </header>
  );
}

function VideoName() {
  const name = useEditor((s) => s.project.name);
  return <ProjectName name={name} onRename={(next) => useEditor.getState().renameProject(next)} />;
}

function useOpenProject() {
  const projectId = useProjects((s) => s.openId);
  const status = useProjects((s) => s.projects.find((p) => p.id === projectId)?.status);
  const suite = useProjects((s) => s.projects.find((p) => p.id === projectId)?.suite);
  return { projectId, status, noun: suiteNoun(suite ?? DEFAULT_SUITE) };
}

/** Says the open project is settled. */
export function SettledBadge() {
  const { status } = useOpenProject();
  if (status !== "settled") return null;
  return (
    <span className="rounded-md border px-1.5 py-px text-[11px] font-medium text-muted-foreground">
      Settled
    </span>
  );
}

/** "Settle" puts a finished project away (and opens the next one); settled projects can be unsettled. */
export function SettleButton() {
  const { projectId, status, noun } = useOpenProject();
  if (!projectId || !status) return null;
  const settled = status === "settled";
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            const projects = useProjects.getState();
            void (settled ? projects.unsettle(projectId) : projects.settle(projectId));
          }}
        >
          {settled ? <PiArrowCounterClockwise /> : <PiCheckCircle />}
          {settled ? "Unsettle" : "Settle"}
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom">
        {settled ? `Move back to ${noun}s in progress` : `Done with this ${noun} — move it to the settled pile`}
      </TooltipContent>
    </Tooltip>
  );
}

function HistoryButton({
  icon: Icon,
  label,
  shortcut,
  disabled,
  onClick,
}: {
  icon: IconType;
  label: string;
  shortcut: string;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          className="text-muted-foreground hover:text-foreground"
          disabled={disabled}
          onClick={onClick}
        >
          <Icon />
          <span className="sr-only">{label}</span>
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom">
        {label}
        <kbd className="ml-2 rounded border bg-muted px-1 font-sans text-[10px] leading-4 text-muted-foreground">{shortcut}</kbd>
      </TooltipContent>
    </Tooltip>
  );
}
