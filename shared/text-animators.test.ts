import { describe, expect, it } from "vitest";
import { addEffect, normalizeEffects, textEffects, textStyleAt } from "./effects.ts";
import {
  ANIMATOR_PRESETS,
  type TextAnimation,
  addAnimator,
  animatorReach,
  glyphSelections,
  selectionAmount,
  shuffledOrder,
  textAnimationsAt,
  textUnits,
} from "./text-animators.ts";
import { MAIN_TRACK_ID, createDefaultProject } from "./timeline.ts";
import type { Clip, Project } from "./types.ts";

const text = (words: string): Clip => ({ id: "t", assetId: "", trackId: MAIN_TRACK_ID, start: 0, in: 0, out: 4, effects: textEffects({ text: words, size: 100 }) });
const project = (clip: Clip): Project => ({ ...createDefaultProject(), clips: [clip] });
const animation = (over: Partial<TextAnimation> = {}): TextAnimation => ({
  basedOn: "characters", start: 0, end: 1, offset: 0, shape: "square", randomOrder: false,
  position: [0, 0], scale: 1, rotation: 0, opacity: 1, blur: 0, tracking: 0, fill: null, ...over,
});
const amounts = (a: Partial<TextAnimation>, count: number) => Array.from({ length: count }, (_, i) => Math.round(selectionAmount(animation(a), i, count) * 1000) / 1000);

describe("text units", () => {
  it("count characters, words and lines across the whole text, skipping white space", () => {
    expect(textUnits(["ab c", "d"], "characters")).toEqual({ count: 4, of: [[0, 1, -1, 2], [3]] });
    expect(textUnits(["ab  c", "", "d e"], "words")).toEqual({ count: 4, of: [[0, 0, -1, -1, 1], [], [2, -1, 3]] });
    expect(textUnits(["ab c", "  ", "d"], "lines")).toEqual({ count: 2, of: [[0, 0, -1, 0], [-1, -1], [1]] });
    // Emoji and accents are one character each.
    expect(textUnits(["é😀"], "characters").count).toBe(2);
  });
});

describe("the range", () => {
  it("selects what's inside it, and part of a unit it only partly covers", () => {
    expect(amounts({}, 4)).toEqual([1, 1, 1, 1]);
    expect(amounts({ start: 0.5 }, 4)).toEqual([0, 0, 1, 1]);
    // Sweeping the start across: the third of four letters is half in.
    expect(amounts({ start: 0.625 }, 4)).toEqual([0, 0, 0.5, 1]);
    expect(amounts({ start: 0.25, end: 0.5 }, 4)).toEqual([0, 1, 0, 0]);
    expect(amounts({ start: 0, end: 0.25, offset: 0.5 }, 4)).toEqual([0, 0, 1, 0]);
    // Start after end is the same range.
    expect(amounts({ start: 0.5, end: 0.25 }, 4)).toEqual([0, 1, 0, 0]);
    expect(selectionAmount(animation(), -1, 4)).toBe(0);
    expect(selectionAmount(animation(), 0, 0)).toBe(0);
  });

  it("builds up, fades out or peaks across the range, by its shape", () => {
    expect(amounts({ shape: "ramp-up" }, 4)).toEqual([0.125, 0.375, 0.625, 0.875]);
    expect(amounts({ shape: "ramp-down" }, 4)).toEqual([0.875, 0.625, 0.375, 0.125]);
    // A ramp up that's still before the text has everything fully changed (e.g. hidden); once past it, nothing: sliding it across reveals the text softly, from the left.
    expect(amounts({ shape: "ramp-up", offset: -1 }, 4)).toEqual([1, 1, 1, 1]);
    expect(amounts({ shape: "ramp-up", offset: -0.5 }, 4)).toEqual([0.625, 0.875, 1, 1]);
    expect(amounts({ shape: "ramp-up", offset: 1 }, 4)).toEqual([0, 0, 0, 0]);
    expect(amounts({ shape: "triangle" }, 4)).toEqual([0.25, 0.75, 0.75, 0.25]);
    expect(amounts({ shape: "triangle", start: 0.5 }, 4)).toEqual([0, 0, 0.5, 0.5]);
    expect(amounts({ shape: "smooth" }, 2)).toEqual([0.5, 0.5]);
    expect(amounts({ shape: "round" }, 3)[1]).toBe(1);
  });

  it("picks units in a shuffled order that never changes", () => {
    expect(shuffledOrder(8)).toEqual(shuffledOrder(8));
    expect([...shuffledOrder(8)].sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(shuffledOrder(8)).not.toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    const picked = glyphSelections(["abcdefgh"], animation({ end: 0.25, randomOrder: true }))[0].map((g) => g.amount);
    expect(picked.filter((a) => a === 1)).toHaveLength(2);
    expect(picked).not.toEqual([1, 1, 0, 0, 0, 0, 0, 0]);
  });

  it("acts on each letter by its word's share", () => {
    const sel = glyphSelections(["hi you", "all"], animation({ basedOn: "words", start: 1 / 3 }));
    expect(sel[0].map((g) => g.amount)).toEqual([0, 0, 0, 1, 1, 1]);
    expect(sel[1].map((g) => [g.unit, g.amount])).toEqual([[2, 1], [2, 1], [2, 1]]);
  });
});

describe("animators on a clip", () => {
  it("are added to text only, and read at a moment", () => {
    const p = project(text("Hello world"));
    const made = addAnimator(p, "t", "typewriter");
    expect(made.effectId).toBe("text-animator");
    const clip = made.project.clips[0];
    // 10 letters at 0.05 s each (at least 0.6 s): the hidden range shrinks from the left.
    expect(clip.effects.at(-1)!.keyframes!.start.map((k) => [k.time, k.value])).toEqual([[0, 0], [0.6, 1]]);
    expect(textAnimationsAt(clip, 0.3)[0]).toMatchObject({ basedOn: "characters", opacity: 0, start: 0.5, end: 1 });
    expect(textStyleAt(clip, 0.3).animators).toHaveLength(1);
    expect(textStyleAt(p.clips[0], 0)).not.toHaveProperty("animators");
    // A second one, blank: nothing changes until its values do.
    const two = addAnimator(made.project, "t", undefined, { scale: 2 });
    expect(two.effectId).toBe("text-animator_2");
    expect(textAnimationsAt(two.project.clips[0], 0).map((a) => a.scale)).toEqual([1, 2]);
    // Long texts take longer, but never longer than the clip.
    const long = addAnimator(project(text("word ".repeat(60).trim())), "t", "pop-words").project.clips[0];
    expect(long.effects.at(-1)!.keyframes!.start.at(-1)!.time).toBe(4);
    expect(addAnimator(p, "t", "nope").effectId).toBeNull();
    const video: Project = { ...createDefaultProject(), clips: [{ id: "v", assetId: "a", trackId: MAIN_TRACK_ID, start: 0, in: 0, out: 5, effects: normalizeEffects([]) }] };
    expect(addEffect(video, ["v"], "text-animator").added.size).toBe(0);
    expect(normalizeEffects([...normalizeEffects([]), { id: "text-animator", type: "text-animator", enabled: true, params: {} }]).map((e) => e.type)).not.toContain("text-animator");
  });

  it("keep room around the text for what they do, the same at every moment", () => {
    const p = addAnimator(project(text("Hi")), "t", undefined, { position: [30, -40], blur: 10 });
    // 50 px of travel and twice the blur.
    expect(animatorReach(p.project.clips[0], 100)).toBe(70);
    expect(textStyleAt(p.project.clips[0], 0).reach).toBe(70);
    expect(textStyleAt(p.project.clips[0], 3).reach).toBe(70);
    const grown = addAnimator(project(text("Hi")), "t", undefined, { scale: 2, basedOn: "words" });
    expect(animatorReach(grown.project.clips[0], 100)).toBe(300);
    expect(animatorReach(project(text("Hi")).clips[0], 100)).toBe(0);
    // Every preset's values are ones the animator takes.
    for (const preset of ANIMATOR_PRESETS) {
      const made = addAnimator(project(text("One two")), "t", preset.id);
      expect(made.effectId, preset.id).toBe("text-animator");
      expect(made.project.clips[0].effects.at(-1)!.params, preset.id).toMatchObject(preset.params);
    }
  });
});
