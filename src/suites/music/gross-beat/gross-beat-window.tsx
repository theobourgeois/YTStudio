import { useEffect, useRef, useState } from "react";
import { PiCaretDown, PiCaretRight, PiClock, PiLinkSimple, PiPencilSimpleLine, PiPianoKeys, PiSnowflake, PiArrowLineRight, PiSpeakerSimpleHigh } from "react-icons/pi";
import { cn } from "cn";
import { CURVE_NAMES, deletePoint, mixerTrackName, updatePoint } from "@shared/music/automation";
import { type GrossKind, editGrossSlot, grossSlot, pickedSlot, pitchSegment, updateGrossBeat } from "@shared/music/gross-beat";
import { GROSS_DEPTH, GROSS_SLOTS, GROSS_SYNCS, GROSS_TICKS, MAX_GROSS_ATTACK, MAX_GROSS_RELEASE } from "@shared/music/gross-beat-presets";
import { type CurveType, type GrossBeat, type GrossHold, type MixerEffect, type MusicProject, PPQ } from "@shared/music/types";
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuTrigger } from "@/components/ui/context-menu";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { AutomationMenuItems } from "../automation/control";
import { hitCurve } from "../automation/curve-geometry";
import { MILLISECONDS, PERCENT, SongKnob, percent, seconds } from "../knob";
import { prepare, readPalette } from "../piano/draw";
import { useMusic, useSong } from "../store";
import { useTransport } from "../transport";
import { grossBeatWindow } from "../ui";
import { MusicWindow, centredOnDesktop } from "../window";
import { GROSS_TOOLS, type GrossTool, clearSlot, closeGrossBeat, copySlot, copyState, live, pasteSlot, pasteState, pickSlot, renameSlot, resetSlot, runGrossTool } from "./actions";
import { drawPanel, grossColours } from "./draw";
import { GROSS_SNAPS, type GrossSnap, panelBox, pointHint, snapLabel } from "./geometry";
import { type PanelTarget, panelCursor, panelPointerDown } from "./pointer";
import { useGrossUi, useGrossView } from "./store";
import { AutomateTouched } from "../automation/touched";

/** The window's size as it opens (narrower if the desktop is), and the least it can be. */
const WIDTH = 840;
const HEIGHT = 520;
const MIN_WIDTH = 760;

/** The curve types Gross Beat's point menu offers (FL's list: the automation clips' without Smooth). */
const GROSS_CURVES: readonly CurveType[] = ["single", "double", "altSingle", "altDouble", "hold", "stairs", "smoothStairs", "pulse", "wave", "halfSine"];
/** A sync's length said: "1/4 beat", "4 beats", "Off"; and short, on the bar ("1/4", "4"). */
const syncText = (beats: number) => (beats === 0 ? "Off" : beats < 1 ? `1/${Math.round(1 / beats)} beat` : `${beats} beat${beats === 1 ? "" : "s"}`);
const syncShort = (beats: number) => (beats === 0 ? "Off" : beats < 1 ? `1/${Math.round(1 / beats)}` : String(beats));
const HOLD_TEXT: Record<GrossHold, string> = { off: "Off", last: "Last", next: "Next" };

/** The effect in the song, by id (the object itself, so a selector of it is stable). */
function effectOf(song: MusicProject, effectId: string): MixerEffect | null {
  for (const track of song.mixer.tracks) for (const effect of track.effects) if (effect?.id === effectId) return effect;
  return null;
}
const trackOf = (song: MusicProject, effectId: string) => song.mixer.tracks.find((t) => t.effects.some((e) => e?.id === effectId))?.id ?? "";

/**
 * A Gross Beat's window (`docs/fl-studio/gross-beat.md`), FL's layout in our look: on the left the Time
 * knob, HOLD and the scratching clock, the 36 time slots and 36 volume slots, the volume's knobs; on the
 * right the mapping panel (the picked slot's envelope, edited by mouse) with its strip (options, snap,
 * editing modes, freeze, which envelope) and its bar (the slot's name, link, one-shot, HOLD mode, sync).
 */
export function GrossBeatWindow({ effectId, index }: { effectId: string; index: number }) {
  const effect = useSong((s) => effectOf(s, effectId));
  const owner = useSong((s) => mixerTrackName(s, trackOf(s, effectId)));
  // As wide as the desktop has room for (the Browser takes some), centred, each next one a step down.
  const [initial] = useState(() => {
    const width = Math.max(MIN_WIDTH, Math.min(WIDTH, (document.querySelector('[data-desktop="music"]')?.getBoundingClientRect().width ?? WIDTH) - 16));
    const place = centredOnDesktop(width, HEIGHT);
    return { ...place, x: place.x + index * 28, y: Math.min(place.y, 40) + index * 28, width, height: HEIGHT };
  });
  const gb = effect?.grossBeat;
  // Its effect deleted (or replaced): its window goes, as a plugin's does.
  const gone = !gb;
  useEffect(() => {
    if (gone) closeGrossBeat(effectId);
  }, [gone, effectId]);
  if (!effect || !gb) return null;
  return (
    <MusicWindow
      id={grossBeatWindow(effectId)}
      title={`${effect.plugin.name} (${owner})`}
      initial={initial}
      resizable={{ minWidth: MIN_WIDTH, minHeight: 500 }}
      onClose={() => closeGrossBeat(effectId)}
      controls={<AutomateTouched effectId={effectId} />}
    >
      <div className="flex h-full min-h-0 select-none text-xs" data-testid="gross-beat" data-effect={effectId}>
        <aside className="flex w-[330px] shrink-0 flex-col gap-2 overflow-y-auto border-r border-line bg-surface-1 p-2">
          <span className="shrink-0 px-1 text-[13px] font-semibold tracking-wide">YT-Time</span>
          <TimeHeader effectId={effectId} gb={gb} />
          <SlotGrid effectId={effectId} gb={gb} kind="time" />
          <SlotGrid effectId={effectId} gb={gb} kind="volume" />
          <VolumeControls effectId={effectId} gb={gb} />
        </aside>
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex min-h-0 flex-1">
            <Strip effectId={effectId} gb={gb} />
            <MappingPanel effectId={effectId} gb={gb} />
          </div>
          <BottomBar effectId={effectId} gb={gb} />
        </div>
      </div>
    </MusicWindow>
  );
}

function Labelled({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-0.5">
      {children}
      <span className="text-[9px] font-medium tracking-wide text-muted-foreground">{label}</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// The left panel
// ---------------------------------------------------------------------------

/** The Time knob, the options, HOLD and the scratching clock. */
function TimeHeader({ effectId, gb }: { effectId: string; gb: GrossBeat }) {
  const clock = useGrossView(effectId).clock;
  return (
    <div className="flex items-center gap-2.5">
      <div className="flex items-center gap-1.5 rounded-full bg-surface-2 py-0.5 pr-3 pl-0.5 raised">
        <SongKnob
          size={34}
          label="Time"
          value={gb.timeMix}
          min={0}
          max={1}
          defaultValue={1}
          format={percent}
          unit={PERCENT}
          target={{ kind: "grossBeat", effect: effectId, control: "timeMix" }}
          edit={(s, timeMix) => updateGrossBeat(s, effectId, { timeMix })}
        />
        <span className="font-medium text-gross-time">time</span>
        <PiClock className="size-3.5 text-gross-time" />
      </div>
      <div className="flex flex-col gap-1">
        <OptionsMenu effectId={effectId} gb={gb} />
        <HoldButton effectId={effectId} gb={gb} />
      </div>
      {clock && <ScratchClock effectId={effectId} />}
    </div>
  );
}

/** The options menu (FL's ▸ Options): the sound's options, the clock, Copy / Paste state. */
function OptionsMenu({ effectId, gb }: { effectId: string; gb: GrossBeat }) {
  const view = useGrossView(effectId);
  const copied = useGrossUi((s) => s.copiedState !== null);
  const set = (patch: Partial<GrossBeat>) => useMusic.getState().commit((s) => updateGrossBeat(s, effectId, patch));
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" className="flex items-center gap-0.5 text-[11px] text-muted-foreground hover:text-foreground" aria-label="Options">
          <PiCaretRight className="size-3" /> Options
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" data-testid="gross-options">
        <DropdownMenuCheckboxItem checked={false} disabled title="YT-Time can't hear MIDI yet: pick slots by clicking them, or automate them">
          Trigger slots from MIDI notes
        </DropdownMenuCheckboxItem>
        <DropdownMenuCheckboxItem checked={gb.clickReduction} onCheckedChange={(clickReduction) => set({ clickReduction })}>
          Click reduction
        </DropdownMenuCheckboxItem>
        <DropdownMenuCheckboxItem checked={gb.attackCompensation} onCheckedChange={(attackCompensation) => set({ attackCompensation })}>
          Smoothing attack compensation
        </DropdownMenuCheckboxItem>
        <DropdownMenuCheckboxItem checked={gb.removeDc} onCheckedChange={(removeDc) => set({ removeDc })}>
          Remove DC offset
        </DropdownMenuCheckboxItem>
        <DropdownMenuCheckboxItem checked={gb.hq} onCheckedChange={(hq) => set({ hq })}>
          HQ resampling
        </DropdownMenuCheckboxItem>
        <DropdownMenuSeparator />
        <DropdownMenuCheckboxItem checked={view.clock} onCheckedChange={(clock) => useGrossUi.getState().setView(effectId, { clock })}>
          View scratching clock
        </DropdownMenuCheckboxItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => copyState(effectId)}>Copy state</DropdownMenuItem>
        <DropdownMenuItem disabled={!copied} onSelect={() => pasteState(effectId)}>
          Paste state
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** HOLD: the bar repeat, while it's held (live: the engine's, not the song's). */
function HoldButton({ effectId, gb }: { effectId: string; gb: GrossBeat }) {
  const holding = useTransport((s) => s.playing && (s.grossBeats[effectId]?.holding ?? false));
  const [pressed, setPressed] = useState(false);
  const release = () => {
    if (!pressed) return;
    setPressed(false);
    void live(effectId, { hold: false });
  };
  const off = gb.hold === "off";
  return (
    <button
      type="button"
      disabled={off}
      aria-pressed={pressed}
      title={off ? "HOLD is off: choose Last or Next below" : `Hold to repeat ${gb.hold === "last" ? "the bar just played" : "the next bar"}`}
      className={cn(
        "h-6 w-16 rounded-sm text-[11px] font-semibold tracking-wider",
        pressed || holding ? "pressed text-gross-time" : "raised hover:raised-hover",
        off && "opacity-50",
      )}
      onPointerDown={(e) => {
        if (e.button !== 0 || off) return;
        e.currentTarget.setPointerCapture(e.pointerId);
        setPressed(true);
        void live(effectId, { hold: true });
      }}
      onPointerUp={release}
      onPointerCancel={release}
      onLostPointerCapture={release}
    >
      HOLD
    </button>
  );
}

/** How far a drag on the clock scratches: a beat back for each this many px down. */
const PX_PER_BEAT = 36;

/**
 * The scratching clock (FL's): a platter that turns with the bar while the song plays. Dragged up and
 * down, it scratches: down reaches back in time, up comes forward again (no further than now); let go,
 * the sound springs back to now.
 */
function ScratchClock({ effectId }: { effectId: string }) {
  const hand = useRef<SVGGElement>(null);
  const scratch = useRef(0);
  const [held, setHeld] = useState(false);
  useEffect(() => {
    let frame = 0;
    const turn = () => {
      frame = requestAnimationFrame(turn);
      const tick = envelopeTick(effectId, "time");
      const angle = ((tick ?? 0) / GROSS_TICKS) * 360 + scratch.current * 90;
      hand.current?.setAttribute("transform", `rotate(${angle} 28 28)`);
    };
    turn();
    return () => cancelAnimationFrame(frame);
  }, [effectId]);
  return (
    <svg
      viewBox="0 0 56 56"
      className={cn("ml-auto size-14 shrink-0 cursor-ns-resize rounded-md sunken", held && "ring-1 ring-gross-time")}
      role="slider"
      aria-label="Scratching clock: drag up and down to scratch"
      aria-valuemin={-GROSS_DEPTH}
      aria-valuemax={0}
      aria-valuenow={0}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        const svg = e.currentTarget;
        svg.setPointerCapture(e.pointerId);
        setHeld(true);
        const startY = e.clientY;
        let frame = 0;
        const send = () => {
          frame = 0;
          void live(effectId, { scratch: scratch.current });
        };
        const move = (ev: PointerEvent) => {
          scratch.current = Math.max(-GROSS_DEPTH, Math.min(0, -(ev.clientY - startY) / PX_PER_BEAT));
          if (!frame) frame = requestAnimationFrame(send);
        };
        const up = () => {
          svg.removeEventListener("pointermove", move);
          svg.removeEventListener("pointerup", up);
          svg.removeEventListener("pointercancel", up);
          if (frame) cancelAnimationFrame(frame);
          scratch.current = 0;
          setHeld(false);
          void live(effectId, { scratch: 0 });
        };
        svg.addEventListener("pointermove", move);
        svg.addEventListener("pointerup", up);
        svg.addEventListener("pointercancel", up);
      }}
    >
      <circle cx="28" cy="28" r="24" className="fill-surface-0 stroke-line" />
      {Array.from({ length: 12 }, (_, i) => {
        const a = (i / 12) * Math.PI * 2;
        return <circle key={i} cx={28 + Math.sin(a) * 19} cy={28 - Math.cos(a) * 19} r={1.3} className="fill-muted-foreground/60" />;
      })}
      <g ref={hand}>
        <line x1="28" y1="28" x2="28" y2="9" className="stroke-gross-time" strokeWidth={2} strokeLinecap="round" />
        <circle cx="28" cy="9" r="2.6" className="fill-gross-time" />
      </g>
      <circle cx="28" cy="28" r="3" className="fill-surface-3 stroke-line" />
    </svg>
  );
}

/**
 * Where a Gross Beat's envelope of `kind` is now (ticks into its bar), from what the engine last said and
 * the time since, as it's heard (the output's latency later); null while the song isn't playing.
 */
function envelopeTick(effectId: string, kind: GrossKind): number | null {
  const t = useTransport.getState();
  const said = t.grossBeats[effectId];
  if (!t.playing || !said) return null;
  const tempo = useMusic.getState().history?.doc.settings.tempo ?? 120;
  const perMs = (tempo * PPQ) / 60_000;
  const tick = (kind === "time" ? said.timeTick : said.volumeTick) + (performance.now() - t.at - t.latencyMs) * perMs;
  return ((tick % GROSS_TICKS) + GROSS_TICKS) % GROSS_TICKS;
}

/** A kind's 36 slots: a click picks one; right-click for its menu. */
function SlotGrid({ effectId, gb, kind }: { effectId: string; gb: GrossBeat; kind: GrossKind }) {
  const playing = useTransport((s) => (s.playing ? (s.grossBeats[effectId]?.[kind] ?? null) : null));
  const queued = useTransport((s) => (s.playing ? (s.grossBeats[effectId]?.[kind === "time" ? "queuedTime" : "queuedVolume"] ?? null) : null));
  const shown = useGrossView(effectId).kind === kind;
  const picked = pickedSlot(gb, kind);
  const [menuSlot, setMenuSlot] = useState(picked);
  const copied = useGrossUi((s) => s.copiedSlot !== null);
  const control = kind === "time" ? "timeSlot" : "volumeSlot";
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div className="grid grid-cols-4 gap-px rounded-sm bg-line p-px" role="radiogroup" aria-label={kind === "time" ? "Time slots" : "Volume slots"} data-testid={`gross-${kind}-slots`}>
          {Array.from({ length: GROSS_SLOTS }, (_, i) => {
            const slot = grossSlot(gb, kind, i);
            const on = (playing ?? picked) === i;
            return (
              <button
                key={i}
                type="button"
                role="radio"
                aria-checked={picked === i}
                aria-label={`${kind === "time" ? "Time" : "Volume"} slot ${i + 1}: ${slot.name}`}
                title={`${i + 1}: ${slot.name}${gb[kind][i] ? " (changed)" : ""}`}
                data-playing={on || undefined}
                data-queued={queued === i || undefined}
                className={cn(
                  "h-[18px] min-w-0 truncate px-1 text-center text-[10px] leading-[18px]",
                  on
                    ? kind === "time"
                      ? "bg-gross-time font-medium text-gross-time-foreground"
                      : "bg-gross-volume font-medium text-gross-volume-foreground"
                    : "bg-surface-2 text-foreground/85 hover:bg-surface-3",
                  queued === i && (kind === "time" ? "inset-ring inset-ring-gross-time" : "inset-ring inset-ring-gross-volume"),
                  // The slot the panel shows: outlined, as FL's white rectangle.
                  shown && picked === i && "inset-ring-2 inset-ring-foreground",
                  gb[kind][i] && !on && "italic",
                )}
                onPointerDown={(e) => e.button === 2 && setMenuSlot(i)}
                onClick={() => pickSlot(effectId, kind, i)}
              >
                {slot.name}
              </button>
            );
          })}
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent data-testid="gross-slot-menu">
        <ContextMenuItem onSelect={() => pickSlot(effectId, kind, menuSlot)}>Pick slot {menuSlot + 1}</ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem onSelect={() => copySlot(effectId, kind, menuSlot)}>Copy</ContextMenuItem>
        <ContextMenuItem disabled={!copied} onSelect={() => pasteSlot(effectId, kind, menuSlot)}>
          Paste
        </ContextMenuItem>
        <ContextMenuItem onSelect={() => clearSlot(effectId, kind, menuSlot)}>Clear</ContextMenuItem>
        <ContextMenuItem disabled={gb[kind][menuSlot] === null} onSelect={() => resetSlot(effectId, kind, menuSlot)}>
          Reset to its preset
        </ContextMenuItem>
        <ContextMenuSeparator />
        <AutomationMenuItems target={{ kind: "grossBeat", effect: effectId, control }} />
      </ContextMenuContent>
    </ContextMenu>
  );
}

/** The volume envelope's knobs: ATT, REL, TNS, and the Volume knob. */
function VolumeControls({ effectId, gb }: { effectId: string; gb: GrossBeat }) {
  return (
    <div className="mt-auto flex items-end gap-3 pt-1">
      <div className="flex items-center gap-1.5 rounded-full bg-surface-2 py-0.5 pr-3 pl-0.5 raised">
        <SongKnob
          size={34}
          label="Volume"
          value={gb.volumeMix}
          min={0}
          max={1}
          defaultValue={1}
          format={percent}
          unit={PERCENT}
          target={{ kind: "grossBeat", effect: effectId, control: "volumeMix" }}
          edit={(s, volumeMix) => updateGrossBeat(s, effectId, { volumeMix })}
        />
        <span className="font-medium text-gross-volume">volume</span>
        <PiSpeakerSimpleHigh className="size-3.5 text-gross-volume" />
      </div>
      <Labelled label="ATT">
        <SongKnob size={26} label="Attack" value={gb.attack} min={0} max={MAX_GROSS_ATTACK} defaultValue={0} format={seconds} unit={MILLISECONDS} target={{ kind: "grossBeat", effect: effectId, control: "attack" }} edit={(s, attack) => updateGrossBeat(s, effectId, { attack })} />
      </Labelled>
      <Labelled label="REL">
        <SongKnob size={26} label="Release" value={gb.release} min={0} max={MAX_GROSS_RELEASE} defaultValue={0} format={seconds} unit={MILLISECONDS} target={{ kind: "grossBeat", effect: effectId, control: "release" }} edit={(s, release) => updateGrossBeat(s, effectId, { release })} />
      </Labelled>
      <Labelled label="TNS">
        <SongKnob size={26} label="Tension" value={gb.tension} min={-1} max={1} defaultValue={0} bipolar format={percent} unit={PERCENT} target={{ kind: "grossBeat", effect: effectId, control: "tension" }} edit={(s, tension) => updateGrossBeat(s, effectId, { tension })} />
      </Labelled>
    </div>
  );
}

// ---------------------------------------------------------------------------
// The mapping panel
// ---------------------------------------------------------------------------

/** A small square button of the strip. */
function StripButton({ label, on, onClick, children, disabled }: { label: string; on?: boolean; onClick: () => void; children: React.ReactNode; disabled?: boolean }) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={on}
      title={label}
      disabled={disabled}
      className={cn("grid h-6 w-8 place-items-center rounded-sm text-[10px] font-medium", on ? "pressed text-brand" : "raised text-muted-foreground hover:raised-hover hover:text-foreground", disabled && "opacity-50")}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

/** The panel's strip (FL's, down its left): the mapping options, snap, the editing modes, freeze, and which envelope. */
function Strip({ effectId, gb }: { effectId: string; gb: GrossBeat }) {
  const view = useGrossView(effectId);
  const setView = (patch: Parameters<ReturnType<typeof useGrossUi.getState>["setView"]>[1]) => useGrossUi.getState().setView(effectId, patch);
  const slot = pickedSlot(gb, view.kind);
  return (
    <div className="flex w-10 shrink-0 flex-col items-center gap-1 border-r border-line bg-surface-1 py-1.5" aria-label="Mapping tools">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button type="button" aria-label="Mapping envelope options" title="Mapping envelope options" className="grid h-6 w-8 place-items-center rounded-sm raised text-muted-foreground hover:raised-hover">
            <PiCaretDown className="size-3" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" data-testid="gross-mapping-menu">
          <DropdownMenuLabel className="text-[11px] text-muted-foreground">
            {view.kind === "time" ? "Time" : "Volume"}: {grossSlot(gb, view.kind, slot).name}
          </DropdownMenuLabel>
          {(Object.keys(GROSS_TOOLS) as GrossTool[]).map((tool) => (
            <DropdownMenuItem key={tool} disabled={view.freeze} onSelect={() => runGrossTool(effectId, view.kind, slot, tool)}>
              {GROSS_TOOLS[tool].label}
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => copySlot(effectId, view.kind, slot)}>Copy slot</DropdownMenuItem>
          <DropdownMenuItem disabled={view.freeze || useGrossUi.getState().copiedSlot === null} onSelect={() => pasteSlot(effectId, view.kind, slot)}>
            Paste slot
          </DropdownMenuItem>
          <DropdownMenuItem disabled={view.freeze} onSelect={() => clearSlot(effectId, view.kind, slot)}>
            Clear slot
          </DropdownMenuItem>
          <DropdownMenuItem disabled={view.freeze || gb[view.kind][slot] === null} onSelect={() => resetSlot(effectId, view.kind, slot)}>
            Reset to its preset
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <div className="my-1 flex flex-col gap-0.5" role="radiogroup" aria-label="Snap">
        {GROSS_SNAPS.map((snap) => (
          <StripButton key={snap} label={snap === 0 ? "No snap" : `Snap to ${snapLabel(snap)} beat`} on={view.snap === snap} onClick={() => setView({ snap: snap as GrossSnap })}>
            {snapLabel(snap)}
          </StripButton>
        ))}
      </div>
      <StripButton label="Step editing: drag to draw a step in each grid cell (Shift: pulses)" on={view.step} onClick={() => setView({ step: !view.step })}>
        <PiPencilSimpleLine className="size-3.5" />
      </StripButton>
      <StripButton label="Slide remaining points: those after a moved point go along" on={view.slide} onClick={() => setView({ slide: !view.slide })}>
        <PiArrowLineRight className="size-3.5" />
      </StripButton>
      <StripButton label="Freeze: the envelopes can't be edited" on={view.freeze} onClick={() => setView({ freeze: !view.freeze })}>
        <PiSnowflake className="size-3.5" />
      </StripButton>
      <div className="mt-auto flex flex-col gap-0.5" role="radiogroup" aria-label="Envelope">
        <StripButton label="The time envelope" on={view.kind === "time"} onClick={() => setView({ kind: "time" })}>
          <PiClock className={cn("size-3.5", view.kind === "time" && "text-gross-time")} />
        </StripButton>
        <StripButton label="The volume envelope" on={view.kind === "volume"} onClick={() => setView({ kind: "volume" })}>
          <PiSpeakerSimpleHigh className={cn("size-3.5", view.kind === "volume" && "text-gross-volume")} />
        </StripButton>
      </div>
    </div>
  );
}

/**
 * The mapping panel: the shown kind's picked slot, drawn on a canvas each frame something changed (or
 * while the song plays, for the locator), edited by mouse (`pointer.ts`).
 */
function MappingPanel({ effectId, gb }: { effectId: string; gb: GrossBeat }) {
  const wrap = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [hot, setHot] = useState<number | null>(null);
  const view = useGrossView(effectId);
  const slot = pickedSlot(gb, view.kind);
  const points = grossSlot(gb, view.kind, slot).points;
  const target = (): PanelTarget => ({ effectId, kind: view.kind, slot, points, box: panelBox(size.width, size.height), view });

  useEffect(() => {
    const element = wrap.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => setSize({ width: entry.contentRect.width, height: entry.contentRect.height }));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  // Drawn once a frame when what it shows changed: the points (or a drag's), the view, the size, the locator.
  useEffect(() => {
    const element = canvas.current;
    if (!element || !size.width || !size.height) return;
    let frame = 0;
    let last = "";
    let lastPoints: unknown = null;
    const draw = () => {
      frame = requestAnimationFrame(draw);
      const drag = useGrossUi.getState().drag;
      const shown = drag && drag.effectId === effectId && drag.kind === view.kind && drag.slot === slot ? drag.points : points;
      const locator = envelopeTick(effectId, view.kind);
      const box = panelBox(size.width, size.height);
      const key = `${locator === null ? "-" : Math.round(locator * box.pxPerTick)}|${hot}|${document.documentElement.className}`;
      if (key === last && shown === lastPoints) return;
      last = key;
      lastPoints = shown;
      const ctx = prepare(element, size.width, size.height);
      if (!ctx) return;
      const colours = grossColours(element);
      drawPanel(ctx, {
        width: size.width,
        height: size.height,
        box,
        kind: view.kind,
        points: shown,
        snap: view.snap,
        locator,
        hot,
        frozen: view.freeze,
        palette: readPalette(element),
        colour: view.kind === "time" ? colours.time : colours.volume,
        playhead: colours.playhead,
      });
    };
    draw();
    return () => cancelAnimationFrame(frame);
  }, [effectId, points, size, view, slot, hot]);

  const local = (e: { clientX: number; clientY: number }) => {
    const rect = wrap.current!.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };
  return (
    <div
      ref={wrap}
      className="relative min-w-0 flex-1 overflow-hidden"
      data-testid="gross-panel"
      data-kind={view.kind}
      data-slot={slot}
      onContextMenu={(e) => e.preventDefault()}
      onPointerDown={(e) => {
        const { x, y } = local(e);
        panelPointerDown(e, wrap.current!, target(), x, y);
      }}
      onPointerMove={(e) => {
        const { x, y } = local(e);
        const t = target();
        e.currentTarget.style.cursor = panelCursor(t, x, y);
        const hit = t.view.freeze ? null : hitCurve(t.points, t.box, x, y);
        const found = hit?.kind === "point" ? hit.index : null;
        if (found !== hot) setHot(found);
      }}
      onPointerLeave={() => setHot(null)}
    >
      <canvas ref={canvas} className="absolute inset-0 size-full" />
      <PointMenu effectId={effectId} gb={gb} />
      <PanelHint effectId={effectId} gb={gb} hot={hot} />
    </div>
  );
}

/** What the point under the pointer is (FL's hint bar), over the panel's top. */
function PanelHint({ effectId, gb, hot }: { effectId: string; gb: GrossBeat; hot: number | null }) {
  const view = useGrossView(effectId);
  const drag = useGrossUi((s) => (s.drag?.effectId === effectId ? s.drag : null));
  const points = drag?.points ?? grossSlot(gb, view.kind, pickedSlot(gb, view.kind)).points;
  if (hot === null || !points[hot]) return null;
  return (
    <div className="pointer-events-none absolute top-1 right-2 rounded-sm bg-popover/90 px-1.5 py-0.5 text-[10px] text-popover-foreground shadow-sm" data-testid="gross-hint">
      {pointHint(points, hot, view.kind)}
    </div>
  );
}

/** A point's menu (right-click): its curve type, Pitch for a time envelope, Delete. */
function PointMenu({ effectId, gb }: { effectId: string; gb: GrossBeat }) {
  const menu = useGrossUi((s) => (s.pointMenu?.effectId === effectId ? s.pointMenu : null));
  if (!menu) return null;
  const points = grossSlot(gb, menu.kind, menu.slot).points;
  const point = points[menu.index];
  if (!point) return null;
  const close = () => useGrossUi.setState({ pointMenu: null });
  const commit = (change: Parameters<typeof editGrossSlot>[4]) => useMusic.getState().commit((s) => editGrossSlot(s, effectId, menu.kind, menu.slot, change));
  const first = menu.index === 0;
  return (
    <DropdownMenu open onOpenChange={(open) => !open && close()}>
      <DropdownMenuTrigger asChild>
        <span aria-hidden className="pointer-events-none absolute size-px" style={{ left: menu.x, top: menu.y }} />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" data-testid="gross-point-menu" onCloseAutoFocus={(e) => e.preventDefault()}>
        <DropdownMenuLabel className="text-[11px] text-muted-foreground">
          Point {menu.index + 1}/{points.length}
        </DropdownMenuLabel>
        <DropdownMenuItem variant="destructive" disabled={first} onSelect={() => commit((list) => deletePoint(list, menu.index))}>
          Delete <DropdownMenuShortcut>⌥click</DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuRadioGroup value={first ? "" : point.curve} onValueChange={(curve) => commit((list) => updatePoint(list, menu.index, { curve: curve as CurveType }))}>
          {GROSS_CURVES.map((curve) => (
            <DropdownMenuRadioItem key={curve} value={curve} disabled={first}>
              {CURVE_NAMES[curve]}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
        {menu.kind === "time" && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuLabel className="text-[11px] text-muted-foreground">Pitch</DropdownMenuLabel>
            <DropdownMenuItem disabled={first} onSelect={() => commit((list) => pitchSegment(list, menu.index, 1))}>
              1 semitone up
            </DropdownMenuItem>
            <DropdownMenuItem disabled={first} onSelect={() => commit((list) => pitchSegment(list, menu.index, -1))}>
              1 semitone down
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// ---------------------------------------------------------------------------
// The bar under the panel
// ---------------------------------------------------------------------------

/** The slot's name (click to rename), Link slots, Key-held, One-shot, and the HOLD, TRIG SYNC and POS SYNC choices. */
function BottomBar({ effectId, gb }: { effectId: string; gb: GrossBeat }) {
  const kind = useGrossView(effectId).kind;
  const slot = pickedSlot(gb, kind);
  const name = grossSlot(gb, kind, slot).name;
  const [renaming, setRenaming] = useState<string | null>(null);
  const set = (patch: Partial<GrossBeat>) => useMusic.getState().commit((s) => updateGrossBeat(s, effectId, patch));
  return (
    <div className="@container flex h-8 shrink-0 items-center gap-1.5 border-t border-line bg-surface-1 px-2 text-[11px]">
      {renaming === null ? (
        <button
          type="button"
          className={cn("min-w-16 flex-1 truncate text-left italic hover:underline", kind === "time" ? "text-gross-time" : "text-gross-volume")}
          title="Click to rename the slot"
          data-testid="gross-slot-name"
          onClick={() => setRenaming(name)}
        >
          {kind === "time" ? "Time" : "Volume"}: {name}
        </button>
      ) : (
        <form
          className="min-w-16 flex-1"
          onSubmit={(e) => {
            e.preventDefault();
            renameSlot(effectId, kind, slot, renaming);
            setRenaming(null);
          }}
        >
          <Input
            autoFocus
            aria-label="Slot name"
            className="h-6 text-[11px]"
            value={renaming}
            onChange={(e) => setRenaming(e.target.value)}
            onFocus={(e) => e.currentTarget.select()}
            onBlur={() => setRenaming(null)}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === "Escape") setRenaming(null);
            }}
          />
        </form>
      )}
      <StripButton label="Link slots: picking a time slot picks the volume slot of the same number, and back" on={gb.linkSlots} onClick={() => set({ linkSlots: !gb.linkSlots })}>
        <PiLinkSimple className="size-3.5" />
      </StripButton>
      <StripButton label="Key-held: needs slots triggered from MIDI notes, which YT-Time can't hear yet" disabled onClick={() => {}}>
        <PiPianoKeys className="size-3.5" />
      </StripButton>
      <StripButton label="One-shot: a slot plays once (a bar), then slot 1" on={gb.oneShot} onClick={() => set({ oneShot: !gb.oneShot })}>
        1
      </StripButton>
      <Choice label="HOLD" value={gb.hold} options={(["off", "last", "next"] as const).map((v) => ({ value: v, text: HOLD_TEXT[v], short: HOLD_TEXT[v] }))} onChange={(hold) => set({ hold })} />
      <Choice label="TRIG SYNC" value={gb.trigSync} options={GROSS_SYNCS.map((v) => ({ value: v, text: syncText(v), short: syncShort(v) }))} onChange={(trigSync) => set({ trigSync })} />
      <Choice label="POS SYNC" value={gb.posSync} options={GROSS_SYNCS.map((v) => ({ value: v, text: syncText(v), short: syncShort(v) }))} onChange={(posSync) => set({ posSync })} />
    </div>
  );
}

/** One of the bar's choices, FL's "TRIG SYNC: 1/4 ▾" (the menu says it whole: "1/4 beat"). */
function Choice<T extends string | number>({ label, value, options, onChange }: { label: string; value: T; options: readonly { value: T; text: string; short: string }[]; onChange: (value: T) => void }) {
  const current = options.find((o) => o.value === value);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" className="flex h-6 shrink-0 items-center gap-1 rounded-sm px-1.5 raised hover:raised-hover" aria-label={`${label}: ${current?.text ?? String(value)}`}>
          {/* Narrow, "TRIG:" for "TRIG SYNC:". */}
          <span className="text-[9px] font-medium tracking-wide text-muted-foreground">
            <span className="hidden @[29rem]:inline">{label}:</span>
            <span className="@[29rem]:hidden">{label.split(" ")[0]}:</span>
          </span>
          <span className="tabular-nums">{current?.short ?? String(value)}</span>
          <PiCaretDown className="size-2.5 text-muted-foreground" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuRadioGroup value={String(value)} onValueChange={(v) => onChange(options.find((o) => String(o.value) === v)!.value)}>
          {options.map((o) => (
            <DropdownMenuRadioItem key={String(o.value)} value={String(o.value)}>
              {o.text}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
