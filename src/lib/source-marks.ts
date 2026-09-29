/**
 * In and Out points on a media file, set in the source preview before it goes on the
 * timeline (Premiere's Source Monitor marks). Pure, so the store and tests share it.
 */
import { EPS, clamp, roundTime } from "@shared/math";
import { MIN_CLIP_DURATION } from "@shared/timeline";

/** Source seconds. A missing mark means the file's own start or end. */
export interface SourceMarks {
  in?: number;
  out?: number;
}

export type MarkSide = "in" | "out";

/** The part of a file of `duration` its marks select, or null when that's the whole file. */
export function markedRange(marks: SourceMarks | undefined, duration: number): { in: number; out: number } | null {
  if (!marks || !(duration > 0)) return null;
  const inPoint = clamp(marks.in ?? 0, 0, duration);
  const out = clamp(marks.out ?? duration, 0, duration);
  if (out - inPoint < MIN_CLIP_DURATION - EPS) return null;
  if (inPoint <= EPS && out >= duration - EPS) return null;
  return { in: inPoint, out };
}

/**
 * Mark In or Out at `time` (the I and O keys). Like Premiere, a mark set past the
 * other one clears that one rather than leaving an empty range.
 */
export function setMark(marks: SourceMarks | undefined, side: MarkSide, time: number, duration: number): SourceMarks {
  const next: SourceMarks = { ...marks, [side]: roundTime(clamp(time, 0, duration)) };
  const other: MarkSide = side === "in" ? "out" : "in";
  if (next.in !== undefined && next.out !== undefined && next.out - next.in < MIN_CLIP_DURATION - EPS) delete next[other];
  return tidyMarks(next, duration);
}

/** Drag a mark's handle to `time`: it stops short of the other mark instead of clearing it. */
export function dragMark(marks: SourceMarks | undefined, side: MarkSide, time: number, duration: number): SourceMarks {
  const range = side === "in" ? [0, (marks?.out ?? duration) - MIN_CLIP_DURATION] : [(marks?.in ?? 0) + MIN_CLIP_DURATION, duration];
  return tidyMarks({ ...marks, [side]: roundTime(clamp(time, range[0], Math.max(range[0], range[1]))) }, duration);
}

/** A mark at the file's very start or end is no mark at all. */
function tidyMarks(marks: SourceMarks, duration: number): SourceMarks {
  const next = { ...marks };
  if (next.in !== undefined && next.in <= EPS) delete next.in;
  if (next.out !== undefined && next.out >= duration - EPS) delete next.out;
  return next;
}

/** Marks read back from storage, dropping anything that isn't a pair of times. */
export function parseMarks(raw: unknown): Record<string, SourceMarks> {
  const out: Record<string, SourceMarks> = {};
  if (!raw || typeof raw !== "object") return out;
  const time = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : undefined);
  for (const [id, m] of Object.entries(raw as Record<string, unknown>)) {
    if (!m || typeof m !== "object") continue;
    const inPoint = time((m as SourceMarks).in);
    const outPoint = time((m as SourceMarks).out);
    if (inPoint === undefined && outPoint === undefined) continue;
    out[id] = { ...(inPoint !== undefined && { in: inPoint }), ...(outPoint !== undefined && { out: outPoint }) };
  }
  return out;
}
