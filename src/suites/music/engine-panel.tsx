import { useCallback, useEffect, useRef, useState } from "react";
import { PiArrowsClockwise, PiSpinnerGap } from "react-icons/pi";
import { cn } from "cn";
import { errorMessage } from "@shared/errors";
import type { EngineCommand, EngineCommands, EnginePlugin, EngineSlot, EngineStatus } from "@shared/music/engine";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { api } from "@/lib/api";

/** How often the status is read: the meter, a scan's progress, a plugin window closed by hand. */
const POLL_MS = 200;
/** One octave from middle C, as MIDI notes. */
const KEYS = Array.from({ length: 13 }, (_, i) => 60 + i);
const NOTE_NAMES = ["C", "C♯", "D", "D♯", "E", "F", "F♯", "G", "G♯", "A", "A♯", "B"];
const isBlack = (pitch: number) => NOTE_NAMES[pitch % 12].length > 1;

const SLOT_LABELS: Record<EngineSlot, { title: string; hint: string }> = {
  instrument: { title: "Instrument", hint: "Plays the keys below." },
  effect: { title: "Effect", hint: "The instrument and the tone go through it." },
};

/**
 * The audio engine's test bench (the spike before the real music editor): scan for plugins, load an
 * instrument and an effect, open their windows, play notes and save and restore their state.
 */
export function EnginePanel() {
  const [status, setStatus] = useState<EngineStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [plugins, setPlugins] = useState<EnginePlugin[]>([]);
  const [roundTrip, setRoundTrip] = useState<number | null>(null);
  const [busy, setBusy] = useState<EngineSlot | null>(null);
  const wasScanning = useRef(false);

  const run = useCallback(async <C extends EngineCommand>(command: C, body: EngineCommands[C]) => {
    try {
      const next = await api.engine(command, body);
      setStatus(next);
      setError(null);
      return next;
    } catch (err) {
      setError(errorMessage(err));
      return null;
    }
  }, []);

  const loadPlugins = useCallback(() => {
    api.listEnginePlugins().then(setPlugins, () => {});
  }, []);

  useEffect(() => {
    let stopped = false;
    let timer = 0;
    const tick = async () => {
      const started = performance.now();
      const next = await run("status", {});
      if (stopped) return;
      if (next) setRoundTrip(performance.now() - started);
      timer = window.setTimeout(tick, next ? POLL_MS : 2000);
    };
    void tick();
    loadPlugins();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [run, loadPlugins]);

  // The list is complete once a scan ends.
  const scanning = status?.scanning ?? null;
  useEffect(() => {
    if (wasScanning.current && !scanning) loadPlugins();
    wasScanning.current = !!scanning;
  }, [scanning, loadPlugins]);

  const load = async (slot: EngineSlot, pluginId: string) => {
    setBusy(slot);
    await run("load", { slot, pluginId });
    setBusy(null);
  };

  return (
    <section className="min-h-0 flex-1 overflow-y-auto bg-stage p-8" aria-label="Audio engine">
      <div className="mx-auto flex max-w-2xl flex-col gap-4">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">Audio engine</h1>
          <p className="mt-1 text-sm leading-6 text-muted-foreground">
            The music editor is being built. This is its engine on a test bench: your plugins, loaded and played.
          </p>
        </div>

        {error && (
          <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </p>
        )}

        <Card>
          <div className="flex items-center gap-3">
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{status ? (status.device ?? "No output device") : "Starting…"}</p>
              {status && (
                <p className="text-xs text-muted-foreground tabular-nums" data-testid="engine-device">
                  {(status.sampleRate / 1000).toFixed(1)} kHz · {status.bufferSize} samples · {status.outputLatencyMs.toFixed(0)} ms out
                  {roundTrip !== null && ` · ${roundTrip.toFixed(0)} ms to the engine and back`}
                </p>
              )}
            </div>
            <Meter peak={status?.peak ?? 0} />
          </div>
          <label className="mt-3 flex items-center gap-2 text-sm">
            <Switch checked={status?.tone ?? false} disabled={!status} onCheckedChange={(on) => void run("tone", { on })} />
            Test tone
          </label>
        </Card>

        <Card>
          <div className="flex items-center gap-3">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium">Plugins</p>
              <p className="truncate text-xs text-muted-foreground">
                {scanning ? `Scanning ${scanning.name.split("/").pop() ?? ""}` : `${status?.pluginCount ?? 0} found (VST3 and Audio Units)`}
              </p>
            </div>
            <Button variant="outline" size="sm" disabled={!status || !!scanning} onClick={() => void run("scan", { rescan: true })}>
              {scanning ? <PiSpinnerGap className="animate-spin" /> : <PiArrowsClockwise />}
              Scan
            </Button>
          </div>
          {scanning && <Progress className="mt-3" value={scanning.progress * 100} />}
        </Card>

        {(["instrument", "effect"] as const).map((slot) => {
          const loaded = status?.[slot] ?? null;
          const choices = plugins.filter((p) => p.isInstrument === (slot === "instrument"));
          return (
            <Card key={slot} data-slot-name={slot}>
              <p className="text-sm font-medium">{SLOT_LABELS[slot].title}</p>
              <p className="text-xs text-muted-foreground">{SLOT_LABELS[slot].hint}</p>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <Select value={loaded?.id ?? ""} disabled={!status || busy === slot} onValueChange={(id) => void load(slot, id)}>
                  <SelectTrigger size="sm" className="w-64" aria-label={`${SLOT_LABELS[slot].title} plugin`}>
                    <SelectValue placeholder={choices.length ? "Choose a plugin" : "Scan for plugins first"} />
                  </SelectTrigger>
                  <SelectContent>
                    {choices.map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.name}
                        <span className="text-xs text-muted-foreground">{p.format === "AudioUnit" ? "AU" : p.format}</span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {busy === slot && <PiSpinnerGap className="size-4 animate-spin text-muted-foreground" />}
                {loaded && (
                  <>
                    <Button variant="outline" size="sm" onClick={() => void run("editor", { slot, open: !loaded.editorOpen })}>
                      {loaded.editorOpen ? "Close window" : "Open window"}
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => void run("saveState", { slot })}>
                      Save state
                    </Button>
                    <Button variant="ghost" size="sm" disabled={!loaded.hasSavedState} onClick={() => void run("restoreState", { slot })}>
                      Restore
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => void run("unload", { slot })}>
                      Remove
                    </Button>
                  </>
                )}
              </div>
            </Card>
          );
        })}

        <Card>
          <p className="text-sm font-medium">Keys</p>
          <div className="mt-3 flex gap-1" role="group" aria-label="Keys">
            {KEYS.map((pitch) => (
              <Key key={pitch} pitch={pitch} disabled={!status?.instrument} onNote={(on) => void run("note", { pitch, on })} />
            ))}
          </div>
        </Card>
      </div>
    </section>
  );
}

function Card({ className, ...props }: React.ComponentProps<"div">) {
  return <div className={cn("rounded-xl border bg-card p-4", className)} {...props} />;
}

/** The output level, on a scale where the last 40 dB fill the bar. */
function Meter({ peak }: { peak: number }) {
  const db = peak > 0 ? 20 * Math.log10(peak) : -Infinity;
  const level = Math.max(0, Math.min(1, (db + 40) / 40));
  return (
    <div className="h-2 w-32 overflow-hidden rounded-full bg-muted" role="meter" aria-label="Output level" aria-valuenow={Math.round(level * 100)}>
      <div className={cn("h-full rounded-full transition-[width] duration-150", peak >= 1 ? "bg-destructive" : "bg-brand")} style={{ width: `${level * 100}%` }} />
    </div>
  );
}

/** A key that sounds while it's held. */
function Key({ pitch, disabled, onNote }: { pitch: number; disabled: boolean; onNote: (on: boolean) => void }) {
  const held = useRef(false);
  const set = (on: boolean) => {
    if (held.current === on) return;
    held.current = on;
    onNote(on);
  };
  return (
    <button
      type="button"
      disabled={disabled}
      aria-label={`${NOTE_NAMES[pitch % 12]}${Math.floor(pitch / 12) - 1}`}
      className={cn(
        "flex h-20 flex-1 items-end justify-center rounded-md border pb-1.5 text-[10px] select-none disabled:opacity-40",
        isBlack(pitch) ? "border-neutral-700 bg-neutral-900 text-neutral-400 active:bg-brand" : "bg-white text-neutral-500 active:bg-brand/40",
      )}
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        set(true);
      }}
      onPointerUp={() => set(false)}
      onPointerCancel={() => set(false)}
      onLostPointerCapture={() => set(false)}
    >
      {NOTE_NAMES[pitch % 12]}
    </button>
  );
}
