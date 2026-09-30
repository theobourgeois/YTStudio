import { useRef, useState } from "react";
import { PiCaretRightFill, PiCheck, PiCopy, PiPlus, PiTrash } from "react-icons/pi";
import { cn } from "cn";
import { createId } from "@shared/ids";
import { addPattern, clonePattern, nextPatternName, removePattern, renamePattern } from "@shared/music/edits";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { startPointerDrag } from "@/lib/pointer-drag";
import { useCurrentPattern, useMusic, useSong } from "./store";

/** Pixels of drag, or of a trackpad's scrolling, for a step to the next pattern. */
const DRAG_STEP = 16;
const WHEEL_STEP = 40;

/**
 * The pattern selector (FL Studio's): which pattern the rack shows and the engine loops. The arrow at
 * its left opens the list (rename, clone, delete); the name is scrolled or dragged up and down to go
 * through the patterns, and past the last one to the next, empty, which joins the song once something
 * is put in it (`patterns.ts`); + names a new pattern and shows it.
 */
export function PatternPicker() {
  const current = useCurrentPattern((pattern) => pattern);
  const isDraft = useMusic((s) => !!s.draftPattern && s.draftPattern.id === s.patternId && !s.history!.doc.patterns.some((p) => p.id === s.patternId));
  const index = useMusic((s) => s.history!.doc.patterns.findIndex((p) => p.id === current.id));
  const wheel = useRef(0);

  return (
    <div className="flex w-full items-center gap-1">
      <PatternList />
      <div
        role="spinbutton"
        tabIndex={0}
        aria-label="Pattern"
        aria-valuetext={current.name}
        aria-valuenow={index < 0 ? undefined : index + 1}
        title="Pattern: scroll or drag up and down to change it (past the last, a new one)"
        className="sunken flex h-7 min-w-0 flex-1 cursor-ns-resize touch-none items-center rounded-sm px-2 text-[13px] outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
        onWheel={(e) => {
          // A mouse wheel's notch is a step; a trackpad's small deltas add up to one.
          if (Math.abs(e.deltaY) >= WHEEL_STEP) {
            wheel.current = 0;
            return useMusic.getState().stepPattern(e.deltaY < 0 ? 1 : -1);
          }
          wheel.current += e.deltaY;
          if (Math.abs(wheel.current) < WHEEL_STEP) return;
          useMusic.getState().stepPattern(wheel.current < 0 ? 1 : -1);
          wheel.current = 0;
        }}
        onPointerDown={(e) => {
          if (e.button !== 0) return;
          e.currentTarget.focus();
          let steps = 0;
          const origin = e.clientY;
          startPointerDrag(e, {
            threshold: 3,
            cursor: "ns-resize",
            onMove(ev) {
              const want = Math.trunc((origin - ev.clientY) / DRAG_STEP);
              for (; steps < want; steps++) useMusic.getState().stepPattern(1);
              for (; steps > want; steps--) useMusic.getState().stepPattern(-1);
            },
          });
        }}
        onKeyDown={(e) => {
          if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
          e.preventDefault();
          e.stopPropagation();
          useMusic.getState().stepPattern(e.key === "ArrowUp" ? 1 : -1);
        }}
      >
        <span className={cn("truncate", isDraft && "text-muted-foreground")}>{current.name}</span>
      </div>
      <NewPattern />
    </div>
  );
}

/** The arrow at the selector's left: the song's patterns, to pick one, rename, clone or delete it. */
function PatternList() {
  const patterns = useSong((song) => song.patterns);
  const current = useCurrentPattern((pattern) => pattern);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(current.name);
  const { commit, selectPattern } = useMusic.getState();

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) setName(current.name);
      }}
    >
      <PopoverTrigger asChild>
        <Button variant="outline" size="icon-xs" className="size-7 text-muted-foreground hover:text-foreground" aria-label="Patterns" title="The patterns: pick, rename, clone or delete one">
          <PiCaretRightFill className={cn("size-3 transition-transform", open && "rotate-90")} />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64 p-2">
        <Input
          aria-label="Pattern name"
          value={name}
          className="mb-2 h-8"
          onChange={(e) => setName(e.target.value)}
          onBlur={() => commit((song) => renamePattern(song, current.id, name))}
          onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
        />
        <div className="flex max-h-60 flex-col overflow-y-auto" role="listbox" aria-label="Patterns">
          {patterns.map((pattern) => (
            <button
              key={pattern.id}
              type="button"
              role="option"
              aria-selected={pattern.id === current.id}
              className={cn("flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] hover:bg-accent", pattern.id === current.id && "font-medium")}
              onClick={() => {
                selectPattern(pattern.id);
                setName(pattern.name);
              }}
            >
              <PiCheck className={cn("size-3.5", pattern.id !== current.id && "invisible")} />
              <span className="truncate">{pattern.name}</span>
            </button>
          ))}
        </div>
        <div className="mt-2 flex gap-1 border-t pt-2">
          <Button
            variant="ghost"
            size="sm"
            className="flex-1"
            onClick={() => {
              const id = createId("pat");
              commit((song) => clonePattern(song, current.id, id));
              selectPattern(id);
            }}
          >
            <PiCopy />
            Clone
          </Button>
          <Button variant="ghost" size="sm" className="flex-1" disabled={patterns.length <= 1 || !patterns.includes(current)} onClick={() => commit((song) => removePattern(song, current.id))}>
            <PiTrash />
            Delete
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

/** +: name a new pattern (Enter), and it's made and shown. */
function NewPattern() {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const create = () => {
    const id = createId("pat");
    const { commit, selectPattern } = useMusic.getState();
    commit((song) => addPattern(song, { id, name }));
    selectPattern(id);
    setOpen(false);
  };
  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) setName(nextPatternName(useMusic.getState().history!.doc));
      }}
    >
      <PopoverTrigger asChild>
        <Button variant="outline" size="icon-xs" className="size-7 [&_svg:not([class*=size-])]:size-4" aria-label="New pattern" title="New pattern">
          <PiPlus />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-60 p-2">
        <form
          className="flex gap-1.5"
          onSubmit={(e) => {
            e.preventDefault();
            create();
          }}
        >
          <Input autoFocus aria-label="New pattern's name" value={name} className="h-8" onFocus={(e) => e.currentTarget.select()} onChange={(e) => setName(e.target.value)} />
          <Button type="submit" size="sm" className="h-8">
            Create
          </Button>
        </form>
      </PopoverContent>
    </Popover>
  );
}
