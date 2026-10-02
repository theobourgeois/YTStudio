import { useEffect, useRef, useState } from "react";
import { PiCaretDown, PiDotsThreeBold, PiPianoKeys } from "react-icons/pi";
import { cn } from "cn";
import { mixerTrackName } from "@shared/music/automation";
import { updateEffect } from "@shared/music/mixer";
import { currentPreset, updatePitchWheel } from "@shared/music/pitch-wheel";
import { PITCH_WHEEL_PRESETS } from "@shared/music/pitch-wheel-presets";
import { type MixerEffect, type MusicProject, type PitchWheel, type PitchWheelControl, WHEEL_RANGES, WHEEL_SNAPS, type Wheel, type WheelRange, type WheelSnap } from "@shared/music/types";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { PERCENT, SongKnob, percent } from "../knob";
import { Lcd } from "../lcd";
import { pitchName } from "../piano/geometry";
import { songGesture, useSong } from "../store";
import { pitchWheelWindow } from "../ui";
import { MusicWindow, centredOnDesktop } from "../window";
import { applyPreset, closePitchWheel, copyWheelState, pasteWheelState, setPitchWheel } from "./actions";
import { Dial } from "./dial";
import { Keyboard } from "./keyboard";
import { freshWheel } from "./live";
import { useWheelUi } from "./store";

/** The dials' size: QuikQuak's are big, to be played. */
const DIAL = 232;

/** The effect in the song, by id (the object itself, so a selector of it is stable), with its track and slot. */
function placeOf(song: MusicProject, effectId: string): { effect: MixerEffect; trackId: string; slot: number } | null {
  for (const track of song.mixer.tracks) {
    const slot = track.effects.findIndex((e) => e?.id === effectId);
    if (slot >= 0) return { effect: track.effects[slot]!, trackId: track.id, slot };
  }
  return null;
}
const effectOf = (song: MusicProject, effectId: string) => placeOf(song, effectId)?.effect ?? null;
const trackOf = (song: MusicProject, effectId: string) => placeOf(song, effectId)?.trackId ?? "";

const SNAP_TEXT: Record<WheelSnap, string> = { off: "OFF", semitone: "ON", octave: "OCT" };
const SNAP_MENU: Record<WheelSnap, string> = { off: "Off: anywhere", semitone: "Semitones", octave: "Octaves" };
const amount = (v: number) => `${Math.round(v * 100)}`;

/**
 * A Pitch Wheel's window (`docs/quikquak/pitchwheel.md`), QuikQuak's Pitchwheel in our look: the
 * Pitchwheel and the Timbrewheel side by side (each its Range and Snap, the big wheel, gravity, inertia
 * and smooth), the Timbre tab between them; under them Single / Multi, where the notes come from, the
 * origin, the lights, the mix, and the keyboard.
 */
export function PitchWheelWindow({ effectId, index }: { effectId: string; index: number }) {
  const effect = useSong((s) => effectOf(s, effectId));
  const owner = useSong((s) => mixerTrackName(s, trackOf(s, effectId)));
  const [initial] = useState(() => {
    const place = centredOnDesktop(660, 520);
    return { ...place, x: place.x + index * 28, y: Math.min(place.y, 40) + index * 28 };
  });
  const pw = effect?.pitchWheel;
  // Its effect deleted (or replaced): its window goes, as a plugin's does.
  const gone = !pw;
  useEffect(() => {
    if (gone) closePitchWheel(effectId);
  }, [gone, effectId]);
  if (!effect || !pw) return null;
  return (
    <MusicWindow id={pitchWheelWindow(effectId)} title={`${effect.plugin.name} (${owner})`} initial={initial} onClose={() => closePitchWheel(effectId)}>
      <div className="flex flex-col text-xs select-none" data-testid="pitch-wheel" data-effect={effectId}>
        <TopBar effectId={effectId} pw={pw} />
        <div className="flex border-b border-line bg-surface-1">
          <WheelPanel effectId={effectId} wheel="pitch" settings={pw.pitch} closed={false} />
          <TimbreTab effectId={effectId} on={pw.timbreOn} />
          <WheelPanel effectId={effectId} wheel="timbre" settings={pw.timbre} closed={!pw.timbreOn} />
        </div>
        <BottomBar effectId={effectId} pw={pw} effect={effect} />
      </div>
    </MusicWindow>
  );
}

// ---------------------------------------------------------------------------
// The top bar
// ---------------------------------------------------------------------------

function TopBar({ effectId, pw }: { effectId: string; pw: PitchWheel }) {
  const preset = currentPreset(pw);
  const copied = useWheelUi((s) => s.copiedState !== null);
  return (
    <div className="flex h-10 shrink-0 items-center gap-1.5 border-b border-line bg-surface-2 px-2">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button type="button" className="flex h-7 w-52 items-center gap-1.5 rounded-sm px-2 raised hover:raised-hover" aria-label={`Preset: ${preset ?? "Custom"}`} data-testid="wheel-preset">
            <span className="text-[9px] font-semibold tracking-wider text-muted-foreground uppercase">Preset</span>
            <span className="truncate font-medium">{preset ?? "Custom"}</span>
            <PiCaretDown className="ml-auto size-2.5 text-muted-foreground" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-80">
          {PITCH_WHEEL_PRESETS.map((p) => (
            <DropdownMenuItem key={p.name} onSelect={() => applyPreset(effectId, p.name)} className="flex-col items-start gap-0">
              <span className={cn("font-medium", p.name === preset && "text-wheel-pitch")}>{p.name}</span>
              <span className="text-[10px] text-muted-foreground">{p.detail}</span>
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      <div className="flex-1" />
      <Segmented
        label="Resolution"
        value={pw.resolution}
        options={[
          { value: "tight", text: "Tight", title: "Tight: a 43 ms window, for drums and voices (QuikQuak's)" },
          { value: "wide", text: "Wide", title: "Wide: an 85 ms window, smoother for bass and pads (later by as much: compensated)" },
        ]}
        onChange={(resolution) => setPitchWheel(effectId, { resolution })}
      />
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button type="button" aria-label="Options" title="Options" className="grid size-7 shrink-0 place-items-center rounded-sm raised text-muted-foreground hover:raised-hover hover:text-foreground">
            <PiDotsThreeBold className="size-4" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={() => setPitchWheel(effectId, { pitch: { value: 0 }, timbre: { value: 0 } })}>Centre both wheels</DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => copyWheelState(effectId)}>Copy state</DropdownMenuItem>
          <DropdownMenuItem disabled={!copied} onSelect={() => pasteWheelState(effectId)}>
            Paste state
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

/** Two or three choices side by side, the chosen one pressed in. */
function Segmented<T extends string>({ label, value, options, onChange, testId }: { label: string; value: T; options: { value: T; text: string; title: string }[]; onChange: (value: T) => void; testId?: string }) {
  return (
    <div className="flex items-center gap-1.5" role="radiogroup" aria-label={label} data-testid={testId}>
      <span className="text-[9px] font-semibold tracking-wider text-muted-foreground uppercase">{label}</span>
      <div className="flex rounded-sm">
        {options.map((o, i) => (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={o.value === value}
            title={o.title}
            onClick={() => onChange(o.value)}
            className={cn(
              "h-6 px-2.5 text-[11px] font-medium",
              i === 0 ? "rounded-l-sm" : "-ml-px",
              i === options.length - 1 && "rounded-r-sm",
              o.value === value ? "pressed text-wheel-pitch" : "raised text-muted-foreground hover:raised-hover hover:text-foreground",
            )}
          >
            {o.text}
          </button>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// The wheels
// ---------------------------------------------------------------------------

/** A wheel's panel: Range and Snap in its top corners, the wheel, its three knobs. */
function WheelPanel({ effectId, wheel, settings, closed }: { effectId: string; wheel: "pitch" | "timbre"; settings: Wheel; closed: boolean }) {
  const name = wheel === "pitch" ? "Pitch" : "Timbre";
  const knob = (field: "gravity" | "inertia" | "smooth", title: string) => (
    <div className="flex flex-col items-center gap-1" title={title}>
      <SongKnob
        size={38}
        label={`${name} ${field}`}
        value={settings[field]}
        min={0}
        max={1}
        defaultValue={field === "smooth" ? 0.1 : field === "gravity" ? 0.75 : 0.45}
        format={amount}
        unit={{ scale: 100, unit: "" }}
        target={{ kind: "pitchWheel", effect: effectId, control: `${wheel}${field[0].toUpperCase()}${field.slice(1)}` as PitchWheelControl }}
        edit={(s, value) => updatePitchWheel(s, effectId, { [wheel]: { [field]: value } })}
      />
      <span className="text-[10px] font-semibold tracking-wide text-muted-foreground lowercase">{field}</span>
    </div>
  );
  return (
    <div className={cn("relative flex w-[300px] flex-col items-center px-3 pt-3 pb-3", closed && "pointer-events-none")} data-testid={`wheel-panel-${wheel}`}>
      <div className={cn("absolute top-2.5 left-2.5 z-10", closed && "opacity-45")}>
        <Corner
          label="Range"
          value={String(settings.range)}
          title={`${name} range: the semitones the dial spans`}
          options={WHEEL_RANGES.map((r) => ({ value: String(r), text: `${r} semitones (±${r / 2})` }))}
          onChange={(v) => setPitchWheel(effectId, { [wheel]: { range: Number(v) as WheelRange } })}
          testId={`wheel-${wheel}-range`}
        />
      </div>
      <div className={cn("absolute top-2.5 right-2.5 z-10", closed && "opacity-45")}>
        <Corner
          label="Snap"
          value={SNAP_TEXT[settings.snap]}
          current={settings.snap}
          title={`${name} snap: where the pointer lands`}
          options={WHEEL_SNAPS.map((s) => ({ value: s, text: SNAP_MENU[s] }))}
          onChange={(v) => setPitchWheel(effectId, { [wheel]: { snap: v as WheelSnap } })}
          testId={`wheel-${wheel}-snap`}
        />
      </div>
      <Dial effectId={effectId} wheel={wheel} settings={settings} closed={closed} size={DIAL} />
      <div className={cn("mt-1 flex gap-6", closed && "opacity-45")}>
        {knob("gravity", "Gravity: how hard what's heard is held to the pointer. Low, it swings past and back (the elastic is weak); high, it's clamped to it")}
        {knob("inertia", "Inertia: how slowly what's heard heads for the pointer (it shows at low gravity)")}
        {knob("smooth", "Smooth: how slowly the pointer itself is followed. High, it glides between pitches (and overrides gravity and inertia)")}
      </div>
    </div>
  );
}

/** QuikQuak's corner box: the value big on an LCD, its name under it, a menu of the choices. */
function Corner({ label, value, current = value, title, options, onChange, testId }: { label: string; value: string; current?: string; title: string; options: { value: string; text: string }[]; onChange: (value: string) => void; testId: string }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" title={title} aria-label={`${label}: ${value}`} className="group flex flex-col items-center gap-0.5" data-testid={testId}>
          <span className={cn("lcd flex h-7 min-w-10 items-center justify-center rounded-sm px-1.5 leading-none tabular-nums group-hover:brightness-110", /^\d+$/.test(value) ? "font-mono text-[15px]" : "text-[11px] font-bold tracking-wider")}>{value}</span>
          <span className="text-[9px] font-semibold tracking-wider text-muted-foreground uppercase">{label}</span>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        <DropdownMenuLabel className="text-[10px] tracking-wider text-muted-foreground uppercase">{label}</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={current} onValueChange={onChange}>
          {options.map((o) => (
            <DropdownMenuRadioItem key={o.value} value={o.value}>
              {o.text}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** The Timbre tab between the wheels: open, the Timbre wheel sets the formants; closed, they move with the pitch. */
function TimbreTab({ effectId, on }: { effectId: string; on: boolean }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      aria-label="Timbre"
      data-testid="wheel-timbre-tab"
      title={on ? "Timbre open: the formants are the Timbre wheel's (at 0 they stay as they were, so a voice keeps its character). Click to close it: they move with the pitch, as a tape's do" : "Timbre closed: the formants move with the pitch (the chipmunk). Click to open it: the Timbre wheel sets them"}
      onClick={() => setPitchWheel(effectId, { timbreOn: !on })}
      className={cn("my-3 flex w-7 shrink-0 flex-col items-center justify-center gap-2 rounded-sm", on ? "pressed" : "raised hover:raised-hover")}
    >
      <span className={cn("size-1.5 rounded-full", on ? "bg-wheel-timbre shadow-[0_0_6px_var(--wheel-timbre)]" : "bg-muted-foreground/40")} />
      <span className={cn("text-[10px] font-bold tracking-[0.2em] uppercase [writing-mode:vertical-rl]", on ? "text-wheel-timbre" : "text-muted-foreground")}>Timbre</span>
      <span className="text-[9px] font-semibold text-muted-foreground uppercase [writing-mode:vertical-rl]">{on ? "On" : "Off"}</span>
    </button>
  );
}

// ---------------------------------------------------------------------------
// MIDI, the lights, the mix, the keyboard
// ---------------------------------------------------------------------------

function BottomBar({ effectId, pw, effect }: { effectId: string; pw: PitchWheel; effect: MixerEffect }) {
  const channels = useSong((s) => s.channels);
  const trackId = useSong((s) => trackOf(s, effectId));
  const slot = useSong((s) => placeOf(s, effectId)?.slot ?? -1);
  const source = channels.find((c) => c.id === pw.notesFrom) ?? null;
  const origin = useRef(songGesture()).current;
  return (
    <div className="flex flex-col gap-2 bg-surface-0 px-3 pt-2 pb-3">
      <div className="flex items-center gap-3">
        <Lights effectId={effectId} />
        <Segmented
          label="Midi"
          testId="wheel-midi-mode"
          value={pw.midiMode}
          options={[
            { value: "single", text: "Single", title: "Single: the sound is always heard; the latest note moves it (from the origin), and it stays there" },
            { value: "multi", text: "Multi", title: "Multi: each note plays the sound at its own pitch (up to 8: harmonies), silent without notes" },
          ]}
          onChange={(midiMode) => setPitchWheel(effectId, { midiMode })}
        />
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button type="button" className="flex h-6 max-w-44 items-center gap-1.5 rounded-sm px-2 raised hover:raised-hover" aria-label={`Notes from: ${source?.name ?? "the keyboard only"}`} data-testid="wheel-notes-from" title="The channel whose notes play it (mute that channel to hear only the result)">
              <PiPianoKeys className="size-3.5 shrink-0 text-muted-foreground" />
              <span className="truncate text-[11px] font-medium">{source?.name ?? "Keyboard only"}</span>
              <PiCaretDown className="size-2.5 shrink-0 text-muted-foreground" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent className="max-h-80 overflow-y-auto">
            <DropdownMenuLabel className="text-[10px] tracking-wider text-muted-foreground uppercase">Notes from</DropdownMenuLabel>
            <DropdownMenuRadioGroup value={pw.notesFrom ?? ""} onValueChange={(id) => setPitchWheel(effectId, { notesFrom: id || null })}>
              <DropdownMenuRadioItem value="">Keyboard only</DropdownMenuRadioItem>
              {channels.map((c) => (
                <DropdownMenuRadioItem key={c.id} value={c.id}>
                  {c.name}
                  {c.muted ? <span className="ml-1 text-muted-foreground">(muted)</span> : null}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
        <div className="flex items-center gap-1.5" title="The origin: the note that shifts nothing. A note a semitone above it plays the sound a semitone up. Drag, scroll, or right-click a key">
          <span className="text-[9px] font-semibold tracking-wider text-muted-foreground uppercase">Origin</span>
          <Lcd
            value={pw.origin}
            min={0}
            max={127}
            label="Origin"
            text={pitchName(pw.origin)}
            className="w-11"
            typeIn={{ initial: pitchName(pw.origin), onType: (text) => setPitchWheel(effectId, { origin: parseNote(text) ?? pw.origin }) }}
            onBegin={() => origin.begin()}
            onChange={(value) => origin.apply((s) => updatePitchWheel(s, effectId, { origin: value }))}
            onEnd={() => origin.end()}
            onCancel={() => origin.cancel()}
          />
        </div>
        <div className="flex-1" />
        {slot >= 0 && (
          <div className="flex items-center gap-1.5">
            <span className="text-[9px] font-semibold tracking-wider text-muted-foreground uppercase">Mix</span>
            <SongKnob
              size={26}
              label="Mix"
              value={effect.mix}
              min={0}
              max={1}
              defaultValue={1}
              format={percent}
              unit={PERCENT}
              target={{ kind: "effect", effect: effectId }}
              edit={(s, mix) => updateEffect(s, trackId, slot, { mix })}
            />
          </div>
        )}
      </div>
      <Keyboard effectId={effectId} origin={pw.origin} multi={pw.midiMode === "multi"} onOrigin={(key) => setPitchWheel(effectId, { origin: key })} />
    </div>
  );
}

/** "C5", "F#4", "Bb3" or a MIDI number as a note (FL's octaves: C5 is 60). */
export function parseNote(text: string): number | null {
  const t = text.trim();
  if (/^\d{1,3}$/.test(t)) return Math.min(127, Number(t));
  const m = /^([a-g])([#b]?)(-?\d)$/i.exec(t);
  if (!m) return null;
  const base = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 }[m[1].toLowerCase() as "c"];
  const note = base + (m[2] === "#" ? 1 : m[2] === "b" ? -1 : 0) + Number(m[3]) * 12;
  return note >= 0 && note <= 127 ? note : null;
}

/** The input and MIDI lights: lit by what the engine says, straight into their style (nothing re-renders). */
function Lights({ effectId }: { effectId: string }) {
  const input = useRef<HTMLSpanElement>(null);
  const midi = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    let frame = 0;
    const loop = () => {
      frame = requestAnimationFrame(loop);
      const fresh = freshWheel(effectId);
      const level = fresh ? Math.min(1, Math.sqrt(fresh.state.input) * 1.6) : 0;
      if (input.current) input.current.style.opacity = String(0.18 + 0.82 * level);
      if (midi.current) midi.current.style.opacity = fresh?.state.notes.length ? "1" : "0.18";
    };
    loop();
    return () => cancelAnimationFrame(frame);
  }, [effectId]);
  return (
    <div className="flex items-center gap-2.5">
      <span className="flex items-center gap-1 text-[9px] font-semibold tracking-wider text-muted-foreground uppercase" title="Input: sound coming in">
        <span ref={input} className="size-2 rounded-full bg-wheel-pitch opacity-20 shadow-[0_0_6px_var(--wheel-pitch)]" />
        In
      </span>
      <span className="flex items-center gap-1 text-[9px] font-semibold tracking-wider text-muted-foreground uppercase" title="MIDI: notes playing it">
        <span ref={midi} className="size-2 rounded-full bg-wheel-handle-mark opacity-20 shadow-[0_0_6px_var(--wheel-handle-mark)]" />
        Midi
      </span>
    </div>
  );
}
