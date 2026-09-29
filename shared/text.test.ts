import { describe, expect, it } from "vitest";
import type { Clip, Project } from "./types.ts";
import {
  APPEARANCE,
  TEXT,
  isTextClip,
  normalizeEffects,
  sanitizeValue,
  setEffectEnabled,
  setParams,
  textEffects,
  textStyleAt,
} from "./effects.ts";
import { MAIN_TRACK_ID, addTextClip, clipName, createDefaultProject, normalizeProject } from "./timeline.ts";

const textClip = (id: string, start = 0, trackId = MAIN_TRACK_ID): Clip => ({
  id, assetId: "", trackId, start, in: 0, out: 5, effects: textEffects({ text: "Hi" }),
});

describe("text parameters", () => {
  it("validates text, colours and font names", () => {
    const [text, font] = TEXT.params;
    const fill = APPEARANCE.params[0];
    expect(sanitizeValue(text, "a\r\nb")).toBe("a\nb");
    expect(sanitizeValue(text, 3)).toBeUndefined();
    expect(sanitizeValue(fill, "#AABBCC")).toBe("#aabbcc");
    expect(sanitizeValue(fill, "red")).toBeUndefined();
    expect(sanitizeValue(font, "  Futura ")).toBe("Futura");
    expect(sanitizeValue(font, "   ")).toBeUndefined();
  });

  it("gives text clips Text and Appearance, once each, always with the text on", () => {
    const clip = textClip("t");
    expect(isTextClip(clip)).toBe(true);
    expect(textStyleAt(clip, 0)).toMatchObject({ text: "Hi", font: "Helvetica Neue", fill: "#ffffff" });
    const repaired = normalizeEffects([
      { type: "text", enabled: false, params: { text: "A" } },
      { type: "text", params: { text: "B" } },
    ]);
    expect(repaired.map((e) => e.type)).toEqual(["motion", "opacity", "volume", "text", "appearance"]);
    expect(repaired[3]).toMatchObject({ enabled: true, params: { text: "A" } });
  });

  it("can't turn the text off", () => {
    const p: Project = { ...createDefaultProject(), clips: [textClip("t")] };
    expect(setEffectEnabled(p, "t", "text", false)).toBe(p);
    const edited = setParams(p, "t", "text", { text: "Bye" });
    expect(textStyleAt(edited.clips[0], 0).text).toBe("Bye");
    expect(clipName(edited.clips[0], undefined)).toBe("Bye");
  });
});

describe("text clips on the timeline", () => {
  it("survive normalising without media, but only on video tracks", () => {
    const p = normalizeProject(
      { ...createDefaultProject(), clips: [{ ...textClip("t"), assetId: "junk" }, textClip("a", 0, "audio_1")] },
      {},
    );
    expect(p.clips.map((c) => [c.id, c.assetId])).toEqual([["t", ""]]);
  });

  it("go on the top video track when it's free, else on a new track on top", () => {
    const empty = createDefaultProject();
    const first = addTextClip(empty, textClip("t"));
    expect(first.trackId).toBe(MAIN_TRACK_ID);
    const second = addTextClip(first.project, textClip("u", 2));
    expect(second.trackId).not.toBe(MAIN_TRACK_ID);
    expect(second.project.tracks[0].id).toBe(second.trackId);
  });
});
