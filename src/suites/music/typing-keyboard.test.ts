import { describe, expect, it } from "vitest";
import { resolveTypingKey, typingKeyPitch } from "./typing-keyboard";

const key = (code: string, mods: Partial<Record<"metaKey" | "ctrlKey" | "altKey", boolean>> = {}) => ({ code, metaKey: false, ctrlKey: false, altKey: false, ...mods });

describe("the typing keyboard", () => {
  it("plays FL's Piano layout: Z is C, the row above its black keys, Q the octave above", () => {
    expect(["KeyZ", "KeyS", "KeyX", "KeyD", "KeyC", "KeyV"].map((code) => typingKeyPitch(code, 5))).toEqual([60, 61, 62, 63, 64, 65]);
    expect(typingKeyPitch("Comma", 5)).toBe(72);
    expect(typingKeyPitch("KeyQ", 5)).toBe(72);
    expect(typingKeyPitch("Digit2", 5)).toBe(73);
    expect(typingKeyPitch("KeyP", 5)).toBe(88);
    expect(typingKeyPitch("KeyZ", 3)).toBe(36);
    expect(typingKeyPitch("KeyA", 5)).toBeNull();
    expect(typingKeyPitch("KeyP", 9)).toBeNull();
  });

  it("leaves Ctrl, ⌘ and Alt keys to their shortcuts, and shifts octaves with [ and ]", () => {
    expect(resolveTypingKey(key("KeyC"), 5)).toEqual({ type: "note", pitch: 64 });
    expect(resolveTypingKey(key("KeyC", { metaKey: true }), 5)).toBeNull();
    expect(resolveTypingKey(key("KeyZ", { ctrlKey: true }), 5)).toBeNull();
    expect(resolveTypingKey(key("BracketRight"), 5)).toEqual({ type: "octave", direction: 1 });
    expect(resolveTypingKey(key("BracketLeft"), 5)).toEqual({ type: "octave", direction: -1 });
    expect(resolveTypingKey(key("Space"), 5)).toBeNull();
  });
});
