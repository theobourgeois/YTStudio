import type { IconType } from "react-icons";
import { PiArrowUUpLeft, PiArrowUUpRight } from "react-icons/pi";
import { AssistantButton } from "@/components/assistant/assistant-button";
import { ExportButton } from "@/components/export/export-dialog";
import { SettingsButton } from "@/components/settings/settings-button";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { SHORTCUT_KEYS } from "@/hooks/shortcuts";
import { useEditor } from "@/stores/editor";
import { ProjectName } from "./project-name";
import { VideoSettingsButton } from "./settings-dialog";

export function Header() {
  const canUndo = useEditor((s) => s.past.length > 0 && !s.gestureBase);
  const canRedo = useEditor((s) => s.future.length > 0 && !s.gestureBase);

  return (
    <header data-titlebar="header" className="flex h-13 shrink-0 items-center gap-2 border-b bg-background px-3">
      <VideoName />
      <VideoSettingsButton />

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
        <SettingsButton />
        <div className="ml-1.5 flex items-center gap-2">
          <ExportButton />
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
