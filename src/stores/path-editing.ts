/**
 * Editing a Bézier path on the Program monitor: which path shows its points (a mask's or
 * a shape's Path parameter of the selected clip), which of its vertices are selected, and
 * whether the pen is still drawing it (each click then adds a vertex).
 */
import { create } from "zustand";
import { keyframeTime } from "@shared/animation";
import { effectDefinition, paramSpec, setParams, storedValuesAt } from "@shared/effects";
import { isPath } from "@shared/params";
import { type BezierPath, removeVertices } from "@shared/path";
import { getClip, sourceTime } from "@shared/timeline";
import type { Project } from "@shared/types";
import { useEditor } from "./editor";
import { usePlayback } from "./playback";

/** A path parameter of one of a clip's effects. */
export interface PathTarget {
  clipId: string;
  effectId: string;
  key: string;
}

interface PathEditingState {
  target: PathTarget | null;
  /** Indices of the selected vertices. */
  selected: number[];
  /** The pen is drawing this path: clicks add vertices to its end until it's closed or finished. */
  drawing: boolean;
  /** Show a path's points (or with null, none). */
  edit: (target: PathTarget | null, opts?: { drawing?: boolean; selected?: number[] }) => void;
  select: (indices: number[]) => void;
  /** The pen is done with the path (it stays shown). */
  finishDrawing: () => void;
}

export const sameTarget = (a: PathTarget | null, b: PathTarget | null) =>
  a === b || (!!a && !!b && a.clipId === b.clipId && a.effectId === b.effectId && a.key === b.key);

export const usePathEditing = create<PathEditingState>((set, get) => ({
  target: null,
  selected: [],
  drawing: false,
  edit(target, opts = {}) {
    if (sameTarget(target, get().target) && opts.drawing === undefined && opts.selected === undefined) return;
    set({ target, selected: opts.selected ?? [], drawing: !!target && !!opts.drawing });
  },
  select(selected) {
    set({ selected });
  },
  finishDrawing() {
    if (get().drawing) set({ drawing: false });
  },
}));

/** The path a target holds at the playhead (undefined when the clip, effect or parameter is gone). */
export function pathOf(project: Project, target: PathTarget, playhead: number): BezierPath | undefined {
  const clip = getClip(project, target.clipId);
  const effect = clip?.effects.find((e) => e.id === target.effectId);
  const def = effect && effectDefinition(effect.type);
  if (!clip || !effect || !def || paramSpec(def, target.key)?.kind !== "path") return undefined;
  const value = storedValuesAt(def, effect, sourceTime(clip, playhead))[target.key];
  return isPath(value) ? value : undefined;
}

/** An edit that sets a target's path (keyframing it at the playhead when it's animated). */
export function writePath(target: PathTarget, path: BezierPath): (p: Project) => Project {
  const t = usePlayback.getState().time;
  return (p) => {
    const clip = getClip(p, target.clipId);
    if (!clip) return p;
    return setParams(p, target.clipId, target.effectId, { [target.key]: path }, keyframeTime(clip, t, p.settings.fps));
  };
}

/** Delete the selected vertices of the path being edited (⌫). False when there were none. */
export function deleteSelectedVertices(): boolean {
  const { target, selected } = usePathEditing.getState();
  if (!target || !selected.length) return false;
  const path = pathOf(useEditor.getState().project, target, usePlayback.getState().time);
  if (!path) return false;
  const next = removeVertices(path, selected);
  // A path needs a point to be anything.
  if (next.vertices.length === 0) return false;
  useEditor.getState().commit(writePath(target, next));
  usePathEditing.getState().select([]);
  return true;
}
