import { useState } from "react";
import { PiCaretDown, PiCheck, PiCopy, PiPlus, PiTrash } from "react-icons/pi";
import { cn } from "cn";
import { createId } from "@shared/ids";
import { addPattern, clonePattern, removePattern, renamePattern } from "@shared/music/edits";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useCurrentPattern, useMusic, useSong } from "./store";

/** The pattern selector (FL Studio's): which pattern the rack shows and the engine loops, and + for a new one. */
export function PatternPicker() {
  const patterns = useSong((song) => song.patterns);
  const current = useCurrentPattern((pattern) => pattern);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(current.name);
  const { commit, selectPattern } = useMusic.getState();

  /** Make a pattern with `edit` and show it. */
  const make = (edit: (id: string) => Parameters<typeof commit>[0]) => {
    const id = createId("pat");
    commit(edit(id));
    selectPattern(id);
  };

  return (
    <div className="flex w-full items-center gap-1.5">
      <Popover
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (next) setName(current.name);
        }}
      >
        {/* FL Studio's: the name in a recessed box, the list under it. */}
        <PopoverTrigger asChild>
          <button
            type="button"
            className="sunken flex h-7 min-w-0 flex-1 items-center justify-between gap-1 rounded-sm pr-1.5 pl-2 text-left text-[13px] outline-none hover:border-brand/60 focus-visible:ring-2 focus-visible:ring-ring/60"
            aria-label="Pattern"
            title="Pattern: which one the rack shows and play loops"
          >
            <span className="truncate">{current.name}</span>
            <PiCaretDown className="size-3.5 shrink-0 text-muted-foreground" />
          </button>
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
            <Button variant="ghost" size="sm" className="flex-1" onClick={() => make((id) => (song) => addPattern(song, { id }))}>
              <PiPlus />
              New
            </Button>
            <Button variant="ghost" size="sm" className="flex-1" onClick={() => make((id) => (song) => clonePattern(song, current.id, id))}>
              <PiCopy />
              Clone
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="flex-1"
              disabled={patterns.length <= 1}
              onClick={() => commit((song) => removePattern(song, current.id))}
            >
              <PiTrash />
              Delete
            </Button>
          </div>
        </PopoverContent>
      </Popover>
      <Button variant="outline" size="icon-xs" className="size-7 [&_svg:not([class*=size-])]:size-4" aria-label="New pattern" title="New pattern" onClick={() => make((id) => (song) => addPattern(song, { id }))}>
        <PiPlus />
      </Button>
    </div>
  );
}
