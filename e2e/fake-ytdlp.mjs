#!/usr/bin/env node
/**
 * A stand-in for yt-dlp in the e2e tests (`YTDLP_PATH`), so they never reach the web: a search answers
 * with two clips (one for "many…" has 40, given a page at a time by `-I`), a link with a clip of its own,
 * and a download is a short tone, written as a WAV; a video's (`--merge-output-format`) two seconds of a test picture
 * (ffmpeg's), as an MP4.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);
if (args.includes("--version")) {
  console.log("2099.01.01");
  process.exit(0);
}
if (args.includes("--flat-playlist") && /^ytsearch\d+:many/.test(args[args.length - 1])) {
  const [from, to] = (args[args.indexOf("-I") + 1] ?? "1:15").split(":").map(Number);
  const entries = [];
  for (let n = from; n <= Math.min(to, 40); n++) entries.push({ id: `manyclip${String(n).padStart(3, "0")}`, title: `Result ${n}`, channel: "Many", duration: 30 });
  process.stdout.write(JSON.stringify({ entries }));
  process.exit(0);
}
if (args.includes("--flat-playlist")) {
  process.stdout.write(JSON.stringify({ entries: [
    { id: "amenbreak01", title: "Amen Break", channel: "Drum Archive", duration: 7, channel_is_verified: true },
    { id: "vocalchop01", title: "Vocal Chop", channel: "Sample Lab", duration: 4 },
  ] }));
  process.exit(0);
}
const url = args[args.length - 1];
if (args[args.length - 2] !== "--") process.exit(2);
if (args.includes("-J")) {
  process.stdout.write(JSON.stringify({ _type: "video", title: "Pasted Sound", uploader: "someone", duration: 3, extractor_key: "Soundcloud" }));
  process.exit(0);
}

// Half a second of a tone, 16-bit mono at 44.1 kHz.
const rate = 44100;
const samples = rate / 2;
const wav = Buffer.alloc(44 + samples * 2);
wav.write("RIFF", 0);
wav.writeUInt32LE(36 + samples * 2, 4);
wav.write("WAVEfmt ", 8);
wav.writeUInt32LE(16, 16);
wav.writeUInt16LE(1, 20);
wav.writeUInt16LE(1, 22);
wav.writeUInt32LE(rate, 24);
wav.writeUInt32LE(rate * 2, 28);
wav.writeUInt16LE(2, 32);
wav.writeUInt16LE(16, 34);
wav.write("data", 36);
wav.writeUInt32LE(samples * 2, 40);
for (let i = 0; i < samples; i++) wav.writeInt16LE(Math.round(Math.sin((i / rate) * 2 * Math.PI * 220) * 12000), 44 + i * 2);

const dir = args[args.indexOf("-P") + 1];
fs.mkdirSync(dir, { recursive: true });
if (args.includes("--merge-output-format")) {
  const video = path.join(dir, args[args.indexOf("-o") + 1].replace("%(ext)s", "mp4"));
  const made = spawnSync(process.env.FFMPEG_PATH || "ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", "testsrc=size=320x180:rate=15:duration=2", "-c:v", "libx264", "-pix_fmt", "yuv420p", video]);
  if (made.status !== 0) process.exit(1);
  console.log(video);
  process.exit(0);
}
const out = path.join(dir, args[args.indexOf("-o") + 1].replace("%(ext)s", "wav"));
fs.writeFileSync(out, wav);
console.log(out);
