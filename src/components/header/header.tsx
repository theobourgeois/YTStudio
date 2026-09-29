import type { IconType } from "react-icons";
import { PiArrowCounterClockwise, PiArrowUUpLeft, PiArrowUUpRight, PiCheckCircle } from "react-icons/pi";
import { ExportDialog } from "@/components/export/export-dialog";
import { SidebarToggle } from "@/components/sidebar/sidebar";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { SHORTCUT_LABELS } from "@/hooks/shortcuts";
import { useEditor } from "@/stores/editor";
import { useLayout } from "@/stores/layout";
import { useProjects } from "@/stores/projects";
import { ProjectName } from "./project-name";
import { SettingsDialog } from "./settings-dialog";
import { ThemeMenu } from "./theme-menu";

export function Header() {
  const canUndo = useEditor((s) => s.past.length > 0 && !s.gestureBase);
  const canRedo = useEditor((s) => s.future.length > 0 && !s.gestureBase);

  return (
    <header className="flex h-13 shrink-0 items-center gap-2 border-b bg-background px-3">
      <SidebarLead />
      <ProjectName />
      <SettledBadge />
      <SettingsDialog />

      <div className="ml-auto flex items-center gap-0.5">
        <HistoryButton
          icon={PiArrowUUpLeft}
          label="Undo"
          shortcut={SHORTCUT_LABELS.undo}
          disabled={!canUndo}
          onClick={() => useEditor.getState().undo()}
        />
        <HistoryButton
          icon={PiArrowUUpRight}
          label="Redo"
          shortcut={SHORTCUT_LABELS.redo}
          disabled={!canRedo}
          onClick={() => useEditor.getState().redo()}
        />
        <Separator orientation="vertical" className="mx-1.5 data-[orientation=vertical]:h-5" />
        <ThemeMenu />
        <div className="ml-1.5 flex items-center gap-2">
          <SettleButton />
          <ExportDialog />
        </div>
      </div>
    </header>
  );
}

/** When the sidebar is hidden, its toggle (the logo) moves into the header. */
export function SidebarLead() {
  const sidebarOpen = useLayout((s) => s.sidebarOpen);
  if (sidebarOpen) return null;
  return <SidebarToggle />;
}

function useOpenProjectStatus() {
  const projectId = useEditor((s) => s.projectId);
  const status = useProjects((s) => s.projects.find((p) => p.id === projectId)?.status);
  return { projectId, status };
}

function SettledBadge() {
  const { status } = useOpenProjectStatus();
  if (status !== "settled") return null;
  return (
    <span className="rounded-md border px-1.5 py-px text-[11px] font-medium text-muted-foreground">
      Settled
    </span>
  );
}

/** "Settle" puts a finished video away (and opens the next one); settled videos can be unsettled. */
function SettleButton() {
  const { projectId, status } = useOpenProjectStatus();
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
        {settled ? "Move back to videos in progress" : "Done with this video — move it to the settled pile"}
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
