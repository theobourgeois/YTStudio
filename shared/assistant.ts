/**
 * The in-app assistant's conversation: one chat per video, kept by the server
 * (`server/assistant/service.ts`, which runs Claude Code) and streamed to the
 * editor as `ChatEvent`s. Both sides fold the events with `applyChatEvent`,
 * so the server's saved copy and what the chat panel shows can't drift apart.
 *
 * The tools themselves are in `assistant-tools.ts`.
 */
import { type ToolChanges, bareToolName } from "./assistant-tools.ts";

/** Which Claude model the assistant runs on ("default": whatever Claude Code is set to). */
export type AssistantModel = "default" | "opus" | "sonnet" | "haiku";

export const ASSISTANT_MODELS: readonly { id: AssistantModel; label: string; hint: string }[] = [
  { id: "default", label: "Default", hint: "Claude Code's own setting" },
  { id: "opus", label: "Opus", hint: "Most capable" },
  { id: "sonnet", label: "Sonnet", hint: "Fast and capable" },
  { id: "haiku", label: "Haiku", hint: "Fastest" },
];

export const isAssistantModel = (v: unknown): v is AssistantModel => ASSISTANT_MODELS.some((m) => m.id === v);

export interface UserMessage {
  id: string;
  role: "user";
  text: string;
  /** What the editor showed when it was sent, as a short label ("2 clips · 0:12.40"). */
  context?: string;
  /** Epoch ms. */
  at: number;
}

export type AssistantStatus = "working" | "done" | "error" | "stopped";

export interface AssistantMessage {
  id: string;
  role: "assistant";
  at: number;
  parts: AssistantPart[];
  status: AssistantStatus;
  error?: string;
}

export type ChatMessage = UserMessage | AssistantMessage;

export interface TextPart {
  kind: "text";
  /** Unique within the message (the API message and block it streamed in). */
  key: string;
  text: string;
}

export interface ThinkingPart {
  kind: "thinking";
  key: string;
  done: boolean;
}

export type ToolStatus = "running" | "done" | "error";

export interface ToolPart {
  kind: "tool";
  /** The tool use id. */
  id: string;
  /** Bare tool name (`split_clips`). */
  name: string;
  input: unknown;
  status: ToolStatus;
  /** The result's text, shortened for display. */
  output?: string;
  /** URLs of the pictures it returned (what the assistant looked at). */
  images?: string[];
  changes?: ToolChanges;
  /** While running: 0..1 (null when it can't be told) and what it's doing. */
  progress?: { fraction: number | null; label?: string };
}

export type AssistantPart = TextPart | ThinkingPart | ToolPart;

export interface ChatState {
  messages: ChatMessage[];
  /** Working while a turn is being answered. */
  status: "idle" | "working";
  model: AssistantModel;
}

export const emptyChat = (model: AssistantModel = "default"): ChatState => ({ messages: [], status: "idle", model });

/**
 * A chat as the server has it, and how many events it has had (`ChatEvent`s are numbered from 1): a tab applies only
 * events after `seq` to it, so a snapshot and the events streaming in around it can't undo each other.
 */
export interface ChatSnapshot {
  state: ChatState;
  seq: number;
}

/** A change to a chat, streamed from the server. */
export type ChatEvent =
  | { type: "user"; message: UserMessage }
  | { type: "assistant_start"; id: string; at: number }
  | { type: "text_delta"; messageId: string; key: string; text: string }
  /** The whole text of a part (replaces what streamed in). */
  | { type: "text"; messageId: string; key: string; text: string }
  | { type: "thinking"; messageId: string; key: string; done: boolean }
  | { type: "tool_start"; messageId: string; id: string; name: string; input: unknown }
  | { type: "tool_progress"; id: string; fraction: number | null; label?: string }
  | { type: "tool_end"; id: string; status: "done" | "error"; output?: string; images?: string[]; changes?: ToolChanges }
  | { type: "assistant_end"; messageId: string; status: Exclude<AssistantStatus, "working">; error?: string }
  | { type: "model"; model: AssistantModel }
  /** Start over (a new chat), or replace everything (after reconnecting). */
  | { type: "reset"; state: ChatState };

/** Longest tool output kept for display. */
export const MAX_TOOL_OUTPUT = 6000;

export function clipOutput(text: string): string {
  return text.length > MAX_TOOL_OUTPUT ? `${text.slice(0, MAX_TOOL_OUTPUT)}…` : text;
}

function updateAssistant(state: ChatState, id: string, update: (m: AssistantMessage) => AssistantMessage): ChatState {
  let changed = false;
  const messages = state.messages.map((m) => {
    if (m.role !== "assistant" || m.id !== id) return m;
    const next = update(m);
    changed ||= next !== m;
    return next;
  });
  return changed ? { ...state, messages } : state;
}

/** The message holding tool `id` (searching from the end: it's almost always the last one). */
function toolOwner(state: ChatState, id: string): AssistantMessage | undefined {
  for (let i = state.messages.length - 1; i >= 0; i--) {
    const m = state.messages[i];
    if (m.role === "assistant" && m.parts.some((p) => p.kind === "tool" && p.id === id)) return m;
  }
  return undefined;
}

function updateTool(state: ChatState, id: string, update: (p: ToolPart) => ToolPart): ChatState {
  const owner = toolOwner(state, id);
  if (!owner) return state;
  return updateAssistant(state, owner.id, (m) => ({
    ...m,
    parts: m.parts.map((p) => (p.kind === "tool" && p.id === id ? update(p) : p)),
  }));
}

function upsertText(m: AssistantMessage, key: string, text: (prev: string) => string): AssistantMessage {
  const at = m.parts.findIndex((p) => p.kind === "text" && p.key === key);
  if (at === -1) return { ...m, parts: [...m.parts, { kind: "text", key, text: text("") }] };
  const parts = [...m.parts];
  const prev = parts[at] as TextPart;
  parts[at] = { ...prev, text: text(prev.text) };
  return { ...m, parts };
}

/** A chat with one event applied (the same object when nothing changed). */
export function applyChatEvent(state: ChatState, event: ChatEvent): ChatState {
  switch (event.type) {
    case "reset":
      return event.state;
    case "model":
      return state.model === event.model ? state : { ...state, model: event.model };
    case "user":
      return { ...state, messages: [...state.messages, event.message] };
    case "assistant_start":
      if (state.messages.some((m) => m.id === event.id)) return state;
      return {
        ...state,
        status: "working",
        messages: [...state.messages, { id: event.id, role: "assistant", at: event.at, parts: [], status: "working" }],
      };
    case "text_delta":
      return updateAssistant(state, event.messageId, (m) => upsertText(m, event.key, (prev) => prev + event.text));
    case "text":
      return updateAssistant(state, event.messageId, (m) => upsertText(m, event.key, () => event.text));
    case "thinking":
      return updateAssistant(state, event.messageId, (m) => {
        const at = m.parts.findIndex((p) => p.kind === "thinking" && p.key === event.key);
        if (at === -1) return { ...m, parts: [...m.parts, { kind: "thinking", key: event.key, done: event.done }] };
        const part = m.parts[at] as ThinkingPart;
        if (part.done === event.done) return m;
        const parts = [...m.parts];
        parts[at] = { ...part, done: event.done };
        return { ...m, parts };
      });
    case "tool_start":
      // Announced as soon as it starts streaming, then again with its whole input.
      if (toolOwner(state, event.id)) {
        return updateTool(state, event.id, (p) =>
          p.status === "running" && JSON.stringify(p.input) !== JSON.stringify(event.input) ? { ...p, input: event.input } : p,
        );
      }
      return updateAssistant(state, event.messageId, (m) => ({
        ...m,
        parts: [...m.parts, { kind: "tool", id: event.id, name: bareToolName(event.name), input: event.input, status: "running" }],
      }));
    case "tool_progress":
      return updateTool(state, event.id, (p) =>
        p.status === "running" ? { ...p, progress: { fraction: event.fraction, ...(event.label && { label: event.label }) } } : p,
      );
    case "tool_end":
      // Results can arrive twice (from the tab, then from the model's transcript): keep the richer one.
      return updateTool(state, event.id, (p) => {
        if (p.status !== "running") return p;
        const { progress: _, ...rest } = p;
        return {
          ...rest,
          status: event.status,
          ...(event.output !== undefined && { output: clipOutput(event.output) }),
          ...(event.images?.length && { images: event.images }),
          ...(event.changes && { changes: event.changes }),
        };
      });
    case "assistant_end": {
      const next = updateAssistant(state, event.messageId, (m) => ({
        ...m,
        status: event.status,
        ...(event.error && { error: event.error }),
        // Whatever was still going stops with the turn.
        parts: m.parts.map((p) => {
          if (p.kind === "thinking" && !p.done) return { ...p, done: true };
          if (p.kind === "tool" && p.status === "running") {
            const { progress: _, ...rest } = p;
            return { ...rest, status: "error" as const, output: rest.output ?? "Stopped." };
          }
          return p;
        }),
      }));
      return { ...next, status: "idle" };
    }
  }
}

/** What an editor tab receives on its event stream (`GET /api/assistant/events`). */
export type TabEvent =
  /** Run a tool here and post the result back. `chat`: the chat it's for (a video id), or null for an outside agent. */
  | { type: "call"; id: string; name: string; input: Record<string, unknown>; chat: string | null }
  /** Stop running a call (its turn was stopped). */
  | { type: "cancel"; id: string }
  /** An update to the chat of a video this tab shows (`seq`: its number, see `ChatSnapshot`). */
  | { type: "chat"; projectId: string; seq: number; event: ChatEvent };

// ---------------------------------------------------------------------------
// Describing tool calls for people
// ---------------------------------------------------------------------------

const seconds = (t: unknown) => (typeof t === "number" && Number.isFinite(t) ? `${Math.round(t * 100) / 100}s` : "?");
const count = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const field = (input: unknown, key: string): unknown =>
  input && typeof input === "object" ? (input as Record<string, unknown>)[key] : undefined;

/** One line saying what a tool call does, e.g. "Split 2 clips at 12.4s". */
export function describeToolCall(rawName: string, input: unknown): string {
  const name = bareToolName(rawName);
  const f = (key: string) => field(input, key);
  const ids = (key = "clipIds") => list(f(key)).length;
  switch (name) {
    case "get_timeline":
      return "Read the timeline";
    case "get_clips":
      return `Read ${count(ids(), "clip")}`;
    case "list_media":
      return "List the media";
    case "view_frames": {
      const times = list(f("times"));
      return times.length === 1 ? `Look at ${seconds(times[0])}` : `Look at ${count(times.length, "frame")}`;
    }
    case "view_media": {
      const n = list(f("times")).length || (typeof f("count") === "number" ? (f("count") as number) : 6);
      return `Watch footage (${count(n, "frame")})`;
    }
    case "get_transcript":
      return ids() ? `Transcribe ${count(ids(), "clip")}` : "Read the transcript";
    case "analyze_audio":
      return ids() ? `Listen to ${count(ids(), "clip")}` : "Listen for silences";
    case "analyze_music":
      return "Find the beat";
    case "detect_scenes":
      return "Find shot changes";
    case "get_catalog": {
      const kind = String(f("kind") ?? "").replace(/_/g, " ");
      return kind ? `Browse ${kind}` : "Browse the catalogue";
    }
    case "get_library":
      return "Browse the Library";
    case "search_online": {
      const q = String(f("query") ?? "").trim();
      return q ? `Search online for “${q.length > 32 ? `${q.slice(0, 31)}…` : q}”` : "Search online";
    }
    case "add_clips": {
      const n = list(f("items")).length;
      return `Add ${count(n, "clip")}`;
    }
    case "add_text": {
      const text = String(f("text") ?? "").replace(/\s+/g, " ").trim();
      return text ? `Add text “${text.length > 28 ? `${text.slice(0, 27)}…` : text}”` : "Add text";
    }
    case "move_clips": {
      const what = count(ids(), "clip");
      if (typeof f("to") === "number") return `Move ${what} to ${seconds(f("to"))}`;
      if (typeof f("by") === "number") return `Move ${what} by ${seconds(f("by"))}`;
      return `Move ${what} to another track`;
    }
    case "trim_clip":
      return f("ripple") ? "Ripple trim a clip" : "Trim a clip";
    case "split_clips":
      return `Split ${ids() ? count(ids(), "clip") : "clips"} at ${seconds(f("at"))}`;
    case "delete_clips":
      return `${f("ripple") ? "Ripple delete" : "Delete"} ${count(ids(), "clip")}`;
    case "close_gaps":
      return typeof f("at") === "number" ? `Close the gap at ${seconds(f("at"))}` : "Close the gaps";
    case "duplicate_clips":
      return `Duplicate ${count(ids(), "clip")}`;
    case "set_properties": {
      const keys = Object.keys((f("params") as object | undefined) ?? {});
      return `Set ${keys.join(", ") || String(f("effect") ?? "properties")} on ${count(ids(), "clip")}`;
    }
    case "set_keyframes": {
      const n = list(f("keyframes")).length;
      return n ? `Animate ${String(f("param") ?? "a property")} (${count(n, "keyframe")})` : `Stop animating ${String(f("param") ?? "")}`.trim();
    }
    case "add_effect":
      return `Add ${String(f("type") ?? "an effect")} to ${count(ids(), "clip")}`;
    case "edit_effect": {
      const what = f("remove") ? "Remove" : f("reset") ? "Reset" : f("move") ? "Reorder" : f("enabled") === false ? "Turn off" : "Turn on";
      return `${what} ${String(f("effect") ?? "an effect")}`;
    }
    case "copy_effects":
      return `Copy effects to ${count(ids("toClipIds"), "clip")}`;
    case "set_transition":
      return f("type") === null ? "Remove a transition" : `Set ${String(f("type") ?? "a transition")} transition`;
    case "add_track":
      return `Add ${String(f("kind") ?? "a")} track`;
    case "edit_track":
      return f("remove") ? "Remove a track" : f("muted") ? "Mute a track" : "Unmute a track";
    case "set_project":
      return "Change the video settings";
    case "style_captions":
      return "Restyle the captions";
    case "merge_captions":
      return "Merge two captions";
    case "batch":
      return `Make ${count(list(f("steps")).length, "edit")}`;
    case "generate_captions":
      return "Add captions";
    case "import_media": {
      const n = list(f("paths")).length + list(f("urls")).length;
      return `Import ${count(n, "file")}`;
    }
    case "delete_media":
      return "Delete media";
    case "library_create_folder":
      return `Create folder “${String(f("name") ?? "")}”`;
    case "library_update":
      return f("folderId") ? "Update a Library folder" : "Update a Library item";
    case "library_delete":
      return f("folderId") ? "Delete a Library folder" : "Delete a Library item";
    case "library_save":
      return "Save to the Library";
    case "library_use":
      return "Add from the Library";
    case "export_video":
      return `Export ${String(f("resolution") ?? "1080p")}`;
    case "focus":
      return typeof f("time") === "number" ? `Show ${seconds(f("time"))}` : "Select clips";
    default:
      return name.replace(/_/g, " ");
  }
}
