/**
 * The Piano roll's mouse, FL Studio's way (`docs/fl-studio/piano-roll.md`): what a press on the grid,
 * the ruler, the keyboard or the event editor does, by tool, button and modifier keys. Each drag is a
 * `PianoDrag` in the store while it lasts, and one edit when it's let go (`commitDrag`).
 */
import type { PointerEvent as ReactPointerEvent } from "react";
import { clamp } from "@shared/math";
import { DEFAULT_VELOCITY } from "@shared/music/project";
import { type NewNote, type NotePatch, noteBounds } from "@shared/music/notes";
import type { Note } from "@shared/music/types";
import { startPointerDrag } from "@/lib/pointer-drag";
import { useTransport } from "../transport";
import { commitDrag, cancelDrag, deselect, pianoContext, selectTime } from "./actions";
import { stretchHandle } from "./draw";
import { type PianoView, hitNote, paintStarts, snapDelta, snapTick, tickToX, xToTick, yToPitch } from "./geometry";
import { usePiano } from "./store";

type Press = ReactPointerEvent<HTMLElement>;

const local = (element: Element, ev: { clientX: number; clientY: number }) => {
  const rect = element.getBoundingClientRect();
  return { x: ev.clientX - rect.left, y: ev.clientY - rect.top };
};
/** The pitch a y is at, as a fraction (the slice tool's line isn't on rows). */
const exactPitch = (view: PianoView, y: number) => view.topPitch - y / view.rowHeight + 0.5;

/** Play a key of the channel for as long as it's held, moving to another as the pointer does. */
function holdKey(channelId: string) {
  let held: number | null = null;
  return {
    to(key: number) {
      if (key === held) return;
      const transport = useTransport.getState();
      if (held !== null) transport.preview(channelId, held, false);
      held = key;
      transport.preview(channelId, key, true);
    },
    release() {
      if (held !== null) useTransport.getState().preview(channelId, held, false);
      held = null;
    },
  };
}

/** The notes under a point, for the sweeping tools (erase, mute). */
const noteAt = (notes: readonly Note[], view: PianoView, x: number, y: number) => hitNote(notes, view, x, y)?.note ?? null;

/** The last press, to tell a second one soon after on the same spot: a double-click. (Pointer events don't count clicks.) */
let lastPress = { at: 0, x: 0, y: 0, target: null as EventTarget | null };
const DOUBLE_MS = 400;

/** Whether this press is the second of a double-click on the same element. */
function isDouble(e: Press): boolean {
  const now = performance.now();
  const double = lastPress.target === e.currentTarget && now - lastPress.at < DOUBLE_MS && Math.hypot(e.clientX - lastPress.x, e.clientY - lastPress.y) < 6;
  lastPress = double ? { at: 0, x: 0, y: 0, target: null } : { at: now, x: e.clientX, y: e.clientY, target: e.currentTarget };
  return double;
}

/** When the last right-click on a ghost note was, to tell a double right-click (switch to its channel). */
let lastGhostClick = { at: 0, channel: "" };

export function gridPointerDown(e: Press) {
  const ctx = pianoContext();
  if (!ctx) return;
  const element = e.currentTarget;
  const piano = usePiano.getState();
  const { view, tool } = piano;
  const p = local(element, e);
  const tick0 = xToTick(view, p.x);
  const pitch0 = yToPitch(view, p.y);
  const gridOf = (ev: { altKey: boolean }) => (ev.altKey ? 1 : ctx.grid);
  const at = (ev: PointerEvent) => {
    const q = local(element, ev);
    return { x: q.x, y: q.y, tick: xToTick(view, q.x), pitch: yToPitch(view, q.y) };
  };
  const finish = { onEnd: commitDrag, onClick: commitDrag, onCancel: cancelDrag };

  // The middle button pans, whatever the tool.
  if (e.button === 1) {
    e.preventDefault();
    startPointerDrag(e, {
      button: 1,
      threshold: 0,
      cursor: "grabbing",
      onMove(ev) {
        const q = local(element, ev);
        usePiano.getState().setView({
          ...view,
          scrollTick: Math.max(0, view.scrollTick - (q.x - p.x) / view.pxPerTick),
          topPitch: clamp(view.topPitch + (q.y - p.y) / view.rowHeight, 10, 128),
        });
      },
    });
    return;
  }

  const hit = hitNote(ctx.notes, view, p.x, p.y, ctx.selected);

  // The right button deletes, sweeping; on nothing, it deselects. Twice on a ghost note: to its channel.
  if (e.button === 2) {
    if (!hit && piano.ghosts) {
      const ghost = Object.entries(ctx.pattern.notes).find(([id, notes]) => id !== ctx.channel.id && noteAt(notes, view, p.x, p.y));
      if (ghost) {
        const now = performance.now();
        if (lastGhostClick.channel === ghost[0] && now - lastGhostClick.at < 400) piano.setChannel(ghost[0]);
        lastGhostClick = { at: now, channel: ghost[0] };
        return;
      }
    }
    const erased = new Set<number>(hit ? [hit.note.id] : []);
    piano.setDrag({ kind: "erase", ids: new Set(erased) });
    startPointerDrag(e, {
      button: 2,
      threshold: 0,
      onMove(ev) {
        const q = at(ev);
        const note = noteAt(ctx.notes, view, q.x, q.y);
        if (note && !erased.has(note.id)) {
          erased.add(note.id);
          usePiano.getState().setDrag({ kind: "erase", ids: new Set(erased) });
        }
      },
      onEnd: commitDrag,
      onClick() {
        if (!erased.size) {
          cancelDrag();
          deselect();
        } else commitDrag();
      },
      onCancel: cancelDrag,
    });
    return;
  }
  if (e.button !== 0) return;

  // A double-click on a note: its properties.
  if (isDouble(e) && hit) {
    usePiano.setState({ editing: hit.note.id });
    return;
  }

  // The stretch handle of the selection.
  const bounds = ctx.selected.size > 1 ? noteBounds(ctx.notes, ctx.selected) : null;
  if (bounds) {
    const handle = stretchHandle(view, bounds);
    if (p.x >= handle.x - 2 && p.x <= handle.x + handle.size + 2 && p.y >= handle.y - 2 && p.y <= handle.y + handle.size + 2) {
      const span = bounds.end - bounds.start;
      startPointerDrag(e, {
        threshold: 0,
        cursor: "ew-resize",
        onMove(ev) {
          const end = Math.max(bounds.start + 1, snapTick(at(ev).tick, gridOf(ev), "line"));
          usePiano.getState().setDrag({ kind: "stretch", ids: ctx.selected, factor: (end - bounds.start) / span, anchor: bounds.start });
        },
        ...finish,
      });
      return;
    }
  }

  const selecting = e.ctrlKey || e.metaKey || (tool === "select" && !hit);
  if (selecting) {
    if (hit) {
      // Ctrl+click: this note; with Shift, in or out of the selection.
      const next = new Set(e.shiftKey ? ctx.selected : []);
      if (e.shiftKey && next.has(hit.note.id)) next.delete(hit.note.id);
      else next.add(hit.note.id);
      piano.select(next);
      return;
    }
    startPointerDrag(e, {
      threshold: 3,
      onMove(ev) {
        const q = at(ev);
        usePiano.getState().setDrag({ kind: "rect", from: tick0, to: q.tick, low: pitch0, high: q.pitch, add: e.shiftKey });
      },
      onEnd: commitDrag,
      onClick: () => (e.shiftKey ? undefined : deselect()),
      onCancel: cancelDrag,
    });
    return;
  }

  if (tool === "select" && hit && e.shiftKey) {
    const next = new Set(ctx.selected);
    if (next.has(hit.note.id)) next.delete(hit.note.id);
    else next.add(hit.note.id);
    piano.select(next);
    return;
  }

  if (tool === "delete") {
    const erased = new Set<number>(hit ? [hit.note.id] : []);
    piano.setDrag({ kind: "erase", ids: new Set(erased) });
    startPointerDrag(e, {
      threshold: 0,
      onMove(ev) {
        const q = at(ev);
        const note = noteAt(ctx.notes, view, q.x, q.y);
        if (note && !erased.has(note.id)) {
          erased.add(note.id);
          usePiano.getState().setDrag({ kind: "erase", ids: new Set(erased) });
        }
      },
      ...finish,
    });
    return;
  }

  if (tool === "mute") {
    // The first note says which way: muting, or unmuting what's swept after it.
    const muted = hit ? !hit.note.muted : true;
    const swept = new Set<number>(hit ? [hit.note.id] : []);
    piano.setDrag({ kind: "mute", ids: new Set(swept), muted });
    startPointerDrag(e, {
      threshold: 0,
      onMove(ev) {
        const q = at(ev);
        const note = noteAt(ctx.notes, view, q.x, q.y);
        if (note && !swept.has(note.id)) {
          swept.add(note.id);
          usePiano.getState().setDrag({ kind: "mute", ids: new Set(swept), muted });
        }
      },
      ...finish,
    });
    return;
  }

  if (tool === "slice") {
    const a = { tick: tick0, pitch: exactPitch(view, p.y) };
    startPointerDrag(e, {
      threshold: 0,
      cursor: "crosshair",
      onMove(ev) {
        const q = local(element, ev);
        // Shift: straight down, at the time it started.
        const b = { tick: ev.shiftKey ? tick0 : xToTick(view, q.x), pitch: exactPitch(view, q.y) };
        usePiano.getState().setDrag({ kind: "slice", a, b });
      },
      ...finish,
    });
    return;
  }

  const keys = holdKey(ctx.channel.id);

  // Draw and Paint, on a note: move it (Shift: a copy of it) or, by its right edge, resize it. The
  // selection goes along if the note is in it.
  if (hit) {
    const ids = ctx.selected.has(hit.note.id) ? ctx.selected : new Set([hit.note.id]);
    usePiano.setState({ noteLength: hit.note.length });
    if (hit.edge) {
      const end = hit.note.start + hit.note.length;
      startPointerDrag(e, {
        threshold: 2,
        cursor: "ew-resize",
        onMove(ev) {
          const newEnd = snapTick(end + (at(ev).tick - tick0), gridOf(ev), "line");
          const ticks = Math.max(newEnd, hit.note.start + 1) - end;
          usePiano.setState({ noteLength: hit.note.length + ticks });
          usePiano.getState().setDrag({ kind: "resize", ids, ticks });
        },
        ...finish,
      });
      return;
    }
    const clone = e.shiftKey;
    keys.to(hit.note.pitch);
    startPointerDrag(e, {
      threshold: 2,
      onMove(ev) {
        const q = at(ev);
        // Once it's moving, Shift keeps the pitch and Ctrl keeps the time.
        const ticks = ev.ctrlKey || ev.metaKey ? 0 : snapDelta(q.tick - tick0, gridOf(ev));
        const semitones = ev.shiftKey && !clone ? 0 : q.pitch - pitch0;
        keys.to(hit.note.pitch + semitones);
        usePiano.getState().setDrag({ kind: "move", ids, ticks, semitones, clone });
      },
      onEnd() {
        keys.release();
        commitDrag();
      },
      onClick() {
        keys.release();
        cancelDrag();
      },
      onCancel() {
        keys.release();
        cancelDrag();
      },
    });
    return;
  }

  // On nothing: a new note, as long as the last one touched, at the start of the cell pressed. Draw
  // moves it until it's let go (Shift: drags out its length); Paint lays more along the stroke.
  const length = piano.noteLength;
  const start = snapTick(tick0, gridOf(e), "cell");
  const draft = (note: Partial<NewNote>): NewNote => ({ start, length, pitch: pitch0, velocity: DEFAULT_VELOCITY, ...note });
  piano.setDrag({ kind: "add", notes: [draft({})] });
  keys.to(pitch0);
  const release = () => keys.release();

  if (tool === "paint") {
    startPointerDrag(e, {
      threshold: 0,
      onMove(ev) {
        const q = at(ev);
        const previous = usePiano.getState().drag;
        const pitches = new Map(previous?.kind === "add" ? previous.notes.map((n) => [n.start, n.pitch]) : []);
        // Shift: each note at the pitch the pointer's at as it's laid.
        const notes = paintStarts(tick0, q.tick, length, gridOf(ev)).map((at) => draft({ start: at, pitch: pitches.get(at) ?? (ev.shiftKey ? q.pitch : pitch0) }));
        if (ev.shiftKey) keys.to(q.pitch);
        usePiano.getState().setDrag({ kind: "add", notes });
      },
      onEnd() {
        release();
        commitDrag();
      },
      onClick() {
        release();
        commitDrag();
      },
      onCancel() {
        release();
        cancelDrag();
      },
    });
    return;
  }

  const stretching = e.shiftKey;
  startPointerDrag(e, {
    threshold: 0,
    onMove(ev) {
      const q = at(ev);
      if (stretching) {
        const end = Math.max(start + gridOf(ev), snapTick(q.tick, gridOf(ev), "line"));
        usePiano.setState({ noteLength: end - start });
        usePiano.getState().setDrag({ kind: "add", notes: [draft({ length: end - start })] });
        return;
      }
      keys.to(q.pitch);
      usePiano.getState().setDrag({ kind: "add", notes: [draft({ start: Math.max(0, start + snapDelta(q.tick - tick0, gridOf(ev))), pitch: q.pitch })] });
    },
    onEnd() {
      release();
      commitDrag();
    },
    onClick() {
      release();
      commitDrag();
    },
    onCancel() {
      release();
      cancelDrag();
    },
  });
}

/** The pointer's cursor over the grid: resize on a note's edge, move on a note. */
export function gridCursor(element: HTMLElement, ev: { clientX: number; clientY: number }): string {
  const ctx = pianoContext();
  if (!ctx) return "default";
  const { view, tool } = usePiano.getState();
  const p = local(element, ev);
  if (tool === "slice") return "crosshair";
  if (tool === "delete" || tool === "mute" || tool === "select") return "default";
  const hit = hitNote(ctx.notes, view, p.x, p.y, ctx.selected);
  return hit ? (hit.edge ? "ew-resize" : "move") : "crosshair";
}

/** The ruler: a click sets where play starts; a double-click (or Ctrl) and drag selects a range of time; a right-click clears it. */
export function rulerPointerDown(e: Press) {
  const ctx = pianoContext();
  if (!ctx) return;
  const element = e.currentTarget;
  const { view } = usePiano.getState();
  const tickAt = (ev: { clientX: number; clientY: number; altKey: boolean }) => snapTick(xToTick(view, local(element, ev).x), ev.altKey ? 1 : ctx.grid, "line");
  if (e.button === 2) {
    usePiano.setState({ time: null });
    return;
  }
  if (e.button !== 0) return;
  const start = tickAt(e);
  if (isDouble(e) || e.ctrlKey || e.metaKey) {
    startPointerDrag(e, { threshold: 2, onMove: (ev) => selectTime(start, tickAt(ev)) });
    return;
  }
  useTransport.getState().setStartTick(start);
  startPointerDrag(e, { threshold: 2, onMove: (ev) => useTransport.getState().setStartTick(tickAt(ev)) });
}

/** The keyboard: a key sounds while it's held (sliding to others); Ctrl selects the notes of the keys dragged over. */
export function keysPointerDown(e: Press) {
  const ctx = pianoContext();
  if (!ctx || e.button !== 0) return;
  const element = e.currentTarget;
  const { view } = usePiano.getState();
  const pitchAt = (ev: { clientX: number; clientY: number }) => yToPitch(view, local(element, ev).y);
  const first = pitchAt(e);
  if (e.ctrlKey || e.metaKey) {
    const select = (a: number, b: number) =>
      usePiano.getState().select(ctx.notes.filter((n) => n.pitch >= Math.min(a, b) && n.pitch <= Math.max(a, b)).map((n) => n.id));
    select(first, first);
    startPointerDrag(e, { threshold: 0, onMove: (ev) => select(first, pitchAt(ev)) });
    return;
  }
  const keys = holdKey(ctx.channel.id);
  keys.to(first);
  usePiano.setState({ heldKey: first });
  const release = () => {
    keys.release();
    usePiano.setState({ heldKey: null });
  };
  const started = startPointerDrag(e, {
    threshold: 0,
    onMove(ev) {
      keys.to(pitchAt(ev));
      usePiano.setState({ heldKey: pitchAt(ev) });
    },
    onEnd: release,
    onClick: release,
    onCancel: release,
  });
  if (!started) release();
}

/**
 * The event editor: drag across it to draw each note's value (only the selected notes', if some are);
 * Shift gives every note swept the value it started with; Alt resets them.
 */
export function lanePointerDown(e: Press) {
  const ctx = pianoContext();
  if (!ctx || e.button !== 0) return;
  const element = e.currentTarget;
  const { view, lane } = usePiano.getState();
  const height = element.getBoundingClientRect().height;
  const pad = 6;
  const span = height - pad * 2;
  const valueAt = (y: number): NotePatch =>
    lane === "velocity" ? { velocity: clamp(1 - (y - pad) / span, 0, 1) } : { pan: clamp(((pad + span / 2 - y) / span) * 2, -1, 1) };
  const reset: NotePatch = lane === "velocity" ? { velocity: DEFAULT_VELOCITY } : { pan: 0 };
  const editable = ctx.selected.size ? ctx.notes.filter((n) => ctx.selected.has(n.id)) : ctx.notes;
  const first = local(element, e);
  const fixed = e.altKey ? reset : e.shiftKey ? valueAt(first.y) : null;
  const values = new Map<number, NotePatch>();
  // A note is reached if its start is within a few pixels of the pointer's path.
  const reach = 4 / view.pxPerTick;
  let last = xToTick(view, first.x);
  const sweep = (x: number, y: number) => {
    const tick = xToTick(view, x);
    const from = Math.min(last, tick) - reach;
    const to = Math.max(last, tick) + reach;
    for (const note of editable) {
      if (note.start >= to) break;
      if (note.start >= from) values.set(note.id, fixed ?? valueAt(y));
    }
    last = tick;
    usePiano.getState().setDrag({ kind: "values", values: new Map(values) });
  };
  sweep(first.x, first.y);
  startPointerDrag(e, {
    threshold: 0,
    onMove(ev) {
      const q = local(element, ev);
      sweep(q.x, q.y);
    },
    onEnd: commitDrag,
    onClick: commitDrag,
    onCancel: cancelDrag,
  });
}

/** Where a note starts on screen, for tests and the properties dialog's placing. */
export const noteX = (view: PianoView, note: Note) => tickToX(view, note.start);
