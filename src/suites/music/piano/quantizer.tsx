import { useEffect, useMemo } from "react";
import { PiCaretDownBold } from "react-icons/pi";
import { QUANTIZE_ENDS, type QuantizeEnds } from "@shared/music/notes";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Knob, PERCENT, percent } from "../knob";
import { useMusic } from "../store";
import { useMusicWindows } from "../ui";
import { MusicWindow, centredOnDesktop } from "../window";
import { acceptQuantize, pianoContext, quantizerResult } from "./actions";
import { SNAPS, SNAP_LABELS, type Snap } from "./geometry";
import { DEFAULT_QUANTIZER, type QuantizerSettings, usePiano } from "./store";

const WIDTH = 320;

const set = (patch: Partial<QuantizerSettings>) => usePiano.setState((s) => ({ quantizer: { ...s.quantizer, ...patch } }));
const close = () => usePiano.setState({ quantizing: false });

/** What each choice does with a note's end (FL's names). */
const ENDS: Record<QuantizeEnds, string> = {
  leaveDuration: "Leave duration",
  leaveEnd: "Leave end time",
  quantizeEnd: "Quantize end time",
  quantizeDuration: "Quantize duration",
};

/**
 * The Piano roll's Quantizer (Alt+Q; `docs/fl-studio/piano-roll.md`): the selected notes (or all of them)
 * pulled towards a grid by a strength, those near enough a line, on a grid that can swing, their ends as
 * chosen. The Piano roll shows (and plays) the notes quantized while it's open; Accept makes it an edit,
 * closing it (or Escape) leaves the notes as they were. Its settings are kept.
 */
export function Quantizer() {
  const settings = usePiano((s) => s.quantizer);
  // What it would do, for the line above the buttons.
  const song = useMusic((s) => s.history?.doc);
  const selected = usePiano((s) => s.selected);
  const snap = usePiano((s) => s.snap);
  const summary = useMemo(() => {
    const ctx = pianoContext();
    if (!ctx) return null;
    const chosen = ctx.selected.size || ctx.notes.length;
    if (!chosen) return "No notes to quantize.";
    const result = quantizerResult(ctx, settings);
    const moved = result === ctx.notes ? 0 : result.filter((n, i) => n !== ctx.notes[i]).length;
    const of = ctx.selected.size ? `${chosen} selected note${chosen === 1 ? "" : "s"}` : `all ${chosen} note${chosen === 1 ? "" : "s"}`;
    return `${moved} of ${of} move${moved === 1 ? "s" : ""}.`;
    // `song`, `selected` and `snap` are what `pianoContext` reads.
  }, [settings, song, selected, snap]);
  // In front of the Piano roll whenever it opens.
  useEffect(() => useMusicWindows.getState().focus("quantizer"), []);

  return (
    <MusicWindow id="quantizer" title="Piano roll - quantizer" initial={centredOnDesktop(WIDTH, 320)} onClose={close}>
      <form
        className="flex flex-col gap-2 p-2"
        style={{ width: WIDTH }}
        data-testid="quantizer"
        onSubmit={(e) => {
          e.preventDefault();
          acceptQuantize();
        }}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.stopPropagation();
            close();
          }
        }}
      >
        <div className="sunken flex h-8 items-center gap-2 rounded-sm pr-1 pl-2.5">
          <span className="text-xs font-medium">Grid</span>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button type="button" aria-label="Quantize grid" className="flex min-w-0 flex-1 items-center gap-1 rounded-sm px-1.5 py-0.5 text-left text-xs text-muted-foreground hover:text-foreground">
                <span className="min-w-0 flex-1 truncate">{settings.snap === "line" || settings.snap === "cell" || settings.snap === "none" ? "The Piano roll's snap" : SNAP_LABELS[settings.snap]}</span>
                <PiCaretDownBold className="size-3 shrink-0" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="max-h-96 overflow-y-auto">
              <DropdownMenuRadioGroup value={settings.snap === "cell" || settings.snap === "none" ? "line" : settings.snap} onValueChange={(value) => set({ snap: value as Snap })}>
                <DropdownMenuRadioItem value="line">The Piano roll's snap</DropdownMenuRadioItem>
                {SNAPS.filter((id) => id !== "line" && id !== "cell" && id !== "none").map((id) => (
                  <DropdownMenuRadioItem key={id} value={id}>
                    {SNAP_LABELS[id]}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        <section className="sunken flex flex-col gap-3 rounded-sm px-3 pt-2 pb-3" aria-label="Strength">
          <h3 className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">Strength</h3>
          <div className="flex justify-between">
            <Level label="START" title="How far each note's start goes to the grid" value={settings.start} onChange={(start) => set({ start })} />
            <Level label="SENS" title="Sensitivity: only notes this near a line move (all the way: every note)" value={settings.sensitivity} onChange={(sensitivity) => set({ sensitivity })} />
            <Level label="DUR" title="How far ends or lengths go to the grid, when they're quantized" value={settings.duration} onChange={(duration) => set({ duration })} />
            <Level label="SWING" title="Every second line of the grid later" value={settings.swing} onChange={(swing) => set({ swing })} />
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button type="button" aria-label="Note ends" className="flex items-center gap-1 rounded-sm text-left text-xs text-muted-foreground hover:text-foreground">
                <span className="flex-1">{ENDS[settings.ends]}</span>
                <PiCaretDownBold className="size-3 shrink-0" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              <DropdownMenuRadioGroup value={settings.ends} onValueChange={(value) => set({ ends: value as QuantizeEnds })}>
                {QUANTIZE_ENDS.map((id) => (
                  <DropdownMenuRadioItem key={id} value={id}>
                    {ENDS[id]}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        </section>

        <p className="min-h-4 px-0.5 text-[11px] text-muted-foreground" data-testid="quantizer-summary">
          {summary}
        </p>

        <div className="flex justify-between gap-2">
          <Button type="button" variant="outline" size="sm" onClick={() => usePiano.setState({ quantizer: DEFAULT_QUANTIZER })}>
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

/** A knob with its name under it, 0..100%. */
function Level({ label, title, value, onChange }: { label: string; title: string; value: number; onChange: (value: number) => void }) {
  const noop = () => {};
  return (
    <div className="flex flex-col items-center gap-1" title={title}>
      <Knob size={30} label={`${label} strength`} value={value} min={0} max={1} defaultValue={label === "SWING" ? 0 : 1} format={percent} unit={PERCENT} onBegin={noop} onDrag={onChange} onEnd={noop} onCancel={noop} onSet={onChange} />
      <span className="text-[10px] font-semibold text-muted-foreground">{label}</span>
    </div>
  );
}
