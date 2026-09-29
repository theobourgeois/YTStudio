/**
 * The link between the server and open editor tabs. Each tab holds an event
 * stream (`GET /api/assistant/events`); tool calls are sent down it, and the
 * tab posts each result back. Chat updates go down the same stream to every
 * tab showing that video, and what every chat is doing to every tab.
 */
import type { Request, Response } from "express";
import type { ChatActivity, ChatEvent, TabEvent } from "../../shared/assistant.ts";
import type { ToolChanges, ToolContent, ToolResult } from "../../shared/assistant-tools.ts";
import { createId } from "../../shared/timeline.ts";
import { HttpError, isObject } from "../storage.ts";

const HEARTBEAT_MS = 15_000;
/** A tab whose stream drops has this long to reconnect before its calls fail (it's still running them). */
const RECONNECT_GRACE_MS = 5000;
const TAB_ID_RE = /^[A-Za-z0-9-]{8,64}$/;
/** Biggest result a tab may send (a few pictures). */
const MAX_IMAGES = 16;

export const isTabId = (v: unknown): v is string => typeof v === "string" && TAB_ID_RE.test(v);

interface Tab {
  id: string;
  projectId: string | null;
  focusedAt: number;
  send: (event: TabEvent) => void;
}

interface PendingCall {
  tabId: string;
  chat: string | null;
  resolve: (result: ToolResult) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
  onProgress?: (fraction: number | null, label?: string) => void;
}

export interface CallOptions {
  timeoutMs: number;
  /** The chat it's for (its video's id), or null for an outside client. */
  chat: string | null;
  /** The chat's assistant message it's part of. */
  turn?: string;
  onProgress?: (fraction: number | null, label?: string) => void;
}

export class Bridge {
  private tabs = new Map<string, Tab>();
  private calls = new Map<string, PendingCall>();
  private activity: ChatActivity[] = [];

  /** Serve a tab's event stream until it disconnects. */
  connect(req: Request, res: Response, tabId: string, projectId: string | null): void {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-store",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    res.flushHeaders();
    const send = (event: TabEvent) => res.write(`data: ${JSON.stringify(event)}\n\n`);
    // A reconnect replaces the old stream (the page, and the calls it's running, are the same).
    const tab: Tab = { id: tabId, projectId, focusedAt: Date.now(), send };
    this.tabs.set(tabId, tab);
    send({ type: "activity", chats: this.activity });
    const heartbeat = setInterval(() => res.write(": ping\n\n"), HEARTBEAT_MS);
    req.on("close", () => {
      clearInterval(heartbeat);
      if (this.tabs.get(tabId) !== tab) return;
      this.tabs.delete(tabId);
      setTimeout(() => {
        if (!this.tabs.has(tabId)) this.drop(tabId, "The editor tab was closed.");
      }, RECONNECT_GRACE_MS);
    });
  }

  private drop(tabId: string, reason: string) {
    this.tabs.delete(tabId);
    for (const [id, call] of this.calls) {
      if (call.tabId === tabId) this.settle(id, (c) => c.reject(new Error(reason)));
    }
  }

  focus(tabId: string): void {
    const tab = this.tabs.get(tabId);
    if (tab) tab.focusedAt = Date.now();
  }

  /**
   * The tab to run a call in. For a chat's video: `preferred` (the tab its message came from) if it's
   * showing the video, else another tab showing it, else `preferred` or the tab used last anyway (a tab
   * can work on a video it isn't showing). With no video given (an outside agent): the tab used last.
   */
  tabFor(projectId: string | null, preferred?: string | null): Tab | undefined {
    const tabs = [...this.tabs.values()].sort((a, b) => b.focusedAt - a.focusedAt);
    const pick = preferred ? this.tabs.get(preferred) : undefined;
    if (projectId) {
      if (pick?.projectId === projectId) return pick;
      return tabs.find((t) => t.projectId === projectId) ?? pick ?? tabs[0];
    }
    return tabs.find((t) => t.projectId) ?? tabs[0];
  }

  /** Run a tool in a tab and wait for its result. */
  call(tab: Tab, name: string, input: Record<string, unknown>, opts: CallOptions): Promise<ToolResult> {
    const id = createId("call");
    return new Promise<ToolResult>((resolve, reject) => {
      const timer = setTimeout(
        () => this.settle(id, (c) => c.reject(new Error(`The editor didn't finish ${name} in time.`))),
        opts.timeoutMs,
      );
      this.calls.set(id, { tabId: tab.id, chat: opts.chat, resolve, reject, timer, onProgress: opts.onProgress });
      tab.send({ type: "call", id, name, input, chat: opts.chat, ...(opts.turn && { turn: opts.turn }) });
    });
  }

  private settle(id: string, finish: (call: PendingCall) => void) {
    const call = this.calls.get(id);
    if (!call) return;
    this.calls.delete(id);
    clearTimeout(call.timer);
    finish(call);
  }

  /** A tab's answer to a call. */
  resolve(id: string, tabId: unknown, body: unknown): void {
    const call = this.calls.get(id);
    if (!call || call.tabId !== tabId) throw new HttpError(404, "No such call");
    const result = parseResult(isObject(body) ? body.result : undefined);
    this.settle(id, (c) => c.resolve(result));
  }

  progress(id: string, tabId: unknown, body: unknown): void {
    const call = this.calls.get(id);
    if (!call || call.tabId !== tabId) throw new HttpError(404, "No such call");
    const b = isObject(body) ? body : {};
    const fraction = typeof b.fraction === "number" && Number.isFinite(b.fraction) ? Math.min(1, Math.max(0, b.fraction)) : null;
    const label = typeof b.label === "string" ? b.label.slice(0, 200) : undefined;
    call.onProgress?.(fraction, label);
  }

  /** Stop a chat's calls that are still running (the turn was stopped). */
  cancelChat(chat: string): void {
    for (const [id, call] of this.calls) {
      if (call.chat !== chat) continue;
      this.tabs.get(call.tabId)?.send({ type: "cancel", id });
      this.settle(id, (c) => c.reject(new Error("Stopped.")));
    }
  }

  /** Send a chat update to every tab showing that video. */
  broadcast(projectId: string, seq: number, event: ChatEvent): void {
    for (const tab of this.tabs.values()) {
      if (tab.projectId === projectId) tab.send({ type: "chat", projectId, seq, event });
    }
  }

  /** What every chat is doing, sent to every tab now and to tabs that connect later. */
  setActivity(chats: ChatActivity[]): void {
    this.activity = chats;
    for (const tab of this.tabs.values()) tab.send({ type: "activity", chats });
  }

  shutdown(): void {
    for (const id of [...this.calls.keys()]) this.settle(id, (c) => c.reject(new Error("The server is stopping.")));
  }
}

/** A tool result from a tab (untrusted): its text and pictures, and what changed. */
export function parseResult(raw: unknown): ToolResult {
  if (!isObject(raw) || !Array.isArray(raw.content)) throw new HttpError(400, "Expected { result: { content } }.");
  const content: ToolContent[] = [];
  let images = 0;
  for (const c of raw.content) {
    if (!isObject(c)) continue;
    if (c.type === "text" && typeof c.text === "string") content.push({ type: "text", text: c.text });
    else if (c.type === "image" && typeof c.data === "string" && /^image\/(jpeg|png|webp)$/.test(String(c.mimeType))) {
      if (++images <= MAX_IMAGES) content.push({ type: "image", data: c.data, mimeType: String(c.mimeType) });
    }
  }
  if (content.length === 0) content.push({ type: "text", text: "(no result)" });
  const result: ToolResult = { content };
  if (raw.isError === true) result.isError = true;
  const changes = parseChanges(raw.changes);
  if (changes) result.changes = changes;
  return result;
}

function parseChanges(raw: unknown): ToolChanges | undefined {
  if (!isObject(raw)) return undefined;
  const ids = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string").slice(0, 2000) : []);
  const removed = typeof raw.removed === "number" && Number.isFinite(raw.removed) ? Math.max(0, Math.round(raw.removed)) : 0;
  return { added: ids(raw.added), changed: ids(raw.changed), removed };
}
