import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  PiCheck,
  PiFilmStrip,
  PiGlobe,
  PiLinkBreak,
  PiMagnifyingGlass,
  PiMusicNotes,
  PiPauseFill,
  PiPlayFill,
  PiPlus,
  PiSealCheckFill,
  PiSpinnerGap,
  PiWarningCircle,
  PiXCircleFill,
} from "react-icons/pi";
import type { WebClip, WebMediaKind } from "@shared/types";
import { formatDuration } from "@shared/format";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { useEditor } from "@/stores/editor";
import { type WebPreview, useWebPreview } from "./use-web-preview";
import { useWebSearch } from "./use-web-search";

const KIND_KEY = "editor-online-kind";

const KINDS: { kind: WebMediaKind; label: string; icon: ReactNode }[] = [
  { kind: "audio", label: "Audio", icon: <PiMusicNotes /> },
  { kind: "video", label: "Video", icon: <PiFilmStrip /> },
];

const addedKey = (clip: WebClip, kind: WebMediaKind) => `${kind} ${clip.url}`;

/**
 * Search YouTube or paste a link (TikTok, Instagram, X...), preview the sound and
 * add either just the audio or the whole video to the timeline.
 */
export function OnlinePanel({ active }: { active: boolean }) {
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState<WebMediaKind>(() =>
    localStorage.getItem(KIND_KEY) === "video" ? "video" : "audio",
  );
  const search = useWebSearch(query);
  const preview = useWebPreview();
  const uploads = useEditor((s) => s.uploads);
  // Clips added from this panel (per project: the media bin remounts when switching).
  const [added, setAdded] = useState<ReadonlySet<string>>(new Set());
  const inputRef = useRef<HTMLInputElement>(null);

  const { stop } = preview;
  useEffect(() => {
    if (active) inputRef.current?.focus();
    else stop();
  }, [active, stop]);

  const chooseKind = (next: WebMediaKind) => {
    setKind(next);
    localStorage.setItem(KIND_KEY, next);
  };

  const add = async (clip: WebClip) => {
    if (await useEditor.getState().addWebMedia(clip, kind)) {
      setAdded((s) => new Set(s).add(addedKey(clip, kind)));
    }
  };

  const clips = search.status === "loading" || search.status === "done" ? search.clips : [];
  const loading = search.status === "loading";

  return (
    <div className={cn("flex min-h-0 flex-1 flex-col", !active && "hidden")}>
      <div className="flex shrink-0 flex-col gap-2 px-3 pt-3 pb-2">
        <div className="relative">
          <PiMagnifyingGlass className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            ref={inputRef}
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search YouTube or paste a link"
            aria-label="Search YouTube or paste a link"
            spellCheck={false}
            className="h-8 pr-8 pl-8 text-sm [&::-webkit-search-cancel-button]:hidden"
          />
          {loading ? (
            <PiSpinnerGap className="absolute top-1/2 right-2.5 size-3.5 -translate-y-1/2 animate-spin text-muted-foreground" />
          ) : (
            query && (
              <button
                type="button"
                onClick={() => {
                  setQuery("");
                  inputRef.current?.focus();
                }}
                className="absolute top-1/2 right-2 grid size-4 -translate-y-1/2 place-items-center text-muted-foreground/70 hover:text-foreground"
              >
                <PiXCircleFill className="size-4" />
                <span className="sr-only">Clear search</span>
              </button>
            )
          )}
        </div>
        <ToggleGroup
          type="single"
          size="sm"
          value={kind}
          onValueChange={(v) => v && chooseKind(v as WebMediaKind)}
          aria-label="What to add"
          className="grid w-full grid-cols-2 rounded-md bg-muted p-0.5"
        >
          {KINDS.map((k) => (
            <ToggleGroupItem
              key={k.kind}
              value={k.kind}
              className="h-6 min-w-0 gap-1.5 rounded-[5px]! text-xs text-muted-foreground hover:bg-transparent hover:text-foreground data-[state=on]:bg-background data-[state=on]:text-foreground data-[state=on]:shadow-xs! dark:data-[state=on]:bg-accent [&_svg]:size-3.5!"
            >
              {k.icon}
              {k.label}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </div>

      {search.status === "idle" && (
        <Hint icon={<PiGlobe className="size-5" />} title="Find music or clips">
          Search YouTube, or paste a link from YouTube, TikTok, Instagram, X and more.{" "}
          {kind === "audio"
            ? "Audio adds just the sound to an audio track."
            : "Video adds the whole clip to your main track."}
        </Hint>
      )}
      {search.status === "error" &&
        (search.link ? (
          <Hint icon={<PiLinkBreak className="size-5" />} title="Couldn't open that link">
            {search.message}
          </Hint>
        ) : (
          <Hint icon={<PiWarningCircle className="size-5" />} title="Search failed">
            {search.message}
          </Hint>
        ))}
      {search.status === "done" && clips.length === 0 && (
        <Hint icon={<PiMagnifyingGlass className="size-5" />} title="Nothing found">
          Nothing matched “{search.query}”. Try different words, or paste a link.
        </Hint>
      )}

      {clips.length > 0 && (
        <ScrollArea className="min-h-0 flex-1 [&_[data-slot=scroll-area-viewport]>div]:block!">
          <ul
            className={cn("flex flex-col gap-0.5 px-1.5 pb-2 transition-opacity", loading && "opacity-60")}
            aria-label="Results"
            aria-busy={loading}
          >
            {clips.map((clip) => (
              <ClipRow
                key={clip.url}
                clip={clip}
                kind={kind}
                preview={preview}
                adding={uploads.some((u) => u.download?.url === clip.url && u.download.kind === kind)}
                added={added.has(addedKey(clip, kind))}
                onAdd={() => void add(clip)}
              />
            ))}
          </ul>
        </ScrollArea>
      )}
    </div>
  );
}

interface ClipRowProps {
  clip: WebClip;
  kind: WebMediaKind;
  preview: WebPreview;
  adding: boolean;
  added: boolean;
  onAdd: () => void;
}

function ClipRow({ clip, kind, preview, adding, added, onAdd }: ClipRowProps) {
  const current = preview.url === clip.url;
  const status = current ? preview.status : null;
  const [thumbBroken, setThumbBroken] = useState(false);
  const what = kind === "audio" ? "audio" : "video";

  return (
    <li
      className={cn(
        "group flex min-w-0 items-center gap-2.5 rounded-md p-1.5 transition-colors hover:bg-accent/60",
        current && "bg-accent/60",
      )}
      data-url={clip.url}
    >
      <button
        type="button"
        onClick={() => preview.toggle(clip)}
        className="relative aspect-video w-16 shrink-0 overflow-hidden rounded bg-muted outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
      >
        {clip.thumbnail && !thumbBroken && (
          <img
            src={clip.thumbnail}
            alt=""
            loading="lazy"
            draggable={false}
            // Some sites refuse thumbnails hotlinked from other pages.
            referrerPolicy="no-referrer"
            className="size-full object-cover"
            onError={() => setThumbBroken(true)}
          />
        )}
        <span
          className={cn(
            "absolute inset-0 grid place-items-center bg-black/45 text-white transition-opacity",
            current ? "opacity-100" : "opacity-0 group-hover:opacity-100 group-focus-within:opacity-100",
          )}
        >
          {status === "loading" ? (
            <PiSpinnerGap className="size-4 animate-spin" />
          ) : status === "playing" ? (
            <PiPauseFill className="size-4" />
          ) : (
            <PiPlayFill className="size-4" />
          )}
        </span>
        <span className="sr-only">
          {status === "playing" ? "Pause" : "Listen to"} {clip.title}
        </span>
      </button>

      <div className="min-w-0 flex-1">
        <p
          className={cn("line-clamp-2 text-xs leading-4 font-medium", current && "text-brand")}
          title={clip.title}
        >
          {clip.title}
        </p>
        <p className="mt-0.5 flex min-w-0 items-center gap-1 text-[11px] leading-4 text-muted-foreground">
          {clip.site !== "YouTube" && clip.site !== clip.channel && (
            <span className="shrink-0 font-medium">{clip.site} ·</span>
          )}
          <span className="truncate">{clip.channel}</span>
          {clip.verified && (
            <PiSealCheckFill className="size-3 shrink-0 text-muted-foreground/80" aria-label="Verified" />
          )}
          {clip.duration > 0 && <span className="shrink-0 tabular-nums">· {formatDuration(clip.duration)}</span>}
        </p>
      </div>

      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            onClick={onAdd}
            disabled={adding}
            className={cn(
              "grid size-7 shrink-0 place-items-center rounded-md text-muted-foreground transition-colors outline-none",
              "hover:bg-background hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60",
              "disabled:pointer-events-none",
              added && "text-brand hover:text-brand",
            )}
          >
            {adding ? (
              <PiSpinnerGap className="size-4 animate-spin" />
            ) : added ? (
              <PiCheck className="size-4" />
            ) : (
              <PiPlus className="size-4" />
            )}
            <span className="sr-only">
              Add {what} of {clip.title} to timeline
            </span>
          </button>
        </TooltipTrigger>
        <TooltipContent side="right">
          {adding ? "Downloading…" : added ? `Added — click to add the ${what} again` : `Add ${what} to timeline`}
        </TooltipContent>
      </Tooltip>
    </li>
  );
}

function Hint({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-3 px-6 pt-10 text-center text-muted-foreground">
      <span className="grid size-11 place-items-center rounded-full bg-muted text-foreground/80">{icon}</span>
      <span className="space-y-1">
        <span className="block text-sm font-medium text-foreground">{title}</span>
        <span className="block text-xs leading-relaxed break-words">{children}</span>
      </span>
    </div>
  );
}
