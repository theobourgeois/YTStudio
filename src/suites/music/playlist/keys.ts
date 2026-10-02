/**
 * The Playlist's keyboard shortcuts, FL Studio's (`docs/fl-studio/playlist.md`). Pure, so they're
 * tested; the workspace runs them while the Playlist is the front window. "Ctrl" is Ctrl or ⌘.
 */
import type { PlaylistTool } from "./store";

export type PlaylistKeyAction =
  | { type: "tool"; tool: PlaylistTool }
  | {
      type:
        | "selectAll"
        | "deselect"
        | "invert"
        | "copy"
        | "cut"
        | "paste"
        | "duplicate"
        | "delete"
        | "mute"
        | "unmute"
        | "quantize"
        | "selectSimilar"
        | "timeAround"
        | "insertSpace"
        | "insertSpaceSliced"
        | "deleteSpace"
        | "picker"
        /** FL's Shift+M: stretch mode on or off (an audio clip's edge stretches it). */
        | "stretchMode"
        | "centre"
        | "home"
        | "close";
    }
  /** Move the selection: snap units along, tracks up or down. */
  | { type: "nudge"; snaps: number; tracks: number }
  | { type: "shiftTime"; direction: -1 | 1 }
  /** Move the patterns selected in the Picker up or down the song's list. */
  | { type: "movePatterns"; direction: -1 | 1 }
  | { type: "zoom"; factor: number }
  | { type: "zoomPreset"; preset: 1 | 2 | 3 | 4 | 5 };

type KeyLike = Pick<KeyboardEvent, "key" | "code" | "metaKey" | "ctrlKey" | "shiftKey" | "altKey">;

const TOOLS: Record<string, PlaylistTool> = { P: "draw", B: "paint", D: "delete", T: "mute", S: "slip", C: "slice", E: "select", Y: "playback" };

export function resolvePlaylistKey(e: KeyLike): PlaylistKeyAction | null {
  const command = e.metaKey || e.ctrlKey;
  const { shiftKey: shift, altKey: alt } = e;
  // By position, so Alt (which types other characters on a Mac) doesn't hide the key.
  const letter = /^Key([A-Z])$/.exec(e.code)?.[1] ?? "";
  const digit = /^Digit(\d)$/.exec(e.code)?.[1];
  const horizontal = e.key === "ArrowLeft" ? -1 : e.key === "ArrowRight" ? 1 : 0;
  const vertical = e.key === "ArrowUp" ? -1 : e.key === "ArrowDown" ? 1 : 0;

  if (horizontal || vertical) {
    if (shift && !command && !alt) return { type: "nudge", snaps: horizontal, tracks: vertical };
    if (command && !shift && !alt && horizontal) return { type: "shiftTime", direction: horizontal as -1 | 1 };
    if (alt && !command && !shift && vertical) return { type: "movePatterns", direction: vertical as -1 | 1 };
    return null;
  }
  if (e.key === "Insert") return command ? { type: alt ? "insertSpaceSliced" : "insertSpace" } : null;
  if (e.key === "Delete" || e.key === "Backspace") {
    if (command && !shift && !alt) return { type: "deleteSpace" };
    return !command && !shift && !alt ? { type: "delete" } : null;
  }
  if (e.key === "Escape") return { type: "close" };
  if (e.key === "Home" && !command && !shift && !alt) return { type: "home" };
  if (e.key === "PageUp" || e.key === "PageDown") return { type: "zoom", factor: e.key === "PageUp" ? 1.5 : 1 / 1.5 };
  if (e.key === "Enter") return command && !shift ? { type: "timeAround" } : null;

  if (digit !== undefined && shift && !command && !alt) {
    if (digit === "0") return { type: "centre" };
    if (Number(digit) >= 1 && Number(digit) <= 5) return { type: "zoomPreset", preset: Number(digit) as 1 | 2 | 3 | 4 | 5 };
    return null;
  }

  if (command && !alt) {
    if (shift) return null;
    const commands: Record<string, PlaylistKeyAction["type"]> = { A: "selectAll", D: "deselect", C: "copy", X: "cut", V: "paste", B: "duplicate", Q: "quantize" };
    const type = commands[letter];
    return type ? ({ type } as PlaylistKeyAction) : null;
  }
  if (alt && !command) {
    if (letter === "M") return { type: shift ? "unmute" : "mute" };
    if (letter === "P" && !shift) return { type: "picker" };
    return null;
  }
  if (shift) {
    const shifted: Record<string, PlaylistKeyAction["type"]> = { I: "invert", C: "selectSimilar", Q: "quantize", M: "stretchMode" };
    const type = shifted[letter];
    return type ? ({ type } as PlaylistKeyAction) : null;
  }
  if (TOOLS[letter]) return { type: "tool", tool: TOOLS[letter] };
  return null;
}
