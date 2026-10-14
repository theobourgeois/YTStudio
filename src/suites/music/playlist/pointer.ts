/**
 * The Playlist's mouse, FL Studio's way (`docs/fl-studio/playlist.md`): what a press on the tracks or the
 * ruler does, by tool, button and modifier keys. The left button adds, the right one deletes (sweeping),
 * Ctrl selects. Each drag is a `PlaylistDrag` in the store while it lasts, and one edit when it's let go.
 */
import type { PointerEvent as ReactPointerEvent } from "react";
import { clipEnd, clipLength, editClips, sliceClips } from "@shared/music/playlist";
import { useMusic } from "../store";
import { MAX_CLIP_GAIN, MAX_PLAYLIST_TRACKS } from "@shared/music/project";
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
  zoomFloor,
  markersOf,
  selectTime,
} from "./actions";
import { type ClipHandle, markerAt, paintClipStarts, scrollViewBy, hitClip, xToTick, yToTrack, zoomAt, zoomToRange } from "./geometry";
import { fadeOutClips } from "./fades";
import { usePlaylist } from "./store";
import { curveCursor, curveHoverAt, curvePointerDown, onCurvePoint } from "../automation/curve-pointer";

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
  const double = lastPress.target === e.currentTarget && now - lastPress.at < 500 && Math.hypot(e.clientX - lastPress.x, e.clientY - lastPress.y) < 6;
  lastPress = double ? { at: 0, x: 0, y: 0, target: null } : { at: now, x: e.clientX, y: e.clientY, target: e.currentTarget };
  return double;
}

/**
 * The sweeping tools' (erase, mute) path: each call gives the clips under every point of the path since
 * the last call, a few px apart (a fast sweep's pointer events are tens of px apart, and would skip small
 * clips), in the view as it is now.
 */
function sweeper(element: HTMLElement, p: PlaylistContext, e: Press) {
  let last = local(element, e);
  let lastEvent: PointerEvent | null = null;
  return (ev: PointerEvent): PlaylistClip[] => {
    const view = usePlaylist.getState().view;
    // The same event again (the grid scrolling under a still pointer): only where it is now.
    const samples = ev === lastEvent ? [] : (ev.getCoalescedEvents?.() ?? []);
    lastEvent = ev;
    const met: PlaylistClip[] = [];
    for (const q of (samples.length ? samples : [ev]).map((s) => local(element, s))) {
      const steps = Math.max(1, Math.ceil(Math.hypot(q.x - last.x, q.y - last.y) / 3));
      for (let i = 1; i <= steps; i++) {
        const x = last.x + ((q.x - last.x) * i) / steps;
        const y = last.y + ((q.y - last.y) * i) / steps;
        const clip = hitClip(p.clips, p.ctx, p.layout, view, x, y)?.clip;
        if (clip && met.at(-1) !== clip) met.push(clip);
      }
      last = q;
    }
    return met;
  };
}

/** The last right-press, to tell a double right-click. */
let lastRight = { at: 0, x: 0, y: 0 };
function isDoubleRight(e: Press): boolean {
  const now = performance.now();
  const double = now - lastRight.at < 400 && Math.hypot(e.clientX - lastRight.x, e.clientY - lastRight.y) < 6;
  lastRight = double ? { at: 0, x: 0, y: 0 } : { at: now, x: e.clientX, y: e.clientY };
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
  const sweep = sweeper(element, p, e);
  startGridDrag(e, element, {
    button,
    threshold: 0,
    onMove(ev) {
      for (const clip of sweep(ev)) take(clip);
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

  const hit = hitClip(p.clips, p.ctx, p.layout, view, q0.x, q0.y, p.selected);
  // The middle button pans, whatever the tool; so does Shift+right-drag (FL's), but on an automation
  // clip's curve, where Shift+right-click adds a point on its line.
  const shiftPan = e.button === 2 && e.shiftKey && !e.altKey && !e.ctrlKey && !e.metaKey && hit?.clip.kind !== "automation";
  if (e.button === 1 || shiftPan) {
    e.preventDefault();
    show(element, MOVING_CURSOR);
    startPointerDrag(e, {
      button: e.button === 1 ? 1 : 2,
      threshold: 0,
      cursor: "grabbing",
      onMove(ev) {
        const q = local(element, ev);
        usePlaylist.getState().setView(scrollViewBy(view, q0.x - q.x, q0.y - q.y, p.layout[p.layout.length - 1]));
      },
    });
    return;
  }

  // The zoom tool (FL's Z): a rectangle zooms to it, a click zooms out, a right-click back and forth.
  // Ctrl+right-drag is the same rectangle with any tool, and Ctrl+right-click goes back (FL's).
  if ((tool === "zoom" && (e.button === 0 || e.button === 2)) || (e.button === 2 && (e.ctrlKey || e.metaKey))) return zoomTool(e, tick0, track0, q0.x, at);

  // An automation clip's curve, edited on the clip (FL's): its points and tension handles, and a
  // right-click on its line adds a point. (Its title is the clip's: a right-click there deletes it.)
  // A point or tension handle wins over the clip's edge: the first point is always on its left edge.
  if (hit?.clip.kind === "automation" && !hit.menu && (tool === "draw" || tool === "paint") && (!hit.edge || onCurvePoint(p, view, hit.clip, q0.x, q0.y)) && curvePointerDown(e, element, p, hit.clip, q0.x, q0.y)) return;

  // The right button deletes, sweeping; on nothing, it deselects. With Alt: play from there. Twice: the Mute tool (FL's).
  if (e.button === 2) {
    if (e.altKey) return playFrom(snapTick(tick0, p.grid, "cell"));
    if (isDoubleRight(e)) return playlist.setTool("mute");
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
    // A click on a clip selects it (Shift: in or out of the selection); a drag, from anywhere, is a rectangle.
    const click = () => {
      if (!hit) return e.shiftKey ? undefined : deselect();
      const next = new Set(e.shiftKey ? p.selected : []);
      if (e.shiftKey && next.has(hit.clip.id)) next.delete(hit.clip.id);
      else next.add(hit.clip.id);
      usePlaylist.getState().select(next);
    };
    show(element, "crosshair");
    startGridDrag(e, element, {
      threshold: 3,
      onMove(ev) {
        const q = at(ev);
        usePlaylist.getState().setDrag({ kind: "rect", from: tick0, to: q.tick, top: track0, bottom: q.track, add: e.shiftKey });
      },
      onEnd: commitDrag,
      onClick: click,
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
    const sweep = sweeper(element, p, e);
    startGridDrag(e, element, {
      threshold: 0,
      onMove(ev) {
        let changed = false;
        for (const clip of sweep(ev)) {
          if (swept.has(clip.id)) continue;
          swept.add(clip.id);
          changed = true;
        }
        if (changed) usePlaylist.getState().setDrag({ kind: "mute", ids: new Set(swept), muted });
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
    // An audio clip's fade, curve or gain handle (FL's).
    if (hit.handle) return dragHandle(e, element, clip, hit.handle, ids, tick0, q0.y, gridOf, at);
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

/**
 * The zoom tool (FL's Z, `docs/fl-studio/playlist.md`): a rectangle dragged is what the view zooms to
 * (its time across, its top track at the top); a click zooms out about the pointer; a right-click goes
 * back to the view before the last zoom in, and again forth.
 */
function zoomTool(e: Press, tick0: number, track0: number, x0: number, at: (ev: PointerEvent) => { tick: number; track: number }) {
  const playlist = usePlaylist.getState();
  const { view } = playlist;
  const back = () => playlist.zoomBack && usePlaylist.setState({ view: playlist.zoomBack, zoomBack: view });
  const ctrl = e.ctrlKey || e.metaKey;
  if (e.button === 2 && !ctrl) return void back();
  startPointerDrag(e, {
    button: e.button === 2 ? 2 : 0,
    threshold: 3,
    cursor: "zoom-in",
    onMove(ev) {
      const q = at(ev);
      usePlaylist.getState().setDrag({ kind: "zoom", from: tick0, to: q.tick, top: track0, bottom: q.track });
    },
    onEnd() {
      const drag = usePlaylist.getState().drag;
      const p = playlistContext();
      usePlaylist.setState({ drag: null });
      if (drag?.kind !== "zoom" || !p) return;
      const zoomed = zoomToRange(view, Math.min(drag.from, drag.to), Math.max(drag.from, drag.to), usePlaylist.getState().gridWidth, zoomFloor());
      usePlaylist.setState({ zoomBack: view, view: { ...zoomed, scrollY: p.layout[Math.min(drag.top, drag.bottom)] ?? zoomed.scrollY } });
    },
    onClick: () => (e.button === 2 ? void back() : usePlaylist.setState({ zoomBack: view, view: zoomAt(view, x0, view.pxPerTick / 2, zoomFloor()) })),
    onCancel: cancelDrag,
  });
}

/** Decibels a pixel of a gain handle's drag moves it, and below which it's silent. */
const DB_PER_PX = 0.2;
const SILENT_DB = -48;
/** How much of a curve's tension a pixel of its handle's drag moves. */
const TENSION_PER_PX = 1 / 60;

const toDb = (gain: number) => (gain > 0 ? 20 * Math.log10(gain) : SILENT_DB);

/**
 * An audio clip's handle dragged (FL's clip fades and gain): a fade's corner along the clip (on the
 * snap, Alt to bypass it), a curve's middle up and down (bending it), the gain up and down (in dB, to
 * +36; down past -48 is silent). The clips selected with it change alike.
 */
function dragHandle(
  e: Press,
  element: HTMLElement,
  clip: PlaylistClip,
  handle: ClipHandle,
  ids: ReadonlySet<number>,
  tick0: number,
  y0: number,
  gridOf: (ev: { altKey: boolean }) => number,
  at: (ev: PointerEvent) => { x: number; y: number; tick: number },
) {
  const p = playlistContext();
  if (!p) return;
  const length = clipLength(clip, p.ctx);
  const end = clipEnd(clip, p.ctx);
  const vertical = handle === "gain" || handle === "fadeInTension" || handle === "fadeOutTension";
  show(element, vertical ? "ns-resize" : RESIZE_CURSOR);
  startGridDrag(e, element, {
    threshold: 1,
    cursor: vertical ? "ns-resize" : "ew-resize",
    onMove(ev) {
      const q = at(ev);
      const set = usePlaylist.getState().setDrag;
      if (handle === "fadeIn") {
        const to = snapTick(clip.start + (clip.fadeIn ?? 0) + q.tick - tick0, gridOf(ev), "line");
        return set({ kind: "fade", ids, patch: { fadeIn: Math.max(0, Math.min(length, to - clip.start)) } });
      }
      if (handle === "fadeOut") {
        const to = snapTick(end - (clip.fadeOut ?? 0) + q.tick - tick0, gridOf(ev), "line");
        return set({ kind: "fade", ids, patch: { fadeOut: Math.max(0, Math.min(length, end - to)) } });
      }
      const up = y0 - q.y;
      if (handle === "gain") {
        const db = Math.min(20 * Math.log10(MAX_CLIP_GAIN), toDb(clip.gain ?? 1) + up * DB_PER_PX);
        return set({ kind: "gain", ids, gain: db <= SILENT_DB ? 0 : 10 ** (db / 20) });
      }
      const key = handle === "fadeInTension" ? "fadeInTension" : "fadeOutTension";
      const tension = Math.max(-1, Math.min(1, (clip[key] ?? 0) + up * TENSION_PER_PX));
      set({ kind: "fade", ids, patch: { [key]: Math.round(tension * 100) / 100 } });
    },
    onEnd: commitDrag,
    onClick: cancelDrag,
    onCancel: cancelDrag,
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
  if (tool === "zoom") return "zoom-in";
  const q = local(element, ev);
  const hit = hitClip(p.clips, p.ctx, p.layout, view, q.x, q.y, p.selected);
  if (hit?.menu) return "pointer";
  const onCurve = hit?.clip.kind === "automation" && (tool === "draw" || tool === "paint") && (!hit.edge || onCurvePoint(p, view, hit.clip, q.x, q.y)) ? curveCursor(p, view, hit.clip, q.x, q.y) : null;
  if (onCurve) return onCurve;
  if (tool === "slip") return hit ? RESIZE_CURSOR : "default";
  if (tool === "select") return hit ? "pointer" : "default";
  if (hit?.handle) return hit.handle === "fadeIn" || hit.handle === "fadeOut" ? RESIZE_CURSOR : "ns-resize";
  if (hit) return hit.edge ? (usePlaylist.getState().stretch && hit.clip.kind === "audio" ? STRETCH_CURSOR : RESIZE_CURSOR) : MOVE_CURSOR;
  return tool === "paint" ? CURSORS.brush : CURSORS.pencil;
}

/** The automation point under the pointer (the draw and paint tools), drawn larger with its value. */
export function trackCurveHover(element: HTMLElement, ev: { clientX: number; clientY: number } | null) {
  const playlist = usePlaylist.getState();
  let next: { automationId: string; index: number } | null = null;
  const p = ev && (playlist.tool === "draw" || playlist.tool === "paint") ? playlistContext() : null;
  if (p && ev) {
    const q = local(element, ev);
    const hit = hitClip(p.clips, p.ctx, p.layout, playlist.view, q.x, q.y, p.selected);
    if (hit?.clip.kind === "automation" && !hit.menu) next = curveHoverAt(p, playlist.view, hit.clip, q.x, q.y);
  }
  const was = playlist.curveHover;
  if (next?.automationId !== was?.automationId || next?.index !== was?.index) usePlaylist.setState({ curveHover: next });
}

/** Where the pointer last was over the tracks (null once it left): what Insert slices. */
let hovered: { element: Element; clientX: number; clientY: number } | null = null;

/** FL's Insert: slice the clip under the pointer at the grid line nearest it (one undo step). */
export function sliceUnderPointer() {
  const p = playlistContext();
  if (!p || !hovered?.element.isConnected) return;
  const { view } = usePlaylist.getState();
  const q = local(hovered.element, hovered);
  const hit = hitClip(p.clips, p.ctx, p.layout, view, q.x, q.y, p.selected);
  if (!hit) return;
  const tick = snapTick(xToTick(view, q.x), p.grid, "line");
  useMusic.getState().commit((song) => editClips(song, (clips, ctx) => sliceClips(clips, tick, hit.clip.track, hit.clip.track, ctx, new Set([hit.clip.id])).clips));
}

/** With the slice tool and Shift held, its line shows where a press would cut: every track, the whole height. */
export function trackSliceHover(element: Element, ev: { clientX: number; clientY: number; altKey: boolean; shiftKey: boolean } | null) {
  hovered = ev && { element, clientX: ev.clientX, clientY: ev.clientY };
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
  // A time marker (in the band along the ruler's bottom): dragged along it, clicked to play from it, its
  // menu on a right-click, renamed with a double-click.
  const q = local(element, e);
  const marker = markerAt(markersOf(p.song), view, q.x, q.y, element.clientHeight);
  if (marker) {
    const x = Math.max(0, (marker.tick - view.scrollTick) * view.pxPerTick);
    if (e.button === 2) return usePlaylist.setState({ markerMenu: { id: marker.id, x } });
    if (e.button !== 0) return;
    if (isDouble(e)) return usePlaylist.setState({ renamingMarker: { id: marker.id, x } });
    startPointerDrag(e, {
      threshold: 3,
      cursor: "ew-resize",
      onMove: (ev) => usePlaylist.getState().setDrag({ kind: "marker", id: marker.id, tick: Math.max(0, marker.tick + tickAt(ev) - tickAt(e)) }),
      onEnd: commitDrag,
      onClick: () => useTransport.getState().jumpSongTo(marker.tick),
      onCancel: cancelDrag,
    });
    return;
  }
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
