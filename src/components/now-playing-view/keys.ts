/**
 * The visualizer's keys (docs/now-playing.md), vaudio's play mode rebuilt: looks on the arrows, the picture punched
 * by Z X C V (zoom, flash, split, twist), its colours turned by the number row (a hue piano: 1 is the look's own,
 * each key a tenth of the way round), the song on Space and Shift+arrows. Pure, and tested.
 */
import type { Pad } from "@shared/live-looks";

export type VisualizerAction =
  | { kind: "close" }
  | { kind: "fullscreen" }
  | { kind: "look"; step: 1 | -1 }
  | { kind: "group"; step: 1 | -1 }
  | { kind: "random" }
  | { kind: "vary" }
  | { kind: "pad"; pad: Pad }
  | { kind: "hue"; degrees: number }
  | { kind: "play" }
  | { kind: "song"; step: 1 | -1 }
  | { kind: "auto" }
  | { kind: "hud" }
  | { kind: "help" }
  | { kind: "latency" }
  | { kind: "mood" }
  | { kind: "sync" };

const PADS: Record<string, Pad> = { KeyZ: "zoom", KeyX: "flash", KeyC: "split", KeyV: "twist" };

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
  const digit = /^Digit(\d)$/.exec(e.code);
  if (digit) return { kind: "hue", degrees: ((Number(digit[1]) + 9) % 10) * 36 };
  if (e.code === "Backquote") return { kind: "hue", degrees: 0 };
  switch (e.code) {
    case "KeyF":
      return { kind: "fullscreen" };
    case "KeyR":
      return { kind: "random" };
    case "KeyM":
      return { kind: "vary" };
    case "KeyA":
      return { kind: "auto" };
    case "KeyH":
      return { kind: "hud" };
    case "KeyL":
      return { kind: "latency" };
    case "KeyI":
      return { kind: "mood" };
    case "KeyS":
      return { kind: "sync" };
  }
  return null;
}

/** The keys as the help lists them. */
export const VISUALIZER_KEYS: { keys: string; does: string }[] = [
  { keys: "← →", does: "Previous or next look" },
  { keys: "↑ ↓", does: "Worlds, spectrums or trips" },
  { keys: "R", does: "A look at random" },
  { keys: "M", does: "The same look, another way" },
  { keys: "A", does: "Change looks by themselves" },
  { keys: "Z X C V", does: "Punch in, flash, split, twist" },
  { keys: "1 – 0", does: "Turn the colours (1 is the look's own)" },
  { keys: "Space", does: "Play or pause the song" },
  { keys: "⇧← ⇧→", does: "Previous or next song" },
  { keys: "F", does: "Full screen" },
  { keys: "H", does: "Hide the controls" },
  { keys: "S", does: "Tap along to sync (headphones)" },
  { keys: "L", does: "Show how late the picture is" },
  { keys: "I", does: "Show what it hears (the song's mood)" },
  { keys: "Esc", does: "Close" },
];
