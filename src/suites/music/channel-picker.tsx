import { useEffect, useState } from "react";
import { PiArrowsClockwise, PiPlus, PiSpinnerGap, PiWaveform } from "react-icons/pi";
import { errorMessage } from "@shared/errors";
import type { EnginePlugin } from "@shared/music/engine";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { musicApi } from "./api";
import { useMusic } from "./store";
import { useMusicUi } from "./ui";

/** The instruments found on this computer, read once and kept between openings of the picker. */
let found: EnginePlugin[] | null = null;

/**
 * The rack's + (FL Studio's "Add one"): choose the generator a new channel plays. The Sampler, which
 * is ours, then the instrument plugins the engine has found on this computer (VST3 and Audio Units).
 */
export function ChannelPicker() {
  const [open, setOpen] = useState(false);
  const [plugins, setPlugins] = useState<EnginePlugin[] | null>(found);
  const [scanning, setScanning] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  const load = () =>
    musicApi.listEnginePlugins().then(
      (list) => {
        found = list.filter((p) => p.isInstrument).sort((a, b) => a.name.localeCompare(b.name));
        setPlugins(found);
        setError(null);
      },
      (err) => setError(errorMessage(err)),
    );
  useEffect(() => {
    if (open) void load();
  }, [open]);

  /** Look for plugins again (a new one was installed), and wait for the engine to finish. */
  async function scan() {
    try {
      let status = await musicApi.engine("scan", { rescan: true });
      while (status.scanning) {
        setScanning(status.scanning.name.split("/").pop() ?? "");
        await new Promise((resolve) => setTimeout(resolve, 250));
        status = await musicApi.engine("status", {});
      }
      await load();
    } catch (err) {
      setError(errorMessage(err));
    }
    setScanning(null);
  }

  const add = (plugin: EnginePlugin | null) => {
    const id = useMusic.getState().addChannel(plugin && { id: plugin.id, name: plugin.name, format: plugin.format });
    setOpen(false);
    setQuery("");
    if (!id) return;
    useMusicUi.getState().setSelection([id]);
    // A sampler has nothing to play yet: its window is where it's given a sample.
    if (!plugin) useMusicUi.getState().openChannelWindow(id);
  };

  const wanted = query.trim().toLowerCase();
  const shown = (plugins ?? []).filter((p) => !wanted || p.name.toLowerCase().includes(wanted) || p.manufacturer.toLowerCase().includes(wanted));

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
      <PopoverContent align="start" className="w-72 p-2" data-testid="channel-picker">
        <Input aria-label="Find an instrument" placeholder="Find an instrument" className="mb-2 h-8" value={query} onChange={(e) => setQuery(e.target.value)} autoFocus />
        <div className="flex max-h-72 flex-col overflow-y-auto" role="listbox" aria-label="Instruments">
          {(!wanted || "sampler".includes(wanted)) && (
            <Row name="Sampler" detail="Plays a sample" onPick={() => add(null)}>
              <PiWaveform className="size-4 text-brand" />
            </Row>
          )}
          {shown.map((plugin) => (
            <Row key={plugin.id} name={plugin.name} detail={`${plugin.manufacturer} · ${plugin.format === "AudioUnit" ? "AU" : plugin.format}`} onPick={() => add(plugin)} />
          ))}
          {plugins !== null && plugins.length === 0 && !scanning && <p className="px-2 py-3 text-xs text-muted-foreground">No instrument plugins found yet. Scan to look for them.</p>}
        </div>
        {error && <p className="mt-2 text-xs text-destructive">{error}</p>}
        <div className="mt-2 flex items-center gap-2 border-t pt-2">
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
      </PopoverContent>
    </Popover>
  );
}

function Row({ name, detail, onPick, children }: { name: string; detail: string; onPick: () => void; children?: React.ReactNode }) {
  return (
    <button type="button" role="option" aria-selected={false} className="flex items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-accent" onClick={onPick}>
      <span className="grid size-4 shrink-0 place-items-center">{children}</span>
      <span className="min-w-0 flex-1 truncate text-[13px]">{name}</span>
      <span className="shrink-0 text-[11px] text-muted-foreground">{detail}</span>
    </button>
  );
}
