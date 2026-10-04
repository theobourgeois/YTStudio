import { describe, expect, it } from "vitest";
import { HoverRelay, type HoverSurface, windowAt } from "./hover.ts";

function fake(x: number, y: number, width: number, height: number, focused = false) {
  const events: { type: string; x: number; y: number }[] = [];
  const surface: HoverSurface & { events: typeof events; focused: boolean; destroyed: boolean } = {
    events,
    focused,
    destroyed: false,
    isDestroyed: () => surface.destroyed,
    isFocused: () => surface.focused,
    getContentBounds: () => ({ x, y, width, height }),
    webContents: { sendInputEvent: (event) => void events.push(event) },
  };
  return surface;
}

describe("windowAt", () => {
  it("finds the frontmost window the point is in", () => {
    const back = { window: "main", bounds: { x: 0, y: 0, width: 100, height: 100 } };
    const front = { window: "panel", bounds: { x: 50, y: 50, width: 100, height: 100 } };
    expect(windowAt({ x: 60, y: 60 }, [back, front])).toBe("panel");
    expect(windowAt({ x: 10, y: 10 }, [back, front])).toBe("main");
    expect(windowAt({ x: 200, y: 10 }, [back, front])).toBeNull();
    expect(windowAt({ x: 150, y: 150 }, [back, front])).toBeNull();
  });
});

describe("HoverRelay", () => {
  it("moves the pointer in a window that hasn't the focus, in its own coordinates", () => {
    const main = fake(100, 50, 800, 600);
    const panel = fake(300, 200, 200, 200, true);
    const relay = new HoverRelay(() => [main, panel], () => true);
    relay.update({ x: 130, y: 90 });
    expect(main.events).toEqual([{ type: "mouseMove", x: 30, y: 40 }]);
    expect(panel.events).toEqual([]);
  });

  it("leaves the focused window to its real events", () => {
    const main = fake(0, 0, 800, 600, true);
    const relay = new HoverRelay(() => [main], () => true);
    relay.update({ x: 10, y: 10 });
    expect(main.events).toEqual([]);
  });

  it("says leave to the window the pointer came out of, and moves in the one it went into", () => {
    const main = fake(0, 0, 800, 600);
    const panel = fake(300, 200, 200, 200);
    const relay = new HoverRelay(() => [main, panel], () => true);
    relay.update({ x: 10, y: 10 });
    relay.update({ x: 320, y: 220 });
    expect(main.events.map((e) => e.type)).toEqual(["mouseMove", "mouseLeave"]);
    expect(panel.events).toEqual([{ type: "mouseMove", x: 20, y: 20 }]);
    relay.update({ x: 900, y: 10 });
    expect(panel.events.map((e) => e.type)).toEqual(["mouseMove", "mouseLeave"]);
  });

  it("sends nothing for a pointer that stands still, and starts again when the window under it changes", () => {
    const main = fake(0, 0, 800, 600);
    const relay = new HoverRelay(() => [main], () => true);
    relay.update({ x: 10, y: 10 });
    relay.update({ x: 10, y: 10 });
    expect(main.events).toHaveLength(1);
    main.focused = true;
    relay.update({ x: 10, y: 10 });
    expect(main.events.map((e) => e.type)).toEqual(["mouseMove", "mouseLeave"]);
    main.focused = false;
    relay.update({ x: 10, y: 10 });
    expect(main.events).toHaveLength(3);
  });

  it("does nothing while another program is in use, and lets go when it comes to that", () => {
    const main = fake(0, 0, 800, 600);
    let inUse = true;
    const relay = new HoverRelay(() => [main], () => inUse);
    relay.update({ x: 10, y: 10 });
    inUse = false;
    relay.update({ x: 20, y: 20 });
    expect(main.events.map((e) => e.type)).toEqual(["mouseMove", "mouseLeave"]);
    relay.update({ x: 30, y: 30 });
    expect(main.events).toHaveLength(2);
  });

  it("skips windows that are gone", () => {
    const main = fake(0, 0, 800, 600);
    const relay = new HoverRelay(() => [main], () => true);
    relay.update({ x: 10, y: 10 });
    main.destroyed = true;
    relay.update({ x: 20, y: 20 });
    relay.reset();
    expect(main.events).toHaveLength(1);
  });
});
