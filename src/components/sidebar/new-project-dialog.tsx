import { type KeyboardEvent, useMemo, useState } from "react";
import { PiArrowDown, PiArrowUp, PiMagnifyingGlass } from "react-icons/pi";
import { SUITES, SUITE_IDS, type SuiteId } from "@shared/suites";
import { cn } from "cn";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { useLayout } from "@/stores/layout";
import { useProjects } from "@/stores/projects";
import { clientSuite } from "@/suites";

const MOD = navigator.platform.toLowerCase().includes("mac") ? "⌘" : "Ctrl+";

/** Start a project in one of the suites: a command palette (arrows + Enter, or ⌘1, ⌘2…). */
export function NewProjectDialog() {
  const open = useLayout((s) => s.newProjectOpen);
  return (
    <Dialog open={open} onOpenChange={(next) => useLayout.getState().setNewProjectOpen(next)}>
      <DialogContent showCloseButton={false} className="top-[22%] translate-y-0 gap-0 overflow-hidden p-0 sm:max-w-xl">
        {/* Remounted on each open, so it starts with an empty search and the first suite. */}
        {open && <Picker />}
      </DialogContent>
    </Dialog>
  );
}

function Picker() {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const suites = useMemo(() => {
    const q = query.trim().toLowerCase();
    return SUITE_IDS.filter((id) => {
      const { label, noun, description } = SUITES[id];
      return !q || [label, noun, description].some((text) => text.toLowerCase().includes(q));
    });
  }, [query]);

  const pick = (suite: SuiteId | undefined) => {
    if (!suite) return;
    useLayout.getState().setNewProjectOpen(false);
    void useProjects.getState().create({ suite });
  };

  const onKeyDown = (e: KeyboardEvent) => {
    const digit = /^Digit([1-9])$/.exec(e.code);
    if (digit && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      pick(SUITE_IDS[Number(digit[1]) - 1]);
    } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const step = e.key === "ArrowDown" ? 1 : -1;
      if (suites.length) setActive((i) => (Math.min(i, suites.length - 1) + step + suites.length) % suites.length);
    } else if (e.key === "Enter" && !e.nativeEvent.isComposing) {
      e.preventDefault();
      pick(suites[Math.min(active, suites.length - 1)]);
    }
  };

  const current = Math.min(active, suites.length - 1);
  return (
    <div onKeyDown={onKeyDown}>
      <DialogTitle className="sr-only">New project</DialogTitle>
      <DialogDescription className="sr-only">Pick what to make.</DialogDescription>
      <label className="flex h-14 items-center gap-3 border-b px-4.5 text-muted-foreground">
        <PiMagnifyingGlass className="size-4.5 shrink-0" />
        <input
          autoFocus
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setActive(0);
          }}
          placeholder="What do you want to make?"
          aria-label="Search project types"
          aria-controls="new-project-options"
          aria-activedescendant={suites[current] ? `new-project-${suites[current]}` : undefined}
          className="min-w-0 flex-1 bg-transparent text-[15px] text-foreground outline-none placeholder:text-muted-foreground"
        />
      </label>

      <div className="px-2 pt-3 pb-2">
        <p className="px-2.5 pb-1.5 text-xs font-medium text-muted-foreground">New project</p>
        <div id="new-project-options" role="listbox" aria-label="Project types" className="flex flex-col gap-0.5">
          {suites.map((id, i) => (
            <SuiteOption key={id} suite={id} index={SUITE_IDS.indexOf(id)} active={i === current} onHover={() => setActive(i)} onPick={() => pick(id)} />
          ))}
          {suites.length === 0 && <p className="px-2.5 py-6 text-center text-[13px] text-muted-foreground">Nothing matches.</p>}
        </div>
      </div>

      <div className="flex items-center gap-4 border-t bg-muted/30 px-4 py-2.5 text-xs text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <Key>
            <PiArrowUp className="size-3" />
          </Key>
          <Key>
            <PiArrowDown className="size-3" />
          </Key>
          Navigate
        </span>
        <span className="flex items-center gap-1.5">
          <Key>Enter</Key>
          Create
        </span>
        <span className="flex items-center gap-1.5">
          <Key>Esc</Key>
          Close
        </span>
      </div>
    </div>
  );
}

function SuiteOption({ suite, index, active, onHover, onPick }: { suite: SuiteId; index: number; active: boolean; onHover: () => void; onPick: () => void }) {
  const { label, description, early } = SUITES[suite];
  const { icon: Icon, tint } = clientSuite(suite);
  return (
    <div
      id={`new-project-${suite}`}
      role="option"
      aria-selected={active}
      data-suite={suite}
      onPointerMove={onHover}
      onClick={onPick}
      className={cn("flex cursor-pointer items-center gap-3 rounded-lg px-2.5 py-2.5 transition-colors", active && "bg-accent")}
    >
      <span className={cn("grid size-9 shrink-0 place-items-center rounded-lg", tint)}>
        <Icon className="size-4.5" />
      </span>
      <span className="grid min-w-0 flex-1">
        <span className="flex items-center gap-2 text-sm font-medium">
          {label}
          {early && <span className="rounded-md border px-1.5 text-[10px] leading-4 font-medium text-muted-foreground">Early</span>}
        </span>
        <span className="truncate text-xs leading-5 text-muted-foreground">{description}</span>
      </span>
      {index < 9 && (
        <kbd className="shrink-0 font-sans text-xs text-muted-foreground tabular-nums">
          {MOD}
          {index + 1}
        </kbd>
      )}
    </div>
  );
}

function Key({ children }: { children: React.ReactNode }) {
  return <kbd className="grid h-5 min-w-5 place-items-center rounded border bg-background px-1 font-sans text-[11px] leading-none">{children}</kbd>;
}
