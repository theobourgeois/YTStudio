import { describe, expect, it } from "vitest";
import { EYEDROPPER_DEFAULTS, sanitizeEyedropper } from "./eyedropper-options";

describe("eyedropper options", () => {
  it("are Photoshop's by default, and clean up what's stored", () => {
    expect(sanitizeEyedropper({})).toEqual(EYEDROPPER_DEFAULTS);
    expect(sanitizeEyedropper({ sampleSize: 4, sampleAll: "yes", ring: false })).toEqual({ sampleSize: 1, sampleAll: true, ring: false });
    expect(sanitizeEyedropper({ sampleSize: 11, sampleAll: false })).toMatchObject({ sampleSize: 11, sampleAll: false });
  });
});
