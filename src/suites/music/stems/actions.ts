/**
 * Extract stems in the tab (docs/fl-studio/stems-and-notes.md): its window's state, and the split itself (the
 * server's job, polled; then the stems placed under the clip as one undo step), for the window and the assistant.
 */
import { toast } from "sonner";
import { create } from "zustand";
import { errorMessage } from "@shared/errors";
import { DEFAULT_STEMS, STEM_NAMES, type Stem, type StemFile, type StemJob, placeStems } from "@shared/music/stems";
import { musicApi } from "../api";
import { type AudioTarget, downloadModel, modelStatus, targetIn } from "../ml";
import { useMusic } from "../store";
import { useMusicUi, useMusicWindows } from "../ui";

/** How often a split's progress is asked for. */
const POLL_MS = 300;

interface StemsState {
  /** What the window splits, or null while it's closed. */
  target: AudioTarget | null;
  /** The stems ticked (kept from one split to the next). */
  chosen: Stem[];
  /** The clips the stems came from go silent. */
  mute: boolean;
}

export const useStems = create<StemsState>(() => ({ target: null, chosen: [...DEFAULT_STEMS], mute: true }));

// Its window is the open song's: another song closes it.
useMusic.subscribe((state, prev) => {
  if (state.projectId !== prev.projectId && useStems.getState().target) useStems.setState({ target: null });
});

/** Extract stems… (an audio clip's menu, an audio channel's in the rack): its window. */
export function openExtractStems(target: AudioTarget) {
  useStems.setState({ target });
  useMusicWindows.getState().focus("stems");
}

export const closeExtractStems = () => useStems.setState({ target: null });

/** What a split made: the stems' new channels, or why it couldn't. */
export type StemsResult = { channelIds: string[]; stems: Stem[]; name: string } | { error: string; cancelled?: boolean };

/**
 * Splits a target's file into `stems` on the server (the model must be downloaded: `downloadModel`) and places
 * them in the song: under the clip, or under every clip of the channel when the target is the channel. `signal`
 * cancels it; `onProgress` hears 0..1.
 */
export async function extractStems(
  target: AudioTarget,
  stems: readonly Stem[],
  options: { mute: boolean; signal?: AbortSignal; onProgress?: (fraction: number) => void },
): Promise<StemsResult> {
  const { projectId, history } = useMusic.getState();
  if (!projectId || !history) return { error: "No song is open." };
  const found = targetIn(history.doc, target);
  if ("error" in found) return found;
  if (!stems.length) return { error: "Choose at least one stem." };
  let job: StemJob;
  try {
    job = await musicApi.startStems({ projectId, sampleId: found.sampleId, stems: [...stems] });
    const cancel = () => void musicApi.cancelStems(job.id).catch(() => {});
    options.signal?.addEventListener("abort", cancel, { once: true });
    while (job.state === "running") {
      options.onProgress?.(job.progress);
      await new Promise((resolve) => setTimeout(resolve, POLL_MS));
      job = await musicApi.stemJob(job.id);
    }
    options.signal?.removeEventListener("abort", cancel);
  } catch (err) {
    return { error: errorMessage(err) };
  }
  if (job.state === "cancelled") return { error: "Cancelled.", cancelled: true };
  if (job.state !== "done") return { error: job.error ?? "The split didn't finish." };
  const made = Object.values(job.media);
  if (useMusic.getState().projectId !== projectId) return { error: "The song was closed." };
  useMusic.setState((s) => ({ assets: [...s.assets.filter((a) => !made.some((m) => m.id === a.id)), ...made] }));
  const files: StemFile[] = job.stems.flatMap((stem) => {
    const media = job.media[stem];
    return media ? [{ stem, sampleId: media.id, seconds: media.duration ?? 0 }] : [];
  });
  let channelIds: string[] = [];
  useMusic.getState().commit((song) => {
    const now = targetIn(song, target);
    if ("error" in now) return song;
    const clipIds = now.clip ? [now.clip.id] : song.playlist.clips.filter((c) => c.kind === "audio" && c.ref === now.channel.id).map((c) => c.id);
    const placed = placeStems(song, now.channel.id, clipIds, files, { mute: options.mute });
    channelIds = placed.channelIds;
    return placed.song;
  });
  if (!channelIds.length) return { error: "The stems couldn't be placed: the clip or its channel is gone." };
  return { channelIds, stems: files.map((f) => f.stem), name: found.channel.name };
}

/** The window's Extract: the model downloaded first if it must be, then the split, saying how it goes in a toast that can cancel it. */
export async function extractStemsWithToast(target: AudioTarget, stems: readonly Stem[], mute: boolean) {
  const controller = new AbortController();
  const cancel = { label: "Cancel", onClick: () => controller.abort() };
  const id = toast.loading("Extracting stems…", { action: cancel });
  try {
    if ((await modelStatus("stems")).status !== "ready") {
      toast.loading("Downloading the separation model…", { id, action: cancel });
      await downloadModel("stems", (p) => toast.loading(`Downloading the separation model… ${Math.round(p * 100)}%`, { id, action: cancel }));
    }
  } catch (err) {
    toast.error("Couldn't download the separation model", { id, description: errorMessage(err), action: undefined });
    return;
  }
  if (controller.signal.aborted) return void toast.dismiss(id);
  const result = await extractStems(target, stems, {
    mute,
    signal: controller.signal,
    onProgress: (p) => toast.loading(`Extracting stems… ${Math.round(p * 100)}%`, { id, action: cancel }),
  });
  if ("error" in result) {
    if (result.cancelled) toast.dismiss(id);
    else toast.error("Couldn't extract stems", { id, description: result.error, action: undefined });
    return;
  }
  // Their channels are in the rack's Audio group.
  useMusicUi.getState().setSelection(result.channelIds);
  toast.success(`${result.name}: ${result.stems.map((s) => STEM_NAMES[s]).join(", ")}`, {
    id,
    action: undefined,
    description: target.clipId === null ? "A channel each, and a clip each under the channel's clips." : `On the tracks below it${mute ? "; the clip is muted" : ""}.`,
  });
}
