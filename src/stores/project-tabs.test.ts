import { describe, expect, it } from "vitest";
import { cycleTab, moveTab, restoreTabs, tabAfterClose, tabsVisible, withTab, withoutTab } from "./project-tabs";

describe("project tabs", () => {
  it("adds a tab at the end, once", () => {
    const tabs = ["a", "b"];
    expect(withTab(tabs, "c")).toEqual(["a", "b", "c"]);
    expect(withTab(tabs, "a")).toBe(tabs);
  });

  it("removes a tab, keeping the same list when it isn't there", () => {
    const tabs = ["a", "b"];
    expect(withoutTab(tabs, "a")).toEqual(["b"]);
    expect(withoutTab(tabs, "z")).toBe(tabs);
  });

  it("shows the right neighbour after a close, else the left, else Home", () => {
    expect(tabAfterClose(["a", "b", "c"], "b")).toBe("c");
    expect(tabAfterClose(["a", "b", "c"], "c")).toBe("b");
    expect(tabAfterClose(["a"], "a")).toBeNull();
    expect(tabAfterClose(["a"], "z")).toBeNull();
  });

  it("cycles both ways and wraps", () => {
    const tabs = ["a", "b", "c"];
    expect(cycleTab(tabs, "a", 1)).toBe("b");
    expect(cycleTab(tabs, "c", 1)).toBe("a");
    expect(cycleTab(tabs, "a", -1)).toBe("c");
    expect(cycleTab(tabs, null, 1)).toBe("a");
    expect(cycleTab(tabs, null, -1)).toBe("c");
    expect(cycleTab([], "a", 1)).toBeNull();
  });

  it("moves a tab, clamped, returning the same list when nothing changes", () => {
    const tabs = ["a", "b", "c"];
    expect(moveTab(tabs, "a", 2)).toEqual(["b", "c", "a"]);
    expect(moveTab(tabs, "c", 0)).toEqual(["c", "a", "b"]);
    expect(moveTab(tabs, "a", 99)).toEqual(["b", "c", "a"]);
    expect(moveTab(tabs, "b", 1)).toBe(tabs);
    expect(moveTab(tabs, "z", 0)).toBe(tabs);
  });

  it("restores only what's saved as strings of projects that still exist, once each", () => {
    const exists = (id: string) => id !== "gone";
    expect(restoreTabs(["a", "gone", 3, "b", "a"], exists)).toEqual(["a", "b"]);
    expect(restoreTabs("nope", exists)).toEqual([]);
  });

  it("shows the strip while a project is open, and on the Home screen with tabs", () => {
    expect(tabsVisible(0, true)).toBe(false);
    expect(tabsVisible(1, true)).toBe(true);
    expect(tabsVisible(1, false)).toBe(true);
    expect(tabsVisible(2, false)).toBe(true);
  });
});
