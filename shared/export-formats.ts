/**
 * What an export can be (V10): its format, a quality where the codec has one, and transparency where the format
 * can carry it, as Premiere's export settings say them. Pure: the export window, the server and the assistant all
 * read these, and `exportSettings` checks a request for all three.
 */

import type { ExportFormat, ExportQuality } from "./types.ts";

export type { ExportFormat, ExportQuality };

/** How the export's page reads a frame back: YUV 4:2:0 packed on the GPU, or straight RGBA (top row first). */
export type FrameReadback = "yuv420" | "rgba";

export interface ExportFormatInfo {
  id: ExportFormat;
  label: string;
  /** The container, as the window shows it. */
  container: "MP4" | "MOV" | "ZIP";
  extension: "mp4" | "mov" | "zip";
  /** What it's for, in a line. */
  description: string;
  /** Whether it has a quality setting (the others' quality is the format's). */
  quality: boolean;
  /** Whether it can be transparent. */
  alpha: boolean;
  /** The ffmpeg encoder it needs. */
  encoder: string;
  readback: FrameReadback;
}

export const EXPORT_FORMATS: readonly ExportFormatInfo[] = [
  {
    id: "h264",
    label: "H.264",
    container: "MP4",
    extension: "mp4",
    description: "Plays everywhere: social media, phones, the web.",
    quality: true,
    alpha: false,
    encoder: "libx264",
    readback: "yuv420",
  },
  {
    id: "hevc",
    label: "HEVC (H.265)",
    container: "MP4",
    extension: "mp4",
    description: "Smaller files at the same quality; Apple devices and most recent ones play it.",
    quality: true,
    alpha: false,
    encoder: "libx265",
    readback: "yuv420",
  },
  {
    id: "prores-hq",
    label: "ProRes 422 HQ",
    container: "MOV",
    extension: "mov",
    description: "For editing elsewhere (Premiere, Final Cut, Resolve): large, close to lossless.",
    quality: false,
    alpha: false,
    encoder: "prores_ks",
    readback: "rgba",
  },
  {
    id: "prores-4444",
    label: "ProRes 4444",
    container: "MOV",
    extension: "mov",
    description: "Full colour detail, and transparency, to lay over other footage.",
    quality: false,
    alpha: true,
    encoder: "prores_ks",
    readback: "rgba",
  },
  {
    id: "png",
    label: "PNG sequence",
    container: "ZIP",
    extension: "zip",
    description: "Every frame as a lossless PNG, with the sound as a WAV, in one ZIP.",
    quality: false,
    alpha: true,
    encoder: "png",
    readback: "rgba",
  },
];

export const EXPORT_QUALITIES: readonly { id: ExportQuality; label: string; description: string }[] = [
  { id: "standard", label: "Standard", description: "Quick to render, small enough to post." },
  { id: "high", label: "High", description: "Fewer artefacts in fine detail and gradients; a larger file." },
  { id: "best", label: "Best", description: "As close to the picture as the codec gets; slow, and the largest." },
];

export const DEFAULT_EXPORT_FORMAT: ExportFormat = "h264";
export const DEFAULT_EXPORT_QUALITY: ExportQuality = "standard";

const BY_ID = new Map(EXPORT_FORMATS.map((f) => [f.id, f]));

export const isExportFormat = (value: unknown): value is ExportFormat => typeof value === "string" && BY_ID.has(value as ExportFormat);
export const isExportQuality = (value: unknown): value is ExportQuality =>
  typeof value === "string" && EXPORT_QUALITIES.some((q) => q.id === value);

export function exportFormat(id: ExportFormat): ExportFormatInfo {
  return BY_ID.get(id)!;
}

/** What an export makes, checked. */
export interface ExportSettings {
  format: ExportFormat;
  quality: ExportQuality;
  /** Transparent where nothing covers the frame (only formats with `alpha`). */
  alpha: boolean;
}

/**
 * A request's format, quality and transparency (each optional: H.264, Standard, opaque), or what's wrong with
 * them, said for whoever sent them (the window, or a model).
 */
export function exportSettings(raw: { format?: unknown; quality?: unknown; alpha?: unknown }): ExportSettings | { error: string } {
  const format = raw.format ?? DEFAULT_EXPORT_FORMAT;
  if (!isExportFormat(format)) return { error: `The format must be one of ${EXPORT_FORMATS.map((f) => f.id).join(", ")}.` };
  const quality = raw.quality ?? DEFAULT_EXPORT_QUALITY;
  if (!isExportQuality(quality)) return { error: `The quality must be one of ${EXPORT_QUALITIES.map((q) => q.id).join(", ")}.` };
  if (raw.alpha !== undefined && typeof raw.alpha !== "boolean") return { error: "`alpha` must be true or false." };
  const alpha = raw.alpha === true;
  const info = exportFormat(format);
  if (alpha && !info.alpha) {
    const can = EXPORT_FORMATS.filter((f) => f.alpha).map((f) => `${f.label} (${f.id})`);
    return { error: `${info.label} can't be transparent: only ${can.join(" and ")} can.` };
  }
  return { format, quality, alpha };
}

/** The formats an ffmpeg with these encoders can make. */
export function formatsFrom(encoders: ReadonlySet<string>): ExportFormat[] {
  return EXPORT_FORMATS.filter((f) => encoders.has(f.encoder)).map((f) => f.id);
}

/** A format's name and file type together, as a line says it ("ProRes 4444 (MOV), transparent"). */
export function describeExport({ format, quality, alpha }: ExportSettings): string {
  const info = exportFormat(format);
  const parts = [`${info.label} (${info.container})`];
  if (info.quality) parts.push(`${EXPORT_QUALITIES.find((q) => q.id === quality)!.label.toLowerCase()} quality`);
  if (alpha) parts.push("transparent");
  return parts.join(", ");
}
