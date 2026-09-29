import { PiChatCircleDots } from "react-icons/pi";
import { cn } from "cn";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { SHORTCUT_KEYS } from "@/hooks/shortcuts";
import { useAssistant } from "@/stores/assistant";

/** The header's toggle for the assistant panel; it glows while the assistant is working. */
export function AssistantButton() {
  const open = useAssistant((s) => s.open);
  const working = useAssistant((s) => s.chat?.status === "working" || s.activity !== null);
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Assistant"
          aria-pressed={open}
          data-slot="assistant-toggle"
          className={cn(
            "relative text-muted-foreground hover:text-foreground",
            open && "bg-accent text-foreground",
          )}
          onClick={() => useAssistant.getState().toggle()}
        >
          <PiChatCircleDots className="size-4.5" />
          {working && (
            <span className="absolute top-1 right-1 flex size-2">
              <span className="absolute inline-flex size-full animate-ping rounded-full bg-brand opacity-60" />
              <span className="relative inline-flex size-2 rounded-full bg-brand" />
            </span>
          )}
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom">
        {working ? "Claude is working" : "Assistant"}
        <kbd className="ml-2 rounded border bg-muted px-1 font-sans text-[10px] leading-4 text-muted-foreground">{SHORTCUT_KEYS.toggleAssistant}</kbd>
      </TooltipContent>
    </Tooltip>
  );
}
