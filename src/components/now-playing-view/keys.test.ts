import { describe, expect, it } from "vitest";
import { visualizerKey } from "./keys";

const key = (code: string, key = "", mods: Partial<{ shiftKey: boolean; metaKey: boolean; ctrlKey: boolean; altKey: boolean }> = {}) =>
  visualizerKey({ code, key, shiftKey: false, metaKey: false, ctrlKey: false, altKey: false, ...mods });

describe("visualizerKey", () => {
  it("moves between looks and songs on the arrows", () => {
    expect(key("ArrowRight", "ArrowRight")).toEqual({ kind: "look", step: 1 });
    expect(key("ArrowLeft", "ArrowLeft", { shiftKey: true })).toEqual({ kind: "song", step: -1 });
    expect(key("ArrowDown", "ArrowDown")).toEqual({ kind: "group", step: 1 });
  });

  it("punches on Z X C V, whatever the keyboard's layout says", () => {
    expect(key("KeyZ", "y")).toEqual({ kind: "pad", pad: "zoom" });
    expect(key("KeyV", "v")).toEqual({ kind: "pad", pad: "twist" });
  });

  it("turns the colours on the number row, 1 being the look's own", () => {
    expect(key("Digit1", "1")).toEqual({ kind: "hue", degrees: 0 });
    expect(key("Digit2", "2")).toEqual({ kind: "hue", degrees: 36 });
    expect(key("Digit0", "0")).toEqual({ kind: "hue", degrees: 324 });
  });

  it("rolls chaos on = and mutates it on -, as vaudio does", () => {
    expect(key("Equal", "=")).toEqual({ kind: "chaos" });
    expect(key("Equal", "+", { shiftKey: true })).toEqual({ kind: "chaos" });
    expect(key("Minus", "-")).toEqual({ kind: "mutate" });
    expect(key("Minus", "-", { metaKey: true })).toBeNull();
  });

  it("reframes on T Y [ ] , . and Backspace", () => {
    expect(key("KeyT", "t")).toEqual({ kind: "frame", change: "repeat" });
    expect(key("KeyY", "y")).toEqual({ kind: "frame", change: "mirror" });
    expect(key("BracketLeft", "[")).toEqual({ kind: "frame", change: "spin-left" });
    expect(key("BracketRight", "]")).toEqual({ kind: "frame", change: "spin-right" });
    expect(key("Comma", ",")).toEqual({ kind: "frame", change: "zoom-out" });
    expect(key("Period", ".")).toEqual({ kind: "frame", change: "zoom-in" });
    expect(key("Backspace", "Backspace")).toEqual({ kind: "frame", change: "reset" });
  });

  it("nudges warp, swirl and ripples on Q W E (Shift less), opens the panel on D", () => {
    expect(key("KeyQ", "q")).toEqual({ kind: "fx", key: "warp", by: 0.08 });
    expect(key("KeyW", "W", { shiftKey: true })).toEqual({ kind: "fx", key: "swirl", by: -0.08 });
    expect(key("KeyE", "e")).toEqual({ kind: "fx", key: "ripple", by: 0.08 });
    expect(key("KeyD", "d")).toEqual({ kind: "panel" });
  });

  it("makes it the mini player on P, its own window on O", () => {
    expect(key("KeyP", "p")).toEqual({ kind: "mini" });
    expect(key("KeyO", "o")).toEqual({ kind: "out" });
  });

  it("taps along on S, and turns slow motion on and off on Shift+S", () => {
    expect(key("KeyS", "s")).toEqual({ kind: "sync" });
    expect(key("KeyS", "S", { shiftKey: true })).toEqual({ kind: "slow" });
  });

  it("loves the look on L, bins it on B, and rates the looks one after another on Shift+R", () => {
    expect(key("KeyL", "l")).toEqual({ kind: "rate", verdict: "love" });
    expect(key("KeyB", "b")).toEqual({ kind: "rate", verdict: "bin" });
    expect(key("KeyR", "R", { shiftKey: true })).toEqual({ kind: "rating" });
    expect(key("KeyR", "r")).toEqual({ kind: "random" });
  });

  it("brings in another of the user's clips on N, and turns them on or off on Shift+N", () => {
    expect(key("KeyN", "n")).toEqual({ kind: "media", next: true });
    expect(key("KeyN", "N", { shiftKey: true })).toEqual({ kind: "media", next: false });
  });

  it("leaves the app's own shortcuts alone", () => {
    expect(key("KeyR", "r", { metaKey: true })).toBeNull();
    expect(key("KeyG", "g")).toBeNull();
    expect(key("Escape", "Escape")).toEqual({ kind: "close" });
  });
});
