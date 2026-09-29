/**
 * What the source preview's In/Out act on: a file's own marks (`useSourceMarks`, not part of
 * the video), or, while a subclip is shown, that subclip's range (an edit of the video, undoable).
 * The trimmer, the mark buttons and the shortcuts all go through here.
 */
import { toast } from "sonner";
import { canSubclip, getSubclip, updateSubclip } from "@shared/subclips";
import type { MediaAsset, Subclip } from "@shared/types";
import { SHORTCUT_KEYS } from "@/hooks/shortcuts";
import { EditGesture } from "@/lib/edit-gesture";
import { type MarkSide, type SourceMarks, dragMark, setMark } from "@/lib/source-marks";
import { useEditor } from "@/stores/editor";
import { assetMarkedRange, useSourceMarks } from "@/stores/source-marks";
import { useSourcePreview } from "@/stores/source-preview";

const NO_MARKS: SourceMarks = {};

/** The subclip the source preview shows, or null (a whole file, or the subclip was deleted). */
export function useShownSubclip(): Subclip | null {
  const id = useSourcePreview((s) => s.subclipId);
  return useEditor((s) => (id ? (getSubclip(s.project, id) ?? null) : null));
}

export function shownSubclip(): Subclip | null {
  const id = useSourcePreview.getState().subclipId;
  return id ? (getSubclip(useEditor.getState().project, id) ?? null) : null;
}

/** The In/Out the source preview shows for `assetId`: the subclip's range, or the file's marks. */
export function useShownMarks(assetId: string): SourceMarks {
  const subclip = useShownSubclip();
  const marks = useSourceMarks((s) => s.marks[assetId] ?? NO_MARKS);
  return subclip ? { in: subclip.in, out: subclip.out } : marks;
}

export function shownMarks(assetId: string): SourceMarks {
  const subclip = shownSubclip();
  return subclip ? { in: subclip.in, out: subclip.out } : (useSourceMarks.getState().marks[assetId] ?? NO_MARKS);
}

/** Set a subclip's range from marks (a missing mark is the file's start or end). */
function setSubclipMarks(subclip: Subclip, marks: SourceMarks, duration: number) {
  return (p: Parameters<typeof updateSubclip>[0]) =>
    updateSubclip(p, subclip.id, { in: marks.in ?? 0, out: marks.out ?? duration }, duration);
}

/** Mark In or Out at `time` (the I and O keys, the bracket buttons). */
export function markSource(assetId: string, side: MarkSide, time: number, duration: number) {
  const subclip = shownSubclip();
  if (!subclip) {
    useSourceMarks.getState().mark(assetId, side, time, duration);
    return;
  }
  const marks = setMark({ in: subclip.in, out: subclip.out }, side, time, duration);
  useEditor.getState().commit(setSubclipMarks(subclip, marks, duration));
}

/** Clear the file's marks. A subclip always has its range, so it has none to clear: returns false. */
export function clearSourceMarks(assetId: string): boolean {
  if (shownSubclip()) return false;
  useSourceMarks.getState().clear(assetId);
  return true;
}

/** Dragging a trimmer handle: `move` to each time, then `end` or `cancel` (one undo step for a subclip). */
export function beginMarkDrag(assetId: string, side: MarkSide, duration: number) {
  const subclip = shownSubclip();
  if (!subclip) {
    const before = useSourceMarks.getState().marks[assetId];
    return {
      move: (time: number) => useSourceMarks.getState().drag(assetId, side, time, duration),
      end: () => {},
      cancel: () => useSourceMarks.getState().restore(assetId, before),
    };
  }
  const gesture = new EditGesture();
  gesture.begin();
  // Absolute times from the range it had when the drag began, so nothing accumulates.
  const base = { in: subclip.in, out: subclip.out };
  return {
    move: (time: number) => gesture.apply(setSubclipMarks(subclip, dragMark(base, side, time, duration), duration)),
    end: () => gesture.end(),
    cancel: () => gesture.cancel(),
  };
}

/** Whether the source preview can make a subclip of what it shows (a project's file that plays, not a subclip). */
export function useCanMakeSubclip(asset: MediaAsset): boolean {
  const plain = useSourcePreview((s) => !s.libraryItemId && !s.subclipId);
  const inProject = useEditor((s) => s.assets.some((a) => a.id === asset.id));
  return plain && inProject && canSubclip(asset);
}

/**
 * ⌘U: the file's marked part becomes a subclip in the Media tab, and the marks clear so the
 * next part can be marked while playback carries on. False when the preview can't make one.
 */
export function makeSubclipFromMarks(): boolean {
  const { assetId, libraryItemId, subclipId } = useSourcePreview.getState();
  if (!assetId || libraryItemId || subclipId) return false;
  const editor = useEditor.getState();
  const asset = editor.getAsset(assetId);
  if (!asset || !canSubclip(asset)) return false;
  const range = assetMarkedRange(asset);
  if (!range) {
    toast("Mark the part first", { description: `Press I where it starts and O where it ends, then ${SHORTCUT_KEYS.makeSubclip}.` });
    return true;
  }
  const [id] = editor.makeSubclips(asset.id, [range]);
  const made = id ? useEditor.getState().getSubclip(id) : undefined;
  if (!made) return true;
  useSourceMarks.getState().clear(asset.id);
  toast.success(`Added “${made.name}” to Media`);
  return true;
}
