import { describe, expect, it } from "vitest";
import { resolvePianoKey } from "./keys";

type Mods = Partial<Record<"metaKey" | "ctrlKey" | "shiftKey" | "altKey", boolean>>;
const press = (key: string, code: string, mods: Mods = {}) => resolvePianoKey({ key, code, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, ...mods });
const cmd = { metaKey: true };
const shift = { shiftKey: true };
const alt = { altKey: true };

describe("piano roll keys", () => {
  it("picks tools with FL Studio's letters", () => {
    expect(press("p", "KeyP")).toEqual({ type: "tool", tool: "draw" });
    expect(press("z", "KeyZ")).toEqual({ type: "tool", tool: "zoom" });
    expect(press("q", "KeyQ", alt)).toEqual({ type: "quantizer" });
    expect(press("b", "KeyB")).toEqual({ type: "tool", tool: "paint" });
    expect(press("d", "KeyD")).toEqual({ type: "tool", tool: "delete" });
    expect(press("t", "KeyT")).toEqual({ type: "tool", tool: "mute" });
    expect(press("c", "KeyC")).toEqual({ type: "tool", tool: "slice" });
    expect(press("e", "KeyE")).toEqual({ type: "tool", tool: "select" });
  });

  it("selects, copies, duplicates and deletes", () => {
    expect(press("a", "KeyA", cmd)).toEqual({ type: "selectAll" });
    expect(press("d", "KeyD", { ctrlKey: true })).toEqual({ type: "deselect" });
    expect(press("I", "KeyI", shift)).toEqual({ type: "invert" });
    expect(press("c", "KeyC", cmd)).toEqual({ type: "copy" });
    expect(press("x", "KeyX", cmd)).toEqual({ type: "cut" });
    expect(press("v", "KeyV", cmd)).toEqual({ type: "paste" });
    expect(press("b", "KeyB", cmd)).toEqual({ type: "duplicate" });
    expect(press("Delete", "Delete")).toEqual({ type: "delete" });
    expect(press("Backspace", "Backspace")).toEqual({ type: "delete" });
  });

  it("moves notes with the arrows: Shift by the snap and a semitone, Alt by a tick, Ctrl by an octave", () => {
    expect(press("ArrowRight", "ArrowRight", shift)).toEqual({ type: "nudge", by: "snap", direction: 1, semitones: 0 });
    expect(press("ArrowUp", "ArrowUp", shift)).toEqual({ type: "nudge", by: "none", direction: 0, semitones: 1 });
    expect(press("ArrowLeft", "ArrowLeft", alt)).toEqual({ type: "nudge", by: "tick", direction: -1, semitones: 0 });
    expect(press("ArrowDown", "ArrowDown", cmd)).toEqual({ type: "nudge", by: "none", direction: 0, semitones: -12 });
    expect(press("ArrowLeft", "ArrowLeft", { ...cmd, ...shift })).toEqual({ type: "rotate", direction: -1 });
    expect(press("ArrowRight", "ArrowRight", cmd)).toEqual({ type: "shiftTime", direction: 1 });
    expect(press("ArrowRight", "ArrowRight")).toBeNull();
  });

  it("runs the tools' shortcuts", () => {
    expect(press("g", "KeyG", cmd)).toEqual({ type: "glue" });
    expect(press("u", "KeyU", cmd)).toEqual({ type: "chop" });
    // Alt types "¨" on a Mac: the key's position is what counts.
    expect(press("¨", "KeyU", { altKey: true })).toEqual({ type: "chopper" });
    expect(press("q", "KeyQ", cmd)).toEqual({ type: "quantize" });
    expect(press("Q", "KeyQ", shift)).toEqual({ type: "quantizeStarts" });
    expect(press("l", "KeyL", cmd)).toEqual({ type: "legato" });
    expect(press("D", "KeyD", shift)).toEqual({ type: "discard" });
    // On a Mac, Alt+M types "µ": the key is known by where it is.
    expect(press("µ", "KeyM", alt)).toEqual({ type: "mute" });
    expect(press("Â", "KeyM", { ...alt, ...shift })).toEqual({ type: "unmute" });
    expect(press("√", "KeyV", alt)).toEqual({ type: "ghosts" });
    expect(press("Enter", "Enter", cmd)).toEqual({ type: "timeAround" });
  });

  it("changes channel, zooms and shows the event editor", () => {
    expect(press("g", "KeyG")).toEqual({ type: "channel", direction: -1, withNotes: false });
    expect(press("j", "KeyJ")).toEqual({ type: "channel", direction: 1, withNotes: true });
    expect(press("PageUp", "PageUp")).toEqual({ type: "zoom", factor: 1.5 });
    expect(press("!", "Digit1", shift)).toEqual({ type: "zoomPreset", preset: 1 });
    expect(press("%", "Digit5", shift)).toEqual({ type: "zoomPreset", preset: 5 });
    expect(press(")", "Digit0", shift)).toEqual({ type: "centre" });
    expect(press("Enter", "Enter", shift)).toEqual({ type: "lane" });
    expect(press("f", "KeyF")).toEqual({ type: "nextLane" });
    expect(press("Escape", "Escape")).toEqual({ type: "close" });
  });

  it("leaves the rest alone", () => {
    expect(press("z", "KeyZ", cmd)).toBeNull();
    expect(press(" ", "Space")).toBeNull();
    expect(press("1", "Digit1")).toBeNull();
    expect(press("c", "KeyC", { ...cmd, ...shift })).toBeNull();
  });
});
