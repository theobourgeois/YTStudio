/**
 * Pure key -> action mapping for the global editor shortcuts (see `useShortcuts`),
 * plus the labels shown in menus, tooltips and the shortcuts dialog.
 * Kept free of DOM/store access so it can be unit-tested.
 */

export type ShortcutAction =
  | "togglePlay"
  | "play"
  | "pause"
  | "prevFrame"
  | "nextFrame"
  | "back1s"
  | "forward1s"
  | "prevEdit"
  | "nextEdit"
  | "seekStart"
  | "seekEnd"
  | "split"
  | "trimStart"
  | "trimEnd"
  | "delete"
  | "rippleDelete"
  | "cut"
  | "copy"
  | "paste"
  | "duplicate"
  | "addTransition"
  | "nudgeLeft"
  | "nudgeRight"
  | "nudgeLeftMore"
  | "nudgeRightMore"
  | "moveUp"
  | "moveDown"
  | "undo"
  | "redo"
  | "selectAll"
  | "deselect"
  | "zoomIn"
  | "zoomOut"
  | "zoomFit"
  | "toggleSnapping"
  | "toggleSidebar"
  | "showShortcuts";

export type KeyLike = Pick<
  KeyboardEvent,
  "key" | "metaKey" | "ctrlKey" | "shiftKey" | "altKey" | "repeat"
>;

/** Actions that make sense to auto-repeat while a key is held down. */
const REPEATABLE = new Set<ShortcutAction>([
  "undo",
  "redo",
  "prevFrame",
  "nextFrame",
  "back1s",
  "forward1s",
  "prevEdit",
  "nextEdit",
  "nudgeLeft",
  "nudgeRight",
  "nudgeLeftMore",
  "nudgeRightMore",
  "zoomIn",
  "zoomOut",
]);

export function resolveShortcut(e: KeyLike): ShortcutAction | null {
  const action = e.metaKey || e.ctrlKey ? resolveMod(e) : e.altKey ? resolveAlt(e) : resolvePlain(e);
  if (!action || (e.repeat && !REPEATABLE.has(action))) return null;
  return action;
}

/** ⌘ (macOS) or Ctrl combos. */
function resolveMod(e: KeyLike): ShortcutAction | null {
  if (e.altKey || (e.metaKey && e.ctrlKey)) return null;
  const key = e.key.toLowerCase();
  if (key === "z") return e.shiftKey ? "redo" : "undo";
  // Premiere's "Apply Default Transition" is ⌘D, which duplicates here.
  if (e.shiftKey) return key === "d" ? "addTransition" : null;
  switch (key) {
    case "y":
      return "redo";
    case "b":
    case "k":
      return "split";
    case "x":
      return "cut";
    case "c":
      return "copy";
    case "v":
      return "paste";
    case "d":
      return "duplicate";
    case "a":
      return "selectAll";
    case "\\":
      return "toggleSidebar";
  }
  return null;
}

/** Alt/⌥ + arrows: nudge the selection in time, or move it between tracks. */
function resolveAlt(e: KeyLike): ShortcutAction | null {
  switch (e.key) {
    case "ArrowLeft":
      return e.shiftKey ? "nudgeLeftMore" : "nudgeLeft";
    case "ArrowRight":
      return e.shiftKey ? "nudgeRightMore" : "nudgeRight";
    case "ArrowUp":
      return e.shiftKey ? null : "moveUp";
    case "ArrowDown":
      return e.shiftKey ? null : "moveDown";
  }
  return null;
}

/** Keys pressed without ⌘/Ctrl/Alt (Shift only where it's part of the binding). */
function resolvePlain(e: KeyLike): ShortcutAction | null {
  switch (e.key) {
    case "ArrowLeft":
      return e.shiftKey ? "back1s" : "prevFrame";
    case "ArrowRight":
      return e.shiftKey ? "forward1s" : "nextFrame";
    case "ArrowUp":
      return e.shiftKey ? null : "prevEdit";
    case "ArrowDown":
      return e.shiftKey ? null : "nextEdit";
    // `+` needs Shift on most layouts, so Shift is irrelevant for zoom.
    case "=":
    case "+":
      return "zoomIn";
    case "-":
    case "_":
      return "zoomOut";
    // `?` is Shift+/ on most layouts.
    case "?":
      return "showShortcuts";
    case "Backspace":
    case "Delete":
      return e.shiftKey ? "rippleDelete" : "delete";
  }
  if (e.shiftKey) return e.key === "Z" ? "zoomFit" : null;
  switch (e.key.toLowerCase()) {
    case " ":
      return "togglePlay";
    case "k":
      return "pause";
    case "l":
      return "play";
    case "s":
      return "split";
    case "q":
      return "trimStart";
    case "w":
      return "trimEnd";
    case "n":
      return "toggleSnapping";
    case "\\":
      return "zoomFit";
    case "home":
      return "seekStart";
    case "end":
      return "seekEnd";
    case "escape":
      return "deselect";
  }
  return null;
}

export const IS_MAC =
  typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.userAgent);

const MOD = IS_MAC ? "⌘" : "Ctrl+";
const SHIFT = IS_MAC ? "⇧" : "Shift+";
const ALT = IS_MAC ? "⌥" : "Alt+";

/** Human-readable key label per action (the main binding). */
export const SHORTCUT_KEYS: Record<ShortcutAction, string> = {
  togglePlay: "Space",
  play: "L",
  pause: "K",
  prevFrame: "←",
  nextFrame: "→",
  back1s: `${SHIFT}←`,
  forward1s: `${SHIFT}→`,
  prevEdit: "↑",
  nextEdit: "↓",
  seekStart: "Home",
  seekEnd: "End",
  split: "S",
  trimStart: "Q",
  trimEnd: "W",
  delete: "⌫",
  rippleDelete: `${SHIFT}⌫`,
  cut: `${MOD}X`,
  copy: `${MOD}C`,
  paste: `${MOD}V`,
  duplicate: `${MOD}D`,
  addTransition: `${SHIFT}${MOD}D`,
  nudgeLeft: `${ALT}←`,
  nudgeRight: `${ALT}→`,
  nudgeLeftMore: `${ALT}${SHIFT}←`,
  nudgeRightMore: `${ALT}${SHIFT}→`,
  moveUp: `${ALT}↑`,
  moveDown: `${ALT}↓`,
  undo: `${MOD}Z`,
  redo: IS_MAC ? "⇧⌘Z" : "Ctrl+Y",
  selectAll: `${MOD}A`,
  deselect: "Esc",
  zoomIn: "+",
  zoomOut: "−",
  zoomFit: `${SHIFT}Z`,
  toggleSnapping: "N",
  toggleSidebar: `${MOD}\\`,
  showShortcuts: "?",
};

export interface ShortcutGroup {
  title: string;
  items: { label: string; keys: string[] }[];
}

/** Everything listed in the keyboard shortcuts dialog. */
export const SHORTCUT_GROUPS: ShortcutGroup[] = [
  {
    title: "Playback",
    items: [
      { label: "Play / pause", keys: ["Space"] },
      { label: "Play", keys: ["L"] },
      { label: "Pause", keys: ["K"] },
      { label: "Previous / next frame", keys: ["←", "→"] },
      { label: "Back / forward 1 second", keys: [`${SHIFT}←`, `${SHIFT}→`] },
      { label: "Previous / next edit point", keys: ["↑", "↓"] },
      { label: "Go to start / end", keys: ["Home", "End"] },
    ],
  },
  {
    title: "Editing",
    items: [
      { label: "Split at playhead", keys: ["S", `${MOD}B`, `${MOD}K`] },
      { label: "Trim start / end to playhead (ripple)", keys: ["Q", "W"] },
      { label: "Delete (a clicked gap: close it)", keys: ["⌫"] },
      { label: "Ripple delete (close the gap)", keys: [`${SHIFT}⌫`] },
      { label: "Cut / copy / paste", keys: [`${MOD}X`, `${MOD}C`, `${MOD}V`] },
      { label: "Duplicate", keys: [`${MOD}D`] },
      { label: "Add a cross dissolve at the nearest cut", keys: [`${SHIFT}${MOD}D`] },
      { label: "Nudge 1 frame", keys: [`${ALT}←`, `${ALT}→`] },
      { label: "Nudge 10 frames", keys: [`${ALT}${SHIFT}←`, `${ALT}${SHIFT}→`] },
      { label: "Move to track above / below", keys: [`${ALT}↑`, `${ALT}↓`] },
      { label: "Undo / redo", keys: [`${MOD}Z`, SHORTCUT_KEYS.redo] },
    ],
  },
  {
    title: "Selection",
    items: [
      { label: "Select all", keys: [`${MOD}A`] },
      { label: "Deselect", keys: ["Esc"] },
      { label: "Add to / remove from selection", keys: [`${SHIFT}Click`, `${MOD}Click`] },
      { label: "Select a range", keys: ["Drag on empty space"] },
      { label: "Duplicate while dragging", keys: [`${ALT}Drag`] },
    ],
  },
  {
    title: "Timeline",
    items: [
      { label: "Zoom in / out", keys: ["+", "−", `${MOD}Scroll`] },
      { label: "Zoom to fit", keys: [`${SHIFT}Z`, "\\"] },
      { label: "Snapping on / off", keys: ["N"] },
      { label: "Show / hide projects", keys: [`${MOD}\\`] },
      { label: "Keyboard shortcuts", keys: ["?"] },
    ],
  },
];

/** Human-readable labels for tooltips. */
export const SHORTCUT_LABELS = {
  undo: SHORTCUT_KEYS.undo,
  redo: SHORTCUT_KEYS.redo,
};

export const SIDEBAR_SHORTCUT_LABEL = SHORTCUT_KEYS.toggleSidebar;
