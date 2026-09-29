/**
 * The assistant's side panel (right of the editor, full height): a chat with
 * Claude about the open video. Claude Code does the work with the editor's
 * tools (see `shared/assistant-tools.ts`); every step shows here as it runs,
 * and what it changes flashes on the timeline.
 */
import { type KeyboardEvent, type PointerEvent, useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  PiArrowDown,
  PiArrowUpBold,
  PiCaretDown,
  PiCheck,
  PiNotePencil,
  PiSparkleFill,
  PiSpinnerGap,
  PiStopFill,
  PiTerminal,
  PiWarningCircle,
  PiX,
} from "react-icons/pi";
import { ASSISTANT_MODELS } from "@shared/assistant";
import { cn } from "cn";
import { messageContext } from "@/assistant/context";
import { TAB_ID } from "@/assistant/bridge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { SHORTCUT_KEYS } from "@/hooks/shortcuts";
import { startPointerDrag } from "@/lib/pointer-drag";
import { DEFAULT_ASSISTANT_WIDTH, useAssistant } from "@/stores/assistant";
import { useEditor } from "@/stores/editor";
import { usePlayback } from "@/stores/playback";
import { ChatMessages } from "./chat-messages";

export function AssistantPanel() {
  const open = useAssistant((s) => s.open);
  const width = useAssistant((s) => s.width);
  const projectId = useEditor((s) => s.projectId);

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
      <ChatBody projectId={projectId} />
      <Confirmations />
      <Composer projectId={projectId} />
    </aside>
  );
}

function PanelHeader() {
  const account = useAssistant((s) => s.status?.account);
  const hasMessages = useAssistant((s) => (s.chat?.messages.length ?? 0) > 0);
  const working = useAssistant((s) => s.chat?.status === "working");
  return (
    <div className="flex h-11 shrink-0 items-center gap-2 border-b pr-1.5 pl-3.5">
      <span className="grid size-5 place-items-center rounded-md bg-brand/12 text-brand">
        <PiSparkleFill className="size-3" />
      </span>
      <span className="text-[13px] font-medium">Assistant</span>
      {account && <span className="truncate text-[11px] text-muted-foreground">{account}</span>}
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
function ChatBody({ projectId }: { projectId: string }) {
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
          <EmptyChat />
        ) : (
          <ChatMessages messages={chat.messages} />
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
        "grid gap-1.5 rounded-xl border px-3.5 py-3 text-xs leading-relaxed",
        tone === "error" ? "border-destructive/30 bg-destructive/6" : "bg-card",
      )}
    >
      <span className={cn("flex items-center gap-1.5 text-[13px] font-medium", tone === "error" && "text-destructive")}>
        {tone === "error" ? <PiWarningCircle className="size-4" /> : <PiTerminal className="size-4" />}
        {title}
      </span>
      <div className="text-muted-foreground [&_code]:rounded [&_code]:bg-muted [&_code]:px-1 [&_code]:font-mono [&_code]:text-foreground">{children}</div>
      {action}
    </div>
  );
}

/** Before the first message: what it can do, and whether Claude Code is ready. */
function EmptyChat() {
  const status = useAssistant((s) => s.status);
  const hasClips = useEditor((s) => s.project.clips.length > 0);
  const hasMedia = useEditor((s) => s.assets.length > 0);
  const selected = useEditor((s) => s.selectedClipIds.length);
  const suggestions = !hasClips
    ? [hasMedia ? "Put my media on the timeline in the best order" : "What can you do?", "Organise my Library into folders"]
    : [
        ...(selected ? [`Add a slow zoom-in to the selected clip${selected === 1 ? "" : "s"}`] : []),
        "Cut out the silences and filler words",
        "Add captions",
        "Make the first 3 seconds grab attention",
        "Add a cross dissolve between every clip",
      ];

  return (
    <div className="flex min-h-full flex-col justify-center gap-6 pb-6">
      <div className="flex flex-col items-center gap-3 px-4 text-center">
        <span className="grid size-11 place-items-center rounded-2xl bg-brand/12 text-brand">
          <PiSparkleFill className="size-5" />
        </span>
        <div className="grid gap-1">
          <h2 className="text-[15px] font-semibold">Edit with Claude</h2>
          <p className="text-xs leading-relaxed text-balance text-muted-foreground">
            Claude can watch your footage, read what's said, and cut, arrange, caption and style your video. You'll see
            every change as it happens, and can undo any of it.
          </p>
        </div>
      </div>
      {status?.problem ? (
        <Notice
          tone="info"
          title="Set up Claude Code"
          action={
            <Button variant="outline" size="xs" className="mt-1 w-fit" onClick={() => void useAssistant.getState().loadStatus(true)}>
              Check again
            </Button>
          }
        >
          <FormattedProblem text={status.problem} />
        </Notice>
      ) : (
        <div className="grid gap-1.5">
          {suggestions.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => sendMessage(s)}
              className="cursor-pointer rounded-lg border bg-card/60 px-3 py-2 text-left text-xs text-foreground/85 transition-colors hover:border-brand/40 hover:bg-brand/6 hover:text-foreground"
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

/** Send a message with what the editor shows right now. */
function sendMessage(text: string): Promise<boolean> {
  const editor = useEditor.getState();
  const { context, label } = messageContext({
    project: editor.project,
    assets: editor.assets,
    playhead: usePlayback.getState().time,
    selectedClipIds: editor.selectedClipIds,
    selectedTransition: editor.selectedTransition,
    selectedGap: editor.selectedGap,
  });
  return useAssistant.getState().send(text, context, label, TAB_ID);
}

/** Things the assistant wants to do that can't be undone, waiting for a yes. */
function Confirmations() {
  const confirmations = useAssistant((s) => s.confirmations);
  if (confirmations.length === 0) return null;
  return (
    <div className="grid gap-2 border-t bg-card/50 px-3 py-3">
      {confirmations.map((c) => (
        <div key={c.id} className="grid gap-2 rounded-xl border border-destructive/30 bg-background p-3" role="alertdialog" aria-label={c.title}>
          <div className="grid gap-0.5">
            <span className="text-[13px] font-medium">{c.title}</span>
            <span className="text-xs text-muted-foreground">{c.detail}</span>
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

function Composer({ projectId }: { projectId: string }) {
  const draft = useAssistant((s) => s.drafts[projectId] ?? "");
  const working = useAssistant((s) => s.chat?.status === "working");
  const sending = useAssistant((s) => s.sending);
  const problem = useAssistant((s) => s.status?.problem ?? null);
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
          placeholder={problem ? "Set up Claude Code to start" : working ? "Claude is working…" : "Ask Claude to edit your video…"}
          onChange={(e) => useAssistant.getState().setDraft(projectId, e.target.value)}
          onKeyDown={onKeyDown}
          aria-label="Message the assistant"
          className="block max-h-50 min-h-11 w-full resize-none bg-transparent px-3.5 pt-3 pb-1 text-[13px] leading-relaxed outline-none placeholder:text-muted-foreground/70 disabled:cursor-not-allowed"
        />
        <div className="flex items-center gap-1 px-2 pb-2">
          <ContextLabel />
          <div className="ml-auto flex items-center gap-1">
            <ModelMenu />
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

/** What gets sent along: the selection and playhead, live (its own component: it changes during playback). */
function ContextLabel() {
  const label = useContextLabel();
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="min-w-0 truncate rounded-md px-1.5 py-0.5 text-[10.5px] text-muted-foreground tabular-nums">{label}</span>
      </TooltipTrigger>
      <TooltipContent side="top">Sent with your message, so “this clip” and “here” make sense</TooltipContent>
    </Tooltip>
  );
}

function useContextLabel(): string {
  const selected = useEditor((s) => s.selectedClipIds.length);
  const first = useEditor((s) => {
    const clip = s.project.clips.find((c) => c.id === s.selectedClipIds[0]);
    return clip ? (s.assets.find((a) => a.id === clip.assetId)?.name ?? "Text") : null;
  });
  // Rounded to tenths so it doesn't re-render every frame during playback.
  const tenth = usePlayback((s) => Math.round(s.time * 10));
  const t = tenth / 10;
  const time = `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, "0")}.${Math.round((t % 1) * 10)}`;
  if (selected === 0) return `Playhead ${time}`;
  return `${selected === 1 ? `“${first}”` : `${selected} clips`} · ${time}`;
}

function ModelMenu() {
  const model = useAssistant((s) => s.chat?.model ?? "default");
  const working = useAssistant((s) => s.chat?.status === "working");
  const current = ASSISTANT_MODELS.find((m) => m.id === model) ?? ASSISTANT_MODELS[0];
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="xs" disabled={working} className="h-7 gap-0.5 px-2 text-[11px] text-muted-foreground hover:text-foreground">
          {current.label}
          <PiCaretDown className="size-2.5" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" side="top" className="w-52">
        <DropdownMenuLabel className="text-[11px] font-normal text-muted-foreground">Model</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {ASSISTANT_MODELS.map((m) => (
          <DropdownMenuItem key={m.id} onSelect={() => useAssistant.getState().setModel(m.id)} className="gap-2">
            <span className="grid flex-1">
              <span className="text-[13px]">{m.label}</span>
              <span className="text-[11px] text-muted-foreground">{m.hint}</span>
            </span>
            {m.id === model && <PiCheck className="size-3.5 text-brand" />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
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
