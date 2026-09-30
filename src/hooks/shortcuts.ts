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
  | "prevKeyframe"
  | "nextKeyframe"
  | "seekStart"
  | "seekEnd"
  | "markIn"
  | "markOut"
  | "goToIn"
  | "goToOut"
  | "clearMarks"
  | "makeSubclip"
  | "split"
  | "trimStart"
  | "trimEnd"
  | "delete"
  | "rippleDelete"
  | "cut"
  | "copy"
  | "paste"
  | "copyEffects"
  | "pasteEffects"
  | "easyEase"
  | "easyEaseIn"
  | "easyEaseOut"
  | "addMarker"
  | "nextMarker"
  | "prevMarker"
  | "deleteMarker"
  | "duplicate"
  | "addTransition"
  | "newAdjustmentLayer"
  | "newSolid"
  | "newCamera"
  | "nest"
  | "speed"
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
  | "selectTool"
  | "textTool"
  | "penTool"
  | "rectangleTool"
  | "ellipseTool"
  | "toggleSidebar"
  | "toggleAssistant"
  | "showShortcuts";

export type KeyLike = Pick<
  KeyboardEvent,
  "key" | "metaKey" | "ctrlKey" | "shiftKey" | "altKey" | "repeat"
> & { code?: string };

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
  "prevKeyframe",
  "nextKeyframe",
  "nudgeLeft",
  "nudgeRight",
  "nudgeLeftMore",
  "nudgeRightMore",
  "zoomIn",
  "zoomOut",
  "nextMarker",
  "prevMarker",
]);

export function resolveShortcut(e: KeyLike): ShortcutAction | null {
  // After Effects' Easy Ease keys, whatever the modifiers mean elsewhere.
  if (e.key === "F9" && !e.repeat && !e.altKey) {
    return e.metaKey || e.ctrlKey ? (e.shiftKey ? "easyEaseOut" : null) : e.shiftKey ? "easyEaseIn" : "easyEase";
  }
  const action = e.metaKey || e.ctrlKey ? resolveMod(e) : e.altKey ? resolveAlt(e) : resolvePlain(e);
  if (!action || (e.repeat && !REPEATABLE.has(action))) return null;
  return action;
}

/** ⌘ (macOS) or Ctrl combos. */
function resolveMod(e: KeyLike): ShortcutAction | null {
  if (e.metaKey && e.ctrlKey) return null;
  // ⌥ changes `key` on a Mac (⌥C is "ç"), so these go by the physical key.
  if (e.altKey) {
    // After Effects' New Adjustment Layer (its New Solid, ⌘Y, is redo here).
    if (e.code === "KeyY") return e.shiftKey ? "newSolid" : "newAdjustmentLayer";
    // After Effects' New Camera.
    if (e.code === "KeyC" && e.shiftKey) return "newCamera";
    if (e.shiftKey) return null;
    return e.code === "KeyC" ? "copyEffects" : e.code === "KeyV" ? "pasteEffects" : null;
  }
  const key = e.key.toLowerCase();
  if (key === "z") return e.shiftKey ? "redo" : "undo";
  // Previous / next clip start or end (also keeps ⌘← from going back a page).
  if (key === "arrowleft" || key === "arrowright") return e.shiftKey ? null : key === "arrowleft" ? "prevEdit" : "nextEdit";
  // Premiere's "Apply Default Transition" is ⌘D, which duplicates here; ⇧⌘M is its Go to Previous Marker.
  if (e.shiftKey) return key === "d" ? "addTransition" : key === "m" ? "prevMarker" : null;
  switch (key) {
    case "y":
      return "redo";
    // Premiere's Speed/Duration (also keeps ⌘R from reloading the page).
    case "r":
      return "speed";
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
    case "i":
      return "toggleAssistant";
    // Premiere's Make Subclip (in the source preview).
    case "u":
      return "makeSubclip";
  }
  return null;
}

/** Alt/⌥ + arrows: nudge the selection in time, or move it between tracks. ⌥X clears In and Out. */
function resolveAlt(e: KeyLike): ShortcutAction | null {
  // ⌥ changes `key` on a Mac (⌥X is "≈"), so this goes by the physical key.
  if (e.code === "KeyX" && !e.shiftKey) return "clearMarks";
  // Final Cut's New Compound Clip (After Effects' Pre-compose, ⇧⌘C, is the browser's Inspect).
  if (e.code === "KeyG" && !e.shiftKey) return "nest";
  // Premiere's Clear Selected Marker.
  if (e.code === "KeyM" && !e.shiftKey) return "deleteMarker";
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
    // DaVinci Resolve's keys (Premiere has none by default).
    case "[":
      return "prevKeyframe";
    case "]":
      return "nextKeyframe";
    case "Backspace":
    case "Delete":
      return e.shiftKey ? "rippleDelete" : "delete";
  }
  if (e.shiftKey) {
    switch (e.key.toUpperCase()) {
      case "Z":
        return "zoomFit";
      case "I":
        return "goToIn";
      case "O":
        return "goToOut";
      // Premiere's Go to Next Marker.
      case "M":
        return "nextMarker";
    }
    return null;
  }
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
    case "v":
      return "selectTool";
    case "t":
      return "textTool";
    // Premiere's Pen tool; the shape tools are its neighbours.
    case "p":
      return "penTool";
    case "r":
      return "rectangleTool";
    case "e":
      return "ellipseTool";
    // Premiere's Add Marker.
    case "m":
      return "addMarker";
    // Premiere's Mark In / Mark Out (in the source preview).
    case "i":
      return "markIn";
    case "o":
      return "markOut";
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
  prevKeyframe: "[",
  nextKeyframe: "]",
  seekStart: "Home",
  seekEnd: "End",
  markIn: "I",
  markOut: "O",
  goToIn: `${SHIFT}I`,
  goToOut: `${SHIFT}O`,
  clearMarks: `${ALT}X`,
  makeSubclip: `${MOD}U`,
  split: "S",
  trimStart: "Q",
  trimEnd: "W",
  delete: "⌫",
  rippleDelete: `${SHIFT}⌫`,
  cut: `${MOD}X`,
  copy: `${MOD}C`,
  paste: `${MOD}V`,
  copyEffects: `${ALT}${MOD}C`,
  pasteEffects: `${ALT}${MOD}V`,
  easyEase: "F9",
  easyEaseIn: `${SHIFT}F9`,
  easyEaseOut: `${MOD}${SHIFT}F9`,
  addMarker: "M",
  nextMarker: `${SHIFT}M`,
  prevMarker: `${SHIFT}${MOD}M`,
  deleteMarker: `${ALT}M`,
  duplicate: `${MOD}D`,
  addTransition: `${SHIFT}${MOD}D`,
  newAdjustmentLayer: `${ALT}${MOD}Y`,
  newSolid: `${ALT}${SHIFT}${MOD}Y`,
  newCamera: `${ALT}${SHIFT}${MOD}C`,
  nest: `${ALT}G`,
  speed: `${MOD}R`,
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
  selectTool: "V",
  textTool: "T",
  penTool: "P",
  rectangleTool: "R",
  ellipseTool: "E",
  toggleSidebar: `${MOD}\\`,
  toggleAssistant: `${MOD}I`,
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
      { label: "Previous / next clip start or end", keys: [`${MOD}←`, `${MOD}→`, "↑", "↓"] },
      { label: "Scrub from clip start to clip end", keys: [`${MOD}Drag the playhead`] },
      { label: "Previous / next keyframe of the selected clip", keys: ["[", "]"] },
      { label: "Go to start / end", keys: ["Home", "End"] },
    ],
  },
  {
    title: "Source preview (click a media file)",
    items: [
      { label: "Mark In / Out (the part to add)", keys: ["I", "O"] },
      { label: "Go to In / Out", keys: [`${SHIFT}I`, `${SHIFT}O`] },
      { label: "Clear In and Out", keys: [`${ALT}X`] },
      { label: "Make a subclip of the marked part", keys: [`${MOD}U`] },
      { label: "Back to the timeline", keys: ["Esc"] },
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
      { label: "Copy / paste effects (onto the selected clips)", keys: [`${ALT}${MOD}C`, `${ALT}${MOD}V`] },
      { label: "Duplicate", keys: [`${MOD}D`] },
      { label: "Add a cross dissolve at the nearest cut", keys: [`${SHIFT}${MOD}D`] },
      { label: "New adjustment layer (over the selection, or at the playhead)", keys: [`${ALT}${MOD}Y`] },
      { label: "New solid", keys: [`${ALT}${SHIFT}${MOD}Y`] },
      { label: "New camera (for 3D layers)", keys: [`${ALT}${SHIFT}${MOD}C`] },
      { label: "Nest the selected clips (a sequence of their own)", keys: [`${ALT}G`] },
      { label: "Open a nested sequence", keys: ["Double-click it"] },
      { label: "Speed / reverse the selected clips", keys: [`${MOD}R`] },
      { label: "Stretch a clip's speed to fit", keys: [`${ALT}Drag an edge`] },
      { label: "Add a marker (on the selected clip under the playhead, else on the timeline)", keys: ["M"] },
      { label: "Name or colour a marker", keys: ["Double-click it", "M on it"] },
      { label: "Next / previous marker", keys: [`${SHIFT}M`, `${SHIFT}${MOD}M`] },
      { label: "Delete the marker at the playhead", keys: [`${ALT}M`] },
      { label: "Nudge 1 frame", keys: [`${ALT}←`, `${ALT}→`] },
      { label: "Nudge 10 frames", keys: [`${ALT}${SHIFT}←`, `${ALT}${SHIFT}→`] },
      { label: "Move to track above / below", keys: [`${ALT}↑`, `${ALT}↓`] },
      { label: "Undo / redo", keys: [`${MOD}Z`, SHORTCUT_KEYS.redo] },
    ],
  },
  {
    title: "Keyframes",
    items: [
      { label: "Select several", keys: [`${SHIFT}Click`, "Drag on empty space"] },
      { label: "Copy / paste the selected keyframes (at the playhead, on any clip)", keys: [`${MOD}C`, `${MOD}V`] },
      { label: "Paste one property's keyframes onto another", keys: ["Right-click its lane"] },
      { label: "Easy Ease / Ease In / Ease Out", keys: ["F9", `${SHIFT}F9`, `${MOD}${SHIFT}F9`] },
      { label: "Stretch the selected keyframes", keys: [`${ALT}Drag the first or last`] },
      { label: "Move a position keyframe, or bend its path", keys: ["Drag its dot on the monitor", `${ALT}Click it`] },
      { label: "Delete the selected keyframes", keys: ["⌫"] },
      { label: "Go to a keyframe", keys: ["Double-click"] },
    ],
  },
  {
    title: "Canvas",
    items: [
      { label: "Selection tool", keys: ["V"] },
      { label: "Type tool (click to add text)", keys: ["T"] },
      { label: "Type into a text", keys: ["Double-click"] },
      { label: "Pen tool (a mask on the selected clip, else a shape)", keys: ["P"] },
      { label: "Rectangle / Ellipse tool", keys: ["R", "E"] },
      { label: "Close the path being drawn / stop drawing", keys: ["Click its first point", "Enter"] },
      { label: "Corner ↔ smooth point", keys: [`${ALT}Click a point`] },
      { label: "Move one handle on its own", keys: [`${ALT}Drag a handle`] },
      { label: "Delete the selected points", keys: ["⌫"] },
      { label: "Stretch while scaling", keys: [`${SHIFT}Drag`] },
      { label: "Scale the selected clip", keys: ["Pinch", `${MOD}Scroll`] },
      { label: "Snap rotation to 15°", keys: [`${SHIFT}Drag`] },
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
      { label: "Show / hide the assistant", keys: [`${MOD}I`] },
      { label: "Keyboard shortcuts", keys: ["?"] },
    ],
  },
];
