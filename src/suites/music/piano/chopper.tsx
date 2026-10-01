import { useEffect, useMemo } from "react";
import { PiCaretDownBold } from "react-icons/pi";
import { cn } from "cn";
import { CHOP_PATTERNS, DEFAULT_CHOP_PATTERN, TIME_MULS, chopPattern } from "@shared/music/chop";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Knob, PERCENT, percent } from "../knob";
import { useMusic } from "../store";
import { useMusicUi } from "../ui";
import { MusicWindow, centredOnDesktop } from "../window";
import { acceptChop, chopperResult, pianoContext } from "./actions";
import { type ChopperSettings, DEFAULT_CHOPPER, usePiano } from "./store";

const WIDTH = 300;

const set = (patch: Partial<ChopperSettings>) => usePiano.setState((s) => ({ chopper: { ...s.chopper, ...patch } }));
const close = () => usePiano.setState({ chopping: false });

/** "×2", "×1/2", "×2/3", "×1.5". */
export function timeMulText(mul: number): string {
  if (mul >= 1) return `×${Number.isInteger(mul) ? mul : mul.toFixed(1)}`;
  const third = Math.round(mul * 3);
  return Math.abs(mul * 3 - third) < 1e-9 ? `×${third}/3` : `×1/${Math.round(1 / mul)}`;
}

const mulIndex = (mul: number) => {
  const index = TIME_MULS.findIndex((m) => Math.abs(m - mul) < 1e-9);
  return index < 0 ? TIME_MULS.indexOf(1) : index;
};

/**
 * The Piano roll's Chopper (Alt+U; `docs/fl-studio/piano-roll.md`): cuts the selected notes (or all of them)
 * into a rhythm. The Piano roll shows the notes chopped while it's open, following every change; Accept
 * makes it an edit, closing it (or Escape) leaves the notes as they were. Its settings are kept.
 */
export function Chopper() {
  const settings = usePiano((s) => s.chopper);
  const pattern = chopPattern(settings.patternId) ?? DEFAULT_CHOP_PATTERN;
  const index = mulIndex(settings.timeMul);
  // What it would do, for the line under the knobs: re-read when the notes, the selection or the snap change.
  const notes = useMusic((s) => s.history?.doc);
  const selected = usePiano((s) => s.selected);
  const snap = usePiano((s) => s.snap);
  const summary = useMemo(() => {
    const ctx = pianoContext();
    if (!ctx) return null;
    const result = chopperResult(ctx, settings);
    if (!result) return "Too fast at this snap: turn Time mul left, or snap coarser.";
    const chosen = ctx.selected.size || ctx.notes.length;
    if (!chosen) return "No notes to chop.";
    const of = ctx.selected.size ? `${chosen} selected note${chosen === 1 ? "" : "s"}` : `all ${chosen} note${chosen === 1 ? "" : "s"}`;
    return result.notes === ctx.notes ? `Nothing to cut in ${of}.` : `${of[0].toUpperCase()}${of.slice(1)} → ${result.created.length} piece${result.created.length === 1 ? "" : "s"}.`;
    // `notes`, `selected` and `snap` are what `pianoContext` reads.
  }, [settings, notes, selected, snap]);
  // In front of the Piano roll whenever it opens.
  useEffect(() => useMusicUi.getState().focusWindow("chopper"), []);

  // Knob values in between land on the next setting in the direction turned (the wheel and the arrows move a little at a time).
  const turnMul = (value: number) => {
    const next = value > index ? Math.ceil(value - 1e-9) : Math.floor(value + 1e-9);
    set({ timeMul: TIME_MULS[Math.max(0, Math.min(TIME_MULS.length - 1, next))] });
  };
  const noop = () => {};

  return (
    <MusicWindow id="chopper" title="Piano roll - chopper" initial={centredOnDesktop(WIDTH, 300)} onClose={close}>
      <form
        className="flex flex-col gap-2 p-2"
        style={{ width: WIDTH }}
        data-testid="chopper"
        onSubmit={(e) => {
          e.preventDefault();
          acceptChop();
        }}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.stopPropagation();
            close();
          }
        }}
      >
        <div className="sunken flex h-8 items-center gap-2 rounded-sm pr-1 pl-2.5">
          <span className="text-xs font-medium">Pattern</span>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                aria-label="Chop pattern"
                className="flex min-w-0 flex-1 items-center gap-1 rounded-sm px-1.5 py-0.5 text-left text-xs text-muted-foreground hover:text-foreground"
                title={pattern.hint}
              >
                <span className="min-w-0 flex-1 truncate">{pattern.name}</span>
                <PiCaretDownBold className="size-3 shrink-0" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="max-h-96 w-72 overflow-y-auto">
              <DropdownMenuRadioGroup value={pattern.id} onValueChange={(patternId) => set({ patternId })}>
                {CHOP_PATTERNS.map((p) => (
                  <DropdownMenuRadioItem key={p.id} value={p.id} className="flex-col items-start gap-0">
                    <span>{p.name}</span>
                    <span className="text-[11px] text-muted-foreground">{p.hint}</span>
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        <section className="sunken flex flex-col gap-3 rounded-sm px-3 pt-2 pb-3" aria-label="Options">
          <h3 className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">Options</h3>
          <div className="flex items-center gap-3">
            <span className="w-16 text-xs">Time mul</span>
            <Knob
              size={34}
              label="Time mul"
              value={index}
              min={0}
              max={TIME_MULS.length - 1}
              defaultValue={TIME_MULS.indexOf(1)}
              bipolar
              format={(v) => timeMulText(TIME_MULS[Math.round(v)])}
              unit={{ scale: 1, unit: "" }}
              onBegin={noop}
              onDrag={turnMul}
              onEnd={noop}
              onCancel={noop}
              onSet={turnMul}
            />
            <span className="text-xs text-muted-foreground tabular-nums" data-testid="chopper-time-mul">
              {timeMulText(settings.timeMul)}
            </span>
          </div>
          <div className="flex items-center gap-3">
            <span className="w-16 text-xs">Levels</span>
            <Level label="PAN" title="How much of the pattern's panning the pieces get" value={settings.pan} onChange={(pan) => set({ pan })} />
            <Level label="VEL" title="How much of the pattern's accents the pieces get" value={settings.velocity} onChange={(velocity) => set({ velocity })} />
          </div>
          <label className="flex items-center gap-2 text-xs" title="Count the rhythm from the pattern's start (on), or from each note's (off)">
            <button
              type="button"
              role="checkbox"
              aria-checked={settings.absolute}
              aria-label="Absolute pattern"
              onClick={() => set({ absolute: !settings.absolute })}
              className={cn("grid size-4 place-items-center rounded-full", settings.absolute ? "raised" : "sunken")}
            >
              <span className={cn("size-2 rounded-full", settings.absolute ? "bg-brand" : "bg-transparent")} />
            </button>
            Absolute pattern
          </label>
        </section>

        <p className="min-h-4 px-0.5 text-[11px] text-muted-foreground" data-testid="chopper-summary">
          {summary}
        </p>

        <div className="flex justify-between gap-2">
          <Button type="button" variant="outline" size="sm" onClick={() => usePiano.setState({ chopper: DEFAULT_CHOPPER })}>
            Reset
          </Button>
          <Button type="submit" size="sm">
            Accept
          </Button>
        </div>
      </form>
    </MusicWindow>
  );
}

/** One of the Levels knobs, with its name under it. */
function Level({ label, title, value, onChange }: { label: string; title: string; value: number; onChange: (value: number) => void }) {
  const noop = () => {};
  return (
    <div className="flex flex-col items-center gap-1" title={title}>
      <Knob size={30} label={`${label} level`} value={value} min={0} max={1} defaultValue={0} format={percent} unit={PERCENT} onBegin={noop} onDrag={onChange} onEnd={noop} onCancel={noop} onSet={onChange} />
      <span className="text-[10px] font-semibold text-muted-foreground">{label}</span>
    </div>
  );
}
