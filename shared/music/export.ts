/**
 * Exporting a song (`docs/fl-studio/export.md`): the export window's settings, checked; what each file
 * is called; what ffmpeg is asked to make of the engine's 32-bit float WAVs; and the length, time and
 * disk space the window shows. The server's side is `server/music/exports.ts`, the engine's
 * `engine/src/Export.cpp`.
 *
 * Routes (`/api/music/exports`): POST `/` starts one (`ExportSongRequest`, answers the `MusicExportJob`),
 * GET `/:id` says how it's going, POST `/:id/abort` stops it, GET `/:id/files/:name` downloads a file it
 * made (in the browser, where there's no save dialog), POST `/:id/reveal` shows its files in Finder.
 */
import type { MediaAsset } from "../types.ts";
import { lastMarkerAfter } from "./markers.ts";
import { songTicks } from "./playlist.ts";
import { clamp, isFiniteNumber } from "../math.ts";
import type { PlayMode } from "./compile.ts";
import { type Resampling, isResampling } from "./engine.ts";
import { type MusicProject, PPQ } from "./types.ts";

export const EXPORT_FORMATS = ["wav", "mp3", "flac", "ogg", "m4a", "mid"] as const;
export type ExportFormat = (typeof EXPORT_FORMATS)[number];
export const EXPORT_FORMAT_NAMES: Record<ExportFormat, string> = { wav: "WAV", mp3: "MP3", flac: "FLAC", ogg: "OGG", m4a: "M4A", mid: "MIDI" };
/** The formats that are sound (MIDI is the notes). */
export type AudioFormat = Exclude<ExportFormat, "mid">;
export const isAudioFormat = (format: ExportFormat): format is AudioFormat => format !== "mid";

export const WAV_BITS = [16, 24, 32] as const;
export type WavBits = (typeof WAV_BITS)[number];
export const FLAC_BITS = [16, 24] as const;
export type FlacBits = (typeof FLAC_BITS)[number];
/** Kilobits a second each lossy format offers (MP3 stops at 320, as FL's slider does). */
export const BITRATES: Record<"mp3" | "ogg" | "m4a", readonly number[]> = {
  mp3: [64, 96, 128, 160, 192, 224, 256, 320],
  ogg: [64, 96, 128, 160, 192, 224, 256, 320, 450],
  m4a: [64, 96, 128, 160, 192, 224, 256, 320],
};

/** What happens to sound still ringing at the end: stop on the last sample, or let it ring out until it's quiet. */
/** What happens to sound ringing past the end: cut off, rung out (FL's Leave remainder), or folded onto the start (Wrap remainder, for loops). */
export type ExportTail = "cut" | "ring" | "wrap";
/** The longest a tail rings, in seconds. */
export const MAX_TAIL_SECONDS = 30;

/** The export window's settings (remembered across songs, in the tab). */
export interface ExportSettings {
  /** The playlist, or the pattern shown. */
  mode: PlayMode;
  /** At least one. */
  formats: ExportFormat[];
  /** 32 is floating point. */
  wavBits: WavBits;
  mp3Bitrate: number;
  oggBitrate: number;
  m4aBitrate: number;
  flacBits: FlacBits;
  /** 0 (fastest) to 8 (smallest); the sound is the same at every level. */
  flacLevel: number;
  /** Shaped noise when going down to 16 bits (WAV, FLAC), off by default. */
  dither: boolean;
  /**
   * The engine mixes in floating point, so a mix can go over full scale and still sound clean (the
   * computer's volume turns it down before the speakers); a file can't hold that, and would clip. On
   * (the default), a render that goes over is turned down as a whole, every file by the same amount,
   * until its loudest peak is just under full scale (`CLIP_CEILING`): it sounds as it played. Off, it's
   * written as it is (FL Studio's way: clipped, except in 32-bit float WAVs).
   */
  preventClipping: boolean;
  /** A file for each mixer track that has sound (FL's Split mixer tracks), from the same render. */
  stems: boolean;
  /** With stems: the mix too (FL's Include master). */
  includeMix: boolean;
  tail: ExportTail;
  /** How samplers and audio clips are read when pitched (Settings' export choice, by default). */
  resampling: Resampling;
  /** Open the folder in Finder when it's done. */
  reveal: boolean;
}

export const DEFAULT_EXPORT_SETTINGS: ExportSettings = {
  mode: "song",
  formats: ["wav"],
  wavBits: 24,
  mp3Bitrate: 320,
  oggBitrate: 256,
  m4aBitrate: 256,
  flacBits: 24,
  flacLevel: 5,
  dither: false,
  preventClipping: true,
  stems: false,
  includeMix: true,
  tail: "cut",
  resampling: "sinc",
  reveal: true,
};

const nearest = (options: readonly number[], value: unknown, fallback: number) =>
  isFiniteNumber(value) ? options.reduce((best, o) => (Math.abs(o - value) < Math.abs(best - value) ? o : best), options[0]) : fallback;

/** Any settings (stored, or from a request) as valid ones: what's missing or wrong is the default. */
export function normalizeExportSettings(raw: unknown): ExportSettings {
  const input = raw !== null && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const d = DEFAULT_EXPORT_SETTINGS;
  const formats = Array.isArray(input.formats) ? EXPORT_FORMATS.filter((f) => (input.formats as unknown[]).includes(f)) : d.formats;
  return {
    mode: input.mode === "pattern" ? "pattern" : input.mode === "song" ? "song" : d.mode,
    formats: formats.length ? formats : d.formats,
    wavBits: WAV_BITS.includes(input.wavBits as WavBits) ? (input.wavBits as WavBits) : d.wavBits,
    mp3Bitrate: nearest(BITRATES.mp3, input.mp3Bitrate, d.mp3Bitrate),
    oggBitrate: nearest(BITRATES.ogg, input.oggBitrate, d.oggBitrate),
    m4aBitrate: nearest(BITRATES.m4a, input.m4aBitrate, d.m4aBitrate),
    flacBits: FLAC_BITS.includes(input.flacBits as FlacBits) ? (input.flacBits as FlacBits) : d.flacBits,
    flacLevel: isFiniteNumber(input.flacLevel) ? Math.round(clamp(input.flacLevel, 0, 8)) : d.flacLevel,
    dither: typeof input.dither === "boolean" ? input.dither : d.dither,
    preventClipping: typeof input.preventClipping === "boolean" ? input.preventClipping : d.preventClipping,
    stems: typeof input.stems === "boolean" ? input.stems : d.stems,
    includeMix: typeof input.includeMix === "boolean" ? input.includeMix : d.includeMix,
    tail: input.tail === "ring" || input.tail === "cut" || input.tail === "wrap" ? input.tail : d.tail,
    resampling: isResampling(input.resampling) ? input.resampling : d.resampling,
    reveal: typeof input.reveal === "boolean" ? input.reveal : d.reveal,
  };
}

/** What `POST /api/music/exports` takes: the song as it is when Start is pressed (edits after it aren't in the files). */
export interface ExportSongRequest {
  projectId: string;
  song: MusicProject;
  /** The pattern shown (pattern mode exports it). */
  patternId: string | null;
  /** The time selection in ticks (the Playlist's in song mode, the Piano roll's in pattern mode), or null for all of it. */
  selection: { start: number; end: number } | null;
  settings: ExportSettings;
  /**
   * Where the files go: the save dialog's file (its folder, and its name without the extension). Null in a
   * browser, which has no save dialog: they're kept on the server and downloaded.
   */
  destination: string | null;
  /**
   * Render as audio clip / Consolidate (`docs/fl-studio/export.md`): the mix becomes the project's media
   * (named `name`) instead of files, given back as the job's `media`. Its settings' formats and stems are
   * ignored.
   */
  bounce?: { name: string } | null;
}

/**
 * What a song export plays, in ticks: the time selection if there is one; else, in song mode, up to the
 * last named time marker past the song's end, if there's one (FL's); else all of it (null).
 */
export function exportSelection(song: MusicProject, mode: "song" | "pattern", time: { start: number; end: number } | null): { start: number; end: number } | null {
  if (time) return time;
  if (mode !== "song") return null;
  const end = lastMarkerAfter(song, songTicks(song));
  return end === null ? null : { start: 0, end };
}

/** A file an export made. */
export interface ExportedFile {
  name: string;
  format: ExportFormat;
  /** The mixer track's name, for a stem; null for the mix (or the MIDI file). */
  track: string | null;
  bytes: number;
  /** Where it was written (desktop), or null when it's downloaded (`/api/music/exports/:id/files/:name`). */
  path: string | null;
}

/** An export, as the tab follows it (`GET /api/music/exports/:id`). */
export interface MusicExportJob {
  id: string;
  projectId: string;
  state: "rendering" | "encoding" | "done" | "failed" | "aborted";
  /** 0..1 of the song rendered (the tail comes after it). */
  rendered: number;
  /** Files encoded so far, of how many. */
  encoded: number;
  toEncode: number;
  files: ExportedFile[];
  /** Channels and effects that weren't heard (their plugin or sample couldn't be had), by name. */
  missing: string[];
  error: string | null;
  /** How long the render took, and the whole export, in seconds. */
  renderSeconds: number | null;
  seconds: number | null;
  /** The song's length rendered, in seconds (with the tail). */
  length: number | null;
  /** The render's loudest sample, in dB from full scale (over 0: it went over), once rendered. */
  peakDb: number | null;
  /** How far it was turned down so as not to clip (`preventClipping`), in dB; 0 if it wasn't. */
  gainDb: number;
  /** A bounce's mix, made the project's media (`ExportSongRequest.bounce`), once it's done. */
  media?: MediaAsset | null;
}

/** A name a file can have on any system: no slashes, colons or the like, not too long. */
export function safeFileName(name: string): string {
  const cleaned = name
    .replace(/[\\/:*?"<>|\u0000-\u001f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^\.+/, "");
  return cleaned.slice(0, 120).trim() || "Untitled";
}

/** "My song.wav", or a stem's "My song - Kick.wav". */
export const exportFileName = (base: string, track: string | null, format: ExportFormat) =>
  `${safeFileName(track === null ? base : `${base} - ${track}`)}.${format}`;

/**
 * What ffmpeg is asked to make of the engine's 32-bit float WAV (`-i <wav>` before them, the output
 * after): the format's codec and quality, 16 bits dithered if asked, and MP3 at a rate it supports.
 * `encoders` are the ones this ffmpeg has: the better one is used where there's a choice (Apple's AAC,
 * libvorbis; else ffmpeg's own Vorbis, which only takes a quality).
 */
export function encoderArgs(format: AudioFormat, settings: ExportSettings, sampleRate: number, encoders: ReadonlySet<string> = new Set(), gain = 1): string[] {
  // Turned down first (`exportGain`), then dithered on the way down to 16 bits if asked.
  const filters = (bits: number) => {
    const filters = [...(gain !== 1 ? [`volume=${gain.toFixed(6)}:precision=double`] : []), ...(bits === 16 && settings.dither ? ["aresample=osf=s16:dither_method=shibata"] : [])];
    return filters.length ? ["-af", filters.join(",")] : [];
  };
  switch (format) {
    case "wav": {
      const codec = settings.wavBits === 32 ? "pcm_f32le" : settings.wavBits === 24 ? "pcm_s24le" : "pcm_s16le";
      return [...filters(settings.wavBits), "-c:a", codec];
    }
    case "flac":
      return [...filters(settings.flacBits), "-c:a", "flac", "-sample_fmt", settings.flacBits === 16 ? "s16" : "s32", ...(settings.flacBits === 24 ? ["-bits_per_raw_sample", "24"] : []), "-compression_level", String(settings.flacLevel)];
    case "mp3":
      // MP3 only has 32, 44.1 and 48 kHz.
      return [...filters(0), "-c:a", "libmp3lame", "-b:a", `${settings.mp3Bitrate}k`, ...([32000, 44100, 48000].includes(sampleRate) ? [] : ["-ar", sampleRate > 48000 ? "48000" : "44100"])];
    case "ogg":
      if (encoders.has("libvorbis")) return [...filters(0), "-c:a", "libvorbis", "-b:a", `${settings.oggBitrate}k`];
      // Quality 0..10, about 64 kb/s at 2 and 320 at 9.
      return [...filters(0), "-c:a", "vorbis", "-strict", "-2", "-q:a", String(Math.round(clamp((settings.oggBitrate - 64) / 32 + 2, 0, 10)))];
    case "m4a":
      return [...filters(0), "-c:a", encoders.has("aac_at") ? "aac_at" : "aac", "-b:a", `${settings.m4aBitrate}k`, "-movflags", "+faststart"];
  }
}

/** Where "just under full scale" is: −0.3 dB, room for a lossy format's own small overshoots. */
export const CLIP_CEILING = 10 ** (-0.3 / 20);

/**
 * How much to turn a render down (a linear gain, 1: not at all), from the loudest sample of any of
 * its files: one gain for all of them, so stems still add up to the mix.
 */
export function exportGain(peak: number, settings: Pick<ExportSettings, "preventClipping">): number {
  return settings.preventClipping && peak > CLIP_CEILING ? CLIP_CEILING / peak : 1;
}

/** About how many bytes a second of stereo sound takes in a format, for the window's disk space. */
export function bytesPerSecond(format: ExportFormat, settings: ExportSettings, sampleRate: number): number {
  switch (format) {
    case "wav":
      return sampleRate * 2 * (settings.wavBits / 8);
    case "flac":
      // Lossless compression keeps about 60% of it.
      return sampleRate * 2 * (settings.flacBits / 8) * 0.6;
    case "mp3":
      return (settings.mp3Bitrate * 1000) / 8;
    case "ogg":
      return (settings.oggBitrate * 1000) / 8;
    case "m4a":
      return (settings.m4aBitrate * 1000) / 8;
    case "mid":
      return 0;
  }
}

/** What the export window shows before Start: the length in bars, the time, and about how much disk it takes. */
export function exportEstimate(ticks: number, tempo: number, barTicks: number, settings: ExportSettings, sampleRate: number, stems: number) {
  const seconds = (ticks / PPQ) * (60 / tempo);
  const files = (settings.stems ? stems : 0) + (!settings.stems || settings.includeMix ? 1 : 0);
  const bytes = settings.formats.reduce((sum, f) => sum + bytesPerSecond(f, settings, sampleRate) * seconds * files, 0);
  return { bars: ticks / barTicks, seconds, bytes: Math.round(bytes) };
}
