import { describe, expect, it } from "vitest";
import { setParams, textEffects, textStyleAt } from "./effects.ts";
import { addAnimator } from "./text-animators.ts";
import { type TextLayout, sanitizeTextLayout, textDrawing, textUnit } from "./text-drawing.ts";
import { MAIN_TRACK_ID, createDefaultProject } from "./timeline.ts";
import type { Clip, Project } from "./types.ts";

const clip: Clip = { id: "t", assetId: "", trackId: MAIN_TRACK_ID, start: 0, in: 0, out: 4, effects: textEffects({ text: "Hi you\nall", size: 100 }) };
const project: Project = { ...createDefaultProject(), clips: [clip] };
// As the tab would measure it at half size (unit 0.5): two lines in a 300 x 160 frame.
const layout: TextLayout = {
  width: 300, height: 160, x: 30, y: 20, blockWidth: 240, blockHeight: 120,
  lines: [{ text: "Hi you", x: 0, width: 240 }, { text: "all", x: 70, width: 100 }],
  lineHeight: 60, baseline: 45, padX: 15, padY: 6, font: '700 50px "Helvetica Neue", sans-serif', stretch: "normal", fontPx: 50, letterSpacing: 0,
};

describe("a text's drawing", () => {
  it("places each line in the frame, with the look at that moment in canvas px", () => {
    const plain = textDrawing(textStyleAt(clip, 0), layout, 0.5);
    expect(plain).toEqual({
      width: 300, height: 160, font: layout.font, stretch: "normal", fontPx: 50, letterSpacing: 0, align: "center",
      lines: [{ text: "Hi you", x: 30, y: 65 }, { text: "all", x: 100, y: 125 }],
      fill: "#ffffff",
    });
    const styled = setParams(project, "t", "appearance", { strokeWidth: 8, strokeColor: "#ff0000", background: 0.5, shadow: 1, shadowDistance: 10, shadowBlur: 20 });
    const drawing = textDrawing(textStyleAt(styled.clips[0], 0), layout, 0.5);
    expect(drawing.stroke).toEqual({ color: "#ff0000", width: 4 });
    expect(drawing.box).toEqual({ color: "rgba(0, 0, 0, 0.5)", x: 15, y: 14, width: 270, height: 132, radius: 7.5 });
    expect(drawing.shadow).toMatchObject({ color: "rgba(0, 0, 0, 1)", blur: 10 });
    expect(drawing.shadow!.offset).toBeCloseTo(5 * Math.SQRT1_2);
  });

  it("says what each animator does to each letter then", () => {
    const animated = addAnimator(project, "t", undefined, { basedOn: "words", start: 1 / 3, position: [0, 40], blur: 10, tracking: 100, recolor: true, fill: "#ff0000" }).project;
    const [a] = textDrawing(textStyleAt(animated.clips[0], 0), layout, 0.5).animators!;
    expect(a).toMatchObject({ position: [0, 20], blur: 5, tracking: 5, fill: "#ff0000", scale: 1, opacity: 1 });
    // "Hi" is before the range; "you" and "all" are in it; the space belongs to no word.
    expect(a.glyphs[0].map((g) => g.amount)).toEqual([0, 0, 0, 1, 1, 1]);
    expect(a.glyphs[1].map((g) => [g.unit, g.amount])).toEqual([[2, 1], [2, 1], [2, 1]]);
    expect(textDrawing(textStyleAt(clip, 0), layout, 0.5)).not.toHaveProperty("animators");
  });

  it("measures sizes against the canvas at 1080p", () => {
    expect(textUnit({ width: 1080 }, "9:16")).toBe(1);
    expect(textUnit({ width: 720 }, "9:16")).toBeCloseTo(2 / 3);
    expect(textUnit({ width: 1920 }, "16:9")).toBe(1);
  });

  it("only takes sane layouts from an export request", () => {
    expect(sanitizeTextLayout(JSON.parse(JSON.stringify(layout)))).toEqual(layout);
    expect(sanitizeTextLayout({ ...layout, extra: 1, lines: [{ text: "a", x: 0, width: 5, more: true }] })).toEqual({ ...layout, lines: [{ text: "a", x: 0, width: 5 }] });
    for (const bad of [null, "x", { ...layout, width: 0 }, { ...layout, height: Infinity }, { ...layout, font: "" }, { ...layout, font: 7 }, { ...layout, lines: "no" }, { ...layout, lines: [{ text: 5, x: 0, width: 1 }] }, { ...layout, x: "1" }]) {
      expect(sanitizeTextLayout(bad)).toBeNull();
    }
  });
});
