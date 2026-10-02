import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { PiArrowsClockwise, PiMagnifyingGlass, PiSpinnerGap, PiStar, PiStarFill } from "react-icons/pi";
import { cn } from "cn";
import { errorMessage } from "@shared/errors";
import type { EnginePlugin } from "@shared/music/engine";
import { Input } from "@/components/ui/input";
import { musicApi } from "./api";
import { type ManagerFilter, OTHER, managerRows, pluginGroup } from "./plugin-groups";
import { usePluginFavourites } from "./plugin-favourites";
import { usePluginScan } from "./plugin-picker";
import { useMusicUi } from "./ui";
import { MusicWindow, centredOnDesktop } from "./window";

const W = 560;
const H = 480;
const FILTERS: { id: ManagerFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "instrument", label: "Instruments" },
  { id: "effect", label: "Effects" },
  { id: "starred", label: "Starred" },
];

/**
 * FL Studio's Plugin manager (a picker's More plugins…): every plugin found on this computer, a star on
 * each. The pickers list only ours and the starred (`usePluginFavourites`), so the dozens that come with
 * macOS and installers stay out of the way until they're wanted. A click on a row stars or unstars it.
 */
export function PluginManager() {
  const opened = useMusicUi((s) => s.pluginManager) ?? "all";
  const [filter, setFilter] = useState<ManagerFilter>(opened);
  // Opened again from another picker while it's open: it shows that picker's kind.
  useEffect(() => setFilter(opened), [opened]);
  const [query, setQuery] = useState("");
  const [plugins, setPlugins] = useState<EnginePlugin[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const starred = usePluginFavourites((s) => s.starred);
  const field = useRef<HTMLInputElement>(null);
  const load = useCallback(
    () =>
      musicApi.listEnginePlugins().then(
        (list) => {
          setPlugins(list);
          setError(null);
        },
        (err) => setError(errorMessage(err)),
      ),
    [],
  );
  const { scanning, error: scanError, scan } = usePluginScan(load);
  useEffect(() => {
    void load();
    const timer = setTimeout(() => field.current?.focus(), 0);
    return () => clearTimeout(timer);
  }, [load]);
  const rows = useMemo(() => managerRows(plugins ?? [], starred, query, filter), [plugins, starred, query, filter]);
  const starredCount = useMemo(() => (plugins ?? []).filter((p) => starred.includes(p.id)).length, [plugins, starred]);
  const close = () => useMusicUi.getState().setPluginManager(null);

  return (
    <MusicWindow id="plugins" title="Plugin manager" initial={{ ...centredOnDesktop(W, H), width: W, height: H }} onClose={close} resizable={{ minWidth: 380, minHeight: 260 }}>
      <div className="flex min-h-0 flex-1 flex-col" data-testid="plugin-manager">
        <div className="flex items-center gap-2 border-b border-line px-2 py-1.5">
          <label className="flex min-w-0 flex-1 items-center gap-1.5">
            <PiMagnifyingGlass className="size-3.5 shrink-0 text-muted-foreground" />
            <Input
              ref={field}
              aria-label="Find a plugin"
              placeholder="Find a plugin: its name, maker or kind"
              className="h-7 text-xs"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                // The editor's keys (Space plays) aren't for here.
                e.stopPropagation();
                if (e.key === "Escape") close();
              }}
            />
          </label>
          <div className="flex shrink-0 rounded-sm border border-line" role="group" aria-label="Show">
            {FILTERS.map((f) => (
              <button
                key={f.id}
                type="button"
                aria-pressed={filter === f.id}
                className={cn("px-2 py-1 text-[11px] first:rounded-l-sm last:rounded-r-sm", filter === f.id ? "pressed text-foreground" : "text-muted-foreground hover:text-foreground")}
                onClick={() => setFilter(f.id)}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto py-0.5" role="list" aria-label="Plugins">
          {rows.map((plugin) => (
            <PluginRow key={plugin.id} plugin={plugin} starred={starred.includes(plugin.id)} />
          ))}
          {!rows.length && (
            <p className="p-4 text-center text-xs text-muted-foreground">
              {error ? (
                <span className="text-destructive">{error}</span>
              ) : plugins === null ? (
                "Looking for plugins…"
              ) : query ? (
                `No plugin matches "${query}".`
              ) : filter === "starred" ? (
                "None starred yet: star the plugins you use, and the pickers list them."
              ) : (
                "No plugins found yet: Scan for plugins looks again."
              )}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2 border-t border-line px-2.5 py-1.5 text-[11px] text-muted-foreground">
          <span className="min-w-0 flex-1 truncate">
            {scanError ? <span className="text-destructive">{scanError}</span> : scanning ? `Scanning ${scanning}` : `${starredCount} of ${plugins?.length ?? 0} starred. The pickers list the built-in ones and the starred.`}
          </span>
          <button
            type="button"
            className="flex shrink-0 items-center gap-1.5 rounded-md px-2 py-1 hover:bg-accent hover:text-foreground disabled:opacity-50"
            disabled={scanning !== null}
            onClick={() => void scan()}
          >
            {scanning !== null ? <PiSpinnerGap className="size-3.5 animate-spin" /> : <PiArrowsClockwise className="size-3.5" />}
            {scanning !== null ? "Scanning…" : "Scan for plugins"}
          </button>
        </div>
      </div>
    </MusicWindow>
  );
}

/** What a plugin is: its group (Synth, EQ...), else an instrument or an effect. */
function kindOf(plugin: EnginePlugin): string {
  const group = pluginGroup(plugin);
  return group !== OTHER ? group : plugin.isInstrument ? "Instrument" : "Effect";
}

function PluginRow({ plugin, starred }: { plugin: EnginePlugin; starred: boolean }) {
  const toggle = () => usePluginFavourites.getState().toggle(plugin.id);
  return (
    <div
      role="listitem"
      aria-label={plugin.name}
      data-plugin={plugin.id}
      className="group flex h-6 cursor-pointer items-center gap-2 px-2 text-[12px] hover:bg-accent/60"
      onClick={toggle}
      title={starred ? "Starred: the pickers list it. Click to unstar" : "Click to star it: the pickers list it"}
    >
      <button
        type="button"
        aria-label={starred ? `Unstar ${plugin.name}` : `Star ${plugin.name}`}
        aria-pressed={starred}
        className={cn("grid size-4 shrink-0 place-items-center", starred ? "text-brand" : "text-muted-foreground/60 group-hover:text-muted-foreground")}
        onClick={(e) => {
          e.stopPropagation();
          toggle();
        }}
      >
        {starred ? <PiStarFill className="size-3.5" /> : <PiStar className="size-3.5" />}
      </button>
      <span className={cn("min-w-0 flex-1 truncate", starred && "text-foreground")}>{plugin.name}</span>
      <span className="w-28 shrink-0 truncate text-muted-foreground">{plugin.manufacturer}</span>
      <span className="w-20 shrink-0 truncate text-muted-foreground">{kindOf(plugin)}</span>
      <span className="w-9 shrink-0 text-right text-[10px] text-muted-foreground/70">{plugin.format === "AudioUnit" ? "AU" : plugin.format}</span>
    </div>
  );
}
