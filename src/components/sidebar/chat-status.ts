/**
 * What a video's row in the sidebar says about its chat: working (for how
 * long, on which step), waiting for the user, or finished while they were
 * looking at another video. Pure, so it's tested.
 */
import type { AssistantProvider, ChatActivity } from "@shared/assistant";

export type ChatStatus =
  | { kind: "working"; since: number; step?: string; provider: AssistantProvider }
  /** A confirmation is waiting in the chat panel. */
  | { kind: "waiting"; provider: AssistantProvider }
  /** Finished since the user last looked at the video. */
  | { kind: "done" | "failed"; provider: AssistantProvider };

export function chatStatus(
  activity: ChatActivity | undefined,
  opts: { seenAt: number | undefined; isOpen: boolean; waiting: boolean },
): ChatStatus | null {
  if (!activity) return null;
  const { provider } = activity;
  if (opts.waiting) return { kind: "waiting", provider };
  if (activity.status === "working") return { kind: "working", since: activity.since, provider, ...(activity.step && { step: activity.step }) };
  if (opts.isOpen || activity.since <= (opts.seenAt ?? 0)) return null;
  if (activity.status === "done") return { kind: "done", provider };
  if (activity.status === "error") return { kind: "failed", provider };
  return null;
}
