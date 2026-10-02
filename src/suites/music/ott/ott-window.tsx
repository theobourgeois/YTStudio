import { useEffect, useState } from "react";
import { PiCaretLeft, PiCaretRight, PiDotsThreeVertical } from "react-icons/pi";
import { mixerTrackName } from "@shared/music/automation";
import { OTT_CONTROL_SPECS, setOttControl } from "@shared/music/ott";
import { OTT_GAIN_RANGE, OTT_PRESETS } from "@shared/music/ott-presets";
import type { MixerEffect, MusicProject, Ott, OttControl } from "@shared/music/types";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { AutomateTouched } from "../automation/touched";
import { PERCENT } from "../knob";
import { useSong } from "../store";
import { ottWindow } from "../ui";
import { MusicWindow, centredOnDesktop } from "../window";
import { chooseOtt, closeOtt, copyOttState, pasteOttState, stepOttPreset } from "./actions";
import { Caption, OttKnob } from "./controls";
import { OttDisplay } from "./display";
import { useOttUi } from "./store";

/** The window's width: the display's rows and their gain knobs, in a plate. */
const WIDTH = 420;
const DB = { scale: 1, unit: "dB", digits: 1 };

/** The effect in the song, by id (the object itself, so a selector of it is stable). */
function effectOf(song: MusicProject, effectId: string): MixerEffect | null {
  for (const track of song.mixer.tracks) for (const effect of track.effects) if (effect?.id === effectId) return effect;
  return null;
}
const trackOf = (song: MusicProject, effectId: string) => song.mixer.tracks.find((t) => t.effects.some((e) => e?.id === effectId))?.id ?? "";

/**
 * An OTT's window (`docs/xfer/ott.md`), Xfer's layout in our look: the preset bar; Depth, Time, In Gain
 * and Out Gain; the display, a row a band (H, M, L) with its gain; and Upwd% and Dnwd% under it.
 */
export function OttWindow({ effectId, index }: { effectId: string; index: number }) {
  const effect = useSong((s) => effectOf(s, effectId));
  const owner = useSong((s) => mixerTrackName(s, trackOf(s, effectId)));
  const [initial] = useState(() => {
    const place = centredOnDesktop(WIDTH, 360);
    return { ...place, x: place.x + index * 28, y: place.y + index * 28 };
  });
  const ott = effect?.ott;
  // Its effect deleted (or replaced): its window goes, as a plugin's does.
  const gone = !ott;
  useEffect(() => {
    if (gone) closeOtt(effectId);
  }, [gone, effectId]);
  if (!effect || !ott) return null;
  /** A knob of OTT's: what it is, how it turns, and its edit, from its control's spec. */
  const knob = (control: OttControl, label: string, size = 40) => {
    const spec = OTT_CONTROL_SPECS[control];
    const tapered = control === "time";
    const linear = control === "input" || control === "output";
    return (
      <OttKnob
        label={label}
        size={size}
        value={tapered ? spec.fromControl(spec.get(ott)) : spec.get(ott)}
        min={tapered ? 0 : linear ? OTT_GAIN_RANGE[0] : 0}
        max={tapered ? 1 : linear ? OTT_GAIN_RANGE[1] : spec.toControl(1)}
        defaultValue={tapered ? spec.fromControl(spec.defaultValue) : spec.defaultValue}
        format={(v) => spec.format(tapered ? spec.toControl(v) : v)}
        unit={linear ? DB : tapered ? { scale: 100, unit: "% of its travel" } : PERCENT}
        target={{ kind: "ott", effect: effectId, control }}
        fraction={tapered}
        edit={(s, v) => setOttControl(s, effectId, control, tapered ? spec.toControl(v) : v)}
      />
    );
  };
  return (
    <MusicWindow id={ottWindow(effectId)} title={`${effect.plugin.name} (${owner})`} initial={initial} onClose={() => closeOtt(effectId)} controls={<AutomateTouched effectId={effectId} />}>
      <div className="flex flex-col bg-surface-0 text-xs select-none" style={{ width: WIDTH }} data-testid="ott" data-effect={effectId}>
        <PresetBar effectId={effectId} ott={ott} />
        <div className="flex flex-col gap-2 p-2">
          <Plate className="grid grid-cols-4 items-end justify-items-center gap-2">
            {knob("depth", "Depth", 44)}
            {knob("time", "Time", 44)}
            {knob("input", "In Gain", 36)}
            {knob("output", "Out Gain", 36)}
          </Plate>
          <Plate className="items-start">
            <OttDisplay effectId={effectId} ott={ott} />
            <div className="mt-1 flex w-[340px] justify-between px-0.5">
              <Caption className="text-[8px] text-[color:var(--ott-up-edge)]">Upward</Caption>
              <Caption className="text-[8px] text-[color:var(--ott-down-edge)]">Downward</Caption>
            </div>
          </Plate>
          <Plate className="grid grid-cols-2 items-end justify-items-center gap-2">
            {knob("upward", "Upwd%", 36)}
            {knob("downward", "Dnwd%", 36)}
          </Plate>
        </div>
      </div>
    </MusicWindow>
  );
}

/** One of OTT's sections. */
function Plate({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={`flex flex-col rounded-lg border border-line bg-surface-1 p-2 shadow-[inset_0_1px_0_var(--bevel-highlight)] ${className ?? ""}`}>{children}</div>;
}

function PresetBar({ effectId, ott }: { effectId: string; ott: Ott }) {
  const copied = useOttUi((s) => s.copiedState !== null);
  const arrow = "grid h-6 w-6 place-items-center rounded-sm raised text-muted-foreground hover:raised-hover hover:text-foreground";
  return (
    <div className="flex items-center gap-1 border-b border-line bg-surface-1 px-2 py-1.5">
      <button type="button" aria-label="Previous preset" title="Previous preset" className={arrow} onClick={() => stepOttPreset(effectId, -1)}>
        <PiCaretLeft className="size-3" />
      </button>
      <button type="button" aria-label="Next preset" title="Next preset" className={arrow} onClick={() => stepOttPreset(effectId, 1)}>
        <PiCaretRight className="size-3" />
      </button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button type="button" aria-label="Preset" data-testid="ott-preset" className="h-6 w-44 truncate rounded-sm px-2 text-left font-mono text-[12px] sunken text-foreground">
            {ott.preset ?? "Untitled"}
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          {OTT_PRESETS.map((p) => (
            <DropdownMenuItem key={p.name} onSelect={() => chooseOtt(effectId, p.name)} title={p.detail}>
              {p.name}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      <span className="ml-auto flex items-baseline gap-1.5 pr-1">
        <span className="text-[14px] font-black tracking-tight">OTT</span>
        <span className="text-[10px] whitespace-nowrap text-muted-foreground">Multiband Compressor</span>
      </span>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button type="button" aria-label="OTT's options" className={arrow}>
            <PiDotsThreeVertical className="size-3.5" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={() => chooseOtt(effectId, "Default")}>Reset to default</DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => copyOttState(effectId)}>Copy state</DropdownMenuItem>
          <DropdownMenuItem disabled={!copied} onSelect={() => pasteOttState(effectId)}>
            Paste state
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
