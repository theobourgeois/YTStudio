/**
 * A click on the canvas asked for by a window (Camera Raw's white balance eyedropper): while a handler is set, a
 * press on the canvas is given to it as a document point instead of the active tool.
 */
import { create } from "zustand";

export interface CanvasPick {
  handler: ((x: number, y: number) => void) | null;
  set: (handler: CanvasPick["handler"]) => void;
}

export const useCanvasPick = create<CanvasPick>((set) => ({ handler: null, set: (handler) => set({ handler }) }));
