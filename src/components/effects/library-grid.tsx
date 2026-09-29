/**
 * What the Effects tab's kinds share, like CapCut's libraries: a search box and
 * category chips over a grid of cards that play when hovered and apply on
 * double-click, + or a drag.
 */
import { type DragEvent, type ReactNode, useEffect, useRef, useState } from "react";
import { PiMagnifyingGlass, PiPlus, PiXCircleFill } from "react-icons/pi";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { TagChip } from "@/components/ui/tag-chip";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "cn";
import { THUMB_HEIGHT, THUMB_WIDTH, type Thumb, requestPoster } from "./thumbnails";

/** Items whose label (or a tag's label) matches the search, in the chosen category. */
export function filterLibrary<T extends { label: string; tags: readonly Tag[] }, Tag extends string>(
  items: readonly T[],
  labels: Record<Tag, string>,
  query: string,
  filter: Tag | "all",
): T[] {
  const q = query.trim().toLowerCase();
  return items.filter(
    (d) =>
      (filter === "all" || d.tags.includes(filter)) &&
      (!q || d.label.toLowerCase().includes(q) || d.tags.some((t) => labels[t].toLowerCase().startsWith(q))),
  );
}

export function LibraryGrid<Tag extends string>({
  search,
  tags,
  labels,
  query,
  onQuery,
  filter,
  onFilter,
  count,
  children,
}: {
  /** What's searched, e.g. "transitions". */
  search: string;
  /** Categories some item has, in order. */
  tags: readonly Tag[];
  labels: Record<Tag, string>;
  query: string;
  onQuery: (query: string) => void;
  filter: Tag | "all";
  onFilter: (filter: Tag | "all") => void;
  /** Cards shown. */
  count: number;
  children: ReactNode;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const label = `Search ${search}`;
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 flex-col gap-2 px-3 pt-3 pb-2">
        <div className="relative">
          <PiMagnifyingGlass className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            ref={inputRef}
            type="search"
            value={query}
            onChange={(e) => onQuery(e.target.value)}
            placeholder={label}
            aria-label={label}
            spellCheck={false}
            className="h-8 pr-8 pl-8 text-sm [&::-webkit-search-cancel-button]:hidden"
          />
          {query && (
            <button
              type="button"
              onClick={() => {
                onQuery("");
                inputRef.current?.focus();
              }}
              className="absolute top-1/2 right-2 grid size-4 -translate-y-1/2 place-items-center text-muted-foreground/70 hover:text-foreground"
            >
              <PiXCircleFill className="size-4" />
              <span className="sr-only">Clear search</span>
            </button>
          )}
        </div>
        <div role="radiogroup" aria-label="Filter by tag" className="flex flex-wrap gap-1">
          {(["all", ...tags] as const).map((tag) => (
            <TagChip key={tag} active={filter === tag} onClick={() => onFilter(tag)}>
              {tag === "all" ? "All" : labels[tag]}
            </TagChip>
          ))}
        </div>
      </div>

      {/* Radix wraps content in a `display: table` div, which defeats `truncate`. */}
      <ScrollArea className="min-h-0 flex-1 [&_[data-slot=scroll-area-viewport]>div]:block!">
        {/* As many columns as fit, so a wider panel shows more cards rather than bigger ones. */}
        <div className="grid grid-cols-[repeat(auto-fill,minmax(6.25rem,1fr))] gap-x-0.5 gap-y-1 px-2 pb-2">{children}</div>
        {count === 0 && (
          <p className="px-4 py-8 text-center text-xs text-muted-foreground">No {search} match “{query}”.</p>
        )}
      </ScrollArea>
    </div>
  );
}

const overlayButton =
  "grid size-5 place-items-center rounded-md bg-black/55 text-white backdrop-blur-sm transition-colors hover:bg-black/75 focus-visible:ring-2 focus-visible:ring-white/70 focus-visible:outline-none";

/**
 * One card: its poster, and while hovered (or focused) `play` draws it every
 * frame, `elapsed` ms since the hover began.
 */
export function LibraryCard({
  thumb,
  label,
  selected = false,
  play,
  onApply,
  applyHint,
  onDragStart,
  data,
}: {
  thumb: Thumb;
  label: string;
  selected?: boolean;
  play: (canvas: HTMLCanvasElement, elapsed: number) => void;
  onApply: () => void;
  /** What + does, as its tooltip. */
  applyHint: string;
  /** Sets the drag's data (the card's picture is the drag image). */
  onDragStart: (dt: DataTransfer) => void;
  /** Data attributes identifying the card. */
  data: Record<`data-${string}`, string>;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [hovered, setHovered] = useState(false);
  const playRef = useRef(play);
  playRef.current = play;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    if (!hovered) return requestPoster(thumb, canvas);
    let raf = 0;
    const started = performance.now();
    const tick = (now: number) => {
      playRef.current(canvas, now - started);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [thumb, hovered]);

  const dragStart = (e: DragEvent) => {
    onDragStart(e.dataTransfer);
    const canvas = canvasRef.current;
    if (canvas) e.dataTransfer.setDragImage(canvas, THUMB_WIDTH / 2, THUMB_HEIGHT / 2);
  };

  return (
    <div
      {...data}
      className="group relative flex min-w-0 cursor-grab flex-col gap-1 rounded-lg p-1 outline-none focus-visible:ring-2 focus-visible:ring-ring/60 active:cursor-grabbing"
      draggable
      tabIndex={0}
      title={label}
      onDragStart={dragStart}
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
      onFocus={() => setHovered(true)}
      onBlur={() => setHovered(false)}
      onDoubleClick={onApply}
      onKeyDown={(e) => {
        if (e.key === "Enter" && e.target === e.currentTarget) onApply();
      }}
    >
      <div
        className={cn(
          "relative aspect-[3/2] overflow-hidden rounded-md bg-black ring-1 ring-border ring-inset",
          selected && "ring-2 ring-brand",
        )}
      >
        <canvas ref={canvasRef} className="size-full" />
      </div>
      <span className="truncate px-0.5 text-[11px] text-foreground/90">{label}</span>
      <div
        className="absolute top-1.5 right-1.5 opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100"
        onDoubleClick={(e) => e.stopPropagation()}
      >
        <Tooltip>
          <TooltipTrigger asChild>
            <button type="button" className={overlayButton} onClick={onApply}>
              <PiPlus className="size-3" />
              <span className="sr-only">Add {label}</span>
            </button>
          </TooltipTrigger>
          <TooltipContent side="bottom">{applyHint}</TooltipContent>
        </Tooltip>
      </div>
    </div>
  );
}
