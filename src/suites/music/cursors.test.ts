import { describe, expect, it } from "vitest";
import { CURSOR, flCursorCss } from "./cursors";

describe("the music editor's pointers", () => {
  it("are FL Studio's variables, falling back to ours", () => {
    expect(CURSOR.hand).toBe("var(--fl-cursor-hand, grab)");
    expect(CURSOR.pen).toMatch(/^var\(--fl-cursor-pen, url\("data:image\/svg\+xml,.*"\) 3 21, crosshair\)$/);
  });

  it("defines the ones FL Studio has, and makes the plain classes theirs", () => {
    const css = flCursorCss({ moveV: { url: "data:image/png;base64,AA==", x: 15, y: 16 } });
    expect(css).toContain(`--fl-cursor-moveV: url("data:image/png;base64,AA==") 15 16, ns-resize;`);
    expect(css).toContain(".cursor-ns-resize { cursor: var(--fl-cursor-moveV, ns-resize); }");
    // Nothing for those it hasn't: they stay ours.
    expect(css).not.toContain("--fl-cursor-pen");
    expect(css).not.toContain(".cursor-ew-resize");
  });
});
