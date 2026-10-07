/**
 * The photo editor's keys (ux.md, "Keys"), pure so they're tested: what a key press means, or null when it isn't
 * the editor's. Photoshop's where it has one; the app's own keys (⌘W, ⌘, …) are left alone.
 */
import { blendModeForKey } from "@shared/photo/blending";
import type { Orientation } from "@shared/photo/orient";
import type { BlendMode } from "@shared/photo/types";
import type { PhotoTool, ToolGroup } from "./tool-groups";

export type PhotoKeyAction =
  | { type: "tool"; tool: PhotoTool }
  /**
   * M, L, W, E, G, O, U: a group's tool (the Marquees, the Lassos, Quick Selection and the Magic Wand, the Erasers,
   * the Gradient and the Paint Bucket, Dodge, Burn and Sponge, the shapes); with Shift, the next of it.
   */
  | { type: "toolGroup"; group: ToolGroup; cycle: boolean }
  /** ⇧⌘I: Select › Inverse. */
  | { type: "inverse" }
  /** ⇧F6: Select › Modify › Feather. */
  | { type: "feather" }
  | { type: "undo" }
  /** ⌃⌘F (Ctrl+Alt+F elsewhere): Filter › Last Filter, Photoshop's. */
  | { type: "lastFilter" }
  /** ⇧⌘A: Filter › Camera Raw Filter…, Photoshop's. */
  | { type: "cameraRaw" }
  /** ⌘U: Image › Adjustments › Hue/Saturation…, Photoshop's. */
  | { type: "hueSaturation" }
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
  | { type: "deselect" }
  /** Every layer (⌥⌘A). */
  | { type: "selectAll" }
  /** The next layer up or down (⌥] / ⌥[), or added to the selection (with Shift). */
  | { type: "step"; direction: 1 | -1; add: boolean }
  /** The top or bottom layer (⌥. / ⌥,), or the selection run out to it (with Shift). */
  | { type: "edge"; to: "top" | "bottom"; add: boolean }
  /** The selected layers one place up or down (⌘] / ⌘[: Bring Forward, Send Backward). */
  | { type: "shift"; direction: 1 | -1 }
  /** Merge Down, or Merge Layers with several selected (⌘E). */
  | { type: "merge" }
  /** ⌘A: select the whole canvas. */
  | { type: "selectCanvas" }
  /** ⇧⌘N: a new, empty pixel layer. */
  | { type: "newLayer" }
  /** [ and ]: the brush smaller or bigger; with Shift, softer or harder. */
  | { type: "brushSize"; direction: 1 | -1 }
  | { type: "brushHardness"; direction: 1 | -1 }
  /** D: black and white; X: swapped. */
  | { type: "defaultColours" }
  | { type: "swapColours" }
  /** ⌘C / ⌘X: the active layer's pixels inside the selection put aside (⌘V pastes them: the page's paste event). */
  | { type: "copy" }
  | { type: "cut" }
  /** ⇧⌘J: Layer via Cut (⌘J with a selection is Layer via Copy, the "duplicate" key). */
  | { type: "layerViaCut" }
  /** ⌥⌫ / ⌘⌫: fill the selection with the foreground / background colour. */
  | { type: "fill"; colour: "foreground" | "background" }
  /** ⇧⌫: Content-Aware Fill, the selection filled from what's around it (Photoshop's Fill opens on Content-Aware). */
  | { type: "contentAwareFill" }
  /** ⇧⌥ + a letter: the selected layers' blend mode (Photoshop's letters: M Multiply, S Screen, O Overlay…). */
  | { type: "blendMode"; mode: BlendMode }
  /** ⇧+ / ⇧−: the next or previous blend mode in the menu. */
  | { type: "stepBlendMode"; direction: 1 | -1 }
  /** ⌘H / ⌥⌘H: the selected layers flipped horizontally / vertically (Edit › Transform; Théo's keys, not Photoshop's). */
  | { type: "orient"; orientation: Orientation }
  /** ⌘T: Edit › Free Transform. */
  | { type: "freeTransform" };

/** Photoshop's letters for the tool groups. */
const GROUP_KEYS: Record<string, ToolGroup> = { m: "marquee", l: "lasso", w: "wand", e: "eraser", g: "fill", o: "toning", u: "shape" };

export interface KeyPress {
  key: string;
  /** The physical key: with ⌥, a Mac's `key` is another character ("“" for ⌥[), so those go by it. */
  code?: string;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
}

export function resolvePhotoKey(e: KeyPress, mac: boolean): PhotoKeyAction | null {
  const mod = mac ? e.metaKey : e.ctrlKey;
  const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  const code = e.code ?? "";
  const is = (k: string, c: string) => code === c || (!code && key === k);
  if (mod && e.altKey && !e.shiftKey && is("a", "KeyA")) return { type: "selectAll" };
  if (mod && e.shiftKey && !e.altKey && is("a", "KeyA")) return { type: "cameraRaw" };
  if (mod && !e.shiftKey && !(mac ? e.ctrlKey : e.metaKey) && is("h", "KeyH")) return { type: "orient", orientation: e.altKey ? "flip-vertical" : "flip-horizontal" };
  if (mod && (mac ? e.ctrlKey && !e.altKey : e.altKey) && !e.shiftKey && is("f", "KeyF")) return { type: "lastFilter" };
  const erasing = key === "Backspace" || key === "Delete";
  if (erasing && e.altKey && !mod && !e.shiftKey) return { type: "fill", colour: "foreground" };
  if (erasing && mod && !e.altKey && !e.shiftKey) return { type: "fill", colour: "background" };
  if (erasing && e.shiftKey && !mod && !e.altKey && !e.ctrlKey && !e.metaKey) return { type: "contentAwareFill" };
  // Photoshop's Layers keys with ⌥ and no ⌘: through the stack.
  if (e.altKey && !mod && !(mac ? e.ctrlKey : e.metaKey)) {
    if (is("]", "BracketRight")) return { type: "step", direction: 1, add: e.shiftKey };
    if (is("[", "BracketLeft")) return { type: "step", direction: -1, add: e.shiftKey };
    if (is(".", "Period")) return { type: "edge", to: "top", add: e.shiftKey };
    if (is(",", "Comma")) return { type: "edge", to: "bottom", add: e.shiftKey };
    // ⇧⌥ + a letter: a blend mode (by the physical key: ⌥ makes a Mac's letters other characters).
    const letter = /^Key([A-Z])$/.exec(code)?.[1] ?? (!code && /^[a-z]$/.test(key) ? key : null);
    if (e.shiftKey && letter) {
      const mode = blendModeForKey(letter);
      if (mode) return { type: "blendMode", mode };
    }
  }
  if (mod) {
    if (key === "z") return e.shiftKey ? { type: "redo" } : { type: "undo" };
    if (key === "y" && !mac) return { type: "redo" };
    if (e.altKey) return null;
    if (key === "0") return { type: "fit" };
    if (key === "1") return { type: "actual" };
    if (key === "=" || key === "+") return { type: "zoom", factor: 2 };
    if (key === "-") return { type: "zoom", factor: 0.5 };
    if (key === "j") return e.shiftKey ? { type: "layerViaCut" } : { type: "duplicate" };
    if (key === "c" && !e.shiftKey) return { type: "copy" };
    if (key === "x" && !e.shiftKey) return { type: "cut" };
    if (key === "e" && !e.shiftKey) return { type: "merge" };
    if (key === "u" && !e.shiftKey) return { type: "hueSaturation" };
    if (key === "t" && !e.shiftKey) return { type: "freeTransform" };
    // ⇧⌘[ / ⇧⌘] are the app's (tab switching), so Bring to Front and Send to Back are the Layers menu's alone.
    if (!e.shiftKey && is("]", "BracketRight")) return { type: "shift", direction: 1 };
    if (!e.shiftKey && is("[", "BracketLeft")) return { type: "shift", direction: -1 };
    if (key === "e" && e.shiftKey) return { type: "export" };
    // Photoshop's View › Snap (⇧⌘;). Shift turns ";" into ":" on some layouts.
    if ((key === ";" || key === ":") && e.shiftKey) return { type: "snap" };
    if (key === "s" && !e.shiftKey) return { type: "save" };
    if (key === "d" && !e.shiftKey) return { type: "deselect" };
    if (key === "a" && !e.shiftKey) return { type: "selectCanvas" };
    if (key === "i" && e.shiftKey) return { type: "inverse" };
    if (key === "n" && e.shiftKey) return { type: "newLayer" };
    return null;
  }
  if (e.ctrlKey || e.metaKey || e.altKey) return null;
  if (key === "F6" && e.shiftKey) return { type: "feather" };
  const group = GROUP_KEYS[key];
  if (group) return { type: "toolGroup", group, cycle: e.shiftKey };
  const step = e.shiftKey ? 10 : 1;
  // ⇧+ and ⇧− step through the blend modes (Shift turns = into + and - into _).
  if (e.shiftKey && (key === "+" || is("=", "Equal"))) return { type: "stepBlendMode", direction: 1 };
  if (e.shiftKey && (key === "_" || is("-", "Minus"))) return { type: "stepBlendMode", direction: -1 };
  switch (key) {
    case "v":
      return { type: "tool", tool: "move" };
    case "b":
      return { type: "tool", tool: "brush" };
    case "c":
      return { type: "tool", tool: "crop" };
    case "i":
      return { type: "tool", tool: "eyedropper" };
    case "t":
      return { type: "tool", tool: "type" };
    case "d":
      return { type: "defaultColours" };
    case "x":
      return { type: "swapColours" };
    case "[":
    case "{":
      return e.shiftKey ? { type: "brushHardness", direction: -1 } : { type: "brushSize", direction: -1 };
    case "]":
    case "}":
      return e.shiftKey ? { type: "brushHardness", direction: 1 } : { type: "brushSize", direction: 1 };

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
