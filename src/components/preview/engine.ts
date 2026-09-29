import type { Clip, MediaAsset } from "@shared/types";
import { motionAt, opacityAt, volumeAt } from "@shared/effects";
import { type Size, cssMatrix, placeClip } from "@shared/transform";
import { useEditor } from "@/stores/editor";
import { usePlayback } from "@/stores/playback";
import { ImageSlot, MediaSlot } from "./media-slot";
import { assignSlots, planAudio, planTrack, type SlotIds } from "./sync";

/** The elements that play one video track: an A/B pair for video clips and one for still images. */
interface VideoLayer {
  videos: [MediaSlot | null, MediaSlot | null];
  videoIds: SlotIds;
  images: [ImageSlot | null, ImageSlot | null];
  imageIds: SlotIds;
}

/**
 * Drives the preview's media elements from the playback clock and the project,
 * outside React: it subscribes to both stores and reconciles every element on
 * each change (every animation frame while playing).
 *
 * - Each video track has two <video> elements that double-buffer it: one shows
 *   the clip under the playhead, the other is parked on the next clip's first
 *   frame. Two <img> elements do the same for still images. The stage stacks
 *   the tracks' elements in layer order.
 * - The visible element is sized and transformed to where the clip's Motion
 *   puts it on the canvas (`shared/transform.ts`, same as the export), and
 *   faded by its Opacity. Values are read at the current time, so they'll
 *   follow keyframes.
 * - Each audio-track clip has its own <audio> element, played only while the
 *   playhead is inside the clip and parked on its in-point before that.
 */
export class PreviewEngine {
  private layers = new Map<string, VideoLayer>();
  private audio = new Map<string, MediaSlot>();
  private unsubscribe: (() => void) | null = null;
  private offline = false;
  private indexedAssets: MediaAsset[] | null = null;
  private assetById = new Map<string, MediaAsset>();
  private canvas: Size = { width: 0, height: 0 };

  constructor(private readonly onOfflineChange: (offline: boolean) => void) {}

  start() {
    if (this.unsubscribe) return;
    const offPlayback = usePlayback.subscribe(this.update);
    const offEditor = useEditor.subscribe((s, prev) => {
      if (s.project !== prev.project || s.assets !== prev.assets) this.update();
    });
    this.unsubscribe = () => {
      offPlayback();
      offEditor();
    };
    this.update();
  }

  stop() {
    this.unsubscribe?.();
    this.unsubscribe = null;
    for (const layer of this.layers.values()) for (const slot of layer.videos) slot?.pause();
    for (const slot of this.audio.values()) slot.pause();
  }

  /** The canvas size in CSS px (elements are placed in it). */
  setCanvasSize(size: Size) {
    if (size.width === this.canvas.width && size.height === this.canvas.height) return;
    this.canvas = size;
    this.update();
  }

  /** Ref-callback helper: returns the cleanup that releases the element. */
  attachVideo(trackId: string, index: 0 | 1, el: HTMLVideoElement) {
    const slot = new MediaSlot(el, this.update);
    const layer = this.layer(trackId);
    layer.videos[index] = slot;
    layer.videoIds = withId(layer.videoIds, index, null);
    this.update();
    return () => {
      slot.dispose();
      if (layer.videos[index] !== slot) return;
      layer.videos[index] = null;
      layer.videoIds = withId(layer.videoIds, index, null);
      this.dropIfEmpty(trackId, layer);
    };
  }

  attachImage(trackId: string, index: 0 | 1, el: HTMLImageElement) {
    const slot = new ImageSlot(el, this.update);
    const layer = this.layer(trackId);
    layer.images[index] = slot;
    layer.imageIds = withId(layer.imageIds, index, null);
    this.update();
    return () => {
      slot.dispose();
      if (layer.images[index] !== slot) return;
      layer.images[index] = null;
      layer.imageIds = withId(layer.imageIds, index, null);
      this.dropIfEmpty(trackId, layer);
    };
  }

  attachAudio(clipId: string, el: HTMLAudioElement) {
    const slot = new MediaSlot(el, this.update);
    this.audio.set(clipId, slot);
    this.update();
    return () => {
      slot.dispose();
      if (this.audio.get(clipId) === slot) this.audio.delete(clipId);
    };
  }

  private layer(trackId: string): VideoLayer {
    let layer = this.layers.get(trackId);
    if (!layer) {
      layer = { videos: [null, null], videoIds: [null, null], images: [null, null], imageIds: [null, null] };
      this.layers.set(trackId, layer);
    }
    return layer;
  }

  private dropIfEmpty(trackId: string, layer: VideoLayer) {
    if ([...layer.videos, ...layer.images].some(Boolean)) return;
    if (this.layers.get(trackId) === layer) this.layers.delete(trackId);
  }

  private update = () => {
    if (!this.unsubscribe) return;
    const { project, assets } = useEditor.getState();
    const { time, playing } = usePlayback.getState();
    this.indexAssets(assets);
    const trackMuted = new Map(project.tracks.map((t) => [t.id, t.muted]));
    const isStill = (clip: Clip | null | undefined) => this.assetById.get(clip?.assetId ?? "")?.kind === "image";
    let offline = false;

    // Video tracks: an A/B pair of elements for video clips, another for stills.
    for (const [trackId, layer] of this.layers) {
      const { current, next } = planTrack(project, trackId, time);
      const still = isStill(current?.clip);
      const idOf = (clip: Clip | null | undefined, wantStill: boolean) =>
        clip && isStill(clip) === wantStill ? clip.id : null;
      layer.videoIds = assignSlots(layer.videoIds, idOf(current?.clip, false), idOf(next, false));
      layer.imageIds = assignSlots(layer.imageIds, idOf(current?.clip, true), idOf(next, true));

      layer.videos.forEach((slot, i) => {
        if (!slot) return;
        const id = layer.videoIds[i];
        const el = slot.el as HTMLVideoElement;
        if (current && !still && id === current.clip.id) {
          const src = this.srcOf(current.clip);
          slot.setSrc(src);
          slot.setAudio(volumeAt(current.clip, current.time), trackMuted.get(trackId) ?? false);
          if (playing) slot.follow(current.time);
          else slot.hold(current.time);
          this.place(el, current.clip, current.time);
          offline ||= src === null || slot.failed;
          return;
        }
        setStyle(el, "opacity", "0");
        slot.setAudio(1, true);
        if (next && id === next.id) {
          slot.setSrc(this.srcOf(next));
          slot.hold(next.in);
        } else {
          slot.pause();
        }
      });

      layer.images.forEach((slot, i) => {
        if (!slot) return;
        const id = layer.imageIds[i];
        if (current && still && id === current.clip.id) {
          const src = this.srcOf(current.clip);
          slot.setSrc(src);
          this.place(slot.el, current.clip, current.time);
          offline ||= src === null || slot.failed;
          return;
        }
        setStyle(slot.el, "opacity", "0");
        // Loading the next still ahead of time makes the cut instant.
        if (next && id === next.id) slot.setSrc(this.srcOf(next));
      });
    }

    // Audio tracks: one element per clip.
    const planned = new Set<string>();
    for (const { clip, active, time: target } of planAudio(project, time)) {
      const slot = this.audio.get(clip.id);
      if (!slot) continue;
      planned.add(clip.id);
      const src = this.srcOf(clip);
      slot.setSrc(src);
      slot.setAudio(volumeAt(clip, target ?? clip.in), trackMuted.get(clip.trackId) ?? false);
      if (target === null) slot.pause();
      else if (active && playing) slot.follow(target);
      else slot.hold(target);
      if (active) offline ||= src === null || slot.failed;
    }
    // Elements whose clip was just deleted (React unmounts them right after).
    for (const [id, slot] of this.audio) if (!planned.has(id)) slot.pause();

    if (offline !== this.offline) {
      this.offline = offline;
      this.onOfflineChange(offline);
    }
  };

  /** Size and transform the element to where the clip is at source time `t`, and show it. */
  private place(el: HTMLElement, clip: Clip, t: number) {
    const asset = this.assetById.get(clip.assetId);
    const media = asset?.width && asset.height ? { width: asset.width, height: asset.height } : this.canvas;
    const p = placeClip(this.canvas, media, motionAt(clip, t));
    setStyle(el, "width", `${p.width}px`);
    setStyle(el, "height", `${p.height}px`);
    setStyle(el, "transform", cssMatrix(p));
    setStyle(el, "opacity", String(opacityAt(clip, t)));
  }

  private indexAssets(assets: MediaAsset[]) {
    if (assets === this.indexedAssets) return;
    this.indexedAssets = assets;
    this.assetById = new Map(assets.map((a) => [a.id, a]));
  }

  /** The clip's playable URL, or null when its asset is missing. */
  private srcOf(clip: Clip): string | null {
    return this.assetById.get(clip.assetId)?.src ?? null;
  }
}

const withId = (ids: SlotIds, index: 0 | 1, id: string | null): SlotIds =>
  index === 0 ? [id, ids[1]] : [ids[0], id];

function setStyle(el: HTMLElement, prop: "opacity" | "width" | "height" | "transform", value: string) {
  if (el.style[prop] !== value) el.style[prop] = value;
}
