/**
 * Edit › Free Transform (⌘T), Photoshop's: the selected layers' handles as one session, every drag in it one undo
 * step when it's committed (Enter, or the options bar's tick), all of it put back by Escape. Its mode says what a
 * plain handle drag does (Scale, Skew, Distort, Perspective); the Move tool's modifiers pick one for a drag without a
 * session (⌘ a corner distorts, ⌘ an edge skews, ⌘⌥⇧ a corner is perspective: `dragMode`). Selecting other layers,
 * another tool or another edit commits it, as Photoshop does.
 */
import { create } from "zustand";
import type { TransformMode } from "./canvas/handles";
import { type PhotoGesture, photoGesture, usePhoto } from "./store";
import { usePhotoUi } from "./ui";

interface Session {
  gesture: PhotoGesture;
  mode: TransformMode;
}

export const useFreeTransform = create<{ session: Session | null }>(() => ({ session: null }));

let stopWatching: (() => void) | null = null;

function finish(how: "end" | "cancel") {
  const session = useFreeTransform.getState().session;
  if (!session) return;
  stopWatching?.();
  stopWatching = null;
  useFreeTransform.setState({ session: null });
  if (session.gesture.active) session.gesture[how]();
}

export const freeTransform = {
  /** ⌘T: a session on the selected layers (with the Move tool); false when there's nothing to transform. */
  start(mode: TransformMode = "scale"): boolean {
    const ui = usePhotoUi.getState();
    const doc = usePhoto.getState().history?.doc.doc;
    if (!doc || !ui.selectedLayerIds.some((id) => doc.layers.some((l) => l.id === id && "transform" in l))) return false;
    if (useFreeTransform.getState().session) return true;
    if (ui.tool !== "move") ui.setTool("move");
    const gesture = photoGesture();
    gesture.begin();
    useFreeTransform.setState({ session: { gesture, mode } });
    // What ends it: other layers selected, another tool, or an edit that ended its gesture (that edit's commit).
    const ids = ui.selectedLayerIds;
    const off = [
      usePhotoUi.subscribe((s) => {
        if (s.selectedLayerIds !== ids || s.tool !== "move") freeTransform.commit();
      }),
      usePhoto.subscribe(() => {
        if (!useFreeTransform.getState().session?.gesture.active) finish("end");
      }),
    ];
    stopWatching = () => off.forEach((f) => f());
    return true;
  },
  /** Enter: what the session did, one undo step (nothing if it changed nothing). */
  commit: () => finish("end"),
  /** Escape: the layers as they were before ⌘T. */
  cancel: () => finish("cancel"),
  setMode(mode: TransformMode) {
    const session = useFreeTransform.getState().session;
    if (session) useFreeTransform.setState({ session: { ...session, mode } });
    else freeTransform.start(mode);
  },
};

/** The session's gesture while one is going (a drag in it applies to it instead of making its own). */
export const sessionGesture = (): PhotoGesture | null => {
  const s = useFreeTransform.getState().session;
  return s?.gesture.active ? s.gesture : null;
};
