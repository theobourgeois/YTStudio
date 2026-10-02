import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { PiArrowFatDownFill, PiArrowsDownUp, PiArrowsLeftRight, PiCaretRightFill, PiCaretUpBold, PiClock, PiLockSimpleFill, PiMicrophoneFill, PiPlus } from "react-icons/pi";
import { cn } from "cn";
import { startPointerDrag } from "@/lib/pointer-drag";
import { setMixerVolumes, trackName, updateMixerTrack } from "@shared/music/mixer";
import { SELECTION_METER } from "@shared/music/engine";
import { type Hearing, cutOffBy, hearing } from "@shared/music/solo";
import { MASTER_TRACK_ID, TRACK_COLORS } from "@shared/music/project";
import type { AutomationTarget, Mixer, MixerTrack, MusicProject } from "@shared/music/types";
import { AutomationMenuItems, useAutomatedControl } from "../automation/control";
import { Button } from "@/components/ui/button";
import {
  ContextMenu,
  ContextMenuCheckboxItem,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  DropdownMenu,
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
import { PERCENT, SongKnob, panText, percent } from "../knob";
import { songGesture, useMusic, useSong } from "../store";
import { useTransport } from "../transport";
import { currentTrackId, useMusicUi } from "../ui";
import { MusicWindow } from "../window";
import {
  addTrackAfterCurrent,
  addTrackAtEnd,
  dockTracks,
  groupTracks,
  renameMixerGroup,
  toggleSeparator,
  ungroupTracks,
  colourTrack,
  copyTrackState,
  deleteTracks,
  moveSelectedTracks,
  pasteTrackStateOnto,
  renameTrack,
  routeSelectedChannels,
  routeSelectedTracksTo,
  selectChannelsOn,
  selectedTracks,
  sendOnlyTo,
  sidechainTo,
  clearSolo,
  soloAlone,
  toggleSolo,
  toggleSoloSafe,
  selectGroup,
  selectOnlyCurrent,
  selectTrackRange,
  groupKnob,
  setTrackSwitch,
  toggleSend,
  groupSend,
  toggleTrackMute,
  assignAudioTracksTo,
} from "./actions";
import { Cables } from "./cables";
import { type SendState, sendStates } from "./send-states";
import { Fader } from "./fader";
import { Led } from "./led";
import { ArmButton } from "./arm-button";
import { useRecording } from "../recording";
import { faderDb, meterScale, moveFadersTogether } from "./meter";
import { useMeters } from "./meters";
import { Inspector } from "./inspector";
import { delayText, offsetText, pluginDelay } from "./latency";
import { MIXER_VIEWS, type MixerViewKind, STRIP_WIDTHS, VIEW_NAMES, trackAt, useMixerView } from "./view";


/** Strips drawn past each edge of the view, so a scroll doesn't show an empty one before they're drawn. */
const OVERSCAN = 4;

/** The inserts in view in the scrolling strip area, as `[first, last)` indexes into them. */
function useVisibleStrips(scroller: React.RefObject<HTMLDivElement | null>, count: number, stripWidth: number): [number, number] {
  const [view, setView] = useState({ left: 0, width: 1200 });
  useLayoutEffect(() => {
    const element = scroller.current;
    if (!element) return;
    let frame = 0;
    const measure = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => setView((v) => (v.left === element.scrollLeft && v.width === element.clientWidth ? v : { left: element.scrollLeft, width: element.clientWidth })));
    };
    setView({ left: element.scrollLeft, width: element.clientWidth });
    element.addEventListener("scroll", measure);
    const resize = new ResizeObserver(measure);
    resize.observe(element);
    return () => {
      cancelAnimationFrame(frame);
      element.removeEventListener("scroll", measure);
      resize.disconnect();
    };
  }, [scroller]);
  const first = Math.max(0, Math.floor(view.left / stripWidth) - OVERSCAN);
  const last = Math.min(count, Math.ceil((view.left + view.width) / stripWidth) + OVERSCAN);
  return [first, Math.max(first, last)];
}

/**
 * The Mixer (F9), FL Studio's (`docs/fl-studio/mixer.md`): the master and the insert tracks as strips
 * (name, meter, mute, pan, fader), the row of send switches along the bottom for the selected track,
 * and that track's inspector (its effect slots) on the right. Clicking a strip selects it; Ctrl+Shift
 * adds to the selection, and the selected faders then move together.
 */
export function MixerWindow() {
  const mixer = useSong((song) => song.mixer);
  const selectedIds = useMusicUi((s) => s.selectedTrackIds);
  const current = currentTrackId({ mixer } as MusicProject, selectedIds);
  const meterRef = useMeters();
  const scroller = useRef<HTMLDivElement>(null);
  const area = useRef<HTMLDivElement>(null);
  const revealing = useMixerView((s) => s.revealing);
  const view = useMixerView((s) => s.view);
  const stripWidth = STRIP_WIDTHS[view];

  // Every selected track is a source of the send row, the current one first.
  const sources = useMemo(() => [current, ...selectedIds.filter((id) => id !== current && mixer.tracks.some((t) => t.id === id))], [current, selectedIds, mixer.tracks]);
  const sends = useMemo(() => sendStates(mixer, sources), [mixer, sources]);

  // A track just added, or selected by a key, scrolls into view.
  useEffect(() => {
    if (!revealing) return;
    useMixerView.getState().reveal(null);
    const element = scroller.current;
    // Its place in the middle dock (a docked track is always in view).
    const index = mixer.tracks.filter((t) => t.id !== MASTER_TRACK_ID && t.dock === "middle").findIndex((t) => t.id === revealing);
    if (!element || index < 0) return;
    // By its place (it may not be drawn yet): just into view, at whichever edge it's past.
    const left = index * stripWidth;
    if (left < element.scrollLeft) element.scrollLeft = left;
    else if (left + stripWidth > element.scrollLeft + element.clientWidth) element.scrollLeft = left + stripWidth - element.clientWidth;
  }, [revealing, mixer.tracks, stripWidth]);
  // FL Studio's docks: the master and the left dock stay at the left, the right dock at the right, the middle scrolls between.
  const numbers = useMemo(() => new Map(mixer.tracks.map((t, i) => [t.id, i])), [mixer.tracks]);
  const docked = useMemo(() => {
    const [master, ...inserts] = mixer.tracks;
    return {
      left: [master, ...inserts.filter((t) => t.dock === "left")],
      middle: inserts.filter((t) => t.dock === "middle"),
      right: inserts.filter((t) => t.dock === "right"),
    };
  }, [mixer.tracks]);
  const inserts = docked.middle;
  // Dividers and group bands, from each dock's order (worked out for the whole dock, though only some of the middle is drawn).
  const layout = useMemo(() => {
    const names = new Map(mixer.groups.map((g) => [g.id, g.name]));
    const info = new Map<string, { separator: boolean; groupName: string | null }>();
    for (const list of [docked.left, docked.middle, docked.right])
      list.forEach((track, i) => {
        const before = list[i - 1];
        const edge = before !== undefined && before.group !== track.group && (before.group !== null || track.group !== null);
        info.set(track.id, { separator: track.separator || edge, groupName: track.group && before?.group !== track.group ? (names.get(track.group) ?? null) : null });
      });
    return info;
  }, [docked, mixer.groups]);
  const banded = mixer.groups.length > 0;
  const heard = useMemo(() => hearing(mixer), [mixer]);
  // Why each track that makes sound isn't heard (a muted bus on its way out), for its strip.
  const unheard = useMemo(() => {
    const reasons = new Map<string, string>();
    for (const track of mixer.tracks) {
      const h = heard.get(track.id)!;
      if (!h.silent && !h.heard) reasons.set(track.id, unheardReason(mixer, track, heard));
    }
    return reasons;
  }, [mixer, heard]);
  const [first, last] = useVisibleStrips(scroller, inserts.length, stripWidth);

  const strip = (track: MixerTrack, number = numbers.get(track.id)!) => (
    <Strip
      key={track.id}
      track={track}
      number={number}
      selected={selectedIds.includes(track.id)}
      current={track.id === current}
      sendKind={sends.get(track.id)!.kind}
      sendLevel={(sends.get(track.id) as { level?: number }).level ?? 0}
      sendOwner={(sends.get(track.id) as { owner?: string }).owner ?? null}
      sendPartial={(sends.get(track.id) as { partial?: boolean }).partial ?? false}
      meterRef={meterRef(track.id)}
      soloedOut={heard.get(track.id)!.soloedOut}
      implied={heard.get(track.id)!.implied}
      unheard={unheard.get(track.id) ?? null}
      view={view}
      separator={layout.get(track.id)?.separator ?? false}
      groupName={layout.get(track.id)?.groupName ?? null}
      banded={banded}
    />
  );

  return (
    <MusicWindow
      id="mixer"
      title="Mixer"
      // It opens filling the desktop (a double-click on its title makes it a window, as the Piano roll's).
      initial={{ x: 40, y: 230, width: 980, height: 480, snap: "full" }}
      resizable={{ minWidth: 520, minHeight: 330 }}
      onClose={() => useMusicUi.getState().setMixerOpen(false)}
      menu={<MixerMenu />}
      controls={
        <>
          <SoloIndicator />
          <ViewSwitch />
          <Button variant="ghost" size="icon-xs" aria-label="Add a mixer track" title="Add a mixer track after the selected one" className="text-muted-foreground hover:text-foreground" onClick={addTrackAfterCurrent}>
            <PiPlus />
          </Button>
        </>
      }
    >
      <div className="flex min-h-0 flex-1" data-testid="mixer">
        <div ref={area} className="relative flex min-w-0 flex-1 overflow-hidden" style={{ background: "var(--mixer-bg)" }} role="list" aria-label="Mixer tracks">
          <SelectionMeter meterRef={meterRef(SELECTION_METER)} />
          <div className="flex shrink-0 border-r-2" style={{ borderColor: "var(--mixer-line)" }} data-dock="left">
            {docked.left.map((track) => strip(track))}
          </div>
          <div
            ref={scroller}
            className="flex min-w-0 flex-1 overflow-x-auto overflow-y-hidden"
            data-testid="mixer-strips"
            // A press on the empty space past the strips: only the current track stays selected.
            onPointerDown={(e) => e.currentTarget.contains(e.target as Node) && !(e.target as HTMLElement).closest("[data-track], button") && selectOnlyCurrent()}
          >
            {/* Only the strips in view (and a few either side) are drawn: a mixer can have hundreds. */}
            <div className="flex shrink-0" style={{ paddingLeft: first * stripWidth, paddingRight: Math.max(0, inserts.length - last) * stripWidth }}>
              {inserts.slice(first, last).map((track) => strip(track))}
            </div>
            {/* After the last track, as FL's: a + to add one at the end. */}
            <button
              type="button"
              aria-label="Add a mixer track at the end"
              title="Add a mixer track at the end"
              className="grid w-9 shrink-0 place-items-center text-muted-foreground/60 hover:bg-surface-1 hover:text-foreground"
              onClick={addTrackAtEnd}
            >
              <PiPlus className="size-5" />
            </button>
          </div>
          {docked.right.length > 0 && (
            <div className="flex shrink-0 border-l-2" style={{ borderColor: "var(--mixer-line)" }} data-dock="right">
              {docked.right.map((track) => strip(track))}
            </div>
          )}
          <Cables area={area} mixer={mixer} sources={sources} />
        </div>
        <Inspector trackId={current} />
      </div>
      <CarriedState />
    </MusicWindow>
  );
}

/** The window's menu (its arrow). */
function MixerMenu() {
  const view = useMixerView((s) => s.view);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-xs" aria-label="Mixer menu" className="text-muted-foreground hover:text-foreground">
          <PiCaretRightFill />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        <DropdownMenuItem onSelect={addTrackAfterCurrent}>Add a track</DropdownMenuItem>
        <DropdownMenuItem onSelect={() => deleteTracks(selectedTracks())}>
          Delete selected tracks <DropdownMenuShortcut>⌥⌫</DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => routeSelectedChannels()}>
          Route selected channels to this track <DropdownMenuShortcut>⌘L</DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => routeSelectedChannels(undefined, true)}>
          Route selected channels starting from this track <DropdownMenuShortcut>⇧⌘L</DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuLabel className="text-[11px] text-muted-foreground">View</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={view} onValueChange={(next) => useMixerView.getState().setView(next as MixerViewKind)}>
          {MIXER_VIEWS.map((kind) => (
            <DropdownMenuRadioItem key={kind} value={kind}>
              {VIEW_NAMES[kind]}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * The title bar's solo light (Pro Tools' and Logic's): it blinks while any track is soloed, and a click
 * clears every solo. Dark otherwise.
 */
function SoloIndicator() {
  const count = useSong((song) => song.mixer.tracks.reduce((n, t) => n + (t.solo ? 1 : 0), 0));
  return (
    <button
      type="button"
      aria-label={count ? `Clear the solo (${count} soloed)` : "Nothing soloed"}
      disabled={!count}
      title={count ? `${count} track${count === 1 ? " is" : "s are"} soloed: click to clear every solo` : "Nothing is soloed"}
      className={cn("rounded-[3px] px-1.5 py-px font-mono text-[10px] leading-4 font-bold tracking-wide", count ? "animate-pulse hover:brightness-110" : "opacity-40")}
      style={count ? { background: "var(--mixer-solo)", color: "var(--mixer-solo-text)" } : { color: "var(--mixer-name)", boxShadow: "inset 0 0 0 1px var(--mixer-line)" }}
      data-testid="solo-indicator"
      onClick={clearSolo}
    >
      SOLO{count > 1 ? ` ${count}` : ""}
    </button>
  );
}

/** The view's name on the title bar, FL Studio's layout menu: a click goes to the next. */
function ViewSwitch() {
  const view = useMixerView((s) => s.view);
  const next = MIXER_VIEWS[(MIXER_VIEWS.indexOf(view) + 1) % MIXER_VIEWS.length];
  return (
    <button
      type="button"
      className="rounded-sm px-1.5 py-0.5 text-[11px] text-muted-foreground hover:bg-accent hover:text-foreground"
      title={`The mixer's view: ${VIEW_NAMES[view]} (click for ${VIEW_NAMES[next]})`}
      aria-label={`Mixer view: ${VIEW_NAMES[view]}`}
      onClick={() => useMixerView.getState().setView(next)}
    >
      {VIEW_NAMES[view]}
    </button>
  );
}

interface StripProps {
  track: MixerTrack;
  number: number;
  selected: boolean;
  current: boolean;
  /** Its send switch (as plain values, so a strip only renders again when its own changes). */
  sendKind: SendState["kind"];
  sendLevel: number;
  /** The selected track whose send its knob shows. */
  sendOwner: string | null;
  /** Only some of the selected tracks that could send to it do. */
  sendPartial: boolean;
  meterRef: (canvas: HTMLCanvasElement | null) => void;
  /** Silenced by other tracks' solo. */
  soloedOut: boolean;
  /** Kept on only because a soloed track's sound goes through it, or it feeds one. */
  implied: boolean;
  /** Why it isn't heard though it makes sound (a muted bus on its way out), or null. */
  unheard: string | null;
  view: MixerViewKind;
  /** A divider on its left (its own Separator, or a group's edge). */
  separator: boolean;
  /** The group's name, on the first track of a group (the band runs on over the rest). */
  groupName: string | null;
  /** The mixer has groups: every strip has room for their band, so they line up. */
  banded: boolean;
}

/** A track's strip, top to bottom: its number, its name beside its meter, mute, pan, fader, send switch. */
const Strip = memo(function Strip({ track, number, selected, current, sendKind, sendLevel, sendOwner, sendPartial, meterRef, soloedOut, implied, unheard, view, separator, groupName, banded }: StripProps) {
  const isMaster = track.id === MASTER_TRACK_ID;
  const name = track.name ?? (isMaster ? "Master" : `Insert ${number}`);
  const renaming = useMixerView((s) => s.renaming === track.id);
  const dropTarget = useMixerView((s) => s.carrying !== null && s.carrying.over === track.id && (s.carrying.from !== track.id || !!s.carrying.effect?.copy));
  const id = track.id;

  return (
    <div
      role="listitem"
      aria-label={name}
      aria-selected={selected}
      data-track={id}
      data-track-name={name}
      data-muted={track.muted || undefined}
      data-soloed-out={soloedOut || undefined}
      data-unheard={unheard !== null || undefined}
      title={soloedOut ? `${name}: silenced by the solo` : (unheard ?? undefined)}
      className={cn("flex shrink-0 flex-col items-center gap-1.5 border-r pb-1 transition-[opacity,filter] duration-150", dropTarget && "ring-2 ring-inset")}
      style={{
        width: STRIP_WIDTHS[view],
        ...stripLook(track.color, selected),
        // Muted (or silenced by another track's solo), the whole strip is faded and greyed: off at a glance.
        ...((track.muted || soloedOut) && { opacity: "var(--mixer-muted-opacity)", filter: "saturate(0.6)" }),
        // Making sound that's cut off further down (a muted bus): faded a little less, so the cause stands out.
        ...(unheard !== null && { opacity: "var(--mixer-unheard-opacity)" }),
        borderColor: "var(--mixer-line)",
        // A divider: a gap of the mixer's background down its left edge (its width stays the same, so the strips scroll as they did).
        ...(separator && { borderLeft: "5px solid var(--mixer-bg)" }),
        ...(dropTarget && { "--tw-ring-color": "var(--mixer-on)" }),
      }}
      onPointerDownCapture={(e) => {
        const target = e.target as HTMLElement;
        // A press in one of its menus (drawn elsewhere on the page, its events bubbling through here) isn't the strip's.
        if (!e.currentTarget.contains(target)) return;
        // The send switch acts for the selected tracks: pressing it doesn't select this one.
        if (target.closest("[data-send]")) return;
        // A right-click on a selected track keeps the selection: its menu acts on all of them.
        if (e.button === 2 && selected) return;
        const ui = useMusicUi.getState();
        // A control of one of several selected tracks acts on all of them: they stay selected. Pressed on
        // a track that isn't selected, it selects that one alone (whatever the keys held: they're the control's).
        if (target.closest("button, [role=slider]")) {
          if (!selected) ui.selectTrack(id);
          return;
        }
        if ((e.ctrlKey || e.metaKey) && e.shiftKey) ui.selectTrack(id, "add");
        // Cmd (or Ctrl) alone: it joins the selection (dragging on adds the tracks passed over).
        else if (e.ctrlKey || e.metaKey) ui.includeTracks([id]);
        // Shift: every track from the current one to this one.
        else if (e.shiftKey) selectTrackRange(id);
        else ui.selectTrack(id);
      }}
    >
      {banded && <GroupBand track={track} groupName={groupName} />}
      {/* FL's shading: from the top down to the knob, the strip is darker. */}
      <div className="flex min-h-0 w-full flex-1 flex-col items-center gap-1.5 pb-1.5" style={{ background: "var(--mixer-upper-shade)" }}>
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <div className="flex min-h-28 w-full flex-1 flex-col items-center" onDoubleClick={() => useMixerView.getState().rename(id)} onPointerDown={(e) => dragSelection(e)}>
            <div
              className="relative w-full py-0.5 text-center font-mono text-[11px] font-semibold tabular-nums"
              style={{
                // A track that records (it takes an input) is purple, as FL marks one: its own colour wins.
                background: track.color ?? (track.input ? "var(--mixer-input)" : "var(--mixer-header)"),
                color: track.color || track.input ? "#fff" : current ? "var(--mixer-on)" : "var(--mixer-header-text)",
                textShadow: "0 1px 1px rgb(0 0 0 / 0.4)",
              }}
              data-input={track.input ? "" : undefined}
            >
              {track.input && <PiMicrophoneFill className="absolute top-1/2 left-0.5 size-2.5 -translate-y-1/2" aria-label="Takes an input (records)" />}
              {isMaster ? "M" : number}
              <DelayMark track={track} />
            </div>
            {/* The meter and the fader share the strip's height: a taller mixer has longer ones. */}
            <div className="flex min-h-0 w-full flex-1 justify-center gap-1 px-1 pt-2">
              {renaming ? (
                <RenameField track={track} name={name} />
              ) : (
                <span
                  className="truncate text-[11px] leading-none [writing-mode:vertical-rl] rotate-180"
                  style={{ color: track.color ? `color-mix(in oklab, ${track.color} 45%, var(--mixer-name-tint))` : "var(--mixer-name)" }}
                  title={`${name} (double-click to rename)`}
                >
                  {name}
                </span>
              )}
              {/* The meter in its dark well; the selected track's outlined, as FL's. */}
              <canvas
                ref={meterRef}
                className="h-full w-[11px] rounded-[2px]"
                style={{ background: "var(--mixer-well)", boxShadow: selected ? "0 0 0 1px var(--mixer-on)" : "inset 0 1px 2px rgb(0 0 0 / 0.5)" }}
                role="img"
                aria-label={`${name} level`}
              />
            </div>
          </div>
        </ContextMenuTrigger>
        <TrackMenu id={id} isMaster={isMaster} color={track.color} separator={track.separator} grouped={track.group !== null} soloSafe={track.soloSafe} />
      </ContextMenu>

      <div className="flex shrink-0 items-center gap-1">
        <button
          type="button"
          aria-label={track.muted ? `Unmute ${name}` : `Mute ${name}`}
          aria-pressed={!track.muted}
          title={track.muted ? "Muted (right-click to solo it alone)" : "Mute (right-click to solo it alone)"}
          className="group grid size-5 shrink-0 place-items-center rounded-full"
          // Ctrl or Alt with the click solos it alone, and so does a right-click, as in FL Studio.
          onClick={(e) => (e.altKey || e.metaKey || e.ctrlKey ? soloAlone(id) : toggleTrackMute(id))}
          onContextMenu={(e) => {
            e.preventDefault();
            soloAlone(id);
          }}
        >
          <Led on={!track.muted} />
        </button>
        {!isMaster && <SoloButton id={id} name={name} solo={track.solo} implied={implied} safe={track.soloSafe} />}
      </div>
      <SongKnob
        size={36}
        label={`${name} pan`}
        value={track.pan}
        min={-1}
        max={1}
        defaultValue={0}
        bipolar
        format={panText}
        unit={PERCENT}
        target={{ kind: "mixer", track: id, control: "pan" }}
        edit={groupKnob(id, "pan")}
      />
      </div>
      <TrackFader track={track} name={name} selected={selected} />
      <div className="text-[9px] tabular-nums" style={{ color: "var(--mixer-name)" }} title="Level">
        {faderDb(track.volume).replace(" dB", "")}
      </div>
      {/* FL's arm switch, under the fader: the master never records. */}
      {isMaster ? <span className="size-[11px]" aria-hidden /> : <ArmButton trackId={id} name={name} />}
      <div className="flex gap-0.5">
        <StripToggle label={`Invert ${name}'s phase`} on={track.invert} onChange={(invert) => setTrackSwitch(id, { invert })}>
          <PiArrowsDownUp />
        </StripToggle>
        <StripToggle label={`Swap ${name}'s left and right`} on={track.swap} onChange={(swap) => setTrackSwitch(id, { swap })}>
          <PiArrowsLeftRight />
        </StripToggle>
      </div>
      <SongKnob
        size={32}
        label={`${name} stereo separation`}
        value={track.stereo}
        min={-1}
        max={1}
        defaultValue={0}
        bipolar
        format={stereoText}
        unit={PERCENT}
        target={{ kind: "mixer", track: id, control: "stereo" }}
        edit={groupKnob(id, "stereo")}
      />
      {view === "extra" && <StripEffects track={track} />}
      <SendSwitch to={id} name={name} state={sendKind === "sending" ? { kind: "sending", level: sendLevel, owner: sendOwner!, partial: sendPartial } : { kind: sendKind }} />
    </div>
  );
});

/** A strip's fader: one undo step a drag, moving every selected track's fader by as many dB when it's one of them. */
function TrackFader({ track, name, selected }: { track: MixerTrack; name: string; selected: boolean }) {
  const gesture = useRef(songGesture()).current;
  const armed = useRecording((s) => s.armed.includes(track.id));
  const start = useRef<Map<string, number>>(new Map());
  const id = track.id;
  const target = useMemo<AutomationTarget>(() => ({ kind: "mixer", track: id, control: "volume" }), [id]);
  const control = useAutomatedControl(target, track.volume);
  return (
    <Fader
      className="min-h-20 flex-1"
      label={`${name} volume`}
      value={control.value}
      own={track.volume}
      selected={selected}
      armed={armed}
      automated={control.automated}
      menu={<AutomationMenuItems target={target} />}
      onBegin={() => {
        control.hold();
        const song = useMusic.getState().history!.doc;
        const group = selected ? selectedTracks() : [id];
        start.current = new Map(song.mixer.tracks.filter((t) => group.includes(t.id) || t.id === id).map((t) => [t.id, t.volume]));
        gesture.begin();
      }}
      onDrag={(value) => gesture.apply((song) => setMixerVolumes(song, moveFadersTogether(start.current, start.current.get(id)!, value)))}
      onEnd={() => {
        gesture.end();
        control.release();
      }}
      onCancel={() => {
        gesture.cancel();
        control.release();
      }}
      onSet={(volume) => useMusic.getState().commit((song) => updateMixerTrack(song, id, { volume }))}
    />
  );
}

/**
 * The name, being typed: Enter gives it to the track (and to every selected track, if it's one of them);
 * clicking away does too if it was changed; Escape doesn't. An empty name goes back to the track's number.
 */
function RenameField({ track, name }: { track: MixerTrack; name: string }) {
  const initial = track.name ?? name;
  const finished = useRef(false);
  const done = (value: string | null) => {
    // Once: the field's blur as it goes away comes after Enter or Escape.
    if (finished.current) return;
    finished.current = true;
    if (value !== null) renameTrack(track.id, value);
    useMixerView.getState().rename(null);
  };
  return (
    <Input
      autoFocus
      aria-label="Track name"
      defaultValue={initial}
      className="absolute z-30 h-6 w-36 text-xs"
      onFocus={(e) => e.currentTarget.select()}
      onBlur={(e) => done(e.currentTarget.value !== initial ? e.currentTarget.value : null)}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Enter") done(e.currentTarget.value);
        if (e.key === "Escape") done(null);
      }}
    />
  );
}

/** A track's right-click menu (on its number and name), FL Studio's. */
function TrackMenu({ id, isMaster, color, separator, grouped, soloSafe }: { id: string; isMaster: boolean; color: string | null; separator: boolean; grouped: boolean; soloSafe: boolean }) {
  const channelsSelected = useMusicUi((s) => s.selectedChannelIds.length > 0);
  const others = useMusicUi((s) => s.selectedTrackIds.some((t) => t !== id));
  const canPaste = useMusicUi((s) => s.copiedTrack !== null);
  return (
    <ContextMenuContent>
      <ContextMenuItem onSelect={() => setTimeout(() => useMixerView.getState().rename(id), 0)}>
        Rename… <ContextMenuShortcut>F2</ContextMenuShortcut>
      </ContextMenuItem>
      <ContextMenuSub>
        <ContextMenuSubTrigger>Colour</ContextMenuSubTrigger>
        <ContextMenuSubContent className="w-40">
          <div className="grid grid-cols-6 gap-1 p-1">
            {TRACK_COLORS.map((swatch, i) => (
              <ContextMenuItem
                key={swatch}
                aria-label={COLOR_NAMES[i]}
                className={cn("size-5 rounded-sm p-0 focus-visible:ring-2 focus-visible:ring-ring", color === swatch && "ring-2 ring-foreground")}
                style={{ background: swatch }}
                onSelect={() => colourTrack(id, swatch)}
              />
            ))}
          </div>
          <ContextMenuItem disabled={!color} onSelect={() => colourTrack(id, null)}>
            No colour
          </ContextMenuItem>
        </ContextMenuSubContent>
      </ContextMenuSub>
      <ContextMenuSeparator />
      <ContextMenuSub>
        <ContextMenuSubTrigger>Channel routing</ContextMenuSubTrigger>
        <ContextMenuSubContent>
          <ContextMenuItem disabled={!channelsSelected} onSelect={() => routeSelectedChannels(id)}>
            Route selected channels to this track <ContextMenuShortcut>⌘L</ContextMenuShortcut>
          </ContextMenuItem>
          <ContextMenuItem disabled={!channelsSelected} onSelect={() => routeSelectedChannels(id, true)}>
            Route selected channels starting from this track <ContextMenuShortcut>⇧⌘L</ContextMenuShortcut>
          </ContextMenuItem>
        </ContextMenuSubContent>
      </ContextMenuSub>
      <ContextMenuSub>
        <ContextMenuSubTrigger>Track routing</ContextMenuSubTrigger>
        <ContextMenuSubContent>
          <ContextMenuItem disabled={!others} onSelect={() => routeSelectedTracksTo(id, "send")}>
            Route selected to this track
          </ContextMenuItem>
          <ContextMenuItem disabled={!others} onSelect={() => routeSelectedTracksTo(id, "only")}>
            Route selected to this track only
          </ContextMenuItem>
          <ContextMenuItem disabled={!others} onSelect={() => routeSelectedTracksTo(id, "sidechain")}>
            Sidechain selected to this track
          </ContextMenuItem>
        </ContextMenuSubContent>
      </ContextMenuSub>
      <ContextMenuItem onSelect={() => copyTrackState(id)} onPointerDown={(e) => carryTrackState(e, id)} title="Click to copy, or drag onto another track to copy it there">
        Copy track state
      </ContextMenuItem>
      <ContextMenuItem disabled={!canPaste} onSelect={() => void pasteTrackStateOnto(id)}>
        Paste track state
      </ContextMenuItem>
      <ContextMenuSeparator />
      <ContextMenuItem onSelect={() => selectChannelsOn(id)}>
        Select channels routed here <ContextMenuShortcut>⌥L</ContextMenuShortcut>
      </ContextMenuItem>
      {!isMaster && (
        <ContextMenuItem onSelect={() => assignAudioTracksTo(id)} title="A Playlist track for it (FL's audio track): its input and arm on the track's header, and its takes land there">
          Assign to new audio track
        </ContextMenuItem>
      )}
      <ContextMenuSeparator />
      {!isMaster && (
        <>
          <ContextMenuItem onSelect={() => toggleSolo(id)}>
            Solo <ContextMenuShortcut>S</ContextMenuShortcut>
          </ContextMenuItem>
          <ContextMenuItem onSelect={() => soloAlone(id)}>
            Solo alone <ContextMenuShortcut>⌥S</ContextMenuShortcut>
          </ContextMenuItem>
          <ContextMenuCheckboxItem checked={soloSafe} onSelect={() => toggleSoloSafe(id)}>
            Solo safe
          </ContextMenuCheckboxItem>
        </>
      )}
      <ContextMenuItem onSelect={clearSolo}>Clear all solos</ContextMenuItem>
      {!isMaster && (
        <>
          <ContextMenuSeparator />
          <ContextMenuItem onSelect={() => moveSelectedTracks(-1)}>
            Move left <ContextMenuShortcut>⌥←</ContextMenuShortcut>
          </ContextMenuItem>
          <ContextMenuItem onSelect={() => moveSelectedTracks(1)}>
            Move right <ContextMenuShortcut>⌥→</ContextMenuShortcut>
          </ContextMenuItem>
        </>
      )}
      {!isMaster && (
        <>
          <ContextMenuCheckboxItem checked={separator} onSelect={() => toggleSeparator(id)}>
            Separator before
          </ContextMenuCheckboxItem>
          <ContextMenuItem onSelect={() => setTimeout(() => groupTracks(id), 0)}>Create group…</ContextMenuItem>
          {grouped && <ContextMenuItem onSelect={() => ungroupTracks(id)}>Ungroup</ContextMenuItem>}
        </>
      )}
      {!isMaster && (
        <ContextMenuSub>
          <ContextMenuSubTrigger>Dock to</ContextMenuSubTrigger>
          <ContextMenuSubContent>
            {(["left", "middle", "right"] as const).map((dock) => (
              <ContextMenuItem key={dock} onSelect={() => dockTracks(id, dock)}>
                {dock === "left" ? "Left" : dock === "middle" ? "Middle" : "Right"}
              </ContextMenuItem>
            ))}
          </ContextMenuSubContent>
        </ContextMenuSub>
      )}
      <ContextMenuSeparator />
      <ContextMenuItem onSelect={addTrackAfterCurrent}>Insert a track after</ContextMenuItem>
      {!isMaster && (
        <ContextMenuItem variant="destructive" onSelect={() => deleteTracks(selectedTracks().includes(id) ? selectedTracks() : [id])}>
          Delete <ContextMenuShortcut>⌥⌫</ContextMenuShortcut>
        </ContextMenuItem>
      )}
    </ContextMenuContent>
  );
}

/**
 * The foot of a strip, FL Studio's send switch, for the selected tracks: a source's down-arrow; on a track
 * they send to, the send's level (and the switch above it, which removes the sends); on one they could send
 * to, an up-arrow to click; half lit where only some of them send; greyed where a send would make a loop.
 * Its knob moves every selected track's send here by as much.
 */
function SendSwitch({ to, name, state }: { to: string; name: string; state: SendState }) {
  if (state.kind === "source") {
    return (
      <div className="grid h-14 place-items-center pb-3" style={{ color: "var(--mixer-on)" }} title="A selected track: its sends are shown">
        <PiArrowFatDownFill className="size-4" data-send-point />
      </div>
    );
  }
  const sending = state.kind === "sending";
  const partial = sending && state.partial;
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild disabled={state.kind === "unavailable"}>
        <div className="flex h-14 flex-col items-center justify-end gap-0.5 pb-3" data-send>
          <button
            type="button"
            aria-label={sending && !partial ? `Stop sending to ${name}` : `Send to ${name}`}
            aria-pressed={partial ? "mixed" : sending}
            disabled={state.kind === "unavailable"}
            title={
              state.kind === "unavailable"
                ? "Its sound reaches the selected tracks already"
                : partial
                  ? "Some of the selected tracks send here: click to send all of them"
                  : sending
                    ? "Stop sending here"
                    : "Send the selected tracks here"
            }
            className={cn("grid h-4 w-6 place-items-center rounded-sm hover:brightness-150", state.kind === "unavailable" && "opacity-30")}
            style={{ color: sending ? "var(--mixer-on)" : "var(--mixer-name)", opacity: partial ? 0.55 : undefined }}
            data-partial={partial || undefined}
            onClick={() => toggleSend(to)}
          >
            <PiCaretUpBold className="size-3" />
          </button>
          {sending ? (
            <div data-send-point>
              <SongKnob
                size={28}
                label={`Send to ${name}`}
                value={state.level}
                min={0}
                max={1}
                defaultValue={1}
                format={percent}
                unit={PERCENT}
                target={{ kind: "send", track: state.owner, to }}
                edit={groupSend(to, state.owner)}
              />
            </div>
          ) : (
            <div className="size-5" />
          )}
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem onSelect={() => toggleSend(to)}>{sending && !partial ? "Remove the sends" : "Route to this track"}</ContextMenuItem>
        <ContextMenuItem onSelect={() => sendOnlyTo(to)}>Route to this track only</ContextMenuItem>
        <ContextMenuItem onSelect={() => sidechainTo(to)}>Sidechain to this track</ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}

/** Why a track that makes sound isn't heard, for its strip's hint. */
function unheardReason(mixer: Mixer, track: MixerTrack, heard: ReadonlyMap<string, Hearing>): string {
  const index = new Map(mixer.tracks.map((t, i) => [t.id, i]));
  const nameOf = (id: string) => {
    const i = index.get(id)!;
    return mixer.tracks[i].name ?? (i === 0 ? "Master" : `Insert ${i}`);
  };
  const by = cutOffBy(mixer, track.id, heard);
  if (!by.length) return `${nameOf(track.id)} isn't heard: it sends nowhere`;
  const muted = by.filter((id) => mixer.tracks[index.get(id)!].muted);
  const soloed = by.filter((id) => !muted.includes(id));
  const list = (ids: string[]) => ids.map(nameOf).join(", ");
  return `${nameOf(track.id)} isn't heard: ${[muted.length ? `${list(muted)} ${muted.length === 1 ? "is" : "are"} muted` : "", soloed.length ? `the solo silences ${list(soloed)}` : ""].filter(Boolean).join("; ")}`;
}

/**
 * A track's solo switch (Pro Tools', Logic's): a click adds it to the solo or takes it out, Alt or ⌘ solos it
 * alone, Shift makes it solo safe (a lock: no other track's solo silences it). Lit while it's soloed.
 */
function SoloButton({ id, name, solo, implied, safe }: { id: string; name: string; solo: boolean; implied: boolean; safe: boolean }) {
  return (
    <button
      type="button"
      aria-label={solo ? `Unsolo ${name}` : `Solo ${name}`}
      aria-pressed={solo}
      data-solo={solo || undefined}
      data-solo-safe={safe || undefined}
      data-solo-implied={implied || undefined}
      title={`${solo ? "Soloed" : implied ? "Heard for a soloed track (it's on its path)" : "Solo"}${safe ? " (solo safe)" : ""}: click to solo, ⌥-click to solo it alone, ⇧-click for solo safe`}
      className="relative grid h-3.5 w-4 shrink-0 place-items-center rounded-[3px] font-mono text-[9px] leading-none font-bold hover:brightness-125"
      style={
        solo
          ? { background: "var(--mixer-solo)", color: "var(--mixer-solo-text)", boxShadow: "0 0 4px var(--mixer-solo)" }
          : implied
            ? // On only for a soloed track: outlined in the solo's colour.
              { background: "var(--mixer-well)", color: "var(--mixer-solo)", boxShadow: "inset 0 0 0 1px var(--mixer-solo)" }
            : { background: "var(--mixer-well)", color: "var(--mixer-name)", boxShadow: "inset 0 1px 1px rgb(0 0 0 / 0.4)" }
      }
      onClick={(e) => (e.shiftKey ? toggleSoloSafe(id) : e.altKey || e.metaKey || e.ctrlKey ? soloAlone(id) : toggleSolo(id))}
    >
      S
      {safe && <PiLockSimpleFill className="absolute -top-1 -right-1 size-2" style={{ color: "var(--mixer-solo)" }} aria-label="Solo safe" />}
    </button>
  );
}

/** A clock on a strip whose sound is delayed (its plugins', or a manual offset), as FL's track delay icon; the delay on hover. */
function DelayMark({ track }: { track: MixerTrack }) {
  const delay = useTransport((s) => pluginDelay(track, s.effects.loaded));
  const sampleRate = useTransport((s) => s.sampleRate);
  if (delay === 0 && track.latencyOffset === 0) return null;
  const parts = [delay > 0 ? `its plugins delay it ${delayText(delay, sampleRate)}` : "", track.latencyOffset !== 0 ? `offset ${offsetText(track.latencyOffset)}` : ""].filter(Boolean);
  return (
    <span className="absolute top-1/2 right-0.5 -translate-y-1/2" style={{ color: track.color ? "#fff" : "var(--mixer-delay)" }} title={`Delay compensated: ${parts.join("; ")}`} data-testid="delay-mark">
      <PiClock className="size-2.5" />
    </span>
  );
}

/** What the stereo separation knob says: FL's, narrower to the right, wider to the left. */
const stereoText = (v: number) => (Math.abs(v) < 0.005 ? "As it is" : v > 0 ? `${Math.round(v * 100)}% narrower` : `${Math.round(-v * 100)}% wider`);

/** A strip's small switch (invert phase, swap sides): lit with the accent while it's on. */
function StripToggle({ label, on, onChange, children }: { label: string; on: boolean; onChange: (on: boolean) => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={on}
      title={label}
      className="grid size-4.5 place-items-center rounded-sm text-[11px] hover:brightness-150"
      style={{ color: on ? "var(--mixer-delay)" : "var(--mixer-name)" }}
      onClick={() => onChange(!on)}
    >
      {children}
    </button>
  );
}

/** The track colours' names, in `TRACK_COLORS`'s order (for the menu's swatches). */
const COLOR_NAMES = ["Red", "Orange", "Yellow", "Lime", "Green", "Teal", "Blue", "Indigo", "Purple", "Pink", "Brown", "Grey"];

/**
 * A drag across the strips' names and meters, FL Studio's: the selection follows the pointer, one track
 * at a time; with Cmd (or Ctrl), every track passed over joins it.
 */
function dragSelection(e: React.PointerEvent<HTMLElement>) {
  if ((e.target as HTMLElement).closest("input")) return;
  const adding = e.metaKey || e.ctrlKey;
  startPointerDrag(e, {
    threshold: 4,
    onMove(ev) {
      const strip = document.elementFromPoint(ev.clientX, ev.clientY)?.closest<HTMLElement>("[data-track]");
      const id = strip?.dataset.track;
      if (!id || !strip.closest('[data-testid="mixer"]')) return;
      const ui = useMusicUi.getState();
      if (adding) ui.includeTracks([id]);
      else if (ui.selectedTrackIds.length !== 1 || ui.selectedTrackIds[0] !== id) ui.setTrackSelection([id]);
    },
  });
}

/** FL Studio's selected meter, at the mixer's left: the selected tracks' sound added up (or the one shown in the inspector). */
function SelectionMeter({ meterRef }: { meterRef: (canvas: HTMLCanvasElement | null) => void }) {
  const count = useMusicUi((s) => s.selectedTrackIds.length);
  const scale = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState(0);
  useLayoutEffect(() => {
    const element = scale.current;
    if (!element) return;
    const resize = new ResizeObserver(() => setHeight(element.clientHeight));
    resize.observe(element);
    return () => resize.disconnect();
  }, []);
  const marks = useMemo(() => meterScale(height), [height]);
  return (
    <div className="flex w-12 shrink-0 flex-col items-center gap-[9px] border-r py-1.5" style={{ ...stripLook(null, false), borderColor: "var(--mixer-line)" }} title={count > 1 ? `The ${count} selected tracks' output, together` : "The selected track's output"}>
      <span className="font-mono text-[9px]" style={{ color: "var(--mixer-name)" }}>SEL</span>
      <div className="flex min-h-0 w-full flex-1 gap-0.5 pl-1.5">
        <canvas ref={meterRef} className="h-full w-[15px] shrink-0 rounded-[2px]" style={{ background: "var(--mixer-well)", boxShadow: "inset 0 1px 2px rgb(0 0 0 / 0.5)" }} role="img" aria-label="Selected tracks' level" data-testid="selection-meter" />
        {/* Its scale in dB, FL's: 3, 0, 3, 6... (below 0 dB without the minus). */}
        <div ref={scale} className="relative min-w-0 flex-1" aria-hidden>
          {marks.map(({ db, at }) => (
            <span key={db} className="absolute left-0 flex -translate-y-1/2 items-center gap-px font-mono text-[8px] leading-none tabular-nums" style={{ top: `${(1 - at) * 100}%`, color: db === 0 ? "var(--mixer-header-text)" : "var(--mixer-name)" }}>
              <span className="h-px w-1 bg-current opacity-60" />
              {Math.abs(db)}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

/** The track under a point of the page, if it's one of the mixer's strips. */

/**
 * FL Studio's drag of a track's state: pressed on its menu's Copy track state and dragged, the menu
 * goes, the state follows the pointer, and let go on another track it's copied there (effects, their
 * settings, the controls). A press that isn't dragged is the item's click: it copies.
 */
function carryTrackState(e: React.PointerEvent, from: string) {
  if (e.button !== 0) return;
  const origin = { x: e.clientX, y: e.clientY };
  let carrying = false;
  const view = useMixerView.getState();
  const stop = () => {
    window.removeEventListener("pointermove", move, true);
    window.removeEventListener("pointerup", up, true);
    window.removeEventListener("keydown", key, true);
    view.carry(null);
  };
  const move = (ev: PointerEvent) => {
    if (!carrying && Math.hypot(ev.clientX - origin.x, ev.clientY - origin.y) < 6) return;
    if (!carrying) {
      // The menu goes, as FL's does once the item is dragged (before the drag's own Escape listens).
      document.activeElement?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
      carrying = true;
    }
    view.carry({ from, x: ev.clientX, y: ev.clientY, over: trackAt(ev.clientX, ev.clientY) });
  };
  const up = (ev: PointerEvent) => {
    if (carrying) {
      ev.preventDefault();
      ev.stopPropagation();
      const to = trackAt(ev.clientX, ev.clientY);
      if (to && to !== from) {
        copyTrackState(from);
        void pasteTrackStateOnto(to);
      }
    }
    stop();
  };
  const key = (ev: KeyboardEvent) => ev.key === "Escape" && carrying && stop();
  window.addEventListener("pointermove", move, true);
  window.addEventListener("pointerup", up, true);
  window.addEventListener("keydown", key, true);
}

/** A track's state being dragged: a label under the pointer. */
function CarriedState() {
  const carrying = useMixerView((s) => s.carrying);
  const name = useSong((song) => (carrying ? trackName(song, carrying.from) : ""));
  if (!carrying) return null;
  return (
    <div className="floating pointer-events-none fixed z-[10000] rounded-sm px-2 py-1 text-[11px]" style={{ left: carrying.x + 12, top: carrying.y + 8 }} data-testid="carried-state">
      {carrying.effect
        ? `${carrying.effect.name}${carrying.over && (carrying.over !== carrying.from || carrying.effect.copy) ? (carrying.effect.copy ? " → drop to copy" : " → drop to move (⌘: copy)") : ""}`
        : `${name}'s state${carrying.over && carrying.over !== carrying.from ? " → drop to copy" : ""}`}
    </div>
  );
}

/** The Extra large view's list of a strip's effects, FL Studio's: a click opens one's window. */
function StripEffects({ track }: { track: MixerTrack }) {
  const effects = track.effects.flatMap((effect, slot) => (effect ? [{ effect, slot }] : []));
  return (
    // The same height on every strip (scrolling past five), so the faders above them line up.
    <ol className="flex h-[5.5rem] w-full shrink-0 flex-col gap-px overflow-y-auto px-1" aria-label={`${track.name ?? "Track"}'s effects`} data-testid="strip-effects">
      {effects.map(({ effect, slot }) => (
        <li key={effect.id}>
          <button
            type="button"
            className={cn("w-full truncate rounded-[2px] px-1 text-left text-[10px] leading-4 hover:brightness-150", !effect.enabled && "line-through opacity-60")}
            style={{ background: "var(--mixer-well)", color: "var(--mixer-name)" }}
            title={`Slot ${slot + 1}: ${effect.plugin.name} (click for its window)`}
            onClick={() => useTransport.getState().showEffect(effect.id, true)}
          >
            {effect.plugin.name}
          </button>
        </li>
      ))}
    </ol>
  );
}

/**
 * A strip's colours: the theme's strip, or for a coloured track, a rich tint of its colour (FL Studio's
 * colourful mixer), stronger when it's selected.
 */
function stripLook(color: string | null, selected: boolean): React.CSSProperties {
  if (!color) return { background: selected ? "var(--mixer-strip-selected)" : "var(--mixer-strip)" };
  return { background: `color-mix(in oklab, ${color} ${selected ? 46 : 34}%, var(--mixer-tint-base))` };
}

/**
 * A group's band, FL Studio's, above the strips' numbers: shaded over its tracks, its name on the first
 * (running on over the others); a double-click names it. Strips in no group keep the room, so all line up.
 */
function GroupBand({ track, groupName }: { track: MixerTrack; groupName: string | null }) {
  const renaming = useMixerView((s) => track.group !== null && s.renamingGroup === track.group && groupName !== null);
  return (
    <div
      className="relative h-4 w-full shrink-0"
      style={{ background: track.group ? "var(--mixer-header)" : "transparent", borderBottom: track.group ? "1px solid var(--mixer-line)" : undefined }}
      onClick={(e) => track.group && selectGroup(track.group, e.metaKey || e.ctrlKey)}
      onDoubleClick={() => track.group && useMixerView.getState().renameGroup(track.group)}
      title={track.group ? "Click to select the group's tracks, double-click to rename it" : undefined}
      data-group={track.group ?? undefined}
    >
      {renaming ? (
        <GroupNameField groupId={track.group!} name={groupName!} />
      ) : (
        groupName && (
          <span className="pointer-events-none absolute top-0 left-1 z-10 text-[10px] leading-4 font-semibold whitespace-nowrap" style={{ color: "var(--mixer-header-text)" }} title={`${groupName} (double-click to rename)`}>
            {groupName}
          </span>
        )
      )}
    </div>
  );
}

/** A group's name, being typed: Enter keeps it, Escape doesn't. */
function GroupNameField({ groupId, name }: { groupId: string; name: string }) {
  const finished = useRef(false);
  const done = (value: string | null) => {
    if (finished.current) return;
    finished.current = true;
    if (value !== null) renameMixerGroup(groupId, value);
    useMixerView.getState().renameGroup(null);
  };
  return (
    <Input
      autoFocus
      aria-label="Group name"
      defaultValue={name}
      className="absolute top-0 left-0 z-30 h-5 w-36 text-xs"
      onFocus={(e) => e.currentTarget.select()}
      onBlur={(e) => done(e.currentTarget.value)}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Enter") done(e.currentTarget.value);
        if (e.key === "Escape") done(null);
      }}
    />
  );
}
