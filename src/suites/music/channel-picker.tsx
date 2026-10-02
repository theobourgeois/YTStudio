import { useMemo, useState } from "react";
import { PiArrowsClockwise, PiPlus, PiSpinnerGap } from "react-icons/pi";
import type { EnginePlugin } from "@shared/music/engine";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { type PickerItem, pickerItem, starredPlugins } from "./plugin-groups";
import { usePluginFavourites } from "./plugin-favourites";
import { MorePlugins, PluginPicker, usePluginList, usePluginScan } from "./plugin-picker";
import { useMusic } from "./store";
import { showPluginWhenLoaded } from "./transport";
import { useMusicUi } from "./ui";

/** Ours, before the plugins: the Sampler. */
const BUILT_IN = "Built in";
const SAMPLER: PickerItem = { id: "sampler", name: "Sampler", detail: "Plays a sample", group: BUILT_IN, plugin: null };

/**
 * The rack's + (FL Studio's "Add one"): choose the generator a new channel plays, in the plugin picker
 * (`plugin-picker.tsx`): the Sampler, which is ours, then the instrument plugins starred in the Plugin manager
 * (of those the engine has found on this computer, VST3 and Audio Units), by kind, the pinned first.
 */
export function ChannelPicker() {
  const [open, setOpen] = useState(false);
  const add = (plugin: EnginePlugin | null) => {
    const id = useMusic.getState().addChannel(plugin && { id: plugin.id, name: plugin.name, format: plugin.format });
    setOpen(false);
    if (!id) return;
    useMusicUi.getState().setSelection([id]);
    // A sampler has nothing to play yet: its window is where it's given a sample. A plugin's own window
    // opens once it's loaded, as FL Studio's do.
    if (!plugin) useMusicUi.getState().openChannelWindow(id);
    else showPluginWhenLoaded(id);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label="Add a channel"
          title="Add a channel: choose its instrument"
          className="raised grid h-5 w-8 place-items-center rounded-sm text-muted-foreground hover:raised-hover hover:text-foreground active:pressed"
        >
          <PiPlus className="size-3" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-auto p-2" data-testid="channel-picker" onOpenAutoFocus={(e) => e.preventDefault()}>
        <InstrumentPicker open={open} onChoose={add} onMore={() => setOpen(false)} />
      </PopoverContent>
    </Popover>
  );
}

/**
 * The instruments to choose from (the Sampler, then the instrument plugins starred in the Plugin manager),
 * with More plugins… and Scan for plugins: the inside of the rack's + and of a channel's Replace. `open`:
 * the list is loaded while it's shown; `onMore` closes what it's in as the Plugin manager opens.
 */
export function InstrumentPicker({ open, onChoose, onMore }: { open: boolean; onChoose: (plugin: EnginePlugin | null) => void; onMore: () => void }) {
  const { plugins, error, reload } = usePluginList("instrument", open);
  const starred = usePluginFavourites((s) => s.starred);
  const { scanning, error: scanError, scan } = usePluginScan(reload);
  const shown = useMemo(() => starredPlugins(plugins ?? [], starred), [plugins, starred]);
  const items = useMemo(() => [SAMPLER, ...shown.map(pickerItem)], [shown]);

  return (
    <PluginPicker
      noun="instrument"
      items={items}
      loading={plugins === null}
      error={error ?? scanError}
      firstGroups={[BUILT_IN]}
      onChoose={(item) => onChoose(item.plugin)}
      footer={
        <MorePlugins
          hidden={(plugins?.length ?? 0) - shown.length}
          onMore={() => {
            onMore();
            useMusicUi.getState().setPluginManager("instrument");
          }}
        >
          <button
            type="button"
            className="ml-auto flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-50"
            disabled={scanning !== null}
            title={scanning ?? "Look for plugins installed since"}
            onClick={() => void scan()}
          >
            {scanning !== null ? <PiSpinnerGap className="size-3.5 animate-spin" /> : <PiArrowsClockwise className="size-3.5" />}
            {scanning !== null ? "Scanning…" : "Scan for plugins"}
          </button>
        </MorePlugins>
      }
    />
  );
}
