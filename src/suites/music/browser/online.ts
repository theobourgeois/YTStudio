/**
 * The Browser's online clips (its Online tab: YouTube's search, or a link from any site yt-dlp reads). Wherever
 * the Browser hands a sample round (previews, drags, sending it to a channel) it's a string: a file's path, or
 * an online clip's URL. The server takes either (`/api/browser/use` and `/preview`), downloading a clip's sound
 * once and keeping it.
 */
import type { UseBrowserFileRequest } from "@shared/music/browser";
import type { PreviewFileRequest } from "@shared/music/engine";
import type { WebClip } from "@shared/types";
import { musicApi } from "../api";
import { nameOf } from "./tree";

/** Whether a sample is an online clip (its URL) rather than a file (its path). */
export const isOnline = (sample: string) => /^https?:\/\//i.test(sample);

/** The clips the Online tab has shown, by URL: what a sample of theirs is called before it's in the song. */
const clips = new Map<string, WebClip>();
const KEPT = 500;

export function rememberClips(found: readonly WebClip[]) {
  for (const clip of found) {
    clips.delete(clip.url);
    clips.set(clip.url, clip);
  }
  while (clips.size > KEPT) clips.delete(clips.keys().next().value!);
}

export const onlineClip = (url: string): WebClip | null => clips.get(url) ?? null;

/** What the Browser calls a sample: a file's name, or a clip's title. */
export const displayName = (sample: string) => (isOnline(sample) ? (onlineClip(sample)?.title ?? "Online audio") : nameOf(sample));

/** What a sample's channel and clips are called, from its file's name ("808_kick.wav": "808 kick"). */
export const sampleName = (fileName: string) => fileName.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").trim() || "Sample";

/** What a sample's channel or clip is called once it's in (a clip's title as it is, a file's name tidied). */
export const sampleLabel = (sample: string) => (isOnline(sample) ? displayName(sample) : sampleName(nameOf(sample)));

/** Where the tab reads a sample's sound (its waveform). */
export const sampleUrl = (sample: string) => (isOnline(sample) ? `/api/web/audio?url=${encodeURIComponent(sample)}` : musicApi.browserFileUrl(sample));

/** A sample into a project: the request for the project's copy of it. */
export const requestFor = (projectId: string, sample: string): UseBrowserFileRequest =>
  isOnline(sample) ? { projectId, url: sample, title: onlineClip(sample)?.title } : { projectId, path: sample };

/** A sample heard by the engine's preview. */
export const previewRequest = (sample: string, start: number, id: string): PreviewFileRequest =>
  isOnline(sample) ? { url: sample, start, id } : { path: sample, start, id };
