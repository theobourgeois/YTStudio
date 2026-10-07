/**
 * The music suite's models in the tab (shared/music/models.ts): whether each is downloaded, its download once the
 * user says yes (the window that needs it asks: Extract stems', Convert to notes'), and the starter kit's sounds
 * those commands give the samplers they make.
 */
import { useEffect } from "react";
import { create } from "zustand";
import type { ModelStatus } from "@shared/models";
import { MUSIC_MODELS, type MusicModelName } from "@shared/music/models";
import type { Channel, MusicProject, PlaylistClip } from "@shared/music/types";
import type { MediaAsset } from "@shared/types";
import { api } from "@/lib/api";
import { musicApi } from "./api";
import { useMusic } from "./store";

export const useMusicModels = create<{ status: Partial<Record<MusicModelName, ModelStatus>> }>(() => ({ status: {} }));

const remember = (name: MusicModelName, status: ModelStatus) => useMusicModels.setState((s) => ({ status: { ...s.status, [name]: status } }));

/** Asks the server whether a model is here. */
export async function modelStatus(name: MusicModelName): Promise<ModelStatus> {
  const status = await musicApi.modelStatus(name);
  remember(name, status);
  return status;
}

/** A model's status, asked for when a window that needs it opens. */
export function useModelStatus(name: MusicModelName): ModelStatus | undefined {
  const status = useMusicModels((s) => s.status[name]);
  useEffect(() => {
    void modelStatus(name).catch(() => {});
  }, [name]);
  return status;
}

/** Downloads a model (if it isn't here) and waits for it. Throws, saying why, if it can't be had. */
export async function downloadModel(name: MusicModelName, onProgress?: (fraction: number) => void): Promise<ModelStatus> {
  let status = await musicApi.setUpModel(name);
  remember(name, status);
  while (status.status === "downloading") {
    onProgress?.(status.progress ?? 0);
    await new Promise((resolve) => setTimeout(resolve, 400));
    status = await modelStatus(name);
  }
  if (status.status !== "ready") throw new Error(status.error ?? `${MUSIC_MODELS[name].command}'s model couldn't be downloaded.`);
  return status;
}

/** "136 MB": a model's download size, for its question. */
export const modelMegabytes = (name: MusicModelName) => {
  const bytes = MUSIC_MODELS[name].files.reduce((sum, f) => sum + f.size, 0);
  return bytes < 1e6 ? `${Math.max(1, Math.round(bytes / 1e3))} KB` : `${Math.round(bytes / 1e6)} MB`;
};

/** The starter kit's sounds the made samplers play (`public/kit/`, `scripts/make-kit.ts`). */
export type KitSound = "tone" | "kick" | "snare" | "hat";

/** One of the starter kit's sounds as the open song's media: the copy it has already, else uploaded now. */
export async function kitSample(sound: KitSound): Promise<MediaAsset> {
  const { projectId } = useMusic.getState();
  if (!projectId) throw new Error("No song is open.");
  const response = await fetch(`/kit/${sound}.wav`);
  if (!response.ok) throw new Error(`The starter kit's ${sound} is missing.`);
  const blob = await response.blob();
  const name = `${sound[0].toUpperCase()}${sound.slice(1)}.wav`;
  const had = useMusic.getState().assets.find((a) => a.name === name && a.size === blob.size);
  if (had) return had;
  const asset = await api.uploadMedia(projectId, new File([blob], name, { type: "audio/wav" }));
  if (useMusic.getState().projectId === projectId) useMusic.setState((s) => ({ assets: [...s.assets, asset] }));
  return asset;
}

/** What Extract stems and Convert to notes act on: an audio clip (in the Playlist), or a channel's whole file (in the rack). */
export interface AudioTarget {
  channelId: string;
  /** The clip, or null for the channel's file, with every clip of it (Extract stems) or none (Convert to notes). */
  clipId: number | null;
}

/** A target's channel, clip and file in a song, or why it isn't one (said to the user, and to the assistant). */
export function targetIn(song: Pick<MusicProject, "channels" | "playlist">, target: AudioTarget): { channel: Channel; clip: PlaylistClip | null; sampleId: string } | { error: string } {
  const channel = song.channels.find((c) => c.id === target.channelId);
  if (!channel) return { error: `No channel ${target.channelId} in the song.` };
  if (!channel.sampleId || channel.kind === "plugin") return { error: `${channel.name} plays no audio file: pick an audio clip, or a sampler with a sample.` };
  const clip = target.clipId === null ? null : (song.playlist.clips.find((c) => c.id === target.clipId && c.kind === "audio" && c.ref === channel.id) ?? null);
  if (target.clipId !== null && !clip) return { error: `No audio clip ${target.clipId} of ${channel.name} in the Playlist.` };
  return { channel, clip, sampleId: channel.sampleId };
}
