import { describe, expect, it } from "vitest";
import { defaultEffects, isRemapped, remapKeys } from "./effects.ts";
import { normalizeProject } from "./normalize.ts";
import {
  addFreezeFrame,
  addReverseSection,
  disableTimeRemap,
  enableTimeRemap,
  mediaRange,
  mediaTime,
  remapFromSpeeds,
  remapSegments,
  remapSpeed,
  setSegmentSpeed,
  setTimeRemap,
} from "./time-remap.ts";
import { MAIN_TRACK_ID, canRetime, clipEnd, createDefaultProject, getClip, sourceAt, sourceTime } from "./timeline.ts";
import type { Clip, Project } from "./types.ts";

const clip = (patch: Partial<Clip> = {}): Clip => ({
  id: "a", assetId: "m", trackId: MAIN_TRACK_ID, start: 2, in: 1, out: 5, effects: defaultEffects(), ...patch,
});
const withClips = (...clips: Clip[]): Project => ({ ...createDefaultProject(), clips });
/** What a clip shows at timeline time t. */
const shows = (c: Clip, t: number) => mediaTime(c, sourceTime(c, t));

describe("time remapping", () => {
  it("turns on without changing what's shown", () => {
    const plain = clip();
    const on = enableTimeRemap(plain);
    expect(isRemapped(on)).toBe(true);
    expect([on.start, on.in, on.out]).toEqual([2, 1, 5]);
    for (const t of [2, 3, 4.5]) expect(shows(on, t)).toBeCloseTo(shows(plain, t), 2);
    // A clip at 2× or reversed keeps playing the same, now at 1× in its own clock.
    const fast = clip({ speed: 2, reversed: true });
    const fastOn = enableTimeRemap(fast);
    expect(fastOn.speed).toBeUndefined();
    expect(fastOn.reversed).toBeUndefined();
    expect(clipEnd(fastOn)).toBeCloseTo(clipEnd(fast));
    expect(shows(fastOn, 2.5)).toBeCloseTo(sourceAt(fast, 2.5), 2);
    expect(remapSpeed(fastOn, fastOn.in + 0.5)).toBeCloseTo(-2, 2);
  });

  it("moves its keyframes into the clip's clock and back", () => {
    const fast = clip({ speed: 2, effects: defaultEffects().map((e) => (e.type === "motion" ? { ...e, keyframes: { scale: [{ time: 3, value: 2, easing: "linear" }] } } : e)) });
    const on = enableTimeRemap(fast);
    // Source 3 was 1 s into the clip at 2×: clock time in + 1.
    expect(on.effects.find((e) => e.type === "motion")!.keyframes!.scale[0].time).toBeCloseTo(2);
    const off = disableTimeRemap(on, 10);
    expect(isRemapped(off)).toBe(false);
    expect(off.effects.some((e) => e.type === "time-remap")).toBe(false);
    expect(off.in).toBeCloseTo(1);
  });

  it("freezes a frame, rippling the track", () => {
    const next = clip({ id: "b", start: 6, in: 0, out: 2 });
    const p = addFreezeFrame(withClips(clip(), next), "a", 3, 1);
    const a = getClip(p, "a")!;
    expect(clipEnd(a)).toBeCloseTo(7);
    expect(getClip(p, "b")!.start).toBeCloseTo(7);
    expect(shows(a, 3)).toBeCloseTo(2, 3);
    expect(shows(a, 3.5)).toBeCloseTo(2, 3);
    expect(shows(a, 4.5)).toBeCloseTo(2.5, 3);
    expect(remapSegments(a).map((s) => s.speed)).toEqual([1, 0, expect.closeTo(1, 3)]);
  });

  it("plays a section backwards and forwards again", () => {
    const p = addReverseSection(withClips(clip()), "a", 3, 4);
    const a = getClip(p, "a")!;
    expect(clipEnd(a)).toBeCloseTo(8);
    expect(shows(a, 4)).toBeCloseTo(3);
    expect(shows(a, 4.5)).toBeCloseTo(2.5);
    expect(shows(a, 5)).toBeCloseTo(2);
    expect(shows(a, 6)).toBeCloseTo(3);
    expect(remapSpeed(a, sourceTime(a, 4.5))).toBeCloseTo(-1);
    expect(mediaRange(a)).toEqual({ min: 1, max: expect.closeTo(5, 2) });
  });

  it("speeds up one stretch (a velocity edit)", () => {
    let p = addFreezeFrame(withClips(clip()), "a", 3, 1);
    p = setSegmentSpeed(p, "a", 0, 0.5);
    const a = getClip(p, "a")!;
    // The first second of media now takes two.
    expect(shows(a, 4)).toBeCloseTo(2);
    expect(clipEnd(a)).toBeCloseTo(8);
    // A freeze can't be sped up.
    expect(setSegmentSpeed(p, "a", 1, 2)).toBe(p);
  });

  it("builds a ramp from speeds", () => {
    const p = remapFromSpeeds(withClips(clip()), "a", [{ duration: 1, speed: 1 }, { duration: 2, speed: 0.25 }, { duration: 1, speed: 2 }], 10, 0.5);
    const a = getClip(p, "a")!;
    expect(clipEnd(a)).toBeCloseTo(6);
    expect(shows(a, 3)).toBeCloseTo(2);
    expect(shows(a, 5)).toBeCloseTo(2.5);
    expect(shows(a, 6 - 1e-6)).toBeCloseTo(4.5);
    // Eased: the speed changes smoothly through the middle keyframes.
    const k = remapKeys(a)!;
    expect(k[1].handleIn).toBeDefined();
    expect(remapSpeed(a, k[1].time - 1e-3)).toBeCloseTo(remapSpeed(a, k[1].time + 1e-3), 1);
  });

  it("can't also be sped up, and survives normalising", () => {
    const on = setTimeRemap(withClips(clip({ speed: 2 })), ["a"], true, {});
    const a = getClip(on, "a")!;
    expect(canRetime(a, { kind: "video" })).toBe(false);
    const saved = normalizeProject({ ...JSON.parse(JSON.stringify(on)), clips: [{ ...a, speed: 3, out: 400 }] }, {
      m: { kind: "video", duration: 10, hasVideo: true, hasAudio: true },
    });
    const b = getClip(saved, "a")!;
    // Its clock isn't limited by the media's length, and remapping replaces its speed.
    expect([b.out, b.speed]).toEqual([400, undefined]);
    expect(isRemapped(b)).toBe(true);
  });
});
