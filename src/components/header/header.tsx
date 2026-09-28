import { Redo2, Undo2, type LucideIcon } from "lucide-react";
import { ExportDialog } from "@/components/export/export-dialog";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { SHORTCUT_LABELS } from "@/hooks/shortcuts";
import { useEditor } from "@/stores/editor";
import { ProjectName } from "./project-name";
import { ThemeMenu } from "./theme-menu";

export function Header() {
  const canUndo = useEditor((s) => s.past.length > 0 && !s.gestureBase);
  const canRedo = useEditor((s) => s.future.length > 0 && !s.gestureBase);

  return (
    <header className="flex h-12 shrink-0 items-center gap-2 border-b bg-card px-3">
      <LogoMark />
      <ProjectName />

      <div className="ml-auto flex items-center gap-0.5">
        <HistoryButton
          icon={Undo2}
          label="Undo"
          shortcut={SHORTCUT_LABELS.undo}
          disabled={!canUndo}
          onClick={() => useEditor.getState().undo()}
        />
        <HistoryButton
          icon={Redo2}
          label="Redo"
          shortcut={SHORTCUT_LABELS.redo}
          disabled={!canRedo}
          onClick={() => useEditor.getState().redo()}
        />
        <Separator orientation="vertical" className="mx-1.5 data-[orientation=vertical]:h-5" />
        <ThemeMenu />
        <div className="ml-1.5">
          <ExportDialog />
        </div>
      </div>
    </header>
  );
}

function HistoryButton({
  icon: Icon,
  label,
  shortcut,
  disabled,
  onClick,
}: {
  icon: LucideIcon;
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
        <kbd className="ml-2 font-sans text-background/60">{shortcut}</kbd>
      </TooltipContent>
    </Tooltip>
  );
}

function LogoMark() {
  return (
    <span
      aria-hidden
      className="grid size-7 shrink-0 place-items-center rounded-lg bg-linear-to-br from-brand to-brand/70 text-brand-foreground shadow-sm ring-1 ring-black/10 ring-inset"
    >
      <svg viewBox="0 0 16 16" className="size-3.5" fill="currentColor">
        <rect x="1.5" y="3" width="3" height="10" rx="1" opacity="0.55" />
        <path d="M6.5 3.9v8.2a.7.7 0 0 0 1.06.6l6.3-4.1a.7.7 0 0 0 0-1.2l-6.3-4.1a.7.7 0 0 0-1.06.6Z" />
      </svg>
    </span>
  );
}
