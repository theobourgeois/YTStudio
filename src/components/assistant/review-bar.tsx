/**
 * What the assistant changed since the user last said Keep, over the composer (Cursor's Keep all / Undo all):
 * Undo all puts the project back as it was then, Keep all makes the changes the user's. Both stay undoable.
 */
import { useEffect } from "react";
import { PiArrowCounterClockwise, PiCheck, PiSparkleFill } from "react-icons/pi";
import { type AssistantMessage, providerInfo } from "@shared/assistant";
import { type SuiteId, suiteNoun } from "@shared/suites";
import { toolSpec } from "@shared/suite-tools";
import { Button } from "@/components/ui/button";
import { editedSince, pendingReview } from "@/lib/checkpoints";
import { useAssistant } from "@/stores/assistant";
import { useCheckpoints } from "@/stores/checkpoints";
import { clientSuite } from "@/suites";

export function ReviewBar({ projectId, suite }: { projectId: string; suite: SuiteId }) {
  const current = clientSuite(suite).documents.useCurrent(projectId);
  const review = useCheckpoints((s) => pendingReview(s, projectId, current));
  const restore = useCheckpoints((s) => s.restores[projectId]);
  const edited = useCheckpoints((s) => editedSince(s, projectId, current));
  const working = useAssistant((s) => s.chat?.status === "working");
  const provider = useAssistant((s) => s.chat?.provider ?? "claude");
  // The edits of the answers waiting, as the chat lists them (none if the chat was started again since).
  const edits = useAssistant((s) => {
    if (!review || !s.chat) return 0;
    const turns = new Set(review.turns);
    return s.chat.messages
      .filter((m): m is AssistantMessage => m.role === "assistant" && turns.has(m.id))
      .flatMap((m) => m.parts)
      .filter((p) => p.kind === "tool" && p.status === "done" && toolSpec(p.name)?.kind !== "look").length;
  });

  // The project loaded again (reopened): what was kept of it is the same document.
  const loaded = current !== null;
  useEffect(() => {
    const doc = clientSuite(suite).documents.current(projectId);
    if (doc !== null) useCheckpoints.getState().adopt(projectId, doc);
  }, [projectId, suite, loaded]);
  // A restore taken back with ⌘Z is the same as its Redo.
  useEffect(() => {
    if (restore && current !== null && current === restore.redo) useCheckpoints.getState().restoreUndone(projectId);
  }, [restore, current, projectId]);

  if (!review) return null;
  const noun = suiteNoun(suite);
  return (
    <div
      className="mx-2 flex items-center gap-2 rounded-t-lg border border-b-0 bg-card px-2.5 py-1.5 text-xs dark:bg-secondary/60"
      role="region"
      aria-label="Changes to review"
      data-slot="assistant-review"
    >
      <PiSparkleFill className="size-3 shrink-0 text-brand" />
      <span className="min-w-0 truncate" title={`What ${providerInfo(provider).label} changed in your ${noun} since you last kept its changes`}>
        <span className="font-medium">{edits > 0 ? `${edits} change${edits === 1 ? "" : "s"}` : "Changes"}</span>
        <span className="text-muted-foreground"> to review</span>
      </span>
      <div className="ml-auto flex shrink-0 items-center gap-1">
        <Button
          variant="ghost"
          size="xs"
          disabled={working}
          title={`Put the ${noun} back as it was before these changes${edited ? ", your own changes since too" : ""} (Undo brings them back)`}
          onClick={() => useCheckpoints.getState().undoAll(projectId)}
        >
          <PiArrowCounterClockwise />
          Undo all
        </Button>
        <Button
          size="xs"
          disabled={working}
          title="Keep these changes"
          className="bg-brand text-brand-foreground hover:bg-brand/88"
          onClick={() => useCheckpoints.getState().keepAll(projectId)}
        >
          <PiCheck />
          Keep all
        </Button>
      </div>
    </div>
  );
}
