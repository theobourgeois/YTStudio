/**
 * Which agent answers the chat, on which model, and how hard it thinks:
 * Claude (Claude Code) or Codex, each with its models (Codex's as Codex lists
 * them). A rail picks the provider (or the starred models), the list its
 * model; typing searches them all. ⌘1–9 pick from the list, like T3 Code's
 * picker. The thinking level is a menu of its own, of the levels the model offers.
 */
import { type KeyboardEvent, useEffect, useMemo, useRef, useState } from "react";
import { PiBrain, PiCaretDown, PiCheck, PiMagnifyingGlass, PiStar, PiStarFill, PiWarningCircle } from "react-icons/pi";
import {
  ASSISTANT_PROVIDERS,
  type AssistantModelInfo,
  type AssistantProvider,
  CLAUDE_MODELS,
  CODEX_MODELS,
  effortLabel,
  providerInfo,
} from "@shared/assistant";
import { cn } from "cn";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { providerStatus, useAssistant } from "@/stores/assistant";
import { ProviderIcon } from "./provider-icon";

const FAVORITES_KEY = "editor-assistant-favorite-models";

type Rail = AssistantProvider | "favorites";

interface Entry extends AssistantModelInfo {
  provider: AssistantProvider;
}

const keyOf = (e: { provider: AssistantProvider; id: string }) => `${e.provider}:${e.id}`;

function storedFavorites(): string[] {
  try {
    const raw = JSON.parse(localStorage.getItem(FAVORITES_KEY) ?? "[]") as unknown;
    return Array.isArray(raw) ? raw.filter((k): k is string => typeof k === "string") : [];
  } catch {
    return [];
  }
}

/** Every provider's models: what the server says it offers, else the built-in lists. */
function useCatalog(): Record<AssistantProvider, Entry[]> {
  const status = useAssistant((s) => s.status);
  return useMemo(() => {
    const listed = (provider: AssistantProvider, fallback: readonly AssistantModelInfo[]): Entry[] => {
      const models = providerStatus(status, provider)?.models;
      return (models?.length ? models : fallback).map((m) => ({ ...m, provider }));
    };
    return { claude: listed("claude", CLAUDE_MODELS), codex: listed("codex", CODEX_MODELS) };
  }, [status]);
}

export function ModelPicker() {
  const provider = useAssistant((s) => s.chat?.provider ?? "claude");
  const model = useAssistant((s) => s.chat?.model ?? "");
  const working = useAssistant((s) => s.chat?.status === "working");
  const catalog = useCatalog();
  const [open, setOpen] = useState(false);
  const current = catalog[provider].find((m) => m.id === model);
  const label = current?.label ?? model;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <button
              type="button"
              disabled={working}
              data-slot="model-picker"
              aria-label={`Model: ${label}`}
              className={cn(
                "flex h-7 min-w-0 cursor-pointer items-center gap-1.5 rounded-md px-2 text-xs text-muted-foreground transition-colors outline-none",
                "hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 disabled:cursor-default disabled:opacity-60 disabled:hover:bg-transparent",
                open && "bg-accent text-foreground",
              )}
            >
              <ProviderIcon provider={provider} className="size-3.5" />
              <span className="truncate font-medium">{label}</span>
              <PiCaretDown className="size-3 shrink-0 opacity-70" />
            </button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent side="top">{working ? "Pick another model once it's done" : "Change the model"}</TooltipContent>
      </Tooltip>
      <PopoverContent side="top" align="start" sideOffset={8} className="w-[25rem] p-0" onOpenAutoFocus={(e) => e.preventDefault()}>
        {open && <PickerBody catalog={catalog} provider={provider} model={model} onDone={() => setOpen(false)} />}
      </PopoverContent>
    </Popover>
  );
}

function PickerBody({
  catalog,
  provider,
  model,
  onDone,
}: {
  catalog: Record<AssistantProvider, Entry[]>;
  provider: AssistantProvider;
  model: string;
  onDone: () => void;
}) {
  const status = useAssistant((s) => s.status);
  const [rail, setRail] = useState<Rail>(provider);
  const [query, setQuery] = useState("");
  const [favorites, setFavorites] = useState(storedFavorites);
  const [active, setActive] = useState(0);
  const search = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);
  useEffect(() => search.current?.focus(), []);

  const all = useMemo(() => [...catalog.claude, ...catalog.codex], [catalog]);
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    // Searching looks through every provider's models.
    if (q) return all.filter((m) => `${m.label} ${m.id} ${providerInfo(m.provider).label}`.toLowerCase().includes(q));
    if (rail === "favorites") return all.filter((m) => favorites.includes(keyOf(m)));
    return catalog[rail];
  }, [all, catalog, favorites, query, rail]);
  const current = shown.filter((m) => !m.legacy);
  const legacy = shown.filter((m) => m.legacy);
  const ordered = [...current, ...legacy];
  const railProvider = rail === "favorites" || query.trim() ? null : rail;
  const problem = railProvider ? providerStatus(status, railProvider)?.problem : null;

  useEffect(() => setActive(0), [query, rail]);
  useEffect(() => {
    list.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active]);

  const pick = (m: Entry) => {
    // The thinking level carries over when the new model has it.
    const effort = useAssistant.getState().chat?.effort ?? null;
    useAssistant.getState().setModel(m.provider, m.id, effort && m.efforts?.includes(effort) ? effort : null);
    onDone();
  };
  const toggleFavorite = (m: Entry) => {
    const key = keyOf(m);
    const next = favorites.includes(key) ? favorites.filter((k) => k !== key) : [...favorites, key];
    localStorage.setItem(FAVORITES_KEY, JSON.stringify(next));
    setFavorites(next);
  };
  const onKeyDown = (e: KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && /^[1-9]$/.test(e.key)) {
      const m = ordered[Number(e.key) - 1];
      if (m) {
        e.preventDefault();
        pick(m);
      }
    } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const step = e.key === "ArrowDown" ? 1 : -1;
      setActive((i) => (ordered.length ? (i + step + ordered.length) % ordered.length : 0));
    } else if (e.key === "Enter") {
      const m = ordered[active];
      if (m) {
        e.preventDefault();
        pick(m);
      }
    }
  };

  const row = (m: Entry, index: number) => {
    const selected = m.provider === provider && m.id === model;
    const starred = favorites.includes(keyOf(m));
    return (
      <div
        key={keyOf(m)}
        role="option"
        aria-selected={selected}
        data-index={index}
        data-model={m.id}
        onClick={() => pick(m)}
        onMouseMove={() => setActive(index)}
        className={cn(
          "group/row flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2",
          index === active && "bg-accent",
        )}
      >
        <div className="grid min-w-0 flex-1 gap-0.5">
          <span className="flex items-center gap-2">
            <span className={cn("truncate text-sm", selected ? "font-semibold" : "font-medium")}>{m.label}</span>
            {m.isNew && <span className="shrink-0 rounded bg-foreground/8 px-1.5 py-px text-[10px] font-semibold tracking-wide">NEW</span>}
          </span>
          <span className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
            <ProviderIcon provider={m.provider} className="size-3" />
            <span className="truncate">{m.hint ?? providerInfo(m.provider).label}</span>
          </span>
        </div>
        {index < 9 && (
          <kbd className="shrink-0 rounded-md border bg-muted/60 px-1.5 py-0.5 font-sans text-[11px] text-muted-foreground tabular-nums">⌘{index + 1}</kbd>
        )}
        <button
          type="button"
          aria-label={starred ? `Unstar ${m.label}` : `Star ${m.label}`}
          onClick={(e) => {
            e.stopPropagation();
            toggleFavorite(m);
          }}
          className={cn(
            "grid size-6 shrink-0 cursor-pointer place-items-center rounded-md text-muted-foreground hover:text-foreground",
            starred ? "text-amber-400 hover:text-amber-300" : "opacity-60 group-hover/row:opacity-100",
          )}
        >
          {starred ? <PiStarFill className="size-3.5" /> : <PiStar className="size-3.5" />}
        </button>
      </div>
    );
  };

  return (
    <div className="flex h-[23rem]" onKeyDown={onKeyDown}>
      <div className="flex w-13 shrink-0 flex-col items-center gap-1 border-r py-2" role="tablist" aria-label="Providers">
        <RailButton label="Starred" selected={rail === "favorites" && !query} onClick={() => setRail("favorites")}>
          <PiStarFill className="size-4.5 text-muted-foreground" />
        </RailButton>
        <div className="my-1 h-px w-7 bg-border" />
        {ASSISTANT_PROVIDERS.map((p) => (
          <RailButton key={p.id} label={p.label} selected={rail === p.id && !query} onClick={() => setRail(p.id)}>
            <ProviderIcon provider={p.id} className="size-5" />
          </RailButton>
        ))}
      </div>
      <div className="flex min-w-0 flex-1 flex-col">
        <label className="flex h-11 shrink-0 items-center gap-2 border-b px-3.5 text-muted-foreground">
          <PiMagnifyingGlass className="size-4 shrink-0" />
          <input
            ref={search}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search models…"
            aria-label="Search models"
            className="min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground"
          />
        </label>
        <div ref={list} role="listbox" aria-label="Models" className="min-h-0 flex-1 overflow-y-auto p-1.5">
          {problem && (
            <div className="mx-1.5 mt-1 mb-2 flex gap-2 rounded-lg border border-amber-500/25 bg-amber-500/8 px-2.5 py-2 text-xs leading-relaxed text-muted-foreground">
              <PiWarningCircle className="mt-0.5 size-3.5 shrink-0 text-amber-500" />
              <span>{problem.replace(/`/g, "")}</span>
            </div>
          )}
          {ordered.length === 0 && (
            <p className="px-3 py-8 text-center text-xs text-muted-foreground">
              {query ? "No models match." : "Star models to keep them here."}
            </p>
          )}
          {current.map((m, i) => row(m, i))}
          {legacy.length > 0 && (
            <>
              <div className="px-3 pt-3 pb-1 text-[11px] font-medium text-muted-foreground/80">Legacy models</div>
              {legacy.map((m, i) => row(m, current.length + i))}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function RailButton({ label, selected, onClick, children }: { label: string; selected: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          role="tab"
          aria-selected={selected}
          aria-label={label}
          onClick={onClick}
          className={cn(
            "relative grid size-9 cursor-pointer place-items-center rounded-lg transition-colors hover:bg-accent",
            selected && "bg-accent before:absolute before:top-2 before:-left-2 before:h-5 before:w-0.75 before:rounded-full before:bg-foreground/70",
          )}
        >
          {children}
        </button>
      </TooltipTrigger>
      <TooltipContent side="left">{label}</TooltipContent>
    </Tooltip>
  );
}

/** How hard the model thinks: the levels it offers, or its default. Hidden for models without levels. */
export function EffortPicker() {
  const provider = useAssistant((s) => s.chat?.provider ?? "claude");
  const model = useAssistant((s) => s.chat?.model ?? "");
  const effort = useAssistant((s) => s.chat?.effort ?? null);
  const working = useAssistant((s) => s.chat?.status === "working");
  const info = useCatalog()[provider].find((m) => m.id === model);
  const efforts = info?.efforts ?? [];
  if (efforts.length === 0) return null;
  const fallback = info?.defaultEffort ? `Auto (${effortLabel(info.defaultEffort)})` : "Auto";
  const set = (next: string | null) => useAssistant.getState().setModel(provider, model, next);
  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              disabled={working}
              data-slot="effort-picker"
              aria-label={`Thinking: ${effort ? effortLabel(effort) : "default"}`}
              className={cn(
                "flex h-7 shrink-0 cursor-pointer items-center gap-1 rounded-md px-2 text-xs text-muted-foreground transition-colors outline-none",
                "hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 disabled:cursor-default disabled:opacity-60 disabled:hover:bg-transparent",
                "data-[state=open]:bg-accent data-[state=open]:text-foreground",
              )}
            >
              <PiBrain className="size-3.5" />
              {effort ? effortLabel(effort) : "Auto"}
              <PiCaretDown className="size-3 opacity-70" />
            </button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent side="top">{working ? "Change it once it's done" : "How hard it thinks: higher is slower and more thorough"}</TooltipContent>
      </Tooltip>
      <DropdownMenuContent side="top" align="start" className="w-48">
        <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">Thinking</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => set(null)} className="gap-2">
          <span className="flex-1">{fallback}</span>
          {effort === null && <PiCheck className="size-3.5 text-brand" />}
        </DropdownMenuItem>
        {efforts.map((e) => (
          <DropdownMenuItem key={e} onSelect={() => set(e)} className="gap-2">
            <span className="flex-1">{effortLabel(e)}</span>
            {effort === e && <PiCheck className="size-3.5 text-brand" />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
