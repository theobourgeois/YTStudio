import { useEffect, useMemo, useRef, useState } from "react";
import { PiPushPin, PiPushPinFill } from "react-icons/pi";
import { create } from "zustand";
import { cn } from "cn";
import { errorMessage } from "@shared/errors";
import type { EnginePlugin } from "@shared/music/engine";
import { Input } from "@/components/ui/input";
import { musicApi } from "./api";
import { PINNED, type PickerItem, besideIndex, pickerColumns, pickerOrder, pickerSize } from "./plugin-groups";

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
 * narrows at once), then the plugins by kind (EQ, Reverb, Synth...), the pinned ones first (and in their
 * own group too), one line each. The groups run down a column and on into the next, as a newspaper's
 * do. A pin on each, shown on hover. Up and down go through them in order, left and right to the one
 * level with it in the next column; Enter chooses. Few plugins, it's only as big as they need (`pickerSize`).
 */
export function PluginPicker({ noun, items, loading, error, firstGroups, onChoose, footer }: PluginPickerProps) {
  const [query, setQuery] = useState("");
  const pinned = usePluginPins((s) => s.pinned);
  const columns = useMemo(() => pickerColumns(items, pinned, query, firstGroups), [items, pinned, query, firstGroups]);
  const order = useMemo(() => pickerOrder(columns), [columns]);
  // Its size from all of them, not what's typed: it doesn't change size as the list narrows.
  const size = useMemo(() => pickerSize(pickerColumns(items, pinned, "", firstGroups)), [items, pinned, firstGroups]);
  const [at, setAt] = useState(0);
  const list = useRef<HTMLDivElement>(null);
  const highlighted = order[Math.min(at, order.length - 1)]?.item ?? null;
  // Out of the search field first: it lingers while the picker closes, and the editor's keys (⌘Z) skip a field.
  const choose = (item: PickerItem) => {
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    onChoose(item);
  };

  // What's typed narrows the list: the highlight goes back to the first.
  useEffect(() => setAt(0), [query]);
  useEffect(() => {
    list.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [at]);

  /** Left or right: the item level with the highlighted one in the next column, as they're laid out. */
  const across = (direction: -1 | 1) => {
    const rows = [...(list.current?.querySelectorAll<HTMLElement>("[data-picker-item]") ?? [])].map((row) => row.getBoundingClientRect());
    const next = besideIndex(rows, at, direction);
    if (next !== null) setAt(next);
  };

  let index = 0;
  return (
    <div
      className={cn("flex flex-col gap-1.5", !size && "w-[min(52rem,calc(100vw-4rem))]")}
      // A column is 11rem, a line 1.5rem (and the list's border); two columns at least, for the search field.
      style={size ? { width: `calc(${Math.max(2, size.columns) * 11}rem + 2px)` } : undefined}
      data-testid={`${noun}-picker`}
    >
      <Input
        autoFocus
        aria-label={`Find an ${noun}`}
        placeholder={`Find an ${noun}…`}
        className="h-7"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "ArrowUp" || e.key === "ArrowDown") {
            e.preventDefault();
            setAt((now) => Math.max(0, Math.min(order.length - 1, now + (e.key === "ArrowUp" ? -1 : 1))));
          } else if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
            // Left and right move the caret while there's text to move it in (Alt: the columns anyway).
            if (query && !e.altKey) return;
            e.preventDefault();
            across(e.key === "ArrowLeft" ? -1 : 1);
          } else if (e.key === "Enter" && highlighted) {
            e.preventDefault();
            choose(highlighted);
          }
          // The editor's own keys (Space plays) aren't for here.
          e.stopPropagation();
        }}
      />
      <div ref={list} role="listbox" aria-label={`${noun[0].toUpperCase()}${noun.slice(1)}s`} className={cn("overflow-x-auto overflow-y-hidden rounded-sm border border-line bg-popover", !size && "h-[min(22rem,60vh)]")}
        style={size ? { height: `min(max(3rem, ${size.rows * 1.5 + 0.25}rem + 2px), 60vh)` } : undefined}
      >
        {/* Newspaper columns: a group runs down a column and on into the next; never a header left alone at a column's foot. */}
        <div className="h-full [column-fill:auto] [column-gap:0] [column-rule:1px_solid_var(--line)] [column-width:11rem]">
          {columns.map((column) => (
            <section key={column.title} aria-label={column.title}>
              <h3 className="break-after-avoid px-2 pt-1.5 pb-0.5 text-[10px] font-semibold tracking-wide text-muted-foreground uppercase">{column.title}</h3>
              {column.items.map((item) => {
                const i = index++;
                return (
                  <PickerRow
                    key={`${column.title}:${item.id}`}
                    item={item}
                    active={at === i}
                    pinned={pinned.includes(item.id)}
                    inPinned={column.title === PINNED}
                    onHover={() => setAt(i)}
                    onChoose={() => choose(item)}
                  />
                );
              })}
            </section>
          ))}
          {!columns.length && (
            <p className="p-3 text-xs text-muted-foreground">
              {error ? <span className="text-destructive">{error}</span> : loading ? "Looking for plugins…" : query ? `No ${noun} matches "${query}".` : `No ${noun} plugins found yet.`}
            </p>
          )}
        </div>
      </div>
      {footer}
    </div>
  );
}

function PickerRow({ item, active, pinned, inPinned, onHover, onChoose }: { item: PickerItem; active: boolean; pinned: boolean; inPinned: boolean; onHover: () => void; onChoose: () => void }) {
  const format = item.plugin ? (item.plugin.format === "AudioUnit" ? "AU" : item.plugin.format) : "";
  return (
    <div
      role="option"
      aria-selected={active}
      aria-label={item.name}
      title={item.detail}
      className={cn("group flex h-6 cursor-pointer break-inside-avoid items-center gap-1.5 pr-1 pl-2 text-left", active ? "bg-accent text-foreground" : "hover:bg-accent/60")}
      onPointerEnter={onHover}
      onPointerDown={(e) => e.preventDefault()}
      onClick={onChoose}
      data-picker-item={item.id}
    >
      <span className="min-w-0 flex-1 truncate text-[12px]">{item.name}</span>
      {format && <span className="shrink-0 text-[9px] text-muted-foreground/70">{format}</span>}
      {item.plugin && (
        <button
          type="button"
          aria-label={pinned ? `Unpin ${item.name}` : `Pin ${item.name}`}
          title={pinned ? "Unpin" : "Pin to the top"}
          className={cn("grid size-4 shrink-0 place-items-center rounded-sm text-muted-foreground hover:text-foreground", pinned ? (inPinned ? "text-brand" : "text-brand/70") : "opacity-0 group-hover:opacity-100 focus-visible:opacity-100")}
          // The search keeps the focus (typing goes on narrowing the list).
          onPointerDown={(e) => e.preventDefault()}
          onClick={(e) => {
            e.stopPropagation();
            usePluginPins.getState().toggle(item.id);
          }}
        >
          {pinned ? <PiPushPinFill className="size-3" /> : <PiPushPin className="size-3" />}
        </button>
      )}
    </div>
  );
}
