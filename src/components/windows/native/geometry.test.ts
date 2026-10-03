import { describe, expect, it } from "vitest";
import { areaFor, capSize, deskToScreen, keepReachable, pointToDesk, resizeFree, sameRect, scaleOf, screenToDesk, type Metrics } from "./geometry";

const metrics: Metrics = { content: { x: 100, y: 50, width: 1200, height: 800 }, scale: 1, desk: { x: 0, y: 72, width: 1200, height: 728 } };

describe("native panel geometry", () => {
  it("puts a desktop rectangle on the screen and back", () => {
    const r = { x: 10, y: 20, width: 300, height: 200 };
    expect(deskToScreen(metrics, r)).toEqual({ x: 110, y: 142, width: 300, height: 200 });
    expect(screenToDesk(metrics, deskToScreen(metrics, r))).toEqual(r);
  });

  it("follows the page's zoom: a CSS px is that many points", () => {
    const zoomed: Metrics = { ...metrics, scale: 1.25 };
    expect(deskToScreen(zoomed, { x: 40, y: 0, width: 80, height: 40 })).toEqual({ x: 150, y: 140, width: 100, height: 50 });
    const r = { x: 12, y: 30, width: 400, height: 240 };
    expect(screenToDesk(zoomed, deskToScreen(zoomed, r))).toEqual(r);
  });

  it("turns a pointer on the screen into a point on the desktop", () => {
    expect(pointToDesk(metrics, { x: 110, y: 122 })).toEqual({ x: 10, y: 0 });
  });

  it("works the zoom out from the content's width in points and in px, and falls back to 1", () => {
    expect(scaleOf(1500, 1200)).toBe(1.25);
    expect(scaleOf(1200, 1200)).toBe(1);
    expect(scaleOf(0, 1200)).toBe(1);
    expect(scaleOf(1200, 0)).toBe(1);
  });

  const areas = [
    { x: 0, y: 25, width: 1512, height: 920 },
    { x: 1512, y: 0, width: 1920, height: 1080 },
  ];

  it("finds the display that holds most of a window", () => {
    expect(areaFor({ x: 1400, y: 100, width: 400, height: 300 }, areas)).toBe(areas[1]);
    expect(areaFor({ x: 10, y: 100, width: 400, height: 300 }, areas)).toBe(areas[0]);
    expect(areaFor({ x: -5000, y: 0, width: 10, height: 10 }, areas)).toBe(areas[0]);
    expect(areaFor({ x: 0, y: 0, width: 1, height: 1 }, [])).toBeNull();
  });

  it("keeps a window's title bar on a display, wherever it's put", () => {
    // Far to the left: 80 px of it stay in view.
    expect(keepReachable({ x: -2000, y: 100, width: 400, height: 300 }, areas, 80, 28).x).toBe(80 - 400);
    // Under the bottom edge: the title bar stays above it.
    expect(keepReachable({ x: 100, y: 5000, width: 400, height: 300 }, areas, 80, 28).y).toBe(25 + 920 - 28);
    // Above the top: not under the menu bar.
    expect(keepReachable({ x: 100, y: -50, width: 400, height: 300 }, areas, 80, 28).y).toBe(25);
    // On the second display: left alone.
    const there = { x: 2000, y: 200, width: 400, height: 300 };
    expect(keepReachable(there, areas, 80, 28)).toEqual(there);
    expect(keepReachable(there, [], 80, 28)).toBe(there);
  });

  it("never makes a window bigger than its display's work area", () => {
    expect(capSize({ width: 3000, height: 500 }, areas[0])).toEqual({ width: 1512, height: 500 });
    expect(capSize({ width: 300, height: 200 }, null)).toEqual({ width: 300, height: 200 });
  });

  it("says two rectangles are the same when they land on the same pixels", () => {
    expect(sameRect({ x: 1.2, y: 2.4, width: 100.4, height: 50.1 }, { x: 1, y: 2, width: 100, height: 50 })).toBe(true);
    expect(sameRect({ x: 1, y: 2, width: 100, height: 50 }, { x: 1, y: 2, width: 101, height: 50 })).toBe(false);
  });

  it("resizes by an edge without keeping to the desktop, never below the least, the opposite edges staying put", () => {
    const start = { x: 100, y: 100, width: 400, height: 300 };
    const least = { width: 200, height: 150 };
    expect(resizeFree(start, "e", 50, 999, least)).toEqual({ x: 100, y: 100, width: 450, height: 300 });
    expect(resizeFree(start, "se", -500, -500, least)).toEqual({ x: 100, y: 100, width: 200, height: 150 });
    // The west edge may go left of the desktop's corner, and stops at the least width.
    expect(resizeFree(start, "w", -300, 0, least)).toEqual({ x: -200, y: 100, width: 700, height: 300 });
    expect(resizeFree(start, "w", 400, 0, least)).toEqual({ x: 300, y: 100, width: 200, height: 300 });
    expect(resizeFree(start, "nw", -20, -30, least)).toEqual({ x: 80, y: 70, width: 420, height: 330 });
    expect(resizeFree(start, "n", 0, 500, least)).toEqual({ x: 100, y: 250, width: 400, height: 150 });
  });
});
