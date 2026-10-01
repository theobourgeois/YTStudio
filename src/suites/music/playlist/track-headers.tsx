import { cn } from "cn";
import { clamp } from "@shared/math";
import { trackAt, trackName, updateTrack } from "@shared/music/playlist";
import { MAX_TRACK_SIZE, MIN_TRACK_SIZE, TRACK_COLORS } from "@shared/music/project";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { startPointerDrag } from "@/lib/pointer-drag";
import { songGesture, useMusic } from "../store";
import {
  deletePlaylistTrack,
  insertPlaylistTrack,
  movePlaylistTrack,
  muteTrackClips,
  playlistContext,
  renameTrack,
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
 * its colour, its mute light (a right-click or Ctrl+click solos), the divider under it that drags its height,
 * and its menu. Only those in view are made.
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
          className="absolute inset-x-0 flex items-start gap-1 border-b border-line px-1.5 pt-1"
          style={{ top, height, background: track.color ? `color-mix(in srgb, ${track.color} 55%, var(--surface-1))` : undefined }}
          data-track={index}
          data-track-name={name}
          data-muted={track.muted || undefined}
        >
          {renaming ? (
            <input
              autoFocus
              aria-label="Track name"
              defaultValue={track.name ?? ""}
              placeholder={`Track ${index + 1}`}
              className="sunken h-5 min-w-0 flex-1 rounded-sm px-1 text-[11px] outline-none"
              onFocus={(e) => e.currentTarget.select()}
              onBlur={(e) => {
                renameTrack(index, e.currentTarget.value);
                usePlaylist.setState({ renaming: null });
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") e.currentTarget.blur();
                if (e.key === "Escape") usePlaylist.setState({ renaming: null });
                e.stopPropagation();
              }}
            />
          ) : (
            <button
              type="button"
              className={cn("min-w-0 flex-1 truncate text-left text-[11px] font-medium", track.color ? "text-white" : track.name ? "text-foreground" : "text-muted-foreground")}
              title={`${name}: double-click to rename, right-click for its menu`}
              onDoubleClick={() => usePlaylist.setState({ renaming: index })}
            >
              {name}
            </button>
          )}
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
        <ContextMenuItem onSelect={() => usePlaylist.setState({ renaming: index })}>Rename…</ContextMenuItem>
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
        <ContextMenuSeparator />
        <ContextMenuItem onSelect={() => selectTrackClips(index)}>Select its clips</ContextMenuItem>
        <ContextMenuItem onSelect={() => muteTrackClips(index, true)}>Mute all clips</ContextMenuItem>
        <ContextMenuItem onSelect={() => muteTrackClips(index, false)}>Unmute all clips</ContextMenuItem>
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
