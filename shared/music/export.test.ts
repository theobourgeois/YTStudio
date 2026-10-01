import { describe, expect, it } from "vitest";
import { DEFAULT_EXPORT_SETTINGS, encoderArgs, exportEstimate, exportFileName, normalizeExportSettings, safeFileName } from "./export.ts";

describe("normalizeExportSettings", () => {
  it("takes what's valid and puts the default where something's missing or wrong", () => {
    expect(normalizeExportSettings(undefined)).toEqual(DEFAULT_EXPORT_SETTINGS);
    expect(
      normalizeExportSettings({ mode: "pattern", formats: ["mp3", "mid", "aiff"], wavBits: 20, mp3Bitrate: 300, flacLevel: 12, tail: "ring", resampling: "linear", stems: true, dither: "yes" }),
    ).toEqual({ ...DEFAULT_EXPORT_SETTINGS, mode: "pattern", formats: ["mp3", "mid"], mp3Bitrate: 320, flacLevel: 8, tail: "ring", resampling: "linear", stems: true });
    // Formats keep their own order, and there's always one.
    expect(normalizeExportSettings({ formats: ["flac", "wav"] }).formats).toEqual(["wav", "flac"]);
    expect(normalizeExportSettings({ formats: [] }).formats).toEqual(["wav"]);
  });
});

describe("file names", () => {
  it("are safe on any system, and stems are named after their track", () => {
    expect(safeFileName('My: song / "final"?')).toBe("My song final");
    expect(safeFileName("...")).toBe("Untitled");
    expect(exportFileName("Night drive", null, "wav")).toBe("Night drive.wav");
    expect(exportFileName("Night drive", "Kick/808", "mp3")).toBe("Night drive - Kick 808.mp3");
  });
});

describe("encoderArgs", () => {
  const s = DEFAULT_EXPORT_SETTINGS;
  it("asks each format for its quality, 16 bits dithered only when asked", () => {
    expect(encoderArgs("wav", { ...s, wavBits: 24 }, 48000)).toEqual(["-c:a", "pcm_s24le"]);
    expect(encoderArgs("wav", { ...s, wavBits: 32 }, 48000)).toEqual(["-c:a", "pcm_f32le"]);
    expect(encoderArgs("wav", { ...s, wavBits: 16, dither: true }, 48000)).toEqual(["-af", "aresample=osf=s16:dither_method=shibata", "-c:a", "pcm_s16le"]);
    expect(encoderArgs("flac", { ...s, flacBits: 24, flacLevel: 8 }, 48000)).toEqual(["-c:a", "flac", "-sample_fmt", "s32", "-bits_per_raw_sample", "24", "-compression_level", "8"]);
    expect(encoderArgs("mp3", { ...s, mp3Bitrate: 192 }, 48000)).toEqual(["-c:a", "libmp3lame", "-b:a", "192k"]);
  });
  it("keeps MP3 to the rates it has, and uses the better encoders this ffmpeg has", () => {
    expect(encoderArgs("mp3", s, 96000)).toContain("48000");
    expect(encoderArgs("mp3", s, 88200).slice(-2)).toEqual(["-ar", "48000"]);
    expect(encoderArgs("m4a", s, 48000, new Set(["aac_at"]))).toContain("aac_at");
    expect(encoderArgs("m4a", s, 48000)).toContain("aac");
    expect(encoderArgs("ogg", s, 48000, new Set(["libvorbis"]))).toEqual(["-c:a", "libvorbis", "-b:a", "256k"]);
    expect(encoderArgs("ogg", { ...s, oggBitrate: 320 }, 48000)).toEqual(["-c:a", "vorbis", "-strict", "-2", "-q:a", "10"]);
  });
});

describe("exportEstimate", () => {
  it("says the length, the time and about how much disk it takes", () => {
    // 8 bars of 4/4 at 120 BPM: 16 s; 24-bit WAV at 48 kHz is 288 000 bytes a second.
    expect(exportEstimate(8 * 384, 120, 384, { ...s(), formats: ["wav"] }, 48000, 3)).toEqual({ bars: 8, seconds: 16, bytes: 16 * 288_000 });
    // With stems (three tracks) and the mix: four files; MP3 at 320 adds 40 000 bytes a second each.
    expect(exportEstimate(8 * 384, 120, 384, { ...s(), formats: ["wav", "mp3"], stems: true }, 48000, 3).bytes).toBe(4 * 16 * (288_000 + 40_000));
  });
});

function s() {
  return DEFAULT_EXPORT_SETTINGS;
}
