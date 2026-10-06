/**
 * Facts about project media that every suite shares (the media store itself is `server/media.ts`).
 */
import type { ImageInfo } from "./types.ts";

/**
 * How long a still image is as media (seconds): a new clip of it in the video editor, like Premiere's
 * default. Stills have no length of their own; `MediaAsset.duration` holds this.
 */
export const STILL_DURATION = 5;

/** The largest embedded ICC profile kept (bytes): LUT profiles reach a few MB, nothing real comes near this. */
export const MAX_ICC_BYTES = 8 * 1024 * 1024;

const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;
const FORMAT = /^[a-z0-9][a-z0-9_-]{0,31}$/i;

/**
 * `raw` as an `ImageInfo` if every field is valid, else null: it comes from disk (a meta.json anyone may
 * have edited) or from the photo helper, so nothing in it is trusted, and a partly valid one is dropped whole.
 */
export function normalizeImageInfo(raw: unknown): ImageInfo | null {
  if (typeof raw !== "object" || raw === null) return null;
  const { bits, hasAlpha, orientation, icc, format } = raw as Record<string, unknown>;
  if (bits !== 8 && bits !== 16) return null;
  if (typeof hasAlpha !== "boolean") return null;
  if (typeof orientation !== "number" || !Number.isInteger(orientation) || orientation < 1 || orientation > 8) return null;
  if (typeof format !== "string" || !FORMAT.test(format)) return null;
  if (icc !== null && !validIcc(icc)) return null;
  return { bits, hasAlpha, orientation, icc: icc as string | null, format };
}

function validIcc(icc: unknown): icc is string {
  return typeof icc === "string" && icc.length % 4 === 0 && icc.length <= Math.ceil(MAX_ICC_BYTES / 3) * 4 && BASE64.test(icc);
}
