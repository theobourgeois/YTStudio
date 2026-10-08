/**
 * The assistant's side panel (right of the editor, full height): a chat about
 * the open project, of any suite, with Claude (Claude Code) or Codex, picked in
 * the composer. The agent does the work with its suite's tools (see
 * `shared/suite-tools.ts`); every step shows here as it runs, and what it
 * changes flashes in the editor. Each suite's workspace puts it where it fits.
 */
import { type KeyboardEvent, type PointerEvent, useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  PiArrowDown,
  PiArrowUpBold,
  PiNotePencil,
  PiSparkleFill,
  PiSpinnerGap,
  PiStopFill,
  PiTerminal,
  PiWarningCircle,
  PiX,
} from "react-icons/pi";
import { type AssistantProvider, providerInfo } from "@shared/assistant";
import { type SuiteId, suiteNoun } from "@shared/suites";
import { cn } from "cn";
import { TAB_ID } from "@/assistant/bridge";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { SHORTCUT_KEYS } from "@/hooks/shortcuts";
import { startPointerDrag } from "@/lib/pointer-drag";
import { DEFAULT_ASSISTANT_WIDTH, providerStatus, useAssistant } from "@/stores/assistant";
import { projectSuite, useProjects } from "@/stores/projects";
import { clientSuite } from "@/suites";
import { ChatMessages } from "./chat-messages";
import { EffortPicker, ModelPicker } from "./model-picker";
import { ProviderIcon } from "./provider-icon";
import { ReviewBar } from "./review-bar";

/** The open chat's provider (Claude until it's loaded). */
const useProvider = (): AssistantProvider => useAssistant((s) => s.chat?.provider ?? "claude");
/** Why the open chat's provider can't be used right now, if it can't. */
const useProblem = (): string | null => {
  const provider = useProvider();
  return useAssistant((s) => providerStatus(s.status, provider)?.problem ?? null);
};

/** `suite`: the open project's (each suite's workspace renders the panel). */
export function AssistantPanel({ suite }: { suite: SuiteId }) {
  const open = useAssistant((s) => s.open);
  const width = useAssistant((s) => s.width);
  const projectId = useProjects((s) => s.openId);

  useEffect(() => {
    if (open) void useAssistant.getState().loadStatus();
  }, [open]);
  useEffect(() => {
    if (projectId) void useAssistant.getState().loadChat(projectId);
  }, [projectId]);

  if (!open || !projectId) return null;
  return (
    <aside
      className="relative flex shrink-0 flex-col border-l bg-background"
      style={{ width: `min(${width}px, 45vw)` }}
      aria-label="Assistant"
      data-slot="assistant-panel"
    >
      <ResizeHandle />
      <PanelHeader />
      <ChatBody projectId={projectId} suite={suite} />
      <Confirmations />
      <Composer projectId={projectId} suite={suite} />
    </aside>
  );
}

function PanelHeader() {
  const provider = useProvider();
  const account = useAssistant((s) => providerStatus(s.status, provider)?.account);
  const hasMessages = useAssistant((s) => (s.chat?.messages.length ?? 0) > 0);
  const working = useAssistant((s) => s.chat?.status === "working");
  return (
    <div className="flex h-12 shrink-0 items-center gap-2 border-b pr-2 pl-4">
      <span className="grid size-5 place-items-center rounded-md bg-brand/12 text-brand">
        <PiSparkleFill className="size-3" />
      </span>
      <span className="text-sm font-medium">Assistant</span>
      {account && (
        <span className="flex min-w-0 items-center gap-1 truncate text-xs text-muted-foreground">
          <ProviderIcon provider={provider} className="size-3" />
          {account}
        </span>
      )}
      <div className="ml-auto flex items-center">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon-sm"
              className="text-muted-foreground hover:text-foreground"
              disabled={!hasMessages || working}
              onClick={() => void useAssistant.getState().newChat()}
              aria-label="New chat"
            >
              <PiNotePencil />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">New chat</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon-sm"
              className="text-muted-foreground hover:text-foreground"
              onClick={() => useAssistant.getState().setOpen(false)}
              aria-label="Close the assistant"
            >
              <PiX />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">
            Close
            <kbd className="ml-2 rounded border bg-muted px-1 font-sans text-[10px] leading-4 text-muted-foreground">{SHORTCUT_KEYS.toggleAssistant}</kbd>
          </TooltipContent>
        </Tooltip>
      </div>
    </div>
  );
}

/** The messages, kept scrolled to the newest while it's there (unless scrolled up). */
function ChatBody({ projectId, suite }: { projectId: string; suite: SuiteId }) {
  const chat = useAssistant((s) => (s.chatProjectId === projectId ? s.chat : null));
  const chatError = useAssistant((s) => s.chatError);
  const scroller = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);
  const [showJump, setShowJump] = useState(false);

  useLayoutEffect(() => {
    const el = scroller.current;
    if (el && pinned.current) el.scrollTop = el.scrollHeight;
  });
  // Opening a chat starts at its end.
  useEffect(() => {
    pinned.current = true;
  }, [projectId]);

  const onScroll = () => {
    const el = scroller.current!;
    const atEnd = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
    pinned.current = atEnd;
    setShowJump(!atEnd);
  };

  return (
    <div className="relative min-h-0 flex-1">
      <div ref={scroller} onScroll={onScroll} className="absolute inset-0 overflow-y-auto px-3.5 py-4" data-slot="assistant-messages">
        {!chat ? (
          chatError ? (
            <Notice tone="error" title="Couldn't load the chat">
              {chatError}
            </Notice>
          ) : (
            <div className="flex h-full items-center justify-center text-muted-foreground">
              <PiSpinnerGap className="size-5 animate-spin" />
            </div>
          )
        ) : chat.messages.length === 0 ? (
          <EmptyChat suite={suite} />
        ) : (
          <ChatMessages messages={chat.messages} projectId={projectId} suite={suite} />
        )}
        {chat && chatError && (
          <div className="mt-4">
            <Notice tone="error" title="Couldn't send that">
              {chatError}
            </Notice>
          </div>
        )}
      </div>
      {showJump && (
        <button
          type="button"
          onClick={() => {
            const el = scroller.current!;
            el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
          }}
          className="absolute bottom-3 left-1/2 grid size-7 -translate-x-1/2 cursor-pointer place-items-center rounded-full border bg-popover text-muted-foreground shadow-md hover:text-foreground"
          aria-label="Jump to the latest"
        >
          <PiArrowDown className="size-3.5" />
        </button>
      )}
    </div>
  );
}

function Notice({ tone, title, children, action }: { tone: "error" | "info"; title: string; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div
      className={cn(
        "grid gap-1.5 rounded-xl border px-3.5 py-3 text-[13px] leading-relaxed",
        tone === "error" ? "border-destructive/30 bg-destructive/6" : "bg-card",
      )}
    >
      <span className={cn("flex items-center gap-1.5 text-sm font-medium", tone === "error" && "text-destructive")}>
        {tone === "error" ? <PiWarningCircle className="size-4" /> : <PiTerminal className="size-4" />}
        {title}
      </span>
      <div className="text-muted-foreground [&_code]:rounded [&_code]:bg-muted [&_code]:px-1 [&_code]:font-mono [&_code]:text-foreground">{children}</div>
      {action}
    </div>
  );
}

/** Before the first message: what it can do, and whether its provider's CLI is ready. */
function EmptyChat({ suite }: { suite: SuiteId }) {
  const provider = useProvider();
  const problem = useProblem();
  const { label, app } = providerInfo(provider);
  const { chat } = clientSuite(suite);
  const suggestions = chat.useSuggestions();
  const noun = suiteNoun(suite);

  return (
    <div className="flex min-h-full flex-col justify-center gap-6 pb-6">
      <div className="flex flex-col items-center gap-3 px-4 text-center">
        <span className="grid size-11 place-items-center rounded-2xl bg-brand/12 text-brand">
          <PiSparkleFill className="size-5" />
        </span>
        <div className="grid gap-1">
          <h2 className="text-base font-semibold">Edit with {label}</h2>
          <p className="text-[13px] leading-relaxed text-balance text-muted-foreground">
            {label} {chat.pitch} You'll see every change as it happens, and can undo any of it. It keeps going if you
            switch to another {noun}.
          </p>
        </div>
      </div>
      {problem ? (
        <Notice
          tone="info"
          title={`Set up ${app}`}
          action={
            <Button variant="outline" size="xs" className="mt-1 w-fit" onClick={() => void useAssistant.getState().loadStatus(true)}>
              Check again
            </Button>
          }
        >
          <FormattedProblem text={problem} />
        </Notice>
      ) : (
        <div className="grid gap-1.5">
          {suggestions.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => sendMessage(s)}
              className="cursor-pointer rounded-lg border bg-card/60 px-3.5 py-2.5 text-left text-[13px] text-foreground/85 transition-colors hover:border-brand/40 hover:bg-brand/6 hover:text-foreground"
            >
              {s}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** `backticks` in a status message as code. */
function FormattedProblem({ text }: { text: string }) {
  return (
    <>
      {text.split(/(`[^`]+`)/).map((part, i) =>
        part.startsWith("`") ? <code key={i}>{part.slice(1, -1)}</code> : <span key={i}>{part}</span>,
      )}
    </>
  );
}

/** Send a message with what the editor shows right now (its suite says what that is). */
function sendMessage(text: string): Promise<boolean> {
  const suite = projectSuite(useProjects.getState().openId);
  const { context, label } = (suite && clientSuite(suite).messageContext()) || { context: "", label: "" };
  return useAssistant.getState().send(text, context, label, TAB_ID);
}

/** Things the assistant wants to do that can't be undone, waiting for a yes (naming the video when it's another one). */
function Confirmations() {
  const confirmations = useAssistant((s) => s.confirmations);
  const openId = useProjects((s) => s.openId);
  const projects = useProjects((s) => s.projects);
  if (confirmations.length === 0) return null;
  return (
    <div className="grid gap-2 border-t bg-card/50 px-3 py-3">
      {confirmations.map((c) => (
        <div key={c.id} className="grid gap-2 rounded-xl border border-destructive/30 bg-background p-3" role="alertdialog" aria-label={c.title}>
          <div className="grid gap-0.5">
            {c.projectId && c.projectId !== openId && (
              <span className="text-xs text-muted-foreground">In “{projects.find((p) => p.id === c.projectId)?.name ?? "another project"}”</span>
            )}
            <span className="text-sm font-medium">{c.title}</span>
            <span className="text-[13px] text-muted-foreground">{c.detail}</span>
          </div>
          <div className="flex justify-end gap-1.5">
            <Button variant="ghost" size="sm" onClick={() => useAssistant.getState().answer(c.id, false)}>
              Don't
            </Button>
            <Button variant="destructive" size="sm" onClick={() => useAssistant.getState().answer(c.id, true)}>
              Delete
            </Button>
          </div>
        </div>
      ))}
    </div>
  );
}

function Composer({ projectId, suite }: { projectId: string; suite: SuiteId }) {
  const draft = useAssistant((s) => s.drafts[projectId] ?? "");
  const working = useAssistant((s) => s.chat?.status === "working");
  const sending = useAssistant((s) => s.sending);
  const provider = useProvider();
  const problem = useProblem();
  const { label, app } = providerInfo(provider);
  const loaded = useAssistant((s) => s.chat !== null);
  const input = useRef<HTMLTextAreaElement>(null);

  // Grow with the text (up to a point).
  useLayoutEffect(() => {
    const el = input.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, [draft]);
  // Typing starts right away when the panel opens.
  useEffect(() => input.current?.focus(), []);

  const canSend = !!draft.trim() && !working && !sending && !problem && loaded;
  const submit = async () => {
    if (!canSend) return;
    const text = draft.trim();
    useAssistant.getState().setDraft(projectId, "");
    const sent = await sendMessage(text);
    if (!sent) useAssistant.getState().setDraft(projectId, text);
  };
  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void submit();
    } else if (e.key === "Escape") {
      e.currentTarget.blur();
    } else if (e.key.toLowerCase() === "i" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      useAssistant.getState().setOpen(false);
    }
  };

  return (
    <div className="shrink-0 px-3 pt-1 pb-3">
      <ReviewBar projectId={projectId} suite={suite} />
      <div
        className={cn(
          "rounded-xl border bg-card shadow-xs transition-[border-color,box-shadow] focus-within:border-ring/60 focus-within:ring-[3px] focus-within:ring-ring/15 dark:bg-secondary/60",
          working && "border-brand/40",
        )}
      >
        <textarea
          ref={input}
          value={draft}
          rows={1}
          disabled={!!problem}
          placeholder={problem ? `Set up ${app} to start` : working ? `${label} is working…` : `Ask ${label} to ${clientSuite(suite).chat.ask}…`}
          onChange={(e) => useAssistant.getState().setDraft(projectId, e.target.value)}
          onKeyDown={onKeyDown}
          aria-label="Message the assistant"
          className="block max-h-50 min-h-12 w-full resize-none bg-transparent px-4 pt-3.5 pb-1.5 text-sm leading-relaxed outline-none placeholder:text-muted-foreground/70 disabled:cursor-not-allowed"
        />
        <div className="flex items-center gap-1 px-2 pb-2">
          <ModelPicker />
          <EffortPicker />
          <div className="ml-auto flex min-w-0 items-center gap-1">
            <ContextLabel suite={suite} />
            {working ? (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button size="icon-sm" variant="secondary" className="size-7 rounded-full" onClick={() => useAssistant.getState().stop()} aria-label="Stop">
                    <PiStopFill className="size-3" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="top">Stop</TooltipContent>
              </Tooltip>
            ) : (
              <Button
                size="icon-sm"
                className="size-7 rounded-full bg-brand text-brand-foreground hover:bg-brand/88"
                disabled={!canSend}
                onClick={() => void submit()}
                aria-label="Send"
              >
                {sending ? <PiSpinnerGap className="size-3.5 animate-spin" /> : <PiArrowUpBold className="size-3.5" />}
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/** What gets sent along (e.g. the selection and playhead), live (its own component: it can change during playback). */
function ContextLabel({ suite }: { suite: SuiteId }) {
  const { chat } = clientSuite(suite);
  const label = chat.useContextLabel();
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="min-w-0 truncate rounded-md px-1.5 py-0.5 text-[11px] text-muted-foreground tabular-nums">{label}</span>
      </TooltipTrigger>
      <TooltipContent side="top">{chat.contextHint}</TooltipContent>
    </Tooltip>
  );
}

/** The panel's left edge: drag to resize, double-click for the usual width. */
function ResizeHandle() {
  const width = useAssistant((s) => s.width);
  const setWidth = useAssistant((s) => s.setWidth);
  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    const start = e.currentTarget.parentElement!.getBoundingClientRect().width;
    const x0 = e.clientX;
    let last = start;
    e.preventDefault();
    startPointerDrag(e, {
      threshold: 0,
      cursor: "col-resize",
      onMove: (ev) => {
        last = start - (ev.clientX - x0);
        setWidth(last);
      },
      onEnd: () => setWidth(last, true),
      onCancel: () => setWidth(width),
    });
  };
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize the assistant"
      tabIndex={0}
      onPointerDown={onPointerDown}
      onDoubleClick={() => setWidth(DEFAULT_ASSISTANT_WIDTH, true)}
      onKeyDown={(e) => {
        const step = e.shiftKey ? 64 : 16;
        if (e.key === "ArrowLeft") setWidth(width + step, true);
        else if (e.key === "ArrowRight") setWidth(width - step, true);
        else return;
        e.preventDefault();
      }}
      className={cn(
        "absolute inset-y-0 -left-1.5 z-20 w-3 cursor-col-resize touch-none outline-none",
        "after:absolute after:inset-y-0 after:left-1/2 after:w-0.5 after:-translate-x-1/2 after:bg-brand after:opacity-0 after:transition-opacity",
        "hover:after:opacity-100 focus-visible:after:opacity-100 active:after:opacity-100",
      )}
    />
  );
}
