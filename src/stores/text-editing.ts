/**
 * Typing into a text clip on the canvas. A session starts when a text is
 * created with the Type tool or double-clicked, and ends when the text loses
 * focus or on Escape. The whole session (including creating the clip) is one
 * undo step, and a text left empty is removed, like in Photoshop.
 */
import { create } from "zustand";
import type { Vec2 } from "@shared/types";
import { MOTION, TEXT, isTextClip, setParams, textEffects, textStyleAt } from "@shared/effects";
import { addTextClip, createId, getClip, removeClips } from "@shared/timeline";
import { roundTime } from "@shared/math";
import { EditGesture } from "@/lib/edit-gesture";
import { useEditor } from "./editor";
import { useLayout } from "./layout";
import { usePlayback } from "./playback";
import { newLayerDuration } from "./video-preferences";
import { showPanel } from "./video-dock";

interface TextEditingState {
  /** The text clip being typed into, if any. */
  clipId: string | null;
}

export const useTextEditing = create<TextEditingState>(() => ({ clipId: null }));

let session: { clipId: string; gesture: EditGesture; created: boolean } | null = null;

/** Start typing into an existing text clip. */
export function editText(clipId: string) {
  const clip = getClip(useEditor.getState().project, clipId);
  if (!clip || !isTextClip(clip) || session?.clipId === clipId) return;
  finishTextEditing();
  usePlayback.getState().pause();
  const gesture = new EditGesture();
  gesture.begin();
  begin(clipId, gesture, false);
}

/** Add a text clip at the playhead with its centre at `position` (fractions of the canvas), and start typing. */
export function createText(position: Vec2) {
  finishTextEditing();
  const playback = usePlayback.getState();
  playback.pause();
  const effects = textEffects().map((e) =>
    e.type === MOTION.type ? { ...e, params: { ...e.params, position } } : e,
  );
  const clip = { id: createId("clip"), assetId: "", start: roundTime(playback.time), in: 0, out: newLayerDuration(), effects };
  const gesture = new EditGesture();
  gesture.begin();
  gesture.apply((p) => addTextClip(p, clip).project);
  useLayout.getState().setTool("select");
  begin(clip.id, gesture, true);
}

function begin(clipId: string, gesture: EditGesture, created: boolean) {
  session = { clipId, gesture, created };
  useEditor.getState().select(clipId);
  showPanel("properties");
  useTextEditing.setState({ clipId });
}

/** Replace the text being typed into. */
export function typeText(text: string) {
  if (!session) return;
  const { clipId, gesture } = session;
  gesture.apply((p) => setParams(p, clipId, TEXT.type, { text }));
}

/** Stop typing: keep the text (one undo step), or drop it when it was left empty. */
export function finishTextEditing() {
  if (!session) return;
  const { clipId, gesture, created } = session;
  session = null;
  useTextEditing.setState({ clipId: null });
  const clip = getClip(useEditor.getState().project, clipId);
  const empty = !!clip && textStyleAt(clip, clip.in).text.trim() === "";
  if (!empty) return gesture.end();
  // A text created in this session never existed as far as undo is concerned.
  if (created && gesture.active) return gesture.cancel();
  gesture.apply((p) => removeClips(p, [clipId]));
  gesture.end();
}
