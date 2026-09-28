import { describe, expect, it } from "vitest";
import type { Clip, MediaAsset } from "@shared/types";
import { clipCountByAsset, decorativePeaks, filterAssets } from "./media-utils.ts";

const asset = (id: string, kind: MediaAsset["kind"]) => ({ id, kind }) as MediaAsset;
const clip = (assetId: string) => ({ assetId }) as Clip;

describe("filterAssets", () => {
  const assets = [asset("a", "video"), asset("b", "audio"), asset("c", "video")];
  it("filters by kind", () => {
    expect(filterAssets(assets, "all")).toBe(assets);
    expect(filterAssets(assets, "video").map((a) => a.id)).toEqual(["a", "c"]);
    expect(filterAssets(assets, "audio").map((a) => a.id)).toEqual(["b"]);
  });
});

describe("clipCountByAsset", () => {
  it("counts clips per asset", () => {
    const counts = clipCountByAsset([clip("a"), clip("b"), clip("a")]);
    expect(counts.get("a")).toBe(2);
    expect(counts.get("b")).toBe(1);
    expect(counts.get("c")).toBeUndefined();
  });
});

describe("decorativePeaks", () => {
  it("is deterministic, in range and seed-dependent", () => {
    const a = decorativePeaks("asset_1", 24);
    expect(a).toHaveLength(24);
    expect(decorativePeaks("asset_1", 24)).toEqual(a);
    expect(decorativePeaks("asset_2", 24)).not.toEqual(a);
    for (const p of a) {
      expect(p).toBeGreaterThanOrEqual(0.2);
      expect(p).toBeLessThanOrEqual(1);
    }
  });
});
