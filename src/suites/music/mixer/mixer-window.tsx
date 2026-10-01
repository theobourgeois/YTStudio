import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { PiArrowFatDownFill, PiArrowsDownUp, PiArrowsLeftRight, PiCaretRightFill, PiCaretUpBold, PiClock, PiPlus } from "react-icons/pi";
import { cn } from "cn";
import { startPointerDrag } from "@/lib/pointer-drag";
import { type MixerTrackPatch, setMixerVolumes, setSend, updateMixerTrack } from "@shared/music/mixer";
import { SELECTION_METER } from "@shared/music/engine";
import { MASTER_TRACK_ID, TRACK_COLORS } from "@shared/music/project";
import type { Mixer, MixerTrack, MusicProject } from "@shared/music/types";
import { Button } from "@/components/ui/button";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuShortcut, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { PERCENT, SongKnob, panText, percent } from "../knob";
import { songGesture, useMusic, useSong } from "../store";
import { useTransport } from "../transport";
import { currentTrackId, useMusicUi } from "../ui";
import { MusicWindow } from "../window";
import {
  addTrackAfterCurrent,
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
  soloTrack,
  toggleSend,
  toggleTrackMute,
} from "./actions";
import { Cables } from "./cables";
import { Fader } from "./fader";
import { faderDb } from "./meter";
import { useMeters } from "./meters";
import { Inspector } from "./inspector";
import { delayText, offsetText, pluginDelay } from "./latency";
import { useMixerView } from "./view";

/** A strip's width (px). */
const STRIP_W = 46;

/** What a track's send switch shows, for the current track (the one sends are made from). */
type SendState =
  /** It's the current track: the source. */
  | { kind: "source" }
  /** The current track sends to it, at this level. */
  | { kind: "sending"; level: number }
  /** A click makes the current track send to it. */
  | { kind: "available" }
  /** Its sound reaches the current track already (a send would make a loop), or the current track is the master. */
  | { kind: "unavailable" };

/** Strips drawn past each edge of the view, so a scroll doesn't show an empty one before they're drawn. */
const OVERSCAN = 4;

/** The inserts in view in the scrolling strip area, as `[first, last)` indexes into them. */
function useVisibleStrips(scroller: React.RefObject<HTMLDivElement | null>, count: number): [number, number] {
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
  const first = Math.max(0, Math.floor(view.left / STRIP_W) - OVERSCAN);
  const last = Math.min(count, Math.ceil((view.left + view.width) / STRIP_W) + OVERSCAN);
  return [first, Math.max(first, last)];
}

/** The tracks whose sound reaches `id` (through sends), `id` included. */
function feeding(mixer: Mixer, id: string): Set<string> {
  const into = new Map<string, string[]>();
  for (const track of mixer.tracks) for (const send of track.sends) into.set(send.to, [...(into.get(send.to) ?? []), track.id]);
  const found = new Set<string>([id]);
  const stack = [id];
  while (stack.length) for (const from of into.get(stack.pop()!) ?? []) if (!found.has(from)) found.add(from), stack.push(from);
  return found;
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

  const sendStates = useMemo(() => {
    const from = mixer.tracks.find((t) => t.id === current)!;
    const feeds = feeding(mixer, current);
    return new Map(
      mixer.tracks.map((t): [string, SendState] => {
        if (t.id === current) return [t.id, { kind: "source" }];
        const send = from.sends.find((s) => s.to === t.id);
        if (send) return [t.id, { kind: "sending", level: send.level }];
        return [t.id, current === MASTER_TRACK_ID || feeds.has(t.id) ? { kind: "unavailable" } : { kind: "available" }];
      }),
    );
  }, [mixer, current]);

  // A track just added, or selected by a key, scrolls into view.
  useEffect(() => {
    if (!revealing) return;
    useMixerView.getState().reveal(null);
    const element = scroller.current;
    const index = mixer.tracks.findIndex((t) => t.id === revealing) - 1;
    if (!element || index < 0) return;
    // By its place (it may not be drawn yet): just into view, at whichever edge it's past.
    const left = index * STRIP_W;
    if (left < element.scrollLeft) element.scrollLeft = left;
    else if (left + STRIP_W > element.scrollLeft + element.clientWidth) element.scrollLeft = left + STRIP_W - element.clientWidth;
  }, [revealing, mixer.tracks]);
  const [first, last] = useVisibleStrips(scroller, mixer.tracks.length - 1);

  const [master, ...inserts] = mixer.tracks;
  const strip = (track: MixerTrack, number: number) => (
    <Strip
      key={track.id}
      track={track}
      number={number}
      selected={selectedIds.includes(track.id)}
      current={track.id === current}
      sendKind={sendStates.get(track.id)!.kind}
      sendLevel={(sendStates.get(track.id) as { level?: number }).level ?? 0}
      meterRef={meterRef(track.id)}
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
        <Button variant="ghost" size="icon-xs" aria-label="Add a mixer track" title="Add a mixer track after the selected one" className="text-muted-foreground hover:text-foreground" onClick={addTrackAfterCurrent}>
          <PiPlus />
        </Button>
      }
    >
      <div className="flex min-h-0 flex-1" data-testid="mixer">
        <div ref={area} className="relative flex min-w-0 flex-1 overflow-hidden bg-surface-0" role="list" aria-label="Mixer tracks">
          <SelectionMeter meterRef={meterRef(SELECTION_METER)} />
          <div className="flex shrink-0 border-r-2 border-line">{strip(master, 0)}</div>
          <div ref={scroller} className="flex min-w-0 flex-1 overflow-x-auto overflow-y-hidden">
            {/* Only the strips in view (and a few either side) are drawn: a mixer can have hundreds. */}
            <div className="flex shrink-0" style={{ paddingLeft: first * STRIP_W, paddingRight: Math.max(0, inserts.length - last) * STRIP_W }}>
              {inserts.slice(first, last).map((track, i) => strip(track, first + i + 1))}
            </div>
          </div>
          <Cables area={area} mixer={mixer} current={current} />
        </div>
        <Inspector trackId={current} />
      </div>
    </MusicWindow>
  );
}

/** The window's menu (its arrow). */
function MixerMenu() {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-xs" aria-label="Mixer menu" className="text-muted-foreground hover:text-foreground">
          <PiCaretRightFill />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        <DropdownMenuItem onSelect={addTrackAfterCurrent}>Add a track</DropdownMenuItem>
        <DropdownMenuItem onSelect={() => deleteTracks(selectedTracks())}>Delete selected tracks</DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => routeSelectedChannels()}>
          Route selected channels to this track <DropdownMenuShortcut>⌘L</DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => routeSelectedChannels(undefined, true)}>
          Route selected channels starting from this track <DropdownMenuShortcut>⇧⌘L</DropdownMenuShortcut>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
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
  meterRef: (canvas: HTMLCanvasElement | null) => void;
}

/** A track's strip, top to bottom: its number, its name beside its meter, mute, pan, fader, send switch. */
const Strip = memo(function Strip({ track, number, selected, current, sendKind, sendLevel, meterRef }: StripProps) {
  const isMaster = track.id === MASTER_TRACK_ID;
  const name = track.name ?? (isMaster ? "Master" : `Insert ${number}`);
  const renaming = useMixerView((s) => s.renaming === track.id);
  const id = track.id;

  return (
    <div
      role="listitem"
      aria-label={name}
      aria-selected={selected}
      data-track={id}
      data-track-name={name}
      className={cn("flex shrink-0 flex-col items-center gap-1.5 border-r border-line pb-1", selected ? "bg-surface-2" : "bg-surface-1", current && "shadow-[inset_0_2px_0] shadow-brand")}
      style={{ width: STRIP_W }}
      onPointerDownCapture={(e) => {
        // The send switch acts for the selected track: pressing it doesn't select this one.
        if ((e.target as HTMLElement).closest("[data-send]")) return;
        // A right-click on a selected track keeps the selection: its menu acts on all of them.
        if (e.button === 2 && selected) return;
        const ui = useMusicUi.getState();
        if ((e.ctrlKey || e.metaKey) && e.shiftKey) ui.selectTrack(id, "add");
        // Cmd (or Ctrl) alone: it joins the selection (dragging on adds the tracks passed over).
        else if (e.ctrlKey || e.metaKey) ui.includeTracks([id]);
        // Dragging one of several selected faders moves them all: they stay selected.
        else if (!selected || !(e.target as HTMLElement).closest("[aria-orientation=vertical]")) ui.selectTrack(id);
      }}
    >
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <div className="flex min-h-28 w-full flex-1 flex-col items-center" onDoubleClick={() => useMixerView.getState().rename(id)} onPointerDown={(e) => dragSelection(e)}>
            <div
              className={cn("relative w-full py-0.5 text-center font-mono text-[11px] tabular-nums", track.color ? "font-semibold text-white" : current ? "text-brand" : "text-muted-foreground")}
              style={track.color ? { background: track.color, textShadow: "0 1px 1px rgb(0 0 0 / 0.35)" } : undefined}
            >
              {isMaster ? "M" : number}
              <DelayMark track={track} />
            </div>
            {/* The meter and the fader share the strip's height: a taller mixer has longer ones. */}
            <div className="flex min-h-0 w-full flex-1 justify-center gap-1 px-1">
              {renaming ? (
                <RenameField track={track} name={name} />
              ) : (
                <span className="truncate text-[11px] leading-none [writing-mode:vertical-rl] rotate-180" title={`${name} (double-click to rename)`}>
                  {name}
                </span>
              )}
              <canvas ref={meterRef} className="sunken h-full w-[11px] rounded-[2px]" role="img" aria-label={`${name} level`} />
            </div>
          </div>
        </ContextMenuTrigger>
        <TrackMenu id={id} isMaster={isMaster} color={track.color} />
      </ContextMenu>

      <button
        type="button"
        aria-label={track.muted ? `Unmute ${name}` : `Mute ${name}`}
        aria-pressed={!track.muted}
        title={track.muted ? "Muted (right-click to solo)" : "Mute (right-click to solo)"}
        className="group grid size-5 shrink-0 place-items-center rounded-full"
        // Ctrl or Alt with the click solos, and so does a right-click, as in FL Studio.
        onClick={(e) => (e.altKey || e.metaKey || e.ctrlKey ? soloTrack(id) : toggleTrackMute(id))}
        onContextMenu={(e) => {
          e.preventDefault();
          soloTrack(id);
        }}
      >
        <span
          className={cn(
            "size-2.5 rounded-full transition-[colors,filter] group-hover:brightness-125",
            track.muted ? "sunken" : "border border-brand-edge bg-brand shadow-[0_0_5px] shadow-brand/70 inset-shadow-[0_1px_0_rgb(255_255_255/0.45)]",
          )}
        />
      </button>
      <SongKnob size={24} label={`${name} pan`} value={track.pan} min={-1} max={1} defaultValue={0} bipolar format={panText} unit={PERCENT} edit={(song, pan) => updateMixerTrack(song, id, { pan })} />
      <TrackFader track={track} name={name} selected={selected} />
      <div className="text-[9px] tabular-nums text-muted-foreground" title="Level">
        {faderDb(track.volume).replace(" dB", "")}
      </div>
      <div className="flex gap-0.5">
        <StripToggle label={`Invert ${name}'s phase`} on={track.invert} onChange={(invert) => commitTrack(id, { invert })}>
          <PiArrowsDownUp />
        </StripToggle>
        <StripToggle label={`Swap ${name}'s left and right`} on={track.swap} onChange={(swap) => commitTrack(id, { swap })}>
          <PiArrowsLeftRight />
        </StripToggle>
      </div>
      <SongKnob size={20} label={`${name} stereo separation`} value={track.stereo} min={-1} max={1} defaultValue={0} bipolar format={stereoText} unit={PERCENT} edit={(song, stereo) => updateMixerTrack(song, id, { stereo })} />
      <SendSwitch to={id} name={name} state={sendKind === "sending" ? { kind: "sending", level: sendLevel } : { kind: sendKind }} />
    </div>
  );
});

/** A strip's fader: one undo step a drag, moving every selected track's fader by as much when it's one of them. */
function TrackFader({ track, name, selected }: { track: MixerTrack; name: string; selected: boolean }) {
  const gesture = useRef(songGesture()).current;
  const start = useRef<Map<string, number>>(new Map());
  const id = track.id;
  return (
    <Fader
      className="min-h-20 flex-1"
      label={`${name} volume`}
      value={track.volume}
      selected={selected}
      onBegin={() => {
        const song = useMusic.getState().history!.doc;
        const group = selected ? selectedTracks() : [id];
        start.current = new Map(song.mixer.tracks.filter((t) => group.includes(t.id) || t.id === id).map((t) => [t.id, t.volume]));
        gesture.begin();
      }}
      onDrag={(value) => {
        const delta = value - start.current.get(id)!;
        gesture.apply((song) => setMixerVolumes(song, new Map([...start.current].map(([t, v]) => [t, v + delta]))));
      }}
      onEnd={() => gesture.end()}
      onCancel={() => gesture.cancel()}
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
function TrackMenu({ id, isMaster, color }: { id: string; isMaster: boolean; color: string | null }) {
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
                className={cn("size-5 rounded-sm p-0 focus:ring-2 focus:ring-ring", color === swatch && "ring-2 ring-foreground")}
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
      <ContextMenuItem onSelect={() => copyTrackState(id)}>Copy track state</ContextMenuItem>
      <ContextMenuItem disabled={!canPaste} onSelect={() => void pasteTrackStateOnto(id)}>
        Paste track state
      </ContextMenuItem>
      <ContextMenuSeparator />
      <ContextMenuItem onSelect={() => selectChannelsOn(id)}>
        Select channels routed here <ContextMenuShortcut>⌥L</ContextMenuShortcut>
      </ContextMenuItem>
      <ContextMenuSeparator />
      <ContextMenuItem onSelect={() => soloTrack(id)}>
        Solo <ContextMenuShortcut>S</ContextMenuShortcut>
      </ContextMenuItem>
      <ContextMenuItem onSelect={() => soloTrack(id, true)}>
        Alt solo <ContextMenuShortcut>⌥S</ContextMenuShortcut>
      </ContextMenuItem>
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
      <ContextMenuSeparator />
      <ContextMenuItem onSelect={addTrackAfterCurrent}>Insert a track after</ContextMenuItem>
      {!isMaster && (
        <ContextMenuItem variant="destructive" onSelect={() => deleteTracks(selectedTracks().includes(id) ? selectedTracks() : [id])}>
          Delete
        </ContextMenuItem>
      )}
    </ContextMenuContent>
  );
}

/**
 * The foot of a strip, FL Studio's send switch, for the selected track: the source's down-arrow; on a
 * track it sends to, the send's level (and the switch above it, which removes the send); on one it
 * could send to, an up-arrow to click; greyed where a send would make a loop.
 */
function SendSwitch({ to, name, state }: { to: string; name: string; state: SendState }) {
  if (state.kind === "source") {
    return (
      <div className="grid h-14 place-items-center pb-3 text-brand" title="The selected track: its sends are shown">
        <PiArrowFatDownFill className="size-4" data-send-point />
      </div>
    );
  }
  const arrow = (on: boolean) => (
    <button
      type="button"
      aria-label={on ? `Stop sending to ${name}` : `Send to ${name}`}
      aria-pressed={on}
      disabled={state.kind === "unavailable"}
      title={state.kind === "unavailable" ? "Its sound reaches the selected track already" : on ? "Stop sending here" : "Send the selected track here"}
      className={cn("grid h-4 w-6 place-items-center rounded-sm", on ? "text-brand" : "text-muted-foreground hover:text-foreground", state.kind === "unavailable" && "opacity-30")}
      onClick={() => toggleSend(to)}
    >
      <PiCaretUpBold className="size-3" />
    </button>
  );
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild disabled={state.kind === "unavailable"}>
        <div className="flex h-14 flex-col items-center justify-end gap-0.5 pb-3" data-send>
          {arrow(state.kind === "sending")}
          {state.kind === "sending" ? (
            <div data-send-point>
              <SongKnob size={20} label={`Send to ${name}`} value={state.level} min={0} max={1} defaultValue={1} format={percent} unit={PERCENT} edit={(song, level) => setSend(song, currentTrackId(song, useMusicUi.getState().selectedTrackIds), to, level)} />
            </div>
          ) : (
            <div className="size-5" />
          )}
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem onSelect={() => toggleSend(to)}>{state.kind === "sending" ? "Remove this send" : "Route to this track"}</ContextMenuItem>
        <ContextMenuItem onSelect={() => sendOnlyTo(to)}>Route to this track only</ContextMenuItem>
        <ContextMenuItem onSelect={() => sidechainTo(to)}>Sidechain to this track</ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}

/** A clock on a strip whose sound is delayed (its plugins', or a manual offset), as FL's track delay icon; the delay on hover. */
function DelayMark({ track }: { track: MixerTrack }) {
  const delay = useTransport((s) => pluginDelay(track, s.effects.loaded));
  const sampleRate = useTransport((s) => s.sampleRate);
  if (delay === 0 && track.latencyOffset === 0) return null;
  const parts = [delay > 0 ? `its plugins delay it ${delayText(delay, sampleRate)}` : "", track.latencyOffset !== 0 ? `offset ${offsetText(track.latencyOffset)}` : ""].filter(Boolean);
  return (
    <span className={cn("absolute top-1/2 right-0.5 -translate-y-1/2", track.color ? "text-white" : "text-brand")} title={`Delay compensated: ${parts.join("; ")}`} data-testid="delay-mark">
      <PiClock className="size-2.5" />
    </span>
  );
}

const commitTrack = (id: string, patch: MixerTrackPatch) => useMusic.getState().commit((song) => updateMixerTrack(song, id, patch));

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
      className={cn("grid size-4.5 place-items-center rounded-sm text-[11px]", on ? "text-brand" : "text-muted-foreground hover:text-foreground")}
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
  return (
    <div className="flex w-6 shrink-0 flex-col items-center gap-1 border-r border-line bg-surface-1 py-1.5" title={count > 1 ? `The ${count} selected tracks' output, together` : "The selected track's output"}>
      <span className="font-mono text-[9px] text-muted-foreground">SEL</span>
      <canvas ref={meterRef} className="sunken min-h-0 w-[13px] flex-1 rounded-[2px]" role="img" aria-label="Selected tracks' level" data-testid="selection-meter" />
    </div>
  );
}
