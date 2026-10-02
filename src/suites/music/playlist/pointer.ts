/**
 * The Playlist's mouse, FL Studio's way (`docs/fl-studio/playlist.md`): what a press on the tracks or the
 * ruler does, by tool, button and modifier keys. The left button adds, the right one deletes (sweeping),
 * Ctrl selects. Each drag is a `PlaylistDrag` in the store while it lasts, and one edit when it's let go.
 */
import type { PointerEvent as ReactPointerEvent } from "react";
import { clipEnd, clipLength } from "@shared/music/playlist";
import { MAX_PLAYLIST_TRACKS } from "@shared/music/project";
import type { PlaylistClip } from "@shared/music/types";
import { type DragHandlers, startPointerDrag } from "@/lib/pointer-drag";
import { CURSORS, MOVE_CURSOR, MOVING_CURSOR, RESIZE_CURSOR, STRETCH_CURSOR } from "../piano/cursors";
import { useMusicPreferences } from "../preferences";
import { edgeSpeed, snapDelta, snapTick } from "../piano/geometry";
import { useTransport } from "../transport";
import {
  type PlaylistContext,
  cancelDrag,
  chooseSource,
  clipSource,
  commitDrag,
  deselect,
  newClip,
  openClip,
  playFrom,
  playlistContext,
  selectTime,
} from "./actions";
import { paintClipStarts, scrollViewBy, hitClip, xToTick, yToTrack } from "./geometry";
import { fadeOutClips } from "./fades";
import { usePlaylist } from "./store";
import { curveCursor, curvePointerDown } from "../automation/curve-pointer";

type Press = ReactPointerEvent<HTMLElement>;

const local = (element: Element, ev: { clientX: number; clientY: number }) => {
  const rect = element.getBoundingClientRect();
  return { x: ev.clientX - rect.left, y: ev.clientY - rect.top };
};
const show = (element: HTMLElement, cursor: string) => (element.style.cursor = cursor);
const lastTrack = (p: PlaylistContext) => Math.min(MAX_PLAYLIST_TRACKS - 1, p.trackCount - 1);

/** A drag that scrolls the tracks while the pointer is near or past their edges, moving on as it does. */
function startGridDrag(e: Press, element: HTMLElement, h: DragHandlers) {
  let last: PointerEvent | null = null;
  let travel = { x: 0, y: 0 };
  let frame = 0;
  const step = () => {
    frame = 0;
    if (!last) return;
    const rect = element.getBoundingClientRect();
    const { view, setView } = usePlaylist.getState();
    const p = playlistContext();
    const maxY = p ? p.layout[p.layout.length - 1] : 0;
    const next = scrollViewBy(view, edgeSpeed(last.clientX - rect.left, rect.width), edgeSpeed(last.clientY - rect.top, rect.height), maxY);
    if (next === view) return;
    setView(next);
    h.onMove(last, travel);
    frame = requestAnimationFrame(step);
  };
  const stop = () => {
    cancelAnimationFrame(frame);
    frame = 0;
    last = null;
  };
  return startPointerDrag(e, {
    ...h,
    onMove(ev, moved) {
      last = ev;
      travel = { ...moved };
      h.onMove(ev, moved);
      if (!frame) frame = requestAnimationFrame(step);
    },
    onEnd() {
      stop();
      h.onEnd?.();
    },
    onCancel() {
      stop();
      h.onCancel?.();
    },
    onClick() {
      stop();
      h.onClick?.();
    },
  });
}

/** The last press, to tell a double-click (pointer events don't count clicks). */
let lastPress = { at: 0, x: 0, y: 0, target: null as EventTarget | null };

function isDouble(e: Press): boolean {
  const now = performance.now();
  const double = lastPress.target === e.currentTarget && now - lastPress.at < 400 && Math.hypot(e.clientX - lastPress.x, e.clientY - lastPress.y) < 6;
  lastPress = double ? { at: 0, x: 0, y: 0, target: null } : { at: now, x: e.clientX, y: e.clientY, target: e.currentTarget };
  return double;
}

/** Sweep across clips with the right button or the delete tool: each goes as it's touched. */
function erase(e: Press, element: HTMLElement, p: PlaylistContext, hit: PlaylistClip | null, button: 0 | 2, onClickNothing?: () => void) {
  const erased = new Set<number>();
  const take = (clip: PlaylistClip | null) => {
    if (!clip || erased.has(clip.id)) return;
    erased.add(clip.id);
    fadeOutClips([clip], p.selected);
    usePlaylist.getState().setDrag({ kind: "erase", ids: new Set(erased) });
  };
  show(element, CURSORS.eraser);
  usePlaylist.getState().setDrag({ kind: "erase", ids: new Set() });
  take(hit);
  startGridDrag(e, element, {
    button,
    threshold: 0,
    onMove(ev) {
      const q = local(element, ev);
      take(hitClip(p.clips, p.ctx, p.layout, usePlaylist.getState().view, q.x, q.y)?.clip ?? null);
    },
    onEnd: commitDrag,
    onClick() {
      if (erased.size) return commitDrag();
      cancelDrag();
      onClickNothing?.();
    },
    onCancel: cancelDrag,
  });
}

export function gridPointerDown(e: Press) {
  const p = playlistContext();
  if (!p) return;
  const element = e.currentTarget;
  const playlist = usePlaylist.getState();
  const { view, tool } = playlist;
  const q0 = local(element, e);
  const tick0 = xToTick(view, q0.x);
  const track0 = Math.min(yToTrack(p.layout, view, q0.y), lastTrack(p));
  const gridOf = (ev: { altKey: boolean }) => (ev.altKey ? 1 : p.grid);
  const at = (ev: PointerEvent) => {
    const q = local(element, ev);
    const now = usePlaylist.getState().view;
    return { x: q.x, y: q.y, tick: xToTick(now, q.x), track: Math.min(yToTrack(p.layout, now, q.y), lastTrack(p)) };
  };
  const finish = { onEnd: commitDrag, onClick: commitDrag, onCancel: cancelDrag };

  // The middle button pans, whatever the tool.
  if (e.button === 1) {
    e.preventDefault();
    show(element, MOVING_CURSOR);
    startPointerDrag(e, {
      button: 1,
      threshold: 0,
      cursor: "grabbing",
      onMove(ev) {
        const q = local(element, ev);
        usePlaylist.getState().setView(scrollViewBy(view, q0.x - q.x, q0.y - q.y, p.layout[p.layout.length - 1]));
      },
    });
    return;
  }

  const hit = hitClip(p.clips, p.ctx, p.layout, view, q0.x, q0.y, p.selected);

  // An automation clip's curve, edited on the clip (FL's): its points and tension handles, and a
  // right-click on its line adds a point. (Its title is the clip's: a right-click there deletes it.)
  if (hit?.clip.kind === "automation" && !hit.menu && !hit.edge && (tool === "draw" || tool === "paint") && curvePointerDown(e, element, p, hit.clip, q0.x, q0.y)) return;

  // The right button deletes, sweeping; on nothing, it deselects. With Alt: play from there.
  if (e.button === 2) {
    if (e.altKey) return playFrom(snapTick(tick0, p.grid, "cell"));
    erase(e, element, p, hit?.clip ?? null, 2, deselect);
    return;
  }
  if (e.button !== 0) return;

  // Its menu's arrow: the clip's menu (FL's), whatever the tool.
  if (hit?.menu) {
    usePlaylist.setState({ clipMenu: { clipId: hit.clip.id, x: q0.x, y: q0.y } });
    return;
  }
  // A double-click on a clip opens what it plays.
  if (hit && isDouble(e)) return openClip(hit.clip);

  const selecting = e.ctrlKey || e.metaKey || (tool === "select" && !hit);
  if (selecting) {
    if (hit) {
      const next = new Set(e.shiftKey ? p.selected : []);
      if (e.shiftKey && next.has(hit.clip.id)) next.delete(hit.clip.id);
      else next.add(hit.clip.id);
      playlist.select(next);
      return;
    }
    show(element, "crosshair");
    startGridDrag(e, element, {
      threshold: 3,
      onMove(ev) {
        const q = at(ev);
        usePlaylist.getState().setDrag({ kind: "rect", from: tick0, to: q.tick, top: track0, bottom: q.track, add: e.shiftKey });
      },
      onEnd: commitDrag,
      onClick: () => (e.shiftKey ? undefined : deselect()),
      onCancel: cancelDrag,
    });
    return;
  }

  if (tool === "select" && hit) {
    const next = new Set(e.shiftKey ? p.selected : []);
    if (e.shiftKey && next.has(hit.clip.id)) next.delete(hit.clip.id);
    else next.add(hit.clip.id);
    playlist.select(next);
    return;
  }

  if (tool === "delete") return erase(e, element, p, hit?.clip ?? null, 0);

  // The playback tool: play from where it's pressed, while it's held.
  if (tool === "playback") {
    const from = snapTick(tick0, p.grid, "cell");
    playFrom(from);
    playlist.setDrag({ kind: "playback", tick: from });
    show(element, CURSORS.speaker);
    const stop = () => {
      cancelDrag();
      useTransport.getState().stop();
    };
    startPointerDrag(e, { threshold: 0, onMove: () => {}, onEnd: stop, onClick: stop, onCancel: stop });
    return;
  }

  if (tool === "mute") {
    const muted = hit ? !hit.clip.muted : true;
    const swept = new Set<number>(hit ? [hit.clip.id] : []);
    show(element, CURSORS.mute);
    playlist.setDrag({ kind: "mute", ids: new Set(swept), muted });
    startGridDrag(e, element, {
      threshold: 0,
      onMove(ev) {
        const q = at(ev);
        const clip = hitClip(p.clips, p.ctx, p.layout, usePlaylist.getState().view, q.x, q.y)?.clip;
        if (clip && !swept.has(clip.id)) {
          swept.add(clip.id);
          usePlaylist.getState().setDrag({ kind: "mute", ids: new Set(swept), muted });
        }
      },
      ...finish,
    });
    return;
  }

  // The slice tool: a line straight down at the grid line nearest the pointer, across the tracks dragged
  // over; with Shift, the whole height, cutting every track.
  if (tool === "slice") {
    const slice = (ev: { clientX: number; clientY: number; altKey: boolean; shiftKey: boolean }) => {
      const q = local(element, ev);
      const now = usePlaylist.getState().view;
      const tick = snapTick(xToTick(now, q.x), ev.altKey ? 1 : p.grid, "line");
      usePlaylist.getState().setDrag({ kind: "slice", tick, top: track0, bottom: Math.min(yToTrack(p.layout, now, q.y), lastTrack(p)), all: ev.shiftKey });
    };
    usePlaylist.setState({ sliceHover: null });
    show(element, CURSORS.knife);
    slice(e);
    startPointerDrag(e, { threshold: 0, onMove: slice, ...finish });
    return;
  }

  // The slip tool: the content moves inside the clips (the selection, if the clip's in it).
  if (tool === "slip") {
    if (!hit) return;
    const ids = p.selected.has(hit.clip.id) ? p.selected : new Set([hit.clip.id]);
    show(element, RESIZE_CURSOR);
    startGridDrag(e, element, {
      threshold: 2,
      cursor: "ew-resize",
      onMove: (ev) => usePlaylist.getState().setDrag({ kind: "slip", ids, ticks: snapDelta(at(ev).tick - tick0, gridOf(ev)) }),
      ...finish,
    });
    return;
  }

  // Draw and Paint, on a clip: it becomes what they add (and its pattern the one shown), and moves
  // (Shift: a copy of it), or by an edge, resizes. The selection goes along if the clip is in it.
  if (hit) {
    const clip = hit.clip;
    chooseSource({ kind: clip.kind, ref: clip.ref });
    const ids = p.selected.has(clip.id) ? p.selected : new Set([clip.id]);
    if (hit.edge) {
      const edgeTick = hit.edge === "start" ? clip.start : clipEnd(clip, p.ctx);
      // With Stretch on, an audio clip's edge stretches its sound (and every selected clip's) to the new length.
      const stretching = usePlaylist.getState().stretch && clip.kind === "audio";
      const mode = useMusicPreferences.getState().stretchMode;
      show(element, stretching ? STRETCH_CURSOR : RESIZE_CURSOR);
      startGridDrag(e, element, {
        threshold: 2,
        cursor: stretching ? STRETCH_CURSOR : "ew-resize",
        onMove(ev) {
          const moved = snapTick(edgeTick + (at(ev).tick - tick0), gridOf(ev), "line");
          const edge = hit.edge!;
          usePlaylist.getState().setDrag(stretching ? { kind: "stretch", ids, edge, ticks: moved - edgeTick, mode } : { kind: "resize", ids, edge, ticks: moved - edgeTick });
        },
        ...finish,
      });
      return;
    }
    const clone = e.shiftKey;
    show(element, MOVING_CURSOR);
    startGridDrag(e, element, {
      threshold: 2,
      onMove(ev) {
        const q = at(ev);
        // Moved on the grid from where the clip starts: a clip off the grid keeps its offset.
        const ticks = snapTick(clip.start + q.tick - tick0, gridOf(ev), "line") - clip.start;
        usePlaylist.getState().setDrag({ kind: "move", ids, ticks: ev.ctrlKey || ev.metaKey ? 0 : ticks, tracks: q.track - track0, clone });
      },
      ...finish,
      onClick() {
        cancelDrag();
        // A click on a clip that isn't selected: nothing else is (FL selects by Ctrl, but a click shows which).
        if (!p.selected.has(clip.id) && p.selected.size) usePlaylist.getState().select([]);
      },
    });
    return;
  }

  // On nothing, with clips selected: a click away deselects them (and adds nothing).
  if (p.selected.size) {
    playlist.select([]);
    return;
  }

  // On nothing: a clip of the source, at the start of the cell pressed. Draw moves it until it's let go
  // (Shift: paints); Paint lays more along the track.
  const source = clipSource(p.song);
  const start = snapTick(tick0, gridOf(e), "cell");
  const first = newClip(p.song, source, start, track0);
  const length = clipLength({ ...first, id: 0, length: first.length ?? null, offset: first.offset ?? 0, muted: false }, p.ctx);
  playlist.setDrag({ kind: "add", clips: [first] });

  if (tool === "paint" || e.shiftKey) {
    startGridDrag(e, element, {
      threshold: 0,
      onMove(ev) {
        const q = at(ev);
        const clips = paintClipStarts(start, q.tick, length, gridOf(ev)).map((s) => ({ ...first, start: s }));
        usePlaylist.getState().setDrag({ kind: "add", clips });
      },
      ...finish,
    });
    return;
  }
  startGridDrag(e, element, {
    threshold: 0,
    onMove(ev) {
      const q = at(ev);
      usePlaylist.getState().setDrag({ kind: "add", clips: [{ ...first, start: Math.max(0, start + snapDelta(q.tick - tick0, gridOf(ev))), track: q.track }] });
    },
    ...finish,
  });
}

/** The pointer over the tracks, for the tool and what's under it (as the Piano roll's). */
export function gridCursor(element: HTMLElement, ev: { clientX: number; clientY: number; ctrlKey?: boolean; metaKey?: boolean }): string {
  const p = playlistContext();
  if (!p) return "default";
  const { view, tool } = usePlaylist.getState();
  if (ev.ctrlKey || ev.metaKey) return "crosshair";
  if (tool === "delete") return CURSORS.eraser;
  if (tool === "mute") return CURSORS.mute;
  if (tool === "slice") return CURSORS.knife;
  if (tool === "playback") return CURSORS.speaker;
  const q = local(element, ev);
  const hit = hitClip(p.clips, p.ctx, p.layout, view, q.x, q.y, p.selected);
  if (hit?.menu) return "pointer";
  const onCurve = hit?.clip.kind === "automation" && !hit.edge && (tool === "draw" || tool === "paint") ? curveCursor(p, view, hit.clip, q.x, q.y) : null;
  if (onCurve) return onCurve;
  if (tool === "slip") return hit ? RESIZE_CURSOR : "default";
  if (tool === "select") return hit ? "pointer" : "default";
  if (hit) return hit.edge ? (usePlaylist.getState().stretch && hit.clip.kind === "audio" ? STRETCH_CURSOR : RESIZE_CURSOR) : MOVE_CURSOR;
  return tool === "paint" ? CURSORS.brush : CURSORS.pencil;
}

/** With the slice tool and Shift held, its line shows where a press would cut: every track, the whole height. */
export function trackSliceHover(element: Element, ev: { clientX: number; clientY: number; altKey: boolean; shiftKey: boolean } | null) {
  const playlist = usePlaylist.getState();
  const p = playlist.tool === "slice" && ev?.shiftKey ? playlistContext() : null;
  let next: { tick: number } | null = null;
  if (p && ev) next = { tick: snapTick(xToTick(playlist.view, local(element, ev).x), ev.altKey ? 1 : p.grid, "line") };
  if (next?.tick !== playlist.sliceHover?.tick) usePlaylist.setState({ sliceHover: next });
}

/**
 * The ruler: a click (or a drag) sets where the song plays from, and while it plays it goes there at once
 * (song mode). Ctrl+drag, or a double-click and drag, selects a range of time (which song mode loops); a
 * double-click without dragging, or a right-click, clears it.
 */
export function rulerPointerDown(e: Press) {
  const p = playlistContext();
  if (!p) return;
  const element = e.currentTarget;
  const { view } = usePlaylist.getState();
  const tickAt = (ev: { clientX: number; clientY: number; altKey: boolean }) => snapTick(xToTick(view, local(element, ev).x), ev.altKey ? 1 : p.grid, "line");
  if (e.button === 2) {
    usePlaylist.setState({ time: null });
    return;
  }
  if (e.button !== 0) return;
  const start = tickAt(e);
  if (isDouble(e) || e.ctrlKey || e.metaKey) {
    const double = !(e.ctrlKey || e.metaKey);
    startPointerDrag(e, { threshold: 2, onMove: (ev) => selectTime(start, tickAt(ev)), onClick: () => double && usePlaylist.setState({ time: null }) });
    return;
  }
  useTransport.getState().jumpSongTo(start);
  let last = performance.now();
  startPointerDrag(e, {
    threshold: 2,
    onMove(ev) {
      const now = performance.now();
      const transport = useTransport.getState();
      if (transport.playing && now - last < 60) return transport.setSongStartTick(tickAt(ev));
      last = now;
      transport.jumpSongTo(tickAt(ev));
    },
    onEnd: () => useTransport.getState().jumpSongTo(useTransport.getState().songStartTick),
  });
}
