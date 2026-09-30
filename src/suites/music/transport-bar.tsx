import { useEffect, useState } from "react";
import { PiMetronome, PiPianoKeys, PiPlayFill, PiRows, PiStopFill, PiWarning } from "react-icons/pi";
import { cn } from "cn";
import { setTempo } from "@shared/music/edits";
import { MAX_TEMPO, MIN_TEMPO } from "@shared/music/project";
import { Button } from "@/components/ui/button";
import { Toggle } from "@/components/ui/toggle";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { AudioDialog } from "./audio-dialog";
import { PatternPicker } from "./pattern-picker";
import { useMusic, useSong } from "./store";
import { useTransport } from "./transport";
import { openPianoRoll } from "./piano/actions";
import { useMusicUi } from "./ui";

/** The toolbar under the header: play and stop, the tempo, the pattern, the metronome, and the output's meter. */
export function TransportBar() {
  const playing = useTransport((s) => s.playing);
  const metronome = useTransport((s) => s.metronome);
  const error = useTransport((s) => s.error);
  const rackOpen = useMusicUi((s) => s.rackOpen);
  const pianoOpen = useMusicUi((s) => s.pianoOpen);

  return (
    <div className="flex h-11 shrink-0 items-center gap-2 border-b bg-background px-3" role="toolbar" aria-label="Transport">
      <div className="flex items-center gap-1">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              size="icon-sm"
              variant={playing ? "default" : "outline"}
              aria-label={playing ? "Stop" : "Play"}
              aria-pressed={playing}
              onClick={() => useTransport.getState().toggle()}
            >
              {playing ? <PiStopFill /> : <PiPlayFill />}
            </Button>
          </TooltipTrigger>
          <TooltipContent>{playing ? "Stop" : "Play"} (Space)</TooltipContent>
        </Tooltip>
      </div>
      <TempoField />
      <PatternPicker />
      <Toggle size="sm" pressed={metronome} onPressedChange={(on) => useTransport.getState().setMetronome(on)} aria-label="Metronome" title="Metronome">
        <PiMetronome />
      </Toggle>
      <Toggle size="sm" pressed={rackOpen} onPressedChange={(open) => useMusicUi.getState().setRackOpen(open)} aria-label="Channel rack" title="Channel rack (F6)">
        <PiRows />
      </Toggle>
      <Toggle
        size="sm"
        pressed={pianoOpen}
        onPressedChange={(open) => (open ? openPianoRoll() : useMusicUi.getState().setPianoOpen(false))}
        aria-label="Piano roll"
        title="Piano roll: the selected channel's notes (F7)"
      >
        <PiPianoKeys />
      </Toggle>

      <div className="ml-auto flex items-center gap-3">
        {error && (
          <span className="flex max-w-80 items-center gap-1.5 truncate text-xs text-destructive" role="alert" title={error}>
            <PiWarning className="shrink-0" />
            <span className="truncate">{error}</span>
          </span>
        )}
        <Meter />
        <AudioDialog />
      </div>
    </div>
  );
}

/** The tempo, typed (Enter or leaving the field sets it) or nudged with the arrow keys. */
function TempoField() {
  const tempo = useSong((song) => song.settings.tempo);
  const [draft, setDraft] = useState<string | null>(null);
  const set = (value: number) => useMusic.getState().commit((song) => setTempo(song, value));

  return (
    <label className="flex h-8 items-center gap-1.5 rounded-lg border bg-card px-2 text-[13px] shadow-xs dark:border-white/[0.07] dark:bg-secondary">
      <input
        aria-label="Tempo"
        inputMode="decimal"
        className="w-12 bg-transparent text-right tabular-nums outline-none"
        value={draft ?? String(tempo)}
        onChange={(e) => setDraft(e.target.value)}
        onFocus={(e) => e.currentTarget.select()}
        onBlur={() => {
          if (draft !== null) set(Number(draft));
          setDraft(null);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
          else if (e.key === "Escape") {
            setDraft(null);
            // After the draft is dropped, or the blur would set it.
            const input = e.currentTarget;
            requestAnimationFrame(() => input.blur());
          } else if (e.key === "ArrowUp" || e.key === "ArrowDown") {
            e.preventDefault();
            setDraft(null);
            set(Math.min(MAX_TEMPO, Math.max(MIN_TEMPO, Math.round(tempo) + (e.key === "ArrowUp" ? 1 : -1))));
          }
        }}
      />
      <span className="text-xs text-muted-foreground">BPM</span>
    </label>
  );
}

/** The output's level (the last 48 dB fill the bar) and the audio thread's load. */
function Meter() {
  const peak = useTransport((s) => s.peak);
  const cpu = useTransport((s) => Math.round(s.cpu * 100));
  // The engine only speaks while something sounds: let the bar fall when it goes quiet.
  const [, tick] = useState(0);
  useEffect(() => {
    if (peak <= 0) return;
    const timer = setTimeout(() => tick((n) => n + 1), 300);
    return () => clearTimeout(timer);
  }, [peak]);
  const db = peak > 0 ? 20 * Math.log10(peak) : -Infinity;
  const level = Math.max(0, Math.min(1, (db + 48) / 48));
  return (
    <div className="flex items-center gap-2" title={`Output ${Number.isFinite(db) ? `${db.toFixed(1)} dB` : "silent"} · engine ${cpu}%`}>
      <div className="h-1.5 w-24 overflow-hidden rounded-full bg-muted" role="meter" aria-label="Output level" aria-valuenow={Math.round(level * 100)}>
        <div className={cn("h-full rounded-full transition-[width] duration-100", peak >= 1 ? "bg-destructive" : "bg-emerald-400")} style={{ width: `${level * 100}%` }} />
      </div>
      <span className="w-8 text-right text-[11px] text-muted-foreground tabular-nums">{cpu}%</span>
    </div>
  );
}
