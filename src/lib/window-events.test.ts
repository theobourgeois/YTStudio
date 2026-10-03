// @vitest-environment happy-dom
import { Window as HappyWindow } from "happy-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { addWindowListener, allWindows, isElement, isHtmlElement, onWindowsChanged, ownerDocument, ownerWindow, queryAnywhere, registerWindow, whenPointerReleased } from "./window-events";

/** A second window, as a native panel's is: its own document, and constructors of its own. */
const another = () => new HappyWindow() as unknown as Window;

describe("windows of the page", () => {
  const closers: Array<() => void> = [];
  afterEach(() => {
    for (const close of closers.splice(0)) close();
  });
  const open = () => {
    const win = another();
    closers.push(registerWindow(win));
    return win;
  };

  it("says which window an element is drawn in", () => {
    const win = open();
    const inside = win.document.createElement("div");
    win.document.body.append(inside);
    expect(ownerWindow(inside)).toBe(win);
    expect(ownerDocument(inside)).toBe(win.document);
    expect(ownerWindow(win.document)).toBe(win);
    expect(ownerWindow(win)).toBe(win);
    // The main window for anything else.
    expect(ownerWindow(document.createElement("div"))).toBe(window);
    expect(ownerWindow(null)).toBe(window);
  });

  it("knows an element of another window is an element (in a browser instanceof says no: each window has its own Element)", () => {
    const win = open();
    const div = win.document.createElement("div");
    expect(isElement(div)).toBe(true);
    expect(isHtmlElement(div)).toBe(true);
    expect(isElement(win.document.createTextNode("x"))).toBe(false);
    expect(isElement(null)).toBe(false);
    expect(isHtmlElement(win.document.createElementNS("http://www.w3.org/2000/svg", "svg"))).toBe(false);
  });

  it("listens in every window: the ones open and those opened later, and stops in all of them", () => {
    const first = open();
    const seen: string[] = [];
    const stop = addWindowListener("keydown", (e) => seen.push(`${(e.target as Window | null) === window ? "main" : "other"}`));
    const later = open();
    window.dispatchEvent(new KeyboardEvent("keydown"));
    first.dispatchEvent(new (first as unknown as { KeyboardEvent: typeof KeyboardEvent }).KeyboardEvent("keydown"));
    later.dispatchEvent(new (later as unknown as { KeyboardEvent: typeof KeyboardEvent }).KeyboardEvent("keydown"));
    expect(seen).toHaveLength(3);
    stop();
    window.dispatchEvent(new KeyboardEvent("keydown"));
    first.dispatchEvent(new (first as unknown as { KeyboardEvent: typeof KeyboardEvent }).KeyboardEvent("keydown"));
    expect(seen).toHaveLength(3);
  });

  it("stops listening in a window once it's closed", () => {
    const win = another();
    const handler = vi.fn();
    const stop = addWindowListener("blur", handler);
    const close = registerWindow(win);
    win.dispatchEvent(new (win as unknown as { Event: typeof Event }).Event("blur"));
    expect(handler).toHaveBeenCalledTimes(1);
    close();
    win.dispatchEvent(new (win as unknown as { Event: typeof Event }).Event("blur"));
    expect(handler).toHaveBeenCalledTimes(1);
    stop();
  });

  it("lists the windows, tells when they change, and finds an element in any of them", () => {
    const changes = vi.fn();
    const off = onWindowsChanged(changes);
    const win = another();
    const close = registerWindow(win);
    expect(allWindows()).toEqual([window, win]);
    expect(changes).toHaveBeenCalledTimes(1);
    const target = win.document.createElement("section");
    target.setAttribute("data-window", "rack");
    win.document.body.append(target);
    expect(queryAnywhere('[data-window="rack"]')).toBe(target);
    expect(queryAnywhere('[data-window="nothing"]')).toBeNull();
    close();
    expect(allWindows()).toEqual([window]);
    expect(queryAnywhere('[data-window="rack"]')).toBeNull();
    expect(changes).toHaveBeenCalledTimes(2);
    off();
  });

  it("runs something once when the pointer is let go in any window", () => {
    const win = open();
    const done = vi.fn();
    whenPointerReleased(done);
    win.dispatchEvent(new (win as unknown as { Event: typeof Event }).Event("pointerup"));
    window.dispatchEvent(new Event("pointerup"));
    expect(done).toHaveBeenCalledTimes(1);
  });
});
