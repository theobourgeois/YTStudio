/**
 * The Modulators window (`docs/sidechain.md`; FL's Peak Controller's settings and its links, Bitwig's
 * modulators): the song's modulators on the left with their levels, the one chosen on the right: its name,
 * what it follows (a track at a tap, or a channel's notes), its follower (attack, release, gain, tension) and
 * the controls it moves, each with its amount. Opened from a control's Modulate menu or the Mixer's menu.
 */
import { type ReactNode, useRef } from "react";
import { PiPlus, PiTrash, PiWaveform, PiX } from "react-icons/pi";
import { cn } from "cn";
import { controlOf } from "@shared/music/automation";
import { DEFAULT_TAP, SIDECHAIN_TAP_NAMES } from "@shared/music/sidechain";
import { MODULATOR_RANGES, amountText, canModulate, linkControl, linkRangeText, modulatorName, removeModulator, sourceText, updateModulator } from "@shared/music/modulation";
import { type AutomationTarget, type Modulator, type ModulatorSource, type MusicProject, SIDECHAIN_TAPS, type SidechainTap } from "@shared/music/types";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSub, DropdownMenuSubContent, DropdownMenuSubTrigger, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Knob, SongKnob, type ValueUnit } from "../knob";
import { songGesture, useMusic, useSong } from "../store";
import { centredOnDesktop, MusicWindow } from "../window";
import { linkTo, newModulator } from "./actions";
import { parameterTarget } from "../automation/actions";
import { useAutomationUi } from "../automation/store";
import { useModulationUi } from "./store";

const MS: ValueUnit = { scale: 1000, unit: "ms" };
const DB: ValueUnit = { scale: 1, unit: "dB", digits: 1 };
const PLAIN: ValueUnit = { scale: 1, unit: "", digits: 2 };
const AMOUNT: ValueUnit = { scale: 100, unit: "%" };
const time = (s: number) => (s < 1 ? `${Math.round(s * 1000)} ms` : `${s.toFixed(2)} s`);
const commit = (update: (song: MusicProject) => MusicProject) => useMusic.getState().commit(update);

export function ModulatorsWindow() {
  const modulators = useSong((s) => s.modulators);
  const selected = useModulationUi((s) => s.selected);
  const shown = modulators.find((m) => m.id === selected) ?? modulators[0] ?? null;
  return (
    <MusicWindow id="modulators" title="Modulators" initial={centredOnDesktop(600, 380)} onClose={() => useModulationUi.getState().close()} className="w-[600px]">
      <div className="flex h-[360px] min-h-0" data-testid="modulators-window">
        <aside className="flex w-44 shrink-0 flex-col border-r border-line bg-surface-1">
          <ol className="min-h-0 flex-1 overflow-y-auto p-1" aria-label="Modulators">
            {modulators.map((m) => (
              <ModulatorRow key={m.id} modulator={m} selected={m === shown} />
            ))}
          </ol>
          <div className="border-t border-line p-1.5">
            <NewModulator />
          </div>
        </aside>
        {shown ? (
          <ModulatorPanel key={shown.id} modulator={shown} />
        ) : (
          <div className="flex flex-1 items-center justify-center p-6 text-center text-xs text-muted-foreground">
            No modulators yet. Right-click any knob or fader → Modulate → Follow track (a kick to duck a bass), or make one with New.
          </div>
        )}
      </div>
    </MusicWindow>
  );
}

function ModulatorRow({ modulator, selected }: { modulator: Modulator; selected: boolean }) {
  const name = useSong((s) => modulatorName(s, modulator));
  const level = useModulationUi((s) => s.levels[modulator.id] ?? 0);
  return (
    <li>
      <button
        type="button"
        className={cn("flex w-full flex-col gap-0.5 rounded-sm px-2 py-1 text-left text-xs", selected ? "bg-surface-3" : "hover:bg-surface-2")}
        onClick={() => useModulationUi.getState().select(modulator.id)}
        data-testid="modulator-row"
      >
        <span className="flex items-center gap-1.5">
          <PiWaveform className="size-3 shrink-0 text-muted-foreground" />
          <span className="truncate">{name}</span>
          <span className="ml-auto text-[10px] text-muted-foreground tabular-nums">{modulator.links.length}</span>
        </span>
        <LevelBar level={level} />
      </button>
    </li>
  );
}

function LevelBar({ level, tall }: { level: number; tall?: boolean }) {
  return (
    <span className={cn("sunken block w-full overflow-hidden rounded-[2px]", tall ? "h-2" : "h-1")} aria-hidden>
      <span className="block h-full bg-brand" style={{ width: `${Math.round(Math.min(1, level) * 100)}%` }} />
    </span>
  );
}

/** + New: a modulator following a track or a channel's notes, with nothing linked yet. */
function NewModulator() {
  const tracks = useSong((s) => s.mixer.tracks);
  const channels = useSong((s) => s.channels);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" className="h-6 w-full justify-start gap-1 text-xs" data-testid="new-modulator">
          <PiPlus className="size-3" /> New
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>Follow track</DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="max-h-[60vh] overflow-y-auto">
            {tracks.map((t, number) => (
              <DropdownMenuItem key={t.id} onSelect={() => newModulator({ kind: "track", track: t.id, tap: DEFAULT_TAP })}>
                <span className="w-6 text-muted-foreground tabular-nums">{number || "M"}</span>
                {t.name ?? (number === 0 ? "Master" : `Insert ${number}`)}
              </DropdownMenuItem>
            ))}
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>Follow notes of</DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="max-h-[60vh] overflow-y-auto">
            {channels.map((c) => (
              <DropdownMenuItem key={c.id} onSelect={() => newModulator({ kind: "notes", channel: c.id })}>
                {c.name}
              </DropdownMenuItem>
            ))}
          </DropdownMenuSubContent>
        </DropdownMenuSub>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** A source as the source picker's value: "t:<track>" or "n:<channel>". */
const sourceValue = (source: ModulatorSource) => (source.kind === "track" ? `t:${source.track}` : `n:${source.channel}`);

function ModulatorPanel({ modulator }: { modulator: Modulator }) {
  const id = modulator.id;
  const tracks = useSong((s) => s.mixer.tracks);
  const channels = useSong((s) => s.channels);
  const name = useSong((s) => modulatorName(s, modulator));
  const said = useSong((s) => sourceText(s, modulator.source));
  const level = useModulationUi((s) => s.levels[id] ?? 0);
  const source = modulator.source;
  const tap: SidechainTap = source.kind === "track" ? source.tap : DEFAULT_TAP;
  const r = MODULATOR_RANGES;
  return (
    <section className="flex min-w-0 flex-1 flex-col gap-3 overflow-y-auto p-3 text-xs" aria-label={name} data-testid="modulator-panel" data-modulator={id}>
      <div className="flex items-center gap-2">
        <Input
          aria-label="Modulator name"
          className="h-7 flex-1 text-xs"
          defaultValue={modulator.name ?? ""}
          placeholder={name}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === "Enter") e.currentTarget.blur();
          }}
          onBlur={(e) => commit((s) => updateModulator(s, id, { name: e.currentTarget.value }))}
        />
        <Button variant="ghost" size="icon-xs" aria-label="Delete the modulator" title="Delete it (its controls go back to their own values)" onClick={() => commit((s) => removeModulator(s, id))}>
          <PiTrash />
        </Button>
      </div>

      <div className="flex items-center gap-2">
        <span className="w-14 shrink-0 text-muted-foreground">Follows</span>
        <Select
          value={sourceValue(source)}
          onValueChange={(value) => {
            const next: ModulatorSource = value.startsWith("t:") ? { kind: "track", track: value.slice(2), tap } : { kind: "notes", channel: value.slice(2) };
            commit((s) => updateModulator(s, id, { source: next }));
          }}
        >
          <SelectTrigger size="sm" className="h-7 min-w-0 flex-1 text-xs" aria-label="What it follows">
            <SelectValue>{said}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              <SelectLabel className="text-[10px]">A track's level</SelectLabel>
              {tracks.map((t, number) => (
                <SelectItem key={t.id} value={`t:${t.id}`}>
                  {number || "M"} {t.name ?? (number === 0 ? "Master" : `Insert ${number}`)}
                </SelectItem>
              ))}
            </SelectGroup>
            <SelectGroup>
              <SelectLabel className="text-[10px]">A channel's notes</SelectLabel>
              {channels.map((c) => (
                <SelectItem key={c.id} value={`n:${c.id}`}>
                  {c.name}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
        {source.kind === "track" && (
          <Select value={tap} onValueChange={(t) => commit((s) => updateModulator(s, id, { source: { ...source, tap: t as SidechainTap } }))}>
            <SelectTrigger size="sm" className="h-7 w-36 text-xs" aria-label="Where it's taken">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {SIDECHAIN_TAPS.map((t) => (
                <SelectItem key={t} value={t}>
                  {SIDECHAIN_TAP_NAMES[t]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>

      <div className="flex items-end gap-4">
        <Labelled label="ATT">
          <SongKnob size={30} label="Attack" value={modulator.attack} min={r.attack[0]} max={r.attack[1]} defaultValue={0.002} format={time} unit={MS} edit={(s, attack) => updateModulator(s, id, { attack })} />
        </Labelled>
        <Labelled label="REL">
          <SongKnob size={30} label="Release" value={modulator.release} min={r.release[0]} max={r.release[1]} taper="log" defaultValue={0.15} format={time} unit={MS} edit={(s, release) => updateModulator(s, id, { release })} />
        </Labelled>
        <Labelled label="GAIN">
          <SongKnob size={30} label="Gain" value={modulator.gain} min={r.gain[0]} max={r.gain[1]} bipolar defaultValue={0} format={(v) => `${v > 0 ? "+" : ""}${v.toFixed(1)} dB`} unit={DB} edit={(s, gain) => updateModulator(s, id, { gain })} />
        </Labelled>
        <Labelled label="TENS">
          <SongKnob size={30} label="Tension" value={modulator.tension} min={r.tension[0]} max={r.tension[1]} bipolar defaultValue={0} format={(v) => (Math.abs(v) < 0.005 ? "Straight" : v.toFixed(2))} unit={PLAIN} edit={(s, tension) => updateModulator(s, id, { tension })} />
        </Labelled>
        <div className="flex min-w-0 flex-1 flex-col gap-1 pb-1">
          <span className="text-[10px] text-muted-foreground">Level</span>
          <LevelBar level={level} tall />
        </div>
      </div>

      <div className="flex min-h-0 flex-col gap-1">
        <span className="text-[10px] tracking-wide text-muted-foreground uppercase">Moves</span>
        {modulator.links.length === 0 && <p className="text-muted-foreground">Nothing yet: right-click a knob or fader → Modulate → Link to → {name}.</p>}
        <ol className="flex flex-col gap-1">
          {modulator.links.map((_, i) => (
            <LinkRow key={i} modulator={modulator} index={i} />
          ))}
        </ol>
        <LinkTouched modulatorId={id} />
      </div>
    </section>
  );
}

/**
 * FL's way to link a plugin's parameter (whose window is the plugin's own): touch it, then link it here. Also
 * the last of our controls touched (a knob, a fader).
 */
function LinkTouched({ modulatorId }: { modulatorId: string }) {
  const touched = useAutomationUi((s) => s.touched);
  const control = useAutomationUi((s) => s.touchedControl);
  const song = useSong((s) => s);
  const targets = [touched ? parameterTarget(touched) : null, control].filter((t): t is AutomationTarget => !!t && canModulate(t) && controlOf(song, t).exists);
  if (!targets.length) return <p className="text-[10px] text-muted-foreground">A plugin's parameter: move it in its window, then link it here.</p>;
  return (
    <div className="flex flex-wrap gap-1">
      {targets.map((target) => {
        const info = controlOf(song, target);
        return (
          <Button key={target.kind} variant="outline" size="sm" className="h-6 gap-1 text-[11px]" onClick={() => linkTo(modulatorId, target)} data-testid="link-touched">
            <PiPlus className="size-3" /> Link {info.name} <span className="text-muted-foreground">of {info.owner}</span>
          </Button>
        );
      })}
    </div>
  );
}

function LinkRow({ modulator, index }: { modulator: Modulator; index: number }) {
  const gesture = useRef(songGesture()).current;
  const link = modulator.links[index];
  const song = useSong((s) => s);
  const info = controlOf(song, link.target);
  return (
    <li className="flex items-center gap-2 rounded-sm bg-surface-1 px-2 py-1" data-testid="modulation-link">
      <Knob
        size={22}
        label={`${info.name} (${info.owner}) amount`}
        value={link.amount}
        min={-1}
        max={1}
        bipolar
        defaultValue={-0.6}
        format={amountText}
        unit={AMOUNT}
        onBegin={() => gesture.begin()}
        onDrag={(amount) => gesture.apply((s) => linkControl(s, modulator.id, link.target, amount))}
        onEnd={() => gesture.end()}
        onCancel={() => gesture.cancel()}
        onSet={(amount) => commit((s) => linkControl(s, modulator.id, link.target, amount))}
      />
      <span className="w-12 shrink-0 text-right tabular-nums">{amountText(link.amount)}</span>
      <span className={cn("min-w-0 flex-1 truncate", !info.exists && "text-destructive")} title={info.exists ? linkRangeText(song, link) : "What it moved is gone"}>
        {info.name} <span className="text-muted-foreground">of {info.owner}</span>
      </span>
      {info.exists && link.target.kind !== "plugin" && <span className="shrink-0 text-[10px] text-muted-foreground">{linkRangeText(song, link)}</span>}
      <Button variant="ghost" size="icon-xs" aria-label={`Unlink ${info.name}`} onClick={() => commit((s) => linkControl(s, modulator.id, link.target, null))}>
        <PiX />
      </Button>
    </li>
  );
}

function Labelled({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-1">
      {children}
      <span className="text-[9px] font-semibold tracking-wider text-muted-foreground">{label}</span>
    </div>
  );
}
