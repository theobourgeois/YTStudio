/**
 * The assistant in the editor: its side panel, the open video's chat (kept by
 * the server and streamed in, see `src/assistant/bridge.ts`), what it's doing
 * right now, the clips it just changed (highlighted on the timeline), the
 * confirmations it's waiting for, and each answer's edits (to revert them).
 */
import { create } from "zustand";
import { type AssistantMessage, type AssistantModel, type ChatEvent, type ChatState, applyChatEvent } from "@shared/assistant";
import { errorMessage } from "@shared/errors";
import type { AssistantStatus, Project } from "@shared/types";
import { api } from "@/lib/api";
import { useEditor } from "./editor";

const OPEN_KEY = "editor-assistant-open";
const WIDTH_KEY = "editor-assistant-width";
const MODEL_KEY = "editor-assistant-model";
export const DEFAULT_ASSISTANT_WIDTH = 400;
export const MIN_ASSISTANT_WIDTH = 320;
export const MAX_ASSISTANT_WIDTH = 720;
/** How long a changed clip stays highlighted. */
export const HIGHLIGHT_MS = 2600;

/** A tool call running in this tab. */
export interface Activity {
  callId: string;
  name: string;
  input: unknown;
  /** The chat it's for (a video id), or null for an agent outside the app. */
  chat: string | null;
  startedAt: number;
}

export interface Confirmation {
  id: string;
  title: string;
  detail: string;
  resolve: (ok: boolean) => void;
}

/** The edits one answer made: the video before its first edit and after its last. */
export interface TurnEdits {
  base: Project;
  result: Project;
  reverted: boolean;
}

interface AssistantState {
  open: boolean;
  setOpen: (open: boolean) => void;
  toggle: () => void;
  width: number;
  setWidth: (width: number, save?: boolean) => void;

  status: AssistantStatus | null;
  loadStatus: (force?: boolean) => Promise<void>;

  /** Whose chat `chat` is. */
  chatProjectId: string | null;
  chat: ChatState | null;
  chatError: string | null;
  loadChat: (projectId: string) => Promise<void>;
  applyEvent: (projectId: string, event: ChatEvent) => void;
  /** The message being sent (until the server has it). */
  sending: boolean;
  send: (text: string, context: string, contextLabel: string, tab: string) => Promise<boolean>;
  stop: () => void;
  newChat: () => Promise<void>;
  setModel: (model: AssistantModel) => void;
  /** What's typed but not sent, per video. */
  drafts: Record<string, string>;
  setDraft: (projectId: string, text: string) => void;

  activity: Activity | null;
  setActivity: (activity: Activity | null) => void;
  /** Clip id -> when it was highlighted (a new value restarts its animation). */
  highlights: Record<string, number>;
  highlight: (clipIds: string[]) => void;

  confirmations: Confirmation[];
  /** Ask the user to allow something; resolves false if they don't (or the call is cancelled). */
  confirm: (title: string, detail: string, signal?: AbortSignal) => Promise<boolean>;
  answer: (id: string, ok: boolean) => void;

  /** Assistant message id -> its edits. */
  turns: Record<string, TurnEdits>;
  recordEdit: (chat: string | null, before: Project, after: Project) => void;
  /** Undo one answer's edits (as a new, undoable step), if nothing changed since. */
  revertTurn: (messageId: string) => boolean;
}

const storedWidth = () => {
  const w = Number(localStorage.getItem(WIDTH_KEY));
  return Number.isFinite(w) && w >= MIN_ASSISTANT_WIDTH ? Math.min(MAX_ASSISTANT_WIDTH, w) : DEFAULT_ASSISTANT_WIDTH;
};

let confirmCount = 0;
let chatToken = 0;
const highlightTimers = new Map<string, ReturnType<typeof setTimeout>>();

export const useAssistant = create<AssistantState>((set, get) => ({
  open: localStorage.getItem(OPEN_KEY) === "true",
  setOpen(open) {
    localStorage.setItem(OPEN_KEY, String(open));
    set({ open });
    if (open) void get().loadStatus();
  },
  toggle() {
    get().setOpen(!get().open);
  },
  width: storedWidth(),
  setWidth(width, save = false) {
    const clamped = Math.round(Math.min(MAX_ASSISTANT_WIDTH, Math.max(MIN_ASSISTANT_WIDTH, width)));
    if (clamped !== get().width) set({ width: clamped });
    if (save) localStorage.setItem(WIDTH_KEY, String(clamped));
  },

  status: null,
  async loadStatus(force = false) {
    if (get().status && !force && !get().status?.problem) return;
    try {
      set({ status: await api.assistantStatus() });
    } catch (err) {
      set({ status: { available: false, version: null, loggedIn: false, account: null, problem: `Couldn't reach the editor's server: ${errorMessage(err)}` } });
    }
  },

  chatProjectId: null,
  chat: null,
  chatError: null,
  async loadChat(projectId) {
    const token = ++chatToken;
    if (get().chatProjectId !== projectId) set({ chatProjectId: projectId, chat: null, chatError: null, turns: {} });
    try {
      let chat = await api.getChat(projectId);
      if (token !== chatToken) return;
      // A model picked before this video had a chat.
      const preferred = localStorage.getItem(MODEL_KEY) as AssistantModel | null;
      if (chat.messages.length === 0 && preferred && preferred !== chat.model) chat = await api.setChatModel(projectId, preferred).catch(() => chat);
      if (token !== chatToken) return;
      set({ chat, chatError: null });
    } catch (err) {
      if (token === chatToken) set({ chatError: errorMessage(err) });
    }
  },
  applyEvent(projectId, event) {
    const { chat, chatProjectId } = get();
    if (projectId !== chatProjectId || !chat) return;
    const next = applyChatEvent(chat, event);
    if (next !== chat) set({ chat: next });
  },

  sending: false,
  async send(text, context, contextLabel, tab) {
    const projectId = get().chatProjectId;
    if (!projectId || get().sending || get().chat?.status === "working") return false;
    set({ sending: true, chatError: null });
    try {
      await api.sendChatMessage(projectId, { text, context, contextLabel, tab });
      return true;
    } catch (err) {
      set({ chatError: errorMessage(err) });
      // It may be about Claude Code itself (not installed, logged out).
      void get().loadStatus(true);
      return false;
    } finally {
      set({ sending: false });
    }
  },
  stop() {
    const projectId = get().chatProjectId;
    if (projectId) api.stopChat(projectId).catch((err) => set({ chatError: errorMessage(err) }));
  },
  async newChat() {
    const projectId = get().chatProjectId;
    if (!projectId) return;
    try {
      const chat = await api.resetChat(projectId);
      if (get().chatProjectId === projectId) set({ chat, turns: {}, chatError: null });
    } catch (err) {
      set({ chatError: errorMessage(err) });
    }
  },
  setModel(model) {
    const projectId = get().chatProjectId;
    localStorage.setItem(MODEL_KEY, model);
    const chat = get().chat;
    if (chat) set({ chat: { ...chat, model } });
    if (projectId) api.setChatModel(projectId, model).catch((err) => set({ chatError: errorMessage(err) }));
  },
  drafts: {},
  setDraft(projectId, text) {
    set({ drafts: { ...get().drafts, [projectId]: text } });
  },

  activity: null,
  setActivity(activity) {
    set({ activity });
  },
  highlights: {},
  highlight(clipIds) {
    if (clipIds.length === 0) return;
    const now = performance.now();
    set({ highlights: { ...get().highlights, ...Object.fromEntries(clipIds.map((id) => [id, now])) } });
    for (const id of clipIds) {
      clearTimeout(highlightTimers.get(id));
      highlightTimers.set(
        id,
        setTimeout(() => {
          highlightTimers.delete(id);
          const { [id]: _, ...rest } = get().highlights;
          set({ highlights: rest });
        }, HIGHLIGHT_MS),
      );
    }
  },

  confirmations: [],
  confirm(title, detail, signal) {
    return new Promise<boolean>((resolve) => {
      const id = `confirm-${++confirmCount}`;
      const done = (ok: boolean) => {
        set({ confirmations: get().confirmations.filter((c) => c.id !== id) });
        resolve(ok);
      };
      signal?.addEventListener("abort", () => done(false), { once: true });
      set({ confirmations: [...get().confirmations, { id, title, detail, resolve: done }] });
      // It's asked in the panel.
      if (!get().open) get().setOpen(true);
    });
  },
  answer(id, ok) {
    get().confirmations.find((c) => c.id === id)?.resolve(ok);
  },

  turns: {},
  recordEdit(chat, before, after) {
    if (!chat || chat !== get().chatProjectId || before === after) return;
    const working = get().chat?.messages.findLast((m): m is AssistantMessage => m.role === "assistant" && m.status === "working");
    if (!working) return;
    const turn = get().turns[working.id];
    set({ turns: { ...get().turns, [working.id]: { base: turn?.base ?? before, result: after, reverted: false } } });
  },
  revertTurn(messageId) {
    const turn = get().turns[messageId];
    const editor = useEditor.getState();
    if (!turn || turn.reverted || editor.project !== turn.result) return false;
    editor.commit(() => turn.base);
    set({ turns: { ...get().turns, [messageId]: { ...turn, reverted: true } } });
    return true;
  },
}));
