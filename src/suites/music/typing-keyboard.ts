/**
 * FL Studio's typing keyboard to piano keyboard (`docs/fl-studio/midi.md`), its Piano layout: the bottom
 * letter row is an octave from C (Z) with its black keys on the row above, and the top letter row the
 * octave above it from Q, its black keys on the digits. By the key's position (`KeyboardEvent.code`),
 * so it's the same on any keyboard layout. Pure, so it's tested.
 */

const LOWER = ["KeyZ", "KeyS", "KeyX", "KeyD", "KeyC", "KeyV", "KeyG", "KeyB", "KeyH", "KeyN", "KeyJ", "KeyM", "Comma", "KeyL", "Period", "Semicolon", "Slash"];
const UPPER = ["KeyQ", "Digit2", "KeyW", "Digit3", "KeyE", "KeyR", "Digit5", "KeyT", "Digit6", "KeyY", "Digit7", "KeyU", "KeyI", "Digit9", "KeyO", "Digit0", "KeyP"];

/** Semitones above the layout's C, by key. */
const OFFSETS: ReadonlyMap<string, number> = new Map([...LOWER.map((code, i) => [code, i] as const), ...UPPER.map((code, i) => [code, 12 + i] as const)]);

/** The octave the bottom row starts in: 5 is C5, MIDI's 60 (FL's names). */
export const DEFAULT_TYPING_OCTAVE = 5;
export const MIN_TYPING_OCTAVE = 0;
export const MAX_TYPING_OCTAVE = 8;
/** How hard the typing keyboard plays (FL's 100 of 127). */
export const TYPING_VELOCITY = 100;

/** The MIDI note a key plays with the bottom row in `octave`, or null if it isn't one of the layout's. */
export function typingKeyPitch(code: string, octave: number): number | null {
  const offset = OFFSETS.get(code);
  if (offset === undefined) return null;
  const pitch = octave * 12 + offset;
  return pitch >= 0 && pitch <= 127 ? pitch : null;
}

type KeyLike = Pick<KeyboardEvent, "code" | "metaKey" | "ctrlKey" | "altKey">;

/** What a key does while the typing keyboard is on: a note, an octave down or up (`[`, `]`, ours), or nothing (it's a shortcut's). */
export function resolveTypingKey(e: KeyLike, octave: number): { type: "note"; pitch: number } | { type: "octave"; direction: -1 | 1 } | { type: "consume" } | null {
  // Ctrl, ⌘ and Alt keep their shortcuts, as in FL Studio.
  if (e.metaKey || e.ctrlKey || e.altKey) return null;
  if (e.code === "BracketLeft") return { type: "octave", direction: -1 };
  if (e.code === "BracketRight") return { type: "octave", direction: 1 };
  const pitch = typingKeyPitch(e.code, octave);
  if (pitch !== null) return { type: "note", pitch };
  // Unmapped letters/digits must not change tools or mute channels while playing the piano.
  return /^(Key[A-Z]|Digit[0-9])$/.test(e.code) ? { type: "consume" } : null;
}
