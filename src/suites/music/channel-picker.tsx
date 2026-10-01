import { useMemo, useState } from "react";
import { PiArrowsClockwise, PiPlus, PiSpinnerGap } from "react-icons/pi";
import { errorMessage } from "@shared/errors";
import type { EnginePlugin } from "@shared/music/engine";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { musicApi } from "./api";
import { type PickerItem, pickerItem } from "./plugin-groups";
import { PluginPicker, usePluginList } from "./plugin-picker";
import { useMusic } from "./store";
import { useMusicUi } from "./ui";

/** Ours, before the plugins: the Sampler. */
const BUILT_IN = "Built in";
const SAMPLER: PickerItem = { id: "sampler", name: "Sampler", detail: "Plays a sample", group: BUILT_IN, plugin: null };

/**
 * The rack's + (FL Studio's "Add one"): choose the generator a new channel plays, in the plugin picker
 * (`plugin-picker.tsx`): the Sampler, which is ours, then the instrument plugins the engine has found on
 * this computer (VST3 and Audio Units), by kind, the pinned first.
 */
export function ChannelPicker() {
  const [open, setOpen] = useState(false);
  const add = (plugin: EnginePlugin | null) => {
    const id = useMusic.getState().addChannel(plugin && { id: plugin.id, name: plugin.name, format: plugin.format });
    setOpen(false);
    if (!id) return;
    useMusicUi.getState().setSelection([id]);
    // A sampler has nothing to play yet: its window is where it's given a sample.
    if (!plugin) useMusicUi.getState().openChannelWindow(id);
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
        <InstrumentPicker open={open} onChoose={add} />
      </PopoverContent>
    </Popover>
  );
}

/**
 * The instruments to choose from (the Sampler, then the instrument plugins), with Scan for plugins: the
 * inside of the rack's + and of a channel's Replace. `open`: the list is loaded while it's shown.
 */
export function InstrumentPicker({ open, onChoose }: { open: boolean; onChoose: (plugin: EnginePlugin | null) => void }) {
  const { plugins, error, reload } = usePluginList("instrument", open);
  const [scanning, setScanning] = useState<string | null>(null);
  const [scanError, setScanError] = useState<string | null>(null);
  const items = useMemo(() => [SAMPLER, ...(plugins ?? []).map(pickerItem)], [plugins]);

  /** Look for plugins again (a new one was installed), and wait for the engine to finish. */
  async function scan() {
    try {
      let status = await musicApi.engine("scan", { rescan: true });
      while (status.scanning) {
        setScanning(status.scanning.name.split("/").pop() ?? "");
        await new Promise((resolve) => setTimeout(resolve, 250));
        status = await musicApi.engine("status", {});
      }
      await reload();
    } catch (err) {
      setScanError(errorMessage(err));
    }
    setScanning(null);
  }

  return (
    <PluginPicker
      noun="instrument"
      items={items}
      loading={plugins === null}
      error={error ?? scanError}
      firstGroups={[BUILT_IN]}
      onChoose={(item) => onChoose(item.plugin)}
      footer={
        <div className="flex items-center gap-2 border-t border-line pt-2">
          <button
            type="button"
            className="flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-50"
            disabled={scanning !== null}
            onClick={() => void scan()}
          >
            {scanning !== null ? <PiSpinnerGap className="size-3.5 animate-spin" /> : <PiArrowsClockwise className="size-3.5" />}
            {scanning !== null ? "Scanning…" : "Scan for plugins"}
          </button>
          {scanning && <span className="min-w-0 flex-1 truncate text-[11px] text-muted-foreground">{scanning}</span>}
        </div>
      }
    />
  );
}
