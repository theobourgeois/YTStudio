import { type DragEvent, type KeyboardEvent, type PointerEvent as ReactPointerEvent, type ReactNode, useEffect, useRef, useState } from "react";
import { PiGlobe, PiLinkBreak, PiMagnifyingGlass, PiPauseFill, PiPlayFill, PiPlus, PiSealCheckFill, PiSpeakerHighFill, PiSpinnerGap, PiWarningCircle, PiX } from "react-icons/pi";
import { toast } from "sonner";
import { formatDuration } from "@shared/format";
import type { WebClip } from "@shared/types";
import { cn } from "cn";
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuShortcut, ContextMenuTrigger } from "@/components/ui/context-menu";
import { useEndOfList, useWebSearch } from "@/components/media/use-web-search";
import { useTransport } from "../transport";
import { openInNewChannels, samplerToSendTo, sendToSelectedChannel, togglePreview } from "./actions";
import { BROWSER_DRAG_TYPE, type BrowserDrag, setCarriedPaths } from "./drops";
import { rememberClips } from "./online";
import { useBrowser } from "./store";

/**
 * The Browser's Online tab (`docs/fl-studio/browser.md`, where YTStudio differs): search YouTube or paste a link
 * from any site yt-dlp reads, and use a clip's sound as any of the Browser's files: pressed, it plays (the
 * engine's preview, once it's downloaded; pressed again, it pauses, and again it goes on); dragged onto the rack, a channel or the Playlist, it comes into the
 * song. Kept mounted while the Files tab shows, so its results stay.
 */
export function OnlineTab({ shown }: { shown: boolean }) {
  const query = useBrowser((s) => s.onlineQuery);
  const search = useWebSearch(query);
  const clips = search.status === "loading" || search.status === "done" ? search.clips : [];
  const loading = search.status === "loading";
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);
  // Scrolled to its end, the list asks for YouTube's next page.
  const end = useEndOfList(search.loadMore, search.status === "done" && search.more && !search.loadingMore && !search.moreError, clips.length);

  useEffect(() => rememberClips(clips), [clips]);
  useEffect(() => {
    if (shown) input.current?.focus();
  }, [shown]);

  const choose = (clip: WebClip | undefined, play: boolean) => {
    if (!clip) return;
    useBrowser.getState().selectOnline(clip.url);
    if (play) useBrowser.getState().preview(clip.url);
  };
  const onListKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const store = useBrowser.getState();
    const at = clips.findIndex((c) => c.url === store.onlineSelected);
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const next = at < 0 ? 0 : Math.max(0, Math.min(clips.length - 1, at + (e.key === "ArrowDown" ? 1 : -1)));
      if (next !== at) choose(clips[next], true);
      list.current?.querySelector(`[data-index="${next}"]`)?.scrollIntoView({ block: "nearest" });
    } else if (e.key === "Enter" && at >= 0) {
      e.preventDefault();
      void sendToSelectedChannel(clips[at].url);
    } else if (e.key === "Escape") {
      e.preventDefault();
      if (store.previewing) store.stopPreview();
      else input.current?.focus();
    }
  };
  const onSearchKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if ((e.key === "ArrowDown" || e.key === "Enter") && clips.length) {
      e.preventDefault();
      choose(clips[0], true);
      list.current?.focus();
    } else if (e.key === "Escape" && query) {
      e.preventDefault();
      useBrowser.getState().setOnlineQuery("");
    }
  };

  return (
    <div className={cn("flex min-h-0 flex-1 flex-col", !shown && "hidden")} data-testid="browser-online">
      <div className="flex shrink-0 items-center gap-1.5 border-b border-line px-2 py-1.5">
        <div className="sunken flex h-6 min-w-0 flex-1 items-center gap-1.5 rounded-sm px-1.5">
          <PiMagnifyingGlass className="size-3.5 shrink-0 text-muted-foreground" />
          <input
            ref={input}
            type="search"
            value={query}
            placeholder="Search YouTube or paste a link"
            aria-label="Search YouTube or paste a link"
            spellCheck={false}
            className="min-w-0 flex-1 bg-transparent text-xs outline-none placeholder:text-muted-foreground [&::-webkit-search-cancel-button]:hidden"
            onChange={(e) => useBrowser.getState().setOnlineQuery(e.target.value)}
            onKeyDown={onSearchKey}
          />
          {loading ? (
            <PiSpinnerGap className="size-3 shrink-0 animate-spin text-muted-foreground" />
          ) : (
            query && (
              <button type="button" aria-label="Clear the search" className="text-muted-foreground hover:text-foreground" onClick={() => useBrowser.getState().setOnlineQuery("")}>
                <PiX className="size-3" />
              </button>
            )
          )}
        </div>
      </div>
      <div
        ref={list}
        role="listbox"
        aria-label="Online results"
        aria-busy={loading}
        tabIndex={0}
        className={cn("relative min-h-0 flex-1 overflow-y-auto py-0.5 text-xs outline-none transition-opacity", loading && clips.length > 0 && "opacity-60")}
        onKeyDown={onListKey}
      >
        {search.status === "idle" && (
          <Hint icon={<PiGlobe className="size-6" />}>
            Search YouTube, or paste a link from YouTube, SoundCloud, TikTok and more. Click a result to hear it, then drag it onto the rack or the Playlist.
          </Hint>
        )}
        {search.status === "error" && <Hint icon={search.link ? <PiLinkBreak className="size-6" /> : <PiWarningCircle className="size-6" />}>{search.message}</Hint>}
        {search.status === "done" && clips.length === 0 && <Hint icon={<PiMagnifyingGlass className="size-6" />}>Nothing matched “{search.query}”.</Hint>}
        {clips.map((clip, i) => (
          <OnlineRow key={clip.url} clip={clip} index={i} />
        ))}
        {search.status === "done" && (search.more || search.moreError) && (
          <div ref={end} className="flex h-8 items-center justify-center gap-1.5 text-[11px] text-muted-foreground" data-testid="online-more">
            {search.moreError ? (
              <>
                Couldn't load more.
                <button type="button" className="underline hover:text-foreground" onClick={search.loadMore}>
                  Try again
                </button>
              </>
            ) : (
              <>
                <PiSpinnerGap className="size-3 animate-spin" />
                Loading more…
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function Hint({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 px-6 pt-6 text-center text-muted-foreground">
      <span className="opacity-60">{icon}</span>
      <p className="text-xs leading-relaxed break-words">{children}</p>
    </div>
  );
}

function OnlineRow({ clip, index }: { clip: WebClip; index: number }) {
  const selected = useBrowser((s) => s.onlineSelected === clip.url);
  const previewId = useBrowser((s) => (s.previewing?.path === clip.url ? s.previewing.id : null));
  // Pressed, but the engine isn't playing it yet: its sound is still downloading.
  const waiting = useTransport((s) => previewId !== null && s.filePreview?.id !== previewId);
  const paused = useBrowser((s) => s.paused?.path === clip.url);
  const [thumbBroken, setThumbBroken] = useState(false);

  // A clip plays as it's pressed, as a file does (`RowView`); pressed while it plays, it pauses (a whole song
  // shouldn't play to its end to be stopped).
  const onPointerDown = (e: ReactPointerEvent) => {
    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || (e.target as HTMLElement).closest("button")) return;
    useBrowser.getState().selectOnline(clip.url);
    togglePreview(clip.url);
  };
  const onDragStart = (e: DragEvent) => {
    useBrowser.getState().selectOnline(clip.url);
    e.dataTransfer.setData(BROWSER_DRAG_TYPE, JSON.stringify({ paths: [clip.url] } satisfies BrowserDrag));
    e.dataTransfer.effectAllowed = "copy";
    setCarriedPaths([clip.url]);
  };

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          role="option"
          aria-label={clip.title}
          aria-selected={selected}
          data-index={index}
          data-url={clip.url}
          data-playing={(previewId !== null && !waiting) || undefined}
          title={`${clip.title}\n${clip.channel}${clip.duration > 0 ? ` · ${formatDuration(clip.duration)}` : ""}`}
          draggable
          onDragStart={onDragStart}
          onDragEnd={() => setCarriedPaths(null)}
          onPointerDown={onPointerDown}
          onClick={() => useBrowser.getState().selectOnline(clip.url)}
          // The middle button sends it to the selected channel, as a file's does.
          onAuxClick={(e) => {
            if (e.button !== 1) return;
            e.preventDefault();
            useBrowser.getState().selectOnline(clip.url);
            void sendToSelectedChannel(clip.url);
          }}
          onMouseDown={(e) => e.button === 1 && e.preventDefault()}
          onContextMenu={() => useBrowser.getState().selectOnline(clip.url)}
          className={cn("group flex h-10 cursor-pointer items-center gap-2 px-2", selected ? "bg-brand/20" : "hover:bg-surface-2")}
        >
          <span className="relative grid h-[27px] w-12 shrink-0 place-items-center overflow-hidden rounded-sm bg-sunken">
            {clip.thumbnail && !thumbBroken && (
              // Some sites refuse thumbnails hotlinked from other pages.
              <img src={clip.thumbnail} alt="" loading="lazy" draggable={false} referrerPolicy="no-referrer" className="size-full object-cover" onError={() => setThumbBroken(true)} />
            )}
            {/* What a press does: play, pause (over the speaker of the one playing), or wait for its download. */}
            <span
              className={cn(
                "absolute inset-0 grid place-items-center bg-black/50 text-white transition-opacity",
                previewId !== null || paused ? "opacity-100" : "opacity-0 group-hover:opacity-100",
              )}
            >
              {waiting ? (
                <PiSpinnerGap className="size-3.5 animate-spin" />
              ) : previewId !== null ? (
                <>
                  <PiSpeakerHighFill className="size-3.5 group-hover:hidden" />
                  <PiPauseFill className="hidden size-3.5 group-hover:block" />
                </>
              ) : (
                <PiPlayFill className="size-3.5" />
              )}
            </span>
          </span>
          <span className="flex min-w-0 flex-1 flex-col">
            <span className={cn("truncate leading-4", previewId !== null && "text-brand")}>{clip.title}</span>
            <span className="flex min-w-0 items-center gap-1 text-[10px] leading-3.5 text-muted-foreground">
              <span className="truncate">{clip.site !== "YouTube" && clip.site !== clip.channel ? `${clip.site} · ${clip.channel}` : clip.channel}</span>
              {clip.verified && <PiSealCheckFill className="size-2.5 shrink-0" aria-label="Verified" />}
              {clip.duration > 0 && <span className="shrink-0 tabular-nums">· {formatDuration(clip.duration)}</span>}
            </span>
          </span>
          <button
            type="button"
            tabIndex={-1}
            aria-label={`Open ${clip.title} in a new channel`}
            title="Open in a new channel"
            className="grid size-5 shrink-0 place-items-center rounded-sm text-muted-foreground opacity-0 group-hover:opacity-100 hover:bg-surface-3 hover:text-foreground"
            onClick={(e) => {
              e.stopPropagation();
              void openInNewChannels([clip.url]);
            }}
          >
            <PiPlus className="size-3.5" />
          </button>
        </div>
      </ContextMenuTrigger>
      <OnlineRowMenu clip={clip} />
    </ContextMenu>
  );
}

function OnlinePlayItem({ url }: { url: string }) {
  const playing = useBrowser((s) => s.previewing?.path === url);
  return (
    <ContextMenuItem onSelect={() => togglePreview(url)}>
      {playing ? "Pause" : "Play"}
      {playing && <ContextMenuShortcut>Space</ContextMenuShortcut>}
    </ContextMenuItem>
  );
}

function OnlineRowMenu({ clip }: { clip: WebClip }) {
  const target = samplerToSendTo();
  return (
    <ContextMenuContent className="min-w-56">
      <ContextMenuItem onSelect={() => void sendToSelectedChannel(clip.url)}>
        {target ? `Send to ${target.name}` : "Send to selected channel"} <ContextMenuShortcut>↵</ContextMenuShortcut>
      </ContextMenuItem>
      <ContextMenuItem onSelect={() => void openInNewChannels([clip.url])}>Open in new channel</ContextMenuItem>
      <OnlinePlayItem url={clip.url} />
      <ContextMenuSeparator />
      <ContextMenuItem
        onSelect={() =>
          void navigator.clipboard.writeText(clip.url).then(
            () => toast("Link copied"),
            () => toast.error("Couldn't copy the link"),
          )
        }
      >
        Copy link
      </ContextMenuItem>
    </ContextMenuContent>
  );
}
