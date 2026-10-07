import { describe, expect, it } from "vitest";
import { groupKey, groupOf, isSelectionTool } from "./tool-groups";

describe("tool groups", () => {
  it("a group's key gives its tool; with Shift, the next of it once it's in use", () => {
    // Not in use yet: Shift+W picks the group's tool, as W does.
    expect(groupKey("wand", "quickSelect", "move", true)).toBe("quickSelect");
    expect(groupKey("wand", "quickSelect", "quickSelect", true)).toBe("magicWand");
    expect(groupKey("wand", "magicWand", "magicWand", true)).toBe("quickSelect");
    // Without Shift the group's own, whatever's in use.
    expect(groupKey("marquee", "ellipse", "ellipse", false)).toBe("ellipse");
    expect(groupOf("polygonLasso")).toBe("lasso");
    expect(groupOf("brush")).toBeNull();
  });

  it("only the Marquees, the Lassos and the Wands select", () => {
    expect(isSelectionTool("magicWand")).toBe(true);
    expect(isSelectionTool("ellipse")).toBe(true);
    expect(isSelectionTool("magicEraser")).toBe(false);
    expect(isSelectionTool("gradient")).toBe(false);
    expect(isSelectionTool("crop")).toBe(false);
    expect(groupKey("eraser", "eraser", "eraser", true)).toBe("backgroundEraser");
    expect(groupKey("toning", "sponge", "sponge", true)).toBe("dodge");
  });
});
