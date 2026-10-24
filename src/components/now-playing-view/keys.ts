/**
 * The visualizer's keys (docs/now-playing.md), vaudio's play mode rebuilt: looks on the arrows, the picture punched
 * by Z X C V (zoom, flash, split, twist), its colours turned by the number row (a hue piano: 1 is the look's own,
 * each key a tenth of the way round), chaos on = and mutate on - (vaudio's), the frame on T Y [ ] , . and Backspace
 * (repeat, mirror, turn, zoom, as it was), the song on Space and Shift+arrows, the mini player on P and its own window on
 * O, slow motion on Shift+S; the look loved on L or binned on B, and the rating mode (the looks one after another) on
 * Shift+R; the user's clips in the feedback on Shift+N, another clip on N, the next set of them on K. Pure, and tested.
 */
import type { Pad } from "@shared/live-looks";

export type VisualizerAction =
  | { kind: "close" }
  | { kind: "fullscreen" }
  | { kind: "mini" }
  | { kind: "out" }
  | { kind: "look"; step: 1 | -1 }
  | { kind: "group"; step: 1 | -1 }
  | { kind: "random" }
  | { kind: "vary" }
  | { kind: "chaos" }
  | { kind: "mutate" }
  | { kind: "frame"; change: FrameChange }
  | { kind: "fx"; key: "warp" | "swirl" | "ripple"; by: number }
  | { kind: "panel" }
  | { kind: "pad"; pad: Pad }
  | { kind: "hue"; degrees: number }
  | { kind: "play" }
  | { kind: "song"; step: 1 | -1 }
  | { kind: "auto" }
  | { kind: "slow" }
  | { kind: "rate"; verdict: "love" | "bin" }
  | { kind: "rating" }
  | { kind: "media"; next: boolean }
  | { kind: "mediaSet" }
  | { kind: "screen" }
  | { kind: "hud" }
  | { kind: "help" }
  | { kind: "mood" }
  | { kind: "sync" };

const PADS: Record<string, Pad> = { KeyZ: "zoom", KeyX: "flash", KeyC: "split", KeyV: "twist" };

/** What a frame key does: more copies, mirrored or not, turning left or right, zoomed out or in, back as it was. */
export type FrameChange = "repeat" | "mirror" | "spin-left" | "spin-right" | "zoom-out" | "zoom-in" | "reset";
/** vaudio's Q W E: a step more fluid warp, swirl or ripples (Shift a step less). */
const FX_KEYS: Record<string, "warp" | "swirl" | "ripple"> = { KeyQ: "warp", KeyW: "swirl", KeyE: "ripple" };
export const FX_STEP = 0.08;
const FRAME_KEYS: Record<string, FrameChange> = {
  KeyT: "repeat",
  KeyY: "mirror",
  BracketLeft: "spin-left",
  BracketRight: "spin-right",
  Comma: "zoom-out",
  Period: "zoom-in",
  Backspace: "reset",
};

/** What a key does in the visualizer, or null (it isn't one of its keys). */
export function visualizerKey(e: Pick<KeyboardEvent, "key" | "code" | "shiftKey" | "metaKey" | "ctrlKey" | "altKey">): VisualizerAction | null {
  if (e.metaKey || e.ctrlKey || e.altKey) return null;
  if (e.key === "Escape") return { kind: "close" };
  if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
    const step = e.key === "ArrowRight" ? 1 : -1;
    return e.shiftKey ? { kind: "song", step } : { kind: "look", step };
  }
  if (e.key === "ArrowUp" || e.key === "ArrowDown") return { kind: "group", step: e.key === "ArrowDown" ? 1 : -1 };
  if (e.key === " ") return { kind: "play" };
  if (e.key === "?") return { kind: "help" };
  const pad = PADS[e.code];
  if (pad) return { kind: "pad", pad };
  const change = FRAME_KEYS[e.code];
  if (change) return { kind: "frame", change };
  const fx = FX_KEYS[e.code];
  if (fx) return { kind: "fx", key: fx, by: e.shiftKey ? -FX_STEP : FX_STEP };
  const digit = /^Digit(\d)$/.exec(e.code);
  if (digit) return { kind: "hue", degrees: ((Number(digit[1]) + 9) % 10) * 36 };
  if (e.code === "Backquote") return { kind: "hue", degrees: 0 };
  switch (e.code) {
    case "Equal":
      return { kind: "chaos" };
    case "Minus":
      return { kind: "mutate" };
    case "KeyF":
      return { kind: "fullscreen" };
    case "KeyP":
      return { kind: "mini" };
    case "KeyO":
      return { kind: "out" };
    case "KeyD":
      return { kind: "panel" };
    case "KeyR":
      return e.shiftKey ? { kind: "rating" } : { kind: "random" };
    case "KeyN":
      return { kind: "media", next: !e.shiftKey };
    case "KeyK":
      return { kind: "mediaSet" };
    case "KeyG":
      return { kind: "screen" };
    case "KeyL":
      return { kind: "rate", verdict: "love" };
    case "KeyB":
      return { kind: "rate", verdict: "bin" };
    case "KeyM":
      return { kind: "vary" };
    case "KeyA":
      return { kind: "auto" };
    case "KeyH":
      return { kind: "hud" };
    case "KeyI":
      return { kind: "mood" };
    case "KeyS":
      return e.shiftKey ? { kind: "slow" } : { kind: "sync" };
  }
  return null;
}

/** The keys as the help lists them. */
export const VISUALIZER_KEYS: { keys: string; does: string }[] = [
  { keys: "← →", does: "Previous or next look" },
  { keys: "↑ ↓", does: "Worlds, spectrums, trips, chaos, or MilkDrop at random" },
  { keys: "R", does: "A look at random" },
  { keys: "L", does: "Love the look: shown more (again: take it back)" },
  { keys: "B", does: "Bin it: never shown again (again: take it back)" },
  { keys: "⇧R", does: "Rate the looks, one after another (→ next, ← back)" },
  { keys: "N", does: "Another of your clips, melting into the feedback" },
  { keys: "⇧N", does: "Your clips in the feedback, on or off" },
  { keys: "K", does: "The next set of your clips (friends, nature...)" },
  { keys: "G", does: "A screen or window in the looks (FL Studio...), or stop sharing it" },
  { keys: "M", does: "The same look, another way" },
  { keys: "=", does: "Chaos: a roll of another recipe" },
  { keys: "-", does: "Mutate: the chaos shown, nudged" },
  { keys: "T  Y", does: "Repeat the picture (2×2, 3×3, 4×4), mirror it" },
  { keys: "[  ]", does: "Turn it left or right (faster each press)" },
  { keys: ",  .", does: "Zoom out (its edges repeat) or in" },
  { keys: "Q  W  E", does: "More fluid warp, swirl, ripples (⇧ less)" },
  { keys: "D", does: "Distort, feedback and frame: every setting" },
  { keys: "⌫", does: "Wash: the frame, distortions and feedback as they were" },
  { keys: "A", does: "Change looks by themselves" },
  { keys: "Z X C V", does: "Punch in, flash, split, twist" },
  { keys: "1 – 0", does: "Turn the colours (1 is the look's own)" },
  { keys: "Space", does: "Play or pause the song" },
  { keys: "⇧← ⇧→", does: "Previous or next song" },
  { keys: "F", does: "Full screen" },
  { keys: "P", does: "The mini player (again: back as it was)" },
  { keys: "O", does: "Its own window, out of the app (again: back in)" },
  { keys: "H", does: "Hide the controls" },
  { keys: "⇧S", does: "Slow motion (again: following the music)" },
  { keys: "S", does: "Tap along to sync (headphones)" },
  { keys: "I", does: "Show what it hears (the song's mood)" },
  { keys: "Esc", does: "Close" },
];
