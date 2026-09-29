/**
 * The transitions library (a tab of the left panel), like CapCut's
 * Transitions or Premiere's Video Transitions: search, filter by tag, hover a
 * card to watch it play, then drag it onto a cut or clip edge, double-click it
 * or press + to put it on the edit point nearest the playhead.
 */
import { type DragEvent, useEffect, useMemo, useRef, useState } from "react";
import { PiMagnifyingGlass, PiPlus, PiXCircleFill } from "react-icons/pi";
import {
  TAG_LABELS,
  TRANSITIONS,
  TRANSITION_TAGS,
  type TransitionDefinition,
  type TransitionTag,
} from "@shared/transitions";
import { getClip } from "@shared/timeline";
import { storedTransition } from "@shared/transition-windows";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { setTransitionDragData } from "@/lib/dnd";
import { cn } from "cn";
import { useEditor } from "@/stores/editor";
import { THUMB_HEIGHT, THUMB_WIDTH, drawThumbnail } from "./thumbnails";

type Filter = TransitionTag | "all";

/** Tags that some transition has, in display order. */
const TAGS = TRANSITION_TAGS.filter((tag) => TRANSITIONS.some((d) => d.tags.includes(tag)));

export function filterTransitions(query: string, filter: Filter): TransitionDefinition[] {
  const q = query.trim().toLowerCase();
  return TRANSITIONS.filter(
    (d) =>
      (filter === "all" || d.tags.includes(filter)) &&
      (!q || d.label.toLowerCase().includes(q) || d.tags.some((t) => TAG_LABELS[t].toLowerCase().startsWith(q))),
  );
}

export function TransitionsPanel() {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const inputRef = useRef<HTMLInputElement>(null);
  const visible = useMemo(() => filterTransitions(query, filter), [query, filter]);
  // The selected transition's type, highlighted in the grid.
  const selectedType = useEditor((s) => {
    const ref = s.selectedTransition;
    const clip = ref && getClip(s.project, ref.clipId);
    return (clip && storedTransition(clip, ref.edge)?.type) ?? null;
  });

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 flex-col gap-2 px-3 pt-3 pb-2">
        <div className="relative">
          <PiMagnifyingGlass className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            ref={inputRef}
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search transitions"
            aria-label="Search transitions"
            spellCheck={false}
            className="h-8 pr-8 pl-8 text-sm [&::-webkit-search-cancel-button]:hidden"
          />
          {query && (
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
          )}
        </div>
        <div role="radiogroup" aria-label="Filter by tag" className="flex flex-wrap gap-1">
          {(["all", ...TAGS] as const).map((tag) => (
            <TagChip key={tag} active={filter === tag} onClick={() => setFilter(tag)}>
              {tag === "all" ? "All" : TAG_LABELS[tag]}
            </TagChip>
          ))}
        </div>
      </div>

      {/* Radix wraps content in a `display: table` div, which defeats `truncate`. */}
      <ScrollArea className="min-h-0 flex-1 [&_[data-slot=scroll-area-viewport]>div]:block!">
        <div className="grid grid-cols-3 gap-x-0.5 gap-y-1 px-2 pb-2">
          {visible.map((def) => (
            <TransitionCard key={def.type} def={def} selected={def.type === selectedType} />
          ))}
        </div>
        {visible.length === 0 && (
          <p className="px-4 py-8 text-center text-xs text-muted-foreground">No transitions match “{query}”.</p>
        )}
      </ScrollArea>
      <p className="shrink-0 border-t px-3 py-2 text-[11px] leading-relaxed text-muted-foreground">
        Drag onto a cut or a clip’s edge, or press <PiPlus className="inline size-3 align-[-2px]" /> to add at the cut
        nearest the playhead.
      </p>
    </div>
  );
}

function TagChip({ active, onClick, children }: { active: boolean; onClick: () => void; children: string }) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={active}
      onClick={onClick}
      className={cn(
        "h-6 rounded-full border px-2.5 text-xs transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
        active
          ? "border-transparent bg-foreground text-background"
          : "text-muted-foreground hover:border-foreground/25 hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}

/** Progress shown while the card isn't hovered. */
const POSTER_PROGRESS = 0.36;
/** One loop of the hover animation: the transition, then a pause on each side. */
const LOOP_MS = 1800;

const overlayButton =
  "grid size-5 place-items-center rounded-md bg-black/55 text-white backdrop-blur-sm transition-colors hover:bg-black/75 focus-visible:ring-2 focus-visible:ring-white/70 focus-visible:outline-none";

function TransitionCard({ def, selected }: { def: TransitionDefinition; selected: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [hovered, setHovered] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    if (!hovered) {
      void drawThumbnail(def, POSTER_PROGRESS, canvas);
      return;
    }
    let raf = 0;
    const started = performance.now();
    const tick = (now: number) => {
      // 0..1 over 70% of the loop, holding the ends in between.
      const phase = ((now - started) % LOOP_MS) / LOOP_MS;
      const progress = Math.min(1, Math.max(0, (phase - 0.15) / 0.7));
      void drawThumbnail(def, progress, canvas);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [def, hovered]);

  const apply = () => useEditor.getState().applyTransition(def.type);
  const onDragStart = (e: DragEvent) => {
    setTransitionDragData(e.dataTransfer, def.type);
    const canvas = canvasRef.current;
    if (canvas) e.dataTransfer.setDragImage(canvas, THUMB_WIDTH / 2, THUMB_HEIGHT / 2);
  };

  return (
    <div
      data-transition-type={def.type}
      className="group relative flex min-w-0 cursor-grab flex-col gap-1 rounded-lg p-1 outline-none focus-visible:ring-2 focus-visible:ring-ring/60 active:cursor-grabbing"
      draggable
      tabIndex={0}
      title={def.label}
      onDragStart={onDragStart}
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
      onFocus={() => setHovered(true)}
      onBlur={() => setHovered(false)}
      onDoubleClick={apply}
      onKeyDown={(e) => {
        if (e.key === "Enter" && e.target === e.currentTarget) apply();
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
      <span className="truncate px-0.5 text-[11px] text-foreground/90">{def.label}</span>
      <div
        className="absolute top-1.5 right-1.5 opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100"
        onDoubleClick={(e) => e.stopPropagation()}
      >
        <Tooltip>
          <TooltipTrigger asChild>
            <button type="button" className={overlayButton} onClick={apply}>
              <PiPlus className="size-3" />
              <span className="sr-only">Add {def.label}</span>
            </button>
          </TooltipTrigger>
          <TooltipContent side="bottom">Add at the nearest cut</TooltipContent>
        </Tooltip>
      </div>
    </div>
  );
}
