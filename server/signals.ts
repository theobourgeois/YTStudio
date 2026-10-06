/**
 * A sound file's signals (`shared/signals/`), made beside it once it's imported: ffmpeg decodes it to
 * 48 kHz stereo, streamed through the analyser as it comes, then the rhythm is found (`beats.ts`) and
 * the file written. See docs/visualizer/README.md.
 */
import fs from "node:fs/promises";
import { SignalAnalyser } from "../shared/signals/analyse.ts";
import { MAX_SIGNAL_SECONDS, type SignalData, decodeSignals, encodeSignals } from "../shared/signals/format.ts";
import { FFMPEG } from "./config.ts";
import { FFMPEG_QUIET } from "./ffmpeg.ts";
import { analyseMusic } from "./media-analysis.ts";
import { run } from "./process.ts";

const SAMPLE_RATE = 48_000;
/** Longest file whose rhythm is looked for: songs, not podcasts (the search takes a while on long files). */
const MAX_RHYTHM_SECONDS = 12 * 60;

/** Analyse `src` (`duration` seconds long, as probed) and write its signals to `out`. */
export async function makeSignals(src: string, out: string, duration: number, signal?: AbortSignal): Promise<void> {
  const seconds = Math.min(duration, MAX_SIGNAL_SECONDS);
  const analyser = new SignalAnalyser(SAMPLE_RATE, seconds);
  let leftover: Buffer = Buffer.alloc(0);
  await run(
    FFMPEG,
    [...FFMPEG_QUIET, "-i", src, "-map", "0:a:0", "-vn", "-t", seconds.toFixed(3), "-ac", "2", "-ar", String(SAMPLE_RATE),
      "-f", "f32le", "-acodec", "pcm_f32le", "pipe:1"],
    {
      signal,
      onStdout: (chunk) => {
        const bytes = leftover.length ? Buffer.concat([leftover, chunk]) : chunk;
        const usable = bytes.length - (bytes.length % 8);
        // Copied so the samples are aligned for a Float32Array.
        const samples = new Float32Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + usable));
        analyser.push(samples, 2);
        leftover = bytes.subarray(usable);
      },
    },
  );
  if (signal?.aborted) throw signal.reason;
  const rhythm = seconds <= MAX_RHYTHM_SECONDS ? await analyseMusic(src, 0, seconds) : null;
  if (signal?.aborted) throw signal.reason;
  const data = analyser.finish(rhythm);
  const tmp = `${out}.${process.pid}.tmp`;
  await fs.writeFile(tmp, encodeSignals(data));
  await fs.rename(tmp, out);
}

/** Read a signals file (the export's, which plans frames on the server). */
export async function readSignals(file: string): Promise<SignalData> {
  const bytes = await fs.readFile(file);
  return decodeSignals(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
}
