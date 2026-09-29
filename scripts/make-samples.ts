/**
 * Generate short test media into `samples/` using ffmpeg's lavfi sources.
 * Idempotent: existing files are kept (pass --force to regenerate).
 *
 *   pnpm samples [--force]
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, statSync } from "node:fs";
import path from "node:path";
import { FFMPEG } from "../server/config.ts";

const OUT_DIR = path.resolve(import.meta.dirname, "..", "samples");
const force = process.argv.includes("--force");

const H264 = ["-c:v", "libx264", "-preset", "veryfast", "-crf", "23", "-pix_fmt", "yuv420p"];
const AAC = ["-c:a", "aac", "-b:a", "128k"];

/** A rhythmic melody: plucked notes of a pentatonic riff over a kick on every beat. */
function melodyExpr(): string {
  const riff = [0, 3, 5, 7, 10, 7, 5, 3, 0, 5, 7, 12, 10, 7, 3, 5];
  const step = "mod(floor(t*4),16)";
  const semitone = riff.reduceRight(
    (rest, note, i) => `if(eq(${step},${i}),${note},${rest})`,
    "0",
  );
  const lead = `0.35*sin(2*PI*220*pow(2,${semitone}/12)*t)*exp(-10*mod(t,0.25))`;
  const kick = `0.5*sin(2*PI*(50+60*exp(-30*mod(t,0.5)))*t)*exp(-12*mod(t,0.5))`;
  return `${lead}+${kick}`;
}

interface Sample {
  file: string;
  description: string;
  args: string[];
}

const video = (source: string, size: string, seconds: number, tone?: number): string[] => [
  "-f", "lavfi", "-i", `${source}=size=${size}:rate=30`,
  ...(tone ? ["-f", "lavfi", "-i", `sine=frequency=${tone}:sample_rate=48000`] : []),
  "-t", String(seconds), ...H264, ...(tone ? [...AAC, "-ac", "2"] : ["-an"]),
];

const samples: Sample[] = [
  {
    file: "vertical-1080x1920-6s.mp4",
    description: "portrait 9:16, testsrc2 pattern, 440 Hz tone",
    args: video("testsrc2", "1080x1920", 6, 440),
  },
  {
    file: "landscape-1920x1080-8s.mp4",
    description: "landscape 16:9, SMPTE HD bars, 660 Hz tone",
    args: video("smptehdbars", "1920x1080", 8, 660),
  },
  {
    file: "square-1080-5s.mp4",
    description: "square 1:1, mandelbrot zoom, 330 Hz tone",
    args: video("mandelbrot", "1080x1080", 5, 330),
  },
  {
    file: "no-audio-1280x720-4s.mp4",
    description: "landscape 16:9, game of life, NO audio track",
    args: video("life", "1280x720", 4),
  },
  {
    file: "photo-1600x1200.jpg",
    description: "still image 4:3 (mandelbrot)",
    args: ["-f", "lavfi", "-i", "mandelbrot=size=1600x1200", "-frames:v", "1", "-q:v", "3"],
  },
  {
    file: "sticker-800.png",
    description: "still image with transparency (round, clear corners)",
    args: [
      "-f", "lavfi", "-i",
      "testsrc2=size=800x800,format=rgba,geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':a='if(lt(hypot(X-400,Y-400),380),255,0)'",
      "-frames:v", "1",
    ],
  },
  {
    file: "music-20s.mp3",
    description: "20 s rhythmic melody (audio only)",
    args: [
      "-f", "lavfi", "-i", `aevalsrc=exprs='${melodyExpr()}':channel_layout=stereo:sample_rate=44100:duration=20`,
      "-c:a", "libmp3lame", "-b:a", "192k",
    ],
  },
];

mkdirSync(OUT_DIR, { recursive: true });
let failed = false;
for (const sample of samples) {
  const out = path.join(OUT_DIR, sample.file);
  if (!force && existsSync(out) && statSync(out).size > 0) {
    console.log(`  kept     ${sample.file}`);
    continue;
  }
  const result = spawnSync(
    FFMPEG,
    ["-hide_banner", "-loglevel", "error", "-nostdin", "-y", ...sample.args, out],
    { encoding: "utf8" },
  );
  if (result.error || result.status !== 0) {
    failed = true;
    console.error(`  FAILED   ${sample.file}: ${result.error?.message ?? result.stderr.trim()}`);
  } else {
    console.log(`  created  ${sample.file} — ${sample.description}`);
  }
}
console.log(`\nSamples are in ${OUT_DIR}`);
if (failed) process.exit(1);
