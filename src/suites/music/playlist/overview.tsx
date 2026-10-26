import { type PointerEvent as ReactPointerEvent, useEffect, useMemo, useRef } from "react";
import { clipContext, songTicks } from "@shared/music/playlist";
import { startPointerDrag } from "@/lib/pointer-drag";
import { CURSOR } from "../cursors";
import { prepare } from "../piano/draw";
import { useClipLook } from "./clip-look";
import { useMusic } from "../store";
import { zoomFloor } from "./actions";
import { drawOverview } from "./draw";
import { OVERVIEW_EDGE, overviewDrag, overviewSpan, overviewThumb } from "./geometry";
import { usePlaylist } from "./store";

/** The overview's height, above the ruler. */
export const OVERVIEW_HEIGHT = 22;

/**
 * The overview along the Playlist's top (FL's mini playlist preview, its zoom and scroll bar): the whole
 * song in miniature, every clip a bar on its track's row, with the view's window over it. The window
 * drags to scroll, its ends drag to zoom (the other end stays put), and a press beside it brings the view
 * there and drags on from it. The maths is `overviewDrag` (`geometry.ts`).
 */
export function PlaylistOverview() {
  const canvas = useRef<HTMLCanvasElement>(null);
  const song = useMusic((s) => s.history!.doc);
  const selected = usePlaylist((s) => s.selected);
  const view = usePlaylist((s) => s.view);
  const width = usePlaylist((s) => s.gridWidth);
  const ctx = useMemo(() => clipContext(song), [song]);
  const span = overviewSpan(view, width, songTicks(song), ctx.barTicks);
  const { dark } = useClipLook();
  // Drawn only when the song, the selection or the span change: scrolling only moves the window.
  useEffect(() => {
    const c = canvas.current && prepare(canvas.current, width, OVERVIEW_HEIGHT);
    if (!c) return;
    const colors = new Map([...song.patterns, ...song.channels, ...song.automations].flatMap((source) => (source.color ? [[source.id, source.color] as const] : [])));
    drawOverview(c, { clips: song.playlist.clips, ctx, tracks: song.playlist.tracks, colors, selected, span, width, height: OVERVIEW_HEIGHT, dark });
  }, [song, ctx, selected, span, width, dark]);

  const thumb = overviewThumb(view, width, span);
  const drag = (e: ReactPointerEvent<HTMLDivElement>, part: "move" | "start" | "end", beside = false) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    const playlist = usePlaylist.getState();
    let start = playlist.view;
    // A press beside the window: the view goes there, centred on it, and the drag moves it on from there.
    if (beside) {
      const x = e.clientX - e.currentTarget.getBoundingClientRect().left;
      start = overviewDrag(start, "move", x - (thumb.left + thumb.width / 2), width, span);
      playlist.setView(start);
    }
    const origin = e.clientX;
    const min = zoomFloor();
    startPointerDrag(e, {
      threshold: 0,
      cursor: part === "move" ? CURSOR.handDrag : CURSOR.moveH,
      onMove: (ev) => usePlaylist.getState().setView(overviewDrag(start, part, ev.clientX - origin, width, span, min)),
    });
  };

  return (
    <div className="relative border-b bg-sunken" data-testid="playlist-overview" aria-label="Song overview: drag to scroll, drag its ends to zoom" onPointerDown={(e) => drag(e, "move", true)}>
      <canvas ref={canvas} className="pointer-events-none absolute inset-0 size-full" />
      {/* What's out of view is shaded, so where the window starts and ends reads at a glance. */}
      <div className="pointer-events-none absolute inset-y-0 left-0 bg-surface-0/55" style={{ width: Math.max(0, thumb.left) }} />
      <div className="pointer-events-none absolute inset-y-0 right-0 bg-surface-0/55" style={{ left: thumb.left + thumb.width }} />
      <div
        className="group absolute inset-y-0 cursor-grab rounded-sm border border-brand/80 bg-brand/10 hover:bg-brand/20"
        style={{ left: thumb.left, width: thumb.width }}
        data-testid="playlist-overview-window"
        onPointerDown={(e) => drag(e, "move")}
      >
        {/* Its ends, drawn as grips: they zoom. */}
        <div className="absolute inset-y-0 left-0 cursor-ew-resize" style={{ width: OVERVIEW_EDGE }} onPointerDown={(e) => drag(e, "start")}>
          <span className="absolute inset-y-1 left-px w-[3px] rounded-full bg-brand opacity-80 group-hover:opacity-100" />
        </div>
        <div className="absolute inset-y-0 right-0 cursor-ew-resize" style={{ width: OVERVIEW_EDGE }} onPointerDown={(e) => drag(e, "end")}>
          <span className="absolute inset-y-1 right-px w-[3px] rounded-full bg-brand opacity-80 group-hover:opacity-100" />
        </div>
      </div>
    </div>
  );
}
