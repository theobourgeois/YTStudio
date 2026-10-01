import { memo, useEffect, useMemo, useRef } from "react";
import { PiArrowFatDownFill, PiCaretRightFill, PiCaretUpBold, PiClock, PiPlus } from "react-icons/pi";
import { cn } from "cn";
import { setMixerVolumes, setSend, updateMixerTrack } from "@shared/music/mixer";
import { MASTER_TRACK_ID } from "@shared/music/project";
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
  deleteTracks,
  moveSelectedTracks,
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
    scroller.current?.querySelector(`[data-track="${CSS.escape(revealing)}"]`)?.scrollIntoView({ block: "nearest", inline: "nearest" });
    useMixerView.getState().reveal(null);
  }, [revealing]);

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
      initial={{ x: 40, y: 230, width: 980, height: 430 }}
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
        <div className="flex min-w-0 flex-1 bg-surface-0" role="list" aria-label="Mixer tracks">
          <div className="flex shrink-0 border-r-2 border-line">{strip(master, 0)}</div>
          <div ref={scroller} className="flex min-w-0 flex-1 overflow-x-auto overflow-y-hidden">
            {inserts.map((track, i) => strip(track, i + 1))}
          </div>
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
        const ui = useMusicUi.getState();
        if ((e.ctrlKey || e.metaKey) && e.shiftKey) ui.selectTrack(id, "add");
        // Dragging one of several selected faders moves them all: they stay selected.
        else if (!selected || !(e.target as HTMLElement).closest("[aria-orientation=vertical]")) ui.selectTrack(id);
      }}
    >
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <div className="flex w-full flex-col items-center" onDoubleClick={() => useMixerView.getState().rename(id)}>
            <div className={cn("relative w-full py-0.5 text-center font-mono text-[11px] tabular-nums", current ? "text-brand" : "text-muted-foreground")}>
              {isMaster ? "M" : number}
              <DelayMark track={track} />
            </div>
            <div className="flex h-24 w-full justify-center gap-1 px-1">
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
        <TrackMenu id={id} isMaster={isMaster} />
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
      className="min-h-16 flex-1"
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

/** The name, being typed: Enter keeps it, Escape doesn't, an empty one goes back to the track's number. */
function RenameField({ track, name }: { track: MixerTrack; name: string }) {
  const done = (value: string | null) => {
    if (value !== null && value.trim() !== (track.name ?? "")) renameTrack(track.id, value);
    useMixerView.getState().rename(null);
  };
  return (
    <Input
      autoFocus
      aria-label="Track name"
      defaultValue={track.name ?? name}
      className="absolute z-30 h-6 w-36 text-xs"
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

/** A track's right-click menu (on its number and name), FL Studio's. */
function TrackMenu({ id, isMaster }: { id: string; isMaster: boolean }) {
  const channelsSelected = useMusicUi((s) => s.selectedChannelIds.length > 0);
  const others = useMusicUi((s) => s.selectedTrackIds.some((t) => t !== id));
  return (
    <ContextMenuContent>
      <ContextMenuItem onSelect={() => setTimeout(() => useMixerView.getState().rename(id), 0)}>
        Rename… <ContextMenuShortcut>F2</ContextMenuShortcut>
      </ContextMenuItem>
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
      <div className="grid h-11 place-items-center text-brand" title="The selected track: its sends are shown">
        <PiArrowFatDownFill className="size-4" />
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
        <div className="flex h-11 flex-col items-center justify-end gap-0.5" data-send>
          {arrow(state.kind === "sending")}
          {state.kind === "sending" ? (
            <SongKnob size={20} label={`Send to ${name}`} value={state.level} min={0} max={1} defaultValue={1} format={percent} unit={PERCENT} edit={(song, level) => setSend(song, currentTrackId(song, useMusicUi.getState().selectedTrackIds), to, level)} />
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
    <span className="absolute top-1/2 right-0.5 -translate-y-1/2 text-brand" title={`Delay compensated: ${parts.join("; ")}`} data-testid="delay-mark">
      <PiClock className="size-2.5" />
    </span>
  );
}
