import type { IconType } from "react-icons";
import { PiArrowUUpLeft, PiArrowUUpRight, PiDownloadSimple } from "react-icons/pi";
import { cn } from "cn";
import { AssistantButton } from "@/components/assistant/assistant-button";
import { SettingsButton } from "@/components/settings/settings-button";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { WindowButtons } from "./window-buttons";
import { IS_MAC, keyLabel } from "@/lib/key-labels";

const UNDO_KEYS = keyLabel("⌘Z");
const REDO_KEYS = IS_MAC ? "⇧⌘Z" : "Ctrl+Y";

/** What Export does in a suite: open its export, and why it can't yet (`disabled`, said in its tooltip). */
export interface HeaderExport {
  onClick: () => void;
  disabled?: string | false;
  /** An export is running: the button says so. */
  busy?: boolean;
}

/**
 * The right end of every suite's header, the same in each so moving between them nothing moves: undo and
 * redo, Settings, Export, the assistant (and the window's buttons, when the page draws them). A suite's own
 * controls go before it.
 */
export function HeaderActions({
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  exportAction,
}: {
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  exportAction: HeaderExport;
}) {
  return (
    <div className="ml-auto flex shrink-0 items-center gap-0.5" data-header-actions>
      <HistoryButton icon={PiArrowUUpLeft} label="Undo" shortcut={UNDO_KEYS} disabled={!canUndo} onClick={onUndo} />
      <HistoryButton icon={PiArrowUUpRight} label="Redo" shortcut={REDO_KEYS} disabled={!canRedo} onClick={onRedo} />
      <Separator orientation="vertical" className="mx-1.5 data-[orientation=vertical]:h-5" />
      <SettingsButton />
      <div className="ml-1.5 flex">
        <ExportButton {...exportAction} />
      </div>
      <Separator orientation="vertical" className="mx-1.5 data-[orientation=vertical]:h-5" />
      <AssistantButton />
      <WindowButtons className="ml-1.5" />
    </div>
  );
}

function ExportButton({ onClick, disabled, busy }: HeaderExport) {
  const button = (
    <Button
      size="sm"
      className={cn("h-8 px-3.5 bg-brand text-brand-foreground hover:bg-brand/90", busy && "animate-pulse")}
      disabled={!!disabled}
      onClick={onClick}
    >
      <PiDownloadSimple /> Export
    </Button>
  );
  if (!disabled) return button;
  // A disabled button gets no pointer events: the tooltip hangs on a box around it.
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span tabIndex={0} className="rounded-md outline-none">
          {button}
        </span>
      </TooltipTrigger>
      <TooltipContent side="bottom">{disabled}</TooltipContent>
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
        <Button variant="ghost" size="icon-sm" className="text-muted-foreground hover:text-foreground" disabled={disabled} onClick={onClick}>
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
