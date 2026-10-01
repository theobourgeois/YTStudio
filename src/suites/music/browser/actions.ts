/**
 * What the Browser does with files (`docs/fl-studio/browser.md`), shared by its keys, its menu and the
 * middle button: FL's "Send to selected channel" and "Open in new channel".
 */
import { toast } from "sonner";
import { errorMessage } from "@shared/errors";
import type { Channel } from "@shared/music/types";
import { musicApi } from "../api";
import { useMusic } from "../store";
import { useTransport } from "../transport";
import { selectedIn, useMusicUi } from "../ui";
import { useBrowser } from "./store";

/** The channel files are sent to: the first channel selected in the rack, if it's a sampler. */
export function samplerToSendTo(): Channel | null {
  const song = useMusic.getState().history?.doc;
  if (!song) return null;
  const [first] = selectedIn(song, useMusicUi.getState().selectedChannelIds);
  return first?.kind === "sampler" ? first : null;
}

/**
 * Send a file to the selected channel (its sample becomes this one), or with no sampler selected, to a
 * new channel, selected so the next file goes there too. `swap` (Shift+Up/Down): each replaces the last
 * as one undo step. While the song isn't playing, the file is previewed as well, to be heard.
 */
export async function sendToSelectedChannel(path: string, { swap = false } = {}) {
  const target = samplerToSendTo();
  if (!useTransport.getState().playing) useBrowser.getState().preview(path);
  if (target) return useMusic.getState().replaceSampleFromBrowser(target.id, path, { swap });
  const [added] = await useMusic.getState().addBrowserSamples([path]);
  if (added) useMusicUi.getState().setSelection([added]);
}

/** Each file as a channel of its own, at the end of the rack, selected. */
export async function openInNewChannels(paths: string[]) {
  const added = await useMusic.getState().addBrowserSamples(paths);
  if (added.length) useMusicUi.getState().setSelection(added);
}

export function showInFinder(path: string) {
  musicApi.revealBrowserFile(path).catch((err) => toast.error("Couldn't show it", { description: errorMessage(err) }));
}
