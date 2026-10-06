import { describe, expect, it } from "vitest";
import { MOTION, OPACITY, paramSpec } from "@shared/effects";
import { defaultLink, isHits, refFrom, refValue, signalOptions, sourceFrom, sourceOptions, sourceValue } from "./link-model";

describe("the link popover's model", () => {
  it("groups the signals, the video's own last", () => {
    const groups = signalOptions({ signals: [{ id: "sig_k", name: "Kick", color: "#ffffff", kind: "events", events: [] }] });
    expect(groups.map((g) => g.label)).toEqual(["Sound", "Hits", "This video's signals"]);
    expect(groups[0].options.map((o) => o.value)).toContain("b:bass");
    expect(groups[1].options.map((o) => o.value)).toEqual(["b:onset", "b:onsetLow", "b:onsetMid", "b:onsetHigh", "b:beat", "b:downbeat"]);
    expect(groups[2].options).toEqual([{ value: "c:sig_k", label: "Kick" }]);
    expect(signalOptions({}).length).toBe(2);
  });

  it("round-trips references and sources", () => {
    expect(refFrom(refValue({ name: "bass" }))).toEqual({ name: "bass" });
    expect(refFrom(refValue({ id: "sig_k" }))).toEqual({ id: "sig_k" });
    expect(sourceFrom(sourceValue({ kind: "clip", clipId: "c1" }, "c1"), "c1")).toEqual({ kind: "clip", clipId: "c1" });
    expect(sourceValue({ kind: "track", trackId: "a1" }, "c1")).toBe("t:a1");
    expect(sourceFrom("master", "c1")).toBeUndefined();
    const options = sourceOptions({ tracks: [{ id: "v1", kind: "video", name: "Video 1", muted: false }, { id: "a1", kind: "audio", name: "Music", muted: false }] }, { assetId: "", effects: [] });
    expect(options.map((o) => o.value)).toEqual(["master", "t:a1"]);
  });

  it("knows hits", () => {
    expect(isHits({ name: "onsetLow" }, {})).toBe(true);
    expect(isHits({ name: "bass" }, {})).toBe(false);
    expect(isHits({ id: "b" }, { signals: [{ id: "b", name: "B", color: "#ffffff", kind: "band", source: { kind: "master" }, low: 40, high: 120, gain: 0, threshold: 0, attack: 0, release: 0.1, curve: 1, autoGain: true, onsets: true }] })).toBe(true);
  });

  it("sizes a new link for its parameter", () => {
    expect(defaultLink(paramSpec(OPACITY, "opacity")!).amount).toBe(0.2);
    expect(defaultLink(paramSpec(MOTION, "rotation")!).amount).toBe(15);
    expect(defaultLink(paramSpec(MOTION, "position")!).amount).toEqual([0, -0.04]);
    expect(defaultLink(paramSpec(MOTION, "scale")!).signal).toEqual({ name: "bass" });
  });
});
