/**
 * Beat sync from the timeline's menus: a song's beats as markers on its clip (the server
 * listens to it), and the selected clips cut to the markers.
 */
import { toast } from "sonner";
import { type BeatMarks, beatMarkerCount, beatMarks, cutToMarkers, setBeatMarkers } from "@shared/beat-sync";
import { isRemapped } from "@shared/effects";
import { errorMessage } from "@shared/errors";
import { clipSourceRange, getClip } from "@shared/timeline";
import { api } from "@/lib/api";
import { useEditor } from "./editor";

/** Listen to a clip's music and mark its beats, bars or drops on it (in place of the beat markers it had). */
export async function markBeats(clipId: string, which: BeatMarks) {
  const editor = useEditor.getState();
  const clip = getClip(editor.project, clipId);
  const asset = clip && editor.getAsset(clip.assetId);
  if (!clip || !asset?.hasAudio || isRemapped(clip)) return;
  const listening = toast.loading("Listening for the beat…", { description: asset.name });
  try {
    const music = await api.analyseMusic(asset.id, { from: clip.in, to: clip.out });
    const marks = beatMarks(music, which);
    if (!marks.length) {
      toast.error(which === "drops" ? "No drops found" : "No steady beat found", { id: listening, description: "Add markers by hand with M while it plays." });
      return;
    }
    // (The clip may have been edited or deleted while the server listened.)
    useEditor.getState().commit((p) => setBeatMarkers(p, clipId, marks));
    toast.success(music.bpm ? `${Math.round(music.bpm)} BPM` : "Marked", { id: listening, description: `${marks.length} markers on the clip. Clips and keyframes snap to them.` });
  } catch (e) {
    toast.error("Couldn't find the beat", { id: listening, description: errorMessage(e) });
  }
}

/** Remove the beat markers of these clips (markers the user added stay). */
export function clearBeats(clipIds: readonly string[]) {
  useEditor.getState().commit((p) => clipIds.reduce((q, id) => setBeatMarkers(q, id, []), p));
}

/** Whether any of these clips has beat markers. */
export const hasBeats = (clipIds: readonly string[]) => {
  const project = useEditor.getState().project;
  return clipIds.some((id) => beatMarkerCount(getClip(project, id) ?? {}) > 0);
};

/** Cut the selected clips to the markers: each ends on the nearest one, or on every Nth. */
export function cutSelectionToMarkers(every?: number) {
  const editor = useEditor.getState();
  let moved = 0;
  editor.commit((p) => {
    const cut = cutToMarkers(p, editor.selectedClipIds, { every, range: (clip) => clipSourceRange(clip, editor.getAsset(clip.assetId)) });
    moved = cut.moved;
    return cut.project;
  });
  if (!moved) toast("Nothing to cut", { description: "The clips already end on markers, or there are no markers near them. Mark a song's beats first." });
}
