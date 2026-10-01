import { useEffect, useMemo, useRef, useState } from "react";
import { PiPushPin, PiPushPinFill } from "react-icons/pi";
import { create } from "zustand";
import { cn } from "cn";
import { errorMessage } from "@shared/errors";
import type { EnginePlugin } from "@shared/music/engine";
import { Input } from "@/components/ui/input";
import { musicApi } from "./api";
import { PINNED, type PickerItem, type PickerPosition, movePosition, pickerColumns } from "./plugin-groups";

const PINS_KEY = "vaudio.music.pinnedPlugins";

/** The plugins pinned to the top of the picker: this computer's, the same in every song. */
export const usePluginPins = create<{ pinned: string[]; toggle: (id: string) => void }>((set, get) => ({
  pinned: (() => {
    try {
      const saved = JSON.parse(localStorage.getItem(PINS_KEY) ?? "[]") as unknown;
      return Array.isArray(saved) ? saved.filter((id): id is string => typeof id === "string") : [];
    } catch {
      return [];
    }
  })(),
  toggle(id) {
    const pinned = get().pinned.includes(id) ? get().pinned.filter((p) => p !== id) : [...get().pinned, id];
    set({ pinned });
    localStorage.setItem(PINS_KEY, JSON.stringify(pinned));
  },
}));

/** The plugins found on this computer of one kind, read when first needed and kept (`reload` after a scan). */
const found: Partial<Record<"instrument" | "effect", EnginePlugin[]>> = {};

export function usePluginList(kind: "instrument" | "effect", open: boolean) {
  const [plugins, setPlugins] = useState<EnginePlugin[] | null>(found[kind] ?? null);
  const [error, setError] = useState<string | null>(null);
  const reload = () =>
    musicApi.listEnginePlugins().then(
      (list) => {
        found[kind] = list.filter((p) => p.isInstrument === (kind === "instrument"));
        setPlugins(found[kind]);
        setError(null);
      },
      (err) => setError(errorMessage(err)),
    );
  // Read again each time it opens (a scan may have found more since).
  useEffect(() => {
    if (open) void reload();
  }, [open, kind]);
  return { plugins, error, reload };
}

interface PluginPickerProps {
  /** What it's for, for the search field and the list ("instrument", "effect"). */
  noun: string;
  items: readonly PickerItem[];
  /** Still being read. */
  loading: boolean;
  error: string | null;
  /** Groups shown before the others (ours: "Built in"). */
  firstGroups?: readonly string[];
  onChoose: (item: PickerItem) => void;
  /** Under the columns (the rack's Scan for plugins). */
  footer?: React.ReactNode;
}

/**
 * The plugin picker, for the rack's + and the mixer's effect slots: a search field (focused, so typing
 * narrows at once), then the plugins in columns by kind (EQ, Reverb, Synth...), the pinned ones first
 * (and in their own column too), wrapping onto more rows. A pin on each, shown on hover. The arrows
 * move through a group and to the group before or after; Enter chooses.
 */
export function PluginPicker({ noun, items, loading, error, firstGroups, onChoose, footer }: PluginPickerProps) {
  const [query, setQuery] = useState("");
  const pinned = usePluginPins((s) => s.pinned);
  const columns = useMemo(() => pickerColumns(items, pinned, query, firstGroups), [items, pinned, query, firstGroups]);
  const [at, setAt] = useState<PickerPosition>({ column: 0, row: 0 });
  const list = useRef<HTMLDivElement>(null);
  const highlighted = columns[Math.min(at.column, columns.length - 1)]?.items[at.row] ?? null;
  // Out of the search field first: it lingers while the picker closes, and the editor's keys (⌘Z) skip a field.
  const choose = (item: PickerItem) => {
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    onChoose(item);
  };

  // What's typed narrows the list: the highlight goes back to the first.
  useEffect(() => setAt({ column: 0, row: 0 }), [query]);
  useEffect(() => {
    list.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [at]);

  return (
    <div className="flex w-[min(56rem,calc(100vw-4rem))] flex-col gap-2" data-testid={`${noun}-picker`}>
      <Input
        autoFocus
        aria-label={`Find an ${noun}`}
        placeholder={`Find an ${noun}…`}
        className="h-8"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "ArrowUp" || e.key === "ArrowDown" || e.key === "ArrowLeft" || e.key === "ArrowRight") {
            // Left and right move the caret while there's text to move it in; with the field empty, they're the columns'.
            if ((e.key === "ArrowLeft" || e.key === "ArrowRight") && query && !e.altKey) return;
            e.preventDefault();
            setAt((now) => movePosition(columns, now, e.key as "ArrowUp"));
          } else if (e.key === "Enter" && highlighted) {
            e.preventDefault();
            choose(highlighted);
          }
          // The editor's own keys (Space plays) aren't for here.
          e.stopPropagation();
        }}
      />
      {/* The groups wrap onto more rows rather than scroll sideways: every kind is in view at once. */}
      <div
        ref={list}
        role="listbox"
        aria-label={`${noun[0].toUpperCase()}${noun.slice(1)}s`}
        className="grid max-h-[26rem] grid-cols-[repeat(auto-fill,minmax(12rem,1fr))] gap-px overflow-y-auto rounded-sm border border-line bg-line"
      >
        {columns.map((column, c) => (
          <section key={column.title} className="flex min-w-0 flex-col bg-popover" aria-label={column.title}>
            <h3 className="border-b border-line bg-surface-1 px-2 py-1 text-[10px] font-semibold tracking-wide text-muted-foreground uppercase">{column.title}</h3>
            {column.items.map((item, r) => (
              <PickerRow
                key={`${column.title}:${item.id}`}
                item={item}
                active={at.column === c && at.row === r}
                pinned={pinned.includes(item.id)}
                inPinned={column.title === PINNED}
                onHover={() => setAt({ column: c, row: r })}
                onChoose={() => choose(item)}
              />
            ))}
          </section>
        ))}
        {!columns.length && (
          <p className="bg-popover p-3 text-xs text-muted-foreground">
            {error ? <span className="text-destructive">{error}</span> : loading ? "Looking for plugins…" : query ? `No ${noun} matches "${query}".` : `No ${noun} plugins found yet.`}
          </p>
        )}
      </div>
      {footer}
    </div>
  );
}

function PickerRow({ item, active, pinned, inPinned, onHover, onChoose }: { item: PickerItem; active: boolean; pinned: boolean; inPinned: boolean; onHover: () => void; onChoose: () => void }) {
  return (
    <div
      role="option"
      aria-selected={active}
      aria-label={item.name}
      className={cn("group flex cursor-pointer items-center gap-1.5 px-2 py-1 text-left", active ? "bg-accent text-foreground" : "hover:bg-accent/60")}
      onPointerEnter={onHover}
      onPointerDown={(e) => e.preventDefault()}
      onClick={onChoose}
      data-picker-item={item.id}
    >
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[12px]">{item.name}</span>
        {item.detail && <span className="block truncate text-[10px] text-muted-foreground">{item.detail}</span>}
      </span>
      {item.plugin && (
        <button
          type="button"
          aria-label={pinned ? `Unpin ${item.name}` : `Pin ${item.name}`}
          title={pinned ? "Unpin" : "Pin to the top"}
          className={cn("grid size-5 shrink-0 place-items-center rounded-sm text-muted-foreground hover:text-foreground", pinned ? (inPinned ? "text-brand" : "text-brand/70") : "opacity-0 group-hover:opacity-100 focus-visible:opacity-100")}
          // The search keeps the focus (typing goes on narrowing the list).
          onPointerDown={(e) => e.preventDefault()}
          onClick={(e) => {
            e.stopPropagation();
            usePluginPins.getState().toggle(item.id);
          }}
        >
          {pinned ? <PiPushPinFill className="size-3.5" /> : <PiPushPin className="size-3.5" />}
        </button>
      )}
    </div>
  );
}
