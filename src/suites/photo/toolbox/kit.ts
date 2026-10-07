/**
 * A tool of the strip as the canvas and the options bar see it (`TOOLBOX`): what a press on the canvas does, what's
 * drawn over the canvas while it's the tool, its options and its pointer. The older tools (Move, the selection
 * tools, the Brush and the Eraser, Hand, Zoom) are still branched on in `canvas-panel.tsx` and `options-bar.tsx`;
 * a new tool is a kit, in a file of its own.
 */
import type { ComponentType, PointerEvent as ReactPointerEvent } from "react";

/** A pointer's place on the screen (client pixels) as document pixels. */
export type DocPointOf = (clientX: number, clientY: number) => { x: number; y: number };

export interface ToolKit {
  /** Its options, in the header's options bar. */
  Options?: ComponentType;
  /** A press on the canvas (left button; the right is the canvas's menu, the middle pans). */
  press?: (e: ReactPointerEvent<HTMLDivElement>, docPoint: DocPointOf) => void;
  /** The pointer moving over the canvas with no button down. */
  hover?: (e: ReactPointerEvent<HTMLDivElement>, docPoint: DocPointOf) => void;
  /** Drawn over the canvas while it's the tool (handles, a crop box, a text being typed…). */
  Overlay?: ComponentType<{ docPoint: DocPointOf }>;
  /** The canvas's cursor class while it's the tool (Tailwind's `cursor-*`); absent: a crosshair. */
  cursor?: string;
}
