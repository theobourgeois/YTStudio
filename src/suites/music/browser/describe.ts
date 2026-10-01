/** What the assistant reads of the Browser (its tools in `../tools.ts`): plain text, with full paths to act on. */
import type { BrowserItem, BrowserSearchResult, BrowserState } from "@shared/music/browser";
import { addChannels, updateChannel } from "@shared/music/edits";
import type { Channel, MusicProject } from "@shared/music/types";
import type { MediaAsset } from "@shared/types";
import { findChannel } from "../tool-edits";

export function describeBrowser(state: BrowserState): string {
  if (!state.roots.length) {
    return "The Browser has no folders yet. The user adds their sample folders by dropping them onto it (or ask them for a folder's path, and add it with add_sample_folder).";
  }
  const lines = ["The Browser's folders:"];
  for (const root of state.roots) lines.push(`- ${root.path}${root.missing ? " (not there now: moved, or on a drive that isn't plugged in)" : ""}`);
  lines.push(`${state.indexed} files and folders in them${state.indexing ? " (still being read)" : ""}.`);
  if (state.favourites.length) {
    lines.push("", "Favourites:");
    for (const path of state.favourites) lines.push(`- ${path}`);
  }
  lines.push("", "list_samples with a folder shows what's in it; search_samples finds files by name.");
  return lines.join("\n");
}

export function describeFolder(folder: string, items: readonly BrowserItem[]): string {
  if (!items.length) return `${folder} has no audio files or folders.`;
  const folders = items.filter((i) => i.kind === "folder");
  const files = items.filter((i) => i.kind === "file");
  const lines = [`${folder}:`];
  if (folders.length) lines.push(`Folders (${folders.length}):`, ...folders.map((f) => `- ${f.path}/`));
  if (files.length) lines.push(`Audio files (${files.length}):`, ...files.map((f) => `- ${f.path}`));
  return lines.join("\n");
}

export function describeSearch(query: string, result: BrowserSearchResult, state: BrowserState | null): string {
  if (state && !state.roots.length) return describeBrowser(state);
  if (!result.hits.length) return `Nothing in the Browser's folders matches "${query}". Try other words, or fewer.`;
  const lines = [`${result.total} match${result.total === 1 ? "" : "es"} for "${query}"${result.total > result.hits.length ? `, the best ${result.hits.length}` : ""}:`];
  for (const hit of result.hits) lines.push(`- ${hit.path}${hit.kind === "folder" ? "/ (a folder)" : ""}`);
  return lines.join("\n");
}

const channelName = (fileName: string) => fileName.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").trim() || "Sample";

/** The sampler channel load_sample gives a file to; throws for one that isn't there or plays a plugin. */
export function sampleChannel(song: MusicProject, ref: unknown): Channel {
  const channel = findChannel(song, ref);
  if (channel.kind !== "sampler") throw new Error(`"${channel.name}" plays a plugin, which has no sample. Give the file to a sampler channel, or leave out "channel" for a new one.`);
  return channel;
}

/**
 * load_sample's edit, once its files are the project's media: the first as a channel's sample, or each as
 * a new channel. Throws (before anything changes) for a channel that can't take one.
 */
export function loadSampleEdit(song: MusicProject, assets: readonly MediaAsset[], input: { channel?: unknown; name?: unknown }): { song: MusicProject; text: string } {
  if (!assets.length) throw new Error("None of the files could be added.");
  if (input.channel !== undefined && input.channel !== null && input.channel !== "") {
    const channel = sampleChannel(song, input.channel);
    const [asset] = assets;
    return {
      song: updateChannel(song, channel.id, { sampleId: asset.id, name: channelName(asset.name) }),
      text: `"${channel.name}" now plays ${asset.name} (renamed "${channelName(asset.name)}"), its steps and notes as they were.`,
    };
  }
  const name = typeof input.name === "string" && input.name.trim() && assets.length === 1 ? input.name.trim() : null;
  const added = assets.map((a) => ({ name: name ?? channelName(a.name), sampleId: a.id }));
  return {
    song: addChannels(song, added),
    text: `Added ${added.length === 1 ? "the channel" : `${added.length} channels:`} ${added.map((c) => `"${c.name}"`).join(", ")}. Read get_song for their ids.`,
  };
}
