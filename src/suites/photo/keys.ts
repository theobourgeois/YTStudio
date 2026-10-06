/**
 * The photo editor's keys (ux.md, "Keys"), pure so they're tested: what a key press means, or null when it isn't
 * the editor's. Photoshop's where it has one; the app's own keys (⌘W, ⌘, …) are left alone.
 */
import type { PhotoTool } from "./ui";

export type PhotoKeyAction =
  | { type: "tool"; tool: PhotoTool }
  | { type: "undo" }
  | { type: "redo" }
  | { type: "fit" }
  | { type: "actual" }
  | { type: "zoom"; factor: number }
  | { type: "nudge"; dx: number; dy: number }
  | { type: "delete" }
  | { type: "duplicate" }
  | { type: "export" }
  | { type: "snap" }
  | { type: "save" }
  | { type: "deselect" };

export interface KeyPress {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
}

export function resolvePhotoKey(e: KeyPress, mac: boolean): PhotoKeyAction | null {
  const mod = mac ? e.metaKey : e.ctrlKey;
  const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  if (mod) {
    if (key === "z") return e.shiftKey ? { type: "redo" } : { type: "undo" };
    if (key === "y" && !mac) return { type: "redo" };
    if (e.altKey) return null;
    if (key === "0") return { type: "fit" };
    if (key === "1") return { type: "actual" };
    if (key === "=" || key === "+") return { type: "zoom", factor: 2 };
    if (key === "-") return { type: "zoom", factor: 0.5 };
    if (key === "j" && !e.shiftKey) return { type: "duplicate" };
    if (key === "e" && e.shiftKey) return { type: "export" };
    // Photoshop's View › Snap (⇧⌘;). Shift turns ";" into ":" on some layouts.
    if ((key === ";" || key === ":") && e.shiftKey) return { type: "snap" };
    if (key === "s" && !e.shiftKey) return { type: "save" };
    if (key === "d" && !e.shiftKey) return { type: "deselect" };
    return null;
  }
  if (e.ctrlKey || e.metaKey || e.altKey) return null;
  const step = e.shiftKey ? 10 : 1;
  switch (key) {
    case "v":
      return { type: "tool", tool: "move" };
    case "h":
      return { type: "tool", tool: "hand" };
    case "z":
      return { type: "tool", tool: "zoom" };
    case "ArrowLeft":
      return { type: "nudge", dx: -step, dy: 0 };
    case "ArrowRight":
      return { type: "nudge", dx: step, dy: 0 };
    case "ArrowUp":
      return { type: "nudge", dx: 0, dy: -step };
    case "ArrowDown":
      return { type: "nudge", dx: 0, dy: step };
    case "Delete":
    case "Backspace":
      return { type: "delete" };
    default:
      return null;
  }
}
