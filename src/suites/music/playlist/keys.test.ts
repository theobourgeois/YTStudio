import { describe, expect, it } from "vitest";
import { resolvePlaylistKey } from "./keys";

type Mods = Partial<Record<"metaKey" | "ctrlKey" | "shiftKey" | "altKey", boolean>>;
const press = (key: string, code: string, mods: Mods = {}) => resolvePlaylistKey({ key, code, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, ...mods });

describe("the Playlist's keys", () => {
  it("pick FL Studio's tools by letter", () => {
    expect(press("p", "KeyP")).toEqual({ type: "tool", tool: "draw" });
    expect(press("b", "KeyB")).toEqual({ type: "tool", tool: "paint" });
    expect(press("d", "KeyD")).toEqual({ type: "tool", tool: "delete" });
    expect(press("t", "KeyT")).toEqual({ type: "tool", tool: "mute" });
    expect(press("s", "KeyS")).toEqual({ type: "tool", tool: "slip" });
    expect(press("c", "KeyC")).toEqual({ type: "tool", tool: "slice" });
    expect(press("e", "KeyE")).toEqual({ type: "tool", tool: "select" });
    expect(press("y", "KeyY")).toEqual({ type: "tool", tool: "playback" });
    // L is the editor's (pattern / song mode), not the Playlist's.
    expect(press("l", "KeyL")).toBeNull();
  });

  it("select, copy, paste, duplicate and delete with Ctrl", () => {
    expect(press("a", "KeyA", { metaKey: true })).toEqual({ type: "selectAll" });
    expect(press("d", "KeyD", { ctrlKey: true })).toEqual({ type: "deselect" });
    expect(press("b", "KeyB", { metaKey: true })).toEqual({ type: "duplicate" });
    expect(press("v", "KeyV", { metaKey: true })).toEqual({ type: "paste" });
    expect(press("Delete", "Delete")).toEqual({ type: "delete" });
    expect(press("Backspace", "Backspace")).toEqual({ type: "delete" });
    expect(press("i", "KeyI", { shiftKey: true })).toEqual({ type: "invert" });
    expect(press("c", "KeyC", { shiftKey: true })).toEqual({ type: "selectSimilar" });
  });

  it("move the selection with Shift and the arrows, and the time selection with Ctrl", () => {
    expect(press("ArrowRight", "ArrowRight", { shiftKey: true })).toEqual({ type: "nudge", snaps: 1, tracks: 0 });
    expect(press("ArrowUp", "ArrowUp", { shiftKey: true })).toEqual({ type: "nudge", snaps: 0, tracks: -1 });
    expect(press("ArrowLeft", "ArrowLeft", { metaKey: true })).toEqual({ type: "shiftTime", direction: -1 });
    expect(press("ArrowUp", "ArrowUp")).toBeNull();
  });

  it("move the Picker's selected patterns up and down with Alt", () => {
    expect(press("ArrowUp", "ArrowUp", { altKey: true })).toEqual({ type: "movePatterns", direction: -1 });
    expect(press("ArrowDown", "ArrowDown", { altKey: true })).toEqual({ type: "movePatterns", direction: 1 });
    expect(press("ArrowLeft", "ArrowLeft", { altKey: true })).toBeNull();
    expect(press("ArrowUp", "ArrowUp", { altKey: true, shiftKey: true })).toBeNull();
    expect(press("ArrowUp", "ArrowUp", { altKey: true, metaKey: true })).toBeNull();
  });

  it("insert and delete space, and time-select around the clips", () => {
    expect(press("Insert", "Insert", { ctrlKey: true })).toEqual({ type: "insertSpace" });
    expect(press("Insert", "Insert", { ctrlKey: true, altKey: true })).toEqual({ type: "insertSpaceSliced" });
    expect(press("Delete", "Delete", { metaKey: true })).toEqual({ type: "deleteSpace" });
    expect(press("Enter", "Enter", { metaKey: true })).toEqual({ type: "timeAround" });
  });

  it("mute, open the Picker, zoom and go home", () => {
    expect(press("µ", "KeyM", { altKey: true })).toEqual({ type: "mute" });
    expect(press("M", "KeyM", { altKey: true, shiftKey: true })).toEqual({ type: "unmute" });
    expect(press("π", "KeyP", { altKey: true })).toEqual({ type: "picker" });
    expect(press("$", "Digit4", { shiftKey: true })).toEqual({ type: "zoomPreset", preset: 4 });
    expect(press(")", "Digit0", { shiftKey: true })).toEqual({ type: "centre" });
    expect(press("PageUp", "PageUp")).toEqual({ type: "zoom", factor: 1.5 });
    expect(press("Home", "Home")).toEqual({ type: "home" });
    expect(press("Escape", "Escape")).toEqual({ type: "close" });
  });
});
