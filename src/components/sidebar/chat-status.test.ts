import { describe, expect, it } from "vitest";
import type { ChatActivity } from "@shared/assistant";
import { formatElapsed } from "@shared/format";
import { chatStatus } from "./chat-status";

const activity = (status: ChatActivity["status"], since = 1000): ChatActivity => ({ projectId: "p", status, since, provider: "codex" });

describe("chatStatus", () => {
  it("shows a working chat, with its step, wherever the user is", () => {
    expect(chatStatus({ ...activity("working"), step: "Split 2 clips" }, { seenAt: 5000, isOpen: true, waiting: false })).toEqual({
      kind: "working",
      since: 1000,
      step: "Split 2 clips",
      provider: "codex",
    });
  });

  it("says when it's waiting for the user", () => {
    expect(chatStatus(activity("working"), { seenAt: undefined, isOpen: false, waiting: true })).toEqual({ kind: "waiting", provider: "codex" });
  });

  it("shows a finished chat until its video is looked at", () => {
    expect(chatStatus(activity("done"), { seenAt: undefined, isOpen: false, waiting: false })).toEqual({ kind: "done", provider: "codex" });
    expect(chatStatus(activity("error"), { seenAt: 500, isOpen: false, waiting: false })).toEqual({ kind: "failed", provider: "codex" });
    expect(chatStatus(activity("done"), { seenAt: 2000, isOpen: false, waiting: false })).toBeNull();
    expect(chatStatus(activity("done"), { seenAt: undefined, isOpen: true, waiting: false })).toBeNull();
    // Stopping it was the user's doing.
    expect(chatStatus(activity("stopped"), { seenAt: undefined, isOpen: false, waiting: false })).toBeNull();
    expect(chatStatus(undefined, { seenAt: undefined, isOpen: false, waiting: false })).toBeNull();
  });
});

describe("formatElapsed", () => {
  it("counts seconds, then minutes, then hours", () => {
    expect(formatElapsed(8_400)).toBe("8s");
    expect(formatElapsed(12 * 60_000 + 5_000)).toBe("12m");
    expect(formatElapsed(65 * 60_000)).toBe("1h 5m");
    expect(formatElapsed(120 * 60_000)).toBe("2h");
  });
});
