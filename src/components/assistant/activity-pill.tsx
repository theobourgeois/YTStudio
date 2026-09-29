import { PiSparkleFill } from "react-icons/pi";
import { type AssistantMessage, type ToolPart, describeToolCall } from "@shared/assistant";
import { useAssistant } from "@/stores/assistant";

/**
 * Over the Program monitor while an agent works: what it's doing right now
 * (the in-app assistant, or an agent outside the app using the editor's tools).
 */
export function ActivityPill() {
  const label = useAssistant((s) => {
    if (s.activity) return describeToolCall(s.activity.name, s.activity.input);
    const turn = s.chat?.status === "working" ? s.chat.messages.findLast((m): m is AssistantMessage => m.role === "assistant") : undefined;
    if (!turn) return null;
    const running = turn.parts.findLast((p): p is ToolPart => p.kind === "tool" && p.status === "running");
    if (running) return describeToolCall(running.name, running.input);
    return turn.parts.at(-1)?.kind === "text" ? "Writing…" : "Thinking…";
  });
  const chat = useAssistant((s) => s.chat?.status === "working");
  const open = useAssistant((s) => s.open);
  if (!label) return null;
  return (
    <div className="pointer-events-none absolute top-3 left-1/2 z-40 flex -translate-x-1/2 justify-center" data-slot="assistant-activity">
      <div className="pointer-events-auto flex max-w-[min(28rem,80vw)] items-center gap-2 rounded-full border border-brand/30 bg-popover/90 py-1 pr-1 pl-2.5 text-xs shadow-lg backdrop-blur-md animate-in fade-in slide-in-from-top-1">
        <PiSparkleFill className="size-3.5 shrink-0 animate-[assistant-breathe_2s_ease-in-out_infinite] text-brand" />
        <span className="truncate font-medium">{label}</span>
        {chat ? (
          <button
            type="button"
            className="shrink-0 cursor-pointer rounded-full px-2 py-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
            onClick={() => (open ? useAssistant.getState().stop() : useAssistant.getState().setOpen(true))}
          >
            {open ? "Stop" : "Show"}
          </button>
        ) : (
          <span className="pr-1.5" />
        )}
      </div>
    </div>
  );
}
