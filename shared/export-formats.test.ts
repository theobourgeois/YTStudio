import { describe, expect, it } from "vitest";
import { EXPORT_FORMATS, describeExport, exportFormat, exportSettings, formatsFrom } from "./export-formats.ts";

describe("exportSettings", () => {
  it("defaults to an opaque H.264 of standard quality, as exports were", () => {
    expect(exportSettings({})).toEqual({ format: "h264", quality: "standard", alpha: false });
  });

  it("takes every format, quality and transparency where the format has it", () => {
    expect(exportSettings({ format: "hevc", quality: "best" })).toEqual({ format: "hevc", quality: "best", alpha: false });
    expect(exportSettings({ format: "prores-4444", alpha: true })).toEqual({ format: "prores-4444", quality: "standard", alpha: true });
    expect(exportSettings({ format: "png", alpha: true })).toMatchObject({ alpha: true });
    expect(exportSettings({ format: "prores-hq", alpha: false })).toMatchObject({ format: "prores-hq", alpha: false });
  });

  it("says what's wrong, and what would do", () => {
    expect(exportSettings({ format: "gif" })).toEqual({ error: "The format must be one of h264, hevc, prores-hq, prores-4444, png." });
    expect(exportSettings({ quality: "ultra" })).toEqual({ error: "The quality must be one of standard, high, best." });
    expect(exportSettings({ alpha: "yes" })).toEqual({ error: "`alpha` must be true or false." });
    expect(exportSettings({ format: "h264", alpha: true })).toEqual({
      error: "H.264 can't be transparent: only ProRes 4444 (prores-4444) and PNG sequence (png) can.",
    });
  });
});

describe("formats", () => {
  it("are the ones an ffmpeg's encoders can make", () => {
    expect(formatsFrom(new Set(["libx264", "png"]))).toEqual(["h264", "png"]);
    expect(formatsFrom(new Set(["libx264", "libx265", "prores_ks", "png"]))).toEqual(EXPORT_FORMATS.map((f) => f.id));
  });

  it("read back YUV only for 4:2:0 codecs without alpha", () => {
    for (const f of EXPORT_FORMATS) expect(f.readback === "yuv420", f.id).toBe(!f.alpha && f.container === "MP4");
    expect(exportFormat("prores-hq").readback).toBe("rgba");
  });

  it("are described in a line", () => {
    expect(describeExport({ format: "h264", quality: "high", alpha: false })).toBe("H.264 (MP4), high quality");
    expect(describeExport({ format: "prores-4444", quality: "standard", alpha: true })).toBe("ProRes 4444 (MOV), transparent");
  });
});
