import { memo, useEffect, useMemo, useRef, useState } from "react";
import { PiCaretLeft, PiCaretRight, PiMagnifyingGlass, PiSpinnerGap, PiStarFill } from "react-icons/pi";
import { cn } from "cn";
import {
  SERUM_CATEGORIES,
  type SerumCategory,
  type SerumMacro,
  type SerumPresetEntry,
  FAVOURITE_RATING,
  findSerumPresets,
} from "@shared/music/serum-presets";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Knob, PERCENT } from "../knob";
import { useSong } from "../store";
import { useTransport } from "../transport";
import { serumWindow } from "../ui";
import { MusicWindow, centredOnDesktop } from "../window";
import { ScopeView } from "./scope-view";
import { Stars } from "./stars";
import { useSerumUi } from "./store";

const WIDTH = 780;
const HEIGHT = 580;
const MIN = { minWidth: 560, minHeight: 420 };
const ALL = "all";

/**
 * A Serum 2 channel's window (`docs/serum/player.md` §3): Serum's whole library in one list to find a preset in,
 * the arrows to step through it (each step loads it, so browsing is hearing), a display of what it's playing, and
 * the preset's macros. Serum's own window is a click away for the rest.
 */
export function SerumPlayerWindow({ channelId, index }: { channelId: string; index: number }) {
  const channel = useSong((s) => s.channels.find((c) => c.id === channelId) ?? null);
  const [initial] = useState(() => {
    const place = centredOnDesktop(WIDTH, HEIGHT);
    return { ...place, x: place.x + index * 28, y: place.y + index * 28, width: WIDTH, height: HEIGHT };
  });
  const gone = !channel;
  useEffect(() => {
    if (gone) useSerumUi.getState().close(channelId);
  }, [gone, channelId]);
  // What its Serum has on, once Serum is loaded (a channel just added takes a moment).
  const loaded = useTransport((s) => s.channels.loaded.some((c) => c.channel === channelId));
  useEffect(() => {
    if (loaded) void useSerumUi.getState().refresh(channelId);
  }, [loaded, channelId]);
  if (!channel) return null;
  return (
    <MusicWindow id={serumWindow(channelId)} title={channel.name === "Serum 2" ? "Serum 2" : `${channel.name} (Serum 2)`} initial={initial} resizable={MIN} onClose={() => useSerumUi.getState().close(channelId)}>
      <div className="flex min-h-0 flex-1" data-testid="serum-player" data-channel={channelId}>
        <PresetBrowser channelId={channelId} />
        <SoundPanel channelId={channelId} />
      </div>
    </MusicWindow>
  );
}

/** The library as a list: a search, the filters, a row a preset (a click loads it). */
function PresetBrowser({ channelId }: { channelId: string }) {
  const presets = useSerumUi((s) => s.presets);
  const available = useSerumUi((s) => s.available);
  const libraryError = useSerumUi((s) => s.libraryError);
  const current = useSerumUi((s) => s.channels[channelId]?.path ?? null);
  const loading = useSerumUi((s) => s.channels[channelId]?.loading ?? null);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<SerumCategory | null>(null);
  const [favourites, setFavourites] = useState(false);
  const [kind, setKind] = useState<SerumPresetEntry["kind"] | null>(null);
  const field = useRef<HTMLInputElement>(null);
  const list = useMemo(() => findSerumPresets(presets ?? [], query, { category, favourites, kind }), [presets, query, category, favourites, kind]);
  const counts = useMemo(() => {
    const byCategory = new Map<SerumCategory, number>();
    for (const p of presets ?? []) byCategory.set(p.category, (byCategory.get(p.category) ?? 0) + 1);
    return byCategory;
  }, [presets]);
  useEffect(() => useSerumUi.getState().setShown(channelId, list.map((p) => p.path)), [channelId, list]);
  useEffect(() => {
    const timer = setTimeout(() => field.current?.focus(), 0);
    return () => clearTimeout(timer);
  }, []);
  // The preset it's on stays in view as the arrows move through the list; another search or filter starts at the top.
  const shown = loading ?? current;
  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    listRef.current?.scrollTo({ top: 0 });
  }, [query, category, favourites, kind]);
  useEffect(() => {
    if (!shown) return;
    const row = [...(listRef.current?.querySelectorAll<HTMLElement>("[data-path]") ?? [])].find((el) => el.dataset.path === shown);
    row?.scrollIntoView({ block: "nearest" });
  }, [shown, list]);

  const rated = (presets ?? []).filter((p) => p.rating >= FAVOURITE_RATING).length;
  return (
    <div className="flex w-[46%] min-w-64 flex-col border-r border-line" data-testid="serum-browser">
      <div className="flex flex-col gap-1.5 border-b border-line px-2 py-1.5">
        <label className="flex items-center gap-1.5">
          <PiMagnifyingGlass className="size-3.5 shrink-0 text-muted-foreground" />
          <Input
            ref={field}
            aria-label="Find a preset"
            placeholder="Find a preset: its name, maker, kind or tags"
            className="h-7 text-xs"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              // The editor's keys (Space plays) aren't for here; the arrows step through the list from here too.
              e.stopPropagation();
              if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                e.preventDefault();
                void useSerumUi.getState().step(channelId, e.key === "ArrowDown" ? 1 : -1);
              } else if (e.key === "Escape" && query) setQuery("");
            }}
          />
        </label>
        <div className="flex items-center gap-1.5">
          <Select value={category ?? ALL} onValueChange={(v) => setCategory(v === ALL ? null : (v as SerumCategory))}>
            <SelectTrigger size="sm" className="h-6 w-28 shrink-0 text-[11px]" aria-label="Kind of sound">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>Every kind</SelectItem>
              {SERUM_CATEGORIES.filter((c) => counts.has(c)).map((c) => (
                <SelectItem key={c} value={c}>
                  {c} ({counts.get(c)})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <button
            type="button"
            aria-pressed={favourites}
            title={`Only the presets with ${FAVOURITE_RATING} stars or more`}
            className={cn("flex h-6 shrink-0 items-center gap-1 rounded-sm border border-line px-1.5 text-[11px]", favourites ? "pressed text-foreground" : "text-muted-foreground hover:text-foreground")}
            onClick={() => setFavourites(!favourites)}
          >
            <PiStarFill className="size-3" /> Starred
          </button>
          <div className="ml-auto flex shrink-0 rounded-sm border border-line" role="group" aria-label="Serum version">
            {([null, "serum2", "serum1"] as const).map((k) => (
              <button
                key={k ?? "both"}
                type="button"
                aria-pressed={kind === k}
                className={cn("px-1.5 py-0.5 text-[11px] whitespace-nowrap first:rounded-l-sm last:rounded-r-sm", kind === k ? "pressed text-foreground" : "text-muted-foreground hover:text-foreground")}
                onClick={() => setKind(k)}
              >
                {k === null ? "Both" : k === "serum2" ? "Serum 2" : "Serum 1"}
              </button>
            ))}
          </div>
        </div>
      </div>
      <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto py-0.5" role="listbox" aria-label="Presets">
        {list.map((preset) => (
          <PresetRow key={preset.path} channelId={channelId} preset={preset} on={preset.path === current} loading={preset.path === loading} />
        ))}
        {!list.length && (
          <p className="p-4 text-center text-xs text-muted-foreground">
            {libraryError ? (
              <span className="text-destructive">{libraryError}</span>
            ) : presets === null ? (
              "Reading Serum's presets…"
            ) : !available ? (
              "Serum 2's preset folder isn't on this computer."
            ) : query ? (
              `No preset matches "${query}".`
            ) : (
              "No preset here."
            )}
          </p>
        )}
      </div>
      <div className="border-t border-line px-2.5 py-1 text-[11px] text-muted-foreground">
        {list.length === (presets?.length ?? 0) ? `${list.length} presets` : `${list.length} of ${presets?.length ?? 0} presets`} · {rated} starred · ↑ ↓ to step through
      </div>
    </div>
  );
}

const PresetRow = memo(function PresetRow({ channelId, preset, on, loading }: { channelId: string; preset: SerumPresetEntry; on: boolean; loading: boolean }) {
  return (
    <div
      role="option"
      aria-selected={on}
      aria-label={preset.name}
      data-path={preset.path}
      className={cn("group flex h-7 cursor-pointer items-center gap-2 px-2 text-[12px]", on ? "bg-brand/20 text-foreground" : "hover:bg-accent/60")}
      onClick={() => void useSerumUi.getState().load(channelId, preset)}
    >
      <span className="min-w-0 flex-1 truncate">
        {preset.name}
        <span className="ml-2 text-[11px] text-muted-foreground">{preset.author || preset.folder}</span>
      </span>
      {loading && <PiSpinnerGap className="size-3 shrink-0 animate-spin text-muted-foreground" />}
      {preset.kind === "serum1" && (
        <span className="shrink-0 rounded-sm border border-line px-1 text-[10px] text-muted-foreground" title="A Serum 1 preset: Serum 2 converts it as it loads it">
          S1
        </span>
      )}
      <Stars rating={preset.rating} label={preset.name} quiet onRate={(r) => void useSerumUi.getState().rate(preset, r)} />
    </div>
  );
});

/** The preset the channel's Serum has on, the arrows, Serum's window, and the macros. */
function SoundPanel({ channelId }: { channelId: string }) {
  const state = useSerumUi((s) => s.channels[channelId]);
  const entry = useSerumUi((s) => s.presets?.find((p) => p.path === s.channels[channelId]?.path) ?? null);
  const editorOpen = useTransport((s) => s.channels.loaded.some((c) => c.channel === channelId && c.editorOpen));
  const name = entry?.name ?? state?.sound?.preset?.name ?? null;
  const step = (by: number) => void useSerumUi.getState().step(channelId, by);
  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <div className="flex items-start gap-2 border-b border-line px-3 py-2.5">
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium" data-testid="serum-preset-name">
            {name || "No preset loaded"}
          </div>
          <div className="flex min-w-0 items-center gap-2 text-[11px] text-muted-foreground">
            {entry ? (
              <>
                <span className="truncate">{[entry.author, entry.folder, entry.kind === "serum1" ? "Serum 1" : null].filter(Boolean).join(" · ")}</span>
                <Stars rating={entry.rating} label={entry.name} onRate={(r) => void useSerumUi.getState().rate(entry, r)} />
              </>
            ) : (
              "Pick one in the list: ↑ ↓ step through it."
            )}
          </div>
          {state?.error && <div className="mt-1 text-[11px] text-destructive">{state.error}</div>}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Button variant="ghost" size="icon-xs" aria-label="Previous preset" onClick={() => step(-1)}>
            <PiCaretLeft />
          </Button>
          <Button variant="ghost" size="icon-xs" aria-label="Next preset" onClick={() => step(1)}>
            <PiCaretRight />
          </Button>
          <Button variant="outline" size="sm" className="ml-1 h-7 text-xs" onClick={() => useTransport.getState().showPlugin(channelId, !editorOpen)}>
            {editorOpen ? "Hide Serum" : "Open Serum"}
          </Button>
        </div>
      </div>
      <div className="mx-3 mt-3 min-h-44 flex-1 overflow-hidden rounded-md border border-line shadow-inner">
        <ScopeView channelId={channelId} />
      </div>
      <Macros channelId={channelId} macros={state?.sound?.macros ?? null} />
    </div>
  );
}

function Macros({ channelId, macros }: { channelId: string; macros: SerumMacro[] | null }) {
  if (!macros) return <p className="p-4 text-xs text-muted-foreground">Waiting for Serum…</p>;
  if (!macros.length) return <p className="p-4 text-xs text-muted-foreground">Serum hasn't said what its macros are.</p>;
  return (
    <section className="p-3" aria-label="Macros">
      <h3 className="mb-2 text-[11px] font-medium text-muted-foreground">Macros</h3>
      <div className="grid grid-cols-4 gap-x-2 gap-y-3" data-testid="serum-macros">
        {macros.map((macro) => (
          <MacroKnob key={macro.param} channelId={channelId} macro={macro} />
        ))}
      </div>
    </section>
  );
}

function MacroKnob({ channelId, macro }: { channelId: string; macro: SerumMacro }) {
  const set = (value: number, gesture?: "begin" | "end") => useSerumUi.getState().setMacro(channelId, macro.param, value, gesture);
  const latest = () => useSerumUi.getState().channels[channelId]?.sound?.macros.find((m) => m.param === macro.param)?.value ?? macro.value;
  return (
    <div className="flex flex-col items-center gap-1" data-macro={macro.index + 1}>
      <Knob
        value={macro.value}
        min={0}
        max={1}
        defaultValue={0}
        label={macro.name}
        format={(v) => `${Math.round(v * 100)}%`}
        unit={PERCENT}
        size={40}
        onBegin={() => set(latest(), "begin")}
        onDrag={(v) => set(v)}
        onEnd={() => set(latest(), "end")}
        onCancel={() => set(latest(), "end")}
        onSet={(v) => {
          set(v, "begin");
          set(v, "end");
        }}
      />
      <span className="max-w-full truncate text-[11px]" title={macro.name}>
        {macro.name}
      </span>
    </div>
  );
}
