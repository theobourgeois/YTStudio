import { describe, expect, it } from "vitest";
import type { ExportSettings } from "../shared/export-formats.ts";
import { encoderArgs, wavArgs } from "./encoders.ts";

const arg = (argv: string[], flag: string) => argv[argv.indexOf(flag) + 1];
const lastArg = (argv: string[], flag: string) => argv[argv.lastIndexOf(flag) + 1];
const inputsOf = (argv: string[]) => argv.filter((_, i) => argv[i - 1] === "-i");

const H264: ExportSettings = { format: "h264", quality: "standard", alpha: false };
const encode = (width: number, height: number, settings: Partial<ExportSettings> = {}, outputPath = "/out/x.mp4") =>
  encoderArgs({ width, height, fps: 30, frames: 120 }, { ...H264, ...settings }, {
    audioPath: settings.format === "png" ? null : "/tmp/mix.flac",
    outputPath,
  });

describe("encoderArgs", () => {
  it("encodes BT.709 YUV frames from stdin with the mixed sound", () => {
    const argv = encode(1080, 1920);
    expect(argv.slice(argv.indexOf("-f"), argv.indexOf("-i") + 2)).toEqual([
      "-f", "rawvideo", "-pix_fmt", "yuv420p", "-s", "1080x1920", "-framerate", "30",
      "-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709", "-color_range", "tv", "-i", "pipe:0",
    ]);
    expect(inputsOf(argv)).toEqual(["pipe:0", "/tmp/mix.flac"]);
    expect(arg(argv, "-c:v")).toBe("libx264");
    expect(arg(argv, "-c:a")).toBe("aac");
    expect(arg(argv, "-frames:v")).toBe("120");
    expect(argv.at(-1)).toBe("/out/x.mp4");
  });

  it("picks H.264's standard quality from the output size, as exports always did, and the others by name", () => {
    expect([arg(encode(720, 1280), "-crf"), arg(encode(720, 1280), "-preset")]).toEqual(["23", "veryfast"]);
    expect(arg(encode(1080, 1920), "-crf")).toBe("20");
    expect([arg(encode(1080, 1920, { quality: "high" }), "-crf"), arg(encode(1080, 1920, { quality: "high" }), "-preset")]).toEqual(["17", "medium"]);
    expect([arg(encode(720, 1280, { quality: "best" }), "-crf"), arg(encode(720, 1280, { quality: "best" }), "-preset")]).toEqual(["13", "slow"]);
  });

  it("makes HEVC Apple can play, at its own rate factors", () => {
    const argv = encode(1080, 1920, { format: "hevc" });
    expect([arg(argv, "-c:v"), arg(argv, "-tag:v"), arg(argv, "-crf"), arg(argv, "-preset")]).toEqual(["libx265", "hvc1", "24", "fast"]);
    expect(arg(encode(1080, 1920, { format: "hevc", quality: "best" }), "-crf")).toBe("16");
    expect(lastArg(argv, "-pix_fmt")).toBe("yuv420p");
  });

  it("makes ProRes from straight RGBA, converted with BT.709's matrix, with PCM sound", () => {
    const hq = encode(1080, 1920, { format: "prores-hq" }, "/out/x.mov");
    expect(hq.slice(hq.indexOf("-f"), hq.indexOf("-i") + 2)).toEqual([
      "-f", "rawvideo", "-pix_fmt", "rgba", "-s", "1080x1920", "-framerate", "30", "-i", "pipe:0",
    ]);
    expect(arg(hq, "-vf")).toBe("scale=out_color_matrix=bt709:out_range=tv:flags=accurate_rnd+full_chroma_int,format=yuv422p10le");
    expect([arg(hq, "-c:v"), arg(hq, "-profile:v"), arg(hq, "-c:a"), arg(hq, "-colorspace")]).toEqual(["prores_ks", "hq", "pcm_s24le", "bt709"]);
    expect(hq).not.toContain("-alpha_bits");

    const opaque = encode(1080, 1920, { format: "prores-4444" }, "/out/x.mov");
    expect([arg(opaque, "-profile:v"), arg(opaque, "-vf").split("format=")[1]]).toEqual(["4444", "yuv444p10le"]);
    const alpha = encode(1080, 1920, { format: "prores-4444", alpha: true }, "/out/x.mov");
    expect([arg(alpha, "-vf").split("format=")[1], arg(alpha, "-alpha_bits")]).toEqual(["yuva444p10le", "16"]);
  });

  it("writes a PNG sequence's frames numbered from 1, without sound", () => {
    const argv = encode(1080, 1920, { format: "png", alpha: true }, "/tmp/frames/x_%05d.png");
    expect(inputsOf(argv)).toEqual(["pipe:0"]);
    expect(argv).not.toContain("1:a");
    expect([arg(argv, "-c:v"), lastArg(argv, "-pix_fmt"), lastArg(argv, "-f"), arg(argv, "-start_number")]).toEqual(["png", "rgba", "image2", "1"]);
    expect(lastArg(encode(1080, 1920, { format: "png" }, "/tmp/frames/x_%05d.png"), "-pix_fmt")).toBe("rgb24");
    expect(argv.at(-1)).toBe("/tmp/frames/x_%05d.png");
  });
});

describe("wavArgs", () => {
  it("writes the mix as a 24-bit WAV", () => {
    const argv = wavArgs("/tmp/mix.flac", "/tmp/x.wav");
    expect([inputsOf(argv), arg(argv, "-c:a"), argv.at(-1)]).toEqual([["/tmp/mix.flac"], "pcm_s24le", "/tmp/x.wav"]);
  });
});
