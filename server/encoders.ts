/**
 * How an export's composited frames become its file (V10): the ffmpeg that encodes them in each format
 * (`shared/export-formats.ts`), and which formats this computer's ffmpeg can make.
 */
import { type ExportFormat, type ExportSettings, exportFormat, formatsFrom } from "../shared/export-formats.ts";
import { FFMPEG_QUIET, ffmpegEncoders } from "./ffmpeg.ts";
import { BT709, type RenderOptions, type RenderPlan, SAMPLE_RATE } from "./render.ts";

/** The formats this computer's ffmpeg can make. */
export async function availableFormats(): Promise<ExportFormat[]> {
  return formatsFrom(await ffmpegEncoders());
}

/** H.264's and HEVC's quality: their constant rate factor and preset (H.264's standard is what exports always were). */
function rateControl(settings: ExportSettings, width: number, height: number): string[] {
  const small = Math.min(width, height) <= 720;
  if (settings.format === "hevc") {
    const [crf, preset] = { standard: ["24", "fast"], high: ["20", "medium"], best: ["16", "slow"] }[settings.quality];
    return ["-c:v", "libx265", "-preset", preset, "-crf", crf, "-tag:v", "hvc1", "-x265-params", "log-level=error"];
  }
  const [crf, preset] = { standard: [small ? "23" : "20", "veryfast"], high: ["17", "medium"], best: ["13", "slow"] }[settings.quality];
  return ["-c:v", "libx264", "-preset", preset, "-crf", crf];
}

/**
 * RGB to BT.709 limited-range YUV for ProRes, said explicitly: swscale takes RGB input as BT.601 otherwise.
 * Accurate rounding and full chroma interpolation, as an editor's export would.
 */
const toYuv = (pixelFormat: string) =>
  `scale=out_color_matrix=bt709:out_range=tv:flags=accurate_rnd+full_chroma_int,format=${pixelFormat}`;

/**
 * The ffmpeg that encodes the composited frames (raw, exactly `plan.frames` of them, on stdin: YUV 4:2:0 for
 * H.264 and HEVC, straight RGBA for the others, see `FrameReadback`) with the mixed sound into the file. A PNG
 * sequence's `outputPath` is its frames' pattern (`dir/name_%05d.png`), and it has no sound (`audioPath` null:
 * the WAV goes beside it, `wavArgs`).
 */
export function encoderArgs(
  plan: Pick<RenderPlan, "width" | "height" | "fps" | "frames">,
  settings: ExportSettings,
  opts: Pick<RenderOptions, "ffmpegPath"> & { audioPath: string | null; outputPath: string },
): string[] {
  const { width: W, height: H, fps: F } = plan;
  const info = exportFormat(settings.format);
  const input =
    info.readback === "yuv420"
      ? ["-f", "rawvideo", "-pix_fmt", "yuv420p", "-s", `${W}x${H}`, "-framerate", String(F), ...BT709, "-i", "pipe:0"]
      : ["-f", "rawvideo", "-pix_fmt", "rgba", "-s", `${W}x${H}`, "-framerate", String(F), "-i", "pipe:0"];
  const sound = opts.audioPath === null ? [] : ["-i", opts.audioPath];
  const maps = ["-map", "0:v", ...(opts.audioPath === null ? [] : ["-map", "1:a"]), "-map_metadata", "-1"];
  const ending = ["-frames:v", String(plan.frames), "-y", opts.outputPath];
  const head = [opts.ffmpegPath ?? "ffmpeg", ...FFMPEG_QUIET, ...input, ...sound, ...maps];
  const aac = ["-c:a", "aac", "-b:a", "192k", "-ar", String(SAMPLE_RATE), "-ac", "2"];
  const pcm = ["-c:a", "pcm_s24le", "-ar", String(SAMPLE_RATE), "-ac", "2"];
  switch (settings.format) {
    case "h264":
    case "hevc":
      return [
        ...head,
        ...rateControl(settings, W, H), "-pix_fmt", "yuv420p", "-r", String(F), ...BT709,
        ...(opts.audioPath === null ? [] : aac),
        "-movflags", "+faststart",
        ...ending,
      ];
    case "prores-hq":
    case "prores-4444": {
      const hq = settings.format === "prores-hq";
      const pixelFormat = hq ? "yuv422p10le" : settings.alpha ? "yuva444p10le" : "yuv444p10le";
      return [
        ...head,
        "-vf", toYuv(pixelFormat),
        "-c:v", "prores_ks", "-profile:v", hq ? "hq" : "4444", ...(settings.alpha ? ["-alpha_bits", "16"] : []), "-vendor", "apl0",
        "-r", String(F), ...BT709,
        ...(opts.audioPath === null ? [] : pcm),
        "-movflags", "+faststart",
        ...ending,
      ];
    }
    case "png":
      return [
        ...head,
        "-c:v", "png", "-pix_fmt", settings.alpha ? "rgba" : "rgb24", "-r", String(F),
        "-f", "image2", "-start_number", "1",
        ...ending,
      ];
  }
}

/** The mixed sound (`audioArgs`' FLAC) as a 24-bit WAV, to go beside a PNG sequence's frames. */
export function wavArgs(flacPath: string, wavPath: string, ffmpegPath = "ffmpeg"): string[] {
  return [ffmpegPath, ...FFMPEG_QUIET, "-i", flacPath, "-map_metadata", "-1", "-c:a", "pcm_s24le", "-y", wavPath];
}
