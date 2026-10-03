import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FloatingGroup, type FloatingState } from "./floating.ts";

describe("FloatingGroup", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const make = () => {
    const states: FloatingState[] = [];
    const group = new FloatingGroup((state) => states.push(state), 250);
    return { group, states };
  };

  it("starts at the ordinary level and floats as soon as one of the app's windows has the focus", () => {
    const { group, states } = make();
    expect(states).toEqual([{ floating: false, visible: true }]);
    group.setAppFocused(true);
    expect(states.at(-1)).toEqual({ floating: true, visible: true });
  });

  it("stays floating through the moment between the app's windows and the engine's", () => {
    const { group, states } = make();
    group.setAppFocused(true);
    group.setAppFocused(false);
    vi.advanceTimersByTime(100);
    group.setEngineForeground(true);
    vi.advanceTimersByTime(1000);
    expect(states.at(-1)).toEqual({ floating: true, visible: true });
    expect(states.filter((s) => !s.floating)).toHaveLength(1); // only the first
  });

  it("goes back to the ordinary level once neither has had the focus for the grace period", () => {
    const { group, states } = make();
    group.setAppFocused(true);
    group.setAppFocused(false);
    vi.advanceTimersByTime(249);
    expect(states.at(-1)?.floating).toBe(true);
    vi.advanceTimersByTime(2);
    expect(states.at(-1)?.floating).toBe(false);
  });

  it("floats again at once when the focus comes back", () => {
    const { group, states } = make();
    group.setAppFocused(true);
    group.setAppFocused(false);
    vi.advanceTimersByTime(300);
    group.setEngineForeground(true);
    expect(states.at(-1)?.floating).toBe(true);
  });

  it("hides with the main window, immediately, and doesn't repeat a state it has told", () => {
    const { group, states } = make();
    group.setAppFocused(true);
    const count = states.length;
    group.setAppFocused(true);
    expect(states).toHaveLength(count);
    group.setMainVisible(false);
    expect(states.at(-1)).toEqual({ floating: true, visible: false });
    group.setMainVisible(true);
    expect(states.at(-1)).toEqual({ floating: true, visible: true });
  });

  it("does nothing more once disposed", () => {
    const { group, states } = make();
    group.setAppFocused(true);
    group.setAppFocused(false);
    group.dispose();
    const count = states.length;
    vi.advanceTimersByTime(1000);
    expect(states).toHaveLength(count);
  });
});
