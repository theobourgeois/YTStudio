#!/usr/bin/env node
/**
 * A stand-in for yt-dlp in the e2e tests (`YTDLP_PATH`), so they never reach the web: a search answers
 * with two clips, a link with a clip of its own, and a download is a short tone, written as a WAV.
 */
import fs from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);
if (args.includes("--version")) {
  console.log("2099.01.01");
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
const out = path.join(dir, args[args.indexOf("-o") + 1].replace("%(ext)s", "wav"));
fs.writeFileSync(out, wav);
console.log(out);
