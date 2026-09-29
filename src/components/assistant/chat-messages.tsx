import { memo, type ReactNode } from "react";
import { PiArrowCounterClockwise, PiCrosshair, PiSparkleFill, PiStopCircle, PiWarningCircle } from "react-icons/pi";
import type { AssistantMessage, AssistantPart, ChatMessage, ToolPart, UserMessage } from "@shared/assistant";
import { toolSpec } from "@shared/assistant-tools";
import { cn } from "cn";
import { Button } from "@/components/ui/button";
import { useAssistant } from "@/stores/assistant";
import { useEditor } from "@/stores/editor";
import { Markdown } from "./markdown";
import { ToolSteps } from "./tool-steps";

export function ChatMessages({ messages }: { messages: ChatMessage[] }) {
  return (
    <div className="flex flex-col gap-5">
      {messages.map((m, i) =>
        m.role === "user" ? <UserBubble key={m.id} message={m} /> : <AssistantTurn key={m.id} message={m} last={i === messages.length - 1} />,
      )}
    </div>
  );
}

const UserBubble = memo(function UserBubble({ message }: { message: UserMessage }) {
  return (
    <div className="flex flex-col items-end gap-1 pl-8">
      <div className="max-w-full rounded-2xl rounded-br-md bg-secondary px-3.5 py-2 text-[13px] leading-relaxed break-words whitespace-pre-wrap text-foreground">
        {message.text}
      </div>
      {message.context && (
        <span className="flex max-w-full items-center gap-1 truncate text-[10.5px] text-muted-foreground">
          <PiCrosshair className="size-3 shrink-0" />
          <span className="truncate">{message.context}</span>
        </span>
      )}
    </div>
  );
});

/** Parts grouped for display: runs of tool calls together, text and thinking on their own. */
type Block = { kind: "text"; key: string; text: string } | { kind: "tools"; key: string; parts: ToolPart[] };

/** Thinking isn't shown (only that it's working), so it doesn't split a run of steps. */
function blocks(parts: AssistantPart[]): Block[] {
  const out: Block[] = [];
  for (const p of parts) {
    if (p.kind === "tool") {
      const last = out.at(-1);
      if (last?.kind === "tools") last.parts.push(p);
      else out.push({ kind: "tools", key: p.id, parts: [p] });
    } else if (p.kind === "text" && p.text.trim()) {
      out.push({ kind: "text", key: p.key, text: p.text });
    }
  }
  return out;
}

const AssistantTurn = memo(function AssistantTurn({ message, last }: { message: AssistantMessage; last: boolean }) {
  const working = message.status === "working";
  const shown = blocks(message.parts);
  const tail = shown.at(-1);
  // Something visibly happening: a tool running, or text streaming in at the end.
  const newest = message.parts.at(-1);
  const busy = working && ((newest?.kind === "tool" && newest.status === "running") || (newest?.kind === "text" && !!newest.text.trim()));
  return (
    <div className="flex gap-2.5" data-assistant-message={message.id} data-status={message.status}>
      <span
        className={cn(
          "mt-0.5 grid size-5.5 shrink-0 place-items-center rounded-full bg-brand/12 text-brand",
          working && "animate-[assistant-breathe_2s_ease-in-out_infinite]",
        )}
      >
        <PiSparkleFill className="size-3" />
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-2.5">
        {shown.map((b) =>
          b.kind === "text" ? <Markdown key={b.key} text={b.text} /> : <ToolSteps key={b.key} parts={b.parts} live={working && b === tail} />,
        )}
        {working && !busy && <Thinking />}
        {message.status === "error" && <ErrorNote message={message.error ?? "Something went wrong."} />}
        {message.status === "stopped" && (
          <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <PiStopCircle className="size-3.5" />
            Stopped
          </span>
        )}
        {!working && <TurnFooter message={message} last={last} />}
      </div>
    </div>
  );
});

function Thinking() {
  return (
    <span className="flex h-5 items-center gap-1 text-muted-foreground" aria-label="Working">
      {[0, 1, 2].map((i) => (
        <span key={i} className="size-1.5 animate-[assistant-dot_1.2s_ease-in-out_infinite] rounded-full bg-current" style={{ animationDelay: `${i * 0.15}s` }} />
      ))}
    </span>
  );
}

function ErrorNote({ message }: { message: string }) {
  return (
    <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/8 px-2.5 py-2 text-xs text-destructive">
      <PiWarningCircle className="mt-px size-3.5 shrink-0" />
      <span className="break-words">{message}</span>
    </div>
  );
}

/** How many clips an answer changed, and a way to take it all back. */
function TurnFooter({ message, last }: { message: AssistantMessage; last: boolean }) {
  const turn = useAssistant((s) => s.turns[message.id]);
  const current = useEditor((s) => !!turn && s.project === turn.result);
  const tools = message.parts.filter((p): p is ToolPart => p.kind === "tool");
  const edits = tools.filter((p) => p.status === "done" && toolSpec(p.name)?.kind !== "look");
  const clips = new Set(edits.flatMap((p) => (p.changes ? [...p.changes.added, ...p.changes.changed] : [])));
  const removed = edits.reduce((n, p) => n + (p.changes?.removed ?? 0), 0);
  if (edits.length === 0) return null;
  const summary: ReactNode[] = [];
  if (clips.size) summary.push(`${clips.size} clip${clips.size === 1 ? "" : "s"} changed`);
  if (removed) summary.push(`${removed} removed`);
  if (!summary.length) summary.push(`${edits.length} change${edits.length === 1 ? "" : "s"}`);
  return (
    <div className="flex h-6 items-center gap-2 text-[11px] text-muted-foreground">
      <span>{summary.join(" · ")}</span>
      {turn?.reverted ? (
        <span className="text-muted-foreground/80">· Reverted</span>
      ) : (
        turn &&
        (last || current) && (
          <Button
            variant="ghost"
            size="xs"
            disabled={!current}
            title={current ? "Undo everything this answer changed" : "You've edited since, so use Undo instead"}
            className="h-6 text-muted-foreground hover:text-foreground"
            onClick={() => useAssistant.getState().revertTurn(message.id)}
          >
            <PiArrowCounterClockwise />
            Revert
          </Button>
        )
      )}
    </div>
  );
}
