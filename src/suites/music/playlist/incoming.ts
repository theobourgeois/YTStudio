/**
 * Audio files dragged over the Playlist (from the Browser or the Finder), shown where they'd land before
 * they're dropped, as the Picker's patterns are: see-through clips, named after their files and as long
 * as them once that's known (a Browser file's length comes with its waveform; the Finder's files can't
 * be read until they're dropped, so they show a bar each).
 */
import { loadPeaks } from "../browser/waveform";
import { sampleName } from "../browser/drops";
import { usePlaylist } from "./store";

export interface IncomingFile {
  name: string;
  /** Its length, once known. */
  seconds: number | null;
}

/** Each Browser file's length in seconds, once read. */
const lengths = new Map<string, number | "loading">();

/** What a drag of these Browser files (or `count` Finder files) would add at `start` on `track`. */
export function showIncoming(paths: readonly string[] | null, count: number, start: number, track: number, after: boolean) {
  const files: IncomingFile[] = paths
    ? paths.map((path) => ({ name: sampleName(path.split(/[\\/]/).pop() ?? path), seconds: lengthOf(path) }))
    : Array.from({ length: Math.max(1, count) }, () => ({ name: "Audio", seconds: null }));
  const now = usePlaylist.getState().incoming;
  const same = now && now.start === start && now.track === track && now.after === after && now.files.length === files.length && now.files.every((f, i) => f.seconds === files[i].seconds);
  if (!same) usePlaylist.setState({ incoming: { start, track, after, files } });
}

export const clearIncoming = () => usePlaylist.getState().incoming && usePlaylist.setState({ incoming: null });

function lengthOf(path: string): number | null {
  const known = lengths.get(path);
  if (typeof known === "number") return known;
  if (!known) {
    lengths.set(path, "loading");
    loadPeaks(path).then(
      (peaks) => {
        lengths.set(path, peaks.duration);
        // Still being dragged: shown at its length now.
        const incoming = usePlaylist.getState().incoming;
        if (incoming) usePlaylist.setState({ incoming: { ...incoming, files: incoming.files.map((f) => ({ ...f })) } });
      },
      () => lengths.delete(path),
    );
  }
  return null;
}
