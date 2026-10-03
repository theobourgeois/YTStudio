import { NameColorEditor } from "../name-color-editor";
import { cn } from "cn";
import { clamp } from "@shared/math";
import { trackAt, trackName, updateTrack } from "@shared/music/playlist";
import { MASTER_TRACK_ID, MAX_TRACK_SIZE, MIN_TRACK_SIZE, TRACK_COLORS } from "@shared/music/project";
import { linkAudioTracks } from "@shared/music/recording";
import { trackName as mixerTrackName } from "@shared/music/mixer";
import { useShallow } from "zustand/react/shallow";
import { ArmButton } from "../mixer/arm-button";
import { inputLabel, useInputs } from "../inputs";
import { useMusicUi } from "../ui";
import {
  ContextMenu,
  ContextMenuCheckboxItem,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { bounceWithToast } from "./bounce";
import { startPointerDrag } from "@/lib/pointer-drag";
import { songGesture, useMusic } from "../store";
import {
  deletePlaylistTrack,
  insertPlaylistTrack,
  movePlaylistTrack,
  muteTrackClips,
  playlistContext,
  selectTrackClips,
  setTrackColor,
  setTrackSize,
  soloPlaylistTrack,
  toggleTrackMute,
} from "./actions";
import { trackTop, visibleTracks } from "./geometry";
import { usePlaylist } from "./store";

/**
 * The tracks' headers, down the Playlist's left (FL Studio's): each track's name (double-click to rename),
 * its colour, its mute light (a right-click or Ctrl+click solos; a click anywhere else on the header that
 * isn't its name mutes too, a bigger target), the divider under it that drags its height, and its menu.
 * A muted track's header is dimmed, as a muted mixer track is. An audio track (linked to a mixer track,
 * FL's) shows that track's arm switch and input. Only those in view are made.
 */
export function TrackHeaders() {
  const playlist = useMusic((s) => s.history!.doc.playlist);
  const view = usePlaylist((s) => s.view);
  const height = usePlaylist((s) => s.gridHeight);
  usePlaylist((s) => s.renaming);
  const p = playlistContext();
  if (!p) return <div />;
  const [first, last] = visibleTracks(p.layout, view, height);
  const rows = [];
  for (let track = first; track <= Math.min(last, p.trackCount - 1); track++) {
    rows.push(<TrackHeader key={track} index={track} top={trackTop(p.layout, view, track)} height={p.layout[track + 1] - p.layout[track]} />);
  }
  return (
    <div className="relative min-h-0 overflow-hidden border-r border-line bg-surface-1" data-testid="track-headers" data-tracks={p.trackCount} data-playlist={playlist.tracks.length}>
      {rows}
    </div>
  );
}

function TrackHeader({ index, top, height }: { index: number; top: number; height: number }) {
  const track = useMusic((s) => trackAt(s.history!.doc, index));
  const name = useMusic((s) => trackName(s.history!.doc, index));
  const renaming = usePlaylist((s) => s.renaming === index);
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          className={cn("absolute inset-x-0 flex items-start gap-1 border-b border-line px-1.5 pt-1", track.muted && !track.color && "bg-sunken")}
          style={{
            top,
            height,
            background: track.color ? `color-mix(in srgb, ${track.color} 55%, var(${track.muted ? "--sunken" : "--surface-1"}))` : undefined,
            ...(track.muted && { filter: "saturate(0.6) brightness(0.92)" }),
          }}
          data-track={index}
          data-track-name={name}
          data-muted={track.muted || undefined}
          // The header around the name and the light: a click mutes (Ctrl: solos), as the light does.
          onClick={(e) => {
            if (e.target !== e.currentTarget || e.button !== 0) return;
            if (e.ctrlKey || e.metaKey || e.altKey) soloPlaylistTrack(index);
            else toggleTrackMute(index);
          }}
        >
          {renaming ? (
            <NameColorEditor name={track.name ?? ""} color={track.color} label="Track name"
              onSave={(name, color) => useMusic.getState().commit((song) => updateTrack(song, index, { name, color }))}
              onClose={() => usePlaylist.setState({ renaming: null })}>
              <span className="mr-auto truncate text-[11px]">{name}</span>
            </NameColorEditor>
          ) : (
            <button
              type="button"
              className={cn(
                "mr-auto min-w-0 truncate text-left text-[11px] font-medium",
                track.color ? "text-white" : track.name ? "text-foreground" : "text-muted-foreground",
                track.muted && "opacity-[var(--mixer-muted-opacity)]",
              )}
              title={`${name}: double-click to rename, right-click for its menu`}
              onDoubleClick={() => usePlaylist.setState({ renaming: index })}
            >
              {name}
            </button>
          )}
          {track.mixerTrack && <AudioTrackControls mixerTrack={track.mixerTrack} tall={height >= 40} />}
          <button
            type="button"
            aria-label={track.muted ? `Unmute ${name}` : `Mute ${name}`}
            aria-pressed={!track.muted}
            title="Mute (right-click or Ctrl+click to solo)"
            className="group mt-px grid size-4 shrink-0 place-items-center rounded-full"
            onClick={(e) => (e.ctrlKey || e.metaKey || e.altKey ? soloPlaylistTrack(index) : toggleTrackMute(index))}
            onContextMenu={(e) => {
              e.preventDefault();
              e.stopPropagation();
              soloPlaylistTrack(index);
            }}
          >
            <span
              className={cn(
                "size-2.5 rounded-full group-hover:brightness-125",
                track.muted ? "sunken" : "border border-brand-edge bg-brand shadow-[0_0_5px] shadow-brand/70 inset-shadow-[0_1px_0_rgb(255_255_255/0.45)]",
              )}
            />
          </button>
          <SizeDivider index={index} size={track.size} height={height} />
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent data-testid="track-menu">
        <ContextMenuItem onSelect={() => usePlaylist.setState({ renaming: index })}>Rename and color…</ContextMenuItem>
        <ContextMenuSub>
          <ContextMenuSubTrigger>Change color</ContextMenuSubTrigger>
          <ContextMenuSubContent className="grid grid-cols-6 gap-1 p-1.5">
            {TRACK_COLORS.map((color) => (
              <ContextMenuItem key={color} aria-label={color} className="size-5 rounded-sm border border-black/30 p-0" style={{ background: color }} onSelect={() => setTrackColor(index, color)} />
            ))}
            <ContextMenuItem className="col-span-6 mt-1 text-[11px] text-muted-foreground" onSelect={() => setTrackColor(index, null)}>
              No colour
            </ContextMenuItem>
          </ContextMenuSubContent>
        </ContextMenuSub>
        <ContextMenuSub>
          <ContextMenuSubTrigger>Size</ContextMenuSubTrigger>
          <ContextMenuSubContent>
            {[0.5, 1, 1.5, 2, 3].map((size) => (
              <ContextMenuItem key={size} onSelect={() => setTrackSize(index, size)}>
                {Math.round(size * 100)}%
              </ContextMenuItem>
            ))}
          </ContextMenuSubContent>
        </ContextMenuSub>
        <TrackModeMenu index={index} linked={track.mixerTrack} />
        <ContextMenuSeparator />
        <ContextMenuItem onSelect={() => selectTrackClips(index)}>Select its clips</ContextMenuItem>
        <ContextMenuItem onSelect={() => muteTrackClips(index, true)}>Mute all clips</ContextMenuItem>
        <ContextMenuItem onSelect={() => muteTrackClips(index, false)}>Unmute all clips</ContextMenuItem>
        <ContextMenuItem
          title="Render its clips into one audio clip on it, and mute them (FL's Consolidate)"
          onSelect={() => {
            const clips = useMusic.getState().history?.doc.playlist.clips ?? [];
            void bounceWithToast(new Set(clips.filter((c) => c.track === index && !c.muted && c.kind !== "automation").map((c) => c.id)), true);
          }}
        >
          Consolidate this track
        </ContextMenuItem>
        <ContextMenuItem onSelect={() => soloPlaylistTrack(index)}>Solo</ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem onSelect={() => insertPlaylistTrack(index)}>Insert one</ContextMenuItem>
        <ContextMenuItem onSelect={() => movePlaylistTrack(index, -1)} disabled={index === 0}>
          Move up
        </ContextMenuItem>
        <ContextMenuItem onSelect={() => movePlaylistTrack(index, 1)}>Move down</ContextMenuItem>
        <ContextMenuItem variant="destructive" onSelect={() => deletePlaylistTrack(index)}>
          Delete (and its clips)
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}

/**
 * An audio track's own controls (FL's on-track controls): its mixer track's arm switch, and (with room)
 * which insert and input it records. A click on them selects the mixer track, whose inspector sets them.
 */
function AudioTrackControls({ mixerTrack, tall }: { mixerTrack: string; tall: boolean }) {
  const name = useMusic((s) => mixerTrackName(s.history!.doc, mixerTrack));
  const input = useMusic((s) => s.history!.doc.mixer.tracks.find((t) => t.id === mixerTrack)?.input ?? null);
  const channels = useInputs((s) => s.channels);
  return (
    <>
      {tall && (
        <button
          type="button"
          className="absolute bottom-1 left-1.5 max-w-[calc(100%-1rem)] truncate text-left text-[10px] text-muted-foreground hover:text-foreground"
          title={`Records on ${name} (its input, monitoring and arm: the Mixer's inspector)`}
          onClick={() => {
            useMusicUi.getState().selectTrack(mixerTrack);
            useMusicUi.getState().setMixerOpen(true);
          }}
        >
          {name} · {input ? inputLabel(input, channels) : "no input"}
        </button>
      )}
      <ArmButton trackId={mixerTrack} name={name} size={10} className="mt-[3px]" />
    </>
  );
}

/** FL's Track mode → Audio track: link the track to a mixer insert (or none: an ordinary track). */
function TrackModeMenu({ index, linked }: { index: number; linked: string | null }) {
  const inserts = useMusic(useShallow((s) => s.history!.doc.mixer.tracks.filter((t) => t.id !== MASTER_TRACK_ID).map((t) => t.id)));
  const names = useMusic(useShallow((s) => inserts.map((id) => mixerTrackName(s.history!.doc, id))));
  const link = (id: string | null) => useMusic.getState().commit((song) => linkAudioTracks(song, [index], id));
  return (
    <ContextMenuSub>
      <ContextMenuSubTrigger>Audio track</ContextMenuSubTrigger>
      <ContextMenuSubContent className="max-h-80 overflow-y-auto">
        <ContextMenuCheckboxItem checked={linked === null} onSelect={() => link(null)}>
          None (an ordinary track)
        </ContextMenuCheckboxItem>
        <ContextMenuSeparator />
        {inserts.map((id, i) => (
          <ContextMenuCheckboxItem key={id} checked={linked === id} onSelect={() => link(id)}>
            {names[i]}
          </ContextMenuCheckboxItem>
        ))}
      </ContextMenuSubContent>
    </ContextMenuSub>
  );
}

/** The divider under a track: dragged, it changes the track's height (one undo step); Alt+click puts it back. */
function SizeDivider({ index, size, height }: { index: number; size: number; height: number }) {
  return (
    <div
      role="separator"
      aria-orientation="horizontal"
      aria-label="Drag to change the track's height"
      className="absolute inset-x-0 -bottom-[3px] z-10 h-1.5 cursor-row-resize hover:bg-brand/40"
      onPointerDown={(e) => {
        if (e.altKey) {
          setTrackSize(index, 1);
          return;
        }
        const origin = e.clientY;
        const perPx = size / Math.max(1, height);
        const gesture = songGesture();
        startPointerDrag(e, {
          threshold: 1,
          cursor: "row-resize",
          onStart: () => gesture.begin(),
          onMove: (ev) => gesture.apply((song) => updateTrack(song, index, { size: clamp(size + (ev.clientY - origin) * perPx, MIN_TRACK_SIZE, MAX_TRACK_SIZE) })),
          onEnd: () => gesture.end(),
          onCancel: () => gesture.cancel(),
        });
      }}
    />
  );
}
