/**
 * This tab's end of the assistant bridge (`server/assistant/bridge.ts`): an
 * event stream from the server carrying tool calls to run here (from the
 * in-app chats, or any MCP client), the open video's chat updates, and what
 * every chat is doing. Calls on one video run one at a time, in order, so its
 * edits never interleave; calls on different videos (chats working on
 * several at once) run side by side.
 */
import { toast } from "sonner";
import { type TabEvent, describeToolCall } from "@shared/assistant";
import type { ToolResult } from "@shared/assistant-tools";
import { api } from "@/lib/api";
import { useAssistant } from "@/stores/assistant";
import { useEditor } from "@/stores/editor";
import { runTool } from "./tools";

const RETRY_MS = 2000;

/** This tab's id (the server sends it the calls for the videos it shows). */
export const TAB_ID = crypto.randomUUID();

/** Each video's calls, in order (keyed by video id, or "" when there's none). */
const queues = new Map<string, Promise<void>>();
/**
 * Calls waiting or running here: which video, whether it has started, and `cancelled` when the
 * server has already given up on it.
 */
const running = new Map<string, { controller: AbortController; cancelled: boolean; target: string; started: boolean }>();

/** The video a call acts on: its chat's, or the open one. */
const targetOf = (call: Extract<TabEvent, { type: "call" }>) => call.chat ?? useEditor.getState().projectId ?? "";

async function execute(call: Extract<TabEvent, { type: "call" }>) {
  const entry = running.get(call.id)!;
  entry.started = true;
  const { controller } = entry;
  const assistant = useAssistant.getState();
  // The pill over the Program monitor shows what's happening to the video on screen.
  const onScreen = entry.target === useEditor.getState().projectId;
  if (onScreen) assistant.setActivity({ callId: call.id, name: call.name, input: call.input, chat: call.chat, startedAt: Date.now() });
  // An agent outside the app: say what it's doing (the chat shows its own).
  if (!call.chat) toast(`Agent: ${describeToolCall(call.name, call.input)}`, { id: "external-agent", duration: 2500 });
  let lastProgress = 0;
  const result: ToolResult = await runTool(call.name, call.input, {
    chat: call.chat,
    turn: call.turn ?? null,
    signal: controller.signal,
    progress: (fraction, label) => {
      // At most a few updates a second.
      if (performance.now() - lastProgress < 250) return;
      lastProgress = performance.now();
      api.postToolProgress(call.id, TAB_ID, fraction, label).catch(() => {});
    },
  });
  running.delete(call.id);
  if (useAssistant.getState().activity?.callId === call.id) useAssistant.getState().setActivity(null);
  if (entry.cancelled) return;
  await api.postToolResult(call.id, TAB_ID, result).catch((err) => console.error("[assistant] couldn't send a result", err));
}

function onEvent(event: TabEvent) {
  switch (event.type) {
    case "call": {
      const target = targetOf(event);
      running.set(event.id, { controller: new AbortController(), cancelled: false, target, started: false });
      const queue = (queues.get(target) ?? Promise.resolve()).then(() => execute(event)).catch((err) => console.error("[assistant]", err));
      queues.set(target, queue);
      void queue.then(() => {
        if (queues.get(target) === queue) queues.delete(target);
      });
      break;
    }
    case "cancel": {
      const entry = running.get(event.id);
      if (!entry) break;
      entry.cancelled = true;
      entry.controller.abort();
      break;
    }
    case "chat":
      useAssistant.getState().applyEvent(event.projectId, event.seq, event.event);
      break;
    case "activity":
      useAssistant.getState().setChatActivity(event.chats);
      break;
  }
}

/**
 * Keep this tab connected while the app runs: reconnects when the open video
 * changes (the server routes by it) and after the connection drops. Returns the cleanup.
 */
export function startAssistantBridge(): () => void {
  let source: EventSource | null = null;
  let projectId = useEditor.getState().projectId;
  let retry: ReturnType<typeof setTimeout> | undefined;

  const connect = () => {
    clearTimeout(retry);
    source?.close();
    const es = new EventSource(api.assistantEventsUrl(TAB_ID, projectId));
    source = es;
    es.onopen = () => {
      // Catch up on anything missed while disconnected.
      if (projectId) void useAssistant.getState().loadChat(projectId);
    };
    es.onmessage = (e) => {
      try {
        onEvent(JSON.parse(e.data) as TabEvent);
      } catch (err) {
        console.error("[assistant] bad event", err);
      }
    };
    es.onerror = () => {
      if (es.readyState !== EventSource.CLOSED) return; // the browser retries by itself
      retry = setTimeout(connect, RETRY_MS);
    };
  };

  const offEditor = useEditor.subscribe((s) => {
    if (s.projectId === projectId) return;
    const left = projectId;
    projectId = s.projectId;
    // Calls already acting on the video that was open can't finish (they report so; the next ones run on it in the background).
    for (const entry of running.values()) if (entry.started && entry.target === left) entry.controller.abort();
    connect();
  });
  const onFocus = () => void api.focusTab(TAB_ID).catch(() => {});
  window.addEventListener("focus", onFocus);
  connect();

  return () => {
    clearTimeout(retry);
    source?.close();
    offEditor();
    window.removeEventListener("focus", onFocus);
  };
}
