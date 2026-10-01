import { useEffect, useMemo, useRef, useState } from "react";
import { PiCaretRightFill, PiClock, PiSpinnerGap, PiWarning } from "react-icons/pi";
import { cn } from "cn";
import type { EnginePlugin } from "@shared/music/engine";
import { moveEffect, moveEffectTo, setEffect, trackName, updateEffect, updateMixerTrack } from "@shared/music/mixer";
import { EFFECT_SLOTS, MASTER_TRACK_ID } from "@shared/music/project";
import type { InputMonitor, MixerEffect } from "@shared/music/types";
import { Select, SelectContent, SelectItem, SelectLabel, SelectSeparator, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useSettings } from "@/stores/settings";
import { inputChoices, inputKey, inputLabel, useInputs } from "../inputs";
import { setTrackInput } from "../recording";
import { ArmButton } from "./arm-button";
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuTrigger } from "@/components/ui/context-menu";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Popover as PopoverPrimitive } from "radix-ui";
import { Popover, PopoverContent } from "@/components/ui/popover";
import { startPointerDrag } from "@/lib/pointer-drag";
import { PERCENT, SongKnob, percent } from "../knob";
import { useMusic, useSong } from "../store";
import { useTransport } from "../transport";
import { pickerItem } from "../plugin-groups";
import { Led } from "./led";
import { PluginPicker, usePluginList } from "../plugin-picker";
import { Input } from "@/components/ui/input";
import { delayText, pluginDelay } from "./latency";


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
      {trackId !== MASTER_TRACK_ID && <TrackInput trackId={trackId} name={name} />}
      <ol className="flex flex-col gap-px p-1">
        {effects.map((effect, slot) => (
          <Slot key={slot} trackId={trackId} slot={slot} effect={effect} />
        ))}
      </ol>
      <DelayCompensation trackId={trackId} />
    </aside>
  );
}

function Slot({ trackId, slot, effect }: { trackId: string; slot: number; effect: MixerEffect | null }) {
  const [choosing, setChoosing] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [dropping, setDropping] = useState<number | null>(null);
  const dragged = useRef(false);
  const commit = useMusic.getState().commit;
  const choose = (plugin: EnginePlugin) => commit((song) => setEffect(song, trackId, slot, { id: plugin.id, name: plugin.name, format: plugin.format }));
  // After a menu has closed (it gives the focus back first), or the picker would close at once.
  const openPicker = () => setTimeout(() => setChoosing(true), 0);
  /** The arrow: a loaded slot's menu, or an empty slot's plugins. */
  const openArrow = (open: boolean) => {
    if (open && !effect) setChoosing(true);
    else setMenuOpen(open);
  };

  /** A loaded effect dragged onto another slot swaps places with what's there. */
  const dragSlot = (e: React.PointerEvent<HTMLLIElement>) => {
    if (!effect || !e.currentTarget.contains(e.target as Node) || (e.target as HTMLElement).closest('[role="slider"]')) return;
    const list = e.currentTarget.closest("ol");
    // The drag holds the pointer from the press, so the click lands on the slot, not on the button pressed
    // (its name, its light): a press that doesn't become a drag is that button's click.
    const pressed = (e.target as HTMLElement).closest("button");
    let target: number | null = null;
    startPointerDrag(e, {
      threshold: 4,
      cursor: "grabbing",
      onClick: () => pressed?.click(),
      onStart: () => (dragged.current = true),
      onMove(ev) {
        const over = document.elementFromPoint(ev.clientX, ev.clientY)?.closest<HTMLElement>("[data-slot]");
        target = over && list?.contains(over) ? Number(over.dataset.slot) : null;
        setDropping(target);
      },
      onEnd() {
        setDropping(null);
        if (target !== null && target !== slot) commit((song) => moveEffectTo(song, trackId, slot, target!));
      },
      onCancel: () => setDropping(null),
    });
  };

  return (
    <Popover open={choosing} onOpenChange={setChoosing}>
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <PopoverPrimitive.Anchor asChild>
            <li
              className={cn("relative flex h-6 items-center gap-1 rounded-sm pr-1", effect ? "bg-surface-2" : "cursor-pointer bg-surface-0 hover:bg-surface-2")}
              data-slot={slot}
              onPointerDown={dragSlot}
              // An empty slot is chosen by a click anywhere on it; a drag that's just ended isn't a click.
              onClickCapture={(e) => {
                if (!dragged.current) return;
                dragged.current = false;
                e.stopPropagation();
                e.preventDefault();
              }}
              // (A menu opened from the slot is drawn elsewhere, but its clicks still bubble through here: they aren't the slot's.)
              onClick={(e) => !effect && e.currentTarget.contains(e.target as Node) && setChoosing(true)}
              onWheel={(e) => {
                if (!effect || e.deltaY === 0) return;
                commit((song) => moveEffect(song, trackId, slot, e.deltaY > 0 ? 1 : -1));
              }}
            >
              {/* Its arrow: the slot's menu (an empty slot's is the plugins); the list to choose from opens from the same place. */}
              <DropdownMenu open={menuOpen} onOpenChange={openArrow}>
                <DropdownMenuTrigger asChild>
                  <button type="button" aria-label={`Slot ${slot + 1} menu`} className="grid h-full w-5 place-items-center text-muted-foreground hover:text-foreground" onClick={(e) => e.stopPropagation()}>
                    <PiCaretRightFill className="size-2.5" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="min-w-52">
                  <SlotMenuItems menu={DROPDOWN} trackId={trackId} slot={slot} effect={effect} openPicker={openPicker} />
                </DropdownMenuContent>
              </DropdownMenu>
              {effect ? <EffectName effect={effect} /> : <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground/70 italic">{`Slot ${slot + 1}`}</span>}
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
                    <Led on={effect.enabled} size={10} />
                  </button>
                </>
              )}
              {dropping !== null && dropping !== slot && <DropMark />}
            </li>
          </PopoverPrimitive.Anchor>
        </ContextMenuTrigger>
        <ContextMenuContent className="min-w-48">
          <SlotMenuItems menu={CONTEXT} trackId={trackId} slot={slot} effect={effect} openPicker={openPicker} />
        </ContextMenuContent>
      </ContextMenu>
      <PopoverContent side="left" align="start" className="w-auto p-2" onOpenAutoFocus={(e) => e.preventDefault()}>
        <EffectPicker
          onChoose={(plugin) => {
            setChoosing(false);
            choose(plugin);
          }}
        />
      </PopoverContent>
    </Popover>
  );
}

/** The menu components a slot's menu is made of: the arrow's (a dropdown) or the right-click's. */
const DROPDOWN = { Item: DropdownMenuItem, Separator: DropdownMenuSeparator };
const CONTEXT = { Item: ContextMenuItem, Separator: ContextMenuSeparator };

/** A slot's menu, the same from its arrow and from a right-click (FL Studio's effect slot menu). */
function SlotMenuItems({ menu, trackId, slot, effect, openPicker }: { menu: typeof DROPDOWN | typeof CONTEXT; trackId: string; slot: number; effect: MixerEffect | null; openPicker: () => void }) {
  const { Item, Separator } = menu;
  const commit = useMusic.getState().commit;
  if (!effect) return <Item onSelect={openPicker}>Choose a plugin…</Item>;
  return (
    <>
      <Item onSelect={() => useTransport.getState().showEffect(effect.id, true)}>Open its window</Item>
      <Item onSelect={openPicker}>Replace…</Item>
      <Item onSelect={() => commit((song) => updateEffect(song, trackId, slot, { enabled: !effect.enabled }))}>{effect.enabled ? "Bypass" : "Enable"}</Item>
      <Separator />
      <Item disabled={slot === 0} onSelect={() => commit((song) => moveEffect(song, trackId, slot, -1))}>
        Move up
      </Item>
      <Item disabled={slot === EFFECT_SLOTS - 1} onSelect={() => commit((song) => moveEffect(song, trackId, slot, 1))}>
        Move down
      </Item>
      <Separator />
      <Item variant="destructive" onSelect={() => commit((song) => setEffect(song, trackId, slot, null))}>
        Delete
      </Item>
    </>
  );
}

/** Where a dragged effect would land: this slot, outlined. */
function DropMark() {
  return <span className="pointer-events-none absolute inset-0 rounded-sm ring-2 ring-brand ring-inset" aria-hidden />;
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

/**
 * The track's delay, FL's track delay panel: what its plugins delay its sound by (the engine waits for
 * it on every other path, so it all lines up), and a manual offset in ms for plugins that say it wrong.
 */
function DelayCompensation({ trackId }: { trackId: string }) {
  const track = useSong((song) => song.mixer.tracks.find((t) => t.id === trackId));
  const delay = useTransport((s) => (track ? pluginDelay(track, s.effects.loaded) : 0));
  const sampleRate = useTransport((s) => s.sampleRate);
  const [typing, setTyping] = useState<string | null>(null);
  if (!track) return null;
  const commitTyped = () => {
    const ms = Number((typing ?? "").replace(",", ".").replace("−", "-"));
    if (typing !== null && Number.isFinite(ms)) useMusic.getState().commit((song) => updateMixerTrack(song, trackId, { latencyOffset: ms }));
    setTyping(null);
  };
  return (
    <section className="mt-auto border-t border-line px-2 py-1.5 text-[11px]" aria-label="Delay compensation" data-testid="delay-compensation">
      <div className="flex items-center gap-1.5 text-muted-foreground">
        <PiClock className={cn("size-3.5", (delay > 0 || track.latencyOffset !== 0) && "text-brand")} aria-hidden />
        <span>Plugin delay</span>
        <span className="ml-auto text-foreground tabular-nums" data-testid="plugin-delay">
          {delay > 0 ? delayText(delay, sampleRate) : "none"}
        </span>
      </div>
      <label className="mt-1 flex items-center gap-1.5 text-muted-foreground" title="Added to what its plugins say: positive when its sound is later than that (the other tracks wait), negative when it's earlier">
        <span>Offset</span>
        <Input
          aria-label="Manual delay offset in ms"
          inputMode="decimal"
          className="ml-auto h-6 w-16 text-right text-[11px] tabular-nums"
          value={typing ?? String(track.latencyOffset)}
          onFocus={(e) => {
            setTyping(String(track.latencyOffset));
            e.currentTarget.select();
          }}
          onChange={(e) => setTyping(e.target.value)}
          onBlur={commitTyped}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === "Enter") e.currentTarget.blur();
            if (e.key === "Escape") {
              setTyping(null);
              e.currentTarget.blur();
            }
          }}
        />
        ms
        <button
          type="button"
          className="text-muted-foreground hover:text-foreground disabled:opacity-40"
          disabled={track.latencyOffset === 0}
          onClick={() => useMusic.getState().commit((song) => updateMixerTrack(song, trackId, { latencyOffset: 0 }))}
        >
          Reset
        </button>
      </label>
    </section>
  );
}

const MONITOR_NAMES: Record<InputMonitor, string> = { off: "Off", armed: "When armed", on: "On" };

/**
 * The track's input, FL Studio's (at the top of its inspector): which of the device's inputs it takes
 * (choosing one arms it), its arm switch, when the input is heard (through the track's effects), and
 * the input offset that moves its takes earlier or later.
 */
function TrackInput({ trackId, name }: { trackId: string; name: string }) {
  const track = useSong((song) => song.mixer.tracks.find((t) => t.id === trackId));
  const channels = useInputs((s) => s.channels);
  const loaded = useInputs((s) => s.loaded);
  const [typing, setTyping] = useState<string | null>(null);
  useEffect(() => {
    if (!useInputs.getState().loaded) void useInputs.getState().load();
  }, []);
  const choices = useMemo(() => inputChoices(channels), [channels]);
  if (!track) return null;
  const current = inputKey(track.input);
  const commitOffset = () => {
    const ms = Number((typing ?? "").replace(",", ".").replace("−", "-"));
    if (typing !== null && Number.isFinite(ms)) useMusic.getState().commit((song) => updateMixerTrack(song, trackId, { inputOffset: ms }));
    setTyping(null);
  };
  return (
    <section className="flex flex-col gap-1 border-b border-line px-2 py-1.5 text-[11px]" aria-label="Input" data-testid="track-input">
      <div className="flex items-center gap-1.5">
        <ArmButton trackId={trackId} name={name} size={13} />
        <Select
          value={current}
          onValueChange={(value) => {
            if (value === "settings") return useSettings.getState().show("music");
            const choice = choices.find((c) => inputKey(c.input) === value);
            void setTrackInput(trackId, choice?.input ?? null);
          }}
        >
          <SelectTrigger size="sm" className="h-6 min-w-0 flex-1 text-[11px]" aria-label="Input">
            <SelectValue placeholder="Input">{track.input ? inputLabel(track.input, channels) : "(no input)"}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="none">(no input)</SelectItem>
            {choices.length > 0 && <SelectSeparator />}
            {choices.some((c) => c.input.stereo) && <SelectLabel className="text-[10px]">Stereo</SelectLabel>}
            {choices.filter((c) => c.input.stereo).map((c) => (
              <SelectItem key={inputKey(c.input)} value={inputKey(c.input)}>
                {c.label}
              </SelectItem>
            ))}
            {choices.length > 0 && <SelectLabel className="text-[10px]">Mono</SelectLabel>}
            {choices.filter((c) => !c.input.stereo).map((c) => (
              <SelectItem key={inputKey(c.input)} value={inputKey(c.input)}>
                {c.label}
              </SelectItem>
            ))}
            {/* The track's input on a device that doesn't have it: kept, and named by number. */}
            {track.input && !choices.some((c) => inputKey(c.input) === current) && <SelectItem value={current}>{inputLabel(track.input, channels)}</SelectItem>}
            <SelectSeparator />
            <SelectItem value="settings">{loaded && !channels.length ? "Choose an input device in Settings…" : "Input device settings…"}</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <label className="flex items-center gap-1.5 text-muted-foreground">
        <span>Monitor</span>
        <Select value={track.monitor} onValueChange={(monitor) => useMusic.getState().commit((song) => updateMixerTrack(song, trackId, { monitor: monitor as InputMonitor }))}>
          <SelectTrigger size="sm" className="ml-auto h-6 w-28 text-[11px]" aria-label="Monitor input">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(Object.keys(MONITOR_NAMES) as InputMonitor[]).map((m) => (
              <SelectItem key={m} value={m}>
                {MONITOR_NAMES[m]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </label>
      <label className="flex items-center gap-1.5 text-muted-foreground" title="Moves this track's takes earlier (positive) or later, for the latency the device doesn't report: record the metronome through the mic and line its clicks up with the beat">
        <span>Input offset</span>
        <Input
          aria-label="Input offset in ms"
          inputMode="decimal"
          className="ml-auto h-6 w-16 text-right text-[11px] tabular-nums"
          value={typing ?? String(track.inputOffset)}
          onFocus={(e) => {
            setTyping(String(track.inputOffset));
            e.currentTarget.select();
          }}
          onChange={(e) => setTyping(e.target.value)}
          onBlur={commitOffset}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === "Enter") e.currentTarget.blur();
            if (e.key === "Escape") {
              setTyping(null);
              e.currentTarget.blur();
            }
          }}
        />
        ms
      </label>
    </section>
  );
}

/** The effect plugins to choose from: the big picker, by kind. */
function EffectPicker({ onChoose }: { onChoose: (plugin: EnginePlugin) => void }) {
  const { plugins, error } = usePluginList("effect", true);
  const items = useMemo(() => (plugins ?? []).map(pickerItem), [plugins]);
  return <PluginPicker noun="effect" items={items} loading={plugins === null} error={error} onChoose={(item) => item.plugin && onChoose(item.plugin)} />;
}
