import { create } from "zustand";
import type { MediaAsset } from "@shared/types";
import { type MarkSide, type SourceMarks, dragMark, markedRange, parseMarks, setMark } from "@/lib/source-marks";

const MARKS_KEY = "editor-source-marks";

/**
 * Each media file's In/Out marks (by asset id, project and Library media alike), set in
 * the source preview. Adding the file to the timeline then uses only the marked part, like
 * Premiere's marks on a clip. Kept in this browser, not in the video: they aren't an edit.
 */
interface SourceMarksState {
  marks: Record<string, SourceMarks>;
  /** Mark In or Out at `time` (see `setMark`). */
  mark: (assetId: string, side: MarkSide, time: number, duration: number) => void;
  /** Move a mark by its handle (see `dragMark`). */
  drag: (assetId: string, side: MarkSide, time: number, duration: number) => void;
  /** Put back marks read earlier (a cancelled drag). */
  restore: (assetId: string, marks: SourceMarks | undefined) => void;
  /** Clear both marks, or one. */
  clear: (assetId: string, side?: MarkSide) => void;
}

function load(): Record<string, SourceMarks> {
  try {
    return parseMarks(JSON.parse(localStorage.getItem(MARKS_KEY) ?? "null"));
  } catch {
    return {};
  }
}

export const useSourceMarks = create<SourceMarksState>((set, get) => {
  const put = (assetId: string, marks: SourceMarks) => {
    const next = { ...get().marks };
    if (marks.in === undefined && marks.out === undefined) delete next[assetId];
    else next[assetId] = marks;
    set({ marks: next });
    localStorage.setItem(MARKS_KEY, JSON.stringify(next));
  };
  return {
    marks: load(),
    mark: (assetId, side, time, duration) => put(assetId, setMark(get().marks[assetId], side, time, duration)),
    drag: (assetId, side, time, duration) => put(assetId, dragMark(get().marks[assetId], side, time, duration)),
    restore: (assetId, marks) => put(assetId, marks ?? {}),
    clear(assetId, side) {
      const marks = get().marks[assetId];
      if (!marks) return;
      if (!side) put(assetId, {});
      else put(assetId, { ...marks, [side]: undefined });
    },
  };
});

/** The part of `asset` its marks select, or null for all of it. */
export function assetMarkedRange(asset: Pick<MediaAsset, "id" | "kind" | "duration">, marks = useSourceMarks.getState().marks) {
  return asset.kind === "image" ? null : markedRange(marks[asset.id], asset.duration);
}
