import { useEffect, useState } from "react";
import { PiCaretRightFill, PiSpinnerGap, PiWarning } from "react-icons/pi";
import { cn } from "cn";
import { errorMessage } from "@shared/errors";
import type { EnginePlugin } from "@shared/music/engine";
import { moveEffect, setEffect, trackName, updateEffect } from "@shared/music/mixer";
import type { MixerEffect } from "@shared/music/types";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { musicApi } from "../api";
import { PERCENT, SongKnob, percent } from "../knob";
import { useMusic, useSong } from "../store";
import { useTransport } from "../transport";

/** The effect plugins found on this computer, read once and kept between openings of a slot's menu. */
let found: EnginePlugin[] | null = null;

function useEffectPlugins(open: boolean): { plugins: EnginePlugin[] | null; error: string | null } {
  const [plugins, setPlugins] = useState(found);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!open || found) return;
    musicApi.listEnginePlugins().then(
      (list) => {
        found = list.filter((p) => !p.isInstrument).sort((a, b) => a.name.localeCompare(b.name));
        setPlugins(found);
      },
      (err) => setError(errorMessage(err)),
    );
  }, [open]);
  return { plugins, error };
}

/**
 * The selected track's inspector, on the mixer's right as in FL Studio: its name and its ten effect
 * slots, each with its menu (choose a plugin, replace, delete, move), its name (a click opens the
 * plugin's window), its mix knob and its on light. The mouse wheel over a slot moves its effect up or down.
 */
export function Inspector({ trackId }: { trackId: string }) {
  const effects = useSong((song) => song.mixer.tracks.find((t) => t.id === trackId)?.effects);
  const name = useSong((song) => trackName(song, trackId));
  if (!effects) return null;
  return (
    <aside className="flex w-56 shrink-0 flex-col border-l border-line bg-surface-1" aria-label={`${name}: effects`} data-testid="mixer-inspector">
      <div className="truncate border-b border-line px-2 py-1 text-xs font-medium">{name}</div>
      <ol className="flex flex-col gap-px p-1">
        {effects.map((effect, slot) => (
          <Slot key={slot} trackId={trackId} slot={slot} effect={effect} />
        ))}
      </ol>
    </aside>
  );
}

function Slot({ trackId, slot, effect }: { trackId: string; slot: number; effect: MixerEffect | null }) {
  const [open, setOpen] = useState(false);
  const { plugins, error } = useEffectPlugins(open);
  const commit = useMusic.getState().commit;
  const choose = (plugin: EnginePlugin) => commit((song) => setEffect(song, trackId, slot, { id: plugin.id, name: plugin.name, format: plugin.format }));
  const list = (
    <>
      {error && <DropdownMenuLabel className="text-destructive">{error}</DropdownMenuLabel>}
      {plugins === null && !error && <DropdownMenuLabel className="text-muted-foreground">Looking for plugins…</DropdownMenuLabel>}
      {plugins?.length === 0 && <DropdownMenuLabel className="text-muted-foreground">No effect plugins found</DropdownMenuLabel>}
      <div className="max-h-72 overflow-y-auto">
        {plugins?.map((plugin) => (
          <DropdownMenuItem key={plugin.id} onSelect={() => choose(plugin)}>
            {plugin.name}
            <span className="ml-auto pl-3 text-[10px] text-muted-foreground">{plugin.format === "AudioUnit" ? "AU" : plugin.format}</span>
          </DropdownMenuItem>
        ))}
      </div>
    </>
  );

  return (
    <li
      className={cn("flex h-6 items-center gap-1 rounded-sm pr-1", effect ? "bg-surface-2" : "bg-surface-0")}
      data-slot={slot}
      onWheel={(e) => {
        if (!effect || e.deltaY === 0) return;
        commit((song) => moveEffect(song, trackId, slot, e.deltaY > 0 ? 1 : -1));
      }}
    >
      <DropdownMenu open={open} onOpenChange={setOpen}>
        <DropdownMenuTrigger asChild>
          <button type="button" aria-label={`Slot ${slot + 1} menu`} className="grid h-full w-5 place-items-center text-muted-foreground hover:text-foreground">
            <PiCaretRightFill className="size-2.5" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="min-w-52">
          {effect ? (
            <>
              <DropdownMenuSub>
                <DropdownMenuSubTrigger>Replace</DropdownMenuSubTrigger>
                <DropdownMenuSubContent className="min-w-52">{list}</DropdownMenuSubContent>
              </DropdownMenuSub>
              <DropdownMenuItem variant="destructive" onSelect={() => commit((song) => setEffect(song, trackId, slot, null))}>
                Delete
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem disabled={slot === 0} onSelect={() => commit((song) => moveEffect(song, trackId, slot, -1))}>
                Move up
              </DropdownMenuItem>
              <DropdownMenuItem disabled={slot === 9} onSelect={() => commit((song) => moveEffect(song, trackId, slot, 1))}>
                Move down
              </DropdownMenuItem>
            </>
          ) : (
            list
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      {effect ? (
        <EffectName effect={effect} />
      ) : (
        <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground/70 italic">{`Slot ${slot + 1}`}</span>
      )}
      {effect && (
        <>
          <SongKnob size={18} label={`${effect.plugin.name} mix`} value={effect.mix} min={0} max={1} defaultValue={1} format={percent} unit={PERCENT} edit={(song, mix) => updateEffect(song, trackId, slot, { mix })} />
          <button
            type="button"
            aria-label={effect.enabled ? `Bypass ${effect.plugin.name}` : `Enable ${effect.plugin.name}`}
            aria-pressed={effect.enabled}
            className="group grid size-4 place-items-center rounded-full"
            onClick={() => commit((song) => updateEffect(song, trackId, slot, { enabled: !effect.enabled }))}
          >
            <span className={cn("size-2 rounded-full", effect.enabled ? "border border-brand-edge bg-brand shadow-[0_0_4px] shadow-brand/70" : "sunken")} />
          </button>
        </>
      )}
    </li>
  );
}

/**
 * A loaded effect's name: a click opens its window (or closes it), as in FL Studio; while it loads, a
 * spinner; if it couldn't be loaded, a warning and why.
 */
function EffectName({ effect }: { effect: MixerEffect }) {
  const open = useTransport((s) => s.effects.loaded.some((e) => e.effect === effect.id && e.editorOpen));
  const loaded = useTransport((s) => s.effects.loaded.some((e) => e.effect === effect.id));
  const loading = useTransport((s) => s.effects.loading.includes(effect.id));
  const error = useTransport((s) => s.effects.failed.find((e) => e.effect === effect.id)?.error ?? null);
  return (
    <button
      type="button"
      aria-label={`${effect.plugin.name}: ${open ? "close its window" : "open its window"}`}
      aria-pressed={open}
      disabled={!loaded}
      title={error ?? (loading ? `${effect.plugin.name}: loading…` : `${effect.plugin.name} (${effect.plugin.format}): click for its window`)}
      className={cn("flex min-w-0 flex-1 items-center gap-1 text-left text-xs", open ? "text-brand" : "hover:text-brand", !effect.enabled && "text-muted-foreground line-through", error && "text-destructive")}
      onClick={() => useTransport.getState().showEffect(effect.id, !open)}
    >
      <span className="truncate">{effect.plugin.name}</span>
      {loading && <PiSpinnerGap className="size-3 shrink-0 animate-spin" aria-label="Loading the plugin" />}
      {error && <PiWarning className="size-3 shrink-0" aria-label="The plugin couldn't be loaded" />}
    </button>
  );
}
