import { describe, expect, it } from "vitest";
import { type ChatEvent, type ChatState, DEFAULT_MODELS, type ToolPart, applyChatEvent, chatModel, describeToolCall, emptyChat, transcript } from "./assistant.ts";
import { ASSISTANT_TOOLS, bareToolName, toolSpec } from "./assistant-tools.ts";

const fold = (events: ChatEvent[], start: ChatState = emptyChat()) => events.reduce(applyChatEvent, start);

const turn: ChatEvent[] = [
  { type: "user", message: { id: "u1", role: "user", text: "Split it", at: 1 } },
  { type: "assistant_start", id: "a1", at: 2 },
  { type: "thinking", messageId: "a1", key: "m1:0", done: false },
  { type: "thinking", messageId: "a1", key: "m1:0", done: true },
  { type: "tool_start", messageId: "a1", id: "t1", name: "mcp__editor__split_clips", input: {} },
  { type: "tool_start", messageId: "a1", id: "t1", name: "mcp__editor__split_clips", input: { at: 2 } },
  { type: "tool_progress", id: "t1", fraction: 0.5, label: "Splitting" },
  { type: "tool_end", id: "t1", status: "done", output: "Split at 2", changes: { added: ["c2"], changed: ["c1"], removed: 0 } },
  { type: "text_delta", messageId: "a1", key: "m2:0", text: "Done" },
  { type: "text_delta", messageId: "a1", key: "m2:0", text: " at 0:02." },
];

describe("applyChatEvent", () => {
  it("builds a turn from streamed events", () => {
    const state = fold(turn);
    expect(state.status).toBe("working");
    const answer = state.messages[1];
    expect(answer.role === "assistant" && answer.parts).toEqual([
      { kind: "thinking", key: "m1:0", done: true },
      { kind: "tool", id: "t1", name: "split_clips", input: { at: 2 }, status: "done", output: "Split at 2", changes: { added: ["c2"], changed: ["c1"], removed: 0 } },
      { kind: "text", key: "m2:0", text: "Done at 0:02." },
    ]);
  });

  it("keeps the first (richer) result when one arrives twice", () => {
    const state = fold([...turn, { type: "tool_end", id: "t1", status: "error", output: "from the transcript" }]);
    const tool = (state.messages[1] as { parts: ToolPart[] }).parts.find((p) => p.kind === "tool")!;
    expect(tool.status).toBe("done");
    expect(tool.output).toBe("Split at 2");
  });

  it("ends a turn, stopping what was still running", () => {
    const state = fold([
      ...turn.slice(0, 5),
      { type: "assistant_end", messageId: "a1", status: "stopped" },
    ]);
    expect(state.status).toBe("idle");
    const answer = state.messages[1];
    expect(answer.role === "assistant" && answer.status).toBe("stopped");
    expect(answer.role === "assistant" && answer.parts.at(-1)).toMatchObject({ kind: "tool", status: "error", output: "Stopped." });
  });

  it("returns the same state when nothing changes", () => {
    const state = fold(turn);
    expect(applyChatEvent(state, { type: "tool_progress", id: "nope", fraction: 1 })).toBe(state);
    expect(applyChatEvent(state, { type: "assistant_start", id: "a1", at: 3 })).toBe(state);
  });

  it("resets", () => {
    expect(fold([...turn, { type: "reset", state: emptyChat("codex", "gpt-6-sol") }])).toEqual(emptyChat("codex", "gpt-6-sol"));
  });

  it("switches provider and model", () => {
    const state = fold([{ type: "model", provider: "codex", model: "gpt-6-luna", effort: "high" }]);
    expect(state).toMatchObject({ provider: "codex", model: "gpt-6-luna", effort: "high" });
    expect(applyChatEvent(state, { type: "model", provider: "codex", model: "gpt-6-luna", effort: "high" })).toBe(state);
  });
});

describe("chatModel", () => {
  it("upgrades chats saved with a Claude alias, and keeps the rest", () => {
    expect(chatModel({ model: "opus" })).toEqual({ provider: "claude", model: "claude-opus-5-5", effort: null });
    expect(chatModel({ model: "default" })).toEqual({ provider: "claude", model: "claude-opus-5-5", effort: null });
    expect(chatModel({ provider: "codex", model: "gpt-6-sol", effort: "xhigh" })).toEqual({ provider: "codex", model: "gpt-6-sol", effort: "xhigh" });
    expect(chatModel({ provider: "codex", model: "rm -rf /", effort: "--max" })).toEqual({ provider: "codex", model: DEFAULT_MODELS.codex, effort: null });
    expect(chatModel({ provider: "gemini", model: 3 })).toEqual({ provider: "claude", model: DEFAULT_MODELS.claude, effort: null });
  });
});

describe("transcript", () => {
  it("tells another agent what was said and done", () => {
    const state = fold(turn);
    expect(transcript(state.messages)).toMatchInlineSnapshot(`
      "User: Split it

      Assistant: [Split clips at 2s]
      Done at 0:02."
    `);
    expect(transcript(state.messages, state.messages.length)).toBe("");
  });
});

describe("describeToolCall", () => {
  it("says what a call does", () => {
    expect(describeToolCall("mcp__editor__split_clips", { at: 12.4, clipIds: ["a", "b"] })).toBe("Split 2 clips at 12.4s");
    expect(describeToolCall("move_clips", { clipIds: ["a"], to: 3 })).toBe("Move 1 clip to 3s");
    expect(describeToolCall("add_text", { text: "Hello\nworld" })).toBe("Add text “Hello world”");
    expect(describeToolCall("view_frames", { times: [1, 2, 3] })).toBe("Look at 3 frames");
    expect(describeToolCall("set_transition", { type: null })).toBe("Remove a transition");
    expect(describeToolCall("batch", { steps: [{}, {}] })).toBe("Make 2 edits");
  });

  it("has a description for every tool", () => {
    for (const t of ASSISTANT_TOOLS) expect(describeToolCall(t.name, {})).not.toBe(t.name.replace(/_/g, " "));
  });
});

describe("tools", () => {
  it("have unique names and object schemas", () => {
    const names = ASSISTANT_TOOLS.map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
    for (const t of ASSISTANT_TOOLS) expect(t.inputSchema.type).toBe("object");
    expect(toolSpec("batch")?.kind).toBe("edit");
    expect(bareToolName("mcp__editor__batch")).toBe("batch");
  });
});
