/**
 * Edits from controls that only say "changed" (a dial, a gradient's or contour's editor, a picker), as undo steps
 * the way a person means them: changes made while a pointer is held are one step, ended when it's let go; any other
 * (a key, a menu's choice) is a step of its own. Properties uses it where the Layer Style window's controls, made
 * for a window that's one gesture, are shown on their own.
 */
import type { PhotoProject } from "@shared/photo/types";
import { addWindowListener, whenPointerReleased } from "@/lib/window-events";
import { photoGesture } from "../store";

let held = false;
let listening = false;

/** Whether a pointer is down anywhere in the editor's windows (followed from the first edit on). */
function listen() {
  if (listening) return;
  listening = true;
  addWindowListener("pointerdown", () => (held = true), true);
  addWindowListener("pointerup", () => (held = false), true);
  addWindowListener("pointercancel", () => (held = false), true);
}

export function liveEdit() {
  listen();
  const gesture = photoGesture();
  return (update: (doc: PhotoProject) => PhotoProject) => {
    if (!gesture.active) {
      gesture.begin();
      if (held) whenPointerReleased(() => gesture.active && gesture.end());
    }
    gesture.apply(update);
    if (!held) gesture.end();
  };
}
