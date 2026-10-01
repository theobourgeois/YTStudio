import { describe, expect, it } from "vitest";
import { createWindows } from "./store";

describe("createWindows", () => {
  it("brings a window to the front, and takes one out of the stack", () => {
    const windows = createWindows<"a" | "b" | "c">(["a"]);
    windows.getState().focus("b");
    windows.getState().focus("c");
    windows.getState().focus("a");
    expect(windows.getState().order).toEqual(["b", "c", "a"]);
    const before = windows.getState();
    windows.getState().focus("a");
    // Already in front: nothing changes (no render).
    expect(windows.getState()).toBe(before);
    windows.getState().remove("c");
    expect(windows.getState().order).toEqual(["b", "a"]);
  });

  it("maximises a window and puts it back where it was", () => {
    const windows = createWindows<"a">();
    const initial = { x: 10, y: 20, width: 300, height: 200 };
    windows.getState().toggleMaximised("a", initial);
    expect(windows.getState().places.a).toEqual({ ...initial, snap: "full" });
    windows.getState().toggleMaximised("a", initial);
    expect(windows.getState().places.a).toEqual({ ...initial, snap: null });
  });

  it("sends a window to the corner and back", () => {
    const windows = createWindows<"a">();
    windows.getState().place("a", { x: 40, y: 50 });
    windows.getState().toggleCorner("a", { x: 0, y: 0 });
    expect(windows.getState().places.a).toMatchObject({ x: 0, y: 0 });
    windows.getState().toggleCorner("a", { x: 0, y: 0 });
    expect(windows.getState().places.a).toMatchObject({ x: 40, y: 50 });
  });

  it("forgets every place on reset, stacked as at first", () => {
    const windows = createWindows<"a" | "b">(["a"]);
    windows.getState().focus("b");
    windows.getState().place("b", { x: 1, y: 2 });
    windows.getState().setSnapPreview("left");
    windows.getState().reset();
    expect(windows.getState()).toMatchObject({ order: ["a"], places: {}, cornerFrom: {}, snapPreview: null });
  });

  it("keeps each desktop's windows apart", () => {
    const one = createWindows<"a">();
    const two = createWindows<"a">();
    one.getState().place("a", { x: 5, y: 5 });
    expect(two.getState().places.a).toBeUndefined();
  });
});
