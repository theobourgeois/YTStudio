import { memo, useEffect, useMemo, useRef, useState } from "react";
import { PiArrowArcLeft, PiArrowArcRight, PiCaretDown, PiCaretLeftFill, PiCaretRightFill, PiCheck, PiMagnifyingGlass, PiShuffle, PiSpinnerGap, PiStar, PiStarFill, PiX } from "react-icons/pi";
import { cn } from "cn";
import {
  SERUM_CATEGORIES,
  type SerumCategory,
  type SerumMacro,
  type SerumPresetEntry,
  FAVOURITE_RATING,
  findSerumPresets,
} from "@shared/music/serum-presets";
import { type SerumModRoute, sourceDrives } from "@shared/music/serum-sound";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Caption, CompKnob } from "../pro-c/knob";
import { useSong } from "../store";
import { useTransport } from "../transport";
import { serumWindow } from "../ui";
import { MusicWindow, fittedOnDesktop } from "../window";
import { EffectsSection } from "./effects";
import { EnvelopesAndLfos } from "./envelopes";
import { categoryHue, SERUM_TOKENS } from "./look";
import { ModulationSection } from "./modulation";
import { OscillatorsSection } from "./oscillators";
import { ScopeView } from "./scope-view";
import { SerumSection } from "./section";
import { Stars } from "./stars";
import { useSerumUi } from "./store";

const WIDTH = 900;
const HEIGHT = 700;
const MIN_SIZE = { width: 640, height: 460 };
const MIN = { minWidth: MIN_SIZE.width, minHeight: MIN_SIZE.height };

/**
 * A Serum 2 channel's window (`docs/serum/player.md` §3), a plugin's face as YT-L's is, in Serum's colours: the
 * preset playing and the arrows in its top bar, Serum's whole library down the left (browsing is hearing: each step
 * loads one), and for the sound a display of what it plays, its macros, oscillators, modulation, effects, and (when
 * asked) its envelopes and LFOs. Each change is a step of the player's own undo. Serum's own window is a click away for the rest.
 */
export function SerumPlayerWindow({ channelId, index }: { channelId: string; index: number }) {
  const channel = useSong((s) => s.channels.find((c) => c.id === channelId) ?? null);
  const [initial] = useState(() => {
    // As big as it likes where there's room, else as big as the desktop takes (a laptop's screen): never under the Dock.
    const place = fittedOnDesktop({ width: WIDTH, height: HEIGHT }, MIN_SIZE);
    return { ...place, x: place.x + index * 28, y: place.y + index * 28 };
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
      <div className="flex min-h-0 flex-1 flex-col bg-[var(--serum-bg)] text-xs text-[var(--serum-text)] select-none" style={SERUM_TOKENS} data-testid="serum-player" data-channel={channelId}>
        <TopBar channelId={channelId} />
        <div className="flex min-h-0 flex-1">
          <PresetBrowser channelId={channelId} />
          <SoundPanel channelId={channelId} />
        </div>
      </div>
    </MusicWindow>
  );
}

const barButton = "grid size-6 place-items-center rounded-sm text-[var(--serum-text-dim)] outline-none hover:bg-white/5 hover:text-[var(--serum-text)] disabled:opacity-30 disabled:hover:bg-transparent";

/** The name, the player's undo, the preset playing between its arrows (with its stars), and Serum's own window. */
function TopBar({ channelId }: { channelId: string }) {
  const state = useSerumUi((s) => s.channels[channelId]);
  const entry = useSerumUi((s) => s.presets?.find((p) => p.path === s.channels[channelId]?.path) ?? null);
  const editorOpen = useTransport((s) => s.channels.loaded.some((c) => c.channel === channelId && c.editorOpen));
  const name = entry?.name ?? state?.sound?.preset?.name ?? null;
  const history = state?.sound?.history;
  const step = (by: number) => void useSerumUi.getState().step(channelId, by);
  return (
    <div className="flex h-10 shrink-0 items-center gap-1 border-b border-black/60 bg-[var(--serum-bar)] px-2.5">
      <button type="button" className={barButton} aria-label="Undo in the player" title={history?.undo ? `Undo ${history.undo} (⌘Z)` : "Nothing to undo"} disabled={!history?.undo || state?.busy} onClick={() => void useSerumUi.getState().undo(channelId)}>
        <PiArrowArcLeft className="size-3.5" />
      </button>
      <button type="button" className={barButton} aria-label="Redo in the player" title={history?.redo ? `Redo ${history.redo} (⇧⌘Z)` : "Nothing to redo"} disabled={!history?.redo || state?.busy} onClick={() => void useSerumUi.getState().redo(channelId)}>
        <PiArrowArcRight className="size-3.5" />
      </button>
      <div className="mx-auto flex min-w-0 items-center gap-2">
        <button type="button" className={barButton} aria-label="Previous preset" onClick={() => step(-1)}>
          <PiCaretLeftFill className="size-2.5" />
        </button>
        <div className="flex min-w-[240px] max-w-[380px] flex-col items-center leading-tight">
          <span className="flex max-w-full items-center gap-1.5">
            <span className={cn("truncate text-[14px] font-medium", !name && "text-[var(--serum-text-dim)] italic")} data-testid="serum-preset-name">
              {name || "No preset loaded"}
            </span>
            {state?.busy && <PiSpinnerGap className="size-3 shrink-0 animate-spin text-[var(--serum-text-dim)]" aria-label="Serum is loading the change" />}
          </span>
          <span className="flex max-w-full items-center gap-1.5 text-[10.5px] text-[var(--serum-text-dim)]">
            {entry ? (
              <>
                <span className="truncate">{[entry.author, entry.kind === "serum1" ? "Serum 1" : null].filter(Boolean).join(" · ") || entry.folder}</span>
                <Stars rating={entry.rating} label={entry.name} onRate={(r) => void useSerumUi.getState().rate(entry, r)} />
              </>
            ) : (
              "Pick one in the list: ↑ ↓ step through it."
            )}
            {state?.sound?.edited && (
              <span className="text-[var(--serum-hot)]" data-testid="serum-edited" title="Changed here since the preset was loaded">
                · edited
              </span>
            )}
          </span>
        </div>
        <button type="button" className={barButton} aria-label="Next preset" onClick={() => step(1)}>
          <PiCaretRightFill className="size-2.5" />
        </button>
      </div>
      <button
        type="button"
        aria-pressed={editorOpen}
        className={cn(
          "rounded-[4px] border px-2 py-1 text-[11px] font-medium outline-none",
          editorOpen ? "border-[var(--serum-trace)] text-[var(--serum-trace)]" : "border-[var(--serum-edge)] text-[var(--serum-text-dim)] hover:text-[var(--serum-text)]",
        )}
        onClick={() => useTransport.getState().showPlugin(channelId, !editorOpen)}
      >
        {editorOpen ? "Hide Serum" : "Open Serum"}
      </button>
    </div>
  );
}

/** The library as a list: a search, the kinds as chips, starred and Serum 1 / 2, a row a preset (a click loads it). */
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
  const filter = (on: boolean) =>
    cn(
      "flex h-6 items-center gap-1 rounded-[4px] border border-black/60 px-2 text-[11px] outline-none",
      on ? "bg-[var(--serum-tab-on)] text-[var(--serum-text)]" : "bg-[var(--serum-tab)] text-[var(--serum-text-dim)] hover:text-[var(--serum-text)]",
    );
  return (
    <div className="flex w-[38%] max-w-[360px] min-w-60 flex-col border-r border-black/60 bg-[var(--serum-panel)]" data-testid="serum-browser">
      <div className="flex flex-col gap-2 border-b border-black/50 p-2">
        <label className="flex h-7 items-center gap-1.5 rounded-[4px] border border-black/60 bg-[var(--serum-display)] px-2 shadow-[inset_0_1px_3px_rgb(0_0_0/0.5)]">
          <PiMagnifyingGlass className="size-3.5 shrink-0 text-[var(--serum-text-dim)]" />
          <input
            ref={field}
            aria-label="Find a preset"
            placeholder="Find a preset: its name, maker, kind or tags"
            className="min-w-0 flex-1 bg-transparent text-[12px] text-[var(--serum-text)] outline-none placeholder:text-[var(--serum-text-dim)]"
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
          {query && (
            <button type="button" aria-label="Clear the search" className="text-[var(--serum-text-dim)] hover:text-[var(--serum-text)]" onClick={() => setQuery("")}>
              <PiX className="size-3" />
            </button>
          )}
        </label>
        <div className="flex items-center gap-1.5">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button type="button" aria-label="Kind of sound" className={cn(filter(category !== null), "min-w-0 flex-1 justify-between")}>
                <span className="flex min-w-0 items-center gap-1.5">
                  {category && <span className="size-1.5 shrink-0 rounded-full" style={{ background: categoryHue(category) }} />}
                  <span className="truncate">{category ?? "Every kind"}</span>
                </span>
                <PiCaretDown className="size-2.5 shrink-0 opacity-70" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="max-h-80 w-44 overflow-y-auto border-black/60 bg-[var(--serum-panel)] text-[var(--serum-text)]">
              {[null, ...SERUM_CATEGORIES.filter((c) => counts.has(c))].map((c) => (
                <DropdownMenuItem key={c ?? "all"} onSelect={() => setCategory(c)} className="gap-2 text-[12px] focus:bg-white/5 focus:text-[var(--serum-text)]">
                  <span className="size-1.5 shrink-0 rounded-full" style={{ background: c ? categoryHue(c) : "transparent" }} />
                  <span className="flex-1">{c ?? "Every kind"}</span>
                  <span className="text-[10.5px] text-[var(--serum-text-dim)]">{c ? counts.get(c) : presets?.length}</span>
                  {c === category && <PiCheck className="size-3 text-[var(--serum-trace)]" />}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
          <button type="button" aria-pressed={favourites} aria-label="Starred" title={`Only the presets with ${FAVOURITE_RATING} stars or more`} className={cn(filter(favourites), "shrink-0 px-1.5")} onClick={() => setFavourites(!favourites)}>
            {favourites ? <PiStarFill className="size-3 text-[var(--serum-hot)]" /> : <PiStar className="size-3" />}
          </button>
          <button
            type="button"
            aria-label="Random preset"
            title="Load a random preset from this list"
            disabled={!list.length}
            className={cn(filter(false), "shrink-0 px-1.5 disabled:opacity-40")}
            onClick={() => void useSerumUi.getState().shuffle(channelId)}
          >
            <PiShuffle className="size-3" />
          </button>
          <div className="flex shrink-0 overflow-hidden rounded-[4px] border border-black/60 text-[11px]" role="group" aria-label="Serum version">
            {([null, "serum2", "serum1"] as const).map((k) => (
              <button
                key={k ?? "both"}
                type="button"
                aria-pressed={kind === k}
                className={cn("px-1.5 py-[3px] whitespace-nowrap outline-none", kind === k ? "bg-[var(--serum-tab-on)] text-[var(--serum-text)]" : "bg-[var(--serum-tab)] text-[var(--serum-text-dim)] hover:text-[var(--serum-text)]")}
                onClick={() => setKind(k)}
              >
                {k === null ? "Both" : k === "serum2" ? "Serum 2" : "Serum 1"}
              </button>
            ))}
          </div>
        </div>
      </div>
      <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto py-1" role="listbox" aria-label="Presets">
        {list.map((preset) => (
          <PresetRow key={preset.path} channelId={channelId} preset={preset} on={preset.path === current} loading={preset.path === loading} />
        ))}
        {!list.length && (
          <p className="p-4 text-center text-[11px] text-[var(--serum-text-dim)]">
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
      <div className="border-t border-black/50 px-2.5 py-1 text-[10.5px] text-[var(--serum-text-dim)]">
        {list.length === (presets?.length ?? 0) ? `${list.length} presets` : `${list.length} of ${presets?.length ?? 0} presets`} · {rated} starred
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
      className={cn(
        "group relative flex h-7 cursor-pointer items-center gap-2 pr-2 pl-3 text-[12px]",
        on ? "bg-[var(--serum-row-on)] text-white" : "text-[var(--serum-text)] hover:bg-white/[0.04]",
      )}
      onClick={() => void useSerumUi.getState().load(channelId, preset)}
    >
      {on && <span className="absolute inset-y-0 left-0 w-[2px] bg-[var(--serum-trace)]" />}
      <span className="size-1.5 shrink-0 rounded-full" style={{ background: categoryHue(preset.category) }} title={preset.category} />
      <span className="min-w-0 flex-1 truncate">
        {preset.name}
        <span className="ml-2 text-[10.5px] text-[var(--serum-text-dim)]">{preset.author || preset.folder}</span>
      </span>
      {loading && <PiSpinnerGap className="size-3 shrink-0 animate-spin text-[var(--serum-text-dim)]" />}
      {preset.kind === "serum1" && (
        <span className="shrink-0 rounded-sm border border-[var(--serum-edge)] px-1 text-[9px] font-semibold text-[var(--serum-text-dim)]" title="A Serum 1 preset: Serum 2 converts it as it loads it">
          S1
        </span>
      )}
      <Stars rating={preset.rating} label={preset.name} quiet onRate={(r) => void useSerumUi.getState().rate(preset, r)} />
    </div>
  );
});

/** What the channel's Serum plays, its macros, oscillators, modulation, effects, and its envelopes and LFOs. */
function SoundPanel({ channelId }: { channelId: string }) {
  const state = useSerumUi((s) => s.channels[channelId]);
  const sound = state?.sound ?? null;
  return (
    <div className="min-h-0 min-w-0 flex-1 overflow-y-auto pb-3" data-testid="serum-sound">
      {state?.error && <div className="mx-3 mt-2 rounded-sm border border-destructive/40 bg-destructive/10 px-2 py-1 text-[11px] text-destructive">{state.error}</div>}
      <div className="mx-3 mt-3 h-40 overflow-hidden rounded-[4px] border border-black/70">
        <ScopeView channelId={channelId} />
      </div>
      <Macros channelId={channelId} macros={sound?.macros ?? null} routes={sound?.modulation ?? null} />
      <OscillatorsSection channelId={channelId} oscillators={sound?.oscillators ?? []} />
      <ModulationSection channelId={channelId} routes={sound?.modulation ?? null} />
      <EffectsSection channelId={channelId} racks={sound?.effects ?? []} />
      {sound?.modulation && <EnvelopesAndLfos channelId={channelId} envelopes={sound.envelopes} lfos={sound.lfos} routes={sound.modulation} />}
    </div>
  );
}

/**
 * The preset's macros, big, each with what it drives. One its maker left unnamed with nothing on it is hidden (§3.3);
 * all eight show while the routes aren't known yet.
 */
function Macros({ channelId, macros, routes }: { channelId: string; macros: SerumMacro[] | null; routes: SerumModRoute[] | null }) {
  const drives = (macro: SerumMacro) => (routes ? sourceDrives(routes, `Macro ${macro.index + 1}`) : []);
  const shown = !macros ? [] : routes ? macros.filter((m) => drives(m).length || m.name !== `Macro ${m.index + 1}`) : macros;
  return (
    <SerumSection title="Macros" label="Macros">
      {!macros ? (
        <p className="text-[11px] text-[var(--serum-text-dim)]">Waiting for Serum…</p>
      ) : !macros.length ? (
        <p className="text-[11px] text-[var(--serum-text-dim)]">Serum hasn't said what its macros are.</p>
      ) : !shown.length ? (
        <p className="text-[11px] text-[var(--serum-text-dim)]">This preset's maker gave it no macros.</p>
      ) : (
        <div className="grid grid-cols-4 gap-x-2 gap-y-3 rounded-[4px] border border-black/50 bg-[var(--serum-panel)] px-2 py-3" data-testid="serum-macros">
          {shown.map((macro) => (
            <MacroKnob key={macro.param} channelId={channelId} macro={macro} drives={drives(macro)} />
          ))}
        </div>
      )}
    </SerumSection>
  );
}

function MacroKnob({ channelId, macro, drives }: { channelId: string; macro: SerumMacro; drives: string[] }) {
  const set = (value: number, gesture?: "begin" | "end") => useSerumUi.getState().setMacro(channelId, macro.param, value, gesture);
  const latest = () => useSerumUi.getState().channels[channelId]?.sound?.macros.find((m) => m.param === macro.param)?.value ?? macro.value;
  return (
    <div className="flex min-w-0 flex-col items-center" data-macro={macro.index + 1}>
      <CompKnob
        value={macro.value}
        defaultValue={0}
        label={macro.name}
        format={(v) => `${Math.round(v * 100)}%`}
        size={54}
        onBegin={() => set(latest(), "begin")}
        onDrag={(v) => set(v)}
        onEnd={() => set(latest(), "end")}
        onCancel={() => set(latest(), "end")}
        onSet={(v) => useSerumUi.getState().setControl(channelId, macro.param, v, "set", `Turn ${macro.name}`)}
        caption={<Caption className="max-w-full truncate text-[11px] tracking-normal normal-case">{macro.name}</Caption>}
      />
      <span className="mt-0.5 max-w-full truncate text-[10px] text-[var(--serum-text-dim)]" title={drives.length ? `Drives ${drives.join(", ")}` : undefined}>
        {drives.length ? `${drives[0]}${drives.length > 1 ? ` +${drives.length - 1}` : ""}` : " "}
      </span>
    </div>
  );
}
