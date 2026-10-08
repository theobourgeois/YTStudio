/**
 * This tab's end of the assistant bridge (`server/assistant/bridge.ts`): an
 * event stream from the server carrying tool calls to run here (from the
 * in-app chats, or any MCP client), the open project's chat updates, and what
 * every chat is doing. Each call is run by its project's suite (`src/suites/`).
 * Calls on one project run one at a time, in order, so its edits never
 * interleave; calls on different projects (chats working on several at once)
 * run side by side.
 */
import { toast } from "sonner";
import { type TabEvent, describeToolCall } from "@shared/assistant";
import { errorMessage } from "@shared/errors";
import { DEFAULT_SUITE, suiteNoun } from "@shared/suites";
import { suiteToolSpec, toolSuite } from "@shared/suite-tools";
import { type ToolResult, errorResult } from "@shared/tool-spec";
import { api } from "@/lib/api";
import { useAssistant } from "@/stores/assistant";
import { changed, useCheckpoints } from "@/stores/checkpoints";
import { projectSuite, useProjects } from "@/stores/projects";
import { type ToolRunContext, clientSuite } from "@/suites";
import { log } from "@/lib/log";

const logger = log("assistant");

const RETRY_MS = 2000;

/** This tab's id (the server sends it the calls for the projects it shows). */
export const TAB_ID = crypto.randomUUID();

/** Each project's calls, in order (keyed by project id, or "" when there's none). */
const queues = new Map<string, Promise<void>>();
/**
 * Calls waiting or running here: which project, whether it has started, and `cancelled` when the
 * server has already given up on it.
 */
const running = new Map<string, { controller: AbortController; cancelled: boolean; target: string; started: boolean }>();

/** The project a call acts on: its chat's, or the open one. */
const targetOf = (call: Extract<TabEvent, { type: "call" }>) => call.chat ?? useProjects.getState().openId ?? "";

/** Run a call with the suite of the project it acts on (a tool of another suite is refused). */
async function runTool(target: string, name: string, input: Record<string, unknown>, ctx: ToolRunContext): Promise<ToolResult> {
  const suite = projectSuite(target) ?? DEFAULT_SUITE;
  if (!suiteToolSpec(suite, name)) {
    const other = toolSuite(name);
    if (!other) return errorResult(`Unknown tool: ${name}`);
    return errorResult(`${name} is a tool for ${suiteNoun(other, 2)}, but the open project is a ${suiteNoun(suite)}. Ask the user to open a ${suiteNoun(other)}.`);
  }
  try {
    return await clientSuite(suite).runTool(name, input, ctx);
  } catch (err) {
    logger.error(`${name} failed`, err);
    return errorResult(errorMessage(err));
  }
}

/**
 * For a call of an in-app chat's answer that may change its project: the project before it, and a function that
 * records the change once it's run (the answer's checkpoint, `stores/checkpoints.ts`).
 */
async function checkpoint(target: string, call: Extract<TabEvent, { type: "call" }>): Promise<(() => Promise<void>) | null> {
  const suite = projectSuite(target);
  const turn = call.turn;
  if (!turn || !call.chat || !suite || suiteToolSpec(suite, call.name)?.kind === "look") return null;
  const { documents } = clientSuite(suite);
  const before = await documents.snapshot(target).catch(() => null);
  if (!before) return null;
  return async () => {
    const after = await documents.snapshot(target).catch(() => null);
    if (after && changed(before, after)) useCheckpoints.getState().record(turn, target, before.doc, after.doc);
  };
}

async function execute(call: Extract<TabEvent, { type: "call" }>) {
  const entry = running.get(call.id)!;
  entry.started = true;
  const { controller } = entry;
  const assistant = useAssistant.getState();
  // The editor shows what's happening to the project on screen (e.g. the pill over the Program monitor).
  const onScreen = entry.target === useProjects.getState().openId;
  if (onScreen) assistant.setActivity({ callId: call.id, name: call.name, input: call.input, chat: call.chat, startedAt: Date.now() });
  // An agent outside the app: say what it's doing (the chat shows its own).
  if (!call.chat) toast(`Agent: ${describeToolCall(call.name, call.input)}`, { id: "external-agent", duration: 2500 });
  const recordChange = await checkpoint(entry.target, call);
  let lastProgress = 0;
  const result: ToolResult = await runTool(entry.target, call.name, call.input, {
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
  await recordChange?.();
  running.delete(call.id);
  if (useAssistant.getState().activity?.callId === call.id) useAssistant.getState().setActivity(null);
  if (entry.cancelled) return;
  await api.postToolResult(call.id, TAB_ID, result).catch((err) => logger.error("couldn't send a result", err));
}

function onEvent(event: TabEvent) {
  switch (event.type) {
    case "call": {
      const target = targetOf(event);
      running.set(event.id, { controller: new AbortController(), cancelled: false, target, started: false });
      const queue = (queues.get(target) ?? Promise.resolve()).then(() => execute(event)).catch((err) => logger.error("a tool call failed", err));
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
 * Keep this tab connected while the app runs: reconnects when the open project
 * changes (the server routes by it) and after the connection drops. Returns the cleanup.
 */
export function startAssistantBridge(): () => void {
  let source: EventSource | null = null;
  let projectId = useProjects.getState().openId;
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
        logger.error("bad event", err);
      }
    };
    es.onerror = () => {
      if (es.readyState !== EventSource.CLOSED) return; // the browser retries by itself
      retry = setTimeout(connect, RETRY_MS);
    };
  };

  const offProjects = useProjects.subscribe((s) => {
    if (s.openId === projectId) return;
    const left = projectId;
    projectId = s.openId;
    // Leaving a project: its chat has been seen, and so has the one opened.
    if (left) useAssistant.getState().markSeen(left);
    if (projectId) useAssistant.getState().markSeen(projectId);
    // Calls already acting on the project that was open can't finish (they report so; the next ones run on it in the background).
    for (const entry of running.values()) if (entry.started && entry.target === left) entry.controller.abort();
    connect();
  });
  const onFocus = () => void api.focusTab(TAB_ID).catch(() => {});
  window.addEventListener("focus", onFocus);
  connect();

  return () => {
    clearTimeout(retry);
    source?.close();
    offProjects();
    window.removeEventListener("focus", onFocus);
  };
}
