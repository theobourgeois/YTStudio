/**
 * Samples dropped onto the song's windows: files from Finder, or the Browser's (dragged as their paths,
 * `BROWSER_DRAG_TYPE`). Where they land decides what they become (`docs/fl-studio/browser.md`): the rack
 * makes a channel of each, a channel's button or window gives that channel the first one, the Piano roll
 * gives it to the channel it shows.
 */
import { useMusic } from "../store";

/** What a drag of the Browser's files carries: their paths, as JSON (`BrowserDrag`). */
export const BROWSER_DRAG_TYPE = "application/x-vaudio-browser";
export interface BrowserDrag {
  paths: string[];
}

const isAudio = (file: File) => file.type.startsWith("audio/") || /\.(wav|aiff?|flac|mp3|ogg|m4a)$/i.test(file.name);
export const audioFiles = (files: FileList | null | undefined) => [...(files ?? [])].filter(isAudio);

/** The Browser's files being dragged, while they are (a drag's data can't be read until it's dropped). */
let carried: string[] | null = null;
export const setCarriedPaths = (paths: string[] | null) => (carried = paths);
export const carriedPaths = (): readonly string[] | null => carried;

/** What a sample's channel and clips are called, from its file's name ("808_kick.wav": "808 kick"). */
export const sampleName = (fileName: string) => fileName.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").trim() || "Sample";

/** Whether a drag carries samples (while it's over something, only the kinds of what it carries are known). */
export const carriesSamples = (data: DataTransfer) => data.types.includes("Files") || data.types.includes(BROWSER_DRAG_TYPE);

/** The Browser's files a drop carries (none if it isn't the Browser's). */
export function browserPaths(data: DataTransfer): string[] {
  try {
    const parsed = JSON.parse(data.getData(BROWSER_DRAG_TYPE) || "null") as Partial<BrowserDrag> | null;
    return Array.isArray(parsed?.paths) ? parsed.paths.filter((p): p is string => typeof p === "string") : [];
  } catch {
    return [];
  }
}

/** A drop as new channels, before channel `at` (default: at the end). Returns their ids. */
export async function dropAsChannels(data: DataTransfer, at?: number): Promise<string[]> {
  const paths = browserPaths(data);
  if (paths.length) return useMusic.getState().addBrowserSamples(paths, at);
  const files = audioFiles(data.files);
  return files.length ? useMusic.getState().addSamples(files, at) : [];
}

/** A drop onto the Playlist: audio clips, the first at `start` on `track` (`after`: one after another, FL's Shift). */
export function dropAsAudioClips(data: DataTransfer, at: { start: number; track: number; after?: boolean }): Promise<number[]> {
  const paths = browserPaths(data);
  if (paths.length) return useMusic.getState().addAudioClips({ paths }, at);
  const files = audioFiles(data.files);
  return files.length ? useMusic.getState().addAudioClips({ files }, at) : Promise.resolve([]);
}

/** A drop onto a sampler channel: its first sample becomes the channel's. */
export function dropOnChannel(data: DataTransfer, channelId: string) {
  const [path] = browserPaths(data);
  if (path) return void useMusic.getState().replaceSampleFromBrowser(channelId, path);
  const [file] = audioFiles(data.files);
  if (file) void useMusic.getState().replaceSample(channelId, file);
}
