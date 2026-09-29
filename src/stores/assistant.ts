/**
 * The assistant in the editor: its side panel, the open video's chat (kept by
 * the server and streamed in, see `src/assistant/bridge.ts`), which chats are
 * working (every video's, for the sidebar), what it's doing right now, the
 * clips it just changed (highlighted on the timeline), the confirmations it's
 * waiting for, and each answer's edits (to revert them).
 */
import { create } from "zustand";
import {
  ASSISTANT_PROVIDERS,
  type AssistantProvider,
  type ChatActivity,
  type ChatEvent,
  type ChatSnapshot,
  type ChatState,
  applyChatEvent,
  chatModel,
} from "@shared/assistant";
import { errorMessage } from "@shared/errors";
import type { AssistantProviderStatus, AssistantStatus, Project } from "@shared/types";
import { api } from "@/lib/api";
import { useEditor } from "./editor";

const OPEN_KEY = "editor-assistant-open";
const WIDTH_KEY = "editor-assistant-width";
/** The provider and model last picked (a new chat starts on them). */
const MODEL_KEY = "editor-assistant-model";
/** When the user last saw each video's chat (so a finished one elsewhere shows as new). */
const SEEN_KEY = "editor-assistant-seen";
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
  /** The video it's about (a chat may be working on one that isn't open). */
  projectId: string | null;
  resolve: (ok: boolean) => void;
}

/** The edits one answer made: the video before its first edit and after its last. */
export interface TurnEdits {
  projectId: string;
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

  /** Chats that are working or have answered, by video id. */
  chatActivity: Record<string, ChatActivity>;
  setChatActivity: (chats: ChatActivity[]) => void;
  /** When the user last looked at each video's chat (epoch ms). */
  seen: Record<string, number>;
  markSeen: (projectId: string) => void;

  /** Whose chat `chat` is. */
  chatProjectId: string | null;
  chat: ChatState | null;
  chatError: string | null;
  /** Fetch the chat (again), e.g. after the event stream reconnects. */
  loadChat: (projectId: string) => Promise<void>;
  /** An event from the stream, numbered `seq` (see `ChatSnapshot`). */
  applyEvent: (projectId: string, seq: number, event: ChatEvent) => void;
  /** The message being sent (until the server has it). */
  sending: boolean;
  send: (text: string, context: string, contextLabel: string, tab: string) => Promise<boolean>;
  stop: () => void;
  newChat: () => Promise<void>;
  /** Pick the chat's provider, model and thinking level (null: the model's default). */
  setModel: (provider: AssistantProvider, model: string, effort: string | null) => void;
  /** What's typed but not sent, per video. */
  drafts: Record<string, string>;
  setDraft: (projectId: string, text: string) => void;

  activity: Activity | null;
  setActivity: (activity: Activity | null) => void;
  /** Clip id -> when it was highlighted (a new value restarts its animation). */
  highlights: Record<string, number>;
  highlight: (clipIds: string[]) => void;

  confirmations: Confirmation[];
  /** Ask the user to allow something about a video; resolves false if they don't (or the call is cancelled). */
  confirm: (title: string, detail: string, projectId: string | null, signal?: AbortSignal) => Promise<boolean>;
  answer: (id: string, ok: boolean) => void;

  /** Assistant message id -> its edits. */
  turns: Record<string, TurnEdits>;
  /** An edit by the answer `turn` (an assistant message id; null for an agent outside the app, not recorded). */
  recordEdit: (turn: string | null, projectId: string, before: Project, after: Project) => void;
  /** Undo one answer's edits (as a new, undoable step), if nothing changed since. */
  revertTurn: (messageId: string) => boolean;
}

/** A provider's status (none until it's loaded). */
export const providerStatus = (status: AssistantStatus | null, provider: AssistantProvider): AssistantProviderStatus | undefined =>
  status?.providers.find((p) => p.provider === provider);

/** The provider, model and thinking level picked last, if any. */
function storedModel(): { provider: AssistantProvider; model: string; effort: string | null } | null {
  try {
    const raw = JSON.parse(localStorage.getItem(MODEL_KEY) ?? "null") as unknown;
    return raw && typeof raw === "object" ? chatModel(raw) : null;
  } catch {
    return null;
  }
}

function storedSeen(): Record<string, number> {
  try {
    const raw = JSON.parse(localStorage.getItem(SEEN_KEY) ?? "{}") as unknown;
    return raw && typeof raw === "object" ? (raw as Record<string, number>) : {};
  } catch {
    return {};
  }
}

const storedWidth = () => {
  const w = Number(localStorage.getItem(WIDTH_KEY));
  return Number.isFinite(w) && w >= MIN_ASSISTANT_WIDTH ? Math.min(MAX_ASSISTANT_WIDTH, w) : DEFAULT_ASSISTANT_WIDTH;
};

let confirmCount = 0;
let chatToken = 0;
/** The number of the last event applied to `chat`. */
let chatSeq = 0;
/** Events that arrive while the chat is being fetched, applied on top of it if they're newer. */
let pending: { projectId: string; events: { seq: number; event: ChatEvent }[] } | null = null;

/** A snapshot with the events that came in after it. */
function catchUp(snap: ChatSnapshot, events: readonly { seq: number; event: ChatEvent }[]): { chat: ChatState; seq: number } {
  let chat = snap.state;
  let seq = snap.seq;
  for (const e of [...events].sort((a, b) => a.seq - b.seq)) {
    if (e.seq !== seq + 1) continue;
    chat = applyChatEvent(chat, e.event);
    seq = e.seq;
  }
  return { chat, seq };
}
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
    // Checked again while the chat's provider can't be used (it may have been set up since).
    const provider = get().chat?.provider ?? storedModel()?.provider ?? "claude";
    if (get().status && !force && !providerStatus(get().status, provider)?.problem) return;
    try {
      set({ status: await api.assistantStatus() });
    } catch (err) {
      const problem = `Couldn't reach the editor's server: ${errorMessage(err)}`;
      set({
        status: {
          providers: ASSISTANT_PROVIDERS.map((p) => ({ provider: p.id, available: false, version: null, loggedIn: false, account: null, problem, models: [] })),
        },
      });
    }
  },

  chatActivity: {},
  setChatActivity(chats) {
    const open = useEditor.getState().projectId;
    // A chat that finishes while its video is open has been seen.
    const mine = chats.find((c) => c.projectId === open);
    if (open && mine && mine.status !== "working" && mine.status !== get().chatActivity[open]?.status) get().markSeen(open);
    set({ chatActivity: Object.fromEntries(chats.map((c) => [c.projectId, c])) });
  },
  seen: storedSeen(),
  markSeen(projectId) {
    const seen = { ...get().seen, [projectId]: Date.now() };
    // Only the recent ones matter.
    const kept = Object.fromEntries(Object.entries(seen).sort((a, b) => b[1] - a[1]).slice(0, 200));
    localStorage.setItem(SEEN_KEY, JSON.stringify(kept));
    set({ seen: kept });
  },

  chatProjectId: null,
  chat: null,
  chatError: null,
  async loadChat(projectId) {
    const token = ++chatToken;
    if (get().chatProjectId !== projectId) set({ chatProjectId: projectId, chat: null, chatError: null });
    const buffer = { projectId, events: [] as { seq: number; event: ChatEvent }[] };
    pending = buffer;
    try {
      let snap = await api.getChat(projectId);
      if (token !== chatToken) return;
      // A model picked before this video had a chat.
      const preferred = storedModel();
      const differs = preferred && (preferred.provider !== snap.state.provider || preferred.model !== snap.state.model || preferred.effort !== snap.state.effort);
      if (snap.state.messages.length === 0 && preferred && differs) {
        snap = await api.setChatModel(projectId, preferred.provider, preferred.model, preferred.effort).catch(() => snap);
        if (token !== chatToken) return;
      }
      const { chat, seq } = catchUp(snap, buffer.events);
      chatSeq = seq;
      set({ chat, chatError: null });
    } catch (err) {
      if (token === chatToken) set({ chatError: errorMessage(err) });
    } finally {
      if (pending === buffer) pending = null;
    }
  },
  applyEvent(projectId, seq, event) {
    if (projectId !== get().chatProjectId) return;
    if (pending?.projectId === projectId) {
      pending.events.push({ seq, event });
      return;
    }
    const chat = get().chat;
    if (!chat || seq <= chatSeq) return;
    // One went missing (it shouldn't): start again from the server's copy.
    if (seq !== chatSeq + 1) {
      void get().loadChat(projectId);
      return;
    }
    chatSeq = seq;
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
      const snap = await api.resetChat(projectId);
      if (get().chatProjectId !== projectId || snap.seq < chatSeq) return;
      chatSeq = snap.seq;
      set({ chat: snap.state, chatError: null });
    } catch (err) {
      set({ chatError: errorMessage(err) });
    }
  },
  setModel(provider, model, effort) {
    const projectId = get().chatProjectId;
    localStorage.setItem(MODEL_KEY, JSON.stringify({ provider, model, effort }));
    const chat = get().chat;
    if (chat) set({ chat: { ...chat, provider, model, effort } });
    if (projectId) api.setChatModel(projectId, provider, model, effort).catch((err) => set({ chatError: errorMessage(err) }));
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
  confirm(title, detail, projectId, signal) {
    return new Promise<boolean>((resolve) => {
      const id = `confirm-${++confirmCount}`;
      const done = (ok: boolean) => {
        set({ confirmations: get().confirmations.filter((c) => c.id !== id) });
        resolve(ok);
      };
      signal?.addEventListener("abort", () => done(false), { once: true });
      set({ confirmations: [...get().confirmations, { id, title, detail, projectId, resolve: done }] });
      // It's asked in the panel.
      if (!get().open) get().setOpen(true);
    });
  },
  answer(id, ok) {
    get().confirmations.find((c) => c.id === id)?.resolve(ok);
  },

  turns: {},
  recordEdit(turn, projectId, before, after) {
    if (!turn || before === after) return;
    const known = get().turns[turn];
    set({ turns: { ...get().turns, [turn]: { projectId, base: known?.base ?? before, result: after, reverted: false } } });
  },
  revertTurn(messageId) {
    const turn = get().turns[messageId];
    const editor = useEditor.getState();
    if (!turn || turn.reverted || editor.projectId !== turn.projectId || editor.project !== turn.result) return false;
    editor.commit(() => turn.base);
    set({ turns: { ...get().turns, [messageId]: { ...turn, reverted: true } } });
    return true;
  },
}));

// Opening a video: its chat has been seen, and answers that edited it in the background (or before it was
// last opened) can still be reverted if it's just as they left it.
useEditor.subscribe((s, prev) => {
  if (s.projectId === prev.projectId || !s.projectId) return;
  if (prev.projectId) useAssistant.getState().markSeen(prev.projectId);
  useAssistant.getState().markSeen(s.projectId);
  const { turns } = useAssistant.getState();
  let text: string | null = null;
  let changed = false;
  const next = { ...turns };
  for (const [id, turn] of Object.entries(turns)) {
    if (turn.projectId !== s.projectId || turn.reverted || turn.result === s.project) continue;
    text ??= JSON.stringify(s.project);
    if (JSON.stringify(turn.result) !== text) continue;
    next[id] = { ...turn, result: s.project };
    changed = true;
  }
  if (changed) useAssistant.setState({ turns: next });
});
