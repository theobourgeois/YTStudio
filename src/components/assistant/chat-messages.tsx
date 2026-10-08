import { memo, type ReactNode } from "react";
import { PiArrowClockwise, PiArrowCounterClockwise, PiCrosshair, PiSparkleFill, PiStopCircle, PiWarningCircle } from "react-icons/pi";
import type { AssistantMessage, AssistantPart, ChatMessage, ToolPart, UserMessage } from "@shared/assistant";
import { type SuiteId, suiteNoun } from "@shared/suites";
import { toolSpec } from "@shared/suite-tools";
import { cn } from "cn";
import { Button } from "@/components/ui/button";
import { checkpointAt, editedSince } from "@/lib/checkpoints";
import { useAssistant } from "@/stores/assistant";
import { useCheckpoints } from "@/stores/checkpoints";
import { clientSuite } from "@/suites";
import { Markdown } from "./markdown";
import { ToolSteps } from "./tool-steps";

/**
 * The chat. Each message of the user's is a checkpoint (Cursor's): while the assistant has changed the project
 * since, it can be restored, putting the project back as it was when the message was sent; what came after it then
 * shows faded until the project changes again, and Redo takes the restore back.
 */
export function ChatMessages({ messages, projectId, suite }: { messages: ChatMessage[]; projectId: string; suite: SuiteId }) {
  const current = clientSuite(suite).documents.useCurrent(projectId);
  const turns = useCheckpoints((s) => s.turns);
  const restore = useCheckpoints((s) => s.restores[projectId]);
  const working = messages.at(-1)?.role === "assistant" && (messages.at(-1) as AssistantMessage).status === "working";
  const restoredAt = restore && current !== null && current === restore.doc ? restore.messageId : null;
  const edited = editedSince({ turns }, projectId, current);
  const noun = suiteNoun(suite);
  let faded = false;
  return (
    <div className="flex flex-col gap-5">
      {messages.map((m) => {
        const fade = faded;
        if (m.role === "assistant") return <AssistantTurn key={m.id} message={m} faded={fade} />;
        const point = current === null ? null : checkpointAt({ turns }, messages, m.id, projectId);
        const restored = restoredAt === m.id;
        if (restored) faded = true;
        return (
          <UserBubble
            key={m.id}
            message={m}
            projectId={projectId}
            faded={fade}
            restored={restored}
            restorable={!!point && point.doc !== current && !working}
            hint={`Put the ${noun} back as it was when you sent this${edited ? ". Your own changes since go too" : ""}`}
          />
        );
      })}
    </div>
  );
}

const UserBubble = memo(function UserBubble({
  message,
  projectId,
  faded,
  restored,
  restorable,
  hint,
}: {
  message: UserMessage;
  projectId: string;
  faded: boolean;
  /** The project was just put back as it was when this was sent. */
  restored: boolean;
  /** It can be. */
  restorable: boolean;
  hint: string;
}) {
  const restore = () => {
    const { chat } = useAssistant.getState();
    if (chat) useCheckpoints.getState().restore(projectId, message.id, chat.messages);
  };
  return (
    <div className={cn("group/user flex flex-col items-end gap-1 pl-8 transition-opacity", faded && "opacity-45")} data-user-message={message.id}>
      <div className="max-w-full rounded-2xl rounded-br-md bg-secondary px-3.5 py-2 text-[13px] leading-relaxed break-words whitespace-pre-wrap text-foreground">
        {message.text}
      </div>
      <div className="flex max-w-full items-center gap-2">
        {restorable && !restored && (
          <button
            type="button"
            title={hint}
            onClick={restore}
            className="flex shrink-0 cursor-pointer items-center gap-1 rounded-md px-1 text-[10.5px] text-muted-foreground opacity-0 transition-opacity group-hover/user:opacity-100 hover:text-foreground focus-visible:opacity-100"
          >
            <PiArrowCounterClockwise className="size-3" />
            Restore checkpoint
          </button>
        )}
        {message.context && (
          <span className="flex min-w-0 items-center gap-1 truncate text-[10.5px] text-muted-foreground">
            <PiCrosshair className="size-3 shrink-0" />
            <span className="truncate">{message.context}</span>
          </span>
        )}
      </div>
      {restored && (
        <div className="flex items-center gap-1.5 rounded-lg border bg-card px-2.5 py-1 text-[11px] text-muted-foreground" role="status">
          <PiArrowCounterClockwise className="size-3 shrink-0 text-brand" />
          Restored to before this message
          <Button
            variant="ghost"
            size="xs"
            className="-mr-1.5 h-5 text-foreground"
            title="Put back what was there before the restore"
            onClick={() => useCheckpoints.getState().redo(projectId)}
          >
            <PiArrowClockwise />
            Redo
          </Button>
        </div>
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

const AssistantTurn = memo(function AssistantTurn({ message, faded }: { message: AssistantMessage; faded: boolean }) {
  const working = message.status === "working";
  const shown = blocks(message.parts);
  const tail = shown.at(-1);
  // Something visibly happening: a tool running, or text streaming in at the end.
  const newest = message.parts.at(-1);
  const busy = working && ((newest?.kind === "tool" && newest.status === "running") || (newest?.kind === "text" && !!newest.text.trim()));
  return (
    <div className={cn("flex gap-2.5 transition-opacity", faded && "opacity-45")} data-assistant-message={message.id} data-status={message.status}>
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
        {!working && <TurnFooter message={message} />}
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

/** What an answer changed (taken back with its message's checkpoint, or the review bar's Undo all). */
function TurnFooter({ message }: { message: AssistantMessage }) {
  const tools = message.parts.filter((p): p is ToolPart => p.kind === "tool");
  const edits = tools.filter((p) => p.status === "done" && toolSpec(p.name)?.kind !== "look");
  const clips = new Set(edits.flatMap((p) => (p.changes ? [...p.changes.added, ...p.changes.changed] : [])));
  const removed = edits.reduce((n, p) => n + (p.changes?.removed ?? 0), 0);
  if (edits.length === 0) return null;
  const summary: ReactNode[] = [];
  if (clips.size) summary.push(`${clips.size} clip${clips.size === 1 ? "" : "s"} changed`);
  if (removed) summary.push(`${removed} removed`);
  if (!summary.length) summary.push(`${edits.length} change${edits.length === 1 ? "" : "s"}`);
  return <div className="flex h-6 items-center gap-2 text-[11px] text-muted-foreground">{summary.join(" · ")}</div>;
}
