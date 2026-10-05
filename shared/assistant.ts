/**
 * The in-app assistant's conversation: one chat per video, kept by the server
 * (`server/assistant/service.ts`, which runs Claude Code or Codex) and streamed to the
 * editor as `ChatEvent`s. Both sides fold the events with `applyChatEvent`,
 * so the server's saved copy and what the chat panel shows can't drift apart.
 *
 * The tools themselves are in `assistant-tools.ts`.
 */
import { toolSpec } from "./suite-tools.ts";
import { type ToolChanges, bareToolName } from "./tool-spec.ts";

/** Which agent answers: the user's own Claude Code or Codex (each with its own login and subscription). */
export type AssistantProvider = "claude" | "codex";

export interface AssistantProviderInfo {
  id: AssistantProvider;
  /** The model family's name ("Claude"). */
  label: string;
  /** The program that runs it ("Claude Code"). */
  app: string;
}

export const ASSISTANT_PROVIDERS: readonly AssistantProviderInfo[] = [
  { id: "claude", label: "Claude", app: "Claude Code" },
  { id: "codex", label: "Codex", app: "Codex" },
];

export const isAssistantProvider = (v: unknown): v is AssistantProvider => ASSISTANT_PROVIDERS.some((p) => p.id === v);
export const providerInfo = (id: AssistantProvider): AssistantProviderInfo => ASSISTANT_PROVIDERS.find((p) => p.id === id)!;

/** A model a provider offers, as the picker shows it. */
export interface AssistantModelInfo {
  /** What the provider's CLI is given (`--model`). */
  id: string;
  label: string;
  hint?: string;
  /** Just released: badged in the picker. */
  isNew?: boolean;
  /** Listed under "Legacy models". */
  legacy?: boolean;
  /** The thinking levels it can run at, least first (none: it can't be set). */
  efforts?: string[];
  /** The level it runs at unless another is picked (when the provider says). */
  defaultEffort?: string;
}

/** How each thinking level is shown (a provider may offer others: they're shown as they come). */
export const EFFORT_LABELS: Record<string, string> = {
  minimal: "Minimal",
  low: "Low",
  medium: "Medium",
  high: "High",
  xhigh: "Extra high",
  max: "Max",
  ultra: "Ultra",
};

export const effortLabel = (effort: string): string => EFFORT_LABELS[effort] ?? effort[0].toUpperCase() + effort.slice(1);

/** A thinking level as a CLI takes it. */
export const isEffort = (v: unknown): v is string => typeof v === "string" && /^[a-z]{2,12}$/.test(v);

const CLAUDE_EFFORTS = ["low", "medium", "high", "xhigh", "max"];

/** Claude's models (Claude Code takes these ids as they are). */
export const CLAUDE_MODELS: readonly AssistantModelInfo[] = [
  { id: "claude-opus-5-5", label: "Claude Opus 5.5", hint: "Most capable for editing", isNew: true, efforts: CLAUDE_EFFORTS },
  { id: "claude-sonnet-5-5", label: "Claude Sonnet 5.5", hint: "Fast and capable", isNew: true, efforts: CLAUDE_EFFORTS },
  { id: "claude-fable-5-1", label: "Claude Fable 5.1", hint: "Deepest reasoning, slower", efforts: CLAUDE_EFFORTS },
  { id: "claude-opus-5", label: "Claude Opus 5", efforts: CLAUDE_EFFORTS },
  { id: "claude-sonnet-5", label: "Claude Sonnet 5", efforts: CLAUDE_EFFORTS },
  { id: "claude-haiku-4-5", label: "Claude Haiku 4.5", hint: "Fastest" },
  { id: "claude-opus-4-8", label: "Claude Opus 4.8", legacy: true, efforts: CLAUDE_EFFORTS },
  { id: "claude-sonnet-4-6", label: "Claude Sonnet 4.6", legacy: true, efforts: ["low", "medium", "high", "max"] },
];

/**
 * Codex's models when its own list can't be read (the server asks Codex for the
 * current list: `model/list`, see `server/assistant/codex.ts`).
 */
export const CODEX_MODELS: readonly AssistantModelInfo[] = [
  { id: "gpt-6-astra", label: "GPT-6-Astra", hint: "Frontier intelligence for the most demanding work.", efforts: ["low", "medium", "high", "xhigh", "max", "ultra"], defaultEffort: "low" },
  { id: "gpt-6-sol", label: "GPT-6-Sol", hint: "Workhorse model for coding and everyday work.", efforts: ["low", "medium", "high", "xhigh", "max", "ultra"], defaultEffort: "medium" },
  { id: "gpt-6-luna", label: "GPT-6-Luna", hint: "Fast and affordable model for easier tasks.", efforts: ["low", "medium", "high", "xhigh", "max"], defaultEffort: "medium" },
  { id: "gpt-5.6-sol", label: "GPT-5.6-Sol", legacy: true, efforts: ["low", "medium", "high", "xhigh", "max", "ultra"], defaultEffort: "low" },
  { id: "gpt-5.6-terra", label: "GPT-5.6-Terra", legacy: true, efforts: ["low", "medium", "high", "xhigh", "max", "ultra"], defaultEffort: "medium" },
  { id: "gpt-5.6-luna", label: "GPT-5.6-Luna", legacy: true, efforts: ["low", "medium", "high", "xhigh", "max"], defaultEffort: "medium" },
  { id: "gpt-5.5", label: "GPT-5.5", legacy: true, efforts: ["low", "medium", "high", "xhigh"], defaultEffort: "medium" },
];

export const DEFAULT_MODELS: Record<AssistantProvider, string> = { claude: "claude-opus-5-5", codex: "gpt-6-astra" };

/** A model id as a CLI takes it (anything else is refused before it reaches one). */
export const isModelId = (v: unknown): v is string => typeof v === "string" && /^[A-Za-z0-9][A-Za-z0-9._:[\]-]{0,79}$/.test(v);

/** Chats saved before there was a choice of provider named a Claude alias. */
const LEGACY_MODELS: Record<string, string> = {
  default: "claude-opus-5-5",
  opus: "claude-opus-5-5",
  sonnet: "claude-sonnet-5-5",
  haiku: "claude-haiku-4-5",
};

/** A saved chat's provider, model and thinking level, made valid (older chats only had a Claude alias). */
export function chatModel(raw: { provider?: unknown; model?: unknown; effort?: unknown }): {
  provider: AssistantProvider;
  model: string;
  effort: string | null;
} {
  const provider = isAssistantProvider(raw.provider) ? raw.provider : "claude";
  const model = typeof raw.model === "string" ? (LEGACY_MODELS[raw.model] ?? raw.model) : "";
  return { provider, model: isModelId(model) ? model : DEFAULT_MODELS[provider], effort: isEffort(raw.effort) ? raw.effort : null };
}

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
  provider: AssistantProvider;
  model: string;
  /** How hard it thinks (a level the model offers), or null for the model's (or CLI's) default. */
  effort: string | null;
}

export const emptyChat = (provider: AssistantProvider = "claude", model = DEFAULT_MODELS[provider], effort: string | null = null): ChatState => ({
  messages: [],
  status: "idle",
  provider,
  model,
  effort,
});

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
  | { type: "model"; provider: AssistantProvider; model: string; effort: string | null }
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
      return state.provider === event.provider && state.model === event.model && state.effort === event.effort
        ? state
        : { ...state, provider: event.provider, model: event.model, effort: event.effort };
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

/**
 * What a video's chat is doing, for the sidebar: working (since when), or how its last answer
 * ended (and when). Every tab gets every chat's, whichever video it shows.
 */
export interface ChatActivity {
  projectId: string;
  status: "working" | "done" | "error" | "stopped";
  /** Epoch ms: when it started working, or when it finished. */
  since: number;
  provider: AssistantProvider;
  /** While working: the step it's on ("Split 2 clips at 12.4s"), once it has taken one. */
  step?: string;
}

/**
 * The conversation from message `from` on as plain text, for an agent that wasn't in it (the chat
 * switched provider): what was asked, what was answered, and which tools ran.
 */
export function transcript(messages: readonly ChatMessage[], from = 0): string {
  const lines: string[] = [];
  for (const m of messages.slice(from)) {
    if (m.role === "user") {
      lines.push(`User: ${m.text}`);
      continue;
    }
    const said: string[] = [];
    for (const p of m.parts) {
      if (p.kind === "text" && p.text.trim()) said.push(p.text.trim());
      else if (p.kind === "tool") said.push(`[${describeToolCall(p.name, p.input)}${p.status === "error" ? " (failed)" : ""}]`);
    }
    if (said.length) lines.push(`Assistant: ${said.join("\n")}`);
  }
  return lines.join("\n\n");
}

/** What an editor tab receives on its event stream (`GET /api/assistant/events`). */
export type TabEvent =
  /**
   * Run a tool here and post the result back. `chat`: the chat it's for, which is its video's id (the
   * tool acts on that video even if this tab shows another), or null for an outside agent (the open video).
   * `turn`: the chat's assistant message it's part of (its edits can be reverted together).
   */
  | { type: "call"; id: string; name: string; input: Record<string, unknown>; chat: string | null; turn?: string }
  /** Stop running a call (its turn was stopped). */
  | { type: "cancel"; id: string }
  /** An update to the chat of a video this tab shows (`seq`: its number, see `ChatSnapshot`). */
  | { type: "chat"; projectId: string; seq: number; event: ChatEvent }
  /** Every chat that's working or has answered since the server started (sent on connecting and on each change). */
  | { type: "activity"; chats: ChatActivity[] };

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
    case "list_mix_workflows": return "Find mixing workflows";
    case "list_dataset_packages": return "Find engineer packages";
    case "register_dataset_audio": return "Register engineer audio passage";
    case "get_dataset_package": return "Read engineer package coverage";
    case "get_dataset_import": return "Read engineer import progress";
    case "cancel_dataset_import": return "Cancel engineer package import";
    case "retry_dataset_import": return "Retry engineer package import";
    case "get_mix_workflow": return "Read a mixing workflow";
    case "search_mix_examples": return "Find reviewed mixing examples";
    case "get_mix_example": return "Read a reviewed mixing example";
    case "list_engineer_profiles": return "Find reviewed engineer profiles";
    case "get_engineer_profile": return "Read an engineer profile";
    case "get_vocal_mixing_workflow": return "Read the vocal mixing workflow";
    case "create_vocal_mix_run": return "Render vocal mix alternatives";
    case "get_vocal_mix_run": return "Read vocal comparison progress";
    case "cancel_vocal_mix_run": return "Cancel vocal comparison";
    case "retry_vocal_mix_run": return "Retry vocal comparison jobs";
    case "review_vocal_mix_run": return "Open vocal comparison playback";
    case "apply_vocal_mix_candidate": return "Apply the selected vocal alternative";
    case "capture_audio_snapshot": return "Capture the song for analysis";
    case "render_audio_passage": return "Render an analysis passage";
    case "register_audio_artifact": return "Register audio for analysis";
    case "get_hearing_capabilities": return "Check audio listening availability";
    case "hear_audio_artifact": return "Analyze audio with Gemini";
    case "get_hearing_receipt": return "Read audio listening usage";
    case "analyse_audio_artifact": return "Measure an audio artifact";
    case "get_audio_job": return "Read audio job progress";
    case "cancel_audio_job": return "Cancel an audio job";
    case "retry_audio_job": return "Retry an audio job";
    case "get_audio_report": return "Read audio measurements";
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
      return f("assetId") ? "Transcribe a media file" : ids() ? `Transcribe ${count(ids(), "clip")}` : "Read the transcript";
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
    case "add_layer": {
      const effects = list(f("effects")).length;
      const what = f("kind") === "solid" ? "a solid" : f("kind") === "shape" ? "a shape layer" : f("kind") === "camera" ? "a camera" : f("kind") === "null" ? "a null object" : "an adjustment layer";
      return effects ? `Add ${what} with ${count(effects, "effect")}` : `Add ${what}`;
    }
    case "apply_preset": {
      const type = String(f("type") ?? "").replace(/-/g, " ").trim();
      return type ? `Apply the ${type} preset` : "Apply a preset";
    }
    case "move_clips": {
      const what = count(ids(), "clip");
      if (typeof f("to") === "number") return `Move ${what} to ${seconds(f("to"))}`;
      if (typeof f("by") === "number") return `Move ${what} by ${seconds(f("by"))}`;
      return `Move ${what} to another track`;
    }
    case "trim_clip":
      return f("ripple") ? "Ripple trim a clip" : "Trim a clip";
    case "set_speed": {
      const what = count(ids(), "clip");
      if (typeof f("speed") === "number") return `Set ${what} to ${Math.round(Number(f("speed")) * 100) / 100}× speed${f("reversed") === true ? ", reversed" : ""}`;
      if (typeof f("duration") === "number") return `Stretch ${what} to ${seconds(f("duration"))}`;
      if (f("reversed") === true) return `Reverse ${what}`;
      if (f("reversed") === false) return `Play ${what} forwards`;
      return `Change the speed of ${what}`;
    }
    case "nest_clips":
      return `Nest ${count(ids(), "clip")}`;
    case "break_apart":
      return "Break apart a nested clip";
    case "edit_sequence":
      return f("delete") === true ? "Delete a nested sequence" : "Change a nested sequence";
    case "open_sequence":
      return f("sequenceId") ? "Open a nested sequence" : "Back to the main sequence";
    case "remap_time": {
      if (Array.isArray(f("speeds"))) return `Speed ramp a clip`;
      if (f("freeze")) return "Freeze a frame";
      if (f("reverse")) return "Reverse a section";
      if (f("enabled") === false) return "Turn off time remapping";
      return "Remap a clip's time";
    }
    case "get_layout":
      return f("time") === undefined ? "Measure the canvas" : `Measure the canvas at ${seconds(f("time"))}`;
    case "set_expression":
      return f("expression") === null ? `Remove the expression on ${String(f("param") ?? "a property")}` : `Put an expression on ${String(f("param") ?? "a property")}`;
    case "mark_beats":
      return f("clear") ? "Clear the beat markers" : f("marks") === "bars" ? "Mark the bars" : f("marks") === "drops" ? "Mark the drops" : "Mark the beats";
    case "cut_to_markers":
      return ids() ? `Cut ${count(ids(), "clip")} to the beat` : "Cut to the beat";
    case "set_markers": {
      const [added, changed, removed] = [list(f("add")).length, list(f("update")).length, list(f("remove")).length];
      if (added && !changed && !removed) return `Add ${count(added, "marker")}`;
      if (removed && !added && !changed) return `Remove ${count(removed, "marker")}`;
      if (f("clear") && !added && !changed) return "Clear the markers";
      return "Change the markers";
    }
    case "set_parent":
      return f("parentId") ? `Parent ${count(ids(), "clip")} to a clip` : `Unparent ${count(ids(), "clip")}`;
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
    case "make_subclips":
      return `Make ${count(list(f("items")).length, "subclip")}`;
    case "edit_subclips": {
      const items = list(f("items"));
      const n = count(items.length, "subclip");
      return items.every((i) => field(i, "delete") === true) ? `Delete ${n}` : `Edit ${n}`;
    }
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
      // Other suites' tools, until they need a label of their own.
      return toolSpec(name)?.title ?? name.replace(/_/g, " ");
  }
}
