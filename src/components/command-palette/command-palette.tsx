import { type KeyboardEvent, type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { PiArrowDown, PiArrowUp, PiCheck, PiCommand } from "react-icons/pi";
import { create } from "zustand";
import { cn } from "cn";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { useMainWindowDialog } from "@/components/windows/native/popups";
import { type Rankable, rankItems, remember } from "@/lib/fuzzy";
import { keyLabel } from "@/lib/key-labels";

/** Something the palette runs: a menu item, a key, a window to open, a channel to go to. */
export interface Command extends Rankable {
  /** Its keys as a Mac names them ("⇧⌘P", "F7"): shown on its row, as Windows names them there. */
  keys?: string;
  /** It can't run now (nothing selected...): listed, dimmed, and Enter does nothing. */
  disabled?: boolean;
  /** A switch that's on (Step edit, the typing keyboard): ticked. */
  checked?: boolean;
  /** Listed first with nothing typed (after the recent ones): what the window in front does. */
  preferred?: boolean;
  run: () => void;
}

/** Whether the palette is open. A suite's keys open it (⇧⌘P); it closes itself. */
export const useCommandPalette = create<{ open: boolean; setOpen: (open: boolean) => void }>((set) => ({
  open: false,
  setOpen: (open) => set({ open }),
}));

/** The most shown at once. */
const MOST = 60;

interface CommandPaletteProps {
  /** The commands, as things are when it opens (called then, not on every render). */
  commands: () => Command[];
  /** Where its recently run commands are kept (localStorage), one list per suite. */
  storageKey: string;
  placeholder?: string;
}

/**
 * The command palette (VS Code's ⇧⌘P): everything a suite can do, found by typing a few letters of it
 * and run with Enter, its keys shown beside it so they're learnt. The keyboard's way to whatever has no
 * key of its own, or one not yet remembered.
 */
export function CommandPalette({ commands, storageKey, placeholder = "Type a command…" }: CommandPaletteProps) {
  const open = useCommandPalette((s) => s.open);
  // A command ran: it says where the focus goes (a window it opened), so it isn't given back to what had it.
  const ran = useRef(false);
  // Over the editor's windows when they're the system's.
  const { container, ready } = useMainWindowDialog(open);
  return (
    <Dialog open={open && ready} modal={!container} onOpenChange={(next) => useCommandPalette.getState().setOpen(next)}>
      <DialogContent
        container={container}
        showCloseButton={false}
        className="top-[16%] translate-y-0 gap-0 overflow-hidden p-0 sm:max-w-xl"
        data-command-palette
        // The search box focuses itself (`useMainWindowDialog`).
        onOpenAutoFocus={(e) => e.preventDefault()}
        onCloseAutoFocus={(e) => {
          if (!ran.current) return;
          ran.current = false;
          e.preventDefault();
        }}
      >
        {/* Remounted on each open: an empty search, the commands as things are now. */}
        {open && ready && <Palette commands={commands} storageKey={storageKey} placeholder={placeholder} onRun={() => (ran.current = true)} />}
      </DialogContent>
    </Dialog>
  );
}

function readRecent(key: string): string[] {
  try {
    const value = JSON.parse(localStorage.getItem(key) ?? "[]") as unknown;
    return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
  } catch {
    return [];
  }
}

function Palette({ commands, storageKey, placeholder, onRun }: Required<CommandPaletteProps> & { onRun: () => void }) {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const all = useMemo(commands, [commands]);
  const recent = useMemo(() => readRecent(storageKey), [storageKey]);
  const found = useMemo(() => rankItems(all, query, recent, (c) => !!c.preferred).slice(0, MOST), [all, query, recent]);
  const list = useRef<HTMLDivElement>(null);
  const current = Math.min(active, found.length - 1);

  useEffect(() => {
    list.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: "nearest" });
  }, [current]);

  const run = (command: Command | undefined) => {
    if (!command || command.disabled) return;
    localStorage.setItem(storageKey, JSON.stringify(remember(recent, command.id)));
    onRun();
    useCommandPalette.getState().setOpen(false);
    // Once the palette has let go of the keyboard: a command that opens a dialog or focuses a window keeps it.
    setTimeout(command.run, 0);
  };

  const onKeyDown = (e: KeyboardEvent) => {
    const step = e.key === "ArrowDown" ? 1 : e.key === "ArrowUp" ? -1 : e.key === "PageDown" ? 8 : e.key === "PageUp" ? -8 : 0;
    if (step) {
      e.preventDefault();
      if (!found.length) return;
      const from = Math.min(active, found.length - 1);
      setActive(Math.abs(step) === 1 ? (from + step + found.length) % found.length : Math.max(0, Math.min(found.length - 1, from + step)));
    } else if (e.key === "Enter" && !e.nativeEvent.isComposing) {
      e.preventDefault();
      run(found[current]?.item);
    }
    // The editor's own keys don't see what's typed here.
    e.stopPropagation();
  };

  return (
    <div onKeyDown={onKeyDown}>
      <DialogTitle className="sr-only">Commands</DialogTitle>
      <DialogDescription className="sr-only">Type what to do, then Enter to do it.</DialogDescription>
      <label className="flex h-12 items-center gap-3 border-b px-4 text-muted-foreground">
        <PiCommand className="size-4.5 shrink-0" />
        <input
          autoFocus
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setActive(0);
          }}
          placeholder={placeholder}
          aria-label="Command"
          aria-controls="command-palette-results"
          aria-activedescendant={found[current] ? `command-${found[current].item.id}` : undefined}
          className="min-w-0 flex-1 bg-transparent text-[15px] text-foreground outline-none placeholder:text-muted-foreground"
        />
      </label>

      <div ref={list} id="command-palette-results" role="listbox" aria-label="Commands" className="flex max-h-[min(26rem,60vh)] flex-col overflow-y-auto px-1.5 py-1.5">
        {found.map(({ item, indexes }, i) => (
          <div
            key={item.id}
            id={`command-${item.id}`}
            role="option"
            aria-selected={i === current}
            aria-disabled={item.disabled || undefined}
            aria-label={item.title}
            onPointerMove={() => setActive(i)}
            onClick={() => run(item)}
            className={cn("flex h-8 shrink-0 cursor-pointer items-center gap-2 rounded-md px-2.5 text-[13px]", i === current && "bg-accent", item.disabled && "opacity-45")}
          >
            <span className="grid size-3.5 shrink-0 place-items-center">{item.checked && <PiCheck className="size-3.5 text-brand" />}</span>
            {item.group && <span className="shrink-0 text-muted-foreground">{item.group}:</span>}
            <span className="min-w-0 flex-1 truncate">
              <Highlighted text={item.title} indexes={indexes} />
            </span>
            {i < recent.length && !query && recent.includes(item.id) && <span className="shrink-0 text-[11px] text-muted-foreground">recent</span>}
            {item.keys && <Keys keys={item.keys} />}
          </div>
        ))}
        {found.length === 0 && <p className="px-2.5 py-6 text-center text-[13px] text-muted-foreground">No command matches.</p>}
      </div>

      <div className="flex items-center gap-4 border-t bg-muted/30 px-4 py-2 text-xs text-muted-foreground">
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
          Run
        </span>
        <span className="flex items-center gap-1.5">
          <Key>Esc</Key>
          Close
        </span>
      </div>
    </div>
  );
}

/** The title with the characters typed in bold. */
function Highlighted({ text, indexes }: { text: string; indexes: number[] }) {
  if (!indexes.length) return <>{text}</>;
  const marked = new Set(indexes);
  return (
    <>
      {[...text].map((ch, i) =>
        marked.has(i) ? (
          <b key={i} className="font-semibold text-foreground">
            {ch}
          </b>
        ) : (
          ch
        ),
      )}
    </>
  );
}

/** A command's keys, each chord its own chip ("⌘C", or "G / K"). */
function Keys({ keys }: { keys: string }) {
  return (
    <span className="flex shrink-0 items-center gap-1">
      {keys.split(" / ").map((chord) => (
        <Key key={chord}>{keyLabel(chord)}</Key>
      ))}
    </span>
  );
}

function Key({ children }: { children: ReactNode }) {
  return <kbd className="grid h-5 min-w-5 place-items-center rounded border bg-background px-1 font-sans text-[11px] leading-none text-muted-foreground">{children}</kbd>;
}
