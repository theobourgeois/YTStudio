import { describe, expect, it } from "vitest";
import { isGlobalKey, resolveMusicKey, resolvePluginWindowKey, takesMenuKey } from "./keys";

type Mods = Partial<Record<"metaKey" | "ctrlKey" | "shiftKey" | "altKey", boolean>>;
const press = (key: string, code: string, mods: Mods = {}) => resolveMusicKey({ key, code, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, ...mods });

describe("music keys", () => {
  it("shows the Playlist with F5 and switches pattern and song mode with L, from any window", () => {
    expect(press("F5", "F5")).toEqual({ type: "togglePlaylist" });
    expect(press("l", "KeyL")).toEqual({ type: "toggleMode" });
    expect(press("r", "KeyR")).toEqual({ type: "toggleRecord" });
    // FL's typing keyboard to piano keyboard, from any window.
    expect(press("t", "KeyT", { ctrlKey: true })).toEqual({ type: "toggleTyping" });
    expect(isGlobalKey({ type: "toggleTyping" })).toBe(true);
    expect(press("l", "KeyL", { metaKey: true })).toEqual({ type: "assignFreeTracks" });
    expect(press("l", "KeyL", { shiftKey: true })).toBeNull();
    expect(resolvePluginWindowKey({ key: "l", code: "KeyL", metaKey: false, ctrlKey: false, shiftKey: false, altKey: false })).toEqual({ type: "toggleMode" });
  });

  it("plays with Space, shows the rack with F6, and undoes and redoes with the usual keys", () => {
    expect(press(" ", "Space")).toEqual({ type: "togglePlay" });
    expect(press("F6", "F6")).toEqual({ type: "toggleRack" });
    expect(press("F7", "F7")).toEqual({ type: "togglePiano" });
    expect(press("z", "KeyZ", { metaKey: true })).toEqual({ type: "undo" });
    expect(press("Z", "KeyZ", { metaKey: true, shiftKey: true })).toEqual({ type: "redo" });
    expect(press("y", "KeyY", { ctrlKey: true })).toEqual({ type: "redo" });
    expect(press("k", "KeyK", { ctrlKey: true })).toEqual({ type: "toggleGraph" });
    // FL's export keys, whichever window is in front (and from a plugin's): ⌘R a WAV, ⌘⇧R an MP3.
    expect(press("r", "KeyR", { metaKey: true })).toEqual({ type: "exportWav" });
    expect(press("R", "KeyR", { ctrlKey: true, shiftKey: true })).toEqual({ type: "exportMp3" });
    expect(isGlobalKey({ type: "exportWav" })).toBe(true);
  });

  it("shows the Browser with Alt+F8, from anywhere", () => {
    expect(press("F8", "F8", { altKey: true })).toEqual({ type: "toggleBrowser" });
    expect(press("F8", "F8")).toEqual({ type: "addChannel" });
    expect(resolvePluginWindowKey({ key: "F8", code: "F8", metaKey: false, ctrlKey: false, shiftKey: false, altKey: true })).toEqual({ type: "toggleBrowser" });
  });

  it("shows the mixer with F9 (from any window, a plugin's too), and works its routing from the rack", () => {
    expect(press("F9", "F9")).toEqual({ type: "toggleMixer" });
    expect(resolvePluginWindowKey({ key: "F9", code: "F9", metaKey: false, ctrlKey: false, shiftKey: false, altKey: false })).toEqual({ type: "toggleMixer" });
    expect(press("µ", "KeyM", { altKey: true })).toEqual({ type: "toggleTrackSelectors" });
    expect(press("l", "KeyL", { metaKey: true })).toEqual({ type: "assignFreeTracks" });
  });

  it("shows the windows with Alt+1…5 too, from anywhere (a Mac's F keys need Fn)", () => {
    // On a Mac, Alt+1 types "¡": the key is known by where it is.
    expect(press("¡", "Digit1", { altKey: true })).toEqual({ type: "togglePlaylist" });
    expect(press("™", "Digit2", { altKey: true })).toEqual({ type: "toggleRack" });
    expect(press("£", "Digit3", { altKey: true })).toEqual({ type: "togglePiano" });
    expect(press("¢", "Digit4", { altKey: true })).toEqual({ type: "toggleMixer" });
    expect(press("∞", "Digit5", { altKey: true })).toEqual({ type: "toggleBrowser" });
    expect(press("§", "Digit6", { altKey: true })).toBeNull();
    expect(press("1", "Digit1", { altKey: true, metaKey: true })).toBeNull();
    expect(resolvePluginWindowKey({ key: "£", code: "Digit3", metaKey: false, ctrlKey: false, shiftKey: false, altKey: true })).toEqual({ type: "togglePiano" });
  });

  it("mutes the first ten channels with 1…0, and solos them with Ctrl", () => {
    expect(press("1", "Digit1")).toEqual({ type: "mute", index: 0 });
    expect(press("0", "Digit0")).toEqual({ type: "mute", index: 9 });
    expect(press("3", "Digit3", { metaKey: true })).toEqual({ type: "solo", index: 2 });
    expect(press("#", "Digit3", { shiftKey: true })).toBeNull();
  });

  it("selects with the arrows, moves with Alt, clones and deletes with Alt+C and Alt+Del", () => {
    expect(press("ArrowDown", "ArrowDown")).toEqual({ type: "select", direction: 1, extend: false });
    expect(press("ArrowUp", "ArrowUp", { shiftKey: true })).toEqual({ type: "select", direction: -1, extend: true });
    expect(press("ArrowUp", "ArrowUp", { altKey: true })).toEqual({ type: "move", direction: -1 });
    // On a Mac, Alt+C types "ç": the key is known by where it is.
    expect(press("ç", "KeyC", { altKey: true })).toEqual({ type: "clone" });
    expect(press("Backspace", "Backspace", { altKey: true })).toEqual({ type: "delete" });
    expect(press("Delete", "Delete")).toBeNull();
  });

  it("copies, cuts, pastes and shifts the selected channel's steps", () => {
    expect(press("c", "KeyC", { metaKey: true })).toEqual({ type: "copy" });
    expect(press("x", "KeyX", { ctrlKey: true })).toEqual({ type: "cut" });
    expect(press("v", "KeyV", { metaKey: true })).toEqual({ type: "paste" });
    expect(press("ArrowRight", "ArrowRight", { metaKey: true, shiftKey: true })).toEqual({ type: "rotate", direction: 1 });
    expect(press("ArrowLeft", "ArrowLeft", { metaKey: true })).toBeNull();
  });

  it("leaves other keys alone", () => {
    expect(press("z", "KeyZ")).toBeNull();
    expect(press(" ", "Space", { shiftKey: true })).toBeNull();
    expect(press("z", "KeyZ", { metaKey: true, altKey: true })).toBeNull();
    expect(press("a", "KeyA")).toBeNull();
  });

  it("takes only the keys for the whole editor from a plugin's window", () => {
    const fromPlugin = (key: string, code: string, mods: Mods = {}) => resolvePluginWindowKey({ key, code, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, ...mods });
    expect(fromPlugin(" ", "Space")).toEqual({ type: "togglePlay" });
    expect(fromPlugin("F7", "F7")).toEqual({ type: "togglePiano" });
    expect(fromPlugin("z", "KeyZ", { metaKey: true })).toEqual({ type: "undo" });
    // The rack's own keys stay the rack's: a plugin in front isn't it.
    expect(fromPlugin("1", "Digit1")).toBeNull();
    expect(fromPlugin("Delete", "Delete", { altKey: true })).toBeNull();
    expect(fromPlugin("ArrowDown", "ArrowDown")).toBeNull();
  });
});

describe("the menu keys on Windows", () => {
  const key = (k: string, mods: Mods = {}) => ({ key: k, ctrlKey: false, metaKey: false, shiftKey: false, ...mods });
  it("keeps Alt alone and F10 from the menu bar, but not on a Mac", () => {
    expect(takesMenuKey(key("Alt"), false)).toBe(true);
    expect(takesMenuKey(key("F10"), false)).toBe(true);
    expect(takesMenuKey(key("Alt"), true)).toBe(false);
  });
  it("leaves Ctrl+Alt (AltGr) and other keys alone", () => {
    expect(takesMenuKey(key("Alt", { ctrlKey: true }), false)).toBe(false);
    expect(takesMenuKey(key("AltGraph"), false)).toBe(false);
    expect(takesMenuKey(key("F8"), false)).toBe(false);
  });
});

describe("the numpad's + and -", () => {
  it("go to the next and the previous pattern, from any window", () => {
    const key = (code: string) => resolveMusicKey({ key: code === "NumpadAdd" ? "+" : "-", code, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false });
    expect(key("NumpadAdd")).toEqual({ type: "nextPattern" });
    expect(key("NumpadSubtract")).toEqual({ type: "previousPattern" });
    expect(isGlobalKey(key("NumpadAdd")!)).toBe(true);
  });
});
