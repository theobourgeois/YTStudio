/**
 * Dragging on the canvas while the Layer Style window shows a page that has a place (Drop Shadow, Inner Shadow:
 * where the shadow falls; Gradient Overlay: where its centre is), as Photoshop's: the window says what a drag does,
 * the canvas sends it the drag in document pixels.
 */
import { create } from "zustand";

export interface StyleCanvasDrag {
  /** Called with the drag's travel from where it started, in document pixels; `done` when it's let go. */
  handler: ((dx: number, dy: number, done: boolean) => void) | null;
  set: (handler: StyleCanvasDrag["handler"]) => void;
}

export const useStyleCanvasDrag = create<StyleCanvasDrag>((set) => ({ handler: null, set: (handler) => set({ handler }) }));
