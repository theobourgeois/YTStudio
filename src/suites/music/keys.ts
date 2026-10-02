/**
 * The music editor's keyboard shortcuts, FL Studio's where it has them (`docs/fl-studio/channel-rack.md`).
 * Pure, so they're tested; `workspace.tsx` listens and runs them. "Ctrl" is Ctrl or ⌘.
 */

export type MusicKeyAction =
  | {
      type:
        | "togglePlay"
        | "undo"
        | "redo"
        | "toggleRack"
        | "togglePiano"
        | "togglePlaylist"
        | "toggleMixer"
        | "toggleBrowser"
        | "toggleMode"
        /** FL's R: Record on or off (Play then records the armed tracks). */
        | "toggleRecord"
        /** FL's Ctrl+T: the typing keyboard to piano keyboard on or off. */
        | "toggleTyping"
        | "toggleGraph"
        | "toggleTrackSelectors"
        | "assignFreeTracks"
        | "clone"
        | "delete"
        | "copy"
        | "cut"
        | "paste"
        /** FL's Ctrl+R and Ctrl+Shift+R: export a WAV, or an MP3 (the save dialog, then the export window). */
        | "exportWav"
        | "exportMp3";
    }
  /** Mute or solo the nth channel of the rack (0 is the first). */
  | { type: "mute" | "solo"; index: number }
  /** Select the channel above (-1) or below (1); `extend` keeps what's selected. */
  | { type: "select"; direction: -1 | 1; extend: boolean }
  /** Move the selected channels up or down the rack. */
  | { type: "move"; direction: -1 | 1 }
  /** Shift the selected channel's steps left or right. */
  | { type: "rotate"; direction: -1 | 1 };

/** Alt+1…5: Playlist, Channel rack, Piano roll, Mixer, Browser (F5, F6, F7, F9, Alt+F8). */
const WINDOW_DIGITS: Partial<Record<string, "togglePlaylist" | "toggleRack" | "togglePiano" | "toggleMixer" | "toggleBrowser">> = { "1": "togglePlaylist", "2": "toggleRack", "3": "togglePiano", "4": "toggleMixer", "5": "toggleBrowser" };

type KeyLike = Pick<KeyboardEvent, "key" | "code" | "metaKey" | "ctrlKey" | "shiftKey" | "altKey">;

export function resolveMusicKey(e: KeyLike): MusicKeyAction | null {
  const command = e.metaKey || e.ctrlKey;
  const only = (type: "togglePlay" | "toggleRack" | "togglePiano" | "togglePlaylist" | "toggleMixer" | "toggleMode" | "toggleRecord") => (!command && !e.shiftKey && !e.altKey ? { type } : null);
  // By position, so Alt (which types other characters on a Mac) doesn't hide the key.
  const letter = /^Key([A-Z])$/.exec(e.code)?.[1] ?? "";
  const digit = /^Digit(\d)$/.exec(e.code)?.[1];
  const vertical = e.key === "ArrowUp" ? -1 : e.key === "ArrowDown" ? 1 : null;
  const horizontal = e.key === "ArrowLeft" ? -1 : e.key === "ArrowRight" ? 1 : null;

  if (e.code === "Space") return only("togglePlay");
  if (e.key === "F5") return only("togglePlaylist");
  if (e.key === "F6") return only("toggleRack");
  if (e.key === "F7") return only("togglePiano");
  if (e.key === "F9") return only("toggleMixer");
  // FL's Alt+F8. (F8 alone is FL's plugin picker.)
  if (e.key === "F8" && e.altKey && !command && !e.shiftKey) return { type: "toggleBrowser" };
  // The same windows on Alt+1…5, in the F keys' order: a Mac's F keys need Fn.
  if (digit !== undefined && e.altKey && !command && !e.shiftKey) {
    const window = WINDOW_DIGITS[digit];
    return window ? { type: window } : null;
  }

  if (digit !== undefined && !e.shiftKey && !e.altKey) {
    // 1…9 then 0: the first ten channels.
    return { type: command ? "solo" : "mute", index: (Number(digit) + 9) % 10 };
  }
  if (vertical !== null && !command) {
    if (e.altKey) return e.shiftKey ? null : { type: "move", direction: vertical };
    return { type: "select", direction: vertical, extend: e.shiftKey };
  }
  if (horizontal !== null && command && e.shiftKey && !e.altKey) return { type: "rotate", direction: horizontal };

  // FL's L: pattern or song mode.
  if (letter === "L" && !command && !e.shiftKey && !e.altKey) return only("toggleMode");
  if (letter === "R" && !command && !e.shiftKey && !e.altKey) return only("toggleRecord");
  if (e.altKey && !command && !e.shiftKey) {
    if (letter === "C") return { type: "clone" };
    if (letter === "M") return { type: "toggleTrackSelectors" };
    if (e.key === "Delete" || e.key === "Backspace") return { type: "delete" };
    return null;
  }
  if (command && !e.altKey) {
    if (letter === "Z") return { type: e.shiftKey ? "redo" : "undo" };
    if (letter === "R") return { type: e.shiftKey ? "exportMp3" : "exportWav" };
    if (e.shiftKey) return null;
    if (letter === "Y") return { type: "redo" };
    if (letter === "T") return { type: "toggleTyping" };
    if (letter === "K") return { type: "toggleGraph" };
    if (letter === "L") return { type: "assignFreeTracks" };
    if (letter === "C") return { type: "copy" };
    if (letter === "X") return { type: "cut" };
    if (letter === "V") return { type: "paste" };
  }
  return null;
}

/** Keys for the whole editor, whichever window is in front (the Piano roll and the mixer leave only these to the rack). */
const GLOBAL_KEYS: ReadonlySet<MusicKeyAction["type"]> = new Set([
  "togglePlay",
  "undo",
  "redo",
  "toggleRack",
  "togglePiano",
  "togglePlaylist",
  "toggleMixer",
  "toggleBrowser",
  "toggleMode",
  "toggleRecord",
  "toggleTyping",
  "exportWav",
  "exportMp3",
]);

export const isGlobalKey = (action: MusicKeyAction) => GLOBAL_KEYS.has(action.type);

/**
 * A key pressed in a plugin's window that the plugin didn't use (`EngineKey`): only the keys for the
 * whole editor, as in FL Studio (Space plays; a plugin in front isn't the rack).
 */
export function resolvePluginWindowKey(e: KeyLike): MusicKeyAction | null {
  const action = resolveMusicKey(e);
  return action && isGlobalKey(action) ? action : null;
}

/** Typing into a field: the keyboard is the field's. */
export function isTyping(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && (target.isContentEditable || target.closest("input, textarea, select") !== null);
}
