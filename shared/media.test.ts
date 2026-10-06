import { describe, expect, it } from "vitest";
import { MAX_ICC_BYTES, normalizeImageInfo } from "./media.ts";

const valid = { bits: 16, hasAlpha: true, orientation: 6, icc: Buffer.from("profile").toString("base64"), format: "png" };

describe("normalizeImageInfo", () => {
  it("keeps a valid description, and only its own fields", () => {
    expect(normalizeImageInfo({ ...valid, extra: 1 })).toEqual(valid);
    expect(normalizeImageInfo({ ...valid, bits: 8, icc: null })).toEqual({ ...valid, bits: 8, icc: null });
  });

  it("drops anything partly wrong", () => {
    for (const patch of [
      { bits: 32 }, { bits: "16" }, { hasAlpha: 1 }, { orientation: 0 }, { orientation: 2.5 }, { orientation: 9 },
      { icc: "" }, { icc: "abc" }, { icc: "a b=" }, { icc: undefined }, { format: "" }, { format: "a/b" }, { format: "x".repeat(40) },
      { icc: "A".repeat((Math.ceil(MAX_ICC_BYTES / 3) + 1) * 4) },
    ]) {
      expect(normalizeImageInfo({ ...valid, ...patch }), JSON.stringify(patch).slice(0, 80)).toBeNull();
    }
    expect(normalizeImageInfo(null)).toBeNull();
    expect(normalizeImageInfo("png")).toBeNull();
  });
});
