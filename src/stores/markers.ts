/**
 * Markers from the keyboard and menus (Premiere's M): adding one at the playhead, jumping
 * between them, and which one has its editor open (its name and colour).
 */
import { create } from "zustand";
import { addClipMarker, addMarker, adjacentMarker, markerAt, removeClipMarkers, removeMarkers } from "@shared/markers";
import { clipEnd, getClip } from "@shared/timeline";
import { useEditor } from "./editor";
import { usePlayback } from "./playback";

/** A marker on the open timeline: the sequence's, or one of a clip's. */
export interface MarkerRef {
  id: string;
  clipId?: string;
}

interface MarkerEditingState {
  /** The marker whose editor (name, colour) is open. */
  editing: MarkerRef | null;
  edit: (ref: MarkerRef | null) => void;
}

export const useMarkerEditing = create<MarkerEditingState>((set) => ({
  editing: null,
  edit: (editing) => set({ editing }),
}));

export const sameMarkerRef = (a: MarkerRef | null, b: MarkerRef | null) => !!a && !!b && a.id === b.id && a.clipId === b.clipId;

/** Half a frame: a marker that close to the playhead is "at" it. */
const near = () => 0.5 / useEditor.getState().project.settings.fps;

/**
 * M: a marker at the playhead, on the selected clip when the playhead is on it (a clip
 * marker, which stays on its frame), else on the sequence. On a marker that's already
 * there, its editor opens instead (as in Premiere).
 */
export function addMarkerAtPlayhead() {
  const editor = useEditor.getState();
  const fps = editor.project.settings.fps;
  const t = Math.round(usePlayback.getState().time * fps) / fps;
  const clipId = editor.selectedClipIds.find((id) => {
    const clip = getClip(editor.project, id);
    return !!clip && t >= clip.start - 1e-6 && t < clipEnd(clip) - 1e-6;
  });
  const made = clipId ? addClipMarker(editor.project, clipId, t, {}, near()) : addMarker(editor.project, t, {}, near());
  if (!made.id) return;
  if (made.project === editor.project) {
    useMarkerEditing.getState().edit({ id: made.id, ...(clipId && { clipId }) });
    return;
  }
  editor.commit(() => made.project);
}

/** ⇧M / ⌘⇧M: move the playhead to the next or previous marker. False when there's none. */
export function goToMarker(direction: -1 | 1): boolean {
  const to = adjacentMarker(useEditor.getState().project, usePlayback.getState().time, direction, near());
  if (!to) return false;
  usePlayback.getState().pause();
  usePlayback.getState().seek(to.time);
  return true;
}

/** ⌥M: delete the marker at the playhead (a selected clip's first). False when there's none. */
export function deleteMarkerAtPlayhead(): boolean {
  const editor = useEditor.getState();
  const at = markerAt(editor.project, usePlayback.getState().time, near(), editor.selectedClipIds);
  if (!at) return false;
  deleteMarker({ id: at.marker.id, clipId: at.clipId });
  return true;
}

export function deleteMarker(ref: MarkerRef) {
  useEditor.getState().commit((p) => (ref.clipId ? removeClipMarkers(p, ref.clipId, [ref.id]) : removeMarkers(p, [ref.id])));
  if (sameMarkerRef(useMarkerEditing.getState().editing, ref)) useMarkerEditing.getState().edit(null);
}
